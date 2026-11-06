import type { EquipmentId, Exercise } from "../domain";
import { PROFILE_ID, type WorkoutDb } from "../storage/db";
import { buildTodayVM, type TodayVM } from "./today";

export type LoadTodayOptions = {
  now?: number;
  utcOffsetMin?: number;
  todayEquipment?: readonly EquipmentId[];
  today?: { placeId?: string; without?: readonly EquipmentId[] };
  catalog?: readonly Exercise[];
};

/**
 * Reads everything the Today screen needs in ONE read transaction (5 table reads, no per-row
 * queries) and builds the view model. Client only: call it from a client component after mount.
 */
export async function loadTodayVM(db: WorkoutDb, options: LoadTodayOptions = {}): Promise<TodayVM> {
  const [row, rows, plan, sessions, setLogs] = await db.transaction("r", db.profile, db.places, db.plans, db.sessions, db.setLogs, () =>
    Promise.all([
      db.profile.get(PROFILE_ID),
      db.places.toArray(),
      db.plans.where("status").equals("active").first(),
      db.sessions.toArray(),
      db.setLogs.toArray(),
    ]),
  );
  let profile;
  if (row) {
    const { id: _id, ...rest } = row;
    void _id;
    profile = rest;
  }
  const places = rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(({ createdAt: _c, ...p }) => {
    void _c;
    return p;
  });
  return buildTodayVM({ profile, places, plan, sessions, setLogs, now: options.now ?? Date.now(), ...options });
}
