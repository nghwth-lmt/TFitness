import { EXERCISES } from "../data/exercises";
import type { Exercise, History, Plan, Profile, Rir, Session, SessionDraft, SetLog } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { normalizeRir } from "../engine/progression";
import { completedCount, completeSession, isNewBlockStart, rotateBlockIfDue } from "../engine/schedule";
import { applySwap } from "../engine/substitution";
import { PROFILE_ID, type WorkoutDb } from "./db";

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

/**
 * Setup and rebuild share this: the old active plan becomes `archived` (never deleted), the new
 * plan is `active`, and no set log is touched (AC14).
 */
export async function buildAndSavePlan(
  db: WorkoutDb,
  profile: Profile,
  catalog: readonly Exercise[] = EXERCISES,
  seed: number,
  deps: Deps = defaultDeps,
): Promise<Plan> {
  const plan = buildPlan(profile, catalog, seed, { createdAt: deps.now(), id: `plan-${deps.newId()}` });
  await db.transaction("rw", db.profile, db.plans, async () => {
    await db.plans.where("status").equals("active").modify({ status: "archived" });
    await db.plans.add(plan);
    await db.profile.put({ ...profile, id: PROFILE_ID });
  });
  return plan;
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
