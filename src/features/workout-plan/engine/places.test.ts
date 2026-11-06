import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, EQUIPMENT_PRESETS, type EquipmentId, type History, type Place, type Profile } from "../domain";
import { isDoable } from "./availability";
import { buildPlan } from "./buildPlan";
import { gearEquipment, placeNameForEquipment, profileForPlace } from "./places";
import { nextSession } from "./schedule";
import { adjustForToday } from "./substitution";

const EMPTY: History = { sessions: [], setLogs: [] };
const FULL: EquipmentId[] = [...EQUIPMENT_IDS];

const profile = (over: Partial<Profile> = {}): Profile => ({
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 90,
  equipment: [],
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
  ...over,
});

const gym: Place = { id: "g", name: "Gym", equipment: FULL, isDefault: true };
const home: Place = { id: "h", name: "Home", equipment: ["dumbbells"], dumbbellRange: { min: 4, max: 20, step: 4 }, isDefault: false };

describe("place helpers (W32)", () => {
  it("names the first place after the preset it matches", () => {
    expect(placeNameForEquipment(EQUIPMENT_PRESETS.full_gym.equipment)).toBe("Gym");
    expect(placeNameForEquipment(EQUIPMENT_PRESETS.home.equipment)).toBe("Home");
    expect(placeNameForEquipment([])).toBe("Anywhere");
    expect(placeNameForEquipment(["barbell"])).toBe("My gym");
  });

  it("profileForPlace copies the place gear into the profile and touches nothing else", () => {
    const p = profile({ dumbbellRange: { min: 1, max: 2, step: 1 } });
    const out = profileForPlace(p, home);
    expect(out.equipment).toEqual(["dumbbells"]);
    expect(out.dumbbellRange).toEqual({ min: 4, max: 20, step: 4 });
    expect({ ...out, equipment: p.equipment, dumbbellRange: p.dumbbellRange }).toEqual(p);
    expect(profileForPlace(p, gym).dumbbellRange).toBeUndefined();
  });

  it("gearEquipment is the place minus the unticked items", () => {
    expect(gearEquipment({ place: gym, without: ["barbell"] })).toEqual(FULL.filter((e) => e !== "barbell"));
    expect(gearEquipment({ place: home })).toEqual(["dumbbells"]);
  });
});

describe("buildPlan uses the default place (W32)", () => {
  it("every exercise of the plan can be done with the place gear, and the snapshot carries it", () => {
    const plan = buildPlan(profile({ equipment: FULL }), EXERCISES, 3, { place: home });
    expect(plan.profile.equipment).toEqual(["dumbbells"]);
    expect(plan.profile.dumbbellRange).toEqual(home.dumbbellRange);
    const ids = plan.templates.flatMap((t) => t.slots.map((s) => s.exerciseId));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(isDoable(getExercise(id)!, ["dumbbells"]), id).toBe(true);
  });

  it("without a place the profile gear is used as before", () => {
    const a = buildPlan(profile({ equipment: FULL }), EXERCISES, 3);
    const b = buildPlan(profile({ equipment: FULL }), EXERCISES, 3, { place: gym });
    expect(b.templates).toEqual(a.templates);
  });
});

describe("adjustForToday with a place (AC22, logic)", () => {
  const plan = buildPlan(profile(), EXERCISES, 7, { place: gym });
  const base = nextSession(plan, EMPTY);

  it("at Home (dumbbells only) every exercise that needs missing gear is swapped to the same pattern", () => {
    const out = adjustForToday(base, { place: home }, EXERCISES, plan.profile);
    expect(out.adjustedForToday).toBe(true);
    expect(out.todayEquipment).toEqual(["dumbbells"]);
    expect(out.placeId).toBe("h");
    base.exercises.forEach((orig, i) => {
      const now = out.exercises[i];
      if (!now) return; // a dropped slot has a note
      expect(isDoable(getExercise(now.exerciseId)!, ["dumbbells"]), now.exerciseId).toBe(true);
      if (now.exerciseId !== orig.exerciseId) expect(getExercise(now.exerciseId)!.pattern).toBe(getExercise(orig.exerciseId)!.pattern);
    });
  });

  it("the plan and the next gym session keep the original exercises (swap is for today only)", () => {
    adjustForToday(base, { place: home }, EXERCISES, plan.profile);
    const again = nextSession(plan, EMPTY);
    expect(again.exercises.map((e) => e.exerciseId)).toEqual(base.exercises.map((e) => e.exerciseId));
    const atGym = adjustForToday(base, { place: gym }, EXERCISES, plan.profile);
    expect(atGym.adjustedForToday).toBe(false);
    expect(atGym.exercises.map((e) => e.exerciseId)).toEqual(base.exercises.map((e) => e.exerciseId));
  });

  it("the unticked items apply on top of the place", () => {
    const out = adjustForToday(base, { place: gym, without: ["barbell", "squat_rack", "smith_machine"] }, EXERCISES, plan.profile);
    expect(out.todayEquipment).not.toContain("barbell");
    for (const e of out.exercises) expect(isDoable(getExercise(e.exerciseId)!, out.todayEquipment!), e.exerciseId).toBe(true);
  });

  it("the old array form still works", () => {
    const out = adjustForToday(base, ["dumbbells"], EXERCISES, plan.profile);
    expect(out.todayEquipment).toEqual(["dumbbells"]);
    expect(out.placeId).toBeUndefined();
  });
});
