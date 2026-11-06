import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Plan, type Profile, type Session, type SetLog, type Weekday } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { buildTodayVM, type TodayVM } from "./today";

const OFF = 420;
const days = (n: number): Weekday[] => (["mon", "wed", "fri", "sat", "tue", "thu"] as Weekday[]).slice(0, n);
const mkProfile = (n: number): Profile => ({ trainingDays: days(n), sessionMinutes: 60, equipment: [...EQUIPMENT_IDS], goal: "build_muscle", level: "intermediate", avoid: [], updatedAt: 1 });
const plan: Plan = buildPlan(mkProfile(3), EXERCISES, 4);

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0) => Date.UTC(y, m - 1, d, h, min, s, ms) - OFF * 60_000;
const sess = (id: string, finishedAt: number, status: Session["status"] = "completed"): Session => ({
  id, planId: plan.id, templateKey: "A", name: "A", exercises: [], adjustedForToday: false, notes: [], status, startedAt: finishedAt - 1000, finishedAt,
});
const log = (sessionId: string, exerciseId: string, kg: number | null, reps: number, i = 0): SetLog => ({ id: `${sessionId}-${exerciseId}-${i}`, sessionId, exerciseId, setIndex: i, kg, reps, rir: null, loggedAt: 1 });
const BENCH = "Dumbbell_Bench_Press";
const BODY = EXERCISES.find((e) => e.loadType === "bodyweight")!.id;

const stats = (now: number, sessions: Session[], setLogs: SetLog[], planned = 3) => {
  const p = mkProfile(planned);
  const vm: TodayVM = buildTodayVM({ profile: p, plan: { ...plan, profile: p }, sessions, setLogs, now, utcOffsetMin: OFF });
  if (vm.kind === "needs_setup") throw new Error("needs setup");
  return vm.weekStats;
};

describe("weekStats (W42, AC27)", () => {
  it("sample week: volume = sum kg x reps, sets, done/planned, delta vs last week", () => {
    // This week (2-8 Nov): s1 Mon, s2 Wed. Last week (26 Oct-1 Nov): p1.
    const sessions = [sess("s1", at(2026, 11, 2, 18)), sess("s2", at(2026, 11, 4, 18)), sess("p1", at(2026, 10, 28, 18))];
    const logs = [
      log("s1", BENCH, 20, 10, 0), log("s1", BENCH, 20, 8, 1), // 360
      log("s2", BENCH, 22.5, 10, 0), // 225
      log("p1", BENCH, 20, 10, 0), log("p1", BENCH, 20, 10, 1), // 400
    ];
    const s = stats(at(2026, 11, 5, 9), sessions, logs);
    expect(s.done).toBe(2);
    expect(s.planned).toBe(3);
    expect(s.volumeKg).toBe(585);
    expect(s.sets).toBe(3);
    expect(s.deltaVolumePct).toBe(46); // 585/400 = +46.25
    expect(s.deltaSetsPct).toBe(50); // 3 vs 2
  });

  it("bodyweight sets count kg as 0 and kg null never adds volume, but sets still count", () => {
    const sessions = [sess("s1", at(2026, 11, 2, 18))];
    const logs = [log("s1", BODY, null, 15, 0), log("s1", BODY, 10, 12, 1), log("s1", BENCH, 10, 10, 2)];
    const s = stats(at(2026, 11, 5, 9), sessions, logs);
    expect(s.volumeKg).toBe(100);
    expect(s.sets).toBe(3);
  });

  it("deltas are null when last week has no data (volume and sets separately)", () => {
    const s = stats(at(2026, 11, 5, 9), [sess("s1", at(2026, 11, 2, 18))], [log("s1", BENCH, 20, 10)]);
    expect(s.deltaVolumePct).toBeNull();
    expect(s.deltaSetsPct).toBeNull();
  });

  it("last week with only bodyweight sets: volume delta null (0), sets delta defined", () => {
    const sessions = [sess("s1", at(2026, 11, 2, 18)), sess("p1", at(2026, 10, 28, 18))];
    const logs = [log("s1", BENCH, 20, 10), log("p1", BODY, null, 12)];
    const s = stats(at(2026, 11, 5, 9), sessions, logs);
    expect(s.deltaVolumePct).toBeNull();
    expect(s.deltaSetsPct).toBe(0);
  });

  it("an empty week is all zeros with null deltas and no streak", () => {
    const s = stats(at(2026, 11, 5, 9), [], []);
    expect(s).toEqual({ done: 0, planned: 3, streakWeeks: 0, volumeKg: 0, sets: 0, deltaVolumePct: null, deltaSetsPct: null });
  });

  it("an empty week after a heavy one is -100%", () => {
    const s = stats(at(2026, 11, 5, 9), [sess("p1", at(2026, 10, 28, 18))], [log("p1", BENCH, 20, 10)]);
    expect(s.deltaVolumePct).toBe(-100);
    expect(s.deltaSetsPct).toBe(-100);
  });

  it("abandoned and in-progress sessions count for nothing (done, volume, sets, streak)", () => {
    const sessions = [sess("a", at(2026, 11, 2, 18), "abandoned"), sess("b", at(2026, 11, 3, 18), "in_progress")];
    const s = stats(at(2026, 11, 5, 9), sessions, [log("a", BENCH, 20, 10), log("b", BENCH, 20, 10)]);
    expect(s.done).toBe(0);
    expect(s.volumeKg).toBe(0);
    expect(s.sets).toBe(0);
  });

  it("an abandoned session last week does not make last week count", () => {
    const sessions = [sess("a", at(2026, 10, 28, 18), "abandoned")];
    const s = stats(at(2026, 11, 5, 9), sessions, [log("a", BENCH, 20, 10)]);
    expect(s.deltaVolumePct).toBeNull();
  });

  describe("streak", () => {
    const week = (prefix: string, mondayMs: number, n: number) => Array.from({ length: n }, (_, i) => sess(`${prefix}${i}`, mondayMs + i * 86_400_000 + 18 * 3_600_000));
    const mon = (y: number, m: number, d: number) => at(y, m, d, 0);

    it("counts consecutive finished weeks back from last week; the current week is not yet counted when short", () => {
      const sessions = [...week("a", mon(2026, 10, 26), 3), ...week("b", mon(2026, 10, 19), 3), ...week("c", mon(2026, 10, 5), 3)];
      expect(stats(at(2026, 11, 3, 9), sessions, []).streakWeeks).toBe(2); // week of 12 Oct is missing -> stops
    });

    it("adds the current week once it reaches the planned count", () => {
      const sessions = [...week("a", mon(2026, 10, 26), 3), ...week("n", mon(2026, 11, 2), 3)];
      expect(stats(at(2026, 11, 5, 9), sessions, []).streakWeeks).toBe(2);
    });

    it("a short current week does not break the streak of previous weeks", () => {
      const sessions = [...week("a", mon(2026, 10, 26), 3), ...week("n", mon(2026, 11, 2), 1)];
      expect(stats(at(2026, 11, 5, 9), sessions, []).streakWeeks).toBe(1);
    });

    it("a short previous week resets the streak to 0 even when older weeks were full", () => {
      const sessions = [...week("a", mon(2026, 10, 26), 2), ...week("b", mon(2026, 10, 19), 3)];
      expect(stats(at(2026, 11, 5, 9), sessions, []).streakWeeks).toBe(0);
    });

    it("more sessions than planned still count as reaching the target", () => {
      expect(stats(at(2026, 11, 5, 9), week("a", mon(2026, 10, 26), 5), []).streakWeeks).toBe(1);
    });

    it("abandoned sessions do not fill a week", () => {
      const sessions = [...week("a", mon(2026, 10, 26), 2), sess("x", at(2026, 10, 31, 18), "abandoned")];
      expect(stats(at(2026, 11, 5, 9), sessions, []).streakWeeks).toBe(0);
    });
  });

  describe("week boundary", () => {
    it("Sunday 23:59:59.999 is still the old week; Monday 00:00 starts a new empty week", () => {
      const sessions = [sess("s1", at(2026, 11, 2, 18)), sess("s2", at(2026, 11, 4, 18)), sess("s3", at(2026, 11, 6, 18))];
      const logs = [log("s1", BENCH, 20, 10)];
      const sun = stats(at(2026, 11, 8, 23, 59, 59, 999), sessions, logs);
      expect(sun.done).toBe(3);
      expect(sun.streakWeeks).toBe(1);
      const mon = stats(at(2026, 11, 9, 0, 0, 0, 0), sessions, logs);
      expect(mon.done).toBe(0);
      expect(mon.volumeKg).toBe(0);
      expect(mon.streakWeeks).toBe(1); // last week was full
      expect(mon.deltaVolumePct).toBe(-100);
    });

    it("a session finished Sunday 23:59 belongs to that week, not the next", () => {
      const s = stats(at(2026, 11, 9, 8), [sess("s1", at(2026, 11, 8, 23, 59))], [log("s1", BENCH, 20, 10)]);
      expect(s.done).toBe(0);
      expect(s.deltaSetsPct).toBe(-100);
    });
  });

  it("is also present on the resume state", () => {
    const open: Session = { ...sess("o", at(2026, 11, 5, 8), "in_progress"), finishedAt: null };
    const p = mkProfile(3);
    const vm = buildTodayVM({ profile: p, plan: { ...plan, profile: p }, sessions: [open], setLogs: [], now: at(2026, 11, 5, 9), utcOffsetMin: OFF });
    expect(vm.kind).toBe("resume");
    if (vm.kind === "resume") expect(vm.weekStats.done).toBe(0);
  });

  it("training-day count of zero never produces a streak", () => {
    const p: Profile = { ...mkProfile(3), trainingDays: [] };
    const vm = buildTodayVM({ profile: p, plan: { ...plan, profile: p }, sessions: [sess("s1", at(2026, 10, 28, 18))], setLogs: [], now: at(2026, 11, 5, 9), utcOffsetMin: OFF });
    if (vm.kind === "needs_setup") throw new Error("x");
    expect(vm.weekStats.streakWeeks).toBe(0);
  });
});
