import { LEVELS, type EquipmentId, type Exercise, type Level } from "../domain";

/** True when `a` is not harder than `b`. */
export function levelAtMost(a: Level, b: Level): boolean {
  return LEVELS.indexOf(a) <= LEVELS.indexOf(b);
}

/** Equipment is an OR of ANDs. `[[]]` means no equipment needed. */
export function isDoable(exercise: Exercise, equipment: readonly EquipmentId[]): boolean {
  return exercise.equipment.some((and) => and.every((id) => equipment.includes(id)));
}

export function availableExercises(
  catalog: readonly Exercise[],
  equipment: readonly EquipmentId[],
): Exercise[] {
  return catalog.filter((e) => isDoable(e, equipment));
}
