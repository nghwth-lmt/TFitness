import "fake-indexeddb/auto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../data/exercises";
import { EQUIPMENT_IDS, WEEKDAYS, type Profile } from "../domain";
import { openWorkoutDb } from "../storage/db";
import { parseBackup } from "../storage/backup";
import { buildAndSavePlan } from "../storage/repository";
import { buildPlan } from "./buildPlan";

const profile = (days: Profile["trainingDays"]): Profile => ({
  trainingDays: days,
  sessionMinutes: 60,
  equipment: [...EQUIPMENT_IDS],
  goal: "build_muscle",
  level: "intermediate",
  avoid: [],
  updatedAt: 1,
});

describe("W21: only 2 to 6 training days", () => {
  it("buildPlan rejects 7 days with a clear message", () => {
    expect(() => buildPlan(profile([...WEEKDAYS]), EXERCISES, 1)).toThrow(RangeError);
    expect(() => buildPlan(profile([...WEEKDAYS]), EXERCISES, 1)).toThrow("Pick at most 6 days");
  });

  it("still builds 6 days and rejects 1 day", () => {
    expect(buildPlan(profile(WEEKDAYS.slice(0, 6)), EXERCISES, 1).templates.length).toBeGreaterThan(0);
    expect(() => buildPlan(profile(["mon"]), EXERCISES, 1)).toThrow("Pick at least 2 days");
  });

  it("buildAndSavePlan with 7 days writes nothing", async () => {
    const db = openWorkoutDb("seven-days", { indexedDB: new IDBFactory(), IDBKeyRange });
    await expect(buildAndSavePlan(db, profile([...WEEKDAYS]), EXERCISES, 1)).rejects.toThrow(/at most 6/);
    expect(await db.plans.count()).toBe(0);
    expect(await db.profile.count()).toBe(0);
  });

  it("an imported file with a 7-day profile is rejected", () => {
    const file = { app: "spotter", kind: "workout-plan", version: 1, exportedAt: 1, profile: profile([...WEEKDAYS]), plans: [], sessions: [], setLogs: [] };
    const r = parseBackup(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/trainingDays/);
  });
});
