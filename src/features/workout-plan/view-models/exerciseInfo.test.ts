import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, EQUIPMENT_LABELS, WEEKDAYS, type Plan, type Profile } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { getExerciseDetails } from "./exerciseInfo";
import { initPlayer, toPlayerExercise } from "./player";
import { buildTodayVM } from "./today";

const profile = (): Profile => ({
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 60,
  equipment: [...EQUIPMENT_IDS],
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
});

describe("equipment labels", () => {
  it("every equipment id has a readable label", () => {
    for (const id of EQUIPMENT_IDS) expect(EQUIPMENT_LABELS[id], id).toMatch(/\w/);
    expect(Object.keys(EQUIPMENT_LABELS).sort()).toEqual([...EQUIPMENT_IDS].sort());
  });
});

describe("getExerciseDetails (D4, AC18 data)", () => {
  it("returns images, instructions, muscles and the equipment needed", () => {
    const ex = getExercise("Barbell_Bench_Press_-_Medium_Grip")!;
    const d = getExerciseDetails(ex.id)!;
    expect(d.name).toBe(ex.name);
    expect(d.images).toEqual(ex.images);
    expect(d.thumbnail).toBe(ex.images[0]);
    expect(d.instructions).toEqual(ex.instructions);
    expect(d.primaryMuscles).toEqual(ex.primaryMuscles);
    expect(d.secondaryMuscles).toEqual(ex.secondaryMuscles);
    expect(d.cue).toBe(ex.cue);
    expect(d.equipment).toEqual([
      [{ id: "barbell", label: EQUIPMENT_LABELS.barbell }, { id: "flat_bench", label: EQUIPMENT_LABELS.flat_bench }],
      [{ id: "barbell", label: EQUIPMENT_LABELS.barbell }, { id: "adjustable_bench", label: EQUIPMENT_LABELS.adjustable_bench }],
    ]);
  });

  it("an exercise with no equipment has one empty alternative", () => {
    expect(getExerciseDetails("Pushups")!.equipment).toEqual([[]]);
  });

  it("returns undefined for an id the catalog does not know", () => {
    expect(getExerciseDetails("back_squat")).toBeUndefined();
  });

  it("is a copy: changing the result never changes the catalog", () => {
    const d = getExerciseDetails("Pushups")!;
    d.instructions.push("x");
    d.images.length = 0;
    expect(getExercise("Pushups")!.instructions).not.toContain("x");
    expect(getExercise("Pushups")!.images).toHaveLength(2);
  });
});

describe("Today rows carry a thumbnail (AC18)", () => {
  it("every row has the first frame as thumbnail and both frames", () => {
    const plan: Plan = buildPlan(profile(), EXERCISES, 3);
    const vm = buildTodayVM({ profile: profile(), plan, sessions: [], setLogs: [], now: Date.UTC(2026, 10, 9, 5), utcOffsetMin: 0 });
    if (vm.kind !== "next") throw new Error("expected next");
    expect(vm.exercises.length).toBeGreaterThan(2);
    for (const row of vm.exercises) {
      const ex = getExercise(row.exerciseId)!;
      expect(row.thumbnail).toBe(ex.images[0]);
      expect(row.images).toEqual(ex.images);
    }
  });

  it("a row for an unknown exercise has no thumbnail and no crash", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    const bad: Plan = { ...plan, templates: plan.templates.map((t) => ({ ...t, slots: t.slots.map((s, i) => (i === 0 ? { ...s, exerciseId: "gone" } : s)) })) };
    const vm = buildTodayVM({ profile: profile(), plan: bad, sessions: [], setLogs: [], now: Date.UTC(2026, 10, 9, 5), utcOffsetMin: 0 });
    if (vm.kind !== "next") throw new Error("expected next");
    expect(vm.exercises[0].thumbnail).toBe("");
    expect(vm.exercises[0].images).toEqual([]);
  });
});

describe("Player exercises carry the detail data (AC18)", () => {
  it("toPlayerExercise and initPlayer expose images, instructions and muscles", () => {
    const ex = getExercise("Dumbbell_Squat")!;
    const e = { exerciseId: ex.id, slot: "main-1", role: "main" as const, targetSets: 3, repRange: { min: 6, max: 10 }, targetKg: 16, restSec: 120 };
    const p = toPlayerExercise(e, EXERCISES);
    expect(p.images).toEqual(ex.images);
    expect(p.instructions).toEqual(ex.instructions);
    expect(p.primaryMuscles).toEqual(ex.primaryMuscles);
    expect(p.secondaryMuscles).toEqual(ex.secondaryMuscles);
    expect(p.equipment).toEqual([[{ id: "dumbbells", label: EQUIPMENT_LABELS.dumbbells }]]);
    const state = initPlayer({ session: { id: "s", exercises: [e] }, logs: [], catalog: EXERCISES });
    expect(state.exercises[0].images).toEqual(ex.images);
  });

  it("an unknown exercise gets empty detail arrays", () => {
    const p = toPlayerExercise({ exerciseId: "gone", slot: "a", role: "main", targetSets: 1, repRange: { min: 1, max: 2 }, targetKg: null, restSec: 60 }, EXERCISES);
    expect(p.images).toEqual([]);
    expect(p.instructions).toEqual([]);
    expect(p.equipment).toEqual([]);
  });
});

void WEEKDAYS;
