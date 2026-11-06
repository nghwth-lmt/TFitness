import {
  BODY_AREAS,
  EQUIPMENT_IDS,
  GOALS,
  migrateEquipmentIds,
  LEVELS,
  PATTERNS,
  SESSION_MINUTES,
  SPLIT_IDS,
  WEEKDAYS,
  type Plan,
  type Profile,
  type Session,
  type SetLog,
} from "../domain";
import { MAX_SPLIT_DAYS } from "../config";
import { PROFILE_ID, type WorkoutDb } from "./db";
import { defaultDeps, type Deps } from "./repository";

export const BACKUP_VERSION = 1;

export type BackupFile = {
  app: "spotter";
  kind: "workout-plan";
  version: number;
  exportedAt: number;
  profile: Profile | null;
  plans: Plan[];
  sessions: Session[];
  setLogs: SetLog[];
};

export async function exportBackup(db: WorkoutDb, deps: Deps = defaultDeps): Promise<BackupFile> {
  const [row, plans, sessions, setLogs] = await Promise.all([
    db.profile.get(PROFILE_ID),
    db.plans.toArray(),
    db.sessions.toArray(),
    db.setLogs.toArray(),
  ]);
  let profile: Profile | null = null;
  if (row) {
    const { id: _id, ...rest } = row;
    void _id;
    profile = rest;
  }
  return {
    app: "spotter",
    kind: "workout-plan",
    version: BACKUP_VERSION,
    exportedAt: deps.now(),
    profile,
    plans: plans.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    sessions: sessions.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id)),
    setLogs: setLogs.sort((a, b) => a.loggedAt - b.loggedAt || a.id.localeCompare(b.id)),
  };
}

export async function exportJson(db: WorkoutDb, deps: Deps = defaultDeps): Promise<string> {
  return JSON.stringify(await exportBackup(db, deps), null, 2);
}

// ---- validation ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const inList = (list: readonly unknown[], v: unknown) => list.includes(v);

function checkProfile(p: unknown, path: string, errors: string[]) {
  if (!isObj(p)) return errors.push(`${path} must be an object`);
  if (!Array.isArray(p.trainingDays) || !p.trainingDays.every((d) => inList(WEEKDAYS, d)) || p.trainingDays.length > MAX_SPLIT_DAYS) errors.push(`${path}.trainingDays invalid (2 to ${MAX_SPLIT_DAYS} days)`);
  if (!inList(SESSION_MINUTES, p.sessionMinutes)) errors.push(`${path}.sessionMinutes must be one of ${SESSION_MINUTES.join("/")}`);
  if (!Array.isArray(p.equipment) || !p.equipment.every((e) => inList(EQUIPMENT_IDS, e))) errors.push(`${path}.equipment invalid`);
  if (!inList(GOALS, p.goal)) errors.push(`${path}.goal invalid`);
  if (!inList(LEVELS, p.level)) errors.push(`${path}.level invalid`);
  if (!Array.isArray(p.avoid) || !p.avoid.every((a) => inList(BODY_AREAS, a))) errors.push(`${path}.avoid invalid`);
  if (!isNum(p.updatedAt)) errors.push(`${path}.updatedAt must be a number`);
  if (p.dumbbellRange !== undefined) {
    const r = p.dumbbellRange;
    if (!isObj(r) || !isNum(r.min) || !isNum(r.max) || !isNum(r.step) || r.step <= 0 || r.min > r.max) errors.push(`${path}.dumbbellRange invalid`);
  }
}

function checkPlan(p: unknown, i: number, errors: string[]) {
  const path = `plans[${i}]`;
  if (!isObj(p)) return errors.push(`${path} must be an object`);
  if (!isStr(p.id)) errors.push(`${path}.id missing`);
  if (!inList(["active", "archived"], p.status)) errors.push(`${path}.status invalid`);
  if (!inList(SPLIT_IDS, p.split)) errors.push(`${path}.split invalid`);
  checkProfile(p.profile, `${path}.profile`, errors);
  if (!Array.isArray(p.templates)) errors.push(`${path}.templates must be an array`);
  else
    p.templates.forEach((t, j) => {
      if (!isObj(t) || !isStr(t.key) || !Array.isArray(t.slots) || !Array.isArray(t.notes)) return errors.push(`${path}.templates[${j}] invalid`);
      for (const s of t.slots) {
        if (!isObj(s) || !isStr(s.slot) || !isStr(s.exerciseId) || !inList(PATTERNS, s.pattern) || !inList(["main", "accessory"], s.role)) {
          errors.push(`${path}.templates[${j}].slots invalid`);
          break;
        }
      }
    });
  for (const k of ["blockIndex", "blockStartedAtCompletedCount", "cursor"] as const) if (!isInt(p[k]) || (p[k] as number) < 0) errors.push(`${path}.${k} must be a whole number, 0 or more`);
  if (!isNum(p.seed)) errors.push(`${path}.seed must be a number`);
  if (!isNum(p.createdAt)) errors.push(`${path}.createdAt must be a number`);
}

function checkSession(s: unknown, i: number, errors: string[]) {
  const path = `sessions[${i}]`;
  if (!isObj(s)) return errors.push(`${path} must be an object`);
  if (!isStr(s.id) || !isStr(s.planId) || !isStr(s.templateKey)) errors.push(`${path} needs id, planId and templateKey`);
  if (!inList(["planned", "in_progress", "completed", "abandoned"], s.status)) errors.push(`${path}.status invalid`);
  if (!Array.isArray(s.exercises) || !s.exercises.every((e) => isObj(e) && isStr(e.exerciseId) && isStr(e.slot))) errors.push(`${path}.exercises invalid`);
  if (s.startedAt !== null && !isNum(s.startedAt)) errors.push(`${path}.startedAt must be a number or null`);
  if (s.finishedAt !== null && !isNum(s.finishedAt)) errors.push(`${path}.finishedAt must be a number or null`);
}

function checkSetLog(l: unknown, i: number, errors: string[]) {
  const path = `setLogs[${i}]`;
  if (!isObj(l)) return errors.push(`${path} must be an object`);
  if (!isStr(l.id) || !isStr(l.sessionId) || !isStr(l.exerciseId)) errors.push(`${path} needs id, sessionId and exerciseId`);
  if (!isInt(l.setIndex) || (l.setIndex as number) < 0) errors.push(`${path}.setIndex invalid`);
  if (l.kg !== null && !(isNum(l.kg) && l.kg >= 0)) errors.push(`${path}.kg must be 0 or more, or null`);
  if (!isInt(l.reps) || (l.reps as number) < 0) errors.push(`${path}.reps must be a whole number, 0 or more`);
  if (!(l.rir === null || l.rir === 0 || l.rir === 1 || l.rir === 2 || l.rir === 3)) errors.push(`${path}.rir must be 0, 1, 2, 3 or null`);
  if (!isNum(l.loggedAt)) errors.push(`${path}.loggedAt must be a number`);
}

function upgradeLegacyEquipment(input: Obj) {
  const fix = (p: unknown) => {
    if (isObj(p) && Array.isArray(p.equipment) && p.equipment.every((e) => typeof e === "string")) {
      p.equipment = migrateEquipmentIds(p.equipment as string[], { keepUnknown: true });
    }
  };
  fix(input.profile);
  for (const plan of input.plans as unknown[]) if (isObj(plan)) fix(plan.profile);
}

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; errors: string[] };

export function parseBackup(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["File must be a JSON object"] };
  if (input.app !== "spotter") errors.push("Not a Spotter file (app)");
  if (input.kind !== "workout-plan") errors.push("Not a workout-plan backup (kind)");
  if (!isInt(input.version)) errors.push("version must be a whole number");
  else if ((input.version as number) > BACKUP_VERSION) errors.push(`File is from a newer version (${input.version}); update the app first`);
  for (const key of ["plans", "sessions", "setLogs"] as const) if (!Array.isArray(input[key])) errors.push(`${key} must be an array`);
  if (errors.length) return { ok: false, errors };

  // Files written before PRD v1.1 use the 8 old equipment ids: upgrade them first (AC20).
  upgradeLegacyEquipment(input);
  if (input.profile !== null) checkProfile(input.profile, "profile", errors);
  (input.plans as unknown[]).forEach((p, i) => checkPlan(p, i, errors));
  (input.sessions as unknown[]).forEach((s, i) => checkSession(s, i, errors));
  (input.setLogs as unknown[]).forEach((l, i) => checkSetLog(l, i, errors));
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, file: input as unknown as BackupFile };
}

// ---- import (merge, never delete) ----

export type ImportResult =
  | {
      ok: true;
      added: { plans: number; sessions: number; setLogs: number };
      updated: { sessions: number; setLogs: number };
      skipped: { plans: number; sessions: number; setLogs: number };
      abandonedInProgress: number;
    }
  | { ok: false; errors: string[] };

const TERMINAL = ["completed", "abandoned"];

/**
 * Merges a backup into the database in one transaction. Nothing is deleted:
 * - plans and set logs are added by id; an existing plan is kept as is;
 * - a finished local session (and its sets) is frozen: an imported copy never changes it;
 * - the newest plan stays active, the newest in-progress session stays open (others are
 *   abandoned, sets kept); the profile is replaced only by a newer or equal one.
 */
export async function importJson(db: WorkoutDb, text: string, deps: Deps = defaultDeps): Promise<ImportResult> {
  return runImport(db, text, deps, false);
}

/**
 * Same merge as `importJson`, but rolled back at the end: returns what the import would add, update and
 * skip, so the confirm sheet can show the number of sessions and sets (W23). Nothing is written.
 */
export async function previewImport(db: WorkoutDb, text: string, deps: Deps = defaultDeps): Promise<ImportResult> {
  return runImport(db, text, deps, true);
}

class DryRunDone extends Error {}

async function runImport(db: WorkoutDb, text: string, deps: Deps, dryRun: boolean): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["File is not valid JSON"] };
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) return parsed;
  const { file } = parsed;

  const added = { plans: 0, sessions: 0, setLogs: 0 };
  const updated = { sessions: 0, setLogs: 0 };
  const skipped = { plans: 0, sessions: 0, setLogs: 0 };
  let abandonedInProgress = 0;

  try {
    await db.transaction("rw", db.profile, db.plans, db.sessions, db.setLogs, async () => {
    const localSessions = new Map((await db.sessions.toArray()).map((s) => [s.id, s]));
    const terminalBefore = new Set([...localSessions.values()].filter((s) => TERMINAL.includes(s.status)).map((s) => s.id));

    for (const plan of file.plans) {
      if (await db.plans.get(plan.id)) skipped.plans++;
      else {
        await db.plans.add(plan);
        added.plans++;
      }
    }

    for (const s of file.sessions) {
      const local = localSessions.get(s.id);
      if (!local) {
        await db.sessions.add(s);
        localSessions.set(s.id, s);
        added.sessions++;
      } else if (TERMINAL.includes(local.status)) skipped.sessions++;
      else {
        await db.sessions.put(s);
        localSessions.set(s.id, s);
        updated.sessions++;
      }
    }

    for (const l of file.setLogs) {
      if (terminalBefore.has(l.sessionId)) {
        skipped.setLogs++; // a finished local session is frozen
        continue;
      }
      if (await db.setLogs.get(l.id)) {
        await db.setLogs.put(l);
        updated.setLogs++;
      } else {
        await db.setLogs.add(l);
        added.setLogs++;
      }
    }

    // exactly one active plan: the newest
    const plans = await db.plans.toArray();
    const active = plans.filter((p) => p.status === "active").sort((a, b) => b.createdAt - a.createdAt);
    for (const extra of active.slice(1)) await db.plans.update(extra.id, { status: "archived" });

    // exactly one in-progress session: the newest
    const open = (await db.sessions.where("status").equals("in_progress").toArray()).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    for (const extra of open.slice(1)) {
      await db.sessions.update(extra.id, { status: "abandoned", finishedAt: deps.now() });
      abandonedInProgress++;
    }

    const local = await db.profile.get(PROFILE_ID);
    if (file.profile && (!local || file.profile.updatedAt >= local.updatedAt)) {
      await db.profile.put({ ...file.profile, id: PROFILE_ID });
    }
    if (dryRun) throw new DryRunDone();
  });
  } catch (e) {
    if (!(e instanceof DryRunDone)) throw e;
  }

  return { ok: true, added, updated, skipped, abandonedInProgress };
}
