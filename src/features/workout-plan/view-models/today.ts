import { MAX_PLACES } from "../config";
import { EXERCISES } from "../data/exercises";
import type { EquipmentId, Exercise, Place, Plan, Profile, RepRange, Session, SessionDraft, SetLog, Weekday } from "../domain";
import { estimateMinutes } from "../engine/estimateMinutes";
import { completedCount, isNewBlockStart, nextSession } from "../engine/schedule";
import { adjustForToday } from "../engine/substitution";
import { exerciseInfo } from "./exerciseInfo";

const DAY_MS = 86_400_000;
const SUNDAY_FIRST: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Minutes east of UTC for the device (what `new Date().getTimezoneOffset()` negated gives). */
export function deviceOffsetMin(now: number): number {
  return -new Date(now).getTimezoneOffset();
}

export function localWeekday(now: number, utcOffsetMin: number): Weekday {
  return SUNDAY_FIRST[new Date(now + utcOffsetMin * 60_000).getUTCDay()];
}

/** Epoch ms of the Monday 00:00 (device time) that starts the week containing `now` (W20). */
export function weekStartUtc(now: number, utcOffsetMin: number): number {
  const local = now + utcOffsetMin * 60_000;
  const daysSinceMonday = (new Date(local).getUTCDay() + 6) % 7;
  return Math.floor(local / DAY_MS) * DAY_MS - daysSinceMonday * DAY_MS - utcOffsetMin * 60_000;
}

/**
 * The 7 days of the current week (Monday first, device time). A day with a completed session is `done`
 * (also today, so finishing today turns the ring into a tick); else today is `today`; other days are
 * `planned` or `missed` on a training day (ahead or past) and `rest` otherwise.
 */
export function buildWeekStrip(input: {
  now: number;
  utcOffsetMin: number;
  trainingDays: readonly Weekday[];
  sessions: readonly Pick<Session, "status" | "finishedAt">[];
}): WeekStripDay[] {
  const start = weekStartUtc(input.now, input.utcOffsetMin);
  const finished = input.sessions.filter((s) => s.status === "completed" && s.finishedAt !== null).map((s) => s.finishedAt as number);
  const todayIndex = Math.floor((input.now - start) / DAY_MS);
  return Array.from({ length: 7 }, (_, i) => {
    const from = start + i * DAY_MS;
    const date = new Date(from + input.utcOffsetMin * 60_000).toISOString().slice(0, 10);
    let state: WeekDayState;
    if (finished.some((t) => t >= from && t < from + DAY_MS)) state = "done";
    else if (i === todayIndex) state = "today";
    else if (!input.trainingDays.includes(localWeekday(from, input.utcOffsetMin))) state = "rest";
    else state = i > todayIndex ? "planned" : "missed";
    return { date, state };
  });
}

export type WeekStats = {
  /** Completed sessions this week (Monday 00:00 to Sunday, device time). */
  done: number;
  /** Training days declared in the profile. */
  planned: number;
  /** Consecutive weeks with done >= planned, counted back from last week; this week joins once it is reached. */
  streakWeeks: number;
  /** Sum of kg x reps over the sets of completed sessions this week. Bodyweight sets count kg as 0. */
  volumeKg: number;
  sets: number;
  /** Whole-number percent against last week. null when last week has 0 (UI shows a dash, never 0%). */
  deltaVolumePct: number | null;
  deltaSetsPct: number | null;
};

const MAX_STREAK_WEEKS = 520;
const pct = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/** Weekly numbers for the Today widgets (W42, AC27). Only `completed` sessions count; abandoned and in-progress never do. */
export function buildWeekStats(input: {
  now: number;
  utcOffsetMin: number;
  planned: number;
  sessions: readonly Pick<Session, "id" | "status" | "finishedAt">[];
  setLogs: readonly SetLog[];
  catalog?: readonly Exercise[];
}): WeekStats {
  const catalog = input.catalog ?? EXERCISES;
  const start = weekStartUtc(input.now, input.utcOffsetMin);
  const finished = input.sessions.filter((s) => s.status === "completed" && s.finishedAt !== null) as { id: string; finishedAt: number }[];
  const inWeek = (from: number) => finished.filter((s) => s.finishedAt >= from && s.finishedAt < from + 7 * DAY_MS);
  const bodyweight = new Set(catalog.filter((c) => c.loadType === "bodyweight").map((c) => c.id));
  const totals = (from: number) => {
    const ids = new Set(inWeek(from).map((s) => s.id));
    let volumeKg = 0;
    let sets = 0;
    for (const l of input.setLogs) {
      if (!ids.has(l.sessionId)) continue;
      sets += 1;
      volumeKg += bodyweight.has(l.exerciseId) ? 0 : (l.kg ?? 0) * l.reps;
    }
    return { volumeKg: Math.round(volumeKg * 100) / 100, sets };
  };
  const reached = (from: number) => input.planned > 0 && inWeek(from).length >= input.planned;

  const now = totals(start);
  const before = totals(start - 7 * DAY_MS);
  let streakWeeks = reached(start) ? 1 : 0;
  for (let i = 1; i <= MAX_STREAK_WEEKS && reached(start - i * 7 * DAY_MS); i++) streakWeeks += 1;
  return {
    done: inWeek(start).length,
    planned: input.planned,
    streakWeeks,
    volumeKg: now.volumeKg,
    sets: now.sets,
    deltaVolumePct: pct(now.volumeKg, before.volumeKg),
    deltaSetsPct: pct(now.sets, before.sets),
  };
}

export type TodayExerciseRow = {
  exerciseId: string;
  slot: string;
  name: string;
  cue: string;
  /** First frame for the list thumbnail; "" when the exercise is no longer in the catalog. */
  thumbnail: string;
  images: string[];
  sets: number;
  repRange: RepRange;
  targetKg: number | null;
  targetReps?: number;
  hint?: string;
};

/** done = a completed session that day; today = the current day; planned = a training day still ahead; missed = a training day that passed without one; rest = not a training day. */
export type WeekDayState = "done" | "planned" | "today" | "rest" | "missed";
export type WeekStripDay = { date: string; state: WeekDayState };

type Common = {
  weekday: Weekday;
  /** Monday to Sunday of the current week, device time (W34). */
  weekStrip: WeekStripDay[];
  /** Today is one of the declared training days. */
  isTrainingDay: boolean;
  weekProgress: { completed: number; target: number };
  /** Week ring, streak, volume and sets widgets (W42). */
  weekStats: WeekStats;
};

export type TodayVM =
  | { kind: "needs_setup" }
  | ({ kind: "resume"; session: Session; loggedSets: number; totalSets: number } & Common)
  | ({
      kind: "next";
      draft: SessionDraft;
      name: string;
      exerciseCount: number;
      estimatedMinutes: number;
      /** Not a training day: UI says "Rest day · train anyway?". */
      restDay: boolean;
      /** First session of a new block: UI shows the "New block" card. */
      newBlock: boolean;
      adjustedForToday: boolean;
      /** Chip "At: <place>" (W32). Null when no place is saved yet. */
      atPlace: Place | null;
      /** Every saved place, for the "Where are you training?" sheet (D1). */
      places: Place[];
      canAddPlace: boolean;
      exercises: TodayExerciseRow[];
      notes: string[];
    } & Common);

export type TodayInput = {
  profile: Profile | undefined;
  plan: Plan | undefined;
  sessions: readonly Session[];
  setLogs: readonly SetLog[];
  now: number;
  /** Minutes east of UTC. Defaults to the device zone. */
  utcOffsetMin?: number;
  /** Equipment ticked in "What do I have today?". Absent = the plan's equipment. */
  todayEquipment?: readonly EquipmentId[];
  /** Saved places (W32). */
  places?: readonly Place[];
  /** Where the user trains today and the items unticked for today. Absent = the default place, nothing unticked. */
  today?: { placeId?: string; without?: readonly EquipmentId[] };
  catalog?: readonly Exercise[];
};

/** Pure view model of the Today screen: Resume > Next > New block. */
export function buildTodayVM(input: TodayInput): TodayVM {
  const { profile, plan, sessions, setLogs, now } = input;
  const catalog = input.catalog ?? EXERCISES;
  if (!profile || !plan) return { kind: "needs_setup" };

  const offset = input.utcOffsetMin ?? deviceOffsetMin(now);
  const weekday = localWeekday(now, offset);
  const start = weekStartUtc(now, offset);
  const common: Common = {
    weekday,
    weekStrip: buildWeekStrip({ now, utcOffsetMin: offset, trainingDays: profile.trainingDays, sessions }),
    isTrainingDay: profile.trainingDays.includes(weekday),
    weekStats: buildWeekStats({ now, utcOffsetMin: offset, planned: profile.trainingDays.length, sessions, setLogs, catalog }),
    weekProgress: {
      completed: sessions.filter((s) => s.status === "completed" && s.finishedAt !== null && s.finishedAt >= start && s.finishedAt < start + 7 * DAY_MS).length,
      target: profile.trainingDays.length,
    },
  };

  const open = sessions
    .filter((s) => s.status === "in_progress")
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  if (open) {
    return {
      kind: "resume",
      session: open,
      loggedSets: setLogs.filter((l) => l.sessionId === open.id).length,
      totalSets: open.exercises.reduce((n, e) => n + e.targetSets, 0),
      ...common,
    };
  }

  const history = { sessions: [...sessions], setLogs: [...setLogs] };
  let draft = nextSession(plan, history, catalog);
  const places = [...(input.places ?? [])];
  const defaultPlace = places.find((p) => p.isDefault) ?? places[0] ?? null;
  const atPlace = (input.today?.placeId ? places.find((p) => p.id === input.today?.placeId) : undefined) ?? defaultPlace;
  const without = input.today?.without ?? [];
  if (atPlace && (atPlace.id !== defaultPlace?.id || without.length > 0)) {
    draft = adjustForToday(draft, { place: atPlace, without }, catalog, plan.profile, history);
  } else if (input.todayEquipment) {
    draft = adjustForToday(draft, input.todayEquipment, catalog, plan.profile, history);
  }

  return {
    kind: "next",
    draft,
    name: draft.name,
    exerciseCount: draft.exercises.length,
    estimatedMinutes: estimateMinutes(draft),
    restDay: !common.isTrainingDay,
    newBlock: isNewBlockStart(plan, completedCount(sessions, plan)),
    adjustedForToday: draft.adjustedForToday,
    atPlace,
    places,
    canAddPlace: places.length < MAX_PLACES,
    exercises: draft.exercises.map((e) => {
      const ex = catalog.find((c) => c.id === e.exerciseId);
      return {
        exerciseId: e.exerciseId,
        slot: e.slot,
        name: ex?.name ?? e.exerciseId,
        cue: ex?.cue ?? "",
        thumbnail: ex?.images[0] ?? "",
        images: exerciseInfo(ex).images,
        sets: e.targetSets,
        repRange: e.repRange,
        targetKg: e.targetKg,
        ...(e.targetReps !== undefined ? { targetReps: e.targetReps } : {}),
        ...(e.hint !== undefined ? { hint: e.hint } : {}),
      };
    }),
    notes: draft.notes,
    ...common,
  };
}

