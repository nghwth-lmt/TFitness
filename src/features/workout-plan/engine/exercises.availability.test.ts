import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, EQUIPMENT_PRESETS, LEVELS, PATTERNS, type EquipmentId, type Pattern } from "../domain";
import { availableExercises, isDoable, levelAtMost } from "./availability";

const NO_EQUIPMENT: EquipmentId[] = [];
const DB_BENCH: EquipmentId[] = EQUIPMENT_PRESETS.home.equipment;
const FULL_GYM: EquipmentId[] = [...EQUIPMENT_IDS];
const SETS: Array<[string, EquipmentId[]]> = [
  ["No equipment", NO_EQUIPMENT],
  ["Home preset", DB_BENCH],
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
  it("has unique ids and a cue each (size and images are covered by data/catalog.test.ts)", () => {
    expect(EXERCISES.length).toBeGreaterThan(0);
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
    expect(isDoable({ ...base, equipment: [["barbell", "squat_rack"]] }, ["barbell"])).toBe(false);
    expect(isDoable({ ...base, equipment: [["barbell", "squat_rack"]] }, ["barbell", "squat_rack"])).toBe(true);
    expect(isDoable({ ...base, equipment: [["cable_station"], ["leg_press"]] }, ["leg_press"])).toBe(true);
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
  // The imported catalog (WL-12) has no bodyweight-only calves, side delts or vertical pull, so the
  // bodyweight set lists what is really missing. The engine drops such slots with a note (AC05).
  const BODYWEIGHT_MISSING: Pattern[] = ["vertical_pull", "calves", "side_delt"];
  for (const [label, equipment] of SETS) {
    const missingAllowed = label === "No equipment" ? BODYWEIGHT_MISSING : [];
    it(`${label}: every pattern has an exercise${missingAllowed.length ? ` except ${missingAllowed.join(", ")}` : ""}`, () => {
      const missing = PATTERNS.filter((p) => availableExercises(EXERCISES, equipment).every((e) => e.pattern !== p));
      expect(missing.sort()).toEqual([...missingAllowed].sort());
    });

    it(`${label}: main patterns have a main-capable exercise${label === "No equipment" ? " (bodyweight 'both' counts)" : ""}`, () => {
      const missing = MAIN_PATTERNS.filter(
        (p) => availableExercises(EXERCISES, equipment).filter((e) => e.pattern === p && e.role !== "accessory").length === 0,
      );
      expect(missing).toEqual(label === "No equipment" ? ["vertical_pull"] : []);
    });
  }

  it("beginners on Full gym and Home preset keep a main-capable exercise per main pattern", () => {
    for (const equipment of [DB_BENCH, FULL_GYM]) {
      const pool = availableExercises(EXERCISES, equipment).filter((e) => levelAtMost(e.level, "beginner"));
      for (const pattern of MAIN_PATTERNS) {
        expect(pool.filter((e) => e.pattern === pattern && e.role !== "accessory").length, `beginner ${pattern}`).toBeGreaterThan(0);
      }
    }
  });

  it("levelAtMost orders levels", () => {
    expect(LEVELS.every((l) => levelAtMost("beginner", l))).toBe(true);
    expect(levelAtMost("advanced", "beginner")).toBe(false);
    expect(levelAtMost("intermediate", "intermediate")).toBe(true);
  });
});
