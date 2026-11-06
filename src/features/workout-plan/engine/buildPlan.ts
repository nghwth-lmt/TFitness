import { MAX_SPLIT_DAYS, MIN_TRAINING_DAYS } from "../config";
import { LEVELS, type Exercise, type MissingSlot, type Place, type Plan, type Profile, type SessionTemplate, type SplitId, type TemplateSlot } from "../domain";
import { availableExercises, levelAtMost } from "./availability";
import { profileForPlace } from "./places";
import { createRng } from "./prng";
import { trimTemplates } from "./trim";
import { SPLITS, TEMPLATE_KEYS, splitForDays, type SlotSpec } from "./splits";

export type SelectOptions = {
  /** Main lifts kept from the previous block, keyed by `${templateKey}:${slot}`. */
  keep?: Record<string, string>;
  /** Exercises to avoid for a slot when alternatives exist (rotation), keyed like `keep`. */
  exclude?: Record<string, string[]>;
};

export type BuildOptions = {
  createdAt?: number;
  id?: string;
  /** Default place: its gear replaces the profile gear (W32). */
  place?: Pick<Place, "equipment" | "dumbbellRange">;
};

function slotId(spec: SlotSpec, counters: { main: number; acc: number }): string {
  return spec.role === "main" ? `main-${++counters.main}` : `acc-${++counters.acc}`;
}

function levelDistance(ex: Exercise, level: Profile["level"]): number {
  return Math.abs(LEVELS.indexOf(level) - LEVELS.indexOf(ex.level));
}

/**
 * Picks an exercise for every slot of the split. Pure and deterministic: the PRNG is seeded by
 * `seed + blockIndex`, slots are visited in a fixed order and one draw is spent per slot.
 */
export function selectTemplates(
  profile: Profile,
  catalog: readonly Exercise[],
  split: SplitId,
  seed: number,
  blockIndex: number,
  options: SelectOptions = {},
): SessionTemplate[] {
  const rng = createRng(seed + blockIndex);
  const pool = availableExercises(catalog, profile.equipment).filter(
    (e) => levelAtMost(e.level, profile.level) && !e.avoidFlags.some((a) => profile.avoid.includes(a)),
  );
  const usedInPlan = new Set<string>();

  return SPLITS[split].map((spec, index) => {
    const key = TEMPLATE_KEYS[index];
    const slots: TemplateSlot[] = [];
    const notes: string[] = [];
    const missing: MissingSlot[] = [];
    const usedInTemplate = new Set<string>();
    const counters = { main: 0, acc: 0 };

    for (const s of spec.slots) {
      const slot = slotId(s, counters);
      const draw = rng(); // one draw per slot keeps later slots stable
      const kept = options.keep?.[`${key}:${slot}`];
      const keptEx = kept ? pool.find((e) => e.id === kept) : undefined;
      let chosen: Exercise | undefined;

      if (keptEx && !usedInTemplate.has(keptEx.id)) {
        chosen = keptEx;
      } else {
        const base = pool.filter(
          (e) =>
            e.pattern === s.pattern &&
            (s.role === "main" ? e.role !== "accessory" : e.role !== "main") &&
            !usedInTemplate.has(e.id),
        );
        const byMuscle = s.muscle ? base.filter((e) => e.muscles.includes(s.muscle!)) : base;
        let cands = byMuscle.length ? byMuscle : base;
        const excluded = options.exclude?.[`${key}:${slot}`] ?? [];
        const fresh = cands.filter((e) => !usedInPlan.has(e.id) && !excluded.includes(e.id));
        if (fresh.length) cands = fresh;
        else {
          const notExcluded = cands.filter((e) => !excluded.includes(e.id));
          if (notExcluded.length) cands = notExcluded;
        }
        if (cands.length) {
          const score = (e: Exercise) => [levelDistance(e, profile.level), s.role === "main" && e.loadType === "bodyweight" ? 1 : 0];
          const best = cands.reduce((m, e) => {
            const a = score(e);
            const b = score(m);
            return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? e : m;
          });
          const sb = score(best);
          const top = cands.filter((e) => {
            const x = score(e);
            return x[0] === sb[0] && x[1] === sb[1];
          });
          chosen = top[Math.floor(draw * top.length)];
        }
      }

      if (!chosen) {
        notes.push(`No exercise available for ${s.pattern.replace("_", " ")} (${s.role}); slot skipped.`);
        missing.push({ slot, pattern: s.pattern, role: s.role });
        continue;
      }
      usedInTemplate.add(chosen.id);
      usedInPlan.add(chosen.id);
      slots.push({ slot, pattern: s.pattern, role: s.role, exerciseId: chosen.id });
    }
    return { key, name: spec.name, slots, notes, ...(missing.length ? { missing } : {}) };
  });
}

export function buildPlan(
  input: Profile,
  catalog: readonly Exercise[],
  seed: number,
  options: BuildOptions = {},
): Plan {
  const profile = options.place ? profileForPlace(input, options.place) : input;
  if (profile.trainingDays.length < MIN_TRAINING_DAYS) throw new RangeError("Pick at least 2 days");
  if (profile.trainingDays.length > MAX_SPLIT_DAYS) throw new RangeError("Pick at most 6 days");
  const split = splitForDays(profile.trainingDays.length);
  const createdAt = options.createdAt ?? profile.updatedAt;
  return {
    id: options.id ?? `plan_${seed.toString(36)}_${createdAt.toString(36)}`,
    status: "active",
    split,
    profile,
    templates: trimTemplates(selectTemplates(profile, catalog, split, seed, 0), profile),
    blockIndex: 0,
    blockStartedAtCompletedCount: 0,
    cursor: 0,
    seed,
    createdAt,
  };
}
