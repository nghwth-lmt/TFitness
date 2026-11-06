import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, type Place, type Profile, type Session, type SetLog } from "../domain";
import { isDoable } from "../engine/availability";
import { buildPlan } from "../engine/buildPlan";
import { buildTodayVM } from "./today";

const profile: Profile = { trainingDays: ["mon", "wed", "fri"], sessionMinutes: 90, equipment: [], goal: "build_muscle", level: "intermediate", avoid: [], updatedAt: 1 };
const gym: Place = { id: "g", name: "Gym", equipment: [...EQUIPMENT_IDS], isDefault: true };
const home: Place = { id: "h", name: "Home", equipment: ["dumbbells"], dumbbellRange: { min: 4, max: 20, step: 4 }, isDefault: false };
const plan = buildPlan(profile, EXERCISES, 4, { place: gym });
const input = (extra: object = {}) => ({ profile, plan, sessions: [] as Session[], setLogs: [] as SetLog[], now: Date.UTC(2026, 10, 5, 5), utcOffsetMin: 420, places: [gym, home], ...extra });

describe("Today view model with places (W32, AC22)", () => {
  it("shows the default place in the chip and lists the others for D1", () => {
    const vm = buildTodayVM(input());
    if (vm.kind !== "next") throw new Error("expected next");
    expect(vm.atPlace?.name).toBe("Gym");
    expect(vm.places.map((p) => p.name)).toEqual(["Gym", "Home"]);
    expect(vm.canAddPlace).toBe(true);
    expect(vm.adjustedForToday).toBe(false);
  });

  it("choosing Home swaps every exercise Home cannot do; the plan stays as it was", () => {
    const vm = buildTodayVM(input({ today: { placeId: "h" } }));
    if (vm.kind !== "next") throw new Error("expected next");
    expect(vm.atPlace?.name).toBe("Home");
    expect(vm.adjustedForToday).toBe(true);
    for (const e of vm.draft.exercises) expect(isDoable(getExercise(e.exerciseId)!, ["dumbbells"]), e.exerciseId).toBe(true);
    const gymVm = buildTodayVM(input());
    if (gymVm.kind !== "next") throw new Error("expected next");
    expect(gymVm.draft.exercises.map((e) => e.exerciseId)).toEqual(plan.templates[0].slots.map((s) => s.exerciseId));
  });

  it("'Adjust for today' unticks items on top of the chosen place", () => {
    const vm = buildTodayVM(input({ today: { without: ["barbell", "squat_rack", "smith_machine"] } }));
    if (vm.kind !== "next") throw new Error("expected next");
    expect(vm.draft.todayEquipment).not.toContain("barbell");
    expect(vm.adjustedForToday).toBe(true);
  });

  it("with three places the add button is off; with no places the chip is empty", () => {
    const three = buildTodayVM(input({ places: [gym, home, { ...home, id: "x", name: "Hotel" }] }));
    if (three.kind !== "next") throw new Error("expected next");
    expect(three.canAddPlace).toBe(false);
    const none = buildTodayVM(input({ places: undefined }));
    if (none.kind !== "next") throw new Error("expected next");
    expect(none.atPlace).toBeNull();
  });
});
