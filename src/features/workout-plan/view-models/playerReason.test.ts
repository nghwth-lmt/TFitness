import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, REASON_CODES, type History, type Plan, type Profile, type ReasonCode, type Session, type SetLog } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { nextSession } from "../engine/schedule";
import { applySwap, swapCandidates } from "../engine/substitution";
import { initPlayer, playerReducer, toPlayerExercise } from "./player";

const profile: Profile = { trainingDays: ["mon", "wed", "fri"], sessionMinutes: 90, equipment: [...EQUIPMENT_IDS], goal: "build_muscle", level: "intermediate", avoid: [], updatedAt: 1 };
const plan: Plan = buildPlan(profile, EXERCISES, 3);
const first = nextSession(plan, { sessions: [], setLogs: [] });
const target = first.exercises.find((e) => EXERCISES.find((x) => x.id === e.exerciseId)!.loadType === "barbell") ?? first.exercises.find((e) => EXERCISES.find((x) => x.id === e.exerciseId)!.loadType !== "bodyweight")!;
const ex = EXERCISES.find((x) => x.id === target.exerciseId)!;

let n = 0;
const done = (id: string): Session => ({ id, planId: plan.id, templateKey: "A", name: "A", exercises: [target], adjustedForToday: false, notes: [], status: "completed", startedAt: 1, finishedAt: 2 });
const rows = (sid: string, t: number, kg: number, reps: number[]): SetLog[] =>
  reps.map((r, i) => ({ id: `x${n++}`, sessionId: sid, exerciseId: ex.id, setIndex: i, kg, reps: r, rir: null, loggedAt: t + i }));
const top = target.repRange.max;
const bot = target.repRange.min;
const history = (...sessions: Array<[string, number, number, number]>): History => ({
  sessions: sessions.map(([id]) => done(id)),
  setLogs: sessions.flatMap(([id, t, kg, reps]) => rows(id, t, kg, Array(target.targetSets).fill(reps))),
});

const playerFor = (h: History) => {
  const draft = nextSession(plan, h);
  const session: Session = { ...draft, id: "now", status: "in_progress", startedAt: 9, finishedAt: null };
  return initPlayer({ session, logs: [], catalog: EXERCISES, profile }).exercises.find((e) => e.exerciseId === ex.id)!;
};

describe("player shows one reason and a last-time line (AC23, W33)", () => {
  const scenarios: Array<[ReasonCode, History]> = [
    ["first_time", { sessions: [], setLogs: [] }],
    ["hold", history(["a", 10, 40, bot])],
    ["increase", history(["a", 10, 40, top], ["b", 20, 40, top])],
    ["stall", history(["a", 10, 40, bot - 1], ["b", 20, 40, bot - 1])],
  ];

  for (const [code, h] of scenarios) {
    it(`${code}: the player exercise carries exactly that code`, () => {
      const e = playerFor(h);
      expect(e.reason.code).toBe(code);
      expect(REASON_CODES).toContain(e.reason.code);
    });
  }

  it("first_time has no last-time line; every other code has one with data, not text", () => {
    expect(playerFor({ sessions: [], setLogs: [] }).lastTimeLine).toBeNull();
    const e = playerFor(history(["a", 10, 40, top], ["b", 20, 42.5, bot]));
    expect(e.lastTimeLine).toEqual({ at: 20 + target.targetSets - 1, reps: Array(target.targetSets).fill(bot), kg: 42.5, sameKg: true });
    expect(typeof e.lastTimeLine).toBe("object");
  });

  it("increase carries the kg step and the top reps for the sentence", () => {
    const e = playerFor(history(["a", 10, 40, top], ["b", 20, 40, top]));
    expect(e.reason.params.max).toBe(top);
    expect(e.reason.params.n).toBeGreaterThan(0);
    expect(e.targetKg).toBe(40 + (e.reason.params.n as number));
  });

  it("bodyweight exercise: bodyweight_rep after one session, first_time with the bodyweight flag before", () => {
    const bwEx = EXERCISES.find((x) => x.loadType === "bodyweight" && x.id === "Pushups")!;
    const base = { exerciseId: bwEx.id, slot: "acc-1", role: "accessory" as const, targetSets: 3, repRange: { min: 8, max: 12 }, targetKg: null, restSec: 60 };
    const mk = (h: History) => {
      const e = nextSession({ ...plan, templates: [{ key: "A", name: "A", notes: [], slots: [{ slot: "acc-1", pattern: "horizontal_push", role: "accessory", exerciseId: bwEx.id }] }], cursor: 0 }, h).exercises[0];
      return toPlayerExercise(e, EXERCISES, profile);
    };
    const none = mk({ sessions: [], setLogs: [] });
    expect(none.reason).toEqual({ code: "first_time", params: { bodyweight: true, reps: none.targetReps } });
    const doneS: Session = { id: "b1", planId: plan.id, templateKey: "A", name: "A", exercises: [base], adjustedForToday: false, notes: [], status: "completed", startedAt: 1, finishedAt: 2 };
    const logs: SetLog[] = [11, 12, 11].map((r, i) => ({ id: `b${i}`, sessionId: "b1", exerciseId: bwEx.id, setIndex: i, kg: null, reps: r, rir: null, loggedAt: 5 + i }));
    const after = mk({ sessions: [doneS], setLogs: logs });
    expect(after.reason).toEqual({ code: "bodyweight_rep", params: { reps: 12 } });
    expect(after.lastTimeLine).toMatchObject({ kg: null, reps: [11, 12, 11] });
  });

  it("a session saved before reasons existed still shows one reason (derived from the target)", () => {
    const old = { exerciseId: ex.id, slot: "main-1", role: "main" as const, targetSets: 3, repRange: { min: 6, max: 10 }, targetKg: 40, restSec: 90 };
    const e = toPlayerExercise(old, EXERCISES, profile);
    expect(e.reason).toEqual({ code: "hold", params: { max: 10 } });
    expect(e.lastTimeLine).toBeNull();
    const firstOld = toPlayerExercise({ ...old, targetKg: null }, EXERCISES, profile);
    expect(firstOld.reason.code).toBe("first_time");
  });

  it("the reason does not change while the set is logged", () => {
    const e0 = playerFor(history(["a", 10, 40, top], ["b", 20, 40, top]));
    const session: Session = { ...nextSession(plan, history(["a", 10, 40, top], ["b", 20, 40, top])), id: "now", status: "in_progress", startedAt: 9, finishedAt: null };
    const s0 = initPlayer({ session, logs: [], catalog: EXERCISES, profile });
    const s1 = playerReducer(s0, { type: "logSet", now: 100 });
    expect(s1.exercises.find((e) => e.exerciseId === e0.exerciseId)!.reason).toEqual(e0.reason);
  });

  it("swapping gives the substitute its own reason and last-time line", () => {
    const draft = nextSession(plan, history(["a", 10, 40, top], ["b", 20, 40, top]));
    const swapOut = draft.exercises[0];
    const sub = swapCandidates(draft, swapOut.exerciseId, EXERCISES, profile)[0];
    const swapped = applySwap(draft, swapOut.slot, sub.id, EXERCISES, profile, { sessions: [], setLogs: [] });
    const item = swapped.exercises[0];
    expect(item.exerciseId).toBe(sub.id);
    expect(item.reason?.code).toBe("first_time");
    expect(item.lastTime).toBeNull();
  });
});
