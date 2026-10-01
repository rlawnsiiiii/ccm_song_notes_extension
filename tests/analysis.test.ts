import { describe, expect, it } from "vitest";
import { analyzeFrames } from "../src/analysis/analyzer";
import { detectKey } from "../src/analysis/key";
import { progressionFrames } from "./synth";

describe("analysis on synthetic audio", () => {
  // G major: G D Em C
  const prog: [number, any, number | undefined, number][] = [
    [7, "maj", undefined, 2], [2, "maj", undefined, 2], [4, "min", undefined, 2], [0, "maj", undefined, 2],
    [7, "maj", undefined, 2], [2, "maj", undefined, 2], [4, "min", undefined, 2], [0, "maj", undefined, 2],
  ];
  const frames = progressionFrames(prog);

  it("finds the key", () => {
    const { key } = analyzeFrames(frames);
    expect(key?.tonic).toBe(7);
    expect(key?.mode).toBe("major");
  });

  it("finds the chords", () => {
    const { chords } = analyzeFrames(frames);
    const names = chords.map((c) => `${c.root}${c.quality}`);
    expect(names).toEqual(["7maj", "2maj", "4min", "0maj", "7maj", "2maj", "4min", "0maj"]);
  });

  it("detects slash bass", () => {
    const f = progressionFrames([[7, "maj", undefined, 2], [2, "maj", 6, 2], [4, "min", undefined, 2]]);
    const { chords } = analyzeFrames(f);
    expect(chords.some((c) => c.root === 2 && c.bass === 6)).toBe(true);
  });

  it("detectKey on a plain C major triad profile", () => {
    const k = detectKey([1, 0, 0.3, 0, 0.8, 0.3, 0, 0.9, 0, 0.3, 0, 0.2]);
    expect(k.tonic).toBe(0);
  });
});
