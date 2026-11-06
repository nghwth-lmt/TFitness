import "fake-indexeddb/auto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_IDS,
  EQUIPMENT_PRESETS,
  LEGACY_EQUIPMENT_MAP,
  migrateEquipmentIds,
  migrateProfile,
  type Profile,
} from "./index";
import { openWorkoutDb } from "../storage/db";
import { PROFILE_ID } from "../storage/db";
import { importJson, exportBackup } from "../storage/backup";

describe("equipment catalog (W31, AC17 data)", () => {
  // PRD 6.1 lists 6+6+4+6+6+6 = 34 ids while its text says 33. The ids are fixed, so all 34 are kept (see HANDOFF question).
  it("has the 34 unique ids listed in PRD 6.1 in 6 groups of at most 6", () => {
    expect(EQUIPMENT_IDS).toHaveLength(34);
    expect(new Set(EQUIPMENT_IDS).size).toBe(34);
    expect(EQUIPMENT_GROUPS).toHaveLength(6);
    for (const g of EQUIPMENT_GROUPS) expect(g.items.length).toBeLessThanOrEqual(6);
    expect(EQUIPMENT_GROUPS.flatMap((g) => g.items).sort()).toEqual([...EQUIPMENT_IDS].sort());
  });

  it("keeps the exact PRD 6.1 ids and group names", () => {
    expect(EQUIPMENT_GROUPS.map((g) => g.name)).toEqual([
      "Free weights",
      "Racks & benches",
      "Cables",
      "Upper-body machines",
      "Lower-body machines",
      "Small gear",
    ]);
    expect(EQUIPMENT_GROUPS[0].items).toEqual(["barbell", "ez_bar", "trap_bar", "dumbbells", "kettlebells", "plates"]);
    expect(EQUIPMENT_GROUPS[2].items).toEqual(["cable_station", "cable_crossover", "lat_pulldown", "seated_row"]);
    expect(EQUIPMENT_GROUPS[5].items).toEqual(["bands", "suspension", "medicine_ball", "stability_ball", "ab_wheel", "plyo_box"]);
  });

  it("defines the three presets", () => {
    expect(EQUIPMENT_PRESETS.full_gym.equipment).toEqual([...EQUIPMENT_IDS]);
    expect(EQUIPMENT_PRESETS.home.equipment.sort()).toEqual(["adjustable_bench", "bands", "dumbbells", "pull_up_bar"]);
    expect(EQUIPMENT_PRESETS.home.dumbbellRange).toEqual({ min: 4, max: 24, step: 2 });
    expect(EQUIPMENT_PRESETS.bodyweight.equipment).toEqual([]);
  });
});

describe("legacy equipment migration (AC20)", () => {
  it("maps the named legacy ids", () => {
    expect(migrateEquipmentIds(["dumbbells"])).toEqual(["dumbbells"]);
    expect(migrateEquipmentIds(["bench"])).toEqual(["adjustable_bench"]);
    expect(migrateEquipmentIds(["cable"])).toEqual(["cable_station"]);
  });

  it("has a table entry for every old id and every target is a new id", () => {
    const legacy = ["barbell", "rack", "dumbbells", "bench", "cable", "machines", "pullup_bar", "bands"];
    for (const id of legacy) {
      expect(LEGACY_EQUIPMENT_MAP[id], id).toBeDefined();
      for (const t of LEGACY_EQUIPMENT_MAP[id]) expect(EQUIPMENT_IDS).toContain(t);
    }
    expect(migrateEquipmentIds(["rack", "pullup_bar"])).toEqual(["squat_rack", "pull_up_bar"]);
  });

  it("loses no choice: machines expands to machine items, no duplicates, new ids pass through", () => {
    const out = migrateEquipmentIds(["machines", "leg_press", "barbell"]);
    expect(out).toContain("leg_press");
    expect(out).toContain("chest_press_machine");
    expect(out.filter((x) => x === "leg_press")).toHaveLength(1);
    expect(out).toContain("barbell");
    expect(migrateEquipmentIds([])).toEqual([]);
  });

  it("drops unknown ids instead of keeping garbage", () => {
    expect(migrateEquipmentIds(["nonsense"])).toEqual([]);
  });

  it("migrateProfile keeps every other field", () => {
    const p = { trainingDays: ["mon", "wed"], sessionMinutes: 60, equipment: ["bench", "cable"], goal: "build_muscle", level: "beginner", avoid: [], updatedAt: 5, dumbbellRange: { min: 2, max: 10, step: 2 } } as unknown as Profile;
    expect(migrateProfile(p)).toEqual({ ...p, equipment: ["adjustable_bench", "cable_station"] });
  });
});

describe("opening the app migrates a stored profile (AC20)", () => {
  it("rewrites the profile and plan profile snapshot on upgrade from v1", async () => {
    const factory = new IDBFactory();
    // simulate a v1 database written by the previous release
    const { default: Dexie } = await import("dexie");
    const old = new Dexie("mig-test", { indexedDB: factory, IDBKeyRange });
    old.version(1).stores({
      profile: "id",
      plans: "id, status, createdAt",
      sessions: "id, planId, status, startedAt",
      setLogs: "id, sessionId, exerciseId, [exerciseId+loggedAt]",
    });
    const base = { trainingDays: ["mon", "wed", "fri"], sessionMinutes: 60, goal: "build_muscle", level: "beginner", avoid: [], updatedAt: 5 };
    await old.table("profile").put({ id: PROFILE_ID, ...base, equipment: ["dumbbells", "bench", "cable"] });
    await old.table("plans").put({ id: "p1", status: "active", split: "fullbody_abc", profile: { ...base, equipment: ["bench", "rack"] }, templates: [], blockIndex: 0, blockStartedAtCompletedCount: 0, cursor: 0, seed: 1, createdAt: 1 });
    old.close();

    const db = openWorkoutDb("mig-test", { indexedDB: factory, IDBKeyRange });
    const row = await db.profile.get(PROFILE_ID);
    expect(row?.equipment).toEqual(["dumbbells", "adjustable_bench", "cable_station"]);
    expect((await db.plans.get("p1"))?.profile.equipment).toEqual(["adjustable_bench", "squat_rack"]);
    db.close();
  });

  it("a backup file with old equipment ids imports with migrated ids", async () => {
    const db = openWorkoutDb("mig-import", { indexedDB: new IDBFactory(), IDBKeyRange });
    const prof = { trainingDays: ["mon", "wed"], sessionMinutes: 60, equipment: ["bench", "cable"], goal: "build_muscle", level: "beginner", avoid: [], updatedAt: 5 };
    const file = { app: "spotter", kind: "workout-plan", version: 1, exportedAt: 1, profile: prof, plans: [], sessions: [], setLogs: [] };
    const res = await importJson(db, JSON.stringify(file));
    expect(res.ok).toBe(true);
    expect((await exportBackup(db)).profile?.equipment).toEqual(["adjustable_bench", "cable_station"]);
    db.close();
  });
});
