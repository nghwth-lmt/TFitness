import Dexie, { type DexieOptions, type Table } from "dexie";
import { migrateProfile } from "../domain/equipment";
import type { Place, Plan, Profile, Session, SetLog } from "../domain";

export const DB_NAME = "spotter-workout-plan";
export const PROFILE_ID = "me";

/** Single local user: one profile row. */
export type ProfileRow = Profile & { id: typeof PROFILE_ID };

/** A stored place. `createdAt` keeps the list order stable (the first place is the oldest). */
export type PlaceRow = Place & { createdAt: number };

export const MIGRATED_PLACE_ID = "place-migrated";

export class WorkoutDb extends Dexie {
  profile!: Table<ProfileRow, string>;
  plans!: Table<Plan, string>;
  sessions!: Table<Session, string>;
  setLogs!: Table<SetLog, string>;
  places!: Table<PlaceRow, string>;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      profile: "id",
      plans: "id, status, createdAt",
      sessions: "id, planId, status, startedAt",
      setLogs: "id, sessionId, exerciseId, [exerciseId+loggedAt]",
    });
    // v2 (PRD v1.1, AC20): equipment ids went from 8 to 33. Rewrite stored profiles and plan snapshots.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await tx.table("profile").toCollection().modify((row) => Object.assign(row, migrateProfile(row)));
        await tx.table("plans").toCollection().modify((plan) => {
          if (plan.profile) plan.profile = migrateProfile(plan.profile);
        });
      });
    // v3 (PRD v1.3, W32): places. The single equipment choice of the profile becomes one default place.
    this.version(3)
      .stores({ places: "id" })
      .upgrade(async (tx) => {
        const row = (await tx.table("profile").get(PROFILE_ID)) as ProfileRow | undefined;
        if (!row) return;
        const place: PlaceRow = {
          id: MIGRATED_PLACE_ID,
          name: "My gym",
          equipment: [...row.equipment],
          isDefault: true,
          createdAt: row.updatedAt,
          ...(row.dumbbellRange ? { dumbbellRange: row.dumbbellRange } : {}),
        };
        await tx.table("places").put(place);
      });
  }
}

export function openWorkoutDb(name: string = DB_NAME, options?: DexieOptions): WorkoutDb {
  return new WorkoutDb(name, options);
}

let shared: WorkoutDb | undefined;

/** The app database. IndexedDB exists only in the browser, so never call this during server render. */
export function getDb(): WorkoutDb {
  if (typeof indexedDB === "undefined" || !indexedDB) {
    throw new Error("IndexedDB is client-only: read the workout data from a client component after mount.");
  }
  return (shared ??= openWorkoutDb());
}
