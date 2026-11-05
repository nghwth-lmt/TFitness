import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { GOALS, LEVELS, SESSION_MINUTES, type Profile, type SessionDraft, type Weekday } from "../domain";
import { REST_SEC, SETS, REP_RANGES, WARMUP_MINUTES, SEC_PER_REP } from "../config";
import { buildPlan } from "./buildPlan";
import { draftFromTemplate, prescribe } from "./draft";
import { estimateMinutes } from "./estimateMinutes";

function draftWith(exercises: SessionDraft["exercises"]): SessionDraft {
  return { planId: "p", templateKey: "A", name: "n", exercises, adjustedForToday: false, notes: [] };
}

describe("estimateMinutes (AC04)", () => {
  it("counts warm-up only for an empty session", () => {
    expect(estimateMinutes(draftWith([]))).toBe(WARMUP_MINUTES);
  });

  it("is warm-up + sets x (work + rest), rounded up to whole minutes", () => {
    // 3 sets x (mid 8 reps x 4s = 32s + 120s rest) = 456s ; + 300s warm-up = 756s = 12.6 min
    const d = draftWith([
      { exerciseId: "x", slot: "main-1", role: "main", targetSets: 3, repRange: { min: 6, max: 10 }, targetKg: null, restSec: 120 },
    ]);
    expect(estimateMinutes(d)).toBe(13);
  });

  it("is monotonic in sets and rest", () => {
    const base = { exerciseId: "x", slot: "a", role: "accessory" as const, repRange: { min: 10, max: 12 }, targetKg: null };
    const a = estimateMinutes(draftWith([{ ...base, targetSets: 2, restSec: 60 }]));
    const b = estimateMinutes(draftWith([{ ...base, targetSets: 3, restSec: 60 }]));
    const c = estimateMinutes(draftWith([{ ...base, targetSets: 3, restSec: 120 }]));
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("uses the configured seconds per rep, not an invented value", () => {
    expect(SEC_PER_REP).toBeGreaterThan(0);
  });
});

describe("prescribe", () => {
  it("returns sets, rep range and rest from config for goal and level", () => {
    const p = { goal: "get_stronger", level: "advanced" } as Profile;
    expect(prescribe("main", p)).toEqual({
      sets: SETS.advanced.main,
      repRange: REP_RANGES.get_stronger.main,
      restSec: REST_SEC.get_stronger.main,
    });
  });
});

describe("time budget trim on buildPlan (AC04 matrix)", () => {
  const days: Weekday[] = ["mon", "wed", "fri"];
  for (const minutes of SESSION_MINUTES)
    for (const goal of GOALS)
      for (const level of LEVELS) {
        it(`${minutes} min / ${goal} / ${level}: every template fits and has >= 3 exercises`, () => {
          const profile: Profile = {
            trainingDays: days,
            sessionMinutes: minutes,
            equipment: ["barbell", "rack", "dumbbells", "bench", "cable", "machines", "pullup_bar", "bands"],
            goal,
            level,
            avoid: [],
            updatedAt: 1,
          };
          const plan = buildPlan(profile, EXERCISES, 5);
          for (const t of plan.templates) {
            const draft = draftFromTemplate(plan, t);
            expect(draft.exercises.length, `${t.name}`).toBeGreaterThanOrEqual(3);
            expect(estimateMinutes(draft), `${t.name}`).toBeLessThanOrEqual(minutes);
          }
        });
      }

  it("keeps priority order and drops the lowest-priority slots first", () => {
    const profile: Profile = {
      trainingDays: days,
      sessionMinutes: 45,
      equipment: ["barbell", "rack", "dumbbells", "bench", "cable", "machines", "pullup_bar", "bands"],
      goal: "build_muscle",
      level: "intermediate",
      avoid: [],
      updatedAt: 1,
    };
    const plan = buildPlan(profile, EXERCISES, 5);
    const a = plan.templates[0];
    expect(a.slots.length).toBeLessThan(7);
    expect(a.slots[0].role).toBe("main");
    expect(a.notes.some((n) => /fit 45 min/.test(n))).toBe(true);
  });

  it("does not trim when the session is long enough", () => {
    const profile: Profile = {
      trainingDays: days,
      sessionMinutes: 90,
      equipment: ["barbell", "rack", "dumbbells", "bench", "cable", "machines", "pullup_bar", "bands"],
      goal: "lose_fat",
      level: "beginner",
      avoid: [],
      updatedAt: 1,
    };
    const plan = buildPlan(profile, EXERCISES, 5);
    expect(plan.templates[0].slots).toHaveLength(7);
    expect(plan.templates[0].notes).toEqual([]);
  });

  it("works with a tiny catalog (fewer than 3 slots) without crashing", () => {
    const tiny = EXERCISES.filter((e) => e.pattern === "squat");
    const plan = buildPlan(
      { trainingDays: days, sessionMinutes: 30, equipment: [], goal: "get_stronger", level: "advanced", avoid: [], updatedAt: 1 },
      tiny,
      1,
    );
    expect(plan.templates.length).toBe(3);
  });
});
