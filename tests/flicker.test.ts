import { describe, expect, it } from "vitest";
import { analyzeFrames } from "../src/analysis/analyzer";
import { normalize } from "../src/analysis/chroma";
import { QUALITY_INTERVALS, mod12 } from "../src/music/theory";
import type { ChordQuality, FeatureFrame } from "../src/shared/types";

/** A sung melody adds non-chord pitch classes in bursts of 0.2–0.6 s; drums add broadband flux. */
function stressFrames(bpm: number, seed: number, melodyAmp: number): { frames: FeatureFrame[]; changes: number; beats: number[]; period: number } {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const prog: [number, ChordQuality][] = [[7, "maj"], [2, "maj"], [4, "min"], [0, "maj"]];
  const period = 60 / bpm, barSec = period * 4;
  const frames: FeatureFrame[] = [];
  const scale = [7, 9, 11, 0, 2, 4, 6];
  let melodyUntil = 0, melodyPc = 0;
  const total = 28 * barSec;
  for (let t = 0; t < total; t += 0.1) {
    const [root, q] = prog[Math.floor(t / barSec) % 4]!;
    const c = new Array<number>(12).fill(0.04 * 0);
    QUALITY_INTERVALS[q].forEach((iv, i) => (c[mod12(root + iv)] = i === 0 ? 1 : 0.85));
    if (t >= melodyUntil) { melodyUntil = t + 0.2 + rnd() * 0.4; melodyPc = scale[Math.floor(rnd() * scale.length)]!; }
    c[melodyPc]! += melodyAmp;
    const b = new Array<number>(12).fill(0); b[root] = 1;
    frames.push({ t: t + 0.09, chroma: normalize(c.map((x) => x + 0.05 * rnd())), bass: normalize(b.map((x) => x + 0.03 * rnd())), energy: 0.04 });
  }
  const beats: number[] = [];
  for (let t = 0; t < total; t += period) beats.push(t);
  return { frames, changes: 27, beats, period };
}

function score(res: ReturnType<typeof analyzeFrames>, frames: FeatureFrame[], bpm: number) {
  const prog = ["7", "2", "4m", "0"];
  const barSec = (60 / bpm) * 4;
  let ok = 0;
  for (const f of frames) {
    const c = res.chords.find((x) => x.startSec <= f.t && f.t < x.endSec);
    const truth = prog[Math.floor((f.t - 0.09) / barSec) % 4]!;
    if (c && c.root !== null && `${c.root}${c.quality === "min" ? "m" : ""}` === truth) ok++;
  }
  return { accuracy: ok / frames.length, events: res.chords.length };
}

describe("flicker under melody and noise", () => {
  const key = { tonic: 7 as const, mode: "major" as const, confidence: 0.9 };
  for (const amp of [0.9, 1.5, 2.5]) {
    it(`melody amplitude ${amp}: few extra chord changes, high accuracy`, () => {
      const bpm = 100;
      const { frames, changes, period } = stressFrames(bpm, 11, amp);
      const res = analyzeFrames(frames, key, { period, offset: 0 });
      const r = score(res, frames, bpm);
      console.log(`amp ${amp}: events ${r.events} (true ${changes + 1}), accuracy ${r.accuracy.toFixed(3)}`);
      expect(r.events).toBeLessThanOrEqual((changes + 1) * 1.5);
      expect(r.accuracy).toBeGreaterThan(amp > 2 ? 0.85 : 0.9);
    });
  }

  it("without a beat grid (first seconds of a song) it is still much steadier than raw frames", () => {
    const { frames, changes } = stressFrames(100, 11, 1.5);
    const r = score(analyzeFrames(frames, key), frames, 100);
    console.log(`no grid, amp 1.5: events ${r.events} (true ${changes + 1}), accuracy ${r.accuracy.toFixed(3)}`);
    expect(r.events).toBeLessThan(60); // was 81 before smoothing changes
  });
});

import { SongSession } from "../src/analysis/session";

describe("live chord while streaming", () => {
  // Frames arrive one by one; at each moment the display asks for the chord "now".
  function stream(amp: number, withGrid: boolean) {
    const bpm = 100;
    const { frames } = stressFrames(bpm, 11, amp);
    const rec = SongSession.blank("v", "t", 70);
    rec.key = { tonic: 7, mode: "major", confidence: 0.9 };
    if (withGrid) {
      rec.tempoBpm = bpm;
      rec.beats = Array.from({ length: 120 }, (_, i) => i * 0.6);
      rec.downbeat = 0;
    }
    const sess = new SongSession(rec);
    const prog = ["7", "2", "4m", "0"];
    const barSec = 2.4;
    let ok = 0, n = 0, changes = 0, last = "";
    for (const f of frames) {
      sess.addFrame(f);
      if (f.t < 4) continue;
      const c = sess.liveChord(f.t);
      const name = c && c.root !== null ? `${c.root}${c.quality === "min" ? "m" : ""}` : "";
      if (name !== last) { changes++; last = name; }
      const within = (f.t - 0.09) % barSec;
      if (within > 0.8 && within < 2.2) { n++; if (name === prog[Math.floor((f.t - 0.09) / barSec) % 4]) ok++; }
    }
    return { accuracy: ok / n, changesPerTrue: changes / ((frames[frames.length - 1]!.t - 4) / barSec) };
  }
  it.each([0.9, 1.5])("melody %f with beat grid: responsive and steady", (amp) => {
    const r = stream(amp, true);
    console.log(`live amp ${amp} grid: accuracy ${r.accuracy.toFixed(3)}, changes/true ${r.changesPerTrue.toFixed(2)}`);
    expect(r.accuracy).toBeGreaterThan(0.85);
    expect(r.changesPerTrue).toBeLessThan(1.8);
  });
  it("before a tempo is known", () => {
    const r = stream(0.9, false);
    console.log(`live amp 0.9 no grid: accuracy ${r.accuracy.toFixed(3)}, changes/true ${r.changesPerTrue.toFixed(2)}`);
    expect(r.accuracy).toBeGreaterThan(0.8);
    expect(r.changesPerTrue).toBeLessThan(2.5);
  });
});
