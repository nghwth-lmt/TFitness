import { MIN_EXERCISES_PER_SESSION, WARMUP_MINUTES } from "../config";
import type { Profile, SessionTemplate, TemplateSlot } from "../domain";
import { prescribe } from "./draft";
import { exerciseSeconds } from "./estimateMinutes";

function cost(slot: TemplateSlot, profile: Profile): number {
  const p = prescribe(slot.role, profile);
  return exerciseSeconds(slot.sets ?? p.sets, p.repRange, p.restSec);
}

/**
 * Cuts a template to the time budget (PRD section 6): fill slots in priority order and stop at the
 * first one that would overflow, but always keep at least 3 exercises; if those 3 still overflow,
 * lower the sets of the largest (latest on ties) one set at a time, down to 2, then to 1.
 */
export function trimTemplate(template: SessionTemplate, profile: Profile): SessionTemplate {
  const budget = profile.sessionMinutes * 60 - WARMUP_MINUTES * 60;
  const kept: TemplateSlot[] = [];
  let used = 0;
  for (const slot of template.slots) {
    const c = cost(slot, profile);
    if (used + c <= budget || kept.length < MIN_EXERCISES_PER_SESSION) {
      kept.push({ ...slot });
      used += c;
    } else break;
  }

  const total = () => kept.reduce((s, k) => s + cost(k, profile), 0);
  for (const floor of [2, 1]) {
    while (total() > budget) {
      const setsOf = (k: TemplateSlot) => k.sets ?? prescribe(k.role, profile).sets;
      let target = -1;
      kept.forEach((k, i) => {
        if (setsOf(k) > floor && (target < 0 || setsOf(k) >= setsOf(kept[target]))) target = i;
      });
      if (target < 0) break;
      kept[target].sets = setsOf(kept[target]) - 1;
    }
  }

  const dropped = template.slots.length - kept.length;
  const reduced = kept.some((k) => k.sets !== undefined);
  const notes = [...template.notes];
  if (dropped > 0 || reduced) {
    notes.push(`Trimmed to fit ${profile.sessionMinutes} min${dropped > 0 ? `: ${dropped} exercise${dropped > 1 ? "s" : ""} left out` : ""}.`);
  }
  return { ...template, slots: kept, notes };
}

export function trimTemplates(templates: SessionTemplate[], profile: Profile): SessionTemplate[] {
  return templates.map((t) => trimTemplate(t, profile));
}
