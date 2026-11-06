import { EXERCISES } from "../data/exercises";
import { MAX_PLACES } from "../config";
import type { Exercise, History, Place, PlaceInput, Plan, Profile, Rir, Session, SessionDraft, SetLog } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { normalizeRir } from "../engine/progression";
import { completedCount, completeSession, isNewBlockStart, rotateBlockIfDue } from "../engine/schedule";
import { placeNameForEquipment, profileForPlace, validatePlaceInput } from "../engine/places";
import { applySwap } from "../engine/substitution";
import { PROFILE_ID, type PlaceRow, type WorkoutDb } from "./db";

/** Clock and id source are injected so tests are deterministic. */
export type Deps = { now: () => number; newId: () => string };

export const defaultDeps: Deps = {
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
};

export async function getProfile(db: WorkoutDb): Promise<Profile | undefined> {
  const row = await db.profile.get(PROFILE_ID);
  if (!row) return undefined;
  const { id: _id, ...profile } = row;
  void _id;
  return profile;
}

export function getActivePlan(db: WorkoutDb): Promise<Plan | undefined> {
  return db.plans.where("status").equals("active").first();
}

export async function getHistory(db: WorkoutDb): Promise<History> {
  const [sessions, setLogs] = await Promise.all([db.sessions.toArray(), db.setLogs.toArray()]);
  return { sessions, setLogs };
}

const toPlace = ({ createdAt: _c, ...place }: PlaceRow): Place => {
  void _c;
  return place;
};

const byAge = (a: PlaceRow, b: PlaceRow) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Saved places, oldest first (W32). */
export async function listPlaces(db: WorkoutDb): Promise<Place[]> {
  return (await db.places.toArray()).sort(byAge).map(toPlace);
}

export async function getDefaultPlace(db: WorkoutDb): Promise<Place | undefined> {
  return (await listPlaces(db)).find((p) => p.isDefault);
}

/**
 * Archives the active plan (never deleted), saves a new active one built for `place`, and mirrors the
 * place gear into the stored profile. Set logs are not touched (AC14). Call inside a transaction on
 * `profile` and `plans`.
 */
async function saveBuiltPlan(
  db: WorkoutDb,
  profile: Profile,
  place: Place,
  seed: number,
  catalog: readonly Exercise[],
  deps: Deps,
): Promise<Plan> {
  const plan = buildPlan(profile, catalog, seed, { createdAt: deps.now(), id: `plan-${deps.newId()}`, place });
  await db.plans.where("status").equals("active").modify({ status: "archived" });
  await db.plans.add(plan);
  await db.profile.put({ ...profileForPlace(profile, place), id: PROFILE_ID });
  return plan;
}

/** The stored profile and active plan seed, or undefined before Setup ran. */
async function storedSetup(db: WorkoutDb): Promise<{ profile: Profile; seed: number } | undefined> {
  const profile = await getProfile(db);
  if (!profile) return undefined;
  return { profile, seed: (await getActivePlan(db))?.seed ?? 0 };
}

/**
 * Setup and rebuild share this: the old active plan becomes `archived`, the new plan is `active`,
 * and no set log is touched (AC14). The plan is built for the default place (W32); the first build
 * creates that place from the profile gear.
 */
export async function buildAndSavePlan(
  db: WorkoutDb,
  profile: Profile,
  catalog: readonly Exercise[] = EXERCISES,
  seed: number,
  deps: Deps = defaultDeps,
): Promise<Plan> {
  return db.transaction("rw", db.profile, db.plans, db.places, async () => {
    const rows = (await db.places.toArray()).sort(byAge);
    let place = rows.find((p) => p.isDefault) ?? rows[0];
    if (!place) {
      place = { id: `place-${deps.newId()}`, name: placeNameForEquipment(profile.equipment), equipment: [...profile.equipment], isDefault: true, createdAt: deps.now(), ...(profile.dumbbellRange ? { dumbbellRange: profile.dumbbellRange } : {}) };
      await db.places.add(place);
    }
    return saveBuiltPlan(db, profile, toPlace(place), seed, catalog, deps);
  });
}

const TOO_MANY = `You can save up to ${MAX_PLACES} places. Remove one to add another.`;

function checkNameFree(name: string, others: readonly PlaceRow[]) {
  if (others.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`A place named "${name}" already exists`);
}

/** Adds a place (at most 3). The first place ever saved is the default; later ones are not. */
export async function addPlace(db: WorkoutDb, input: PlaceInput, deps: Deps = defaultDeps): Promise<Place> {
  const problem = validatePlaceInput(input);
  if (problem) throw new RangeError(problem);
  return db.transaction("rw", db.places, async () => {
    const rows = await db.places.toArray();
    if (rows.length >= MAX_PLACES) throw new Error(TOO_MANY);
    const name = input.name.trim();
    checkNameFree(name, rows);
    const row: PlaceRow = {
      id: `place-${deps.newId()}`,
      name,
      equipment: [...input.equipment],
      isDefault: rows.length === 0,
      createdAt: deps.now(),
      ...(input.dumbbellRange ? { dumbbellRange: { ...input.dumbbellRange } } : {}),
    };
    await db.places.add(row);
    return toPlace(row);
  });
}

/**
 * Edits a place. Changing the gear of the default place rebuilds the plan for it (the plan must follow
 * the default gear); a rename or an edit of another place never does.
 */
export async function updatePlace(
  db: WorkoutDb,
  id: string,
  patch: Partial<PlaceInput>,
  catalog: readonly Exercise[] = EXERCISES,
  deps: Deps = defaultDeps,
): Promise<Place> {
  return db.transaction("rw", db.profile, db.plans, db.places, async () => {
    const rows = await db.places.toArray();
    const found = rows.find((p) => p.id === id);
    if (!found) throw new Error(`Place ${id} not found`);
    const next: PlaceRow = { ...found, ...patch, name: (patch.name ?? found.name).trim() };
    if (patch.dumbbellRange === undefined && "dumbbellRange" in patch) delete next.dumbbellRange;
    const problem = validatePlaceInput(next);
    if (problem) throw new RangeError(problem);
    checkNameFree(next.name, rows.filter((p) => p.id !== id));
    await db.places.put(next);
    const gearChanged = JSON.stringify([found.equipment, found.dumbbellRange ?? null]) !== JSON.stringify([next.equipment, next.dumbbellRange ?? null]);
    if (next.isDefault && gearChanged) {
      const setup = await storedSetup(db);
      if (setup) await saveBuiltPlan(db, setup.profile, toPlace(next), setup.seed, catalog, deps);
    }
    return toPlace(next);
  });
}

/** Makes `id` the default place and rebuilds the plan for its gear. Returns the new plan, or undefined when nothing changed. */
export async function setDefaultPlace(
  db: WorkoutDb,
  id: string,
  catalog: readonly Exercise[] = EXERCISES,
  deps: Deps = defaultDeps,
): Promise<Plan | undefined> {
  return db.transaction("rw", db.profile, db.plans, db.places, async () => {
    const rows = await db.places.toArray();
    const target = rows.find((p) => p.id === id);
    if (!target) throw new Error(`Place ${id} not found`);
    if (target.isDefault && rows.filter((p) => p.isDefault).length === 1) return undefined;
    for (const r of rows) await db.places.update(r.id, { isDefault: r.id === id });
    const setup = await storedSetup(db);
    return setup ? saveBuiltPlan(db, setup.profile, toPlace({ ...target, isDefault: true }), setup.seed, catalog, deps) : undefined;
  });
}

/** Removes a place. The last place cannot go. Removing the default hands the default to the oldest left and rebuilds. */
export async function removePlace(
  db: WorkoutDb,
  id: string,
  catalog: readonly Exercise[] = EXERCISES,
  deps: Deps = defaultDeps,
): Promise<void> {
  await db.transaction("rw", db.profile, db.plans, db.places, async () => {
    const rows = (await db.places.toArray()).sort(byAge);
    const found = rows.find((p) => p.id === id);
    if (!found) throw new Error(`Place ${id} not found`);
    if (rows.length <= 1) throw new Error("Keep at least one place");
    await db.places.delete(id);
    if (!found.isDefault) return;
    const heir = rows.find((p) => p.id !== id)!;
    await db.places.update(heir.id, { isDefault: true });
    const setup = await storedSetup(db);
    if (setup) await saveBuiltPlan(db, setup.profile, toPlace({ ...heir, isDefault: true }), setup.seed, catalog, deps);
  });
}

export function getInProgressSession(db: WorkoutDb): Promise<Session | undefined> {
  return db.sessions
    .where("status")
    .equals("in_progress")
    .toArray()
    .then((rows) => rows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]);
}

export async function startSession(db: WorkoutDb, draft: SessionDraft, deps: Deps = defaultDeps): Promise<Session> {
  return db.transaction("rw", db.sessions, async () => {
    if (await getInProgressSession(db)) throw new Error("A workout is already in progress");
    const session: Session = { ...draft, id: deps.newId(), status: "in_progress", startedAt: deps.now(), finishedAt: null };
    await db.sessions.add(session);
    return session;
  });
}

export type LogSetInput = {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  kg: number | null;
  reps: number;
  rir?: Rir | null;
};

export async function listSetLogs(db: WorkoutDb, sessionId: string): Promise<SetLog[]> {
  const rows = await db.setLogs.where("sessionId").equals(sessionId).toArray();
  return rows.sort((a, b) => a.loggedAt - b.loggedAt || a.setIndex - b.setIndex);
}

/** Writes or rewrites one set. Only an in-progress session accepts sets (completed is view-only). */
export async function logSet(db: WorkoutDb, input: LogSetInput, deps: Deps = defaultDeps): Promise<SetLog> {
  if (!Number.isInteger(input.reps) || input.reps < 0) throw new RangeError("reps must be a whole number, 0 or more");
  if (input.kg !== null && !(input.kg >= 0)) throw new RangeError("kg must be 0 or more, or null");
  return db.transaction("rw", db.sessions, db.setLogs, async () => {
    const session = await db.sessions.get(input.sessionId);
    if (!session) throw new Error(`Session ${input.sessionId} not found`);
    if (session.status !== "in_progress") throw new Error("Session is not in progress");
    if (!session.exercises.some((e) => e.exerciseId === input.exerciseId)) {
      throw new Error(`Exercise ${input.exerciseId} is not in this session`);
    }
    const id = `${input.sessionId}:${input.exerciseId}:${input.setIndex}`;
    const existing = await db.setLogs.get(id);
    const row: SetLog = {
      id,
      sessionId: input.sessionId,
      exerciseId: input.exerciseId,
      setIndex: input.setIndex,
      kg: input.kg,
      reps: input.reps,
      rir: normalizeRir(input.rir),
      loggedAt: existing?.loggedAt ?? deps.now(),
    };
    await db.setLogs.put(row);
    return row;
  });
}

export type FinishResult = { session: Session; plan: Plan | undefined; newBlock: boolean };

/** Completes the session (also early, W28), moves the loop on and starts the next block when it is due. */
export async function finishSession(db: WorkoutDb, sessionId: string, deps: Deps = defaultDeps): Promise<FinishResult> {
  return db.transaction("rw", db.sessions, db.plans, db.setLogs, async () => {
    const found = await db.sessions.get(sessionId);
    if (!found) throw new Error(`Session ${sessionId} not found`);
    if (found.status !== "in_progress") throw new Error("Session is not in progress");
    // W28: finishing early is allowed, but only after at least one set is logged
    if ((await db.setLogs.where("sessionId").equals(sessionId).count()) < 1) throw new Error("Log at least one set before finishing");
    const session: Session = { ...found, status: "completed", finishedAt: deps.now() };
    await db.sessions.put(session);

    const plan = await db.plans.get(session.planId);
    if (!plan || plan.status !== "active") return { session, plan, newBlock: false };

    const all = await db.sessions.where("planId").equals(plan.id).toArray();
    const done = completedCount(all, plan);
    const next = rotateBlockIfDue(completeSession(plan, session), done);
    await db.plans.put(next);
    return { session, plan: next, newBlock: isNewBlockStart(next, done) };
  });
}

/** Abandons the session. Its sets stay stored but never count for progression or the block. */
export async function discardSession(db: WorkoutDb, sessionId: string, deps: Deps = defaultDeps): Promise<Session> {
  return db.transaction("rw", db.sessions, async () => {
    const found = await db.sessions.get(sessionId);
    if (!found) throw new Error(`Session ${sessionId} not found`);
    if (found.status !== "in_progress") throw new Error("Session is not in progress");
    const session: Session = { ...found, status: "abandoned", finishedAt: deps.now() };
    await db.sessions.put(session);
    return session;
  });
}

/** Swap one exercise in the running session. Logged sets of every exercise are kept. */
export async function swapExercise(
  db: WorkoutDb,
  sessionId: string,
  slot: string,
  newExerciseId: string,
  catalog: readonly Exercise[] = EXERCISES,
): Promise<Session> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.status !== "in_progress") throw new Error("Session is not in progress");
  const plan = await db.plans.get(session.planId);
  if (!plan) throw new Error(`Plan ${session.planId} not found`);
  const history = await getHistory(db);
  const swapped = applySwap(session, slot, newExerciseId, catalog, plan.profile, history);
  const updated: Session = { ...session, exercises: swapped.exercises };
  await db.sessions.put(updated);
  return updated;
}
