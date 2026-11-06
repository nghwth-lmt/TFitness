import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Profile } from "../domain";
import { progressionFromHistory } from "../engine/progression";
import { completedCount, nextSession } from "../engine/schedule";
import { canFinish, canFinishEarly, initPlayer } from "../view-models/player";
import { openWorkoutDb } from "./db";
import { buildAndSavePlan, finishSession, getActivePlan, getHistory, getInProgressSession, logSet, startSession, type Deps } from "./repository";

let n = 0;
const fresh = () => openWorkoutDb(`wp-early-${n++}`, { indexedDB: new IDBFactory(), IDBKeyRange });
const deps = (): Deps => {
  let t = 1_700_000_000_000;
  let i = 0;
  return { now: () => (t += 1000), newId: () => `e${++i}` };
};
const profile: Profile = { trainingDays: ["mon", "wed", "fri"], sessionMinutes: 60, equipment: [...EQUIPMENT_IDS], goal: "build_muscle", level: "intermediate", avoid: [], updatedAt: 1 };

async function started() {
  const db = fresh();
  const d = deps();
  await buildAndSavePlan(db, profile, EXERCISES, 5, d);
  const plan = (await getActivePlan(db))!;
  const session = await startSession(db, nextSession(plan, await getHistory(db)), d);
  return { db, d, session };
}

describe("W28: finish early", () => {
  it("is refused with no set logged, and the session stays open", async () => {
    const { db, d, session } = await started();
    await expect(finishSession(db, session.id, d)).rejects.toThrow(/at least one set/i);
    expect((await getInProgressSession(db))?.id).toBe(session.id);
  });

  it("after one set the session completes, counts as completed and moves the loop on", async () => {
    const { db, d, session } = await started();
    const first = session.exercises[0];
    await logSet(db, { sessionId: session.id, exerciseId: first.exerciseId, setIndex: 0, kg: 40, reps: first.repRange.max }, d);
    const plan0 = (await getActivePlan(db))!;
    const res = await finishSession(db, session.id, d);
    expect(res.session.status).toBe("completed");
    expect(await getInProgressSession(db)).toBeUndefined();
    const history = await getHistory(db);
    expect(completedCount(history.sessions, res.plan!)).toBe(1);
    expect(res.plan!.cursor).toBe((plan0.cursor + 1) % plan0.templates.length);
  });

  it("an exercise left with fewer sets than planned does not raise the load next time", async () => {
    const { db, d, session } = await started();
    const first = session.exercises.find((e) => e.targetSets >= 2)!;
    // one set at the top of the range, 1 of N sets: must not look like a full top-of-range session
    await logSet(db, { sessionId: session.id, exerciseId: first.exerciseId, setIndex: 0, kg: 40, reps: first.repRange.max }, d);
    await finishSession(db, session.id, d);
    const h = await getHistory(db);
    const ex = EXERCISES.find((x) => x.id === first.exerciseId)!;
    const p = progressionFromHistory(first.exerciseId, h, first.repRange, ex.loadType);
    expect(p.targetKg).toBeNull();
  });

  it("complete exercises in an early-finished session still count for progression", async () => {
    const { db, d, session } = await started();
    const first = session.exercises[0];
    for (let i = 0; i < first.targetSets; i++) await logSet(db, { sessionId: session.id, exerciseId: first.exerciseId, setIndex: i, kg: 40, reps: first.repRange.max, rir: 2 }, d);
    await finishSession(db, session.id, d);
    const h = await getHistory(db);
    const ex = EXERCISES.find((x) => x.id === first.exerciseId)!;
    expect(progressionFromHistory(first.exerciseId, h, first.repRange, ex.loadType).targetKg).toBe(40);
  });
});

describe("W28: player", () => {
  it("canFinishEarly needs at least one logged set and an unfinished session; canFinish stays for the last set", async () => {
    const { session } = await started();
    const none = initPlayer({ session, logs: [], catalog: EXERCISES });
    expect(canFinishEarly(none)).toBe(false);
    expect(canFinish(none)).toBe(false);
    const one = initPlayer({
      session,
      logs: [{ id: "l", sessionId: session.id, exerciseId: session.exercises[0].exerciseId, setIndex: 0, kg: 40, reps: 8, rir: null, loggedAt: 5 }],
      catalog: EXERCISES,
    });
    expect(canFinishEarly(one)).toBe(true);
    expect(canFinish(one)).toBe(false);
  });
});
