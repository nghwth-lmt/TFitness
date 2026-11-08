import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, type Plan, type Profile } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { exerciseInfo, getExerciseDetails } from "./exerciseInfo";
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

const WITH = "Barbell_Squat"; // matched to the clip barbell-back-squat
const NEW = "wfv_superman"; // added from the video source
const WITHOUT = "Pushups";
const sessionEx = (exerciseId: string) => ({ exerciseId, slot: "main-1", role: "main" as const, targetSets: 3, repRange: { min: 6, max: 10 }, targetKg: null, restSec: 120 });

describe("ExerciseInfo carries video and key points (W47, W49, AC32 data)", () => {
  it("an exercise with a clip exposes video and exactly 3 cues, and keeps the two frames as the fallback", () => {
    const info = exerciseInfo(getExercise(WITH));
    expect(info.video).toMatchObject({ path: "/videos/barbell-back-squat.mp4", poster: "/videos/barbell-back-squat.webp", width: 1280, height: 720 });
    expect(info.video!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(info.cues).toHaveLength(3);
    expect(info.images).toHaveLength(2);
  });

  it("an exercise without a clip has neither field", () => {
    const info = exerciseInfo(getExercise(WITHOUT));
    expect("video" in info).toBe(false);
    expect("cues" in info).toBe(false);
    expect("video" in exerciseInfo(undefined)).toBe(false);
  });

  it("getExerciseDetails passes them on, for matched and for new exercises", () => {
    for (const id of [WITH, NEW]) {
      const d = getExerciseDetails(id)!;
      expect(d.video, id).toEqual(getExercise(id)!.video);
      expect(d.cues, id).toEqual(getExercise(id)!.cues);
    }
    expect(getExerciseDetails(WITHOUT)!.video).toBeUndefined();
  });

  it("is a copy: changing the result never changes the catalog", () => {
    const d = getExerciseDetails(WITH)!;
    d.cues!.push("x");
    d.video!.path = "/x.mp4";
    expect(getExercise(WITH)!.cues).toHaveLength(3);
    expect(getExercise(WITH)!.video!.path).toBe("/videos/barbell-back-squat.mp4");
  });

  it("is plain data: survives structuredClone for every exercise of the catalog", () => {
    for (const e of EXERCISES) expect(structuredClone(exerciseInfo(e)), e.id).toEqual(exerciseInfo(e));
  });

  it("every exercise with a clip gets a video, 3 cues and 2 frames; every other one gets no video", () => {
    for (const e of EXERCISES) {
      const info = exerciseInfo(e);
      if (e.video) {
        expect(info.video, e.id).toEqual(e.video);
        expect(info.cues, e.id).toHaveLength(3);
        expect(info.images, e.id).toHaveLength(2);
      } else {
        expect(info.video, e.id).toBeUndefined();
        expect(info.cues, e.id).toBeUndefined();
      }
    }
  });
});

describe("PlayerExercise carries video and cues", () => {
  it("toPlayerExercise and initPlayer expose them; the short cue line stays", () => {
    const p = toPlayerExercise(sessionEx(WITH), EXERCISES);
    expect(p.video).toEqual(getExercise(WITH)!.video);
    expect(p.cues).toEqual(getExercise(WITH)!.cues);
    expect(p.cue).toBe(getExercise(WITH)!.cue);
    const state = initPlayer({ session: { id: "s", exercises: [sessionEx(WITH), sessionEx(WITHOUT)] }, logs: [], catalog: EXERCISES });
    expect(state.exercises[0].video).toEqual(getExercise(WITH)!.video);
    expect(state.exercises[1].video).toBeUndefined();
    expect(state.exercises[1].cues).toBeUndefined();
  });

  it("an unknown exercise has no video", () => {
    expect(toPlayerExercise(sessionEx("gone"), EXERCISES).video).toBeUndefined();
  });
});

describe("TodayExerciseRow carries video and cues", () => {
  const base = buildPlan(profile(), EXERCISES, 3);
  const swapped: Plan = { ...base, templates: base.templates.map((t) => ({ ...t, slots: t.slots.map((s, i) => (i === 0 ? { ...s, exerciseId: WITH } : i === 1 ? { ...s, exerciseId: WITHOUT } : i === 2 ? { ...s, exerciseId: "gone" } : s)) })) };
  const vm = buildTodayVM({ profile: profile(), plan: swapped, sessions: [], setLogs: [], now: Date.UTC(2026, 10, 9, 5), utcOffsetMin: 0 });

  it("a row with a clip has video and cues; others have neither", () => {
    if (vm.kind !== "next") throw new Error("expected next");
    expect(vm.exercises[0].video).toEqual(getExercise(WITH)!.video);
    expect(vm.exercises[0].cues).toEqual(getExercise(WITH)!.cues);
    expect("video" in vm.exercises[1]).toBe(false);
    expect("cues" in vm.exercises[1]).toBe(false);
    expect("video" in vm.exercises[2]).toBe(false);
  });

  it("the Today VM stays plain data", () => {
    expect(structuredClone(vm)).toEqual(vm);
  });
});
