/* eslint-disable @typescript-eslint/no-explicit-any */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, type Profile } from "../domain";
import { nextSession } from "../engine/schedule";
import { BACKUP_VERSION, exportBackup, exportJson, importJson, parseBackup } from "./backup";
import { openWorkoutDb, type WorkoutDb } from "./db";
import {
  buildAndSavePlan,
  finishSession,
  getActivePlan,
  getHistory,
  getInProgressSession,
  getProfile,
  logSet,
  startSession,
  type Deps,
} from "./repository";

let n = 0;
const fresh = (): WorkoutDb => openWorkoutDb(`wp-backup-${n++}`, { indexedDB: new IDBFactory(), IDBKeyRange });
const deps = (start = 1_700_000_000_000, prefix = "a"): Deps => {
  let t = start;
  let i = 0;
  return { now: () => (t += 1000), newId: () => `${prefix}${++i}` };
};
const profile = (over: Partial<Profile> = {}): Profile => ({
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 90,
  equipment: [...EQUIPMENT_IDS],
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 10,
  ...over,
});

async function train(db: WorkoutDb, d: Deps, kg = 40, rir: 0 | 2 | null = 2) {
  const plan = (await getActivePlan(db))!;
  const draft = nextSession(plan, await getHistory(db));
  const s = await startSession(db, draft, d);
  for (const e of draft.exercises)
    for (let i = 0; i < e.targetSets; i++) await logSet(db, { sessionId: s.id, exerciseId: e.exerciseId, setIndex: i, kg, reps: e.repRange.max, rir }, d);
  return finishSession(db, s.id, d);
}

async function populated(prefix: string, start: number, withOpen = false) {
  const db = fresh();
  const d = deps(start, prefix);
  await buildAndSavePlan(db, profile(), EXERCISES, 5, d);
  await train(db, d, 40, null);
  await train(db, d, 42.5, 0);
  if (withOpen) {
    const plan = (await getActivePlan(db))!;
    const s = await startSession(db, nextSession(plan, await getHistory(db)), d);
    await logSet(db, { sessionId: s.id, exerciseId: s.exercises[0].exerciseId, setIndex: 0, kg: 50, reps: 5 }, d);
  }
  return { db, d };
}

const strip = (b: Awaited<ReturnType<typeof exportBackup>>) => ({ ...b, exportedAt: 0 });

describe("export", () => {
  it("writes a versioned file with every table and keeps RIR null and 0 apart", async () => {
    const { db, d } = await populated("a", 1_700_000_000_000);
    const file = await exportBackup(db, d);
    expect(file).toMatchObject({ app: "spotter", kind: "workout-plan", version: BACKUP_VERSION });
    expect(file.plans).toHaveLength(1);
    expect(file.sessions).toHaveLength(2);
    const rirs = new Set(file.setLogs.map((l) => l.rir));
    expect(rirs).toEqual(new Set([null, 0]));
    const text = await exportJson(db, d);
    expect(JSON.parse(text).setLogs.some((l: { rir: unknown }) => l.rir === null)).toBe(true);
  });

  it("exports a null profile for an empty database", async () => {
    const file = await exportBackup(fresh(), deps());
    expect(file.profile).toBeNull();
    expect(file.plans).toEqual([]);
  });
});

describe("import into an empty database", () => {
  it("restores everything exactly, including RIR null and 0", async () => {
    const { db, d } = await populated("a", 1_700_000_000_000, true);
    const text = await exportJson(db, d);
    const target = fresh();
    const result = await importJson(target, text, deps(2_000_000_000_000, "z"));
    expect(result.ok).toBe(true);
    expect(strip(await exportBackup(target, d))).toEqual(strip(await exportBackup(db, d)));
    expect((await getInProgressSession(target))?.status).toBe("in_progress");
    expect(await getProfile(target)).toEqual(profile());
  });

  it("importing the same file twice changes nothing", async () => {
    const { db, d } = await populated("a", 1_700_000_000_000);
    const text = await exportJson(db, d);
    const target = fresh();
    await importJson(target, text, deps());
    const once = strip(await exportBackup(target, d));
    await importJson(target, text, deps());
    expect(strip(await exportBackup(target, d))).toEqual(once);
  });
});

describe("import merges and never deletes set logs", () => {
  it("keeps every local log and adds the imported ones", async () => {
    const local = await populated("a", 1_700_000_000_000);
    const other = await populated("b", 1_800_000_000_000);
    const localIds = (await local.db.setLogs.toArray()).map((l) => l.id);
    const otherIds = (await other.db.setLogs.toArray()).map((l) => l.id);
    const result = await importJson(local.db, await exportJson(other.db, other.d), deps(1_900_000_000_000, "m"));
    expect(result.ok).toBe(true);
    const ids = new Set((await local.db.setLogs.toArray()).map((l) => l.id));
    for (const id of [...localIds, ...otherIds]) expect(ids.has(id)).toBe(true);
  });

  it("a finished local session and its logs win over an older imported copy", async () => {
    const local = await populated("a", 1_700_000_000_000);
    const file = await exportBackup(local.db, local.d);
    const target = file.sessions[0];
    const stale = {
      ...file,
      sessions: file.sessions.map((s) => (s.id === target.id ? { ...s, status: "in_progress" as const, finishedAt: null } : s)),
      setLogs: file.setLogs.map((l) => (l.sessionId === target.id ? { ...l, kg: 1, reps: 1 } : l)),
    };
    const before = await local.db.setLogs.toArray();
    const result = await importJson(local.db, JSON.stringify(stale), deps());
    expect(result.ok).toBe(true);
    expect((await local.db.sessions.get(target.id))?.status).toBe("completed");
    expect(await local.db.setLogs.toArray()).toEqual(before);
  });

  it("leaves one in-progress session: the latest wins, the other is abandoned with its sets kept", async () => {
    const local = await populated("a", 1_700_000_000_000, true);
    const other = await populated("b", 1_800_000_000_000, true);
    const localOpen = (await getInProgressSession(local.db))!;
    const otherOpen = (await getInProgressSession(other.db))!;
    const logsBefore = (await local.db.setLogs.toArray()).length + (await other.db.setLogs.toArray()).length;
    const res = await importJson(local.db, await exportJson(other.db, other.d), deps(1_900_000_000_000, "m"));
    expect(res.ok && res.abandonedInProgress).toBe(1);
    const open = await local.db.sessions.where("status").equals("in_progress").toArray();
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(otherOpen.id);
    expect((await local.db.sessions.get(localOpen.id))?.status).toBe("abandoned");
    expect(await local.db.setLogs.count()).toBe(logsBefore);
  });

  it("keeps exactly one active plan: the most recently created", async () => {
    const local = await populated("a", 1_700_000_000_000);
    const other = await populated("b", 1_800_000_000_000);
    await importJson(local.db, await exportJson(other.db, other.d), deps());
    const plans = await local.db.plans.toArray();
    expect(plans).toHaveLength(2);
    const active = plans.filter((p) => p.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].createdAt).toBe(Math.max(...plans.map((p) => p.createdAt)));
  });

  it("takes the imported profile only when it is at least as new", async () => {
    const local = await populated("a", 1_700_000_000_000);
    const older = await populated("b", 1_800_000_000_000);
    await older.db.profile.put({ ...profile({ goal: "lose_fat", updatedAt: 5 }), id: "me" });
    await importJson(local.db, await exportJson(older.db, older.d), deps());
    expect((await getProfile(local.db))?.goal).toBe("build_muscle");
    const newer = await populated("c", 1_800_000_000_000);
    await newer.db.profile.put({ ...profile({ goal: "get_stronger", updatedAt: 99 }), id: "me" });
    await importJson(local.db, await exportJson(newer.db, newer.d), deps());
    expect((await getProfile(local.db))?.goal).toBe("get_stronger");
  });
});

describe("invalid files are rejected without touching the database", () => {
  async function validFile() {
    const { db, d } = await populated("a", 1_700_000_000_000);
    return { db, d, file: await exportBackup(db, d) };
  }
  const cases: Array<[string, (f: Record<string, any>) => unknown, RegExp]> = [
    ["wrong kind", (f) => ({ ...f, kind: "nutrition" }), /kind/],
    ["newer version", (f) => ({ ...f, version: BACKUP_VERSION + 1 }), /newer/i],
    ["negative reps", (f) => ({ ...f, setLogs: [{ ...f.setLogs[0], reps: -1 }] }), /reps/],
    ["rir out of range", (f) => ({ ...f, setLogs: [{ ...f.setLogs[0], rir: 5 }] }), /rir/],
    ["rir missing", (f) => ({ ...f, setLogs: [{ ...f.setLogs[0], rir: undefined }] }), /rir/],
    ["rir as a string", (f) => ({ ...f, setLogs: [{ ...f.setLogs[0], rir: "0" }] }), /rir/],
    ["unknown split", (f) => ({ ...f, plans: [{ ...f.plans[0], split: "bro_split" }] }), /split/],
    ["bad session status", (f) => ({ ...f, sessions: [{ ...f.sessions[0], status: "done" }] }), /status/],
    ["tables missing", (f) => ({ app: f.app, kind: f.kind, version: f.version, exportedAt: 1 }), /plans/],
    ["bad profile minutes", (f) => ({ ...f, profile: { ...f.profile, sessionMinutes: 20 } }), /sessionMinutes/],
  ];
  for (const [name, mutate, re] of cases) {
    it(name, async () => {
      const { db, d, file } = await validFile();
      const before = strip(await exportBackup(db, d));
      const res = await importJson(db, JSON.stringify(mutate(file as unknown as Record<string, any>)), deps());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.join(" ")).toMatch(re);
      expect(strip(await exportBackup(db, d))).toEqual(before);
    });
  }

  it("rejects text that is not JSON", async () => {
    const res = await importJson(fresh(), "not json {", deps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/JSON/);
  });

  it("parseBackup returns the typed file for valid input", async () => {
    const { file } = await validFile();
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
  });
});
