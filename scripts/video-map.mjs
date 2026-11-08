// Mapping table for scripts/import-videos.mjs (WL-19, W47, W48).
// Source: workout-free-videos v2.0.0 (CC0 1.0), 57 clips. Hand-written: each clip is matched to a catalog id only when it
// shows the SAME movement with the SAME main implement. When unsure, the clip becomes a new exercise or is skipped; never guessed.
//   slug -> catalog id (match) | "new" (added as wfv_<slug>) | "skip:<reason>"

export const VIDEO_MAP = {
  // ---- matched to an exercise that the free-exercise-db import already has ----
  "dumbbell-bench-press": "Dumbbell_Bench_Press",
  "incline-bench-press": "Barbell_Incline_Bench_Press_-_Medium_Grip",
  "chest-dip": "Dips_-_Chest_Version",
  "military-press": "Standing_Military_Press",
  "dumbbell-lateral-raise": "Side_Lateral_Raise",
  "close-grip-bench-press": "Close-Grip_Barbell_Bench_Press",
  "ez-bar-skullcrusher": "EZ-Bar_Skullcrusher",
  "standing-barbell-curl": "Barbell_Curl",
  "incline-dumbbell-curl": "Incline_Dumbbell_Curl",
  "barbell-upright-row": "Upright_Barbell_Row",
  "seated-cable-row": "Seated_Cable_Rows",
  "machine-t-bar-row": "Lying_T-Bar_Row",
  "bent-over-row": "Bent_Over_Barbell_Row",
  "lat-pull-down": "Wide-Grip_Lat_Pulldown",
  "straight-arm-lat-pull-down": "Straight-Arm_Pulldown",
  "sit-up": "Sit-Up",
  "barbell-hip-thrust": "Barbell_Hip_Thrust",
  "good-mornings": "Good_Morning",
  "barbell-back-squat": "Barbell_Squat",
  "leg-press": "Leg_Press",
  "machine-hack-squat": "Hack_Squat",
  "seated-leg-curl": "Seated_Leg_Curl",
  "exercise-ball-leg-curl": "Ball_Leg_Curl",
  "standing-machine-calf-raise": "Standing_Calf_Raises",
  "seated-calf-raise": "Seated_Calf_Raise",
  "45-degree-leg-press-calf-raise": "Calf_Press_On_The_Leg_Press_Machine",
  "hip-adduction-machine": "Thigh_Adductor",

  // ---- strength clips the catalog does not have: added as new exercises (see NEW_SPEC) ----
  "exercise-ball-dumbbell-bench-press": "new",
  "bent-over-low-pulley-rear-delt-fly": "new", // near Cable_Rear_Delt_Fly (high pulleys) but the setup differs, so not matched
  "reverse-grip-barbell-curl": "new", // EZ bar; the catalog's reverse curl uses a straight barbell
  "wide-grip-pull-up": "new", // a grip variation, not the plain pull-up
  "superman": "new",
  "lying-floor-leg-raise": "new", // on the floor; the catalog's lying leg raise needs a bench
  "weighted-crunch": "new", // plate; the catalog's weighted crunch uses a medicine ball
  "tall-kneeling-cable-lift": "new",
  "tall-kneeling-cable-chop": "new",
  "split-stance-cable-lift": "new",
  "exercise-ball-wall-squat": "new",
  "stiff-leg-deadlift": "new", // barbell; the catalog only has dumbbell and Smith versions
  "nordic-hamstring-curl": "new",
  "cable-hip-abduction": "new",

  // ---- strength clips F1 cannot use ----
  "dumbbell-hammer-preacher-curl": "skip:needs a preacher bench, not in the F1 gear list",
  "seated-barbell-wrist-curl": "skip:wrist and forearm work has no movement pattern in F1",
  "plate-pinch-carry": "skip:grip carry has no movement pattern in F1",
  "barbell-shrug": "skip:traps only, no movement pattern in F1",
  "dumbbell-shrug": "skip:traps only, no movement pattern in F1",
  "weighted-tricep-dips": "skip:needs a dip belt, not in the F1 gear list",
  "hyperextension": "skip:needs a back-extension bench, not in the F1 gear list",

  // ---- mobility and recovery: for the warm-up and cool-down work after F1 ----
  "alternating-lateral-lunge-with-overhead-reach": "skip:F1-warmup-later",
  "deep-squat-prying": "skip:F1-warmup-later",
  "cradle-walk": "skip:F1-warmup-later",
  "fire-hydrant-circles": "skip:F1-warmup-later",
  "kneeling-posterior-hip-capsule-mobilization": "skip:F1-warmup-later",
  "it-band-foam-rolling": "skip:F1-warmup-later",
  "plantar-fascia-lacrosse-ball": "skip:F1-warmup-later",
  "palmar-fascia-lacrosse-ball": "skip:F1-warmup-later",
  "neck-tiger-tail": "skip:F1-warmup-later",
};

/**
 * Hand-written data of each "new" clip. `pattern` and `role` are chosen by hand (GUIDANCE 2c).
 * Optional: `name` (standard name when the source name clashes), `rack` (adds squat_rack), `machine` (needed when the source
 * says "machine"), `muscles` (when the source muscles do not map to the F1 list).
 */
export const NEW_SPEC = {
  "exercise-ball-dumbbell-bench-press": { pattern: "horizontal_push", role: "both" },
  "bent-over-low-pulley-rear-delt-fly": { pattern: "horizontal_pull", role: "accessory", name: "Bent-Over Cable Rear Delt Fly" },
  "reverse-grip-barbell-curl": { pattern: "arms", role: "accessory" },
  "wide-grip-pull-up": { pattern: "vertical_pull", role: "both" },
  "superman": { pattern: "hinge", role: "accessory" },
  "lying-floor-leg-raise": { pattern: "core", role: "accessory" },
  "weighted-crunch": { pattern: "core", role: "accessory" },
  "tall-kneeling-cable-lift": { pattern: "core", role: "accessory" },
  "tall-kneeling-cable-chop": { pattern: "core", role: "accessory" },
  "split-stance-cable-lift": { pattern: "core", role: "accessory" },
  "exercise-ball-wall-squat": { pattern: "squat", role: "both" },
  "stiff-leg-deadlift": { pattern: "hinge", role: "main" },
  "nordic-hamstring-curl": { pattern: "hinge", role: "accessory" },
  "cable-hip-abduction": { pattern: "single_leg", role: "accessory" },
};

/** Source equipment -> F1 equipment id (GUIDANCE 2c). `bench` is an OR (flat or adjustable); `machine` needs NEW_SPEC.machine. */
export const EQUIPMENT_FROM_SOURCE = {
  dumbbell: "dumbbells",
  barbell: "barbell",
  ezBar: "ez_bar",
  cable: "cable_station",
  pullupBar: "pull_up_bar",
  dipBars: "dip_station",
  plate: "plates",
  ball: "stability_ball",
  bodyweight: null, // nothing needed
};

/** Source muscle -> F1 muscle group (domain MUSCLES). Muscles that F1 does not track are left out. */
export const MUSCLE_FROM_SOURCE = {
  chest: "chest",
  shoulders: "shoulders",
  triceps: "triceps",
  biceps: "biceps",
  traps: "back",
  upperBack: "back",
  lats: "back",
  lowerBack: "back",
  abs: "core",
  obliques: "core",
  glutes: "glutes",
  adductors: "glutes",
  abductors: "glutes",
  quads: "quads",
  hamstrings: "hamstrings",
  calves: "calves",
};

/** Source muscle -> the free-exercise-db style name the catalog and the MuscleWiki links use (primaryMuscles). */
export const MUSCLE_NAME_FROM_SOURCE = {
  chest: "chest",
  shoulders: "shoulders",
  triceps: "triceps",
  biceps: "biceps",
  forearm: "forearms",
  traps: "traps",
  upperBack: "middle back",
  lats: "lats",
  lowerBack: "lower back",
  abs: "abdominals",
  obliques: "obliques",
  glutes: "glutes",
  hipFlexors: "hip flexors",
  adductors: "adductors",
  abductors: "abductors",
  quads: "quadriceps",
  hamstrings: "hamstrings",
  calves: "calves",
};

/** Source jointStress -> avoid flag (BODY_AREAS). */
export const AVOID_FROM_SOURCE = { knee: "knee", lowBack: "lower_back", shoulder: "shoulder", wrist: "wrist" };

export const LEVEL_FROM_SOURCE = { beginner: "beginner", intermediate: "intermediate", advanced: "advanced" };

/** Frame positions for the two images of a new exercise (W48): about 25% and 75% of the clip. */
export const FRAME_AT = [0.25, 0.75];
