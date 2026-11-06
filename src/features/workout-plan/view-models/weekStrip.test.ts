import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Plan, type Profile, type Session, type Weekday } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { buildTodayVM, type TodayVM } from "./today";

const profile: Profile = { trainingDays: ["mon", "wed", "fri", "sat"] as Weekday[], sessionMinutes: 60, equipment: [...EQUIPMENT_IDS], goal: "build_muscle", level: "intermediate", avoid: [], updatedAt: 1 };
const plan: Plan = buildPlan(profile, EXERCISES, 4);

/** A local moment: month is 1-based, `offset` is minutes east of UTC. */
const at = (offset: number, y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0) => Date.UTC(y, m - 1, d, h, min, s, ms) - offset * 60_000;

const done = (id: string, finishedAt: number, status: Session["status"] = "completed"): Session => ({
  id, planId: plan.id, templateKey: "A", name: "A", exercises: [], adjustedForToday: false, notes: [], status, startedAt: finishedAt - 1000, finishedAt,
});
const strip = (vm: TodayVM) => {
  if (vm.kind === "needs_setup") throw new Error("needs setup");
  return vm.weekStrip;
};
const vmAt = (now: number, sessions: Session[], offset: number, p: Profile = profile) => buildTodayVM({ profile: p, plan: { ...plan, profile: p }, sessions, setLogs: [], now, utcOffsetMin: offset });

// Week of Mon 2 Nov 2026 .. Sun 8 Nov 2026. Training days: Mon, Wed, Fri, Sat.
describe("weekStrip (W34, AC24)", () => {
  const OFF = 420;

  it("has 7 days from Monday to Sunday, dates in device time", () => {
    const s = strip(vmAt(at(OFF, 2026, 11, 5, 9), [], OFF));
    expect(s.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("a sample week shows all 5 states", () => {
    // Thursday 5 Nov. Mon trained (done); Tue rest; Wed trained day but nothing done (missed); Thu today; Fri planned; Sat planned; Sun rest.
    const sessions = [done("s1", at(OFF, 2026, 11, 2, 18))];
    const s = strip(vmAt(at(OFF, 2026, 11, 5, 9), sessions, OFF));
    expect(s.map((d) => d.state)).toEqual(["done", "rest", "missed", "today", "planned", "planned", "rest"]);
    expect(new Set(s.map((d) => d.state))).toEqual(new Set(["done", "planned", "today", "rest", "missed"]));
  });

  it("each element has exactly a date and a state", () => {
    for (const d of strip(vmAt(at(OFF, 2026, 11, 5, 9), [], OFF))) expect(Object.keys(d).sort()).toEqual(["date", "state"]);
  });

  it("a session finished on a rest day still marks that day done", () => {
    const s = strip(vmAt(at(OFF, 2026, 11, 5, 9), [done("s1", at(OFF, 2026, 11, 3, 20))], OFF));
    expect(s[1].state).toBe("done");
  });

  it("training today and finishing it shows done; before finishing it shows today", () => {
    const wed = at(OFF, 2026, 11, 4, 18);
    expect(strip(vmAt(wed, [], OFF))[2].state).toBe("today");
    expect(strip(vmAt(wed, [done("s1", at(OFF, 2026, 11, 4, 17))], OFF))[2].state).toBe("done");
  });

  it("abandoned and in-progress sessions never mark a day done", () => {
    const s = strip(vmAt(at(OFF, 2026, 11, 5, 9), [done("a", at(OFF, 2026, 11, 2, 18), "abandoned"), done("b", at(OFF, 2026, 11, 4, 8), "in_progress")], OFF));
    expect(s[0].state).toBe("missed");
    expect(s[2].state).toBe("missed");
  });

  it("a session from another week does not count", () => {
    const s = strip(vmAt(at(OFF, 2026, 11, 5, 9), [done("old", at(OFF, 2026, 10, 30, 18))], OFF));
    expect(s[0].state).toBe("missed");
  });

  it("Monday: nothing is missed yet, today is the first element", () => {
    const s = strip(vmAt(at(OFF, 2026, 11, 2, 7), [], OFF));
    expect(s.map((d) => d.state)).toEqual(["today", "rest", "planned", "rest", "planned", "planned", "rest"]);
  });

  it("Sunday: the last element is today, and the training days before it are missed or done", () => {
    const s = strip(vmAt(at(OFF, 2026, 11, 8, 10), [done("s1", at(OFF, 2026, 11, 2, 18)), done("s2", at(OFF, 2026, 11, 7, 11))], OFF));
    expect(s.map((d) => d.state)).toEqual(["done", "rest", "missed", "rest", "missed", "done", "today"]);
  });

  describe("midnight boundary", () => {
    it("23:59:59.999 Sunday still belongs to the old week, with Sunday as today", () => {
      const s = strip(vmAt(at(OFF, 2026, 11, 8, 23, 59, 59, 999), [], OFF));
      expect(s[0].date).toBe("2026-11-02");
      expect(s[6]).toEqual({ date: "2026-11-08", state: "today" });
    });

    it("00:00:00.000 Monday starts a new week: 9 Nov is first and today, last week is gone", () => {
      const s = strip(vmAt(at(OFF, 2026, 11, 9, 0, 0, 0, 0), [done("s1", at(OFF, 2026, 11, 8, 23, 59, 59, 999))], OFF));
      expect(s[0]).toEqual({ date: "2026-11-09", state: "today" });
      expect(s.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
      expect(s.some((d) => d.state === "done")).toBe(false);
    });

    it("a set finished at 23:59:59.999 Sunday marks Sunday, one at 00:00 Monday marks Monday", () => {
      const sun = strip(vmAt(at(OFF, 2026, 11, 8, 23, 59, 59, 999), [done("s", at(OFF, 2026, 11, 8, 23, 59, 59, 999))], OFF));
      expect(sun[6].state).toBe("done");
      const mon = strip(vmAt(at(OFF, 2026, 11, 9, 0, 0, 1), [done("s", at(OFF, 2026, 11, 9, 0, 0, 0, 0))], OFF));
      expect(mon[0].state).toBe("done");
    });

    it("the week follows the device zone, not UTC: the same instant is Monday at UTC+8 and Sunday at UTC-8", () => {
      const instant = Date.UTC(2026, 10, 8, 17, 30); // 8 Nov 17:30 UTC
      const east = strip(vmAt(instant, [], 480)); // 9 Nov 01:30, Monday
      const west = strip(vmAt(instant, [], -480)); // 8 Nov 09:30, Sunday
      expect(east[0]).toEqual({ date: "2026-11-09", state: "today" });
      expect(west[6]).toEqual({ date: "2026-11-08", state: "today" });
    });
  });

  it("the Resume card carries the strip too", () => {
    const open: Session = { ...done("o", at(OFF, 2026, 11, 5, 9), "in_progress"), finishedAt: null };
    const vm = vmAt(at(OFF, 2026, 11, 5, 9), [open], OFF);
    expect(vm.kind).toBe("resume");
    expect(strip(vm)).toHaveLength(7);
  });

  it("is deterministic: same input, same strip", () => {
    const a = strip(vmAt(at(OFF, 2026, 11, 5, 9), [], OFF));
    expect(strip(vmAt(at(OFF, 2026, 11, 5, 9), [], OFF))).toEqual(a);
  });
});
