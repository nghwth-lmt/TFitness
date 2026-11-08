import type { Exercise } from "../domain";
import { GENERATED_EXERCISES } from "./exercises.generated";
import { VIDEO_EXERCISES, VIDEO_OVERLAY } from "./exercises.videos.generated";

// Product data (W06, W30, W47). The catalog is imported from free-exercise-db by scripts/import-exercises.mjs, then the
// demo clips of workout-free-videos are attached (or added as new exercises) by scripts/import-videos.mjs.
// To change it, edit scripts/exercise-map.mjs or scripts/video-map.mjs and run the importers; never edit the generated files.
export const EXERCISES: readonly Exercise[] = [
  ...GENERATED_EXERCISES.map((e) => (VIDEO_OVERLAY[e.id] ? { ...e, ...VIDEO_OVERLAY[e.id] } : e)),
  ...VIDEO_EXERCISES,
];

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return byId.get(id);
}
