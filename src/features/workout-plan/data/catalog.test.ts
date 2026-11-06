import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDoable } from "../engine/availability";
import { EQUIPMENT_IDS, EQUIPMENT_PRESETS, LEVELS, MUSCLES, PATTERNS, type Pattern } from "../domain";
import { EXERCISES, getExercise } from "./exercises";

const publicDir = path.resolve(__dirname, "../../../../public");
const MAIN: Pattern[] = ["squat", "hinge", "horizontal_push", "horizontal_pull", "vertical_push", "vertical_pull"];

describe("catalog shape (W30)", () => {
  it("is the imported catalog: 200 to 300 exercises, unique ids, valid vocabulary", () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(200);
    expect(EXERCISES.length).toBeLessThanOrEqual(300);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(PATTERNS, e.id).toContain(e.pattern);
      expect(LEVELS, e.id).toContain(e.level);
      expect(e.muscles.length, e.id).toBeGreaterThan(0);
      for (const m of e.muscles) expect(MUSCLES, e.id).toContain(m);
      expect(e.cue.length, e.id).toBeGreaterThan(5);
      expect(e.cue.length, e.id).toBeLessThanOrEqual(90);
      expect(e.instructions.length, e.id).toBeGreaterThan(0);
      expect(e.primaryMuscles.length, e.id).toBeGreaterThan(0);
      expect(e.equipment.length, e.id).toBeGreaterThan(0);
      for (const and of e.equipment) for (const id of and) expect(EQUIPMENT_IDS, e.id).toContain(id);
    }
  });

  it("has a readable cue that is a whole sentence", () => {
    for (const e of EXERCISES) expect(e.cue, e.id).toMatch(/[.!?]$/);
  });

  it("getExercise finds by the source id", () => {
    expect(getExercise("Pushups")?.name).toBe("Push-up") // W36: standard name, id unchanged;
    expect(getExercise("does-not-exist")).toBeUndefined();
  });
});

describe("AC16: every exercise has two image frames on disk", () => {
  it("lists /exercises/<id>/0.webp and 1.webp and both files exist", () => {
    for (const e of EXERCISES) {
      expect(e.images, e.id).toEqual([`/exercises/${e.id}/0.webp`, `/exercises/${e.id}/1.webp`]);
      for (const img of e.images) expect(fs.existsSync(path.join(publicDir, img)), `${e.id} ${img}`).toBe(true);
    }
  });

  it("has no image folder without a catalog entry", () => {
    const ids = new Set(EXERCISES.map((e) => e.id));
    for (const dir of fs.readdirSync(path.join(publicDir, "exercises"))) expect(ids.has(dir), dir).toBe(true);
  });

  it("keeps the images within the 15 MB budget", () => {
    let bytes = 0;
    for (const e of EXERCISES) for (const img of e.images) bytes += fs.statSync(path.join(publicDir, img)).size;
    expect(bytes).toBeLessThanOrEqual(15 * 1024 * 1024);
  });
});

describe("AC19: coverage", () => {
  it("every equipment item is used by at least one exercise", () => {
    for (const id of EQUIPMENT_IDS) {
      expect(EXERCISES.some((e) => e.equipment.some((and) => and.includes(id))), id).toBe(true);
    }
  });

  it("Full gym and Home cover all six main patterns", () => {
    for (const key of ["full_gym", "home"] as const) {
      for (const p of MAIN) {
        const n = EXERCISES.filter((e) => e.pattern === p && isDoable(e, EQUIPMENT_PRESETS[key].equipment)).length;
        expect(n, `${key} / ${p}`).toBeGreaterThan(0);
      }
    }
  });

  // Open question in HANDOFF: the source has no vertical pull that needs no equipment (pull-ups need a bar).
  const BODYWEIGHT_KNOWN_GAPS: Pattern[] = ["vertical_pull"];
  it("Bodyweight only covers the main patterns except the one known gap", () => {
    const missing = MAIN.filter((p) => !EXERCISES.some((e) => e.pattern === p && isDoable(e, EQUIPMENT_PRESETS.bodyweight.equipment)));
    expect(missing).toEqual(BODYWEIGHT_KNOWN_GAPS);
  });

  it("Home never yields barbell, machine or cable work", () => {
    for (const e of EXERCISES.filter((x) => isDoable(x, EQUIPMENT_PRESETS.home.equipment))) {
      expect(["barbell", "machine", "cable"], e.id).not.toContain(e.loadType);
    }
  });

  it("a main-capable exercise exists per main pattern for Full gym", () => {
    for (const p of MAIN) {
      expect(EXERCISES.some((e) => e.pattern === p && e.role !== "accessory"), p).toBe(true);
    }
  });
});

describe("flags (AC05)", () => {
  it("jumping and lunging movements carry the knee flag", () => {
    const moves = EXERCISES.filter((e) => /lunge|step[- ]?up|pistol|split squat|jump/i.test(e.name));
    expect(moves.length).toBeGreaterThan(5);
    for (const e of moves) expect(e.avoidFlags, e.id).toContain("knee");
  });
  it("behind-the-neck presses carry the shoulder flag", () => {
    for (const e of EXERCISES.filter((x) => /behind the neck|behind neck/i.test(x.name))) expect(e.avoidFlags, e.id).toContain("shoulder");
  });
});

describe("standard names (W36)", () => {
  it("every exercise has a distinct name, spelled the standard way", () => {
    const names = EXERCISES.map((e) => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const e of EXERCISES) {
      expect(e.name, e.id).not.toMatch(/\bpushups?\b|\bpullups?\b|\bflyes?\b|\bleverage\b|\bstep ups?\b|\bexercise ball\b/i);
    }
  });

  it("ids did not move when names did", () => {
    expect(getExercise("Pullups")?.name).toBe("Pull-up");
    expect(getExercise("Barbell_Bench_Press_-_Medium_Grip")?.name).toBe("Barbell Bench Press");
  });
});
