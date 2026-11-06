import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, type EquipmentId, type Plan, type Profile, type Session, type SetLog, type Weekday } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { rotateBlockIfDue } from "../engine/schedule";
import { buildTodayVM, localWeekday, weekStartUtc } from "./today";

const OFFSET = 420; // UTC+7
const at = (y: number, m: number, d: number, h = 12, min = 0) => Date.UTC(y, m - 1, d, h, min) - OFFSET * 60_000;

function profile(over: Partial<Profile> = {}): Profile {
  return {
    trainingDays: ["mon", "wed", "fri"] as Weekday[],
    sessionMinutes: 60,
    equipment: [...EQUIPMENT_IDS],
    goal: "build_muscle",
    level: "intermediate",
    avoid: [],
    updatedAt: 1,
    ...over,
  };
}

function session(plan: Plan, status: Session["status"], key: string, id: string, over: Partial<Session> = {}): Session {
  const t = plan.templates.find((x) => x.key === key)!;
  return {
    id,
    planId: plan.id,
    templateKey: key,
    name: t.name,
    adjustedForToday: false,
    notes: [],
    exercises: t.slots.map((s) => ({ exerciseId: s.exerciseId, slot: s.slot, role: s.role, targetSets: 3, repRange: { min: 8, max: 12 }, targetKg: null, restSec: 90 })),
    status,
    startedAt: 1_000,
    finishedAt: status === "completed" ? 2_000 : null,
    ...over,
  };
}

const base = (p = profile()) => ({ profile: p, plan: buildPlan(p, EXERCISES, 4), sessions: [] as Session[], setLogs: [] as SetLog[], now: at(2026, 11, 5), utcOffsetMin: OFFSET });

describe("time: device timezone, week starts Monday (W20)", () => {
  it("maps a moment to the local weekday", () => {
    expect(localWeekday(at(2026, 11, 5, 9), OFFSET)).toBe("thu");
    expect(localWeekday(at(2026, 11, 8, 23, 59), OFFSET)).toBe("sun");
    expect(localWeekday(at(2026, 11, 9, 0, 0), OFFSET)).toBe("mon");
    expect(localWeekday(at(2026, 11, 9, 0, 0), 0)).toBe("sun"); // same instant is still Sunday in UTC
  });

  it("week starts on Monday 00:00 local", () => {
    expect(weekStartUtc(at(2026, 11, 8, 23, 59), OFFSET)).toBe(at(2026, 11, 2, 0, 0));
    expect(weekStartUtc(at(2026, 11, 9, 0, 0), OFFSET)).toBe(at(2026, 11, 9, 0, 0));
  });
});

describe("getTodayVM priority: Resume > Next > New block (PRD section 5)", () => {
  it("no profile or no plan: needs setup", () => {
    expect(buildTodayVM({ ...base(), profile: undefined })).toEqual({ kind: "needs_setup" });
    expect(buildTodayVM({ ...base(), plan: undefined })).toEqual({ kind: "needs_setup" });
  });

  it("an in-progress session is the single top item (Resume), ahead of the next session", () => {
    const b = base();
    const open = session(b.plan, "in_progress", "A", "s1");
    const logs: SetLog[] = [0, 1].map((i) => ({ id: `l${i}`, sessionId: "s1", exerciseId: open.exercises[0].exerciseId, setIndex: i, kg: 40, reps: 8, rir: null, loggedAt: 5 + i }));
    const vm = buildTodayVM({ ...b, sessions: [open], setLogs: logs });
    expect(vm.kind).toBe("resume");
    if (vm.kind !== "resume") return;
    expect(vm.session.id).toBe("s1");
    expect(vm.loggedSets).toBe(2);
    expect(vm.totalSets).toBe(open.exercises.length * 3);
  });

  it("Resume wins even when a new block is due", () => {
    const b = base();
    const rotated = rotateBlockIfDue(b.plan, 12);
    const done = Array.from({ length: 12 }, (_, i) => session(b.plan, "completed", "A", `c${i}`));
    const vm = buildTodayVM({ ...b, plan: rotated, sessions: [...done, session(b.plan, "in_progress", "A", "open")] });
    expect(vm.kind).toBe("resume");
  });

  it("otherwise the next session with a Start action, name, exercises and estimate", () => {
    const vm = buildTodayVM(base());
    expect(vm.kind).toBe("next");
    if (vm.kind !== "next") return;
    expect(vm.draft.templateKey).toBe("A");
    expect(vm.exerciseCount).toBeGreaterThanOrEqual(3);
    expect(vm.estimatedMinutes).toBeGreaterThan(0);
    expect(vm.estimatedMinutes).toBeLessThanOrEqual(60);
    expect(vm.newBlock).toBe(false);
    expect(vm.adjustedForToday).toBe(false);
    for (const row of vm.exercises) {
      expect(row.name).toBe(getExercise(row.exerciseId)!.name);
      expect(row.cue.length).toBeGreaterThan(0);
      expect(row.sets).toBeGreaterThan(0);
    }
  });

  it("rest days never skip a template (AC06): finishing A then opening 2 days later still shows B", () => {
    const b = base();
    const plan = { ...b.plan, cursor: 1 };
    const sessions = [session(b.plan, "completed", "A", "s1", { finishedAt: at(2026, 11, 2, 18) })];
    const vm = buildTodayVM({ ...b, plan, sessions, now: at(2026, 11, 4, 9) }); // Wednesday, two days later
    expect(vm.kind).toBe("next");
    if (vm.kind === "next") expect(vm.draft.templateKey).toBe("B");
  });

  it("flags a rest day when today is not a training day, but still offers the session", () => {
    const sat = buildTodayVM({ ...base(), now: at(2026, 11, 7, 10) });
    expect(sat.kind === "next" && sat.restDay).toBe(true);
    expect(sat.kind === "next" && sat.weekday).toBe("sat");
    const mon = buildTodayVM({ ...base(), now: at(2026, 11, 9, 10) });
    expect(mon.kind === "next" && mon.restDay).toBe(false);
  });

  it("shows the New block notice only on the first session of a block, not on later ones", () => {
    const b = base();
    const rotated = rotateBlockIfDue(b.plan, 12);
    const done = Array.from({ length: 12 }, (_, i) => session(b.plan, "completed", "A", `c${i}`));
    const first = buildTodayVM({ ...b, plan: rotated, sessions: done });
    expect(first.kind === "next" && first.newBlock).toBe(true);
    const next = buildTodayVM({ ...b, plan: rotated, sessions: [...done, session(b.plan, "completed", "A", "c13")] });
    expect(next.kind === "next" && next.newBlock).toBe(false);
  });

  it("abandoned sessions are not counted for the block notice or the week", () => {
    const b = base();
    const rotated = rotateBlockIfDue(b.plan, 12);
    const done = Array.from({ length: 12 }, (_, i) => session(b.plan, "completed", "A", `c${i}`));
    const vm = buildTodayVM({ ...b, plan: rotated, sessions: [...done, session(b.plan, "abandoned", "A", "x", { finishedAt: b.now - 1000 })] });
    expect(vm.kind === "next" && vm.newBlock).toBe(true);
  });

  it("counts this week's completed sessions against the days per week", () => {
    const b = base();
    const mon = at(2026, 11, 2, 18);
    const lastWeek = at(2026, 10, 30, 18);
    const sessions = [
      session(b.plan, "completed", "A", "s1", { finishedAt: mon }),
      session(b.plan, "completed", "B", "s2", { finishedAt: lastWeek }),
      session(b.plan, "abandoned", "C", "s3", { finishedAt: mon }),
    ];
    const vm = buildTodayVM({ ...b, sessions });
    expect(vm.kind === "next" && vm.weekProgress).toEqual({ completed: 1, target: 3 });
  });
});

describe("What do I have today? (AC10) on the view model", () => {
  const eq: EquipmentId[] = ["barbell", "squat_rack", "dumbbells", "adjustable_bench"];
  it("removing the bench swaps bench lifts for today only and labels it", () => {
    const p = profile({ equipment: eq });
    const b = base(p);
    const normal = buildTodayVM(b);
    const noBenchEq: EquipmentId[] = eq.filter((e) => e !== "adjustable_bench");
    const noBench = buildTodayVM({ ...b, todayEquipment: noBenchEq });
    expect(normal.kind === "next" && normal.adjustedForToday).toBe(false);
    expect(noBench.kind).toBe("next");
    if (noBench.kind !== "next" || normal.kind !== "next") return;
    for (const row of noBench.exercises) expect(getExercise(row.exerciseId)!.equipment.some((and) => and.every((x) => noBenchEq.includes(x)))).toBe(true);
    if (normal.draft.exercises.some((e) => getExercise(e.exerciseId)!.equipment.every((and) => and.includes("adjustable_bench")))) {
      expect(noBench.adjustedForToday).toBe(true);
    }
    // the plan itself is untouched
    expect(buildTodayVM(b)).toEqual(normal);
  });
});
