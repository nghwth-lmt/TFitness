import { MAX_SPLIT_DAYS, MIN_TRAINING_DAYS, SPLIT_BY_DAYS } from "../config";
import type { Muscle, Pattern, SlotRole, SplitId } from "../domain";

/** One slot of a template, listed in priority order (first = filled first, cut last). */
export type SlotSpec = { pattern: Pattern; role: SlotRole; muscle?: Muscle };
export type TemplateSpec = { name: string; slots: SlotSpec[] };

const M = (pattern: Pattern, muscle?: Muscle): SlotSpec => ({ pattern, role: "main", muscle });
const A = (pattern: Pattern, muscle?: Muscle): SlotSpec => ({ pattern, role: "accessory", muscle });

const UPPER_A: SlotSpec[] = [
  M("horizontal_push"), M("horizontal_pull"), A("vertical_push"), A("vertical_pull"),
  A("side_delt"), A("arms", "biceps"), A("arms", "triceps"),
];
const UPPER_B: SlotSpec[] = [
  M("vertical_push"), M("vertical_pull"), A("horizontal_push"), A("horizontal_pull"),
  A("side_delt"), A("arms", "triceps"), A("arms", "biceps"),
];
const LOWER_A: SlotSpec[] = [M("squat"), M("hinge"), A("single_leg"), A("calves"), A("core")];
const LOWER_B: SlotSpec[] = [M("hinge"), M("single_leg"), A("squat"), A("calves"), A("core")];
const PUSH_A: SlotSpec[] = [M("horizontal_push"), M("vertical_push"), A("horizontal_push"), A("side_delt"), A("arms", "triceps")];
const PUSH_B: SlotSpec[] = [M("vertical_push"), M("horizontal_push"), A("vertical_push"), A("side_delt"), A("arms", "triceps")];
const PULL_A: SlotSpec[] = [M("vertical_pull"), M("horizontal_pull"), A("horizontal_pull"), A("arms", "biceps"), A("side_delt"), A("core")];
const PULL_B: SlotSpec[] = [M("horizontal_pull"), M("vertical_pull"), A("vertical_pull"), A("arms", "biceps"), A("side_delt"), A("core")];

export const SPLITS: Record<SplitId, TemplateSpec[]> = {
  fullbody_ab: [
    { name: "Full body A", slots: [M("squat"), M("horizontal_push"), M("horizontal_pull"), A("hinge"), A("side_delt"), A("core"), A("arms", "biceps")] },
    { name: "Full body B", slots: [M("hinge"), M("vertical_push"), M("vertical_pull"), A("single_leg"), A("arms", "triceps"), A("core"), A("calves")] },
  ],
  fullbody_abc: [
    { name: "Full body A", slots: [M("squat"), M("horizontal_push"), M("horizontal_pull"), A("hinge"), A("side_delt"), A("core"), A("arms", "biceps")] },
    { name: "Full body B", slots: [M("hinge"), M("vertical_push"), M("vertical_pull"), A("single_leg"), A("arms", "triceps"), A("core"), A("calves")] },
    { name: "Full body C", slots: [M("single_leg"), M("horizontal_push"), M("horizontal_pull"), A("squat"), A("side_delt"), A("arms", "biceps"), A("core")] },
  ],
  upper_lower: [
    { name: "Upper A", slots: UPPER_A },
    { name: "Lower A", slots: LOWER_A },
    { name: "Upper B", slots: UPPER_B },
    { name: "Lower B", slots: LOWER_B },
  ],
  ppl_ul: [
    { name: "Push", slots: PUSH_A },
    { name: "Pull", slots: PULL_A },
    { name: "Legs", slots: LOWER_A },
    { name: "Upper", slots: UPPER_B },
    { name: "Lower", slots: LOWER_B },
  ],
  ppl_ppl: [
    { name: "Push A", slots: PUSH_A },
    { name: "Pull A", slots: PULL_A },
    { name: "Legs A", slots: LOWER_A },
    { name: "Push B", slots: PUSH_B },
    { name: "Pull B", slots: PULL_B },
    { name: "Legs B", slots: LOWER_B },
  ],
};

/** Template keys are letters in loop order. */
export const TEMPLATE_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

/** 7 days uses the 6-day split (the PRD only defines 2-6). */
export function splitForDays(days: number): SplitId {
  if (days < MIN_TRAINING_DAYS) throw new RangeError("Pick at least 2 days");
  return SPLIT_BY_DAYS[Math.min(days, MAX_SPLIT_DAYS)];
}
