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

type Common = {
  weekday: Weekday;
  /** Today is one of the declared training days. */
  isTrainingDay: boolean;
  weekProgress: { completed: number; target: number };
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
    isTrainingDay: profile.trainingDays.includes(weekday),
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

