import { MAX_PLACES } from "../config";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, EQUIPMENT_LABELS, type EquipmentId, type Exercise, type Pattern, type Place, type Plan, type Profile, type SlotRole } from "../domain";
import { levelAtMost } from "../engine/availability";
import { exerciseInfo } from "./exerciseInfo";

export type EquipmentSuggestion = { add: EquipmentId[]; unlocks: number };

/**
 * Gear that would make `pattern` trainable (W35). Looks at the exercises of that pattern the profile may
 * do (level, avoid areas, role), finds the cheapest sets of missing items (fewest items first), then ranks
 * by how many exercises each set opens, then by the catalog order of the items. At most 3, deterministic.
 * Empty when the profile gear already covers the pattern.
 */
export function suggestEquipment(
  pattern: Pattern,
  role: SlotRole,
  profile: Pick<Profile, "equipment" | "level" | "avoid">,
  catalog: readonly Exercise[] = EXERCISES,
): EquipmentSuggestion[] {
  const have = new Set<string>(profile.equipment);
  const pool = catalog.filter(
    (e) =>
      e.pattern === pattern &&
      (role === "main" ? e.role !== "accessory" : e.role !== "main") &&
      levelAtMost(e.level, profile.level) &&
      !e.avoidFlags.some((a) => profile.avoid.includes(a)),
  );
  const counts = new Map<string, { add: EquipmentId[]; exercises: Set<string> }>();
  for (const e of pool) {
    const missing = e.equipment.map((and) => and.filter((i) => !have.has(i)));
    if (missing.some((m) => m.length === 0)) return []; // already doable
    for (const m of missing) {
      const add = [...m].sort((a, b) => EQUIPMENT_IDS.indexOf(a) - EQUIPMENT_IDS.indexOf(b));
      const key = add.join("+");
      const entry = counts.get(key) ?? { add, exercises: new Set<string>() };
      entry.exercises.add(e.id);
      counts.set(key, entry);
    }
  }
  const order = (add: readonly EquipmentId[]) => add.map((i) => EQUIPMENT_IDS.indexOf(i));
  return [...counts.values()]
    .map((c) => ({ add: c.add, unlocks: c.exercises.size }))
    .sort((a, b) => {
      if (a.add.length !== b.add.length) return a.add.length - b.add.length;
      if (a.unlocks !== b.unlocks) return b.unlocks - a.unlocks;
      const oa = order(a.add);
      const ob = order(b.add);
      for (let i = 0; i < oa.length; i++) if (oa[i] !== ob[i]) return oa[i] - ob[i];
      return 0;
    })
    .slice(0, 3);
}

export type PlanExerciseRow = {
  exerciseId: string;
  slot: string;
  name: string;
  thumbnail: string;
  role: SlotRole;
  /** Set count override from the time trim; absent = the level default. */
  sets?: number;
};

export type MissingSlotVM = {
  templateKey: string;
  slot: string;
  pattern: Pattern;
  role: SlotRole;
  /** Gear that would fill it, with names for the UI ("Add a pull-up bar or ... to train your back from above"). */
  suggestions: Array<EquipmentSuggestion & { labels: string[] }>;
};

export type PlanDayVM = {
  key: string;
  name: string;
  exercises: PlanExerciseRow[];
  notes: string[];
  missingSlots: MissingSlotVM[];
};

export type PlanVM = {
  split: Plan["split"];
  blockIndex: number;
  days: PlanDayVM[];
  /** Every missing slot of every day, in plan order (W35). Empty when the plan is complete. */
  missingSlots: MissingSlotVM[];
  /** Saved places for the manage list (W32). */
  places: Place[];
  canAddPlace: boolean;
};

/** Pure view model of the Plan screen. */
export function buildPlanVM(input: { plan: Plan; places?: readonly Place[]; catalog?: readonly Exercise[] }): PlanVM {
  const catalog = input.catalog ?? EXERCISES;
  const { plan } = input;
  const days: PlanDayVM[] = plan.templates.map((t) => {
    const missingSlots: MissingSlotVM[] = (t.missing ?? []).map((m) => ({
      templateKey: t.key,
      slot: m.slot,
      pattern: m.pattern,
      role: m.role,
      suggestions: suggestEquipment(m.pattern, m.role, plan.profile, catalog).map((s) => ({ ...s, labels: s.add.map((i) => EQUIPMENT_LABELS[i]) })),
    }));
    return {
      key: t.key,
      name: t.name,
      exercises: t.slots.map((s) => {
        const ex = catalog.find((c) => c.id === s.exerciseId);
        return {
          exerciseId: s.exerciseId,
          slot: s.slot,
          name: ex?.name ?? s.exerciseId,
          thumbnail: exerciseInfo(ex).images[0] ?? "",
          role: s.role,
          ...(s.sets !== undefined ? { sets: s.sets } : {}),
        };
      }),
      notes: t.notes,
      missingSlots,
    };
  });
  const places = [...(input.places ?? [])];
  return {
    split: plan.split,
    blockIndex: plan.blockIndex,
    days,
    missingSlots: days.flatMap((d) => d.missingSlots),
    places,
    canAddPlace: places.length < MAX_PLACES,
  };
}

