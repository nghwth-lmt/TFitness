import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Exercise } from "../domain";
import { getExerciseDetails } from "../view-models/exerciseInfo";
import { MUSCLEWIKI_EQUIPMENT_SLUGS, MUSCLEWIKI_MUSCLE_SLUGS, MUSCLEWIKI_SLUGS, musclewikiUrl } from "./musclewiki";

const ex = (over: Partial<Pick<Exercise, "id" | "primaryMuscles" | "equipment">>) => ({ id: "X", primaryMuscles: [] as string[], equipment: [[]] as Exercise["equipment"], ...over });
const HOME = "https://musclewiki.com";

describe("musclewikiUrl (W45, AC30)", () => {
  it("starts with exactly one verified slug", () => {
    expect(MUSCLEWIKI_SLUGS).toEqual({ Dumbbell_Bench_Press: "dumbbell-bench-press" });
  });

  it("an exercise with a verified slug opens its own page", () => {
    expect(musclewikiUrl(ex({ id: "Dumbbell_Bench_Press", primaryMuscles: ["chest"], equipment: [["dumbbells", "flat_bench"]] }))).toBe(`${HOME}/exercise/dumbbell-bench-press`);
  });

  it("without a slug it opens the muscle + equipment page", () => {
    expect(musclewikiUrl(ex({ primaryMuscles: ["chest"], equipment: [["barbell", "flat_bench"]] }))).toBe(`${HOME}/exercises/chest/barbell`);
    expect(musclewikiUrl(ex({ primaryMuscles: ["quadriceps"], equipment: [["dumbbells"]] }))).toBe(`${HOME}/exercises/quads/dumbbells`);
  });

  it("bodyweight (no equipment) maps to bodyweight", () => {
    expect(musclewikiUrl(ex({ primaryMuscles: ["abdominals"], equipment: [[]] }))).toBe(`${HOME}/exercises/abdominals/bodyweight`);
  });

  it("supporting items (bench, rack, plates) are skipped when picking the equipment slug", () => {
    expect(musclewikiUrl(ex({ primaryMuscles: ["chest"], equipment: [["flat_bench", "smith_machine"]] }))).toBe(`${HOME}/exercises/chest/smith-machine`);
  });

  it("equipment with no map falls back to the muscle page", () => {
    expect(musclewikiUrl(ex({ primaryMuscles: ["chest"], equipment: [["flat_bench"]] }))).toBe(`${HOME}/exercises/chest`);
  });

  it("a muscle with no map falls back to the home page", () => {
    expect(musclewikiUrl(ex({ primaryMuscles: ["neck"], equipment: [["barbell"]] }))).toBe(HOME);
    expect(musclewikiUrl(ex({ primaryMuscles: [], equipment: [["barbell"]] }))).toBe(HOME);
  });

  it("uses the first primary muscle that has a map", () => {
    expect(musclewikiUrl(ex({ primaryMuscles: ["neck", "lats"], equipment: [["barbell"]] }))).toBe(`${HOME}/exercises/lats/barbell`);
  });

  it("an unknown exercise (undefined) gives the home page", () => {
    expect(musclewikiUrl(undefined)).toBe(HOME);
  });

  it("the muscle table covers the 14 MuscleWiki groups and maps catalog names", () => {
    expect([...new Set(Object.values(MUSCLEWIKI_MUSCLE_SLUGS))].sort()).toEqual(
      ["abdominals", "biceps", "calves", "chest", "forearms", "glutes", "hamstrings", "lats", "lower-back", "obliques", "quads", "shoulders", "traps", "triceps"],
    );
    expect(MUSCLEWIKI_MUSCLE_SLUGS.quadriceps).toBe("quads");
    expect(MUSCLEWIKI_MUSCLE_SLUGS["lower back"]).toBe("lower-back");
  });

  it("the equipment table only uses known equipment ids and covers the main slugs", () => {
    for (const id of Object.keys(MUSCLEWIKI_EQUIPMENT_SLUGS)) expect(EQUIPMENT_IDS as readonly string[]).toContain(id);
    const slugs = new Set(Object.values(MUSCLEWIKI_EQUIPMENT_SLUGS));
    for (const s of ["barbell", "dumbbells", "kettlebells", "cables", "machine", "band", "smith-machine"]) expect(slugs).toContain(s);
  });

  it("every catalog exercise gets a musclewiki.com URL with no query, no spaces", () => {
    for (const e of EXERCISES) {
      const url = musclewikiUrl(e);
      expect(url, e.id).toMatch(/^https:\/\/musclewiki\.com(\/exercises?(\/[a-z-]+){1,2})?$/);
    }
  });

  it("every verified slug belongs to a catalog exercise", () => {
    for (const id of Object.keys(MUSCLEWIKI_SLUGS)) expect(EXERCISES.some((e) => e.id === id), id).toBe(true);
  });

  it("getExerciseDetails carries musclewikiUrl", () => {
    expect(getExerciseDetails("Dumbbell_Bench_Press")!.musclewikiUrl).toBe(`${HOME}/exercise/dumbbell-bench-press`);
    const other = EXERCISES.find((e) => e.id !== "Dumbbell_Bench_Press")!;
    expect(getExerciseDetails(other.id)!.musclewikiUrl).toBe(musclewikiUrl(other));
  });

  it("makes no network call: the module has no fetch, XMLHttpRequest, sendBeacon or import of http", () => {
    const src = readFileSync(new URL("./musclewiki.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|node:https?|WebSocket/);
  });
});
