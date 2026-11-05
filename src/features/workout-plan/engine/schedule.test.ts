import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type History, type Plan, type Profile, type Session, type Weekday } from "../domain";
import { buildPlan } from "./buildPlan";
import { completedCount, completeSession, isNewBlockStart, nextSession, rotateBlockIfDue } from "./schedule";

const ALL_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

function profile(days = 3, over: Partial<Profile> = {}): Profile {
  return {
    trainingDays: ALL_DAYS.slice(0, days),
    sessionMinutes: 60,
    equipment: [...EQUIPMENT_IDS],
    goal: "build_muscle",
    level: "intermediate",
    avoid: [],
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

const EMPTY: History = { sessions: [], setLogs: [] };

function session(plan: Plan, status: Session["status"], templateKey: string, id: string): Session {
  return {
    id,
    planId: plan.id,
    templateKey,
    name: templateKey,
    exercises: [],
    adjustedForToday: false,
    notes: [],
    status,
    startedAt: 1,
    finishedAt: status === "completed" ? 2 : null,
  };
}

describe("nextSession and the cursor loop (AC06, W02)", () => {
  it("returns the first template of a new plan with sets, reps and rest from config", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    const draft = nextSession(plan, EMPTY);
    expect(draft.templateKey).toBe("A");
    expect(draft.name).toBe("Full body A");
    expect(draft.planId).toBe(plan.id);
    expect(draft.exercises.length).toBeGreaterThanOrEqual(3);
    for (const e of draft.exercises) {
      expect(e.targetSets).toBeGreaterThan(0);
      expect(e.repRange.min).toBeLessThanOrEqual(e.repRange.max);
      expect(e.restSec).toBeGreaterThan(0);
    }
  });

  it("completing A moves to B, then C, then wraps to A", () => {
    let plan = buildPlan(profile(), EXERCISES, 3);
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) {
      const draft = nextSession(plan, EMPTY);
      keys.push(draft.templateKey);
      plan = completeSession(plan, session(plan, "completed", draft.templateKey, `s${i}`));
    }
    expect(keys).toEqual(["A", "B", "C", "A"]);
  });

  it("does not depend on the date: rest days never skip a session (AC06)", () => {
    let plan = buildPlan(profile(), EXERCISES, 3);
    plan = completeSession(plan, session(plan, "completed", "A", "s1"));
    const monday = nextSession(plan, EMPTY);
    const twoDaysLater = nextSession(plan, EMPTY);
    expect(monday.templateKey).toBe("B");
    expect(twoDaysLater).toEqual(monday);
  });

  it("abandoned and in-progress sessions do not advance the loop", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    expect(completeSession(plan, session(plan, "abandoned", "A", "s1")).cursor).toBe(0);
    expect(completeSession(plan, session(plan, "in_progress", "A", "s2")).cursor).toBe(0);
    expect(completeSession(plan, session(plan, "planned", "A", "s3")).cursor).toBe(0);
  });

  it("ignores a completed session that belongs to another plan or an unknown template", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    const other = buildPlan(profile(), EXERCISES, 4);
    expect(completeSession(plan, session(other, "completed", "A", "x")).cursor).toBe(0);
    expect(completeSession(plan, session(plan, "completed", "Z", "y")).cursor).toBe(0);
  });

  it("advances from the template that was actually trained", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    // user trained C although B was next: loop continues after C
    expect(completeSession(plan, session(plan, "completed", "C", "s")).cursor).toBe(0);
  });

  it("does not mutate its input", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    const snap = JSON.stringify(plan);
    completeSession(plan, session(plan, "completed", "A", "s"));
    nextSession(plan, EMPTY);
    expect(JSON.stringify(plan)).toBe(snap);
  });
});

describe("completedCount", () => {
  it("counts only completed sessions of that plan (abandoned never count)", () => {
    const plan = buildPlan(profile(), EXERCISES, 3);
    const other = buildPlan(profile(), EXERCISES, 4);
    const sessions = [
      session(plan, "completed", "A", "1"),
      session(plan, "abandoned", "B", "2"),
      session(plan, "in_progress", "B", "3"),
      session(other, "completed", "A", "4"),
      session(plan, "completed", "B", "5"),
    ];
    expect(completedCount(sessions, plan)).toBe(2);
  });
});

describe("rotateBlockIfDue (AC12, W11)", () => {
  it("does nothing before 4 x days sessions", () => {
    const plan = buildPlan(profile(3), EXERCISES, 9);
    expect(rotateBlockIfDue(plan, 11)).toBe(plan);
    expect(isNewBlockStart(plan, 0)).toBe(false);
  });

  it("at 12 completed sessions (3 days) starts block 1: mains kept, accessories changed", () => {
    const plan = buildPlan(profile(3), EXERCISES, 9);
    const next = rotateBlockIfDue(plan, 12);
    expect(next.blockIndex).toBe(1);
    expect(next.blockStartedAtCompletedCount).toBe(12);
    expect(next.cursor).toBe(plan.cursor);
    expect(next.templates.map((t) => t.key)).toEqual(plan.templates.map((t) => t.key));
    let changed = 0;
    plan.templates.forEach((t, i) =>
      t.slots.forEach((s, j) => {
        const n = next.templates[i].slots[j];
        expect(n.slot).toBe(s.slot);
        expect(n.role).toBe(s.role);
        if (s.role === "main") expect(n.exerciseId, `${t.key}:${s.slot}`).toBe(s.exerciseId);
        else if (n.exerciseId !== s.exerciseId) changed++;
      }),
    );
    expect(changed).toBeGreaterThanOrEqual(1);
    expect(isNewBlockStart(next, 12)).toBe(true);
    expect(isNewBlockStart(next, 13)).toBe(false);
  });

  it("block length follows the number of days (2 days = 8 sessions)", () => {
    const plan = buildPlan(profile(2), EXERCISES, 9);
    expect(rotateBlockIfDue(plan, 7)).toBe(plan);
    expect(rotateBlockIfDue(plan, 8).blockIndex).toBe(1);
  });

  it("is deterministic and keeps slot counts", () => {
    const plan = buildPlan(profile(4), EXERCISES, 21);
    const a = rotateBlockIfDue(plan, 16);
    const b = rotateBlockIfDue(plan, 16);
    expect(b).toEqual(a);
    expect(a.templates.map((t) => t.slots.length)).toEqual(plan.templates.map((t) => t.slots.length));
  });

  it("rotates again one block later and measures from the new block start", () => {
    const plan = buildPlan(profile(3), EXERCISES, 9);
    const b1 = rotateBlockIfDue(plan, 12);
    expect(rotateBlockIfDue(b1, 23)).toBe(b1);
    expect(rotateBlockIfDue(b1, 24).blockIndex).toBe(2);
  });

  it("does not use Math.random", () => {
    const plan = buildPlan(profile(3), EXERCISES, 9);
    const orig = Math.random;
    Math.random = () => {
      throw new Error("Math.random called");
    };
    try {
      expect(() => rotateBlockIfDue(plan, 12)).not.toThrow();
    } finally {
      Math.random = orig;
    }
  });

  it("with no alternative exercise it keeps the plan valid instead of crashing", () => {
    const only = EXERCISES.filter((e) => e.pattern === "squat" && e.loadType === "bodyweight");
    const plan = buildPlan(profile(3, { equipment: [] }), only, 1);
    expect(() => rotateBlockIfDue(plan, 12, only)).not.toThrow();
  });
});
