import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, LEVELS, PATTERNS, type EquipmentId, type Pattern } from "../domain";
import { availableExercises, isDoable, levelAtMost } from "./availability";

const NO_EQUIPMENT: EquipmentId[] = [];
const DB_BENCH: EquipmentId[] = ["dumbbells", "bench"];
const FULL_GYM: EquipmentId[] = [...EQUIPMENT_IDS];
const SETS: Array<[string, EquipmentId[]]> = [
  ["No equipment", NO_EQUIPMENT],
  ["Dumbbells+Bench", DB_BENCH],
  ["Full gym", FULL_GYM],
];
const MAIN_PATTERNS: Pattern[] = [
  "squat",
  "hinge",
  "horizontal_push",
  "horizontal_pull",
  "vertical_push",
  "vertical_pull",
  "single_leg",
];

describe("catalog shape", () => {
  it("has about 60 exercises with unique ids and a cue each", () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(58);
    expect(EXERCISES.length).toBeLessThanOrEqual(72);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(e.cue.length, e.id).toBeGreaterThan(5);
      expect(e.equipment.length, e.id).toBeGreaterThan(0);
      expect(e.muscles.length, e.id).toBeGreaterThan(0);
    }
  });

  it("uses only known equipment ids", () => {
    for (const e of EXERCISES) for (const and of e.equipment) for (const id of and) expect(EQUIPMENT_IDS).toContain(id);
  });
});

describe("isDoable (AC03)", () => {
  it("treats [[]] as no equipment and OR-of-AND correctly", () => {
    const base = EXERCISES[0];
    expect(isDoable({ ...base, equipment: [[]] }, [])).toBe(true);
    expect(isDoable({ ...base, equipment: [["barbell", "rack"]] }, ["barbell"])).toBe(false);
    expect(isDoable({ ...base, equipment: [["barbell", "rack"]] }, ["barbell", "rack"])).toBe(true);
    expect(isDoable({ ...base, equipment: [["cable"], ["machines"]] }, ["machines"])).toBe(true);
  });

  it("Dumbbells 5-20kg + Bench never yields barbell, machine or cable work", () => {
    const list = availableExercises(EXERCISES, DB_BENCH);
    expect(list.length).toBeGreaterThan(20);
    for (const e of list) {
      expect(["barbell", "machine", "cable"], e.id).not.toContain(e.loadType);
    }
  });

  it("No equipment yields only bodyweight load type", () => {
    const list = availableExercises(EXERCISES, NO_EQUIPMENT);
    expect(list.length).toBeGreaterThan(10);
    for (const e of list) expect(e.loadType, e.id).toBe("bodyweight");
  });
});

describe("coverage (AC03, AC05)", () => {
  for (const [label, equipment] of SETS) {
    it(`${label}: every pattern has an exercise, main patterns have a main-capable one`, () => {
      for (const pattern of PATTERNS) {
        const list = availableExercises(EXERCISES, equipment).filter((e) => e.pattern === pattern);
        expect(list.length, `${label} / ${pattern}`).toBeGreaterThan(0);
      }
      for (const pattern of MAIN_PATTERNS) {
        const list = availableExercises(EXERCISES, equipment).filter(
          (e) => e.pattern === pattern && e.role !== "accessory",
        );
        expect(list.length, `${label} / main ${pattern}`).toBeGreaterThan(0);
      }
    });

    it(`${label}: beginners still have a main-capable exercise per main pattern`, () => {
      const pool = availableExercises(EXERCISES, equipment).filter((e) => levelAtMost(e.level, "beginner"));
      for (const pattern of MAIN_PATTERNS) {
        expect(
          pool.filter((e) => e.pattern === pattern && e.role !== "accessory").length,
          `${label} / beginner ${pattern}`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it("flags knee on jump squat (AC05)", () => {
    const jump = EXERCISES.find((e) => e.id === "jump_squat");
    expect(jump?.avoidFlags).toContain("knee");
  });

  it("levelAtMost orders levels", () => {
    expect(LEVELS.every((l) => levelAtMost("beginner", l))).toBe(true);
    expect(levelAtMost("advanced", "beginner")).toBe(false);
    expect(levelAtMost("intermediate", "intermediate")).toBe(true);
  });
});
