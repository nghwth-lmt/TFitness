import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_LABELS, type EquipmentId, type Exercise } from "../domain";

export type EquipmentChip = { id: EquipmentId; label: string };

/** What the exercise details sheet (D4), the player card and the thumbnails need (W30, AC18). */
export type ExerciseInfo = {
  /** Two frames: start position, end position. */
  images: string[];
  instructions: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** OR of ANDs, labelled. `[[]]` means bodyweight: no equipment needed. */
  equipment: EquipmentChip[][];
};

/** Empty detail data for an exercise id the catalog does not know (an old plan). */
export const NO_INFO: ExerciseInfo = { images: [], instructions: [], primaryMuscles: [], secondaryMuscles: [], equipment: [] };

/** Always a fresh copy, so the UI can never change the catalog. */
export function exerciseInfo(ex: Exercise | undefined): ExerciseInfo {
  if (!ex) return { ...NO_INFO, images: [], instructions: [], primaryMuscles: [], secondaryMuscles: [], equipment: [] };
  return {
    images: [...ex.images],
    instructions: [...ex.instructions],
    primaryMuscles: [...ex.primaryMuscles],
    secondaryMuscles: [...ex.secondaryMuscles],
    equipment: ex.equipment.map((and) => and.map((id) => ({ id, label: EQUIPMENT_LABELS[id] }))),
  };
}

export type ExerciseDetails = ExerciseInfo & {
  id: string;
  name: string;
  cue: string;
  /** First frame, for list thumbnails. */
  thumbnail: string;
};

export function getExerciseDetails(id: string, catalog: readonly Exercise[] = EXERCISES): ExerciseDetails | undefined {
  const ex = catalog.find((c) => c.id === id);
  if (!ex) return undefined;
  return { id: ex.id, name: ex.name, cue: ex.cue, thumbnail: ex.images[0] ?? "", ...exerciseInfo(ex) };
}
