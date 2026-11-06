import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type DumbbellRange, type History, type LoadType, type Plan, type Profile, type RepRange, type Rir, type Session, type SetLog } from "../domain";
import { buildPlan } from "./buildPlan";
import { FIRST_TIME_HINT, MAX_WEIGHT_HINT, STALL_HINT, HARDER_VARIATION_HINT, normalizeRir, progression, progressionFromHistory } from "./progression";
import { nextSession } from "./schedule";

const RANGE: RepRange = { min: 6, max: 10 };
const prog = (l: SetLog[], r: RepRange, t: LoadType, d?: DumbbellRange) =>
  progression(t === "bodyweight" ? "Pushups" : "Barbell_Bench_Press_-_Medium_Grip", l, r, t, d);
let n = 0;

/** One finished session of `exerciseId` at time `t`; `sets` are [kg, reps, rir?] tuples. */
function logs(sessionId: string, t: number, sets: Array<[number | null, number] | [number | null, number, Rir | null]>, exerciseId = "Barbell_Bench_Press_-_Medium_Grip"): SetLog[] {
  return sets.map(([kg, reps, rir = null], i) => ({
    id: `l${n++}`,
    sessionId,
    exerciseId,
    setIndex: i,
    kg,
    reps,
    rir,
    loggedAt: t + i,
  }));
}
const topSets = (kg: number, count = 4): Array<[number, number]> => Array.from({ length: count }, () => [kg, 10]);

describe("progression: first time", () => {
  it("no history gives an empty weight and the first-time hint", () => {
    expect(prog([], RANGE, "barbell")).toEqual({ targetKg: null, hint: FIRST_TIME_HINT });
    expect(FIRST_TIME_HINT).toBe("Pick a weight you could lift 2–3 more reps");
  });

  it("history with no weights recorded is treated as first time", () => {
    expect(prog(logs("s1", 100, [[null, 10]]), RANGE, "barbell").targetKg).toBeNull();
  });
});

describe("progression: double progression (AC07)", () => {
  it("barbell: two sessions in a row at top reps at 40kg suggest 42.5kg", () => {
    const l = [...logs("s1", 100, topSets(40)), ...logs("s2", 200, topSets(40))];
    expect(prog(l, RANGE, "barbell")).toEqual({ targetKg: 42.5 });
  });

  it("dumbbell: 10kg suggests 12kg (step 2kg)", () => {
    const l = [...logs("s1", 100, topSets(10, 3)), ...logs("s2", 200, topSets(10, 3))];
    expect(prog(l, RANGE, "dumbbell").targetKg).toBe(12);
  });

  it("dumbbell with a declared range moves to the next step of that range", () => {
    const l = [...logs("s1", 100, topSets(10, 3)), ...logs("s2", 200, topSets(10, 3))];
    expect(prog(l, RANGE, "dumbbell", { min: 5, max: 20, step: 2.5 }).targetKg).toBe(12.5);
    expect(prog(l, RANGE, "dumbbell", { min: 2, max: 30, step: 2 }).targetKg).toBe(12);
  });

  it("dumbbell at the top of the range stays put with a hint", () => {
    const l = [...logs("s1", 100, topSets(20, 3)), ...logs("s2", 200, topSets(20, 3))];
    expect(prog(l, RANGE, "dumbbell", { min: 5, max: 20, step: 2.5 })).toEqual({ targetKg: 20, hint: MAX_WEIGHT_HINT });
  });

  it("machine and cable add 2.5kg", () => {
    const l = [...logs("s1", 100, topSets(50)), ...logs("s2", 200, topSets(50))];
    expect(prog(l, RANGE, "machine").targetKg).toBe(52.5);
    expect(prog(l, RANGE, "cable").targetKg).toBe(52.5);
  });

  it("one session at top is not enough: keep the same weight", () => {
    const l = [...logs("s1", 100, [[40, 8], [40, 8], [40, 8]]), ...logs("s2", 200, topSets(40))];
    expect(prog(l, RANGE, "barbell").targetKg).toBe(40);
  });

  it("one set short of the top reps blocks the increase", () => {
    const l = [...logs("s1", 100, topSets(40)), ...logs("s2", 200, [[40, 10], [40, 10], [40, 10], [40, 9]])];
    expect(prog(l, RANGE, "barbell").targetKg).toBe(40);
  });

  it("different weights in the two sessions blocks the increase", () => {
    const l = [...logs("s1", 100, topSets(37.5)), ...logs("s2", 200, topSets(40))];
    expect(prog(l, RANGE, "barbell").targetKg).toBe(40);
  });

  it("a lighter set inside the latest session blocks the increase", () => {
    const l = [...logs("s1", 100, topSets(40)), ...logs("s2", 200, [[40, 10], [40, 10], [35, 10]])];
    expect(prog(l, RANGE, "barbell").targetKg).toBe(40);
  });

  it("only the two most recent sessions count, ordered by time not by array order", () => {
    const l = [
      ...logs("s3", 300, topSets(40)),
      ...logs("s1", 100, topSets(40)),
      ...logs("s2", 200, [[40, 7], [40, 7]]),
    ];
    expect(prog(l, RANGE, "barbell").targetKg).toBe(40);
  });

  it("does not mutate its input", () => {
    const l = [...logs("s1", 100, topSets(40)), ...logs("s2", 200, topSets(40))];
    const snap = JSON.stringify(l);
    prog(l, RANGE, "barbell");
    expect(JSON.stringify(l)).toBe(snap);
  });
});

describe("progression: stall (W13)", () => {
  it("two sessions in a row below the bottom of the range hints 10% lighter and does not lower the weight", () => {
    const l = [...logs("s1", 100, [[60, 5], [60, 4]]), ...logs("s2", 200, [[60, 6], [60, 5]])];
    expect(prog(l, RANGE, "barbell")).toEqual({ targetKg: 60, hint: STALL_HINT, stalled: true });
    expect(STALL_HINT).toBe("Try 10% lighter next time");
  });

  it("one bad session is not a stall", () => {
    const l = [...logs("s1", 100, [[60, 8], [60, 8]]), ...logs("s2", 200, [[60, 5], [60, 4]])];
    expect(prog(l, RANGE, "barbell")).toEqual({ targetKg: 60 });
  });
});

describe("progression: RIR null is not 0", () => {
  it("rir null and rir 0 give the same target and are never coerced", () => {
    const a = [...logs("s1", 100, topSets(40).map(([k, r]) => [k, r, null] as [number, number, null])), ...logs("s2", 200, topSets(40))];
    const b = a.map((x) => ({ ...x, rir: 0 as Rir }));
    expect(prog(a, RANGE, "barbell")).toEqual(prog(b, RANGE, "barbell"));
    expect(a.every((x) => x.rir === null)).toBe(true);
  });

  it("normalizeRir keeps 0 and turns blanks into null", () => {
    expect(normalizeRir(0)).toBe(0);
    expect(normalizeRir(1)).toBe(1);
    expect(normalizeRir(3)).toBe(3);
    expect(normalizeRir(null)).toBeNull();
    expect(normalizeRir(undefined)).toBeNull();
    expect(normalizeRir(Number.NaN)).toBeNull();
    expect(normalizeRir(7)).toBeNull();
    expect(normalizeRir("")).toBeNull();
  });
});

describe("progression: bodyweight", () => {
  const bw: LoadType = "bodyweight";
  it("first time starts at the bottom of the range with no weight and no weight hint", () => {
    expect(prog([], { min: 10, max: 15 }, bw)).toEqual({ targetKg: null, targetReps: 10 });
  });

  it("adds one rep over the weakest set of the last session", () => {
    const l = logs("s1", 100, [[null, 12], [null, 11], [null, 12]], "Pushups");
    expect(prog(l, { min: 10, max: 15 }, bw)).toEqual({ targetKg: null, targetReps: 12 });
  });

  it("caps at 15 reps and then suggests a harder variation", () => {
    const l = logs("s1", 100, [[null, 15], [null, 15]], "Pushups");
    expect(prog(l, { min: 10, max: 15 }, bw)).toEqual({ targetKg: null, targetReps: 15, hint: HARDER_VARIATION_HINT });
  });
});

describe("progressionFromHistory", () => {
  const session = (id: string, status: Session["status"]): Session => ({
    id, planId: "p", templateKey: "A", name: "A", exercises: [], adjustedForToday: false, notes: [], status, startedAt: 1, finishedAt: 2,
  });

  it("uses only completed sessions and only the requested exercise", () => {
    const history: History = {
      sessions: [session("s1", "completed"), session("s2", "completed"), session("s3", "abandoned"), session("s4", "in_progress")],
      setLogs: [
        ...logs("s1", 100, topSets(40)),
        ...logs("s2", 200, topSets(40)),
        ...logs("s3", 300, [[30, 3]]),
        ...logs("s4", 400, [[30, 3]]),
        ...logs("s1", 100, [[99, 1]], "Barbell_Squat"),
      ],
    };
    expect(progressionFromHistory("Barbell_Bench_Press_-_Medium_Grip", history, RANGE, "barbell")).toEqual({ targetKg: 42.5 });
  });
});

describe("nextSession attaches progression (WL-06)", () => {
  it("sets targetKg and hint from history; first time exercises get the first-time hint", () => {
    const profile: Profile = {
      trainingDays: ["mon", "wed", "fri"], sessionMinutes: 90, equipment: [...EQUIPMENT_IDS],
      goal: "build_muscle", level: "beginner", avoid: [], updatedAt: 1,
    };
    const plan: Plan = buildPlan(profile, EXERCISES, 3);
    const first = nextSession(plan, { sessions: [], setLogs: [] });
    for (const e of first.exercises) {
      const ex = EXERCISES.find((x) => x.id === e.exerciseId)!;
      if (ex.loadType === "bodyweight") expect(e.targetReps).toBeGreaterThan(0);
      else {
        expect(e.targetKg).toBeNull();
        expect(e.hint).toBe(FIRST_TIME_HINT);
      }
    }
    const target = first.exercises.find((e) => EXERCISES.find((x) => x.id === e.exerciseId)!.loadType !== "bodyweight")!;
    const ex = EXERCISES.find((x) => x.id === target.exerciseId)!;
    const rows = (sid: string, t: number) =>
      Array.from({ length: target.targetSets }, (_, i): SetLog => ({
        id: `${sid}${i}`, sessionId: sid, exerciseId: ex.id, setIndex: i, kg: 20, reps: target.repRange.max, rir: null, loggedAt: t + i,
      }));
    const mk = (id: string): Session => ({ id, planId: plan.id, templateKey: "A", name: "A", exercises: [], adjustedForToday: false, notes: [], status: "completed", startedAt: 1, finishedAt: 2 });
    const history: History = { sessions: [mk("a"), mk("b")], setLogs: [...rows("a", 10), ...rows("b", 20)] };
    const again = nextSession(plan, history).exercises.find((e) => e.exerciseId === ex.id)!;
    expect(again.targetKg).toBe(20 + (ex.loadType === "dumbbell" ? 2 : 2.5));
  });
});
