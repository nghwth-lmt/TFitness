import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPMENT_IDS, PATTERNS, WEEKDAYS, type Exercise, type Profile } from "../domain";
import { buildPlan } from "../engine/buildPlan";
import { isDoable } from "../engine/availability";
import { EXERCISES, getExercise } from "./exercises";

const root = path.resolve(__dirname, "../../../..");
const pub = (p: string) => path.join(root, "public", p);
const mapPath = path.join(root, "scripts/video-map.mjs");
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const withVideo = EXERCISES.filter((e) => e.video);
const added = EXERCISES.filter((e) => e.id.startsWith("wfv_"));

async function loadMap() {
  return (await import(/* @vite-ignore */ mapPath)) as { VIDEO_MAP: Record<string, string>; NEW_SPEC: Record<string, { pattern: string; role: string }> };
}

describe("AC31: every clip is matched, added or skipped with a reason", () => {
  it("the table has all 57 clips of the snapshot, each with a valid value", async () => {
    const { VIDEO_MAP } = await loadMap();
    expect(Object.keys(VIDEO_MAP)).toHaveLength(57);
    for (const [slug, v] of Object.entries(VIDEO_MAP)) {
      if (v === "new") continue;
      if (v.startsWith("skip:")) {
        expect(v.length, slug).toBeGreaterThan("skip:".length + 5);
        continue;
      }
      expect(getExercise(v), `${slug} -> ${v}`).toBeDefined();
    }
  });

  it("mobility and recovery clips are skipped for later (F1 warm-up)", async () => {
    const { VIDEO_MAP } = await loadMap();
    const later = Object.values(VIDEO_MAP).filter((v) => v === "skip:F1-warmup-later");
    expect(later).toHaveLength(9);
  });

  it("every matched or new clip lands on exactly one exercise, and no exercise gets two clips", async () => {
    const { VIDEO_MAP } = await loadMap();
    const used = Object.entries(VIDEO_MAP).filter(([, v]) => !v.startsWith("skip:"));
    const ids = used.map(([slug, v]) => (v === "new" ? `wfv_${slug}` : v));
    expect(new Set(ids).size).toBe(ids.length);
    expect(withVideo.map((e) => e.id).sort()).toEqual([...ids].sort());
  });

  it("each video file exists in public/videos and its sha256 matches the recorded one", () => {
    expect(withVideo.length).toBeGreaterThan(30);
    for (const e of withVideo) {
      const v = e.video!;
      expect(v.path, e.id).toMatch(/^\/videos\/[a-z0-9-]+\.mp4$/);
      expect(fs.existsSync(pub(v.path.slice(1))), `${e.id} file`).toBe(true);
      expect(sha(pub(v.path.slice(1))), e.id).toBe(v.sha256);
      expect(v.poster, e.id).toMatch(/^\/videos\/[a-z0-9-]+\.webp$/);
      expect(fs.existsSync(pub(v.poster.slice(1))), `${e.id} poster`).toBe(true);
      expect(v.durationSec, e.id).toBeGreaterThanOrEqual(4);
      expect(v.durationSec, e.id).toBeLessThanOrEqual(8);
      expect(v.width, e.id).toBe(1280);
      expect(v.height, e.id).toBe(720);
    }
  });

  it("public/videos holds only clips that an exercise uses, within 30 MB", () => {
    const files = fs.readdirSync(pub("videos"));
    const expected = new Set(withVideo.flatMap((e) => [e.video!.path.slice("/videos/".length), e.video!.poster.slice("/videos/".length)]));
    expect(files.sort()).toEqual([...expected].sort());
    const bytes = files.reduce((n, f) => n + fs.statSync(pub(`videos/${f}`)).size, 0);
    expect(bytes).toBeLessThanOrEqual(30 * 1024 * 1024);
  });

  it("an exercise with video has exactly 3 key points, each a non-empty sentence", () => {
    for (const e of withVideo) {
      expect(e.cues, e.id).toHaveLength(3);
      for (const c of e.cues!) expect(c.trim().length, e.id).toBeGreaterThan(5);
    }
    for (const e of EXERCISES.filter((x) => !x.video)) expect(e.cues, e.id).toBeUndefined();
  });
});

describe("AC33: exercises added from the video source", () => {
  it("are marked wfv_<slug>, with two frames cut from the clip and within the 3 MB image budget", () => {
    expect(added.length).toBeGreaterThanOrEqual(10);
    let bytes = 0;
    for (const e of added) {
      expect(e.video, e.id).toBeDefined();
      expect(e.id).toBe(`wfv_${path.basename(e.video!.path, ".mp4")}`);
      expect(e.images, e.id).toEqual([`/exercises/${e.id}/0.webp`, `/exercises/${e.id}/1.webp`]);
      for (const img of e.images) {
        expect(fs.existsSync(pub(img.slice(1))), img).toBe(true);
        bytes += fs.statSync(pub(img.slice(1))).size;
      }
    }
    expect(bytes).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it("carry valid pattern, role, equipment ids, muscles and flags", async () => {
    const { NEW_SPEC } = await loadMap();
    for (const e of added) {
      const slug = path.basename(e.video!.path, ".mp4");
      expect(NEW_SPEC[slug], slug).toBeDefined();
      expect(PATTERNS, e.id).toContain(e.pattern);
      expect(e.pattern, e.id).toBe(NEW_SPEC[slug].pattern);
      expect(e.muscles.length, e.id).toBeGreaterThan(0);
      expect(e.cue.length, e.id).toBeLessThanOrEqual(90);
      expect(e.instructions.length, e.id).toBeGreaterThan(0);
      for (const and of e.equipment) for (const id of and) expect(EQUIPMENT_IDS, e.id).toContain(id);
    }
  });

  it("map equipment from the source: cable -> cable_station, ball -> stability_ball, plate -> plates, dumbbell+ball", () => {
    const eq = (id: string) => getExercise(id)!.equipment;
    expect(eq("wfv_tall-kneeling-cable-lift")).toEqual([["cable_station"]]);
    expect(eq("wfv_exercise-ball-wall-squat")).toEqual([["stability_ball"]]);
    expect(eq("wfv_weighted-crunch")).toEqual([["plates"]]);
    expect(eq("wfv_exercise-ball-dumbbell-bench-press")).toEqual([["dumbbells", "stability_ball"]]);
    expect(eq("wfv_superman")).toEqual([[]]);
    expect(eq("wfv_reverse-grip-barbell-curl")).toEqual([["ez_bar"]]);
  });

  it("map joint stress to avoid flags (knee, lowBack -> lower_back, shoulder, wrist)", () => {
    expect(getExercise("wfv_exercise-ball-wall-squat")!.avoidFlags).toEqual(["knee"]);
    expect(getExercise("wfv_stiff-leg-deadlift")!.avoidFlags).toEqual(["lower_back"]);
    expect(getExercise("wfv_exercise-ball-dumbbell-bench-press")!.avoidFlags).toEqual(["shoulder"]);
    expect(getExercise("wfv_reverse-grip-barbell-curl")!.avoidFlags).toEqual(["wrist"]);
  });

  it("names are unique across the whole catalog", () => {
    const names = EXERCISES.map((e) => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("each can be chosen by buildPlan when it is the only exercise of its pattern", () => {
    const profile = (days: number): Profile => ({
      trainingDays: WEEKDAYS.slice(0, days) as unknown as Profile["trainingDays"],
      sessionMinutes: 90,
      equipment: [...EQUIPMENT_IDS],
      goal: "build_muscle",
      level: "advanced",
      avoid: [],
      updatedAt: 1,
    });
    for (const e of added) {
      const catalog: Exercise[] = [e, ...EXERCISES.filter((x) => x.pattern !== e.pattern)];
      expect(isDoable(e, EQUIPMENT_IDS), e.id).toBe(true);
      // Some slots exist only in some splits (an accessory hinge only in the 2-day full body), so try every day count.
      const used = [2, 3, 4, 5, 6].flatMap((days) => buildPlan(profile(days), catalog, 7).templates.flatMap((t) => t.slots)).filter((s) => s.pattern === e.pattern && (s.role === "main" ? e.role !== "accessory" : e.role !== "main"));
      expect(used.length, `${e.id}: some plan has a ${e.pattern} ${e.role} slot`).toBeGreaterThan(0);
      for (const s of used) expect(s.exerciseId, e.id).toBe(e.id);
    }
  });
});
