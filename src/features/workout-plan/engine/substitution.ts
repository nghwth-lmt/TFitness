import { LEVELS, type EquipmentId, type Exercise, type History, type Profile, type SessionDraft, type SessionExercise } from "../domain";
import { levelAtMost, isDoable } from "./availability";
import { progressionFromHistory } from "./progression";

const EMPTY_HISTORY: History = { sessions: [], setLogs: [] };

function allowed(e: Exercise, equipment: readonly EquipmentId[], profile: Profile): boolean {
  return isDoable(e, equipment) && levelAtMost(e.level, profile.level) && !e.avoidFlags.some((a) => profile.avoid.includes(a));
}

/** Same pattern, fits the slot role, and not already in the session. */
function sameKind(e: Exercise, original: Exercise, role: SessionExercise["role"], taken: ReadonlySet<string>): boolean {
  return e.pattern === original.pattern && (role === "main" ? e.role !== "accessory" : e.role !== "main") && !taken.has(e.id);
}

/** Best first: closest level, loaded over bodyweight for main lifts, most shared muscles, then id. */
function ranked(list: Exercise[], original: Exercise, role: SessionExercise["role"], profile: Profile): Exercise[] {
  const key = (e: Exercise) => [
    Math.abs(LEVELS.indexOf(profile.level) - LEVELS.indexOf(e.level)),
    role === "main" && e.loadType === "bodyweight" ? 1 : 0,
    -e.muscles.filter((m) => original.muscles.includes(m)).length,
  ];
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function withProgression(base: SessionExercise, ex: Exercise, profile: Profile, history: History): SessionExercise {
  const p = progressionFromHistory(ex.id, history, base.repRange, ex.loadType, profile.dumbbellRange);
  const rest: SessionExercise = { ...base };
  delete rest.hint;
  delete rest.targetReps;
  return {
    ...rest,
    exerciseId: ex.id,
    targetKg: p.targetKg,
    ...(p.targetReps !== undefined ? { targetReps: p.targetReps } : {}),
    ...(p.hint !== undefined ? { hint: p.hint } : {}),
  };
}

/**
 * "What do I have today?" (W05): swaps exercises that today's equipment cannot do for one of the same
 * movement pattern. Works on this session only; call it with the original draft each time so
 * re-ticking equipment restores the plan. A slot with no substitute is dropped with a note.
 */
export function adjustForToday(
  draft: SessionDraft,
  todayEquipment: readonly EquipmentId[],
  catalog: readonly Exercise[],
  profile: Profile,
  history: History = EMPTY_HISTORY,
): SessionDraft {
  const taken = new Set(draft.exercises.map((e) => e.exerciseId));
  const exercises: SessionExercise[] = [];
  const notes = [...draft.notes];
  let changed = false;

  for (const item of draft.exercises) {
    const original = catalog.find((c) => c.id === item.exerciseId);
    if (!original || isDoable(original, todayEquipment)) {
      exercises.push(item);
      continue;
    }
    changed = true;
    const pool = catalog.filter((c) => allowed(c, todayEquipment, profile) && sameKind(c, original, item.role, taken));
    const [best] = ranked(pool, original, item.role, profile);
    if (!best) {
      notes.push(`No substitute for ${original.name} today; skipped.`);
      continue;
    }
    taken.add(best.id);
    exercises.push(withProgression(item, best, profile, history));
  }

  return { ...draft, exercises, notes, todayEquipment: [...todayEquipment], adjustedForToday: changed };
}

/** Exercises the player can offer for the Swap sheet (D2): same pattern, allowed, not already used. */
export function swapCandidates(
  draft: SessionDraft,
  exerciseId: string,
  catalog: readonly Exercise[],
  profile: Profile,
): Exercise[] {
  const item = draft.exercises.find((e) => e.exerciseId === exerciseId);
  const original = catalog.find((c) => c.id === exerciseId);
  if (!item || !original) return [];
  const equipment = draft.todayEquipment ?? profile.equipment;
  const taken = new Set(draft.exercises.map((e) => e.exerciseId));
  const pool = catalog.filter((c) => allowed(c, equipment, profile) && sameKind(c, original, item.role, taken));
  return ranked(pool, original, item.role, profile);
}

/** Puts `newExerciseId` in the slot. Other exercises stay exactly as they were. */
export function applySwap(
  draft: SessionDraft,
  slot: string,
  newExerciseId: string,
  catalog: readonly Exercise[],
  profile: Profile,
  history: History = EMPTY_HISTORY,
): SessionDraft {
  const index = draft.exercises.findIndex((e) => e.slot === slot);
  if (index < 0) throw new RangeError(`Unknown slot ${slot}`);
  const current = draft.exercises[index];
  const pick = swapCandidates(draft, current.exerciseId, catalog, profile).find((c) => c.id === newExerciseId);
  if (!pick) throw new RangeError(`${newExerciseId} is not a valid swap for ${current.exerciseId}`);
  const exercises = draft.exercises.map((e, i) => (i === index ? withProgression(e, pick, profile, history) : e));
  return { ...draft, exercises };
}
