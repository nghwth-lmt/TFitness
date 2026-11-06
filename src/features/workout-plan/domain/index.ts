// Domain contract for the workout-plan feature (single local user, no auth).
// Pure types and closed vocabularies. No runtime dependencies.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const SESSION_MINUTES = [30, 45, 60, 75, 90] as const;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];

export * from "./equipment";
import type { EquipmentId } from "./equipment";

export const GOALS = ["build_muscle", "get_stronger", "lose_fat", "general_fitness"] as const;
export type Goal = (typeof GOALS)[number];

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

export const BODY_AREAS = ["shoulder", "knee", "lower_back", "wrist"] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

/** Movement pattern = one "slot kind" of a session (W03). */
export const PATTERNS = [
  "squat",
  "hinge",
  "horizontal_push",
  "horizontal_pull",
  "vertical_push",
  "vertical_pull",
  "single_leg",
  "core",
  "arms",
  "calves",
  "side_delt",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const MUSCLES = [
  "chest",
  "back",
  "quads",
  "hamstrings",
  "glutes",
  "shoulders",
  "biceps",
  "triceps",
  "calves",
  "core",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const LOAD_TYPES = ["barbell", "dumbbell", "machine", "cable", "bodyweight"] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const SPLIT_IDS = [
  "fullbody_ab",
  "fullbody_abc",
  "upper_lower",
  "ppl_ul",
  "ppl_ppl",
] as const;
export type SplitId = (typeof SPLIT_IDS)[number];

export type ExerciseRole = "main" | "accessory" | "both";
export type SlotRole = "main" | "accessory";

export type DumbbellRange = { min: number; max: number; step: number };

export type Profile = {
  trainingDays: Weekday[];
  sessionMinutes: SessionMinutes;
  equipment: EquipmentId[];
  dumbbellRange?: DumbbellRange;
  goal: Goal;
  level: Level;
  avoid: BodyArea[];
  /** epoch ms */
  updatedAt: number;
};

/** A named set of gear (W32). At most 3 are stored and exactly one is the default. */
export type Place = {
  id: string;
  name: string;
  equipment: EquipmentId[];
  dumbbellRange?: DumbbellRange;
  isDefault: boolean;
};
export type PlaceInput = Pick<Place, "name" | "equipment" | "dumbbellRange">;

/** What "Where are you training?" hands to `adjustForToday`: a place, minus items unticked for today. */
export type TodayGear = { place: Pick<Place, "id" | "equipment" | "dumbbellRange">; without?: readonly EquipmentId[] };

export type Exercise = {
  id: string;
  name: string;
  pattern: Pattern;
  role: ExerciseRole;
  /** OR of ANDs: the exercise is doable when at least one inner list is fully available. `[[]]` = no equipment. */
  equipment: EquipmentId[][];
  muscles: Muscle[];
  /** Minimum level the exercise suits. */
  level: Level;
  avoidFlags: BodyArea[];
  loadType: LoadType;
  cue: string;
} & ExerciseDetails;

/** Visual and descriptive data that the imported catalog carries (W30). Instructions stay in English. */
export type ExerciseDetails = {
  /** Two frames: start position, end position. Served from /exercises/<id>/. */
  images: string[];
  instructions: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

export type RepRange = { min: number; max: number };

export type TemplateSlot = {
  /** Stable id inside the template, e.g. "main-1", "acc-3". */
  slot: string;
  pattern: Pattern;
  role: SlotRole;
  exerciseId: string;
  /** Set count override written by the time-budget trim (WL-04). Absent = use the level default. */
  sets?: number;
};

export type SessionTemplate = {
  /** "A", "B", "C" or "Push", "Pull"... stable within a plan. */
  key: string;
  name: string;
  slots: TemplateSlot[];
  /** Human notes such as a dropped slot with no available exercise (AC05). */
  notes: string[];
};

export type PlanStatus = "active" | "archived";

export type Plan = {
  id: string;
  status: PlanStatus;
  split: SplitId;
  /** Profile snapshot the plan was built from (needed to rotate blocks). */
  profile: Profile;
  templates: SessionTemplate[];
  blockIndex: number;
  /** Count of `completed` sessions when the current block started. */
  blockStartedAtCompletedCount: number;
  /** Index of the next template in the loop. */
  cursor: number;
  seed: number;
  /** epoch ms */
  createdAt: number;
};

/** Why today's target is what it is (W33). The UI turns the code into a sentence; params fill the blanks. */
export const REASON_CODES = ["first_time", "hold", "increase", "bodyweight_rep", "stall"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type ProgressionReason = {
  code: ReasonCode;
  params: {
    /** Top of the rep range (hold, increase). */
    max?: number;
    /** Bottom of the rep range (stall). */
    min?: number;
    /** kg added (increase). */
    n?: number;
    /** Target reps (bodyweight_rep, and first_time for a bodyweight exercise). */
    reps?: number;
    /** hold: the dumbbell range has no heavier step. */
    atRangeTop?: boolean;
    /** bodyweight_rep: the 15-rep cap is reached, suggest a harder variation. */
    capped?: boolean;
    /** first_time: the exercise has no weight. */
    bodyweight?: boolean;
  };
};

/** The latest finished session of an exercise, as data. The UI writes "8 · 8 · 7 x 20 kg". */
export type LastTime = {
  /** epoch ms of the last set */
  at: number;
  /** Reps in set order. */
  reps: number[];
  /** Heaviest kg of the session; null for a bodyweight exercise. */
  kg: number | null;
  /** Every set used the same kg. */
  sameKg: boolean;
};

export type SessionExercise = {
  exerciseId: string;
  slot: string;
  role: SlotRole;
  targetSets: number;
  repRange: RepRange;
  /** null = first time: the user picks a weight. */
  targetKg: number | null;
  /** Bodyweight exercises progress by reps; absent for loaded exercises. */
  targetReps?: number;
  restSec: number;
  hint?: string;
  /** Exactly one reason for the target (W33). Absent only in sessions saved before it existed. */
  reason?: ProgressionReason;
  /** Absent the first time the exercise is trained. */
  lastTime?: LastTime | null;
};

export type SessionDraft = {
  planId: string;
  templateKey: string;
  name: string;
  exercises: SessionExercise[];
  /** Set when `adjustForToday` ran (W05). */
  todayEquipment?: EquipmentId[];
  /** Place the draft was adjusted for (W32). Absent when adjusted with a plain equipment list. */
  placeId?: string;
  /** Dumbbell range of that place; progression of swapped exercises follows it. */
  todayDumbbellRange?: DumbbellRange;
  adjustedForToday: boolean;
  notes: string[];
};

export type SessionStatus = "planned" | "in_progress" | "completed" | "abandoned";

export type Session = SessionDraft & {
  id: string;
  status: SessionStatus;
  /** epoch ms */
  startedAt: number | null;
  finishedAt: number | null;
};

export type Rir = 0 | 1 | 2 | 3;

export type SetLog = {
  id: string;
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  kg: number | null;
  reps: number;
  /** null = not answered. Never coerce to 0. */
  rir: Rir | null;
  /** epoch ms */
  loggedAt: number;
};

/** What the engine needs from storage to plan the next session. */
export type History = {
  sessions: Session[];
  setLogs: SetLog[];
};
