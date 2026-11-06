// Mapping table for scripts/import-exercises.mjs (WL-11).
// Source: free-exercise-db (Unlicense). The source `equipment` field is too coarse, so the item ids of
// PRD section 6.1 are derived from keywords in the exercise name plus the explicit rules below.
// First matching rule wins. An exercise that no rule maps with confidence is excluded, never guessed (W30).

/** Source categories that can become workouts. Plyometrics are allowed only through ID_ALLOW_EXTRA. */
export const CATEGORY_ALLOW = ["strength", "powerlifting"];

/** Excluded by name, before any mapping. [regex on lowercase name, reason]. */
export const EXCLUDE_RULES = [
  [/\bchains?\b|with bands?\b|reverse band|\bspeed\b|plate movers|\bpins?\b|\bboard\b/, "accommodating resistance (chains, bands, pins, boards)"],
  [/clean|snatch|jerk|\bpower\b|bradford|anti-gravity|car drivers|landmine|jammer|windmill|turkish|get-up|bent press|iron cross|figure 8|pirate|sledgehammer|battling|rope climb|muscle up|sprint|drill|\bhops?\b|skip|\bbound|\bjump|leap|butt kick|crawl/, "olympic, skill, conditioning or ballistic movement"],
  [/neck exercise|neck resistance|head harness|wrist|finger|forearm|pronation|supination|plate pinch|hand squeeze|rotation|rotations|external|internal|\bpass\b|chest push|throw/, "neck, wrist, rehab or throwing work"],
  [/shrug/, "traps only, no movement pattern in F1"],
  [/preacher/, "needs a preacher bench, not in the equipment list"],
  [/guillotine|neck press|jefferson|kneeling squat|sissy|gorilla|janda|zottman|spell caster|around the worlds|cuban|power partials|vertical swing|dumbbell raise$|body-up|body tricep|otis|london|balance board|heavy bag|sled|prone manual|isometric|wipers|bosu/, "unusual or unsafe to prescribe automatically"],
  [/behind the back|behind-the-back/, "unusual grip"],
];

/**
 * Pattern rules on the lowercase name. [regex, pattern, options]. Order matters.
 * options.accessory forces role "accessory".
 */
export const PATTERN_RULES = [
  [/crunch|sit-up|sit up|plank|dead bug|leg raise|leg pull-in|knee\/hip raise|russian twist|(barbell|ball|plate) twist|full twist|side bend|side bridge|pallof|wood chop|ab roller|ab rollout|rollout|fallout|jackknife|flutter|hanging pike|mountain climber|cocoons|bottoms up|butt-ups|elbow to knee|heel touchers|air bike|slam|cable lift|reverse crunch|tuck crunch|spider crawl|weighted crunches|bent-knee hip raise|ball side bend/, "core", { accessory: true }],
  [/calf|calves/, "calves", { accessory: true }],
  [/thigh (abductor|adductor)/, "single_leg", { accessory: true }], // hip stability work; there is no glute pattern in F1
  [/single[- ]leg|one[- ]leg|split squat|lunge|step[- ]?ups?|pistol|elevated back lunge|side split/, "single_leg"],
  [/leg extension/, "squat", { accessory: true }],
  [/leg curl|hamstring curl/, "hinge", { accessory: true }],
  [/rear (delt|lateral)|reverse fl[yi]e|face pull|pull apart|back flyes/, "horizontal_pull", { accessory: true }],
  [/lateral raise|side lateral|side laterals|deltoid raise|front (two-)?(dumbbell |cable |barbell |plate )?raise|scaption|upright .*row|standing low-pulley deltoid|front cable raise|front plate raise/, "side_delt", { accessory: true }],
  [/curl/, "arms", { accessory: true }],
  [/tricep|skullcrusher|skull crusher|pushdown|jm press|tate press|dumbbell kickback|close-grip ez-bar press|lying triceps press|triceps press/, "arms", { accessory: true }],
  [/dips?\b|bench dip/, "horizontal_push"],
  [/pull-?ups?|\bchin|pulldown|pullover|pullups/, "vertical_pull"],
  [/\brows?\b|t-bar|iso row|high row|shotgun|mid row/, "horizontal_pull"],
  [/bench press|floor press|chest press|push-?ups?|pushups|flye|flyes|fly\b|crossover|butterfly|svend/, "horizontal_push"],
  [/overhead(?!.*squat)|shoulder press|military|arnold|push press|handstand|seated .*press|standing .*press|(kettlebell|dumbbell|barbell|cable) .*press|alternating .*press/, "vertical_push"],
  [/deadlift|romanian|good morning|hip thrust|glute bridge|bridge|hyperextension|back extension|pull[- ]through|hip raise|glute[- ]ham|rack pull|swing|glute kickback|kickback|reverse hyperextension/, "hinge"],
  [/squat|leg press|hack squat|goblet|thruster/, "squat"],
];

/** Pattern decided by id when the name rules cannot (id -> pattern). */
export const ID_PATTERN = {
  "Handstand_Push-Ups": "vertical_push",
};

/** Ids from other source categories that are allowed. */
export const ID_ALLOW_EXTRA = [];

/** Explicit exclusions by id with a reason. */
export const ID_EXCLUDE = {
  Hyperextensions_Back_Extensions: "needs a hyperextension bench, not in the equipment list",
  Natural_Glute_Ham_Raise: "needs an anchored pad, not in the equipment list",
  Weighted_Squat: "load unspecified in the source",
  Bodyweight_Flyes: "source data does not match the name",
};

const bench = {
  flatOrAdj: (items = []) => [[...items, "flat_bench"], [...items, "adjustable_bench"]],
  adj: (items = []) => [[...items, "adjustable_bench"]],
};

/**
 * Equipment rules. [source equipment list or null for any, regex on lowercase name, alternatives].
 * Alternatives are an OR of ANDs of PRD 6.1 ids. First match wins.
 */
export const EQUIPMENT_RULES = [
  // machine
  ["machine", /decline smith|smith machine .*(decline|incline|bench)/, (n) => (/incline/.test(n) ? bench.adj(["smith_machine"]) : bench.flatOrAdj(["smith_machine"]))],
  ["machine", /smith/, () => [["smith_machine"]]],
  ["machine", /leg press/, () => [["leg_press"]]],
  ["machine", /hack squat/, () => [["hack_squat"]]],
  ["machine", /leg extension/, () => [["leg_extension"]]],
  ["machine", /leg curl/, () => [["leg_curl"]]],
  ["machine", /abductor|adductor/, () => [["hip_ab_ad"]]],
  ["machine", /calf (press|raise)|calf raises|calf-machine/, () => [["calf_machine"]]],
  ["machine", /chest press|machine bench press/, () => [["chest_press_machine"]]],
  ["machine", /shoulder .*press|military/, () => [["shoulder_press_machine"]]],
  ["machine", /row/, () => [["row_machine"]]],
  ["machine", /butterfly|reverse machine fl/, () => [["pec_deck"]]],
  ["machine", /bicep curl|triceps extension|dip machine/, () => [["arm_machine"]]],
  // other
  ["other", /band assisted pull-up/, () => [["pull_up_bar", "bands"], ["assisted_pull_up"]]],
  ["other", /ab roller/, () => [["ab_wheel"]]],
  ["other", /suspended|straps/, () => [["suspension"]]],
  ["other", /trap bar/, () => [["trap_bar"]]],
  ["other", /plate/, () => [["plates"]]],
  ["other", /parallel bar|dips|ring dips/, () => [["dip_station"]]],
  ["other", /pull-?ups?|\bchin|pulldowns|pullups/, () => [["pull_up_bar"]]],
  ["other", /bodyweight mid row/, () => [[]]],
  // cable
  [null, /pulldown/, () => [["lat_pulldown"], ["cable_station"]]],
  ["cable", /seated cable rows|seated one-arm cable pulley rows/, () => [["seated_row"], ["cable_station"]]],
  ["cable", /crossover/, () => [["cable_crossover"]]],
  ["cable", /flat bench|lying|incline|decline|preacher/, (n) => (/incline/.test(n) ? bench.adj(["cable_station"]) : bench.flatOrAdj(["cable_station"]))],
  ["cable", /./, () => [["cable_station"]]],
  // barbell
  ["barbell", /squat/, (n) => (/hack squat/.test(n) ? [["barbell"]] : [["barbell", "squat_rack"]])],
  ["barbell", /rack pull/, () => [["barbell", "squat_rack"]]],
  ["barbell", /hip thrust/, () => bench.flatOrAdj(["barbell"])],
  ["barbell", /incline/, () => bench.adj(["barbell"])],
  ["barbell", /bench press|bench to skull|bench pull|bench mid|decline|lying|rollout from bench|pullover/, () => bench.flatOrAdj(["barbell"])],
  ["barbell", /seated/, () => bench.adj(["barbell"])],
  ["barbell", /\bez[- ]bar/, () => [["ez_bar"]]],
  // ez bar
  ["e-z curl bar", /lying|skullcrusher|spider/, () => bench.flatOrAdj(["ez_bar"])],
  ["e-z curl bar", /./, () => [["ez_bar"]]],
  // dumbbell
  ["dumbbell", /step ups/, () => [["dumbbells", "plyo_box"], ["dumbbells", "flat_bench"], ["dumbbells", "adjustable_bench"]]],
  ["dumbbell", /incline|prone/, () => bench.adj(["dumbbells"])],
  ["dumbbell", /bench|decline|lying|seated|pullover|flyes|flye|one-arm dumbbell row|kickback|concentration|bent over dumbbell rear delt raise with head on bench/, () => bench.flatOrAdj(["dumbbells"])],
  // body only / none
  [["body only", null], /pull-?ups?|pullups|chin-up|hanging|knee\/hip/, () => [["pull_up_bar"]]],
  [["body only", null], /dips - |dips$/, () => [["dip_station"]]],
  [["body only", null], /step-up/, () => [["plyo_box"], ["flat_bench"], ["adjustable_bench"]]],
  [["body only", null], /bench|decline|incline|feet elevated/, () => bench.flatOrAdj()],
  [["body only", null], /exercise ball/, () => [["stability_ball"]]],
  [["body only", null], /off of a dumbbell/, () => [["dumbbells"]]],
  // other sources
  ["exercise ball", /./, () => [["stability_ball"]]],
  ["medicine ball", /./, () => [["medicine_ball"]]],
];

/** When no rule above matches: source equipment -> alternatives. A missing key means exclude. */
export const DEFAULT_EQUIPMENT = {
  barbell: [["barbell"]],
  dumbbell: [["dumbbells"]],
  kettlebells: [["kettlebells"]],
  bands: [["bands"]],
  "body only": [[]],
  null: [[]],
};

/** Id overrides for single exercises: { equipment?, role?, pattern?, cue? }. */
export const ID_OVERRIDES = {};

/** Avoid flags by name keywords (W06). First lists that match all add their flags. */
export const AVOID_RULES = [
  [/jump|lunge|split squat|step[- ]?ups?|pistol|leg extension|hack squat|sissy|box squat|full squat/, ["knee"]],
  [/behind the neck|behind neck|upright row|overhead|military|shoulder press|arnold|handstand|bench dips?|dips|\bdip\b|bench press|chest press|flye|fly\b|lateral raise|front (two-)?(dumbbell |cable |barbell |plate )?raise/, ["shoulder"]],
  [/deadlift|good morning|rack pull|hyperextension|back extension|swing|bent over|bent-over|\bsquat\b.*barbell|barbell.*\bsquat\b|zercher|hip thrust|rows?\b.*barbell|barbell.*\brow/, ["lower_back"]],
  [/push-?ups?|pushups|handstand|front (barbell )?squat|plank|ab roll|rollout|skullcrusher|skull crusher|crawl|curl.*wrist|dips?/, ["wrist"]],
];

export const MUSCLE_MAP = {
  abdominals: "core",
  hamstrings: "hamstrings",
  adductors: "glutes",
  abductors: "glutes",
  quadriceps: "quads",
  biceps: "biceps",
  shoulders: "shoulders",
  chest: "chest",
  "middle back": "back",
  "lower back": "back",
  lats: "back",
  traps: "back",
  calves: "calves",
  glutes: "glutes",
  triceps: "triceps",
};

export const LEVEL_MAP = { beginner: "beginner", intermediate: "intermediate", expert: "advanced" };

/** Hand-written cues (<= 90 chars) replacing the first instruction sentence. */
export const CUE_OVERRIDES = {};

export const CUE_MAX = 90;

/** A press that the name rules put under vertical push but whose prime mover is chest or triceps is a horizontal press. */
export function refinePattern(pattern, ex) {
  if (pattern === "vertical_push" && ["chest", "triceps"].includes(ex.primaryMuscles[0])) return "horizontal_push";
  return pattern;
}

/**
 * The source has many near-duplicate variants (grip, stance, angle). To keep the catalog and the image
 * folder small, each bucket (pattern + equipment alternatives) keeps at most this many exercises.
 * Order inside a bucket: easier level first, then shorter name, then id. Every bucket keeps at least one.
 */
export const BUCKET_MAX = 4;

/**
 * Standard names (W36). Keyed by source id, so a rename never changes which exercise it is. The old name
 * is in the trailing comment. Patterns, equipment and avoid flags are still derived from the SOURCE name.
 * Spelling rules: "Push-up", "Pull-up", "Step-up" (hyphen, lower-case "up"), singular movement names,
 * "Fly" not "Flye(s)", "Lever" not "Leverage", "Stability Ball" not "Exercise Ball".
 */
export const NAME_OVERRIDES = {
  "Pushups": "Push-up", // Pushups
  "Pullups": "Pull-up", // Pullups
  "Push-Up_Wide": "Wide Push-up", // Push-Up Wide
  "Push-Ups_-_Close_Triceps_Position": "Close-Grip Push-up", // Push-Ups - Close Triceps Position
  "Push-Ups_With_Feet_On_An_Exercise_Ball": "Stability Ball Push-up", // Push-Ups With Feet On An Exercise Ball
  "Pushups_Close_and_Wide_Hand_Positions": "Close-and-Wide Push-up", // Pushups (Close and Wide Hand Positions)
  "Incline_Push-Up": "Incline Push-up", // Incline Push-Up
  "Incline_Push-Up_Medium": "Incline Push-up (Medium Grip)", // Incline Push-Up Medium
  "Incline_Push-Up_Wide": "Incline Push-up (Wide Grip)", // Incline Push-Up Wide
  "Clock_Push-Up": "Clock Push-up", // Clock Push-Up
  "Decline_Push-Up": "Decline Push-up", // Decline Push-Up
  "Suspended_Push-Up": "Suspended Push-up", // Suspended Push-Up
  "Handstand_Push-Ups": "Handstand Push-up", // Handstand Push-Ups
  "Close-Grip_Push-Up_off_of_a_Dumbbell": "Close-Grip Push-up on Dumbbell", // Close-Grip Push-Up off of a Dumbbell
  "Band_Assisted_Pull-Up": "Band-Assisted Pull-up", // Band Assisted Pull-Up
  "Scapular_Pull-Up": "Scapular Pull-up", // Scapular Pull-Up
  "V-Bar_Pullup": "V-Bar Pull-up", // V-Bar Pullup
  "Chin-Up": "Chin-up", // Chin-Up
  "Leg_Extensions": "Leg Extension", // Leg Extensions
  "Lying_Leg_Curls": "Lying Leg Curl", // Lying Leg Curls
  "Hammer_Curls": "Hammer Curl", // Hammer Curls
  "Incline_Hammer_Curls": "Incline Hammer Curl", // Incline Hammer Curls
  "Concentration_Curls": "Concentration Curl", // Concentration Curls
  "Flexor_Incline_Dumbbell_Curls": "Flexor Incline Dumbbell Curl", // Flexor Incline Dumbbell Curls
  "Barbell_Curls_Lying_Against_An_Incline": "Barbell Curl Lying on Incline", // Barbell Curls Lying Against An Incline
  "Dumbbell_Lunges": "Dumbbell Lunge", // Dumbbell Lunges
  "Dumbbell_Bicep_Curl": "Dumbbell Biceps Curl", // Dumbbell Bicep Curl
  "Machine_Bicep_Curl": "Machine Biceps Curl", // Machine Bicep Curl
  "Tricep_Dumbbell_Kickback": "Dumbbell Triceps Kickback", // Tricep Dumbbell Kickback
  "Cable_Deadlifts": "Cable Deadlift", // Cable Deadlifts
  "Rack_Pulls": "Rack Pull", // Rack Pulls
  "Underhand_Cable_Pulldowns": "Underhand Cable Pulldown", // Underhand Cable Pulldowns
  "Seated_Cable_Rows": "Seated Cable Row", // Seated Cable Rows
  "Standing_Calf_Raises": "Standing Calf Raise", // Standing Calf Raises
  "Narrow_Stance_Hack_Squats": "Narrow-Stance Hack Squat", // Narrow Stance Hack Squats
  "Narrow_Stance_Squats": "Narrow-Stance Squat", // Narrow Stance Squats
  "Narrow_Stance_Leg_Press": "Narrow-Stance Leg Press", // Narrow Stance Leg Press
  "Seated_Good_Mornings": "Seated Good Morning", // Seated Good Mornings
  "Smith_Machine_Reverse_Calf_Raises": "Smith Machine Reverse Calf Raise", // Smith Machine Reverse Calf Raises
  "Barbell_Step_Ups": "Barbell Step-up", // Barbell Step Ups
  "Dumbbell_Step_Ups": "Dumbbell Step-up", // Dumbbell Step Ups
  "Weighted_Crunches": "Weighted Crunch", // Weighted Crunches
  "Reverse_Flyes": "Reverse Fly", // Reverse Flyes
  "Dumbbell_Flyes": "Dumbbell Fly", // Dumbbell Flyes
  "Incline_Dumbbell_Flyes": "Incline Dumbbell Fly", // Incline Dumbbell Flyes
  "Decline_Dumbbell_Flyes": "Decline Dumbbell Fly", // Decline Dumbbell Flyes
  "Incline_Dumbbell_Flyes_-_With_A_Twist": "Incline Dumbbell Fly with Twist", // Incline Dumbbell Flyes - With A Twist
  "Reverse_Machine_Flyes": "Reverse Machine Fly", // Reverse Machine Flyes
  "Flat_Bench_Cable_Flyes": "Flat Bench Cable Fly", // Flat Bench Cable Flyes
  "Incline_Cable_Flye": "Incline Cable Fly", // Incline Cable Flye
  "Butt_Lift_Bridge": "Glute Bridge", // Butt Lift (Bridge)
  "Single_Leg_Glute_Bridge": "Single-Leg Glute Bridge", // Single Leg Glute Bridge
  "Physioball_Hip_Bridge": "Stability Ball Hip Bridge", // Physioball Hip Bridge
  "Ball_Leg_Curl": "Stability Ball Leg Curl", // Ball Leg Curl
  "Exercise_Ball_Crunch": "Stability Ball Crunch", // Exercise Ball Crunch
  "Crunch_-_Legs_On_Exercise_Ball": "Stability Ball Leg Crunch", // Crunch - Legs On Exercise Ball
  "Leverage_Chest_Press": "Lever Chest Press", // Leverage Chest Press
  "Leverage_Decline_Chest_Press": "Lever Decline Chest Press", // Leverage Decline Chest Press
  "Leverage_High_Row": "Lever High Row", // Leverage High Row
  "Leverage_Incline_Chest_Press": "Lever Incline Chest Press", // Leverage Incline Chest Press
  "Leverage_Iso_Row": "Lever Iso Row", // Leverage Iso Row
  "Leverage_Shoulder_Press": "Lever Shoulder Press", // Leverage Shoulder Press
  "Hammer_Grip_Incline_DB_Bench_Press": "Hammer-Grip Incline Dumbbell Press", // Hammer Grip Incline DB Bench Press
  "Bench_Press_-_Powerlifting": "Powerlifting Bench Press", // Bench Press - Powerlifting
  "Barbell_Bench_Press_-_Medium_Grip": "Barbell Bench Press", // Barbell Bench Press - Medium Grip
  "Barbell_Incline_Bench_Press_-_Medium_Grip": "Barbell Incline Bench Press", // Barbell Incline Bench Press - Medium Grip
  "Cocoons": "Cocoon Crunch", // Cocoons
  "One_Arm_Lat_Pulldown": "One-Arm Lat Pulldown", // One Arm Lat Pulldown
  "One_Arm_Floor_Press": "One-Arm Floor Press", // One Arm Floor Press
  "One_Leg_Barbell_Squat": "One-Leg Barbell Squat", // One Leg Barbell Squat
  "Stiff_Leg_Barbell_Good_Morning": "Stiff-Leg Barbell Good Morning", // Stiff Leg Barbell Good Morning
  "Straight_Bar_Bench_Mid_Rows": "Straight-Bar Bench Mid Row", // Straight Bar Bench Mid Rows
  "Smith_Single-Leg_Split_Squat": "Smith Machine Single-Leg Split Squat", // Smith Single-Leg Split Squat
  "Dips_-_Chest_Version": "Chest Dip", // Dips - Chest Version
  "Dips_-_Triceps_Version": "Triceps Dip", // Dips - Triceps Version
  "Ring_Dips": "Ring Dip", // Ring Dips
  "Bench_Dips": "Bench Dip", // Bench Dips
  "Hyperextensions_With_No_Hyperextension_Bench": "Hyperextension (No Bench)", // Hyperextensions With No Hyperextension Bench
  "Calf_Press_On_The_Leg_Press_Machine": "Calf Press on Leg Press Machine", // Calf Press On The Leg Press Machine
  "Seated_One-arm_Cable_Pulley_Rows": "Seated One-Arm Cable Pulley Row", // Seated One-arm Cable Pulley Rows
  "Machine_Shoulder_Military_Press": "Machine Shoulder Press", // Machine Shoulder (Military) Press
  "Thigh_Abductor": "Hip Abduction Machine", // Thigh Abductor
  "Thigh_Adductor": "Hip Adduction Machine", // Thigh Adductor
  "Reverse_Plate_Curls": "Reverse Plate Curl", // Reverse Plate Curls
  "Close-Grip_EZ_Bar_Curl": "Close-Grip EZ-Bar Curl", // Close-Grip EZ Bar Curl
  "Decline_EZ_Bar_Triceps_Extension": "Decline EZ-Bar Triceps Extension", // Decline EZ Bar Triceps Extension
  "EZ-Bar_Skullcrusher": "EZ-Bar Skull Crusher", // EZ-Bar Skullcrusher
  "Front_Squats_With_Two_Kettlebells": "Kettlebell Front Squat (Two Kettlebells)", // Front Squats With Two Kettlebells
  "One-Arm_Overhead_Kettlebell_Squats": "One-Arm Overhead Kettlebell Squat", // One-Arm Overhead Kettlebell Squats
  "Butterfly": "Pec Deck Fly", // Butterfly
  "Pull_Through": "Cable Pull-Through", // Pull Through
  "Machine_Bench_Press": "Machine Chest Press", // Machine Bench Press
  "Weighted_Ball_Hyperextension": "Stability Ball Hyperextension", // Weighted Ball Hyperextension
  "Floor_Press": "Barbell Floor Press", // Floor Press
};

/** Words kept lower-case inside a name when the source capitalises them ("Squat To A Bench"). */
const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "off", "on", "over", "the", "to", "with"]);

/** The name shown in the app: an explicit override wins, otherwise only small words are lower-cased. */
export function standardName(id, name) {
  if (Object.hasOwn(NAME_OVERRIDES, id)) return NAME_OVERRIDES[id];
  return name
    .split(" ")
    .map((w, i, arr) => (i > 0 && arr[i - 1] !== "-" && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(" ");
}
