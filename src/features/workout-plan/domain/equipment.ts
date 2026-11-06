// Equipment catalog (PRD 6.1, W31): 33 items in 6 groups, three presets, and the legacy id migration (AC20).
// Ids are fixed by the PRD. Never rename them.

export const EQUIPMENT_GROUPS = [
  { id: "free_weights", name: "Free weights", items: ["barbell", "ez_bar", "trap_bar", "dumbbells", "kettlebells", "plates"] },
  { id: "racks_benches", name: "Racks & benches", items: ["squat_rack", "smith_machine", "flat_bench", "adjustable_bench", "pull_up_bar", "dip_station"] },
  { id: "cables", name: "Cables", items: ["cable_station", "cable_crossover", "lat_pulldown", "seated_row"] },
  { id: "upper_machines", name: "Upper-body machines", items: ["chest_press_machine", "pec_deck", "shoulder_press_machine", "row_machine", "assisted_pull_up", "arm_machine"] },
  { id: "lower_machines", name: "Lower-body machines", items: ["leg_press", "hack_squat", "leg_extension", "leg_curl", "hip_ab_ad", "calf_machine"] },
  { id: "small_gear", name: "Small gear", items: ["bands", "suspension", "medicine_ball", "stability_ball", "ab_wheel", "plyo_box"] },
] as const;

export const EQUIPMENT_IDS = [
  "barbell",
  "ez_bar",
  "trap_bar",
  "dumbbells",
  "kettlebells",
  "plates",
  "squat_rack",
  "smith_machine",
  "flat_bench",
  "adjustable_bench",
  "pull_up_bar",
  "dip_station",
  "cable_station",
  "cable_crossover",
  "lat_pulldown",
  "seated_row",
  "chest_press_machine",
  "pec_deck",
  "shoulder_press_machine",
  "row_machine",
  "assisted_pull_up",
  "arm_machine",
  "leg_press",
  "hack_squat",
  "leg_extension",
  "leg_curl",
  "hip_ab_ad",
  "calf_machine",
  "bands",
  "suspension",
  "medicine_ball",
  "stability_ball",
  "ab_wheel",
  "plyo_box",
] as const;
export type EquipmentId = (typeof EQUIPMENT_IDS)[number];

export type EquipmentPreset = {
  label: string;
  equipment: EquipmentId[];
  dumbbellRange?: { min: number; max: number; step: number };
};

/** Quick picks at the top of Setup step 2. Bodyweight is always available, so it needs no item. */
export const EQUIPMENT_PRESETS: Record<"full_gym" | "home" | "bodyweight", EquipmentPreset> = {
  full_gym: { label: "Full gym", equipment: [...EQUIPMENT_IDS] },
  home: {
    label: "Home: dumbbells + bench",
    equipment: ["dumbbells", "adjustable_bench", "pull_up_bar", "bands"],
    dumbbellRange: { min: 4, max: 24, step: 2 },
  },
  bodyweight: { label: "Bodyweight only", equipment: [] },
};

/**
 * Old 8-item ids (before PRD v1.1) to the new ids. The closest meaning wins.
 * `machines` was one generic tick, so it expands to the common machines (assumption, see HANDOFF).
 */
export const LEGACY_EQUIPMENT_MAP: Record<string, readonly EquipmentId[]> = {
  barbell: ["barbell"],
  rack: ["squat_rack"],
  dumbbells: ["dumbbells"],
  bench: ["adjustable_bench"],
  cable: ["cable_station"],
  machines: ["chest_press_machine", "shoulder_press_machine", "row_machine", "pec_deck", "leg_press", "leg_extension", "leg_curl"],
  pullup_bar: ["pull_up_bar"],
  bands: ["bands"],
};

const isNewId = (id: string): id is EquipmentId => (EQUIPMENT_IDS as readonly string[]).includes(id);

/**
 * Converts any mix of old and new ids to new ids, keeping order and removing duplicates.
 * Ids that are neither are dropped, unless `keepUnknown` (used by import so validation can reject them).
 */
export function migrateEquipmentIds(ids: readonly string[], options: { keepUnknown?: boolean } = {}): EquipmentId[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const id of ids) {
    if (Object.hasOwn(LEGACY_EQUIPMENT_MAP, id)) LEGACY_EQUIPMENT_MAP[id].forEach(push);
    else if (isNewId(id) || options.keepUnknown) push(id);
  }
  return out as EquipmentId[];
}

export function migrateProfile<T extends { equipment: readonly string[] }>(profile: T): T & { equipment: EquipmentId[] } {
  return { ...profile, equipment: migrateEquipmentIds(profile.equipment) };
}
