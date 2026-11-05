import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { DBCore } from "dexie";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Profile, type Session, type SetLog } from "../domain";
import { buildAndSavePlan } from "../storage/repository";
import { openWorkoutDb, type WorkoutDb } from "../storage/db";
import { loadTodayVM } from "./todayLoader";

let n = 0;
const profile: Profile = {
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 60,
  equipment: [...EQUIPMENT_IDS],
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
};

/** Counts real IndexedDB requests made through Dexie. */
function instrument(db: WorkoutDb) {
  const ops: string[] = [];
  db.use({
    stack: "dbcore",
    name: "op-counter",
    create(down: DBCore): DBCore {
      return {
        ...down,
        table(name: string) {
          const t = down.table(name);
          return {
            ...t,
            get: (req) => (ops.push(`${name}.get`), t.get(req)),
            getMany: (req) => (ops.push(`${name}.getMany`), t.getMany(req)),
            query: (req) => (ops.push(`${name}.query`), t.query(req)),
            openCursor: (req) => (ops.push(`${name}.openCursor`), t.openCursor(req)),
            count: (req) => (ops.push(`${name}.count`), t.count(req)),
            mutate: (req) => (ops.push(`${name}.mutate`), t.mutate(req)),
          };
        },
      };
    },
  });
  return ops;
}

async function seeded(sessionCount: number) {
  const db = openWorkoutDb(`wp-loader-${n++}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  const ops = instrument(db); // must be registered before the database opens
  let t = 0;
  const plan = await buildAndSavePlan(db, profile, EXERCISES, 3, { now: () => 1_000, newId: () => "p1" });
  const sessions: Session[] = [];
  const logs: SetLog[] = [];
  for (let i = 0; i < sessionCount; i++) {
    sessions.push({
      id: `s${i}`, planId: plan.id, templateKey: "A", name: "A", adjustedForToday: false, notes: [],
      exercises: plan.templates[0].slots.map((s) => ({ exerciseId: s.exerciseId, slot: s.slot, role: s.role, targetSets: 3, repRange: { min: 8, max: 12 }, targetKg: null, restSec: 90 })),
      status: "completed", startedAt: ++t, finishedAt: ++t,
    });
    for (let j = 0; j < 4; j++) logs.push({ id: `l${i}-${j}`, sessionId: `s${i}`, exerciseId: plan.templates[0].slots[0].exerciseId, setIndex: j, kg: 40, reps: 8, rir: null, loggedAt: ++t });
  }
  await db.sessions.bulkAdd(sessions);
  await db.setLogs.bulkAdd(logs);
  ops.length = 0; // count only the view model's own requests
  return { db, ops };
}

describe("loadTodayVM query ceiling", () => {
  it("reads at most 4 times, never writes, and does not grow with the amount of history", async () => {
    const { db: small, ops: opsSmall } = await seeded(2);
    const { db: large, ops: opsLarge } = await seeded(200);
    const a = await loadTodayVM(small, { now: 1_700_000_000_000, utcOffsetMin: 0 });
    const b = await loadTodayVM(large, { now: 1_700_000_000_000, utcOffsetMin: 0 });
    expect(a.kind).toBe("next");
    expect(b.kind).toBe("next");
    expect(opsSmall.length).toBeGreaterThanOrEqual(3); // proves the counter sees real requests
    expect(opsSmall.length).toBeLessThanOrEqual(4);
    expect(opsLarge.length).toBe(opsSmall.length);
    expect([...opsSmall, ...opsLarge].some((o) => o.endsWith(".mutate"))).toBe(false);
  });

  it("an empty database asks for setup with a single pass", async () => {
    const db = openWorkoutDb(`wp-loader-${n++}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    const ops = instrument(db);
    expect(await loadTodayVM(db, { now: 1, utcOffsetMin: 0 })).toEqual({ kind: "needs_setup" });
    expect(ops.length).toBeGreaterThanOrEqual(1);
    expect(ops.length).toBeLessThanOrEqual(4);
  });
});
