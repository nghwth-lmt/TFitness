import { SEC_PER_REP, WARMUP_MINUTES } from "../config";
import type { RepRange, SessionDraft } from "../domain";

/** Seconds for one exercise: sets x (time lifting + rest). Uses config only. */
export function exerciseSeconds(sets: number, repRange: RepRange, restSec: number): number {
  const workSec = ((repRange.min + repRange.max) / 2) * SEC_PER_REP;
  return sets * (workSec + restSec);
}

/** Estimated session length in whole minutes (rounded up): warm-up + every exercise. */
export function estimateMinutes(draft: Pick<SessionDraft, "exercises">): number {
  const seconds = draft.exercises.reduce(
    (sum, e) => sum + exerciseSeconds(e.targetSets, e.repRange, e.restSec),
    WARMUP_MINUTES * 60,
  );
  return Math.ceil(seconds / 60);
}
