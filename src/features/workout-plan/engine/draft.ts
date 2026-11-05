import { REP_RANGES, REST_SEC, SETS } from "../config";
import type { Plan, Profile, RepRange, SessionDraft, SessionExercise, SessionTemplate, SlotRole, TemplateSlot } from "../domain";

export type Prescription = { sets: number; repRange: RepRange; restSec: number };

/** Sets, rep range and rest for a role, all from config (goal and level). */
export function prescribe(role: SlotRole, profile: Pick<Profile, "goal" | "level">): Prescription {
  return {
    sets: SETS[profile.level][role],
    repRange: { ...REP_RANGES[profile.goal][role] },
    restSec: REST_SEC[profile.goal][role],
  };
}

export function sessionExerciseFromSlot(slot: TemplateSlot, profile: Profile): SessionExercise {
  const p = prescribe(slot.role, profile);
  return {
    exerciseId: slot.exerciseId,
    slot: slot.slot,
    role: slot.role,
    targetSets: slot.sets ?? p.sets,
    repRange: p.repRange,
    targetKg: null,
    restSec: p.restSec,
  };
}

/** Template to draft with no weights yet (nextSession adds targetKg from history). */
export function draftFromTemplate(plan: Plan, template: SessionTemplate): SessionDraft {
  return {
    planId: plan.id,
    templateKey: template.key,
    name: template.name,
    exercises: template.slots.map((s) => sessionExerciseFromSlot(s, plan.profile)),
    adjustedForToday: false,
    notes: [...template.notes],
  };
}
