#!/usr/bin/env node
// Imports free-exercise-db (Unlicense) into the app catalog (WL-11, W30).
//   node scripts/import-exercises.mjs --source <snapshot dir> [--max-mb 15] [--out <dir>]
// Writes src/features/workout-plan/data/exercises.generated.ts, public/exercises/<id>/{0,1}.webp and scripts/import-report.md.
// Pure Node, no dependencies. The same snapshot always gives byte-identical output.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./exercise-map.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const source = arg("--source");
const maxMb = Number(arg("--max-mb", "15"));
/** Output root. Defaults to the repo; tests point it at a temp folder. */
const outRoot = path.resolve(arg("--out", root));
if (!source) {
  console.error("Usage: node scripts/import-exercises.mjs --source <snapshot dir> [--max-mb 15]");
  process.exit(2);
}
const srcDir = path.resolve(source);
const jsonPath = path.join(srcDir, "exercises.json");
const raw = fs.readFileSync(jsonPath);
const sha256 = createHash("sha256").update(raw).digest("hex");
const snapshotDate = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(srcDir))?.[1];
if (!snapshotDate) throw new Error("Snapshot folder name must contain its date, e.g. free-exercise-db-2026-11-06");
const source_ = JSON.parse(raw.toString("utf8"));

const EQUIPMENT_ORDER = [
  "barbell", "ez_bar", "trap_bar", "dumbbells", "kettlebells", "plates", "squat_rack", "smith_machine", "flat_bench", "adjustable_bench", "pull_up_bar", "dip_station", "cable_station", "cable_crossover", "lat_pulldown", "seated_row", "chest_press_machine", "pec_deck", "shoulder_press_machine", "row_machine", "assisted_pull_up", "arm_machine", "leg_press", "hack_squat", "leg_extension", "leg_curl", "hip_ab_ad", "calf_machine", "bands", "suspension", "medicine_ball", "stability_ball", "ab_wheel", "plyo_box",
];

const lc = (s) => s.toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const imgPath = (id, i) => path.join(srcDir, "images", id, `${i}.webp`);

function matchSource(spec, equipment) {
  if (spec === null) return true;
  const list = Array.isArray(spec) ? spec : [spec];
  return list.includes(equipment);
}

function deriveEquipment(ex, name) {
  if (M.ID_OVERRIDES[ex.id]?.equipment) return M.ID_OVERRIDES[ex.id].equipment;
  for (const [src, re, fn] of M.EQUIPMENT_RULES) {
    if (matchSource(src, ex.equipment) && re.test(name)) return fn(name);
  }
  return M.DEFAULT_EQUIPMENT[String(ex.equipment)] ?? null;
}

function loadTypeOf(ex, equipment) {
  const flat = new Set(equipment.flat());
  if (ex.equipment === "machine" || flat.has("smith_machine") || [...flat].some((e) => /machine$|^leg_(press|extension|curl)$|hack_squat|hip_ab_ad|pec_deck/.test(e))) return "machine";
  if (ex.equipment === "cable" || flat.has("cable_station") || flat.has("cable_crossover") || flat.has("lat_pulldown") || flat.has("seated_row")) return "cable";
  if (flat.has("barbell") || flat.has("ez_bar") || flat.has("trap_bar")) return "barbell";
  if (flat.has("dumbbells") || flat.has("kettlebells")) return "dumbbell";
  return "bodyweight";
}

function cueOf(ex) {
  if (M.CUE_OVERRIDES[ex.id]) return M.CUE_OVERRIDES[ex.id];
  const sentences = ex.instructions.slice(0, 3).flatMap((t) => t.match(/[^.!?]+[.!?]?/g) ?? []).map((t) => t.trim()).filter(Boolean);
  const fit = sentences.find((t) => t.length >= 12 && t.length <= M.CUE_MAX);
  if (fit) return /[.!?]$/.test(fit) ? fit : `${fit}.`;
  const first = sentences[0] ?? ex.name;
  let cut = first.slice(0, M.CUE_MAX - 1);
  cut = cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).replace(/[,;:\s]+$/, "");
  return `${cut}.`;
}

const included = [];
const excluded = [];
const exclude = (ex, reason) => excluded.push({ id: ex.id, name: ex.name, reason });

for (const ex of source_) {
  const name = lc(ex.name);
  const allowed = M.CATEGORY_ALLOW.includes(ex.category) || M.ID_ALLOW_EXTRA.includes(ex.id);
  if (!allowed) {
    exclude(ex, `category ${ex.category}`);
    continue;
  }
  if (!fs.existsSync(imgPath(ex.id, 0)) || !fs.existsSync(imgPath(ex.id, 1))) {
    exclude(ex, "no two images in snapshot");
    continue;
  }
  if (!ex.instructions?.length) {
    exclude(ex, "no instructions in the source");
    continue;
  }
  if (M.ID_EXCLUDE[ex.id]) {
    exclude(ex, M.ID_EXCLUDE[ex.id]);
    continue;
  }
  const hit = M.EXCLUDE_RULES.find(([re]) => re.test(name));
  if (hit) {
    exclude(ex, hit[1]);
    continue;
  }
  let pattern = M.ID_PATTERN[ex.id] ?? M.ID_OVERRIDES[ex.id]?.pattern ?? M.PATTERN_RULES.find(([re]) => re.test(name))?.[1];
  const patternRule = M.PATTERN_RULES.find(([re]) => re.test(name));
  if (!pattern) {
    exclude(ex, "pattern not mapped with confidence");
    continue;
  }
  pattern = M.refinePattern(pattern, ex);
  const equipment = deriveEquipment(ex, name);
  if (!equipment) {
    exclude(ex, `equipment "${ex.equipment}" not mapped with confidence`);
    continue;
  }
  const muscles = [...new Set([...ex.primaryMuscles, ...ex.secondaryMuscles].map((m) => M.MUSCLE_MAP[m]).filter(Boolean))];
  if (!muscles.length) {
    exclude(ex, "no muscle group in the F1 list");
    continue;
  }
  const loadType = loadTypeOf(ex, equipment);
  let role;
  if (M.ID_OVERRIDES[ex.id]?.role) role = M.ID_OVERRIDES[ex.id].role;
  else if (patternRule?.[2]?.accessory || ["core", "arms", "calves", "side_delt"].includes(pattern) || ex.mechanic === "isolation") role = "accessory";
  else if (loadType === "barbell" && ["squat", "hinge", "horizontal_push", "horizontal_pull", "vertical_push", "vertical_pull"].includes(pattern)) role = "main";
  else role = "both";
  const avoidFlags = [...new Set(M.AVOID_RULES.filter(([re]) => re.test(name)).flatMap(([, f]) => f))].sort();
  included.push({
    id: ex.id,
    name: ex.name,
    pattern,
    role,
    equipment: equipment.map((and) => [...and].sort((a, b) => EQUIPMENT_ORDER.indexOf(a) - EQUIPMENT_ORDER.indexOf(b))),
    muscles,
    level: M.LEVEL_MAP[ex.level] ?? "intermediate",
    avoidFlags,
    loadType,
    cue: M.ID_OVERRIDES[ex.id]?.cue ?? cueOf(ex),
    images: [`/exercises/${ex.id}/0.webp`, `/exercises/${ex.id}/1.webp`],
    instructions: ex.instructions,
    primaryMuscles: ex.primaryMuscles,
    secondaryMuscles: ex.secondaryMuscles,
  });
}
// keep a bounded number of variants per bucket
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };
const buckets = new Map();
for (const e of included) {
  const key = `${e.pattern}|${JSON.stringify(e.equipment)}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(e);
}
const dropped = new Set();
for (const list of buckets.values()) {
  list.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.name.length - b.name.length || cmp(a.id, b.id));
  for (const e of list.slice(M.BUCKET_MAX)) {
    dropped.add(e.id);
    excluded.push({ id: e.id, name: e.name, reason: `redundant variant (bucket keeps ${M.BUCKET_MAX})` });
  }
}
for (let i = included.length - 1; i >= 0; i--) if (dropped.has(included[i].id)) included.splice(i, 1);
included.sort((a, b) => cmp(a.id, b.id));

// ---- standard names (W36): after the bucket cut, so renaming never changes which exercises are kept ----
const renamed = [];
for (const e of included) {
  const to = M.standardName(e.id, e.name);
  if (to !== e.name) renamed.push({ id: e.id, from: e.name, to });
  e.name = to;
}
const seenNames = new Map();
for (const e of included) {
  const key = e.name.toLowerCase();
  if (seenNames.has(key)) {
    console.error(`Two exercises would get the same name "${e.name}": ${seenNames.get(key)} and ${e.id}. Fix NAME_OVERRIDES in scripts/exercise-map.mjs.`);
    process.exit(1);
  }
  seenNames.set(key, e.id);
}
excluded.sort((a, b) => cmp(a.id, b.id));

// ---- images ----
const outImages = path.join(outRoot, "public", "exercises");
const keep = new Set(included.map((e) => e.id));
fs.mkdirSync(outImages, { recursive: true });
for (const dir of fs.readdirSync(outImages)) if (!keep.has(dir)) fs.rmSync(path.join(outImages, dir), { recursive: true, force: true });
let imageBytes = 0;
for (const e of included) {
  fs.mkdirSync(path.join(outImages, e.id), { recursive: true });
  for (const i of [0, 1]) {
    const data = fs.readFileSync(imgPath(e.id, i));
    imageBytes += data.length;
    const dest = path.join(outImages, e.id, `${i}.webp`);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(data)) fs.writeFileSync(dest, data);
  }
}
if (imageBytes > maxMb * 1024 * 1024) {
  console.error(`Images use ${(imageBytes / 1048576).toFixed(2)} MB, above the ${maxMb} MB budget. Narrow scripts/exercise-map.mjs.`);
  process.exit(1);
}

// ---- generated catalog ----
const header = `// GENERATED by scripts/import-exercises.mjs. Do not edit by hand.
// Source: free-exercise-db (https://github.com/yuhonas/free-exercise-db), snapshot ${snapshotDate}.
// License: Unlicense (public domain). Images: public/exercises/<id>/{0,1}.webp, copied from the snapshot.
// exercises.json sha256: ${sha256}
// Entries: ${included.length}. Mapping rules: scripts/exercise-map.mjs. Excluded list: scripts/import-report.md.
`;
const body = `import type { Exercise } from "../domain";

export const GENERATED_EXERCISES: readonly Exercise[] = [
${included.map((e) => `  ${JSON.stringify(e)},`).join("\n")}
];
`;
const genPath = path.join(outRoot, "src/features/workout-plan/data/exercises.generated.ts");
fs.mkdirSync(path.dirname(genPath), { recursive: true });
fs.writeFileSync(genPath, header + "\n" + body);

// ---- report ----
const PRESETS = {
  "Full gym": EQUIPMENT_ORDER,
  "Home: dumbbells + bench": ["dumbbells", "adjustable_bench", "pull_up_bar", "bands"],
  "Bodyweight only": [],
};
const MAIN = ["squat", "hinge", "horizontal_push", "horizontal_pull", "vertical_push", "vertical_pull"];
const doable = (e, have) => e.equipment.some((and) => and.every((id) => have.includes(id)));
const lines = [];
lines.push("# Import report", "");
lines.push(`Source: free-exercise-db snapshot ${snapshotDate} (Unlicense). exercises.json sha256 \`${sha256}\`.`, "");
lines.push(`- Source exercises: ${source_.length}`, `- Imported: ${included.length}`, `- Excluded: ${excluded.length}`, `- Images: ${included.length * 2} files, ${(imageBytes / 1048576).toFixed(2)} MB`, "");
lines.push("## Coverage: equipment item x exercises that list it", "", "| Item | Exercises |", "|---|---|");
for (const id of EQUIPMENT_ORDER) lines.push(`| ${id} | ${included.filter((e) => e.equipment.some((and) => and.includes(id))).length} |`);
lines.push("", "## Coverage: preset x main pattern (exercises doable with the preset)", "", `| Preset | ${MAIN.join(" | ")} |`, `|---|${MAIN.map(() => "---").join("|")}|`);
for (const [label, have] of Object.entries(PRESETS)) lines.push(`| ${label} | ${MAIN.map((p) => included.filter((e) => e.pattern === p && doable(e, have)).length).join(" | ")} |`);
lines.push("", "## Imported by pattern", "", "| Pattern | Exercises |", "|---|---|");
for (const p of [...new Set(included.map((e) => e.pattern))].sort()) lines.push(`| ${p} | ${included.filter((e) => e.pattern === p).length} |`);
const reasons = new Map();
for (const e of excluded) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
lines.push("", `## Renamed exercises (W36)`, "", `${renamed.length} of ${included.length} exercises have a standard name. The id never changes.`, "");
for (const r of renamed) lines.push(`- \`${r.id}\`: "${r.from}" -> "${r.to}"`);
lines.push("", "## Excluded by reason", "", "| Reason | Count |", "|---|---|");
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))) lines.push(`| ${r} | ${n} |`);
lines.push("", "## Excluded exercises (strength and powerlifting candidates only)", "");
for (const e of excluded.filter((x) => !x.reason.startsWith("category "))) lines.push(`- \`${e.id}\` ${e.name}: ${e.reason}`);
fs.mkdirSync(path.join(outRoot, "scripts"), { recursive: true });
fs.writeFileSync(path.join(outRoot, "scripts/import-report.md"), lines.join("\n") + "\n");
console.log(`imported ${included.length}, excluded ${excluded.length}, images ${(imageBytes / 1048576).toFixed(2)} MB`);
