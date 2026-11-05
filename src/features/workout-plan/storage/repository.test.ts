import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Profile } from "../domain";
import { completedCount, nextSession } from "../engine/schedule";
import { getDb, openWorkoutDb } from "./db";
import {
  buildAndSavePlan,
  discardSession,
  finishSession,
  getActivePlan,
  getHistory,
  getInProgressSession,
  getProfile,
  listSetLogs,
  logSet,
  startSession,
  swapExercise,
  type Deps,
} from "./repository";

let dbCount = 0;
function fresh(factory = new IDBFactory()) {
  return { factory, db: openWorkoutDb(`wp-test-${dbCount++}`, { indexedDB: factory, IDBKeyRange }) };
}

function makeDeps(start = 1_700_000_000_000): Deps {
  let t = start;
  let n = 0;
  return { now: () => (t += 1000), newId: () => `id${++n}` };
}

const profile = (over: Partial<Profile> = {}): Profile => ({
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 90,
  equipment: [...EQUIPMENT_IDS],
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
  ...over,
});

async function setup(over: Partial<Profile> = {}, deps = makeDeps()) {
  const { db, factory } = fresh();
  const plan = await buildAndSavePlan(db, profile(over), EXERCISES, 5, deps);
  return { db, factory, plan, deps };
}

async function trainOnce(db: ReturnType<typeof fresh>["db"], deps: Deps, kg = 40) {
  const plan = (await getActivePlan(db))!;
  const draft = nextSession(plan, await getHistory(db));
  const session = await startSession(db, draft, deps);
  for (const e of draft.exercises)
    for (let i = 0; i < e.targetSets; i++) await logSet(db, { sessionId: session.id, exerciseId: e.exerciseId, setIndex: i, kg, reps: e.repRange.max, rir: 2 }, deps);
  return finishSession(db, session.id, deps);
}

describe("persistence (AC13)", () => {
  it("profile, plan, in-progress session and logs survive closing and reopening the database", async () => {
    const { db, factory, plan, deps } = await setup();
    const draft = nextSession(plan, await getHistory(db));
    const session = await startSession(db, draft, deps);
    const first = draft.exercises[0];
    await logSet(db, { sessionId: session.id, exerciseId: first.exerciseId, setIndex: 0, kg: 40, reps: 8, rir: null }, deps);
    const name = db.name;
    db.close();

    const again = openWorkoutDb(name, { indexedDB: factory, IDBKeyRange });
    expect(await getProfile(again)).toEqual(profile());
    expect((await getActivePlan(again))?.id).toBe(plan.id);
    const resumed = await getInProgressSession(again);
    expect(resumed?.id).toBe(session.id);
    expect(resumed?.status).toBe("in_progress");
    expect(await listSetLogs(again, session.id)).toHaveLength(1);
  });

  it("reports nothing in progress when there is no unfinished session", async () => {
    const { db } = await setup();
    expect(await getInProgressSession(db)).toBeUndefined();
  });

  it("refuses to start a second session while one is in progress", async () => {
    const { db, plan, deps } = await setup();
    await startSession(db, nextSession(plan, await getHistory(db)), deps);
    await expect(startSession(db, nextSession(plan, await getHistory(db)), deps)).rejects.toThrow(/already in progress/);
  });
});

describe("logging sets (AC08 data, AC09)", () => {
  it("stores a blank RIR as null, never 0, and keeps a real 0", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    const ex = s.exercises[0].exerciseId;
    await logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: 40, reps: 8 }, deps);
    await logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 1, kg: 40, reps: 8, rir: 0 }, deps);
    await logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 2, kg: 40, reps: 8, rir: null }, deps);
    const rows = await listSetLogs(db, s.id);
    expect(rows.map((r) => r.rir)).toEqual([null, 0, null]);
  });

  it("editing a set rewrites it instead of adding a row", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    const ex = s.exercises[0].exerciseId;
    const a = await logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: 40, reps: 8 }, deps);
    const b = await logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: 42.5, reps: 7, rir: 1 }, deps);
    expect(b.id).toBe(a.id);
    expect(b.loggedAt).toBe(a.loggedAt);
    const rows = await listSetLogs(db, s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kg: 42.5, reps: 7, rir: 1 });
  });

  it("rejects sets for a finished session, a missing session or an exercise that is not in it", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    await expect(logSet(db, { sessionId: s.id, exerciseId: "not_in_session", setIndex: 0, kg: 1, reps: 1 }, deps)).rejects.toThrow(/not in this session/);
    await expect(logSet(db, { sessionId: "nope", exerciseId: "x", setIndex: 0, kg: 1, reps: 1 }, deps)).rejects.toThrow(/not found/);
    const ex = s.exercises[0].exerciseId;
    await finishSession(db, s.id, deps);
    await expect(logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: 1, reps: 1 }, deps)).rejects.toThrow(/not in progress/);
  });

  it("rejects negative or fractional reps and negative kg", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    const ex = s.exercises[0].exerciseId;
    await expect(logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: 40, reps: -1 }, deps)).rejects.toThrow(/reps/);
    await expect(logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: 40, reps: 2.5 }, deps)).rejects.toThrow(/reps/);
    await expect(logSet(db, { sessionId: s.id, exerciseId: ex, setIndex: 0, kg: -5, reps: 5 }, deps)).rejects.toThrow(/kg/);
  });
});

describe("finish, discard and the loop (AC06, AC12)", () => {
  it("finishing A moves the plan to B; discarding does not move it", async () => {
    const { db, plan, deps } = await setup();
    const a = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    await discardSession(db, a.id, deps);
    expect((await getActivePlan(db))?.cursor).toBe(0);
    expect((await getInProgressSession(db))).toBeUndefined();
    const done = await trainOnce(db, deps);
    expect(done.session.templateKey).toBe("A");
    expect((await getActivePlan(db))?.cursor).toBe(1);
    expect(nextSession((await getActivePlan(db))!, await getHistory(db)).templateKey).toBe("B");
  });

  it("discarding keeps the sets that were logged, but they stop counting for progression", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    await logSet(db, { sessionId: s.id, exerciseId: s.exercises[0].exerciseId, setIndex: 0, kg: 99, reps: 10 }, deps);
    const out = await discardSession(db, s.id, deps);
    expect(out.status).toBe("abandoned");
    expect(await listSetLogs(db, s.id)).toHaveLength(1);
    expect(completedCount((await getHistory(db)).sessions, plan)).toBe(0);
  });

  it("after 4 x days completed sessions the next block starts: mains kept, an accessory changed", async () => {
    const { db, plan, deps } = await setup();
    let last = await trainOnce(db, deps);
    expect(last.newBlock).toBe(false);
    for (let i = 1; i < 12; i++) last = await trainOnce(db, deps);
    expect(last.newBlock).toBe(true);
    const next = (await getActivePlan(db))!;
    expect(next.blockIndex).toBe(1);
    expect(next.blockStartedAtCompletedCount).toBe(12);
    let accessoryChanged = 0;
    plan.templates.forEach((t, i) =>
      t.slots.forEach((s, j) => {
        const n = next.templates[i].slots[j];
        if (s.role === "main") expect(n.exerciseId).toBe(s.exerciseId);
        else if (n.exerciseId !== s.exerciseId) accessoryChanged++;
      }),
    );
    expect(accessoryChanged).toBeGreaterThanOrEqual(1);
  });

  it("an abandoned session does not count toward the block", async () => {
    const { db, plan, deps } = await setup();
    for (let i = 0; i < 11; i++) await trainOnce(db, deps);
    const s = await startSession(db, nextSession((await getActivePlan(db))!, await getHistory(db)), deps);
    await discardSession(db, s.id, deps);
    expect((await getActivePlan(db))?.blockIndex).toBe(0);
    expect(completedCount((await getHistory(db)).sessions, plan)).toBe(11);
  });

  it("finishing a session of an archived plan does not move the new plan", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    await buildAndSavePlan(db, profile({ sessionMinutes: 60, updatedAt: 2 }), EXERCISES, 6, deps);
    await finishSession(db, s.id, deps);
    expect((await getActivePlan(db))?.cursor).toBe(0);
  });
});

describe("rebuild keeps history (AC14)", () => {
  it("archives the old plan, creates a new active one, keeps every set log and resets the loop", async () => {
    const { db, plan, deps } = await setup();
    await trainOnce(db, deps);
    await trainOnce(db, deps);
    const logsBefore = (await getHistory(db)).setLogs;
    expect(logsBefore.length).toBeGreaterThan(0);
    expect((await getActivePlan(db))?.cursor).toBe(2);

    const edited = profile({ goal: "get_stronger", updatedAt: 99 });
    const rebuilt = await buildAndSavePlan(db, edited, EXERCISES, 77, deps);

    const plans = await db.plans.toArray();
    expect(plans).toHaveLength(2);
    expect(plans.filter((p) => p.status === "active").map((p) => p.id)).toEqual([rebuilt.id]);
    expect(plans.find((p) => p.id === plan.id)?.status).toBe("archived");
    expect(rebuilt.cursor).toBe(0);
    expect(await getProfile(db)).toEqual(edited);
    expect((await getHistory(db)).setLogs).toEqual(logsBefore);
  });

  it("uses old weights for an exercise that is still in the new plan", async () => {
    const { db, deps } = await setup();
    await trainOnce(db, deps, 40);
    await trainOnce(db, deps, 40);
    await trainOnce(db, deps, 40);
    await trainOnce(db, deps, 40);
    const rebuilt = await buildAndSavePlan(db, profile({ updatedAt: 5 }), EXERCISES, 5, deps);
    const draft = nextSession(rebuilt, await getHistory(db));
    const kgs = draft.exercises.map((e) => e.targetKg).filter((k): k is number => k !== null);
    expect(kgs.length).toBeGreaterThan(0);
    expect(kgs.every((k) => k >= 40)).toBe(true);
  });
});

describe("swap inside a session (AC11)", () => {
  it("replaces one exercise and keeps every logged set", async () => {
    const { db, plan, deps } = await setup();
    const s = await startSession(db, nextSession(plan, await getHistory(db)), deps);
    const [first, second] = s.exercises;
    await logSet(db, { sessionId: s.id, exerciseId: first.exerciseId, setIndex: 0, kg: 40, reps: 8 }, deps);
    await logSet(db, { sessionId: s.id, exerciseId: second.exerciseId, setIndex: 0, kg: 30, reps: 8 }, deps);
    const { swapCandidates } = await import("../engine/substitution");
    const pick = swapCandidates(s, second.exerciseId, EXERCISES, plan.profile)[0];
    expect(pick).toBeDefined();
    const updated = await swapExercise(db, s.id, second.slot, pick.id, EXERCISES);
    expect(updated.exercises[1].exerciseId).toBe(pick.id);
    expect(updated.exercises[0]).toEqual(first);
    expect(await listSetLogs(db, s.id)).toHaveLength(2);
  });

  it("refuses to swap in a finished session", async () => {
    const { db, deps } = await setup();
    const done = await trainOnce(db, deps);
    await expect(swapExercise(db, done.session.id, done.session.exercises[0].slot, "x", EXERCISES)).rejects.toThrow(/not in progress/);
  });
});

describe("client only", () => {
  it("getDb throws a clear error when IndexedDB is missing (server render)", () => {
    const g = globalThis as { indexedDB?: unknown };
    const saved = g.indexedDB;
    g.indexedDB = undefined;
    try {
      expect(() => getDb()).toThrow(/client/i);
    } finally {
      g.indexedDB = saved;
    }
  });
});
