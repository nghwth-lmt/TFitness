import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "../../../../scripts");
const importVideos = path.join(scripts, "import-videos.mjs");
const importExercises = path.join(scripts, "import-exercises.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wp-videos-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

type Clip = { slug: string; name: string; equipment: string[]; type?: string };
function makeSnapshot(dir: string, clips: Clip[], tamper?: string) {
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "media/video"), { recursive: true });
  const list = clips.map((c, n) => {
    const file = path.join(dir, "media/video", `${c.slug}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=duration=2:size=320x180:rate=10,hue=h=${n * 40}`, "-pix_fmt", "yuv420p", "-c:v", "mpeg4", file]);
    const bytes = fs.readFileSync(file);
    return {
      id: `c${n}`,
      slug: c.slug,
      name: c.name,
      primaryMuscle: "chest",
      secondaryMuscles: ["triceps", "hipFlexors"],
      equipment: c.equipment,
      level: "beginner",
      type: c.type ?? "compound",
      jointStress: ["shoulder", "lowBack"],
      cues: ["Keep the ribs down", "Brace before each rep", "Control the way down"],
      video: { path: `media/video/${c.slug}.mp4`, bytes: bytes.length, sha256: c.slug === tamper ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex"), width: 1280, height: 720, durationSec: 2 },
    };
  });
  fs.writeFileSync(path.join(dir, "data/exercises.json"), JSON.stringify(list));
}

function makeOut(dir: string, ids: string[]) {
  const rel = path.join(dir, "src/features/workout-plan/data");
  fs.mkdirSync(rel, { recursive: true });
  const rows = ids.map((id) => JSON.stringify({ id, name: id.replace(/_/g, " "), pattern: "horizontal_push", role: "both", equipment: [[]], muscles: ["chest"], level: "beginner", avoidFlags: [], loadType: "bodyweight", cue: "A cue.", images: [], instructions: ["x"], primaryMuscles: ["chest"], secondaryMuscles: [] }));
  fs.writeFileSync(path.join(rel, "exercises.generated.ts"), `export const GENERATED_EXERCISES = [\n${rows.map((r) => `  ${r},`).join("\n")}\n];\n`);
}

const writeMap = (file: string, map: Record<string, string>, spec: Record<string, unknown> = {}) => {
  const real = path.join(scripts, "video-map.mjs");
  fs.writeFileSync(file, `export * from ${JSON.stringify(real)};\nexport const VIDEO_MAP = ${JSON.stringify(map)};\nexport const NEW_SPEC = ${JSON.stringify(spec)};\n`);
};
const run = (src: string, out: string, map: string, extra: string[] = []) => spawnSync("node", [importVideos, "--source", src, "--out", out, "--map", map, ...extra], { encoding: "utf8" });
const hashTree = (dir: string): string => {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
};

describe.skipIf(!hasFfmpeg)("video importer (WL-19)", () => {
  const snap = path.join(tmp, "workout-free-videos-v9.9.9");
  makeSnapshot(snap, [
    { slug: "alpha-press", name: "Alpha Press", equipment: ["dumbbell", "bench"] },
    { slug: "beta-curl", name: "Beta Curl", equipment: ["cable"] },
    { slug: "gamma-roll", name: "Gamma Roll", equipment: ["roller"], type: "recovery" },
  ]);
  const map = path.join(tmp, "map.mjs");
  writeMap(map, { "alpha-press": "Matched_One", "beta-curl": "new", "gamma-roll": "skip:F1-warmup-later" }, { "beta-curl": { pattern: "arms", role: "accessory" } });

  it("fails without --source", () => {
    expect(spawnSync("node", [importVideos], { encoding: "utf8" }).status).toBe(2);
  });

  it("asks for the exercise importer first when the catalog is missing", () => {
    const r = run(snap, path.join(tmp, "nocatalog"), map);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("import-exercises");
  });

  it("matches, adds and skips; copies only used clips; cuts poster and frames", () => {
    const out = path.join(tmp, "out1");
    makeOut(out, ["Matched_One", "Other_One"]);
    const r = run(snap, out, map);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(path.join(out, "public/videos")).sort()).toEqual(["alpha-press.mp4", "alpha-press.webp", "beta-curl.mp4", "beta-curl.webp"]);
    expect(fs.readdirSync(path.join(out, "public/exercises/wfv_beta-curl")).sort()).toEqual(["0.webp", "1.webp"]);
    expect(fs.existsSync(path.join(out, "public/exercises/Matched_One"))).toBe(false);
    const gen = fs.readFileSync(path.join(out, "src/features/workout-plan/data/exercises.videos.generated.ts"), "utf8");
    expect(gen).toContain("CC0 1.0");
    expect(gen).toContain("tag v9.9.9");
    expect(gen).toContain(createHash("sha256").update(fs.readFileSync(path.join(snap, "data/exercises.json"))).digest("hex"));
    expect(gen).toContain('"Matched_One":');
    expect(gen).not.toContain('"Other_One"');
    expect(gen).toContain('"id":"wfv_beta-curl"');
    expect(gen).toContain('"equipment":[["cable_station"]]');
    expect(gen).toContain('"avoidFlags":["lower_back","shoulder"]');
    expect(gen).toContain('"primaryMuscles":["chest"]');
    expect(gen).toContain('"secondaryMuscles":["triceps","hip flexors"]');
    expect(gen).not.toContain("gamma-roll");
    const report = fs.readFileSync(path.join(out, "scripts/import-report.md"), "utf8");
    expect(report).toContain("## Videos");
    expect(report).toContain("| alpha-press | Matched_One | Matched One |");
    expect(report).toContain("| gamma-roll | F1-warmup-later |");
  });

  it("gives byte-identical output on a second run", () => {
    const out = path.join(tmp, "out1");
    const before = hashTree(out);
    expect(run(snap, out, map).status).toBe(0);
    expect(hashTree(out)).toBe(before);
  });

  it("stops on a clip that has no entry in the table", () => {
    const m = path.join(tmp, "partial.mjs");
    writeMap(m, { "alpha-press": "Matched_One", "gamma-roll": "skip:F1-warmup-later" });
    const out = path.join(tmp, "out2");
    makeOut(out, ["Matched_One"]);
    const r = run(snap, out, m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("beta-curl");
  });

  it("stops on a table slug the snapshot does not have", () => {
    const m = path.join(tmp, "extra.mjs");
    writeMap(m, { "alpha-press": "Matched_One", "beta-curl": "new", "gamma-roll": "skip:F1-warmup-later", ghost: "skip:not there at all" }, { "beta-curl": { pattern: "arms", role: "accessory" } });
    const out = path.join(tmp, "out3");
    makeOut(out, ["Matched_One"]);
    const r = run(snap, out, m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ghost");
  });

  it("stops when a match points at an exercise the catalog lacks, or two clips claim one exercise", () => {
    const out = path.join(tmp, "out4");
    makeOut(out, ["Other_One"]);
    const r = run(snap, out, map);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Matched_One");
    const m = path.join(tmp, "twice.mjs");
    writeMap(m, { "alpha-press": "Matched_One", "beta-curl": "Matched_One", "gamma-roll": "skip:F1-warmup-later" });
    makeOut(out, ["Matched_One"]);
    const r2 = run(snap, out, m);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("two clips");
  });

  it("needs a reason for every skip, and a spec for every new clip", () => {
    const out = path.join(tmp, "out5");
    makeOut(out, ["Matched_One"]);
    const m1 = path.join(tmp, "noreason.mjs");
    writeMap(m1, { "alpha-press": "Matched_One", "beta-curl": "new", "gamma-roll": "skip:" }, { "beta-curl": { pattern: "arms", role: "accessory" } });
    expect(run(snap, out, m1).stderr).toContain("skip");
    const m2 = path.join(tmp, "nospec.mjs");
    writeMap(m2, { "alpha-press": "Matched_One", "beta-curl": "new", "gamma-roll": "skip:F1-warmup-later" });
    expect(run(snap, out, m2).stderr).toContain("NEW_SPEC");
  });

  it("stops when the mp4 does not match the sha256 in exercises.json", () => {
    const bad = path.join(tmp, "workout-free-videos-v9.9.8");
    makeSnapshot(bad, [{ slug: "alpha-press", name: "Alpha Press", equipment: ["dumbbell"] }], "alpha-press");
    const m = path.join(tmp, "bad.mjs");
    writeMap(m, { "alpha-press": "Matched_One" });
    const out = path.join(tmp, "out6");
    makeOut(out, ["Matched_One"]);
    const r = run(bad, out, m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("sha256");
  });

  it("stops when videos or images are over the budget", () => {
    const out = path.join(tmp, "out7");
    makeOut(out, ["Matched_One"]);
    expect(run(snap, out, map, ["--max-video-mb", "0.00001"]).stderr).toContain("above");
    expect(run(snap, out, map, ["--max-image-mb", "0.00001"]).stderr).toContain("above");
  });

  it("rejects a snapshot folder without a tag", () => {
    const noTag = path.join(tmp, "snapshot-no-tag");
    makeSnapshot(noTag, [{ slug: "alpha-press", name: "Alpha Press", equipment: ["dumbbell"] }]);
    const out = path.join(tmp, "out8");
    makeOut(out, ["Matched_One"]);
    expect(run(noTag, out, map).status).toBe(1);
  });

  it("survives a re-run of the exercise importer: wfv_ images and the Videos section stay", () => {
    const out = path.join(tmp, "out1");
    const fe = path.join(tmp, "free-exercise-db-2026-01-02");
    fs.mkdirSync(path.join(fe, "images/Pushups"), { recursive: true });
    fs.writeFileSync(path.join(fe, "exercises.json"), JSON.stringify([{ id: "Pushups", name: "Pushups", equipment: "body only", category: "strength", force: "push", level: "beginner", mechanic: "compound", primaryMuscles: ["chest"], secondaryMuscles: ["triceps"], instructions: ["Get down on the floor. Push up."], images: [] }]));
    for (const i of [0, 1]) fs.writeFileSync(path.join(fe, "images/Pushups", `${i}.webp`), "x");
    const r = spawnSync("node", [importExercises, "--source", fe, "--out", out], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(out, "public/exercises/wfv_beta-curl/0.webp"))).toBe(true);
    const report = fs.readFileSync(path.join(out, "scripts/import-report.md"), "utf8");
    expect(report).toContain("## Videos");
    expect(report.indexOf("# Import report")).toBeLessThan(report.indexOf("## Videos"));
    expect(report.match(/## Videos/g)).toHaveLength(1);
  });

  const realSnapshot = path.join(process.env.HOME ?? "", "mnt/PTA/_spotter-data/workout-free-videos-v2.0.0");
  it.skipIf(!fs.existsSync(realSnapshot))("the committed data and media equal a fresh import of the real snapshot", () => {
    const repo = path.resolve(__dirname, "../../../..");
    const out = path.join(tmp, "real");
    for (const rel of ["src/features/workout-plan/data/exercises.generated.ts", "scripts/import-report.md"]) {
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.copyFileSync(path.join(repo, rel), path.join(out, rel));
    }
    execFileSync("node", [importVideos, "--source", realSnapshot, "--out", out]);
    const same = (rel: string) => expect(fs.readFileSync(path.join(out, rel)).equals(fs.readFileSync(path.join(repo, rel))), rel).toBe(true);
    same("src/features/workout-plan/data/exercises.videos.generated.ts");
    same("scripts/import-report.md");
    const fresh = hashTree(path.join(out, "public/videos"));
    expect(fresh).toBe(hashTree(path.join(repo, "public/videos")));
    for (const d of fs.readdirSync(path.join(repo, "public/exercises")).filter((n) => n.startsWith("wfv_"))) {
      expect(hashTree(path.join(out, "public/exercises", d)), d).toBe(hashTree(path.join(repo, "public/exercises", d)));
    }
  }, 120_000);
});
