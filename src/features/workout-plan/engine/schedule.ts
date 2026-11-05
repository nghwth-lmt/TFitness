import { BLOCK_WEEKS } from "../config";
import { EXERCISES } from "../data/exercises";
import type { Exercise, History, Plan, Session, SessionDraft } from "../domain";
import { draftFromTemplate } from "./draft";
import { selectTemplates } from "./buildPlan";
import { trimTemplates } from "./trim";

/**
 * Next session = the template at `plan.cursor` (W02). The loop does not look at dates, so a rest
 * day or a missed week never skips a template. Weights are attached from `history` by WL-06.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function nextSession(plan: Plan, _history: History): SessionDraft {
  if (plan.templates.length === 0) throw new RangeError("Plan has no templates");
  const template = plan.templates[plan.cursor % plan.templates.length];
  return draftFromTemplate(plan, template);
}

/** `completed` sessions of this plan. `abandoned` and `in_progress` never count. */
export function completedCount(sessions: readonly Session[], plan: Pick<Plan, "id">): number {
  return sessions.filter((s) => s.planId === plan.id && s.status === "completed").length;
}

/**
 * Pushes the loop on after a session. Only a `completed` session of this plan moves the cursor,
 * to the template after the one that was trained.
 */
export function completeSession(plan: Plan, session: Pick<Session, "planId" | "status" | "templateKey">): Plan {
  if (session.status !== "completed" || session.planId !== plan.id) return plan;
  const index = plan.templates.findIndex((t) => t.key === session.templateKey);
  if (index < 0) return plan;
  return { ...plan, cursor: (index + 1) % plan.templates.length };
}

export function blockLength(plan: Pick<Plan, "profile">): number {
  return BLOCK_WEEKS * plan.profile.trainingDays.length;
}

/** True on the first session of a block after the first (Today shows "New block"). */
export function isNewBlockStart(plan: Pick<Plan, "blockIndex" | "blockStartedAtCompletedCount">, completed: number): boolean {
  return plan.blockIndex > 0 && completed === plan.blockStartedAtCompletedCount;
}

/**
 * Starts a new block once `4 x days` sessions are completed in this one (W11): main lifts stay,
 * accessories change. `completed` is the count of `completed` sessions of this plan.
 */
export function rotateBlockIfDue(plan: Plan, completed: number, catalog: readonly Exercise[] = EXERCISES): Plan {
  let current = plan;
  while (completed - current.blockStartedAtCompletedCount >= blockLength(current)) {
    const keep: Record<string, string> = {};
    const exclude: Record<string, string[]> = {};
    for (const t of current.templates)
      for (const s of t.slots) {
        if (s.role === "main") keep[`${t.key}:${s.slot}`] = s.exerciseId;
        else exclude[`${t.key}:${s.slot}`] = [s.exerciseId];
      }
    const blockIndex = current.blockIndex + 1;
    current = {
      ...current,
      blockIndex,
      blockStartedAtCompletedCount: current.blockStartedAtCompletedCount + blockLength(current),
      templates: trimTemplates(
        selectTemplates(current.profile, catalog, current.split, current.seed, blockIndex, { keep, exclude }),
        current.profile,
      ),
    };
  }
  return current;
}
