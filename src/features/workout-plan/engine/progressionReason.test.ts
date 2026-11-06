import { describe, expect, it } from "vitest";
import type { History, Session, SetLog } from "../domain";
import { progression, progressionFromHistory } from "./progression";

const RANGE = { min: 6, max: 10 };
const EX = "Barbell_Bench_Press_-_Medium_Grip";
let n = 0;
const sets = (sid: string, t: number, rows: Array<[number | null, number]>, exerciseId = EX): SetLog[] =>
  rows.map(([kg, reps], i) => ({ id: `r${n++}`, sessionId: sid, exerciseId, setIndex: i, kg, reps, rir: null, loggedAt: t + i }));
const top = (kg: number, count = 3): Array<[number, number]> => Array.from({ length: count }, () => [kg, 10]);
const bw = (exerciseId = "Pushups") => (l: SetLog[]) => progression(exerciseId, l, { min: 8, max: 12 }, "bodyweight");

describe("progression reason: the 5 codes (AC23, W33)", () => {
  it("first_time: no history, nothing to show as last time", () => {
    const p = progression(EX, [], RANGE, "barbell");
    expect(p.reason).toEqual({ code: "first_time", params: {} });
    expect(p.lastTime).toBeNull();
  });

  it("first_time: history with no weights recorded counts as first time", () => {
    const p = progression(EX, sets("s1", 100, [[null, 10]]), RANGE, "barbell");
    expect(p.reason.code).toBe("first_time");
    expect(p.lastTime).toBeNull();
  });

  it("hold: weight stays until every set reaches the top; params carry the top reps", () => {
    const p = progression(EX, sets("s1", 100, [[40, 8], [40, 8], [40, 7]]), RANGE, "barbell");
    expect(p.targetKg).toBe(40);
    expect(p.reason).toEqual({ code: "hold", params: { max: 10 } });
  });

  it("hold: one session at the top is not enough", () => {
    const p = progression(EX, [...sets("s1", 100, [[40, 8], [40, 8]]), ...sets("s2", 200, top(40))], RANGE, "barbell");
    expect(p.reason).toEqual({ code: "hold", params: { max: 10 } });
  });

  it("increase: carries the kg added and the top reps", () => {
    const p = progression(EX, [...sets("s1", 100, top(40)), ...sets("s2", 200, top(40))], RANGE, "barbell");
    expect(p.targetKg).toBe(42.5);
    expect(p.reason).toEqual({ code: "increase", params: { n: 2.5, max: 10 } });
  });

  it("increase on dumbbells follows the declared range step", () => {
    const l = [...sets("s1", 100, top(10)), ...sets("s2", 200, top(10))];
    const p = progression(EX, l, RANGE, "dumbbell", { min: 5, max: 20, step: 2.5 });
    expect(p.reason).toEqual({ code: "increase", params: { n: 2.5, max: 10 } });
  });

  it("top of the dumbbell range: stays as hold and says so", () => {
    const l = [...sets("s1", 100, top(20)), ...sets("s2", 200, top(20))];
    const p = progression(EX, l, RANGE, "dumbbell", { min: 5, max: 20, step: 2.5 });
    expect(p.targetKg).toBe(20);
    expect(p.reason).toEqual({ code: "hold", params: { max: 10, atRangeTop: true } });
  });

  it("bodyweight_rep: one more rep than the weakest set last time", () => {
    const p = bw()(sets("s1", 100, [[null, 9], [null, 10], [null, 8]], "Pushups"));
    expect(p.targetReps).toBe(9);
    expect(p.reason).toEqual({ code: "bodyweight_rep", params: { reps: 9 } });
  });

  it("bodyweight_rep at the 15-rep cap is marked so the UI can suggest a harder variation", () => {
    const p = progression("Pushups", sets("s1", 100, [[null, 15], [null, 16]], "Pushups"), { min: 10, max: 15 }, "bodyweight");
    expect(p.reason).toEqual({ code: "bodyweight_rep", params: { reps: 15, capped: true } });
  });

  it("bodyweight first time: first_time with the starting reps (a weight line would be wrong)", () => {
    const p = bw()([]);
    expect(p.targetReps).toBe(8);
    expect(p.reason).toEqual({ code: "first_time", params: { bodyweight: true, reps: 8 } });
    expect(p.lastTime).toBeNull();
  });

  it("stall: two sessions below the bottom; params carry the bottom reps; the weight is not lowered", () => {
    const l = [...sets("s1", 100, [[60, 5], [60, 4]]), ...sets("s2", 200, [[60, 6], [60, 5]])];
    const p = progression(EX, l, RANGE, "barbell");
    expect(p.targetKg).toBe(60);
    expect(p.stalled).toBe(true);
    expect(p.reason).toEqual({ code: "stall", params: { min: 6 } });
  });

  it("exactly one reason always, for every shape of history", () => {
    const cases: SetLog[][] = [[], sets("a", 1, [[40, 8]]), sets("a", 1, top(40)), sets("a", 1, [[null, 5]])];
    for (const l of cases) for (const t of ["barbell", "dumbbell", "machine", "cable", "bodyweight"] as const) {
      const p = progression(EX, l, RANGE, t);
      expect(["first_time", "hold", "increase", "bodyweight_rep", "stall"]).toContain(p.reason.code);
    }
  });
});

describe("lastTime (W33)", () => {
  it("is the most recent session: reps in set order, the heaviest kg, and when", () => {
    const l = [...sets("s1", 100, [[40, 9], [40, 9]]), ...sets("s2", 200, [[42.5, 8], [42.5, 8], [42.5, 7]])];
    const p = progression(EX, l, RANGE, "barbell");
    expect(p.lastTime).toEqual({ at: 202, reps: [8, 8, 7], kg: 42.5, sameKg: true });
  });

  it("sets are ordered by setIndex, not by array order", () => {
    const rows = sets("s1", 100, [[20, 8], [20, 8], [20, 7]]);
    const p = progression(EX, [rows[2], rows[0], rows[1]], RANGE, "barbell");
    expect(p.lastTime?.reps).toEqual([8, 8, 7]);
  });

  it("different weights inside the session: kg is the heaviest and sameKg is false", () => {
    const p = progression(EX, sets("s1", 100, [[40, 8], [35, 10]]), RANGE, "barbell");
    expect(p.lastTime).toMatchObject({ kg: 40, sameKg: false, reps: [8, 10] });
  });

  it("bodyweight: kg is null", () => {
    const p = bw()(sets("s1", 100, [[null, 9], [null, 8]], "Pushups"));
    expect(p.lastTime).toMatchObject({ kg: null, reps: [9, 8] });
  });
});

describe("W37: an exercise left short in an early-finished session does not count", () => {
  const session = (id: string, status: Session["status"], targetSets: number): Session => ({
    id, planId: "p", templateKey: "A", name: "A", adjustedForToday: false, notes: [], status, startedAt: 1, finishedAt: 2,
    exercises: [{ exerciseId: EX, slot: "main-1", role: "main", targetSets, repRange: RANGE, targetKg: null, restSec: 90 }],
  });

  it("no last time and first_time when the only session was cut short", () => {
    const h: History = { sessions: [session("s1", "completed", 4)], setLogs: sets("s1", 100, [[40, 10]]) };
    const p = progressionFromHistory(EX, h, RANGE, "barbell");
    expect(p.lastTime).toBeNull();
    expect(p.reason.code).toBe("first_time");
  });

  it("a cut-short session never makes a stall", () => {
    const h: History = {
      sessions: [session("s1", "completed", 4), session("s2", "completed", 4)],
      setLogs: [...sets("s1", 100, [[60, 3]]), ...sets("s2", 200, [[60, 2]])],
    };
    const p = progressionFromHistory(EX, h, RANGE, "barbell");
    expect(p.stalled).toBeUndefined();
    expect(p.reason.code).toBe("first_time");
  });

  it("the earlier full session stays the last time and the cut one is skipped", () => {
    const h: History = {
      sessions: [session("s1", "completed", 3), session("s2", "completed", 3)],
      setLogs: [...sets("s1", 100, [[40, 8], [40, 8], [40, 7]]), ...sets("s2", 200, [[45, 10]])],
    };
    const p = progressionFromHistory(EX, h, RANGE, "barbell");
    expect(p.lastTime).toEqual({ at: 102, reps: [8, 8, 7], kg: 40, sameKg: true });
    expect(p.reason.code).toBe("hold");
  });

  it("abandoned and in-progress sessions never show up", () => {
    const h: History = {
      sessions: [session("s1", "abandoned", 1), session("s2", "in_progress", 1)],
      setLogs: [...sets("s1", 100, [[40, 8]]), ...sets("s2", 200, [[40, 8]])],
    };
    expect(progressionFromHistory(EX, h, RANGE, "barbell").lastTime).toBeNull();
  });
});
