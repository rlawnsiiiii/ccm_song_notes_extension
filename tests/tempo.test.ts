import { describe, expect, it } from "vitest";
import { ONSET_HOP_SEC, ONSET_WIN, OnsetExtractor, normalizeOnsets } from "../src/analysis/onset";
import { estimateTempo } from "../src/analysis/tempo";
import { SongSession } from "../src/analysis/session";
import { SR, makeSong, type SongSpec } from "./songgen";

function onsetsOf(pcm: Float32Array, secs: number): Float32Array {
  const ex = new OnsetExtractor(SR);
  const hop = Math.round(ONSET_HOP_SEC * SR);
  const out: number[] = [];
  for (let s = 0; s + ONSET_WIN <= Math.min(secs * SR, pcm.length); s += hop) out.push(ex.push(pcm.subarray(s, s + ONSET_WIN)));
  return normalizeOnsets(Float32Array.from(out));
}

describe("onset extractor", () => {
  it("peaks at a click and is quiet in silence", () => {
    const ex = new OnsetExtractor(SR);
    const quiet = new Float32Array(ONSET_WIN);
    ex.push(quiet);
    const base = ex.push(quiet);
    const click = new Float32Array(ONSET_WIN);
    for (let i = 400; i < 520; i++) click[i] = Math.sin(i * 0.9) * Math.exp(-(i - 400) / 30);
    expect(ex.push(click)).toBeGreaterThan(base + 1);
  });
});

describe("tempo on synthetic bands with known tempo", () => {
  const cases: { spec: SongSpec; exactOrOctave?: boolean }[] = [
    { spec: { bpm: 72, style: "rock", seed: 3 } },
    { spec: { bpm: 90, style: "rock", seed: 1, key: 2 } },
    { spec: { bpm: 104, style: "acoustic", seed: 1, key: 9 } },
    { spec: { bpm: 80, style: "acoustic", seed: 2, swing: 0.15 } },
    { spec: { bpm: 66, style: "ballad", seed: 1 } },
    { spec: { bpm: 100, style: "rock", seed: 3, melody: 1.5, swing: 0.08 } },
  ];
  it.each(cases.map((c) => [`${c.spec.style} ${c.spec.bpm}`, c.spec] as const))("%s BPM", (_n, spec) => {
    const { pcm, truth } = makeSong({ ...spec, seconds: 30 });
    const est = estimateTempo(onsetsOf(pcm, 30))!;
    expect(est).not.toBeNull();
    expect(Math.abs(est.bpm / truth.bpm - 1)).toBeLessThan(0.03);
  });
  it("finds the beat phase", () => {
    const { pcm, truth } = makeSong({ bpm: 96, style: "rock", seed: 1, seconds: 30, offset: 0.35 });
    const est = estimateTempo(onsetsOf(pcm, 30))!;
    const T = 60 / est.bpm;
    const d = (((est.offset - truth.offset) % T) + T) % T;
    expect(Math.min(d, T - d)).toBeLessThan(0.06);
  });
  it("reports ambiguity for a pad with no attacks instead of pretending", () => {
    const { pcm } = makeSong({ bpm: 90, style: "pad-only", seed: 1, seconds: 30 });
    const est = estimateTempo(onsetsOf(pcm, 30));
    // anything is allowed, but the confidence must be low
    if (est) expect(est.confidence).toBeLessThan(0.6);
  });
});

describe("tempo octave override", () => {
  function sessionWithTempo() {
    const rec = SongSession.blank("v", "t", 60);
    rec.tempoBpm = 120; rec.beats = Array.from({ length: 100 }, (_, i) => 0.3 + i * 0.5); rec.downbeat = 1; rec.beatsPerBar = 4;
    return new SongSession(rec);
  }
  it("halves: keeps bar starts, locks the tempo", () => {
    const s = sessionWithTempo();
    const barStart = s.record.beats![1]!;
    s.rescaleTempo(0.5);
    expect(s.record.tempoBpm).toBe(60);
    expect(s.record.tempoLocked).toBe(true);
    expect(s.record.beats![s.record.downbeat!]).toBeCloseTo(barStart);
    expect(s.record.beats![1]! - s.record.beats![0]!).toBeCloseTo(1.0);
  });
  it("doubles: adds the beats in between", () => {
    const s = sessionWithTempo();
    const barStart = s.record.beats![1]!;
    s.rescaleTempo(2);
    expect(s.record.tempoBpm).toBe(240);
    expect(s.record.beats![1]! - s.record.beats![0]!).toBeCloseTo(0.25);
    expect(s.record.beats![s.record.downbeat!]).toBeCloseTo(barStart);
  });
});
