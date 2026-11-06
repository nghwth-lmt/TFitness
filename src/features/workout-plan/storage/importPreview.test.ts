import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Profile } from "../domain";
import { nextSession } from "../engine/schedule";
import { exportBackup, exportJson, importJson, previewImport } from "./backup";
import { openWorkoutDb } from "./db";
import { buildAndSavePlan, finishSession, getActivePlan, getHistory, logSet, startSession, type Deps } from "./repository";

let n = 0;
const fresh = () => openWorkoutDb(`wp-prev-${n++}`, { indexedDB: new IDBFactory(), IDBKeyRange });
const deps = (start: number, prefix: string): Deps => {
  let t = start;
  let i = 0;
  return { now: () => (t += 1000), newId: () => `${prefix}${++i}` };
};
const profile: Profile = { trainingDays: ["mon", "wed", "fri"], sessionMinutes: 60, equipment: [...EQUIPMENT_IDS], goal: "build_muscle", level: "intermediate", avoid: [], updatedAt: 1 };

async function trained(prefix: string, start: number, sessions: number) {
  const db = fresh();
  const d = deps(start, prefix);
  await buildAndSavePlan(db, profile, EXERCISES, 5, d);
  for (let k = 0; k < sessions; k++) {
    const plan = (await getActivePlan(db))!;
    const draft = nextSession(plan, await getHistory(db));
    const s = await startSession(db, draft, d);
    for (const e of draft.exercises) for (let i = 0; i < e.targetSets; i++) await logSet(db, { sessionId: s.id, exerciseId: e.exerciseId, setIndex: i, kg: 40, reps: e.repRange.max, rir: 2 }, d);
    await finishSession(db, s.id, d);
  }
  return { db, d };
}

describe("W23: import preview and counts", () => {
  it("previewImport reports what would be added and writes nothing", async () => {
    const local = await trained("a", 1_700_000_000_000, 1);
    const other = await trained("b", 1_800_000_000_000, 2);
    const snap = async () => JSON.stringify({ ...(await exportBackup(local.db, local.d)), exportedAt: 0 });
    const before = await snap();
    const prev = await previewImport(local.db, await exportJson(other.db, other.d), local.d);
    expect(prev.ok).toBe(true);
    if (!prev.ok) return;
    expect(prev.added.sessions).toBe(2);
    expect(prev.added.setLogs).toBe((await other.db.setLogs.count()));
    expect(await snap()).toBe(before);
  });

  it("preview counts equal the counts of the real import", async () => {
    const local = await trained("a", 1_700_000_000_000, 1);
    const other = await trained("b", 1_800_000_000_000, 2);
    const text = await exportJson(other.db, other.d);
    const prev = await previewImport(local.db, text, local.d);
    const real = await importJson(local.db, text, local.d);
    expect(prev).toEqual(real);
  });

  it("an invalid file is reported by the preview and nothing is written", async () => {
    const local = await trained("a", 1_700_000_000_000, 1);
    const r = await previewImport(local.db, "{not json", local.d);
    expect(r.ok).toBe(false);
    expect(await local.db.sessions.count()).toBe(1);
  });

  it("importing the same file again adds nothing (counts say 0 sessions, 0 sets)", async () => {
    const local = await trained("a", 1_700_000_000_000, 1);
    const text = await exportJson(local.db, local.d);
    const r = await previewImport(local.db, text, local.d);
    expect(r.ok && r.added.sessions === 0 && r.added.setLogs === 0).toBe(true);
  });

  it("never removes a set log", async () => {
    const local = await trained("a", 1_700_000_000_000, 2);
    const other = await trained("b", 1_800_000_000_000, 1);
    const ids = (await local.db.setLogs.toArray()).map((l) => l.id);
    await importJson(local.db, await exportJson(other.db, other.d), local.d);
    const after = new Set((await local.db.setLogs.toArray()).map((l) => l.id));
    for (const id of ids) expect(after.has(id)).toBe(true);
  });
});
