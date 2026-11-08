import { EXERCISES } from "../data/exercises";
import { musclewikiUrl } from "../engine/musclewiki";
import { EQUIPMENT_LABELS, type EquipmentId, type Exercise, type ExerciseVideo } from "../domain";

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
  /** "Watch on MuscleWiki" link (W45). Always a musclewiki.com URL; the home page for an unknown exercise. */
  musclewikiUrl: string;
  /**
   * Looping demo clip (W47). Present only for exercises that have one; the others keep the two frames in `images`,
   * which are also the fallback when the video fails or reduced motion is on (AC32). UI: muted, loop, playsinline.
   */
  video?: ExerciseVideo;
  /** Three technique key points for D4 "Key points" (W49). Present exactly when `video` is. */
  cues?: string[];
};

/** Empty detail data for an exercise id the catalog does not know (an old plan). */
export const NO_INFO: ExerciseInfo = { images: [], instructions: [], primaryMuscles: [], secondaryMuscles: [], equipment: [], musclewikiUrl: musclewikiUrl(undefined) };

/** Always a fresh copy, so the UI can never change the catalog. */
export function exerciseInfo(ex: Exercise | undefined): ExerciseInfo {
  if (!ex) return { ...NO_INFO, images: [], instructions: [], primaryMuscles: [], secondaryMuscles: [], equipment: [], musclewikiUrl: musclewikiUrl(undefined) };
  return {
    images: [...ex.images],
    instructions: [...ex.instructions],
    primaryMuscles: [...ex.primaryMuscles],
    secondaryMuscles: [...ex.secondaryMuscles],
    equipment: ex.equipment.map((and) => and.map((id) => ({ id, label: EQUIPMENT_LABELS[id] }))),
    musclewikiUrl: musclewikiUrl(ex),
    ...(ex.video ? { video: { ...ex.video } } : {}),
    ...(ex.cues ? { cues: [...ex.cues] } : {}),
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
