import { LOAD_STEP_KG, REST_ADJUST_SEC, REST_MAX_SEC, REST_MIN_SEC, WARMUP_MINUTES, WARMUP_SET_REPS, WARMUP_SET_SHARE } from "../config";
import { EXERCISES } from "../data/exercises";
import type { Exercise, LastTime, LoadType, ProgressionReason, Profile, RepRange, Rir, Session, SetLog, SlotRole } from "../domain";
import { normalizeRir } from "../engine/progression";
import { exerciseInfo, type ExerciseInfo } from "./exerciseInfo";

/**
 * Workout player state machine (pure). `working` -> log set -> `resting` -> (restEndsAt reached)
 * -> `working`, moving through exercises, then `finished`. The rest clock is the timestamp
 * `restEndsAt`; the UI redraws and dispatches `tick` with the current time (on render and on
 * visibilitychange). There are no timers here, so a locked screen or a background tab is harmless.
 */

export type PlayerExercise = ExerciseInfo & {
  exerciseId: string;
  slot: string;
  name: string;
  cue: string;
  role: SlotRole;
  targetSets: number;
  repRange: RepRange;
  restSec: number;
  targetKg: number | null;
  targetReps?: number;
  hint?: string;
  /** Exactly one reason for today's target (W33). The UI turns the code into a sentence. */
  reason: ProgressionReason;
  /** The line "Last time: 8 · 8 · 7 x 20 kg" as data. Null the first time (no line is shown). */
  lastTimeLine: LastTime | null;
  loadType: LoadType;
  /** Weight stepper size in kg. null = bodyweight (no weight). */
  kgStep: number | null;
};

export type PlayerLog = {
  exerciseId: string;
  setIndex: number;
  kg: number | null;
  reps: number;
  /** null = not answered. Never 0 by default. */
  rir: Rir | null;
  loggedAt: number;
};

export type PlayerState = {
  sessionId: string;
  status: "working" | "resting" | "finished";
  exercises: PlayerExercise[];
  /** The set to do next (already advanced while resting). Meaningless when finished. */
  exerciseIndex: number;
  setIndex: number;
  /** Values in the steppers for the set to do next. */
  kg: number | null;
  reps: number;
  logs: PlayerLog[];
  /** The set the RIR chips apply to. */
  lastLogged: { exerciseId: string; setIndex: number } | null;
  restEndsAt: number | null;
  restTotalSec: number;
  /** "Warm up 5 min" card plus one suggested warm-up set for the first main lift (not logged). */
  warmup: null | { minutes: number; set: { kg: number; reps: number } | null; dismissed: boolean };
};

export type PlayerAction =
  | { type: "setKg"; kg: number | null }
  | { type: "stepKg"; direction: 1 | -1 }
  | { type: "setReps"; reps: number }
  | { type: "stepReps"; direction: 1 | -1 }
  | { type: "logSet"; now: number }
  | { type: "answerRir"; rir: Rir | null }
  | { type: "adjustRest"; direction: 1 | -1; now: number }
  | { type: "skipRest"; now: number }
  | { type: "tick"; now: number }
  | { type: "swapExercise"; slot: string; exercise: PlayerExercise }
  | { type: "editSet"; exerciseId: string; setIndex: number; kg: number | null; reps: number }
  | { type: "dismissWarmup" };

function kgStepFor(loadType: LoadType, profile?: Pick<Profile, "dumbbellRange">): number | null {
  if (loadType === "bodyweight") return null;
  if (loadType === "dumbbell") return profile?.dumbbellRange?.step ?? LOAD_STEP_KG.dumbbell;
  return LOAD_STEP_KG[loadType];
}

/** A session saved before reasons existed: derive the one reason from the target. */
function fallbackReason(e: Session["exercises"][number], loadType: LoadType): ProgressionReason {
  if (e.targetKg === null && loadType !== "bodyweight") return { code: "first_time", params: {} };
  if (loadType === "bodyweight") return { code: "bodyweight_rep", params: { reps: e.targetReps ?? e.repRange.min } };
  return { code: "hold", params: { max: e.repRange.max } };
}

/** Turns a session exercise into what the player needs (name, cue, step). */
export function toPlayerExercise(
  e: Session["exercises"][number],
  catalog: readonly Exercise[],
  profile?: Pick<Profile, "dumbbellRange">,
): PlayerExercise {
  const ex = catalog.find((c) => c.id === e.exerciseId);
  const loadType: LoadType = ex?.loadType ?? (e.targetKg === null && e.targetReps !== undefined ? "bodyweight" : "machine");
  return {
    exerciseId: e.exerciseId,
    slot: e.slot,
    name: ex?.name ?? e.exerciseId,
    cue: ex?.cue ?? "",
    role: e.role,
    targetSets: e.targetSets,
    repRange: e.repRange,
    restSec: e.restSec,
    targetKg: e.targetKg,
    ...(e.targetReps !== undefined ? { targetReps: e.targetReps } : {}),
    ...(e.hint !== undefined ? { hint: e.hint } : {}),
    reason: e.reason ?? fallbackReason(e, loadType),
    lastTimeLine: e.lastTime ?? null,
    loadType,
    kgStep: kgStepFor(loadType, profile),
    ...exerciseInfo(ex),
  };
}

const hasLog = (logs: readonly PlayerLog[], exerciseId: string, setIndex: number) =>
  logs.some((l) => l.exerciseId === exerciseId && l.setIndex === setIndex);

function inputsFor(ex: PlayerExercise, logs: readonly PlayerLog[]): { kg: number | null; reps: number } {
  const mine = logs.filter((l) => l.exerciseId === ex.exerciseId).sort((a, b) => b.setIndex - a.setIndex);
  if (mine.length) return { kg: ex.kgStep === null ? null : mine[0].kg, reps: mine[0].reps };
  return { kg: ex.kgStep === null ? null : ex.targetKg, reps: ex.targetReps ?? ex.repRange.max };
}

/** First unlogged set at or after (e, s) in session order, then from the start. */
function findNext(exercises: readonly PlayerExercise[], logs: readonly PlayerLog[], fromE: number, fromS: number): [number, number] | null {
  const incomplete: Array<[number, number]> = [];
  exercises.forEach((ex, e) => {
    for (let s = 0; s < ex.targetSets; s++) if (!hasLog(logs, ex.exerciseId, s)) incomplete.push([e, s]);
  });
  return incomplete.find(([e, s]) => e > fromE || (e === fromE && s >= fromS)) ?? incomplete[0] ?? null;
}

function roundToStep(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

export function initPlayer(args: {
  session: Pick<Session, "id" | "exercises">;
  logs: readonly SetLog[];
  catalog?: readonly Exercise[];
  profile?: Pick<Profile, "dumbbellRange">;
}): PlayerState {
  const catalog = args.catalog ?? EXERCISES;
  const exercises = args.session.exercises.map((e) => toPlayerExercise(e, catalog, args.profile));
  const ids = new Set(exercises.map((e) => e.exerciseId));
  const logs: PlayerLog[] = args.logs
    .filter((l) => l.sessionId === args.session.id && ids.has(l.exerciseId))
    .sort((a, b) => a.loggedAt - b.loggedAt || a.setIndex - b.setIndex)
    .map((l) => ({ exerciseId: l.exerciseId, setIndex: l.setIndex, kg: l.kg, reps: l.reps, rir: l.rir, loggedAt: l.loggedAt }));

  const next = findNext(exercises, logs, 0, 0);
  const first = exercises[0];
  const fresh = logs.length === 0;
  let warmup: PlayerState["warmup"] = null;
  if (fresh && first) {
    const set =
      first.role === "main" && first.kgStep !== null && first.targetKg !== null
        ? { kg: roundToStep(first.targetKg * WARMUP_SET_SHARE, first.kgStep), reps: WARMUP_SET_REPS }
        : null;
    warmup = { minutes: WARMUP_MINUTES, set, dismissed: false };
  }
  const last = logs[logs.length - 1];
  const base = {
    sessionId: args.session.id,
    exercises,
    logs,
    lastLogged: last ? { exerciseId: last.exerciseId, setIndex: last.setIndex } : null,
    restEndsAt: null,
    restTotalSec: 0,
    warmup,
  };
  if (!next) return { ...base, status: "finished", exerciseIndex: Math.max(0, exercises.length - 1), setIndex: 0, kg: null, reps: 0 };
  const [e, s] = next;
  return { ...base, status: "working", exerciseIndex: e, setIndex: s, ...inputsFor(exercises[e], logs) };
}

export function currentExercise(state: PlayerState): PlayerExercise {
  return state.exercises[state.exerciseIndex];
}

export function progressOf(state: PlayerState): { doneSets: number; totalSets: number } {
  let doneSets = 0;
  let totalSets = 0;
  for (const ex of state.exercises) {
    totalSets += ex.targetSets;
    for (let s = 0; s < ex.targetSets; s++) if (hasLog(state.logs, ex.exerciseId, s)) doneSets++;
  }
  return { doneSets, totalSets };
}

export function canFinish(state: PlayerState): boolean {
  return state.status === "finished";
}

/** "Finish now" in the leave sheet (W28): allowed once at least one set is logged and sets remain. */
export function canFinishEarly(state: PlayerState): boolean {
  return state.status !== "finished" && state.logs.length > 0;
}

/** Whole seconds left on the rest clock, from the time you pass in (rounded up). */
export function remainingSec(state: PlayerState, now: number): number {
  if (state.status !== "resting" || state.restEndsAt === null) return 0;
  return Math.max(0, Math.ceil((state.restEndsAt - now) / 1000));
}

const validReps = (n: number) => Number.isInteger(n) && n >= 0;
const validKg = (n: number | null) => n === null || (Number.isFinite(n) && n >= 0);

function endRest(state: PlayerState): PlayerState {
  return { ...state, status: "working", restEndsAt: null };
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "setKg": {
      const ex = state.exercises[state.exerciseIndex];
      if (!ex || ex.kgStep === null || state.status === "finished" || !validKg(action.kg)) return state;
      return { ...state, kg: action.kg };
    }
    case "stepKg": {
      const ex = state.exercises[state.exerciseIndex];
      if (!ex || ex.kgStep === null || state.status === "finished") return state;
      const kg = Math.max(0, Math.round(((state.kg ?? 0) + action.direction * ex.kgStep) * 100) / 100);
      return { ...state, kg };
    }
    case "setReps":
      return state.status === "finished" ? state : { ...state, reps: Math.max(0, Math.trunc(action.reps)) };
    case "stepReps":
      return state.status === "finished" ? state : { ...state, reps: Math.max(0, state.reps + action.direction) };

    case "logSet": {
      if (state.status !== "working") return state;
      const ex = state.exercises[state.exerciseIndex];
      if (!ex || !validReps(state.reps) || !validKg(state.kg)) return state;
      const entry: PlayerLog = {
        exerciseId: ex.exerciseId,
        setIndex: state.setIndex,
        kg: ex.kgStep === null ? null : state.kg,
        reps: state.reps,
        rir: null,
        loggedAt: action.now,
      };
      const logs = [...state.logs.filter((l) => !(l.exerciseId === entry.exerciseId && l.setIndex === entry.setIndex)), entry];
      const lastLogged = { exerciseId: entry.exerciseId, setIndex: entry.setIndex };
      const next = findNext(state.exercises, logs, state.exerciseIndex, state.setIndex + 1);
      if (!next) return { ...state, logs, lastLogged, status: "finished", restEndsAt: null, restTotalSec: 0 };
      const [e, s] = next;
      const inputs = e === state.exerciseIndex ? { kg: entry.kg, reps: entry.reps } : inputsFor(state.exercises[e], logs);
      return {
        ...state,
        logs,
        lastLogged,
        status: "resting",
        exerciseIndex: e,
        setIndex: s,
        restEndsAt: action.now + ex.restSec * 1000,
        restTotalSec: ex.restSec,
        ...inputs,
      };
    }

    case "answerRir": {
      if ((state.status !== "resting" && state.status !== "finished") || !state.lastLogged) return state;
      const { exerciseId, setIndex } = state.lastLogged;
      const rir = normalizeRir(action.rir);
      return { ...state, logs: state.logs.map((l) => (l.exerciseId === exerciseId && l.setIndex === setIndex ? { ...l, rir } : l)) };
    }

    case "tick":
      return state.status === "resting" && state.restEndsAt !== null && action.now >= state.restEndsAt ? endRest(state) : state;
    case "skipRest":
      return state.status === "resting" ? endRest(state) : state;
    case "adjustRest": {
      if (state.status !== "resting" || state.restEndsAt === null) return state;
      const delta = action.direction * REST_ADJUST_SEC;
      const ends = Math.min(state.restEndsAt + delta * 1000, action.now + REST_MAX_SEC * 1000);
      if (ends <= action.now) return endRest(state);
      const left = Math.ceil((ends - action.now) / 1000);
      return { ...state, restEndsAt: ends, restTotalSec: Math.max(left, Math.min(REST_MAX_SEC, Math.max(REST_MIN_SEC, state.restTotalSec + delta))) };
    }

    case "swapExercise": {
      const idx = state.exercises.findIndex((e) => e.slot === action.slot);
      if (idx < 0) return state;
      const exercises = state.exercises.map((e, i) => (i === idx ? { ...action.exercise, slot: action.slot } : e));
      const incomplete = findNext(exercises, state.logs, idx, 0);
      const target = exercises[idx];
      const mineIncomplete = incomplete && incomplete[0] === idx;
      if (idx === state.exerciseIndex && state.status !== "finished") {
        const s = mineIncomplete ? incomplete[1] : state.setIndex;
        return { ...state, exercises, setIndex: s, ...inputsFor(target, state.logs) };
      }
      if (state.status === "finished" && mineIncomplete) {
        return { ...state, exercises, status: "working", exerciseIndex: idx, setIndex: incomplete[1], restEndsAt: null, ...inputsFor(target, state.logs) };
      }
      return { ...state, exercises };
    }

    case "editSet": {
      if (!validReps(action.reps) || !validKg(action.kg)) return state;
      const found = state.logs.some((l) => l.exerciseId === action.exerciseId && l.setIndex === action.setIndex);
      if (!found) return state;
      return {
        ...state,
        logs: state.logs.map((l) => (l.exerciseId === action.exerciseId && l.setIndex === action.setIndex ? { ...l, kg: action.kg, reps: action.reps } : l)),
      };
    }

    case "dismissWarmup":
      return state.warmup ? { ...state, warmup: { ...state.warmup, dismissed: true } } : state;
  }
}
