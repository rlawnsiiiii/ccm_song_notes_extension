import { describe, expect, it } from "vitest";
import { estimateBeatGrid, snapChords, type OnsetPoint } from "../src/analysis/beats";
import { buildBars } from "../src/analysis/bars";
import type { ChordEvent } from "../src/shared/types";

function pulses(bpm: number, seconds: number, accentEvery = 4, phase = 0.13): OnsetPoint[] {
  const env: OnsetPoint[] = [];
  const period = 60 / bpm;
  for (let t = 0; t < seconds; t += 0.1) {
    const k = (t - phase) / period;
    const d = Math.abs(k - Math.round(k)) * period;
    const idx = Math.round(k);
    const v = d < 0.06 ? (idx % accentEvery === 0 ? 1 : 0.35) : 0.02;
    env.push({ t, v });
  }
  return env;
}

describe("beats", () => {
  it("finds tempo and phase", () => {
    const g = estimateBeatGrid(pulses(100, 120), 120)!;
    expect(g.bpm).toBeGreaterThan(98);
    expect(g.bpm).toBeLessThan(102);
    const rel = (g.offset - 0.13 + 600) % (60 / g.bpm);
    expect(Math.min(rel, 60 / g.bpm - rel)).toBeLessThan(0.08);
  });
  it("finds the downbeat", () => {
    const g = estimateBeatGrid(pulses(100, 120), 120)!;
    // accents at beat index multiples of 4 from phase 0.13
    const firstDown = g.beats[g.downbeat]!;
    const k = (firstDown - 0.13) / 0.6;
    expect(Math.abs(k / 4 - Math.round(k / 4))).toBeLessThan(0.1);
  });
  it("snaps chord boundaries and builds bars", () => {
    const g = { bpm: 120, offset: 0, beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeat: 0, beatsPerBar: 4 };
    const mk = (s: number, e: number, root: number): ChordEvent => ({ startSec: s, endSec: e, root: root as any, quality: "maj", confidence: 1, source: "detected" });
    const snapped = snapChords([mk(0, 2.12, 7), mk(2.12, 3.9, 2), mk(3.9, 8, 4)], g.beats);
    expect(snapped.map((c) => c.startSec)).toEqual([0, 2, 4]);
    const bars = buildBars(snapped, g, 8);
    expect(bars.length).toBe(4);
    expect(bars[0]!.chords).toEqual([{ eventIndex: 0, beatInBar: 0 }]);
    expect(bars[1]!.chords).toEqual([{ eventIndex: 1, beatInBar: 0 }]);
  });
});
