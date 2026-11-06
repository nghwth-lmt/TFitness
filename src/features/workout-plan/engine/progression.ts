import { BODYWEIGHT_REP_CAP, BODYWEIGHT_REP_STEP, LOAD_STEP_KG, PROGRESS_STREAK, STALL_STREAK } from "../config";
import type { DumbbellRange, History, LoadType, RepRange, Rir, SetLog } from "../domain";

export const FIRST_TIME_HINT = "Pick a weight you could lift 2–3 more reps";
export const STALL_HINT = "Try 10% lighter next time";
export const MAX_WEIGHT_HINT = "Top of your dumbbell range: add reps or try a harder variation";
export const HARDER_VARIATION_HINT = "Try a harder variation";

export type ProgressionResult = {
  targetKg: number | null;
  /** Bodyweight exercises only. */
  targetReps?: number;
  hint?: string;
  stalled?: boolean;
};

/** Turns an answer into a stored RIR. Blank or invalid is `null`, never 0. */
export function normalizeRir(value: unknown): Rir | null {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : null;
}

type SessionSets = { sessionId: string; at: number; sets: SetLog[] };

/** Groups logs by session, newest first. Order comes from `loggedAt`, never from array order. */
function recentSessions(logs: readonly SetLog[], exerciseId: string, count: number): SessionSets[] {
  const by = new Map<string, SessionSets>();
  for (const l of logs) {
    if (l.exerciseId !== exerciseId) continue;
    const e = by.get(l.sessionId) ?? { sessionId: l.sessionId, at: 0, sets: [] };
    e.at = Math.max(e.at, l.loggedAt);
    e.sets.push(l);
    by.set(l.sessionId, e);
  }
  return [...by.values()].sort((a, b) => b.at - a.at).slice(0, count);
}

function nextDumbbellKg(current: number, range?: DumbbellRange): number | null {
  if (!range) return current + LOAD_STEP_KG.dumbbell;
  const eps = 1e-9;
  let next = range.min;
  while (next <= current + eps) next += range.step;
  return next <= range.max + eps ? next : null;
}

/**
 * Double progression for one exercise (PRD section 6). `logs` must come from `completed`
 * sessions only (see `progressionFromHistory`). Looks at the two most recent sessions.
 */
export function progression(
  exerciseId: string,
  logs: readonly SetLog[],
  repRange: RepRange,
  loadType: LoadType,
  dumbbellRange?: DumbbellRange,
): ProgressionResult {
  if (loadType === "bodyweight") {
    const [last] = recentSessions(logs, exerciseId, 1);
    if (!last) return { targetKg: null, targetReps: repRange.min };
    const weakest = Math.min(...last.sets.map((s) => s.reps));
    if (weakest >= BODYWEIGHT_REP_CAP) return { targetKg: null, targetReps: BODYWEIGHT_REP_CAP, hint: HARDER_VARIATION_HINT };
    return { targetKg: null, targetReps: Math.max(repRange.min, weakest + BODYWEIGHT_REP_STEP) };
  }

  const weighted = logs.filter((l) => l.kg !== null);
  const sessions = recentSessions(weighted, exerciseId, Math.max(PROGRESS_STREAK, STALL_STREAK));
  if (sessions.length === 0) return { targetKg: null, hint: FIRST_TIME_HINT };

  const loadOf = (s: SessionSets) => Math.max(...s.sets.map((x) => x.kg as number));
  const latest = sessions[0];
  const current = loadOf(latest);

  const hitTop = (s: SessionSets) => s.sets.every((x) => x.kg === loadOf(s) && x.reps >= repRange.max);
  const recent = sessions.slice(0, PROGRESS_STREAK);
  if (
    recent.length === PROGRESS_STREAK &&
    recent.every((s) => hitTop(s) && loadOf(s) === current)
  ) {
    const step = loadType === "dumbbell" ? undefined : LOAD_STEP_KG[loadType];
    const next = step === undefined ? nextDumbbellKg(current, dumbbellRange) : current + step;
    return next === null ? { targetKg: current, hint: MAX_WEIGHT_HINT } : { targetKg: next };
  }

  const belowMin = (s: SessionSets) => s.sets.some((x) => x.reps < repRange.min);
  const stallWindow = sessions.slice(0, STALL_STREAK);
  if (stallWindow.length === STALL_STREAK && stallWindow.every(belowMin)) {
    return { targetKg: current, hint: STALL_HINT, stalled: true };
  }
  return { targetKg: current };
}

/** Same as `progression` but picks the exercise's logs out of completed sessions only. */
export function progressionFromHistory(
  exerciseId: string,
  history: History,
  repRange: RepRange,
  loadType: LoadType,
  dumbbellRange?: DumbbellRange,
): ProgressionResult {
  const completed = new Set(history.sessions.filter((s) => s.status === "completed").map((s) => s.id));
  const own = history.setLogs.filter((l) => l.exerciseId === exerciseId && completed.has(l.sessionId));
  // A session finished early (W28) can hold fewer sets of this exercise than planned. Those sets do not
  // show that the whole top of the range was reached, so they do not move the load or flag a stall.
  const planned = new Map<string, number>();
  for (const s of history.sessions) {
    const e = s.exercises.find((x) => x.exerciseId === exerciseId);
    if (e && completed.has(s.id)) planned.set(s.id, e.targetSets);
  }
  const count = new Map<string, number>();
  for (const l of own) count.set(l.sessionId, (count.get(l.sessionId) ?? 0) + 1);
  const logs = own.filter((l) => (count.get(l.sessionId) ?? 0) >= (planned.get(l.sessionId) ?? 0));
  return progression(exerciseId, logs, repRange, loadType, dumbbellRange);
}
