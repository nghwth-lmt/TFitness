import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { MAX_PLACES } from "../config";
import { EXERCISES, getExercise } from "../data/exercises";
import { EQUIPMENT_IDS, type EquipmentId, type Place, type Profile } from "../domain";
import { isDoable } from "../engine/availability";
import { nextSession } from "../engine/schedule";
import { exportBackup, importJson } from "./backup";
import { PROFILE_ID, openWorkoutDb } from "./db";
import {
  addPlace,
  buildAndSavePlan,
  finishSession,
  getActivePlan,
  getHistory,
  listPlaces,
  logSet,
  removePlace,
  setDefaultPlace,
  startSession,
  updatePlace,
  type Deps,
} from "./repository";

let n = 0;
const open = (factory = new IDBFactory()) => ({ factory, db: openWorkoutDb(`pl-${n++}`, { indexedDB: factory, IDBKeyRange }) });
const deps = (): Deps => {
  let t = 1_700_000_000_000;
  let i = 0;
  return { now: () => (t += 1000), newId: () => `id${++i}` };
};
const FULL: EquipmentId[] = [...EQUIPMENT_IDS];
const profile = (over: Partial<Profile> = {}): Profile => ({
  trainingDays: ["mon", "wed", "fri"],
  sessionMinutes: 90,
  equipment: FULL,
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
  ...over,
});
const HOME = { name: "Home", equipment: ["dumbbells", "adjustable_bench"] as EquipmentId[], dumbbellRange: { min: 4, max: 24, step: 2 } };

describe("migration of profile.equipment to a place (AC21)", () => {
  it("a v2 database becomes v3 with one default place 'My gym' holding the same equipment and range", async () => {
    const factory = new IDBFactory();
    const { default: Dexie } = await import("dexie");
    const old = new Dexie("mig-places", { indexedDB: factory, IDBKeyRange });
    old.version(1).stores({
      profile: "id",
      plans: "id, status, createdAt",
      sessions: "id, planId, status, startedAt",
      setLogs: "id, sessionId, exerciseId, [exerciseId+loggedAt]",
    });
    old.version(2).stores({});
    const range = { min: 4, max: 20, step: 4 };
    const base = { trainingDays: ["mon", "wed", "fri"], sessionMinutes: 60, goal: "build_muscle", level: "beginner", avoid: [], updatedAt: 5 };
    await old.table("profile").put({ id: PROFILE_ID, ...base, equipment: ["dumbbells", "adjustable_bench", "bands"], dumbbellRange: range });
    old.close();

    const db = openWorkoutDb("mig-places", { indexedDB: factory, IDBKeyRange });
    const places = await listPlaces(db);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "My gym", isDefault: true, equipment: ["dumbbells", "adjustable_bench", "bands"], dumbbellRange: range });
    expect((await db.profile.get(PROFILE_ID))?.equipment).toEqual(["dumbbells", "adjustable_bench", "bands"]);
    db.close();
  });

  it("a v2 database with no profile gets no place", async () => {
    const factory = new IDBFactory();
    const { default: Dexie } = await import("dexie");
    const old = new Dexie("mig-empty", { indexedDB: factory, IDBKeyRange });
    old.version(1).stores({ profile: "id", plans: "id, status, createdAt", sessions: "id, planId, status, startedAt", setLogs: "id, sessionId, exerciseId, [exerciseId+loggedAt]" });
    old.version(2).stores({});
    await old.open();
    old.close();
    const db = openWorkoutDb("mig-empty", { indexedDB: factory, IDBKeyRange });
    expect(await listPlaces(db)).toEqual([]);
    db.close();
  });
});

describe("setup creates the first place", () => {
  it("buildAndSavePlan makes one default place named after the preset and the plan uses its gear", async () => {
    const { db } = open();
    const plan = await buildAndSavePlan(db, profile({ equipment: ["dumbbells", "adjustable_bench", "pull_up_bar", "bands"], dumbbellRange: { min: 4, max: 24, step: 2 } }), EXERCISES, 5, deps());
    const places = await listPlaces(db);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "Home", isDefault: true });
    expect(plan.profile.equipment).toEqual(places[0].equipment);
  });

  it("a second build keeps using the default place, not the profile gear passed in", async () => {
    const { db } = open();
    const d = deps();
    await buildAndSavePlan(db, profile({ equipment: ["dumbbells"] }), EXERCISES, 5, d);
    const plan2 = await buildAndSavePlan(db, profile({ equipment: FULL, goal: "get_stronger" }), EXERCISES, 5, d);
    expect(plan2.profile.equipment).toEqual(["dumbbells"]);
    expect(plan2.profile.goal).toBe("get_stronger");
    expect(await listPlaces(db)).toHaveLength(1);
  });
});

describe("places repository (AC21)", () => {
  async function withGym() {
    const { db } = open();
    const d = deps();
    await buildAndSavePlan(db, profile(), EXERCISES, 5, d);
    return { db, d };
  }

  it("keeps at most 3 places and explains the 4th", async () => {
    const { db, d } = await withGym();
    await addPlace(db, HOME, d);
    await addPlace(db, { name: "Hotel", equipment: [] }, d);
    expect(await listPlaces(db)).toHaveLength(MAX_PLACES);
    await expect(addPlace(db, { name: "Park", equipment: ["bands"] }, d)).rejects.toThrow(/up to 3 places/i);
    expect(await listPlaces(db)).toHaveLength(3);
  });

  it("exactly one place is the default; a new place is not", async () => {
    const { db, d } = await withGym();
    const home = await addPlace(db, HOME, d);
    expect(home.isDefault).toBe(false);
    expect((await listPlaces(db)).filter((p) => p.isDefault)).toHaveLength(1);
  });

  it("rejects an empty name, a name used twice, unknown gear and a bad dumbbell range", async () => {
    const { db, d } = await withGym();
    await expect(addPlace(db, { name: "  ", equipment: [] }, d)).rejects.toThrow(/name/i);
    await expect(addPlace(db, { name: "Gym", equipment: [] }, d)).rejects.toThrow(/already/i);
    await expect(addPlace(db, { name: "X", equipment: ["nope" as EquipmentId] }, d)).rejects.toThrow(/equipment/i);
    await expect(addPlace(db, { name: "X", equipment: [], dumbbellRange: { min: 10, max: 2, step: 2 } }, d)).rejects.toThrow(/range/i);
  });

  it("does not remove the last place", async () => {
    const { db } = await withGym();
    const [only] = await listPlaces(db);
    await expect(removePlace(db, only.id)).rejects.toThrow(/at least one place/i);
    expect(await listPlaces(db)).toHaveLength(1);
  });

  it("removing a non-default place leaves the plan alone", async () => {
    const { db, d } = await withGym();
    const home = await addPlace(db, HOME, d);
    const before = await getActivePlan(db);
    await removePlace(db, home.id);
    expect((await listPlaces(db)).map((p) => p.name)).toEqual(["Gym"]);
    expect((await getActivePlan(db))?.id).toBe(before?.id);
  });

  it("removing the default makes another place the default and rebuilds the plan for it", async () => {
    const { db, d } = await withGym();
    const home = await addPlace(db, HOME, d);
    const [first] = (await listPlaces(db)).filter((p) => p.id !== home.id);
    await removePlace(db, first.id);
    const places = await listPlaces(db);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ id: home.id, isDefault: true });
    const plan = (await getActivePlan(db))!;
    expect(plan.profile.equipment).toEqual(HOME.equipment);
  });

  it("updatePlace renames without rebuilding; changing the default place gear rebuilds", async () => {
    const { db, d } = await withGym();
    const [gym] = await listPlaces(db);
    const planBefore = (await getActivePlan(db))!;
    await updatePlace(db, gym.id, { name: "Big gym" }, EXERCISES, d);
    expect((await listPlaces(db))[0].name).toBe("Big gym");
    expect((await getActivePlan(db))!.id).toBe(planBefore.id);

    await updatePlace(db, gym.id, { equipment: ["dumbbells"] }, EXERCISES, d);
    const planAfter = (await getActivePlan(db))!;
    expect(planAfter.id).not.toBe(planBefore.id);
    expect(planAfter.profile.equipment).toEqual(["dumbbells"]);
    expect((await db.profile.get(PROFILE_ID))?.equipment).toEqual(["dumbbells"]);
  });

  it("updatePlace on another place never rebuilds", async () => {
    const { db, d } = await withGym();
    const home = await addPlace(db, HOME, d);
    const planBefore = (await getActivePlan(db))!;
    await updatePlace(db, home.id, { equipment: ["dumbbells", "bands"] }, EXERCISES, d);
    expect((await getActivePlan(db))!.id).toBe(planBefore.id);
  });

  it("setDefaultPlace rebuilds for the new gear, archives the old plan and keeps every set log (AC14)", async () => {
    const { db, d } = await withGym();
    const home = await addPlace(db, HOME, d);
    const plan = (await getActivePlan(db))!;
    const draft = nextSession(plan, await getHistory(db));
    const s = await startSession(db, draft, d);
    const first = draft.exercises[0];
    await logSet(db, { sessionId: s.id, exerciseId: first.exerciseId, setIndex: 0, kg: 40, reps: 8, rir: null }, d);
    await finishSession(db, s.id, d);
    const logsBefore = (await getHistory(db)).setLogs;
    expect(logsBefore.length).toBe(1);

    const rebuilt = await setDefaultPlace(db, home.id, EXERCISES, d);
    expect(rebuilt?.id).not.toBe(plan.id);
    const places = await listPlaces(db);
    expect(places.filter((p) => p.isDefault).map((p) => p.id)).toEqual([home.id]);
    const active = (await getActivePlan(db))!;
    expect(active.profile.equipment).toEqual(HOME.equipment);
    expect(active.profile.dumbbellRange).toEqual(HOME.dumbbellRange);
    for (const t of active.templates) for (const sl of t.slots) expect(isDoable(getExercise(sl.exerciseId)!, HOME.equipment), sl.exerciseId).toBe(true);
    expect((await db.plans.get(plan.id))?.status).toBe("archived");
    expect((await getHistory(db)).setLogs).toEqual(logsBefore);
    expect((await db.profile.get(PROFILE_ID))?.equipment).toEqual(HOME.equipment);
  });

  it("setDefaultPlace on the current default or an unknown id changes nothing", async () => {
    const { db } = await withGym();
    const [gym] = await listPlaces(db);
    const planBefore = (await getActivePlan(db))!;
    expect(await setDefaultPlace(db, gym.id, EXERCISES)).toBeUndefined();
    expect((await getActivePlan(db))!.id).toBe(planBefore.id);
    await expect(setDefaultPlace(db, "nope", EXERCISES)).rejects.toThrow(/not found/i);
  });
});

describe("places in the backup file", () => {
  it("export carries the places and import merges them without deleting local ones", async () => {
    const a = open();
    const d = deps();
    await buildAndSavePlan(a.db, profile(), EXERCISES, 5, d);
    await addPlace(a.db, HOME, d);
    const json = JSON.stringify(await exportBackup(a.db, d));
    expect((JSON.parse(json) as { places: Place[] }).places).toHaveLength(2);

    const b = open();
    const db2 = deps();
    await buildAndSavePlan(b.db, profile({ equipment: ["bands"] }), EXERCISES, 9, db2);
    await addPlace(b.db, { name: "Hotel", equipment: [] }, db2);
    const res = await importJson(b.db, json, db2);
    expect(res.ok).toBe(true);
    const places = await listPlaces(b.db);
    expect(places.length).toBeLessThanOrEqual(3);
    expect(places.filter((p) => p.isDefault)).toHaveLength(1);
    expect(places.map((p) => p.name)).toContain("Hotel");
  });

  it("an old file without places still imports, and its profile gear becomes a place when the device has none", async () => {
    const { db } = open();
    const file = { app: "spotter", kind: "workout-plan", version: 1, exportedAt: 1, profile: { ...profile({ equipment: ["dumbbells"] }) }, plans: [], sessions: [], setLogs: [] };
    const res = await importJson(db, JSON.stringify(file), deps());
    expect(res.ok).toBe(true);
    const places = await listPlaces(db);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "My gym", isDefault: true, equipment: ["dumbbells"] });
  });

  it("a file with a bad place is rejected with a clear error", async () => {
    const { db } = open();
    const file = { app: "spotter", kind: "workout-plan", version: 2, exportedAt: 1, profile: null, places: [{ id: "x", name: "", equipment: ["nope"], isDefault: true }], plans: [], sessions: [], setLogs: [] };
    const res = await importJson(db, JSON.stringify(file), deps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/places\[0\]/);
  });

  it("a file with more than 3 places is rejected", async () => {
    const { db } = open();
    const mk = (i: number) => ({ id: `p${i}`, name: `P${i}`, equipment: [], isDefault: i === 0 });
    const file = { app: "spotter", kind: "workout-plan", version: 2, exportedAt: 1, profile: null, places: [0, 1, 2, 3].map(mk), plans: [], sessions: [], setLogs: [] };
    const res = await importJson(db, JSON.stringify(file), deps());
    expect(res.ok).toBe(false);
  });
});
