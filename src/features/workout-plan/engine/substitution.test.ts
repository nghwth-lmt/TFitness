import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, type EquipmentId, type Exercise, type History, type Profile, type SessionDraft, type SetLog, type Session } from "../domain";
import { isDoable } from "./availability";
import { buildPlan } from "./buildPlan";
import { FIRST_TIME_HINT } from "./progression";
import { nextSession } from "./schedule";
import { adjustForToday, applySwap, swapCandidates } from "./substitution";

const EMPTY: History = { sessions: [], setLogs: [] };
const FULL: EquipmentId[] = [...EQUIPMENT_IDS];

function profile(over: Partial<Profile> = {}): Profile {
  return {
    trainingDays: ["mon", "wed", "fri"],
    sessionMinutes: 90,
    equipment: FULL,
    goal: "build_muscle",
    level: "intermediate",
    avoid: [],
    updatedAt: 1,
    ...over,
  };
}

const ex = (id: string): Exercise => getExercise(id)!;
const isBench = (id: string) => id === "adjustable_bench" || id === "flat_bench";
const needsBench = (id: string) => ex(id).equipment.every((and) => and.some(isBench));

/** A draft whose exercises are exactly `ids`, on a plan for `p`. */
function draftOf(ids: string[], p: Profile = profile()): SessionDraft {
  const plan = buildPlan(p, EXERCISES, 1);
  const base = nextSession(plan, EMPTY);
  return {
    ...base,
    exercises: ids.map((id, i) => ({
      exerciseId: id,
      slot: i < 2 ? `main-${i + 1}` : `acc-${i - 1}`,
      role: i < 2 ? ("main" as const) : ("accessory" as const),
      targetSets: 3,
      repRange: { min: 8, max: 12 },
      targetKg: null,
      restSec: 90,
    })),
  };
}

describe("adjustForToday (AC10, W05)", () => {
  const gym = FULL;
  const noBench = FULL.filter((e) => !isBench(e));

  it("replaces every bench exercise with one of the same pattern and leaves the rest alone", () => {
    const d = draftOf(["Barbell_Bench_Press_-_Medium_Grip", "Barbell_Squat", "Incline_Dumbbell_Press", "Side_Lateral_Raise"]);
    const out = adjustForToday(d, noBench, EXERCISES, profile());
    expect(out.adjustedForToday).toBe(true);
    expect(out.todayEquipment).toEqual(noBench);
    expect(out.exercises).toHaveLength(4);
    d.exercises.forEach((orig, i) => {
      const now = out.exercises[i];
      expect(isDoable(ex(now.exerciseId), noBench), now.exerciseId).toBe(true);
      if (needsBench(orig.exerciseId)) {
        expect(now.exerciseId).not.toBe(orig.exerciseId);
        expect(ex(now.exerciseId).pattern).toBe(ex(orig.exerciseId).pattern);
        expect(now.slot).toBe(orig.slot);
        expect(now.targetSets).toBe(orig.targetSets);
        expect(now.repRange).toEqual(orig.repRange);
        expect(now.restSec).toBe(orig.restSec);
      } else {
        expect(now).toEqual(orig);
      }
    });
  });

  it("does not touch the original draft or the plan: the next session still has bench lifts (AC10)", () => {
    const p = profile({ equipment: ["barbell", "squat_rack", "dumbbells", "adjustable_bench"] });
    const plan = buildPlan(p, EXERCISES, 2);
    const original = nextSession(plan, EMPTY);
    const snapDraft = JSON.stringify(original);
    const snapPlan = JSON.stringify(plan);
    adjustForToday(original, ["barbell", "squat_rack", "dumbbells"], EXERCISES, p);
    expect(JSON.stringify(original)).toBe(snapDraft);
    expect(JSON.stringify(plan)).toBe(snapPlan);
    expect(nextSession(plan, EMPTY)).toEqual(original);
  });

  it("changes nothing when today's equipment covers the draft", () => {
    const d = draftOf(["Barbell_Bench_Press_-_Medium_Grip", "Barbell_Squat", "Dumbbell_Bicep_Curl"]);
    const out = adjustForToday(d, gym, EXERCISES, profile());
    expect(out.exercises).toEqual(d.exercises);
    expect(out.adjustedForToday).toBe(false);
  });

  it("re-ticking equipment restores the original lifts (recomputed from the original draft)", () => {
    const d = draftOf(["Barbell_Bench_Press_-_Medium_Grip", "Barbell_Squat", "Dumbbell_Bicep_Curl"]);
    const less = adjustForToday(d, noBench, EXERCISES, profile());
    expect(less.exercises[0].exerciseId).not.toBe("Barbell_Bench_Press_-_Medium_Grip");
    expect(adjustForToday(d, gym, EXERCISES, profile()).exercises).toEqual(d.exercises);
  });

  it("drops a slot with a note when nothing can replace it, and does not crash", () => {
    const d = draftOf(["Barbell_Squat", "Barbell_Bench_Press_-_Medium_Grip", "Dumbbell_Bicep_Curl"]);
    const tiny = EXERCISES.filter((e) => e.id === "Barbell_Squat" || e.id === "Barbell_Bench_Press_-_Medium_Grip" || e.id === "Dumbbell_Bicep_Curl");
    const out = adjustForToday(d, ["dumbbells"], tiny, profile());
    expect(out.exercises.map((e) => e.exerciseId)).toEqual(["Dumbbell_Bicep_Curl"]);
    expect(out.notes.join(" ")).toMatch(/No substitute/);
    expect(out.adjustedForToday).toBe(true);
  });

  it("respects avoid areas and level when choosing a substitute", () => {
    const p = profile({ avoid: ["knee", "shoulder"], level: "beginner", equipment: ["dumbbells", "adjustable_bench"] });
    const d = draftOf(["Dumbbell_Squat", "Dumbbell_Bench_Press"], p);
    const out = adjustForToday(d, [], EXERCISES, p);
    for (const e of out.exercises) {
      const x = ex(e.exerciseId);
      expect(x.avoidFlags).not.toContain("knee");
      expect(x.avoidFlags).not.toContain("shoulder");
      expect(x.level).toBe("beginner");
      expect(x.loadType).toBe("bodyweight");
    }
  });

  it("never picks an exercise already in the session", () => {
    const d = draftOf(["Barbell_Bench_Press_-_Medium_Grip", "Dumbbell_Bench_Press", "Incline_Dumbbell_Press"]);
    const out = adjustForToday(d, noBench, EXERCISES, profile());
    const ids = out.exercises.map((e) => e.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic and does not use Math.random", () => {
    const d = draftOf(["Barbell_Bench_Press_-_Medium_Grip", "Barbell_Squat", "Incline_Dumbbell_Press"]);
    const orig = Math.random;
    Math.random = () => {
      throw new Error("Math.random called");
    };
    try {
      const a = adjustForToday(d, noBench, EXERCISES, profile());
      expect(adjustForToday(d, noBench, EXERCISES, profile())).toEqual(a);
    } finally {
      Math.random = orig;
    }
  });

  it("gives the substitute its own weight from history, or the first-time hint", () => {
    const d = draftOf(["Barbell_Bench_Press_-_Medium_Grip", "Barbell_Squat", "Dumbbell_Bicep_Curl"]);
    const first = adjustForToday(d, noBench, EXERCISES, profile());
    const sub = first.exercises[0].exerciseId;
    expect(first.exercises[0].hint).toBe(FIRST_TIME_HINT);
    const mk = (id: string): Session => ({ id, planId: "p", templateKey: "A", name: "A", exercises: [], adjustedForToday: false, notes: [], status: "completed", startedAt: 1, finishedAt: 2 });
    const row = (sid: string, t: number, i: number): SetLog => ({ id: `${sid}${i}`, sessionId: sid, exerciseId: sub, setIndex: i, kg: 30, reps: 5, rir: null, loggedAt: t + i });
    const history: History = { sessions: [mk("a")], setLogs: [row("a", 10, 0), row("a", 10, 1)] };
    const again = adjustForToday(d, noBench, EXERCISES, profile(), history);
    expect(again.exercises[0].targetKg).toBe(30);
  });
});

describe("swapCandidates and applySwap (AC11)", () => {
  const p = profile({ equipment: ["dumbbells", "adjustable_bench"] });

  it("lists only same-pattern, doable, allowed exercises that are not already in the session", () => {
    const d = draftOf(["Dumbbell_Bench_Press", "Dumbbell_Squat", "Incline_Dumbbell_Press"], p);
    const list = swapCandidates(d, "Dumbbell_Bench_Press", EXERCISES, p);
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      expect(c.pattern).toBe("horizontal_push");
      expect(isDoable(c, p.equipment)).toBe(true);
      expect(c.id).not.toBe("Dumbbell_Bench_Press");
      expect(c.id).not.toBe("Incline_Dumbbell_Press");
      expect(c.role).not.toBe("accessory");
    }
  });

  it("uses today's equipment when the session was adjusted", () => {
    const d = { ...draftOf(["Dumbbell_Bench_Press", "Dumbbell_Squat", "Dumbbell_Bicep_Curl"], p), todayEquipment: [] as EquipmentId[] };
    for (const c of swapCandidates(d, "Dumbbell_Bench_Press", EXERCISES, p)) expect(c.loadType).toBe("bodyweight");
  });

  it("honours avoid and level", () => {
    const strict = profile({ equipment: FULL, avoid: ["shoulder"], level: "beginner" });
    const d = draftOf(["Leverage_Chest_Press", "Dumbbell_Squat", "Dumbbell_Bicep_Curl"], strict);
    for (const c of swapCandidates(d, "Leverage_Chest_Press", EXERCISES, strict)) {
      expect(c.avoidFlags).not.toContain("shoulder");
      expect(c.level).toBe("beginner");
    }
  });

  it("returns an empty list (not an error) when nothing fits", () => {
    const d = draftOf(["Barbell_Squat", "Barbell_Bench_Press_-_Medium_Grip", "Dumbbell_Bicep_Curl"]);
    expect(swapCandidates(d, "Barbell_Squat", EXERCISES.filter((e) => e.id === "Barbell_Squat"), profile())).toEqual([]);
  });

  it("applySwap replaces only the chosen exercise and keeps the others as they are", () => {
    const d = draftOf(["Dumbbell_Bench_Press", "Dumbbell_Squat", "Incline_Dumbbell_Press"], p);
    const pick = swapCandidates(d, "Dumbbell_Bench_Press", EXERCISES, p)[0];
    const out = applySwap(d, "main-1", pick.id, EXERCISES, p, EMPTY);
    expect(out.exercises[0].exerciseId).toBe(pick.id);
    expect(out.exercises[0].slot).toBe("main-1");
    expect(out.exercises[0].targetSets).toBe(d.exercises[0].targetSets);
    expect(out.exercises.slice(1)).toEqual(d.exercises.slice(1));
    expect(d.exercises[0].exerciseId).toBe("Dumbbell_Bench_Press");
  });

  it("applySwap refuses an exercise that is not a valid candidate", () => {
    const d = draftOf(["Dumbbell_Bench_Press", "Dumbbell_Squat", "Incline_Dumbbell_Press"], p);
    expect(() => applySwap(d, "main-1", "Barbell_Squat", EXERCISES, p, EMPTY)).toThrow(/not a valid swap/);
    expect(() => applySwap(d, "nope", "Pushups", EXERCISES, p, EMPTY)).toThrow(/Unknown slot/);
  });
});
