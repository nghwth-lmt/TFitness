import { LEGACY_EQUIPMENT_MAP } from "../domain/equipment";
import type {
  BodyArea,
  EquipmentId,
  Exercise,
  ExerciseRole,
  Level,
  LoadType,
  Muscle,
  Pattern,
} from "../domain";

// Product data (W06): name, pattern, equipment, muscles, level, one-line cue.
// Equipment is an OR of ANDs. `[[]]` means no equipment.
// `level` is the minimum level the exercise suits.

type Row = [
  id: string,
  name: string,
  pattern: Pattern,
  role: ExerciseRole,
  equipment: string[][],
  muscles: Muscle[],
  level: Level,
  avoidFlags: BodyArea[],
  loadType: LoadType,
  cue: string,
];

const NONE: string[][] = [[]];

/** Rows below still use the 8 old ids (replaced by the imported catalog in WL-12). A tick of "machines" means any machine, so it becomes alternatives. */
function toNewIds(alternatives: string[][]): EquipmentId[][] {
  return alternatives.flatMap((and) =>
    and.reduce<EquipmentId[][]>((acc, id) => acc.flatMap((prefix) => LEGACY_EQUIPMENT_MAP[id].map((n) => [...prefix, n])), [[]]),
  );
}

const rows: Row[] = [
  // squat
  ["back_squat", "Barbell Back Squat", "squat", "main", [["barbell", "rack"]], ["quads", "glutes"], "intermediate", ["lower_back"], "barbell", "Brace, sit between your hips, drive the floor away."],
  ["front_squat", "Barbell Front Squat", "squat", "main", [["barbell", "rack"]], ["quads", "core"], "advanced", ["wrist"], "barbell", "Elbows high, chest tall, stay upright."],
  ["goblet_squat", "Goblet Squat", "squat", "both", [["dumbbells"]], ["quads", "glutes"], "beginner", [], "dumbbell", "Hold the weight at your chest, knees track over toes."],
  ["leg_press", "Leg Press", "squat", "both", [["machines"]], ["quads", "glutes"], "beginner", [], "machine", "Feet shoulder-width, lower until knees reach about 90 degrees."],
  ["bodyweight_squat", "Bodyweight Squat", "squat", "both", NONE, ["quads", "glutes"], "beginner", [], "bodyweight", "Sit back and down, heels stay flat."],
  ["jump_squat", "Jump Squat", "squat", "accessory", NONE, ["quads", "glutes"], "intermediate", ["knee"], "bodyweight", "Land softly and reset before each jump."],
  ["leg_extension", "Machine Leg Extension", "squat", "accessory", [["machines"]], ["quads"], "beginner", ["knee"], "machine", "Squeeze at the top, lower slowly."],
  // hinge
  ["deadlift", "Conventional Deadlift", "hinge", "main", [["barbell"]], ["hamstrings", "glutes", "back"], "intermediate", ["lower_back"], "barbell", "Bar over mid-foot, flat back, push the floor away."],
  ["romanian_deadlift", "Romanian Deadlift", "hinge", "main", [["barbell"]], ["hamstrings", "glutes"], "intermediate", ["lower_back"], "barbell", "Push hips back, bar slides along your legs."],
  ["db_romanian_deadlift", "Dumbbell Romanian Deadlift", "hinge", "both", [["dumbbells"]], ["hamstrings", "glutes"], "beginner", ["lower_back"], "dumbbell", "Soft knees, hips back, feel the hamstring stretch."],
  ["barbell_hip_thrust", "Barbell Hip Thrust", "hinge", "main", [["barbell", "bench"]], ["glutes"], "intermediate", [], "barbell", "Chin tucked, ribs down, squeeze hard at the top."],
  ["glute_bridge", "Glute Bridge", "hinge", "both", NONE, ["glutes", "hamstrings"], "beginner", [], "bodyweight", "Drive through heels, pause at the top."],
  ["cable_pull_through", "Cable Pull-Through", "hinge", "accessory", [["cable"]], ["glutes", "hamstrings"], "beginner", [], "cable", "Hinge back, then snap hips forward."],
  ["leg_curl", "Machine Leg Curl", "hinge", "accessory", [["machines"]], ["hamstrings"], "beginner", [], "machine", "Curl smoothly, do not let the hips lift."],
  // horizontal push
  ["bench_press", "Barbell Bench Press", "horizontal_push", "main", [["barbell", "bench"]], ["chest", "triceps", "shoulders"], "beginner", ["shoulder"], "barbell", "Shoulder blades pinched, bar touches mid-chest."],
  ["db_bench_press", "Dumbbell Bench Press", "horizontal_push", "both", [["dumbbells", "bench"]], ["chest", "triceps"], "beginner", ["shoulder"], "dumbbell", "Elbows about 45 degrees, press up and slightly in."],
  ["incline_db_press", "Incline Dumbbell Press", "horizontal_push", "both", [["dumbbells", "bench"]], ["chest", "shoulders"], "beginner", ["shoulder"], "dumbbell", "Bench at a low incline, control the way down."],
  ["push_up", "Push-Up", "horizontal_push", "both", NONE, ["chest", "triceps", "core"], "beginner", ["wrist"], "bodyweight", "Body in one line, chest to the floor."],
  ["incline_push_up", "Incline Push-Up", "horizontal_push", "accessory", [["bench"]], ["chest", "triceps"], "beginner", ["wrist"], "bodyweight", "Hands on the bench, a gentler push-up."],
  ["machine_chest_press", "Machine Chest Press", "horizontal_push", "both", [["machines"]], ["chest", "triceps"], "beginner", [], "machine", "Handles at chest height, press without shrugging."],
  ["cable_chest_fly", "Cable Chest Fly", "horizontal_push", "accessory", [["cable"]], ["chest"], "intermediate", ["shoulder"], "cable", "Slight elbow bend, hug a big tree."],
  // horizontal pull
  ["barbell_row", "Barbell Bent-Over Row", "horizontal_pull", "main", [["barbell"]], ["back", "biceps"], "intermediate", ["lower_back"], "barbell", "Hinge forward, pull the bar to your belly."],
  ["one_arm_db_row", "One-Arm Dumbbell Row", "horizontal_pull", "both", [["dumbbells"]], ["back", "biceps"], "beginner", [], "dumbbell", "Pull the elbow to your hip, keep the torso still."],
  ["chest_supported_row", "Chest-Supported Dumbbell Row", "horizontal_pull", "both", [["dumbbells", "bench"]], ["back"], "beginner", [], "dumbbell", "Chest on the incline bench, pull elbows back."],
  ["seated_cable_row", "Seated Cable Row", "horizontal_pull", "both", [["cable"]], ["back", "biceps"], "beginner", [], "cable", "Sit tall, squeeze shoulder blades together."],
  ["machine_row", "Machine Row", "horizontal_pull", "both", [["machines"]], ["back"], "beginner", [], "machine", "Chest against the pad, pull without leaning back."],
  ["table_inverted_row", "Table Inverted Row", "horizontal_pull", "both", NONE, ["back", "biceps"], "beginner", [], "bodyweight", "Use a sturdy table, keep your body straight."],
  ["band_row", "Band Row", "horizontal_pull", "accessory", [["bands"]], ["back"], "beginner", [], "bodyweight", "Anchor the band, pull to your ribs."],
  ["face_pull", "Cable Face Pull", "horizontal_pull", "accessory", [["cable"]], ["shoulders", "back"], "beginner", [], "cable", "Pull to your forehead, elbows high."],
  // vertical push
  ["overhead_press", "Barbell Overhead Press", "vertical_push", "main", [["barbell"]], ["shoulders", "triceps"], "intermediate", ["shoulder", "lower_back"], "barbell", "Squeeze glutes, press the bar straight overhead."],
  ["standing_db_press", "Standing Dumbbell Shoulder Press", "vertical_push", "both", [["dumbbells"]], ["shoulders", "triceps"], "beginner", ["shoulder"], "dumbbell", "Ribs down, press to a full lockout."],
  ["seated_db_press", "Seated Dumbbell Shoulder Press", "vertical_push", "both", [["dumbbells", "bench"]], ["shoulders", "triceps"], "beginner", ["shoulder"], "dumbbell", "Back against the bench, press without arching."],
  ["machine_shoulder_press", "Machine Shoulder Press", "vertical_push", "both", [["machines"]], ["shoulders", "triceps"], "beginner", ["shoulder"], "machine", "Seat set so handles start at shoulder height."],
  ["pike_push_up", "Pike Push-Up", "vertical_push", "both", NONE, ["shoulders", "triceps"], "beginner", ["shoulder", "wrist"], "bodyweight", "Hips high, bend your knees to make it easier."],
  // vertical pull
  ["pull_up", "Pull-Up", "vertical_pull", "main", [["pullup_bar"]], ["back", "biceps"], "intermediate", [], "bodyweight", "Start from a dead hang, chin over the bar."],
  ["chin_up", "Chin-Up", "vertical_pull", "both", [["pullup_bar"]], ["back", "biceps"], "intermediate", [], "bodyweight", "Palms toward you, lead with your chest."],
  ["lat_pulldown", "Lat Pulldown", "vertical_pull", "both", [["cable"], ["machines"]], ["back", "biceps"], "beginner", [], "cable", "Pull the bar to your upper chest, elbows down."],
  ["assisted_pull_up", "Assisted Pull-Up", "vertical_pull", "both", [["machines"]], ["back", "biceps"], "beginner", [], "machine", "Use just enough assistance to finish each rep."],
  ["band_pulldown", "Band Lat Pulldown", "vertical_pull", "both", [["bands"]], ["back"], "beginner", [], "bodyweight", "Anchor the band high, pull elbows to your sides."],
  ["superman_pull", "Superman Lat Pull", "vertical_pull", "both", NONE, ["back"], "beginner", [], "bodyweight", "Lie face down, sweep arms from overhead to your sides."],
  ["db_pullover", "Dumbbell Pullover", "vertical_pull", "accessory", [["dumbbells", "bench"]], ["back", "chest"], "intermediate", ["shoulder"], "dumbbell", "Arc the weight back, keep elbows slightly bent."],
  // single leg
  ["bulgarian_split_squat", "Bulgarian Split Squat", "single_leg", "both", [["dumbbells", "bench"]], ["quads", "glutes"], "intermediate", ["knee"], "dumbbell", "Rear foot on the bench, drop straight down."],
  ["db_reverse_lunge", "Dumbbell Reverse Lunge", "single_leg", "both", [["dumbbells"]], ["quads", "glutes"], "beginner", ["knee"], "dumbbell", "Step back, front shin stays vertical."],
  ["bodyweight_reverse_lunge", "Bodyweight Reverse Lunge", "single_leg", "both", NONE, ["quads", "glutes"], "beginner", ["knee"], "bodyweight", "Step back, lower, drive through the front heel."],
  ["db_step_up", "Dumbbell Step-Up", "single_leg", "accessory", [["dumbbells", "bench"]], ["quads", "glutes"], "beginner", ["knee"], "dumbbell", "Drive through the top foot, do not push off the floor."],
  ["single_leg_rdl", "Single-Leg Romanian Deadlift", "single_leg", "accessory", NONE, ["hamstrings", "glutes"], "beginner", ["lower_back"], "bodyweight", "Hinge on one leg, keep hips square."],
  // core
  ["plank", "Plank", "core", "accessory", NONE, ["core"], "beginner", [], "bodyweight", "Ribs down, squeeze glutes, breathe."],
  ["dead_bug", "Dead Bug", "core", "accessory", NONE, ["core"], "beginner", [], "bodyweight", "Lower back stays pressed to the floor."],
  ["hanging_knee_raise", "Hanging Knee Raise", "core", "accessory", [["pullup_bar"]], ["core"], "intermediate", [], "bodyweight", "Curl the pelvis up, no swinging."],
  ["cable_crunch", "Cable Crunch", "core", "accessory", [["cable"]], ["core"], "beginner", ["lower_back"], "cable", "Round the spine, bring ribs toward hips."],
  ["pallof_press", "Pallof Press", "core", "accessory", [["cable"], ["bands"]], ["core"], "beginner", [], "cable", "Resist the pull, press straight out."],
  // arms
  ["db_curl", "Dumbbell Curl", "arms", "accessory", [["dumbbells"]], ["biceps"], "beginner", [], "dumbbell", "Elbows pinned to your sides, no swinging."],
  ["barbell_curl", "Barbell Curl", "arms", "accessory", [["barbell"]], ["biceps"], "beginner", ["wrist"], "barbell", "Keep your upper arms still."],
  ["cable_curl", "Cable Curl", "arms", "accessory", [["cable"]], ["biceps"], "beginner", [], "cable", "Constant tension, squeeze at the top."],
  ["triceps_pushdown", "Cable Triceps Pushdown", "arms", "accessory", [["cable"]], ["triceps"], "beginner", [], "cable", "Elbows tucked, fully straighten each rep."],
  ["db_overhead_triceps", "Dumbbell Overhead Triceps Extension", "arms", "accessory", [["dumbbells"]], ["triceps"], "beginner", ["shoulder"], "dumbbell", "Elbows point forward, lower behind your head."],
  ["close_grip_push_up", "Close-Grip Push-Up", "arms", "accessory", NONE, ["triceps", "chest"], "beginner", ["wrist"], "bodyweight", "Hands under your chest, elbows brush your ribs."],
  ["bench_dip", "Bench Dip", "arms", "accessory", [["bench"]], ["triceps"], "beginner", ["shoulder", "wrist"], "bodyweight", "Hips close to the bench, stop at a comfortable depth."],
  // calves
  ["bodyweight_calf_raise", "Standing Calf Raise", "calves", "accessory", NONE, ["calves"], "beginner", [], "bodyweight", "Rise high, pause, lower slowly."],
  ["db_calf_raise", "Dumbbell Calf Raise", "calves", "accessory", [["dumbbells"]], ["calves"], "beginner", [], "dumbbell", "Full stretch at the bottom, full squeeze on top."],
  ["machine_calf_raise", "Machine Calf Raise", "calves", "accessory", [["machines"]], ["calves"], "beginner", [], "machine", "Pause at the bottom stretch."],
  // side delt
  ["db_lateral_raise", "Dumbbell Lateral Raise", "side_delt", "accessory", [["dumbbells"]], ["shoulders"], "beginner", ["shoulder"], "dumbbell", "Lead with elbows, stop at shoulder height."],
  ["cable_lateral_raise", "Cable Lateral Raise", "side_delt", "accessory", [["cable"]], ["shoulders"], "beginner", ["shoulder"], "cable", "Smooth lift, no shrugging."],
  ["band_lateral_raise", "Band Lateral Raise", "side_delt", "accessory", [["bands"]], ["shoulders"], "beginner", ["shoulder"], "bodyweight", "Stand on the band, raise to shoulder height."],
  ["prone_y_raise", "Prone Y Raise", "side_delt", "accessory", NONE, ["shoulders", "back"], "beginner", [], "bodyweight", "Lie face down, lift arms in a Y, thumbs up."],
];

export const EXERCISES: readonly Exercise[] = rows.map(
  ([id, name, pattern, role, equipment, muscles, level, avoidFlags, loadType, cue]) => ({
    id,
    name,
    pattern,
    role,
    equipment: toNewIds(equipment),
    muscles,
    level,
    avoidFlags,
    loadType,
    cue,
  }),
);

export function getExercise(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}
