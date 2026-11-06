import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, type Place, type Profile } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { buildPlanVM, suggestEquipment } from "./plan";

const profile = (over: Partial<Profile> = {}): Profile => ({
  trainingDays: ["mon", "thu"],
  sessionMinutes: 90,
  equipment: [],
  goal: "build_muscle",
  level: "beginner",
  avoid: [],
  updatedAt: 1,
  ...over,
});
const bodyweight = buildPlan(profile(), EXERCISES, 3);
const full = buildPlan(profile({ equipment: [...EQUIPMENT_IDS] }), EXERCISES, 3);

describe("planner records the slots it could not fill (W35)", () => {
  it("Bodyweight only has no vertical pull: the template keeps a structured missing slot, plus the note", () => {
    const b = bodyweight.templates.find((t) => t.key === "B")!;
    expect(b.missing).toContainEqual({ slot: "main-3", pattern: "vertical_pull", role: "main" });
    expect(b.notes.join(" ")).toMatch(/vertical pull/);
  });

  it("a plan with every slot filled has no missing field at all", () => {
    for (const t of full.templates) expect(t.missing).toBeUndefined();
  });

  it("a slot cut by the time budget is not missing", () => {
    const short = buildPlan(profile({ equipment: [...EQUIPMENT_IDS], sessionMinutes: 30 }), EXERCISES, 3);
    for (const t of short.templates) expect(t.missing).toBeUndefined();
  });
});

describe("suggestEquipment", () => {
  it("suggests the single item that unlocks the pattern, most exercises first, deterministic", () => {
    const s = suggestEquipment("vertical_pull", "main", profile());
    expect(s[0]).toEqual({ add: ["pull_up_bar"], unlocks: 3 }); // main role: Chin-up, Pull-up, V-Bar Pull-up
    expect(s.length).toBeLessThanOrEqual(3);
    expect(suggestEquipment("vertical_pull", "main", profile())).toEqual(s);
  });

  it("every suggestion really unlocks an exercise of that pattern", () => {
    for (const sug of suggestEquipment("vertical_pull", "main", profile())) {
      const have = [...sug.add];
      expect(EXERCISES.some((e) => e.pattern === "vertical_pull" && e.equipment.some((and) => and.every((i) => have.includes(i))))).toBe(true);
    }
  });

  it("when the gear already covers the pattern there is nothing to suggest", () => {
    expect(suggestEquipment("vertical_pull", "main", profile({ equipment: ["pull_up_bar"] }))).toEqual([]);
  });

  it("respects the level: a beginner is not told to buy gear for advanced-only work", () => {
    for (const sug of suggestEquipment("vertical_push", "main", profile())) {
      const have = [...sug.add];
      const doable = EXERCISES.filter((e) => e.pattern === "vertical_push" && e.level !== "advanced" && e.equipment.some((and) => and.every((i) => have.includes(i))));
      expect(doable.length).toBeGreaterThan(0);
    }
  });
});

describe("Plan view model (W26, W35)", () => {
  it("lists every template with its exercises, in plan order", () => {
    const vm = buildPlanVM({ plan: full });
    expect(vm.days.map((d) => d.key)).toEqual(full.templates.map((t) => t.key));
    const a = vm.days[0];
    expect(a.exercises.map((e) => e.exerciseId)).toEqual(full.templates[0].slots.map((s) => s.exerciseId));
    expect(a.exercises[0].name).toBe(getExercise(a.exercises[0].exerciseId)!.name);
    expect(a.exercises[0].thumbnail).toBe(getExercise(a.exercises[0].exerciseId)!.images[0]);
    expect(vm.missingSlots).toEqual([]);
  });

  it("missingSlots names the pattern, the template, and the gear that would fix it", () => {
    const vm = buildPlanVM({ plan: bodyweight });
    const m = vm.missingSlots.find((x) => x.pattern === "vertical_pull")!;
    expect(m).toMatchObject({ templateKey: "B", slot: "main-3", pattern: "vertical_pull", role: "main" });
    expect(m.suggestions[0]).toEqual({ add: ["pull_up_bar"], labels: ["Pull-up bar"], unlocks: 3 });
    expect(vm.days.find((d) => d.key === "B")!.missingSlots).toContainEqual(m);
    // every missing slot of the plan is listed once, in plan order, and each one has a way out
    expect(vm.missingSlots.map((x) => `${x.templateKey}:${x.slot}`)).toEqual(vm.days.flatMap((d) => d.missingSlots.map((x) => `${x.templateKey}:${x.slot}`)));
    for (const x of vm.missingSlots) expect(x.suggestions.length, `${x.templateKey}:${x.slot}`).toBeGreaterThan(0);
  });

  it("missing slots are listed once each, even with more training days", () => {
    const vm = buildPlanVM({ plan: buildPlan(profile({ trainingDays: ["mon", "wed", "fri", "sat"] }), EXERCISES, 3) });
    const keys = vm.missingSlots.map((m) => `${m.templateKey}:${m.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the places for the manage list, and says whether another can be added", () => {
    const places: Place[] = [{ id: "g", name: "Gym", equipment: [...EQUIPMENT_IDS], isDefault: true }];
    const vm = buildPlanVM({ plan: full, places });
    expect(vm.places).toEqual(places);
    expect(vm.canAddPlace).toBe(true);
    expect(buildPlanVM({ plan: full, places: [...places, { ...places[0], id: "h", isDefault: false }, { ...places[0], id: "i", isDefault: false }] }).canAddPlace).toBe(false);
  });

  it("old plans saved before missing existed still build (no missing slots)", () => {
    const old = { ...bodyweight, templates: bodyweight.templates.map(({ missing: _m, ...t }) => (void _m, t)) };
    expect(buildPlanVM({ plan: old }).missingSlots).toEqual([]);
  });
});
