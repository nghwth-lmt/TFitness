import Dexie, { type DexieOptions, type Table } from "dexie";
import type { Plan, Profile, Session, SetLog } from "../domain";

export const DB_NAME = "spotter-workout-plan";
export const PROFILE_ID = "me";

/** Single local user: one profile row. */
export type ProfileRow = Profile & { id: typeof PROFILE_ID };

export class WorkoutDb extends Dexie {
  profile!: Table<ProfileRow, string>;
  plans!: Table<Plan, string>;
  sessions!: Table<Session, string>;
  setLogs!: Table<SetLog, string>;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      profile: "id",
      plans: "id, status, createdAt",
      sessions: "id, planId, status, startedAt",
      setLogs: "id, sessionId, exerciseId, [exerciseId+loggedAt]",
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
