import { describe, expect, it } from "vitest";
import {
  BODY_AREAS,
  EQUIPMENT_IDS,
  GOALS,
  LEVELS,
  LOAD_TYPES,
  PATTERNS,
  SESSION_MINUTES,
  SPLIT_IDS,
  WEEKDAYS,
  type Exercise,
  type Plan,
  type Profile,
  type SessionDraft,
  type SessionTemplate,
  type SetLog,
} from "./index";

describe("domain contract", () => {
  it("weeks start on Monday (W20)", () => {
    expect(WEEKDAYS[0]).toBe("mon");
    expect(WEEKDAYS).toHaveLength(7);
  });

  it("exports the closed vocabularies from the PRD", () => {
    expect(SESSION_MINUTES).toEqual([30, 45, 60, 75, 90]);
    expect(GOALS).toEqual(["build_muscle", "get_stronger", "lose_fat", "general_fitness"]);
    expect(LEVELS).toEqual(["beginner", "intermediate", "advanced"]);
    expect(BODY_AREAS).toEqual(["shoulder", "knee", "lower_back", "wrist"]);
    expect(PATTERNS).toHaveLength(11);
    expect(LOAD_TYPES).toContain("bodyweight");
    expect(EQUIPMENT_IDS.length).toBeGreaterThan(0);
    expect(SPLIT_IDS).toHaveLength(5);
  });

  it("lets typed fixtures compile (checked by tsc)", () => {
    const profile: Profile = {
      trainingDays: ["mon", "wed", "fri"],
      sessionMinutes: 45,
      equipment: ["dumbbells", "adjustable_bench"],
      dumbbellRange: { min: 5, max: 20, step: 2.5 },
      goal: "build_muscle",
      level: "beginner",
      avoid: [],
      updatedAt: 0,
    };
    const exercise: Exercise = {
      id: "x",
      name: "X",
      pattern: "squat",
      role: "both",
      equipment: [[]],
      muscles: ["quads"],
      level: "beginner",
      avoidFlags: [],
      loadType: "bodyweight",
      cue: "c",
      images: ["/exercises/x/0.webp", "/exercises/x/1.webp"],
      instructions: ["Do it."],
      primaryMuscles: ["quadriceps"],
      secondaryMuscles: [],
    };
    const template: SessionTemplate = { key: "A", name: "Full body A", slots: [], notes: [] };
    const plan: Plan = {
      id: "p",
      status: "active",
      split: "fullbody_abc",
      profile,
      templates: [template],
      blockIndex: 0,
      blockStartedAtCompletedCount: 0,
      cursor: 0,
      seed: 1,
      createdAt: 0,
    };
    const draft: SessionDraft = {
      planId: plan.id,
      templateKey: "A",
      name: "Full body A",
      exercises: [],
      adjustedForToday: false,
      notes: [],
    };
    const log: SetLog = {
      id: "l",
      sessionId: "s",
      exerciseId: exercise.id,
      setIndex: 0,
      kg: null,
      reps: 8,
      rir: null,
      loggedAt: 0,
    };
    expect(draft.exercises).toEqual([]);
    expect(log.rir).toBeNull();
  });
});
