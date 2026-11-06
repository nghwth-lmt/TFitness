import type { Exercise } from "../domain";
import { GENERATED_EXERCISES } from "./exercises.generated";

// Product data (W06, W30). The catalog is imported from free-exercise-db by scripts/import-exercises.mjs.
// To change it, edit scripts/exercise-map.mjs and run the importer; never edit the generated file.
export const EXERCISES: readonly Exercise[] = GENERATED_EXERCISES;

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return byId.get(id);
}
