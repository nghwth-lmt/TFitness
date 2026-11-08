import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "../../../../scripts/import-exercises.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wp-import-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Src = { id: string; name: string; equipment: string | null; category?: string; images?: boolean; instructions?: string[] };
function makeSnapshot(dir: string, list: Src[]) {
  const base = { force: "push", level: "beginner", mechanic: "compound", primaryMuscles: ["chest"], secondaryMuscles: ["triceps"], category: "strength" };
  const json = list.map((e) => ({ ...base, ...e, instructions: e.instructions ?? ["Lie flat on the bench. Press the bar up."], images: [`${e.id}/0.jpg`, `${e.id}/1.jpg`] }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercises.json"), JSON.stringify(json));
  for (const e of list) {
    if (e.images === false) continue;
    fs.mkdirSync(path.join(dir, "images", e.id), { recursive: true });
    for (const i of [0, 1]) fs.writeFileSync(path.join(dir, "images", e.id, `${i}.webp`), Buffer.from(`${e.id}-${i}`));
  }
}
const run = (src: string, out: string, extra: string[] = []) => spawnSync("node", [script, "--source", src, "--out", out, ...extra], { encoding: "utf8" });
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

const snap = path.join(tmp, "free-exercise-db-2026-01-02");
makeSnapshot(snap, [
  { id: "Pushups", name: "Pushups", equipment: "body only" },
  { id: "Barbell_Bench", name: "Barbell Bench Press - Medium Grip", equipment: "barbell" },
  { id: "Mystery_Move", name: "Mystery Move", equipment: "other" },
  { id: "No_Images", name: "Chin-Up", equipment: "body only", images: false },
  { id: "Stretchy", name: "Chest Stretch", equipment: "body only", category: "stretching" },
  { id: "Small_Words", name: "Dumbbell Squat To A Bench", equipment: "dumbbell" },
  { id: "Long_Cue", name: "Dumbbell Bench Press", equipment: "dumbbell", instructions: ["Lie down on a flat bench with a dumbbell in each hand resting on top of your thighs while keeping your back flat and your core braced for the whole movement."] },
]);

describe("exercise importer (WL-11)", () => {
  it("fails without --source", () => {
    const r = spawnSync("node", [script], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });

  it("imports mapped exercises, copies only their images, and excludes the rest with a reason", () => {
    const out = path.join(tmp, "out1");
    const r = run(snap, out);
    expect(r.status, r.stderr).toBe(0);
    const gen = fs.readFileSync(path.join(out, "src/features/workout-plan/data/exercises.generated.ts"), "utf8");
    expect(gen).toContain('"id":"Pushups"');
    expect(gen).toContain('"id":"Barbell_Bench"');
    expect(gen).not.toContain("Mystery_Move");
    expect(gen).not.toContain("No_Images");
    expect(gen).not.toContain("Stretchy");
    expect(fs.readdirSync(path.join(out, "public/exercises")).sort()).toEqual(["Barbell_Bench", "Long_Cue", "Pushups", "Small_Words"]);
    expect(fs.existsSync(path.join(out, "public/exercises/Pushups/1.webp"))).toBe(true);
    const report = fs.readFileSync(path.join(out, "scripts/import-report.md"), "utf8");
    expect(report).toContain("`Mystery_Move` Mystery Move: pattern not mapped with confidence");
    expect(report).toContain("`No_Images` Chin-Up: no two images in snapshot");
  });

  it("writes provenance: source, date, license, sha256 of exercises.json", () => {
    const out = path.join(tmp, "out1");
    const gen = fs.readFileSync(path.join(out, "src/features/workout-plan/data/exercises.generated.ts"), "utf8");
    const sha = createHash("sha256").update(fs.readFileSync(path.join(snap, "exercises.json"))).digest("hex");
    expect(gen).toContain("free-exercise-db");
    expect(gen).toContain("snapshot 2026-01-02");
    expect(gen).toContain("Unlicense");
    expect(gen).toContain(sha);
  });

  it("maps equipment to PRD ids and fills the data the UI needs", () => {
    const out = path.join(tmp, "out1");
    const gen = fs.readFileSync(path.join(out, "src/features/workout-plan/data/exercises.generated.ts"), "utf8");
    const rows = gen.split("\n").filter((l) => l.startsWith("  {")).map((l) => JSON.parse(l.trim().replace(/,$/, "")));
    const bench = rows.find((r) => r.id === "Barbell_Bench");
    expect(bench.pattern).toBe("horizontal_push");
    expect(bench.equipment).toEqual([["barbell", "flat_bench"], ["barbell", "adjustable_bench"]]);
    expect(bench.images).toEqual(["/exercises/Barbell_Bench/0.webp", "/exercises/Barbell_Bench/1.webp"]);
    expect(bench.instructions.length).toBeGreaterThan(0);
    expect(bench.primaryMuscles).toEqual(["chest"]);
    expect(rows.find((r) => r.id === "Pushups").equipment).toEqual([[]]);
    for (const r of rows) expect(r.cue.length).toBeLessThanOrEqual(90);
  });

  it("is byte-identical on a second run, and when the output already exists", () => {
    const a = path.join(tmp, "out2a");
    const b = path.join(tmp, "out2b");
    expect(run(snap, a).status).toBe(0);
    expect(run(snap, b).status).toBe(0);
    expect(run(snap, b).status).toBe(0);
    expect(hashTree(b)).toBe(hashTree(a));
  });

  it("removes images of exercises that are no longer selected", () => {
    const out = path.join(tmp, "out3");
    fs.mkdirSync(path.join(out, "public/exercises/Old_One"), { recursive: true });
    fs.writeFileSync(path.join(out, "public/exercises/Old_One/0.webp"), "x");
    expect(run(snap, out).status).toBe(0);
    expect(fs.existsSync(path.join(out, "public/exercises/Old_One"))).toBe(false);
  });

  it("stops when the images are over the size budget", () => {
    const r = run(snap, path.join(tmp, "out4"), ["--max-mb", "0.00001"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("above");
  });

  it("rejects a snapshot folder without a date", () => {
    const bad = path.join(tmp, "snapshot-no-date");
    makeSnapshot(bad, [{ id: "Pushups", name: "Pushups", equipment: "body only" }]);
    expect(run(bad, path.join(tmp, "out5")).status).not.toBe(0);
  });

  const realSnapshot = path.join(process.env.HOME ?? "", "mnt/PTA/_spotter-data/free-exercise-db-2026-11-06");
  it.skipIf(!fs.existsSync(realSnapshot))("the committed catalog equals a fresh import of the real snapshot", () => {
    const out = path.join(tmp, "real");
    execFileSync("node", [script, "--source", realSnapshot, "--out", out]);
    const repo = path.resolve(__dirname, "../../../..");
    const rel = "src/features/workout-plan/data/exercises.generated.ts";
    expect(fs.readFileSync(path.join(out, rel), "utf8")).toBe(fs.readFileSync(path.join(repo, rel), "utf8"));
    // The "Videos" section belongs to scripts/import-videos.mjs; everything before it is this importer's.
    const committed = fs.readFileSync(path.join(repo, "scripts/import-report.md"), "utf8");
    const videosAt = committed.indexOf("\n## Videos\n");
    const exercisesPart = videosAt >= 0 ? committed.slice(0, videosAt).replace(/\n+$/, "") : committed.replace(/\n+$/, "");
    expect(fs.readFileSync(path.join(out, "scripts/import-report.md"), "utf8").replace(/\n+$/, "")).toBe(exercisesPart);
  });

  describe("standard names (W36)", () => {
    const outDir = path.join(tmp, "names");
    const rowsOf = () => {
      const gen = fs.readFileSync(path.join(outDir, "src/features/workout-plan/data/exercises.generated.ts"), "utf8");
      return gen.split("\n").filter((l) => l.startsWith("  {")).map((l) => JSON.parse(l.trim().replace(/,$/, "")));
    };

    it("renames to the standard name and keeps the id", () => {
      expect(run(snap, outDir).status).toBe(0);
      const rows = rowsOf();
      expect(rows.find((r) => r.id === "Pushups").name).toBe("Push-up");
      expect(rows.find((r) => r.id === "Barbell_Bench").name).toBe("Barbell Bench Press - Medium Grip");
    });

    it("lower-cases small words inside a name, and leaves a name alone when nothing applies", () => {
      const rows = rowsOf();
      expect(rows.find((r) => r.id === "Small_Words").name).toBe("Dumbbell Squat to a Bench");
      expect(rows.find((r) => r.id === "Long_Cue").name).toBe("Dumbbell Bench Press");
    });

    it("lists every renamed exercise in the report, old name and new name", () => {
      const report = fs.readFileSync(path.join(outDir, "scripts/import-report.md"), "utf8");
      expect(report).toContain("## Renamed exercises (W36)");
      expect(report).toContain('`Pushups`: "Pushups" -> "Push-up"');
      expect(report).toContain('`Small_Words`: "Dumbbell Squat To A Bench" -> "Dumbbell Squat to a Bench"');
      expect(report).not.toContain('`Long_Cue`: "Dumbbell Bench Press"');
    });

    it("the exercise class of a rename is unchanged: only name differs from the source name", () => {
      const rows = rowsOf();
      expect(rows.find((r) => r.id === "Pushups").pattern).toBe("horizontal_push");
    });

    it("stops when two exercises would get the same name", () => {
      const dup = path.join(tmp, "free-exercise-db-2026-03-04");
      makeSnapshot(dup, [
        { id: "Pushups", name: "Pushups", equipment: "body only" },
        { id: "Push_Up_Copy", name: "Push-Up", equipment: "body only" },
      ]);
      const r = run(dup, path.join(tmp, "out-dup"));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("same name");
    });
  });
});
