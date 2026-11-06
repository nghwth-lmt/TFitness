// Every threshold from PRD section 6 lives here (W11, W12, W13, W15, W17, W19, W20).
import type { Goal, Level, LoadType, RepRange, SlotRole, SplitId, Weekday } from "./domain";

/** Week starts on Monday (W20). */
export const WEEK_START: Weekday = "mon";

/** Rep range per goal and slot role (Q7, Q11). Lose fat and General fitness share ranges (W19). */
export const REP_RANGES: Record<Goal, Record<SlotRole, RepRange>> = {
  get_stronger: { main: { min: 3, max: 5 }, accessory: { min: 8, max: 10 } },
  build_muscle: { main: { min: 6, max: 10 }, accessory: { min: 10, max: 12 } },
  lose_fat: { main: { min: 8, max: 12 }, accessory: { min: 12, max: 15 } },
  general_fitness: { main: { min: 8, max: 12 }, accessory: { min: 12, max: 15 } },
};

/** Rest seconds per goal and slot role. */
export const REST_SEC: Record<Goal, Record<SlotRole, number>> = {
  get_stronger: { main: 180, accessory: 90 },
  build_muscle: { main: 120, accessory: 75 },
  lose_fat: { main: 90, accessory: 45 },
  general_fitness: { main: 90, accessory: 45 },
};

/** Sets per level. Advanced main is 4-5 in the PRD; the default is the lower bound. */
export const SETS: Record<Level, Record<SlotRole, number>> = {
  beginner: { main: 3, accessory: 2 },
  intermediate: { main: 4, accessory: 3 },
  advanced: { main: 4, accessory: 3 },
};

/** The budget trim never goes below this many sets for an exercise. */
export const MIN_SETS_PER_EXERCISE = 1;
export const MIN_EXERCISES_PER_SESSION = 3;
export const WARMUP_MINUTES = 5;
/** Seconds spent lifting one rep, used for the time estimate. */
export const SEC_PER_REP = 4;

/** Rest clock adjust step on the player (W15). */
export const REST_ADJUST_SEC = 15;
export const REST_MIN_SEC = 15;
export const REST_MAX_SEC = 600;

/** A block is this many weeks of sessions: 4 x days per week completed sessions (W11). */
export const BLOCK_WEEKS = 4;
export const MAX_SPLIT_DAYS = 6;
export const MIN_TRAINING_DAYS = 2;

/** Weight steps in kg per load type (W12). Cable is treated like a machine stack. */
export const LOAD_STEP_KG: Record<Exclude<LoadType, "bodyweight">, number> = {
  barbell: 2.5,
  machine: 2.5,
  cable: 2.5,
  dumbbell: 2,
};
/** Bodyweight progression: +1 rep up to this many (W12). */
export const BODYWEIGHT_REP_CAP = 15;
export const BODYWEIGHT_REP_STEP = 1;

/** Sessions in a row at the top of the range needed to add load; below the bottom to flag a stall (W13). */
export const PROGRESS_STREAK = 2;
export const STALL_STREAK = 2;
export const STALL_REDUCTION = 0.1;

/** Warm-up set for the first main lift: share of the working weight (W17). */
export const WARMUP_SET_SHARE = 0.5;
export const WARMUP_SET_REPS = 8;

export const SPLIT_BY_DAYS: Record<number, SplitId> = {
  2: "fullbody_ab",
  3: "fullbody_abc",
  4: "upper_lower",
  5: "ppl_ul",
  6: "ppl_ppl",
};

/** Saved places (W32). */
export const MAX_PLACES = 3;
export const MAX_PLACE_NAME = 30;
