#!/usr/bin/env node
// Imports the demo clips of workout-free-videos (CC0 1.0) into the catalog (WL-19, W47 to W49).
//   node scripts/import-videos.mjs --source <snapshot dir> [--out <dir>] [--map <module>] [--max-video-mb 30] [--max-image-mb 3]
// Run it AFTER scripts/import-exercises.mjs: it reads that script's catalog to match clips by id.
// Writes src/features/workout-plan/data/exercises.videos.generated.ts, public/videos/<slug>.{mp4,webp},
// public/exercises/wfv_<slug>/{0,1}.webp (new exercises only) and the "Videos" section of scripts/import-report.md.
// Pure Node plus the system ffmpeg (a dev tool, never used at runtime). The same snapshot gives byte-identical output.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as M from "./exercise-map.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const source = arg("--source");
if (!source) {
  console.error("Usage: node scripts/import-videos.mjs --source <snapshot dir> [--out <dir>] [--map <module>]");
  process.exit(2);
}
const outRoot = path.resolve(arg("--out", root));
const maxVideoMb = Number(arg("--max-video-mb", "30"));
const maxImageMb = Number(arg("--max-image-mb", "3"));
const V = await import(pathToFileURL(path.resolve(arg("--map", path.join(root, "scripts/video-map.mjs")))).href);

const srcDir = path.resolve(source);
const jsonPath = path.join(srcDir, "data/exercises.json");
const rawJson = fs.readFileSync(jsonPath);
const jsonSha = createHash("sha256").update(rawJson).digest("hex");
const clips = JSON.parse(rawJson.toString("utf8"));
const tag = /v(\d+\.\d+\.\d+)/.exec(path.basename(srcDir))?.[1];
if (!tag) fail("Snapshot folder name must contain its tag, e.g. workout-free-videos-v2.0.0");
const provenance = path.join(srcDir, "PROVENANCE.md");
const commit = fs.existsSync(provenance) ? /commit (\w{7,40})/.exec(fs.readFileSync(provenance, "utf8"))?.[1] : undefined;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const withPeriod = (t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

// ---- the catalog written by import-exercises.mjs ----
const catalogPath = path.join(outRoot, "src/features/workout-plan/data/exercises.generated.ts");
if (!fs.existsSync(catalogPath)) fail(`Missing ${catalogPath}. Run scripts/import-exercises.mjs first.`);
const catalog = fs
  .readFileSync(catalogPath, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("  {"))
  .map((l) => JSON.parse(l.trim().replace(/,$/, "")));
const byId = new Map(catalog.map((e) => [e.id, e]));
const names = new Set(catalog.map((e) => e.name.toLowerCase()));

// ---- validate the table against the snapshot ----
const slugs = clips.map((c) => c.slug).sort(cmp);
const unmapped = slugs.filter((s) => !Object.hasOwn(V.VIDEO_MAP, s));
if (unmapped.length) fail(`Clips with no entry in scripts/video-map.mjs (add a match, "new" or "skip:<reason>"): ${unmapped.join(", ")}`);
const unknown = Object.keys(V.VIDEO_MAP).filter((s) => !slugs.includes(s));
if (unknown.length) fail(`scripts/video-map.mjs lists slugs that the snapshot does not have: ${unknown.join(", ")}`);

const matched = []; // { clip, id }
const added = []; // { clip, id, spec }
const skipped = []; // { clip, reason }
const claimed = new Map();
for (const clip of [...clips].sort((a, b) => cmp(a.slug, b.slug))) {
  const v = V.VIDEO_MAP[clip.slug];
  if (typeof v !== "string" || !v) fail(`Bad value for ${clip.slug}`);
  if (v.startsWith("skip:")) {
    if (v.length < "skip:".length + 5) fail(`${clip.slug}: skip needs a reason`);
    skipped.push({ clip, reason: v.slice("skip:".length) });
    continue;
  }
  let id;
  if (v === "new") {
    if (!V.NEW_SPEC[clip.slug]) fail(`${clip.slug}: "new" needs an entry in NEW_SPEC (pattern and role)`);
    id = `wfv_${clip.slug}`;
    added.push({ clip, id, spec: V.NEW_SPEC[clip.slug] });
  } else {
    if (!byId.has(v)) fail(`${clip.slug} -> ${v}: no such exercise in the catalog`);
    if (v.startsWith("wfv_")) fail(`${clip.slug} -> ${v}: a match must point at an imported exercise`);
    id = v;
    matched.push({ clip, id });
  }
  if (claimed.has(id)) fail(`${id} would get two clips: ${claimed.get(id)} and ${clip.slug}`);
  claimed.set(id, clip.slug);
}

// ---- build the data ----
const isMachineId = (e) => /machine$|^leg_(press|extension|curl)$|hack_squat|hip_ab_ad|pec_deck/.test(e);
function deriveEquipment(clip, spec) {
  let ands = [[]];
  for (const item of clip.equipment) {
    if (item === "bench") ands = ands.flatMap((a) => [[...a, "flat_bench"], [...a, "adjustable_bench"]]);
    else if (item === "machine") {
      if (!spec.machine) fail(`${clip.slug}: the source says "machine"; set NEW_SPEC.machine to the machine id`);
      ands = ands.map((a) => [...a, spec.machine]);
    } else if (Object.hasOwn(V.EQUIPMENT_FROM_SOURCE, item)) {
      const id = V.EQUIPMENT_FROM_SOURCE[item];
      if (id) ands = ands.map((a) => [...a, id]);
    } else fail(`${clip.slug}: source equipment "${item}" is not used in F1`);
  }
  if (spec.rack) ands = ands.map((a) => [...a, "squat_rack"]);
  for (const and of ands) for (const id of and) if (!M.EQUIPMENT_ORDER.includes(id)) fail(`${clip.slug}: unknown equipment id ${id}`);
  return ands.map((and) => [...new Set(and)].sort((a, b) => M.EQUIPMENT_ORDER.indexOf(a) - M.EQUIPMENT_ORDER.indexOf(b)));
}
function loadTypeOf(equipment) {
  const flat = new Set(equipment.flat());
  if (flat.has("smith_machine") || [...flat].some(isMachineId)) return "machine";
  if (flat.has("cable_station") || flat.has("cable_crossover") || flat.has("lat_pulldown") || flat.has("seated_row")) return "cable";
  if (flat.has("barbell") || flat.has("ez_bar") || flat.has("trap_bar")) return "barbell";
  if (flat.has("dumbbells") || flat.has("kettlebells")) return "dumbbell";
  return "bodyweight";
}
const videoOf = (clip) => ({
  path: `/videos/${clip.slug}.mp4`,
  poster: `/videos/${clip.slug}.webp`,
  sha256: clip.video.sha256,
  durationSec: clip.video.durationSec,
  width: clip.video.width,
  height: clip.video.height,
});
const cuesOf = (clip) => {
  if (!Array.isArray(clip.cues) || clip.cues.length !== 3 || clip.cues.some((c) => typeof c !== "string" || c.trim().length < 6)) fail(`${clip.slug}: the source needs exactly 3 cues`);
  return clip.cues.map((c) => c.trim());
};

const overlay = {};
for (const { clip, id } of matched) {
  if (byId.get(id).video) fail(`${id} already has a video`);
  overlay[id] = { video: videoOf(clip), cues: cuesOf(clip) };
}

const newExercises = [];
for (const { clip, id, spec } of added) {
  const name = spec.name ?? clip.name;
  if (names.has(name.toLowerCase())) fail(`New exercise "${name}" (${clip.slug}) clashes with a catalog name. Set NEW_SPEC.name.`);
  names.add(name.toLowerCase());
  const equipment = deriveEquipment(clip, spec);
  const muscles = spec.muscles ?? [...new Set([clip.primaryMuscle, ...clip.secondaryMuscles].map((m) => V.MUSCLE_FROM_SOURCE[m]).filter(Boolean))];
  if (!muscles.length) fail(`${clip.slug}: no muscle group in the F1 list`);
  const level = V.LEVEL_FROM_SOURCE[clip.level];
  if (!level) fail(`${clip.slug}: unknown level ${clip.level}`);
  const cues = cuesOf(clip);
  const cue = withPeriod(cues[0]);
  if (cue.length > 90) fail(`${clip.slug}: first cue is longer than 90 characters`);
  const nameOf = (m) => V.MUSCLE_NAME_FROM_SOURCE[m];
  newExercises.push({
    id,
    name,
    pattern: spec.pattern,
    role: spec.role,
    equipment,
    muscles,
    level,
    avoidFlags: [...new Set(clip.jointStress.map((j) => V.AVOID_FROM_SOURCE[j]).filter(Boolean))].sort(),
    loadType: loadTypeOf(equipment),
    cue,
    images: [`/exercises/${id}/0.webp`, `/exercises/${id}/1.webp`],
    // The video source has key points but no step list; they double as the steps (see HANDOFF, assumption WL-19).
    instructions: cues.map(withPeriod),
    primaryMuscles: [nameOf(clip.primaryMuscle)].filter(Boolean),
    secondaryMuscles: clip.secondaryMuscles.map(nameOf).filter(Boolean),
    video: videoOf(clip),
    cues,
  });
}

// ---- media ----
const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpegCheck.status !== 0) fail("ffmpeg is needed on this machine to cut frames (dev tool only).");
const frame = (input, seconds, output) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(seconds), "-i", input, "-frames:v", "1", "-vf", "scale=640:-1", "-c:v", "libwebp", "-quality", "72", "-update", "1", output], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(output)) fail(`ffmpeg failed on ${input} at ${seconds}s: ${r.stderr}`);
};

const outVideos = path.join(outRoot, "public", "videos");
const outImages = path.join(outRoot, "public", "exercises");
fs.mkdirSync(outVideos, { recursive: true });
fs.mkdirSync(outImages, { recursive: true });
const usedClips = [...matched, ...added].map((x) => x.clip).sort((a, b) => cmp(a.slug, b.slug));
const keepFiles = new Set();
let videoBytes = 0;
let imageBytes = 0;
for (const clip of usedClips) {
  const from = path.join(srcDir, clip.video.path);
  const data = fs.readFileSync(from);
  if (sha256(data) !== clip.video.sha256) fail(`${clip.slug}: sha256 of the mp4 does not match exercises.json`);
  const dest = path.join(outVideos, `${clip.slug}.mp4`);
  if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(data)) fs.writeFileSync(dest, data);
  videoBytes += data.length;
  const poster = path.join(outVideos, `${clip.slug}.webp`);
  frame(from, 0, poster);
  imageBytes += fs.statSync(poster).size;
  keepFiles.add(`${clip.slug}.mp4`).add(`${clip.slug}.webp`);
}
for (const f of fs.readdirSync(outVideos)) if (!keepFiles.has(f)) fs.rmSync(path.join(outVideos, f), { force: true });

const keepDirs = new Set(added.map((x) => x.id));
for (const d of fs.readdirSync(outImages)) if (d.startsWith("wfv_") && !keepDirs.has(d)) fs.rmSync(path.join(outImages, d), { recursive: true, force: true });
for (const { clip, id } of added) {
  fs.mkdirSync(path.join(outImages, id), { recursive: true });
  for (const [i, at] of V.FRAME_AT.entries()) {
    const dest = path.join(outImages, id, `${i}.webp`);
    frame(path.join(srcDir, clip.video.path), (clip.video.durationSec * at).toFixed(3), dest);
    imageBytes += fs.statSync(dest).size;
  }
}
const mb = (n) => (n / 1048576).toFixed(2);
if (videoBytes > maxVideoMb * 1048576) fail(`Videos use ${mb(videoBytes)} MB, above the ${maxVideoMb} MB budget. Skip clips in scripts/video-map.mjs.`);
if (imageBytes > maxImageMb * 1048576) fail(`New images and posters use ${mb(imageBytes)} MB, above the ${maxImageMb} MB budget.`);

// ---- generated data ----
const header = `// GENERATED by scripts/import-videos.mjs. Do not edit by hand.
// Source: workout-free-videos (https://github.com/namnq/workout-free-videos), tag v${tag}${commit ? ` (commit ${commit})` : ""}.
// License: CC0 1.0 (public domain). Clips: public/videos/<slug>.mp4, copied from the snapshot; posters are their first frame.
// data/exercises.json sha256: ${jsonSha}
// Matched to existing exercises: ${matched.length}. Added as new exercises: ${added.length}. Skipped: ${skipped.length}. Table: scripts/video-map.mjs. Report: scripts/import-report.md.
`;
const overlayIds = Object.keys(overlay).sort(cmp);
const body = `import type { Exercise, ExerciseVideo } from "../domain";

/** Video and key points to attach to exercises of the free-exercise-db import, by exercise id. */
export const VIDEO_OVERLAY: Readonly<Record<string, { video: ExerciseVideo; cues: string[] }>> = {
${overlayIds.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(overlay[id])},`).join("\n")}
};

/** Strength clips the catalog did not have. Ids are wfv_<slug>. */
export const VIDEO_EXERCISES: readonly Exercise[] = [
${newExercises.map((e) => `  ${JSON.stringify(e)},`).join("\n")}
];
`;
const genPath = path.join(outRoot, "src/features/workout-plan/data/exercises.videos.generated.ts");
fs.writeFileSync(genPath, header + "\n" + body);

// ---- report ("Videos" section, last in the file) ----
const L = [];
L.push("## Videos", "");
L.push(`Source: workout-free-videos tag v${tag}${commit ? ` (commit ${commit})` : ""} (CC0 1.0). data/exercises.json sha256 \`${jsonSha}\`.`, "");
L.push(`- Clips in the source: ${clips.length}`, `- Matched to an existing exercise: ${matched.length}`, `- Added as new exercises: ${added.length}`, `- Skipped: ${skipped.length}`);
L.push(`- Videos copied: ${usedClips.length} files, ${mb(videoBytes)} MB. Posters and new frames: ${mb(imageBytes)} MB.`, "");
L.push("### Matched (slug -> exercise id)", "", "| Slug | Exercise id | Name |", "|---|---|---|");
for (const { clip, id } of matched) L.push(`| ${clip.slug} | ${id} | ${byId.get(id).name} |`);
L.push("", "### Added (new exercises)", "", "| Slug | Exercise id | Name | Pattern | Role | Equipment |", "|---|---|---|---|---|---|");
for (const e of newExercises) L.push(`| ${e.id.slice(4)} | ${e.id} | ${e.name} | ${e.pattern} | ${e.role} | ${e.equipment.map((a) => (a.length ? a.join(" + ") : "none")).join(" or ")} |`);
L.push("", "### Skipped", "", "| Slug | Reason |", "|---|---|");
for (const { clip, reason } of skipped) L.push(`| ${clip.slug} | ${reason} |`);
const reportPath = path.join(outRoot, "scripts/import-report.md");
const previous = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
const at = previous.search(/(^|\n)## Videos\n/);
const base = (at >= 0 ? previous.slice(0, at) : previous).replace(/\n+$/, "");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, (base ? base + "\n\n" : "") + L.join("\n") + "\n");
console.log(`matched ${matched.length}, new ${added.length}, skipped ${skipped.length}, videos ${mb(videoBytes)} MB, images ${mb(imageBytes)} MB`);
