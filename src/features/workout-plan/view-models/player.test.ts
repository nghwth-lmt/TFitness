import { describe, expect, it, vi } from "vitest";
import { EXERCISES } from "../data/exercises";
import { REST_ADJUST_SEC, REST_MAX_SEC } from "../config";
import type { Profile, Session, SetLog } from "../domain";
import {
  canFinish,
  currentExercise,
  initPlayer,
  playerReducer,
  progressOf,
  remainingSec,
  type PlayerAction,
  type PlayerState,
} from "./player";

const T0 = 1_700_000_000_000;

const profile: Profile = {
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 60,
  equipment: ["barbell", "squat_rack", "adjustable_bench", "dumbbells"],
  dumbbellRange: { min: 4, max: 24, step: 4 },
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
};

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    planId: "p1",
    templateKey: "A",
    name: "Full body A",
    adjustedForToday: false,
    notes: [],
    status: "in_progress",
    startedAt: T0,
    finishedAt: null,
    exercises: [
      { exerciseId: "Barbell_Bench_Press_-_Medium_Grip", slot: "main-1", role: "main", targetSets: 3, repRange: { min: 6, max: 10 }, targetKg: 40, restSec: 120 },
      { exerciseId: "Dumbbell_Squat", slot: "main-2", role: "main", targetSets: 2, repRange: { min: 6, max: 10 }, targetKg: 16, restSec: 120 },
      { exerciseId: "Pushups", slot: "acc-1", role: "accessory", targetSets: 2, repRange: { min: 10, max: 15 }, targetKg: null, targetReps: 12, restSec: 60 },
    ],
    ...over,
  };
}

const fresh = (s = session(), logs: SetLog[] = []) => initPlayer({ session: s, logs, catalog: EXERCISES, profile });
const run = (state: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, state);
const log = (state: PlayerState, now: number) => playerReducer(state, { type: "logSet", now });

/** Logs every remaining set, waiting out each rest. Returns the final state. */
function finishAll(state: PlayerState, start = T0): PlayerState {
  let s = state;
  let t = start;
  for (let i = 0; i < 50 && s.status !== "finished"; i++) {
    s = log(s, t);
    t += 200_000;
    s = playerReducer(s, { type: "tick", now: t });
  }
  return s;
}

describe("initPlayer", () => {
  it("starts at exercise 1, set 1 with inputs from the targets and a warm-up card (W17)", () => {
    const s = fresh();
    expect(s.status).toBe("working");
    expect([s.exerciseIndex, s.setIndex]).toEqual([0, 0]);
    expect(s.kg).toBe(40);
    expect(s.reps).toBe(10);
    expect(s.logs).toEqual([]);
    expect(s.warmup).toEqual({ minutes: 5, set: { kg: 20, reps: 8 }, dismissed: false });
    expect(currentExercise(s).name).toBe("Barbell Bench Press") // W36: standard name, id unchanged;
    expect(progressOf(s)).toEqual({ doneSets: 0, totalSets: 7 });
  });

  it("has no warm-up set when the first lift has no weight yet, but still the 5 min card", () => {
    const s = fresh(session({ exercises: [{ ...session().exercises[0], targetKg: null }, ...session().exercises.slice(1)] }));
    expect(s.warmup).toEqual({ minutes: 5, set: null, dismissed: false });
    expect(s.kg).toBeNull();
  });

  it("uses target reps for a bodyweight lift and keeps kg empty", () => {
    const s = fresh(session({ exercises: [session().exercises[2]] }));
    expect(s.kg).toBeNull();
    expect(s.reps).toBe(12);
    expect(s.warmup?.set).toBeNull();
  });

  it("dismissWarmup hides the card", () => {
    expect(run(fresh(), { type: "dismissWarmup" }).warmup?.dismissed).toBe(true);
  });
});

describe("log a set and the rest clock (AC08)", () => {
  it("logs the set, starts rest for the exercise's rest seconds and moves to the next set", () => {
    const s = log(run(fresh(), { type: "setKg", kg: 42.5 }, { type: "setReps", reps: 8 }), T0);
    expect(s.status).toBe("resting");
    expect(s.restEndsAt).toBe(T0 + 120_000);
    expect(s.restTotalSec).toBe(120);
    expect(s.logs).toEqual([{ exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 0, kg: 42.5, reps: 8, rir: null, loggedAt: T0 }]);
    expect(s.lastLogged).toEqual({ exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 0 });
    expect([s.exerciseIndex, s.setIndex]).toEqual([0, 1]);
    expect(s.kg).toBe(42.5); // next set carries the weight just used
    expect(progressOf(s).doneSets).toBe(1);
  });

  it("ignores Log set while resting or finished (no double logging)", () => {
    const resting = log(fresh(), T0);
    expect(log(resting, T0 + 1)).toBe(resting);
    const done = finishAll(fresh());
    expect(log(done, T0)).toBe(done);
  });

  it("is driven by timestamps: still resting 1 ms early, working once restEndsAt is reached", () => {
    const s = log(fresh(), T0);
    const early = playerReducer(s, { type: "tick", now: T0 + 119_999 });
    expect(early.status).toBe("resting");
    expect(remainingSec(early, T0 + 119_999)).toBe(1);
    const due = playerReducer(s, { type: "tick", now: T0 + 120_000 });
    expect(due.status).toBe("working");
    expect(remainingSec(due, T0 + 120_000)).toBe(0);
  });

  it("stays correct after a long gap (locked screen, background tab): one tick moves on exactly one set", () => {
    const s = log(fresh(), T0);
    const later = playerReducer(s, { type: "tick", now: T0 + 3 * 3_600_000 });
    expect(later.status).toBe("working");
    expect([later.exerciseIndex, later.setIndex]).toEqual([0, 1]);
    expect(later.logs).toHaveLength(1);
  });

  it("remainingSec is computed from the clock passed in, so a redraw alone is enough", () => {
    const s = log(fresh(), T0);
    expect(remainingSec(s, T0)).toBe(120);
    expect(remainingSec(s, T0 + 30_000)).toBe(90);
    expect(remainingSec(s, T0 + 500)).toBe(120); // rounds up
    expect(remainingSec(fresh(), T0)).toBe(0);
  });

  it("uses no timers and never reads the system clock", () => {
    const timers = vi.spyOn(globalThis, "setInterval").mockImplementation(() => {
      throw new Error("setInterval used");
    });
    const timeouts = vi.spyOn(globalThis, "setTimeout").mockImplementation(() => {
      throw new Error("setTimeout used");
    });
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now used");
    });
    try {
      const done = finishAll(fresh());
      expect(done.status).toBe("finished");
    } finally {
      timers.mockRestore();
      timeouts.mockRestore();
      now.mockRestore();
    }
  });

  it("adjusts the running rest by +/- 15 s, within limits (W15)", () => {
    const s = log(fresh(), T0);
    const plus = playerReducer(s, { type: "adjustRest", direction: 1, now: T0 + 10_000 });
    expect(REST_ADJUST_SEC).toBe(15);
    expect(plus.restEndsAt).toBe(T0 + 120_000 + 15_000);
    const minus = playerReducer(s, { type: "adjustRest", direction: -1, now: T0 + 10_000 });
    expect(minus.restEndsAt).toBe(T0 + 120_000 - 15_000);
    // cannot be pushed past the maximum
    let big = s;
    for (let i = 0; i < 100; i++) big = playerReducer(big, { type: "adjustRest", direction: 1, now: T0 });
    expect(big.restEndsAt).toBe(T0 + REST_MAX_SEC * 1000);
    // taking off more than what is left ends the rest
    const nearEnd = playerReducer(s, { type: "adjustRest", direction: -1, now: T0 + 110_000 });
    expect(nearEnd.status).toBe("working");
  });

  it("adjustRest does nothing outside a rest", () => {
    const s = fresh();
    expect(playerReducer(s, { type: "adjustRest", direction: 1, now: T0 })).toBe(s);
  });

  it("skipRest returns to working at the next set", () => {
    const s = playerReducer(log(fresh(), T0), { type: "skipRest", now: T0 + 5000 });
    expect(s.status).toBe("working");
    expect(s.restEndsAt).toBeNull();
    expect(s.setIndex).toBe(1);
  });
});

describe("RIR question (AC09, W14)", () => {
  it("is one tap during rest and stored on the set just logged", () => {
    const s = playerReducer(log(fresh(), T0), { type: "answerRir", rir: 2 });
    expect(s.logs[0].rir).toBe(2);
    expect(s.status).toBe("resting"); // the clock keeps running
    expect(s.restEndsAt).toBe(T0 + 120_000);
  });

  it("unanswered stays null, never 0", () => {
    const s = playerReducer(log(fresh(), T0), { type: "tick", now: T0 + 120_000 });
    expect(s.logs[0].rir).toBeNull();
  });

  it("keeps a real 0 apart from blank, and a blank answer clears it", () => {
    const zero = playerReducer(log(fresh(), T0), { type: "answerRir", rir: 0 });
    expect(zero.logs[0].rir).toBe(0);
    expect(playerReducer(zero, { type: "answerRir", rir: null }).logs[0].rir).toBeNull();
  });

  it("rejects values outside 0-3 as blank", () => {
    const s = playerReducer(log(fresh(), T0), { type: "answerRir", rir: 7 as never });
    expect(s.logs[0].rir).toBeNull();
  });

  it("is ignored when there is nothing to answer for", () => {
    const s = fresh();
    expect(playerReducer(s, { type: "answerRir", rir: 1 })).toBe(s);
    const working = playerReducer(log(s, T0), { type: "skipRest", now: T0 });
    expect(playerReducer(working, { type: "answerRir", rir: 1 })).toBe(working);
  });

  it("can still be answered for the very last set, which has no rest", () => {
    const done = finishAll(fresh());
    const last = done.lastLogged!;
    const s = playerReducer(done, { type: "answerRir", rir: 3 });
    expect(s.logs.find((l) => l.exerciseId === last.exerciseId && l.setIndex === last.setIndex)?.rir).toBe(3);
  });
});

describe("moving through the session", () => {
  it("goes to the next exercise after its last set, then finishes without a final rest", () => {
    let s = fresh();
    const seen: Array<[number, number]> = [];
    let t = T0;
    while (s.status !== "finished") {
      seen.push([s.exerciseIndex, s.setIndex]);
      s = log(s, t);
      if (s.status === "resting") {
        t += 200_000;
        s = playerReducer(s, { type: "tick", now: t });
      }
    }
    expect(seen).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0], [2, 1]]);
    expect(s.restEndsAt).toBeNull();
    expect(canFinish(s)).toBe(true);
    expect(progressOf(s)).toEqual({ doneSets: 7, totalSets: 7 });
  });

  it("new exercise starts from its own target weight and reps", () => {
    let s = fresh();
    s = playerReducer(log(playerReducer(log(playerReducer(log(s, T0), { type: "skipRest", now: T0 }), T0 + 1), { type: "skipRest", now: T0 + 1 }), T0 + 2), { type: "skipRest", now: T0 + 2 });
    expect([s.exerciseIndex, s.setIndex]).toEqual([1, 0]);
    expect(s.kg).toBe(16);
    expect(s.reps).toBe(10);
  });

  it("canFinish is false until every set is logged", () => {
    expect(canFinish(fresh())).toBe(false);
  });
});

describe("steppers", () => {
  it("move kg by the load step of the exercise and never below 0", () => {
    let s = run(fresh(), { type: "stepKg", direction: 1 });
    expect(s.kg).toBe(42.5);
    s = run(s, { type: "stepKg", direction: -1 }, { type: "stepKg", direction: -1 });
    expect(s.kg).toBe(37.5);
    const low = run(fresh(), { type: "setKg", kg: 1 }, { type: "stepKg", direction: -1 });
    expect(low.kg).toBe(0);
  });

  it("use the declared dumbbell step for dumbbell lifts", () => {
    const s = run(fresh(session({ exercises: [session().exercises[1]] })), { type: "stepKg", direction: 1 });
    expect(s.kg).toBe(20); // 16 + step 4
  });

  it("keep kg empty for bodyweight and move reps by one", () => {
    let s = fresh(session({ exercises: [session().exercises[2]] }));
    s = run(s, { type: "stepKg", direction: 1 }, { type: "stepReps", direction: 1 }, { type: "stepReps", direction: 1 });
    expect(s.kg).toBeNull();
    expect(s.reps).toBe(14);
    expect(run(s, { type: "setReps", reps: -3 }).reps).toBe(0);
  });
});

describe("edit, swap and resume (AC11, AC13)", () => {
  it("editSet rewrites a logged set and nothing else", () => {
    const s = playerReducer(log(fresh(), T0), { type: "answerRir", rir: 1 });
    const e = playerReducer(s, { type: "editSet", exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 0, kg: 45, reps: 6 });
    expect(e.logs[0]).toMatchObject({ kg: 45, reps: 6, rir: 1, loggedAt: T0 });
    expect(playerReducer(e, { type: "editSet", exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 5, kg: 1, reps: 1 })).toBe(e);
    expect(playerReducer(e, { type: "editSet", exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 0, kg: 45, reps: -1 })).toBe(e);
  });

  it("swapExercise replaces the exercise in its slot and keeps every logged set", () => {
    let s = fresh();
    s = playerReducer(log(s, T0), { type: "skipRest", now: T0 });
    s = playerReducer(log(s, T0 + 1), { type: "skipRest", now: T0 + 1 });
    s = playerReducer(log(s, T0 + 2), { type: "skipRest", now: T0 + 2 });
    expect(s.exerciseIndex).toBe(1);
    const before = s.logs;
    const swapped = playerReducer(s, {
      type: "swapExercise",
      slot: "main-2",
      exercise: { ...s.exercises[1], exerciseId: "Bodyweight_Squat", name: "Bodyweight Squat", cue: "c", loadType: "bodyweight", kgStep: null, targetKg: null, targetReps: 12 },
    });
    expect(swapped.exercises[1].exerciseId).toBe("Bodyweight_Squat");
    expect(swapped.logs).toEqual(before);
    expect([swapped.exerciseIndex, swapped.setIndex]).toEqual([1, 0]);
    expect(swapped.kg).toBeNull();
    expect(swapped.reps).toBe(12);
    expect(playerReducer(swapped, { type: "swapExercise", slot: "nope", exercise: swapped.exercises[0] })).toBe(swapped);
  });

  it("resume: rebuilds the position from stored sets and keeps their RIR", () => {
    const stored: SetLog[] = [
      { id: "a", sessionId: "s1", exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 0, kg: 40, reps: 9, rir: null, loggedAt: T0 },
      { id: "b", sessionId: "s1", exerciseId: "Barbell_Bench_Press_-_Medium_Grip", setIndex: 1, kg: 42.5, reps: 8, rir: 0, loggedAt: T0 + 1 },
    ];
    const s = fresh(session(), stored);
    expect(s.status).toBe("working");
    expect([s.exerciseIndex, s.setIndex]).toEqual([0, 2]);
    expect(s.kg).toBe(42.5);
    expect(s.reps).toBe(8);
    expect(s.logs.map((l) => l.rir)).toEqual([null, 0]);
    expect(s.warmup).toBeNull();
    expect(progressOf(s).doneSets).toBe(2);
  });

  it("resume with every set logged lands on finished", () => {
    const sets = session().exercises.flatMap((e) =>
      Array.from({ length: e.targetSets }, (_, i): SetLog => ({ id: `${e.exerciseId}${i}`, sessionId: "s1", exerciseId: e.exerciseId, setIndex: i, kg: 10, reps: 10, rir: null, loggedAt: T0 + i })),
    );
    expect(fresh(session(), sets).status).toBe("finished");
  });

  it("resume ignores logs of other sessions' exercises it does not contain", () => {
    const stray: SetLog = { id: "z", sessionId: "s1", exerciseId: "Barbell_Squat", setIndex: 0, kg: 100, reps: 5, rir: null, loggedAt: T0 };
    const s = fresh(session(), [stray]);
    expect(s.logs).toEqual([]);
    expect([s.exerciseIndex, s.setIndex]).toEqual([0, 0]);
  });
});

describe("purity", () => {
  it("does not mutate the previous state", () => {
    const s = fresh();
    const snap = JSON.stringify(s);
    log(s, T0);
    playerReducer(s, { type: "setKg", kg: 99 });
    expect(JSON.stringify(s)).toBe(snap);
  });

  it("same state and action give the same result", () => {
    const a = log(fresh(), T0);
    expect(log(fresh(), T0)).toEqual(a);
  });
});
