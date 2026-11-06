import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import {
  EQUIPMENT_IDS,
  type EquipmentId,
  type Exercise,
  type Plan,
  type Profile,
  type SplitId,
  type Weekday,
} from "../domain";
import { buildPlan } from "./buildPlan";

const DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

function profile(over: Partial<Profile> = {}): Profile {
  return {
    trainingDays: ["mon", "wed", "fri"],
    sessionMinutes: 60,
    equipment: [...EQUIPMENT_IDS],
    goal: "build_muscle",
    level: "intermediate",
    avoid: [],
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

function exercisesOf(plan: Plan): Exercise[] {
  return plan.templates.flatMap((t) => t.slots.map((s) => getExercise(s.exerciseId)!));
}

describe("buildPlan split by days (AC02, W10)", () => {
  const expected: Array<[number, SplitId, string[]]> = [
    [2, "fullbody_ab", ["Full body A", "Full body B"]],
    [3, "fullbody_abc", ["Full body A", "Full body B", "Full body C"]],
    [4, "upper_lower", ["Upper A", "Lower A", "Upper B", "Lower B"]],
    [5, "ppl_ul", ["Push", "Pull", "Legs", "Upper", "Lower"]],
    [6, "ppl_ppl", ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"]],
  ];
  for (const [days, split, names] of expected) {
    it(`${days} days -> ${split}`, () => {
      const plan = buildPlan(profile({ trainingDays: DAYS.slice(0, days) }), EXERCISES, 7);
      expect(plan.split).toBe(split);
      expect(plan.templates.map((t) => t.name)).toEqual(names);
      expect(plan.templates.map((t) => t.key)).toEqual(["A", "B", "C", "D", "E", "F"].slice(0, days));
      expect(plan.status).toBe("active");
      expect(plan.cursor).toBe(0);
      expect(plan.blockIndex).toBe(0);
      expect(plan.blockStartedAtCompletedCount).toBe(0);
      for (const t of plan.templates) expect(t.slots.length).toBeGreaterThanOrEqual(3);
    });
  }

  it("rejects fewer than 2 training days", () => {
    expect(() => buildPlan(profile({ trainingDays: ["mon"] }), EXERCISES, 1)).toThrow(/at least 2 days/);
  });

  it("rejects 7 days instead of clamping (W21, see sevenDays.test.ts)", () => {
    expect(() =>
      buildPlan(profile({ trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }), EXERCISES, 1),
    ).toThrow("Pick at most 6 days");
  });
});

describe("buildPlan equipment filter (AC03)", () => {
  it("Dumbbells + Bench: no barbell, machine or cable exercise", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = buildPlan(
        profile({ equipment: ["dumbbells", "adjustable_bench"], dumbbellRange: { min: 5, max: 20, step: 2.5 } }),
        EXERCISES,
        seed,
      );
      for (const e of exercisesOf(plan)) {
        expect(["barbell", "machine", "cable"], `${e.id} seed ${seed}`).not.toContain(e.loadType);
      }
    }
  });

  it("No equipment: only bodyweight exercises", () => {
    for (let days = 2; days <= 6; days++) {
      const plan = buildPlan(profile({ equipment: [], trainingDays: DAYS.slice(0, days) }), EXERCISES, 3);
      const list = exercisesOf(plan);
      expect(list.length).toBeGreaterThan(0);
      for (const e of list) expect(e.loadType, e.id).toBe("bodyweight");
    }
  });

  it("main slots prefer loaded exercises over bodyweight when both exist", () => {
    const plan = buildPlan(profile({ level: "beginner" }), EXERCISES, 5);
    for (const t of plan.templates)
      for (const s of t.slots)
        if (s.role === "main") expect(getExercise(s.exerciseId)!.loadType, s.exerciseId).not.toBe("bodyweight");
  });
});

describe("buildPlan avoid + missing options (AC05)", () => {
  it("avoid knee: no exercise flagged knee (jump squat etc.)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = buildPlan(profile({ avoid: ["knee"], level: "advanced" }), EXERCISES, seed);
      for (const e of exercisesOf(plan)) expect(e.avoidFlags, `${e.id} seed ${seed}`).not.toContain("knee");
    }
  });

  it("every avoid area is honoured", () => {
    for (const area of ["shoulder", "knee", "lower_back", "wrist"] as const) {
      const plan = buildPlan(profile({ avoid: [area] }), EXERCISES, 2);
      for (const e of exercisesOf(plan)) expect(e.avoidFlags).not.toContain(area);
    }
  });

  it("drops a slot with no candidate, records a note and does not crash", () => {
    const tiny = EXERCISES.filter((e) => e.pattern === "squat" || e.pattern === "core");
    const plan = buildPlan(profile({ equipment: [] }), tiny, 1);
    const all = plan.templates.flatMap((t) => t.slots);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.pattern === "squat" || s.pattern === "core")).toBe(true);
    const notes = plan.templates.flatMap((t) => t.notes);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/No exercise available/);
  });

  it("empty catalog gives templates with no slots and notes, not a crash", () => {
    const plan = buildPlan(profile(), [], 1);
    expect(plan.templates.every((t) => t.slots.length === 0)).toBe(true);
    expect(plan.templates.every((t) => t.notes.length > 0)).toBe(true);
  });
});

describe("buildPlan determinism + variety", () => {
  it("same input gives identical output", () => {
    const a = buildPlan(profile(), EXERCISES, 42);
    const b = buildPlan(profile(), EXERCISES, 42);
    expect(b).toEqual(a);
  });

  it("does not use Math.random", () => {
    const orig = Math.random;
    Math.random = () => {
      throw new Error("Math.random called");
    };
    try {
      expect(() => buildPlan(profile(), EXERCISES, 9)).not.toThrow();
    } finally {
      Math.random = orig;
    }
  });

  it("different seeds can give different plans", () => {
    const sigs = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      sigs.add(
        buildPlan(profile(), EXERCISES, seed)
          .templates.flatMap((t) => t.slots.map((s) => s.exerciseId))
          .join(","),
      );
    }
    expect(sigs.size).toBeGreaterThan(1);
  });

  it("accessories do not repeat across templates of a block when alternatives exist", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const plan = buildPlan(profile({ trainingDays: DAYS.slice(0, 4) }), EXERCISES, seed);
      const acc = plan.templates.flatMap((t) => t.slots.filter((s) => s.role === "accessory").map((s) => s.exerciseId));
      expect(new Set(acc).size, `seed ${seed}`).toBe(acc.length);
    }
  });

  it("never repeats an exercise inside one template", () => {
    const plan = buildPlan(profile(), EXERCISES, 11);
    for (const t of plan.templates) {
      const ids = t.slots.map((s) => s.exerciseId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("respects level: beginner never gets harder exercises", () => {
    const plan = buildPlan(profile({ level: "beginner" }), EXERCISES, 4);
    for (const e of exercisesOf(plan)) expect(e.level).toBe("beginner");
  });

  it("stores the profile snapshot and seed", () => {
    const p = profile();
    const plan = buildPlan(p, EXERCISES, 77);
    expect(plan.seed).toBe(77);
    expect(plan.profile).toEqual(p);
    expect(plan.createdAt).toBe(p.updatedAt);
  });

  it("equipment list passed as OR-of-AND: barbell without rack gives no squat rack lifts", () => {
    const eq: EquipmentId[] = ["barbell"];
    const plan = buildPlan(profile({ equipment: eq }), EXERCISES, 1);
    for (const e of exercisesOf(plan)) expect(e.id).not.toBe("Barbell_Squat");
  });
});
