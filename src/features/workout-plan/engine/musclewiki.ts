// "Watch on MuscleWiki" link (W45, AC30). Pure: builds a URL string, never calls the network, never embeds
// or stores MuscleWiki content. Video in the app comes later through the official API (F2).
import type { EquipmentId, Exercise } from "../domain";

const ORIGIN = "https://musclewiki.com";

/**
 * Exercise id -> MuscleWiki page slug (`/exercise/<slug>`). ONLY slugs checked by hand by the owner go here.
 * Started with a single verified entry; add more after a manual check in the browser.
 */
export const MUSCLEWIKI_SLUGS: Readonly<Record<string, string>> = {
  Dumbbell_Bench_Press: "dumbbell-bench-press",
};

/**
 * Catalog primary-muscle name -> MuscleWiki muscle-group slug (`/exercises/<muscle>`).
 * ASSUMPTION: the group slugs are not verified; they await a manual acceptance check (AC30).
 * Catalog names with no entry (middle back, adductors, abductors, neck) fall through to the next muscle or the home page.
 */
export const MUSCLEWIKI_MUSCLE_SLUGS: Readonly<Record<string, string>> = {
  chest: "chest",
  biceps: "biceps",
  triceps: "triceps",
  shoulders: "shoulders",
  traps: "traps",
  lats: "lats",
  "lower back": "lower-back",
  abdominals: "abdominals",
  obliques: "obliques",
  quadriceps: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  forearms: "forearms",
};

/**
 * Equipment id -> MuscleWiki equipment slug (`/exercises/<muscle>/<equipment>`).
 * ASSUMPTION: unverified, awaiting manual acceptance. Supporting items (benches, racks, plates, balls, ...) are
 * left out on purpose: they never decide the page, the main implement does.
 */
export const MUSCLEWIKI_EQUIPMENT_SLUGS: Readonly<Partial<Record<EquipmentId, string>>> = {
  barbell: "barbell",
  ez_bar: "barbell",
  trap_bar: "barbell",
  dumbbells: "dumbbells",
  kettlebells: "kettlebells",
  smith_machine: "smith-machine",
  cable_station: "cables",
  cable_crossover: "cables",
  lat_pulldown: "cables",
  seated_row: "cables",
  chest_press_machine: "machine",
  pec_deck: "machine",
  shoulder_press_machine: "machine",
  row_machine: "machine",
  assisted_pull_up: "machine",
  arm_machine: "machine",
  leg_press: "machine",
  hack_squat: "machine",
  leg_extension: "machine",
  leg_curl: "machine",
  hip_ab_ad: "machine",
  calf_machine: "machine",
  bands: "band",
  pull_up_bar: "bodyweight",
  dip_station: "bodyweight",
};

type Input = Pick<Exercise, "id" | "primaryMuscles" | "equipment">;

function equipmentSlug(equipment: Exercise["equipment"]): string | undefined {
  const first = equipment[0];
  if (!first) return undefined;
  if (first.length === 0) return "bodyweight";
  for (const id of first) {
    const slug = MUSCLEWIKI_EQUIPMENT_SLUGS[id];
    if (slug) return slug;
  }
  return undefined;
}

/**
 * Verified slug -> the exercise page. Else muscle + equipment page, else the muscle page when the equipment
 * has no map, else the home page when the muscle has none either.
 */
export function musclewikiUrl(exercise: Input | undefined): string {
  if (!exercise) return ORIGIN;
  const slug = Object.hasOwn(MUSCLEWIKI_SLUGS, exercise.id) ? MUSCLEWIKI_SLUGS[exercise.id] : undefined;
  if (slug) return `${ORIGIN}/exercise/${slug}`;
  const muscle = exercise.primaryMuscles.map((m) => (Object.hasOwn(MUSCLEWIKI_MUSCLE_SLUGS, m) ? MUSCLEWIKI_MUSCLE_SLUGS[m] : undefined)).find(Boolean);
  if (!muscle) return ORIGIN;
  const gear = equipmentSlug(exercise.equipment);
  return gear ? `${ORIGIN}/exercises/${muscle}/${gear}` : `${ORIGIN}/exercises/${muscle}`;
}
