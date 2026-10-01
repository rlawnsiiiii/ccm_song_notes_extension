import type { ChordEvent, FeatureFrame } from "../shared/types";

export interface OnsetPoint { t: number; v: number }

/** Onset strength per frame: how much the harmony (chroma) and loudness changed. */
export function onsetEnvelope(frames: FeatureFrame[], harmW = 1, riseW = 1, compress = 0.5): OnsetPoint[] {
  const out: OnsetPoint[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!, b = frames[i]!;
    if (b.t - a.t > 0.25) continue; // gap between heard ranges
    let dot = 0;
    for (let k = 0; k < 12; k++) dot += a.chroma[k]! * b.chroma[k]!;
    const harmonic = Math.max(0, 1 - dot);
    const rise = Math.max(0, b.energy - a.energy) / (a.energy + 1e-4);
    out.push({ t: b.t, v: Math.pow(harmonic, compress) * harmW + riseW * Math.min(2, rise) });
  }
  return out;
}

export interface BeatGrid {
  bpm: number;
  /** time of beat 0 */
  offset: number;
  beats: number[];
  /** index (0..beatsPerBar-1) of the beat that starts a bar */
  downbeat: number;
  beatsPerBar: number;
}

const HOP = 0.1;

function sampleAt(env: Float32Array, t: number): number {
  const x = t / HOP;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = x - i;
  return env[i]! * (1 - f) + env[i + 1]! * f;
}

/** Log-gaussian prior around worship tempos; octave errors are common otherwise. */
const tempoPrior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 95) / 0.45) ** 2);

export function estimateBeatGrid(env: OnsetPoint[], durationSec: number, beatsPerBar = 4, midWeight = 0.5): BeatGrid | null {
  if (env.length < 50) return null;
  const n = Math.ceil(durationSec / HOP) + 2;
  const arr = new Float32Array(n);
  for (const p of env) { const i = Math.round(p.t / HOP); if (i >= 0 && i < n) arr[i] = p.v; }
  // light smoothing so that sub-frame phases are meaningful
  const sm = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) sm[i] = 0.25 * arr[i - 1]! + 0.5 * arr[i]! + 0.25 * arr[i + 1]!;
  let end = 0;
  for (const p of env) end = Math.max(end, p.t);

  let best = { score: -1, bpm: 0, offset: 0 };
  for (let bpm = 55; bpm <= 180; bpm += 0.25) {
    const period = 60 / bpm;
    const nb = Math.floor(end / period);
    if (nb < 8) continue;
    const prior = tempoPrior(bpm);
    for (let off = 0; off < period; off += 0.02) {
      let s = 0, mid = 0;
      for (let k = 0; k < nb; k++) {
        s += sampleAt(sm, off + k * period);
        mid += sampleAt(sm, off + (k + 0.5) * period); // between beats: should be quiet
      }
      const score = Math.max(0, s / nb - midWeight * (mid / nb)) * prior;
      if (score > best.score) best = { score, bpm, offset: off };
    }
  }
  if (best.bpm === 0) return null;
  const period = 60 / best.bpm;
  const beats: number[] = [];
  for (let t = best.offset; t < durationSec; t += period) beats.push(t);
  // downbeat: the beat phase (mod beatsPerBar) with the strongest onsets
  const sums = new Array<number>(beatsPerBar).fill(0);
  beats.forEach((t, i) => { sums[i % beatsPerBar]! += sampleAt(sm, t); });
  let downbeat = 0;
  for (let i = 1; i < beatsPerBar; i++) if (sums[i]! > sums[downbeat]!) downbeat = i;
  return { bpm: best.bpm, offset: best.offset, beats, downbeat, beatsPerBar };
}

/** Move chord boundaries to the nearest beat (if close), keeping events contiguous. */
export function snapChords(chords: ChordEvent[], beats: number[], maxBeatFraction = 0.4): ChordEvent[] {
  if (beats.length < 2 || chords.length === 0) return chords;
  const period = (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
  const tol = period * maxBeatFraction;
  const nearest = (t: number) => {
    let lo = 0, hi = beats.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m]! < t) lo = m + 1; else hi = m; }
    const cands = [beats[lo]!, beats[Math.max(0, lo - 1)]!];
    return cands.reduce((a, b) => (Math.abs(a - t) <= Math.abs(b - t) ? a : b));
  };
  const out = chords.map((c) => ({ ...c }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!, cur = out[i]!;
    if (Math.abs(prev.endSec - cur.startSec) > 0.3) continue; // gap between heard ranges
    const b = nearest(cur.startSec);
    if (Math.abs(b - cur.startSec) <= tol && b > prev.startSec + period * 0.5 && b < cur.endSec - period * 0.5) {
      cur.startSec = b; prev.endSec = b;
    }
  }
  return out.filter((c) => c.endSec - c.startSec > 0.05);
}

export interface Bar { index: number; startSec: number; endSec: number; beats: ChordEvent[][] }

/**
 * Beat grid from a tempo estimate (fine onset envelope) plus the chroma-change envelope, which
 * marks bar starts: the beat phase (mod beatsPerBar) with the most harmonic change is the downbeat.
 */
export function gridFromTempo(
  tempo: { bpm: number; offset: number }, durationSec: number, chordFlux: OnsetPoint[], beatsPerBar = 4,
): BeatGrid {
  const period = 60 / tempo.bpm;
  // start the grid one period before 0 so beat indices are stable; keep only beats inside the song
  let start = tempo.offset;
  while (start - period >= 0) start -= period;
  const beats: number[] = [];
  for (let t = start; t < durationSec; t += period) beats.push(t);
  const sums = new Array<number>(beatsPerBar).fill(0);
  const at = (t: number) => {
    let best = 0;
    for (const p of chordFlux) { if (p.t > t + period * 0.35) break; if (p.t >= t - period * 0.35 && p.v > best) best = p.v; }
    return best;
  };
  beats.forEach((t, i) => { sums[i % beatsPerBar]! += at(t); });
  let downbeat = 0;
  for (let i = 1; i < beatsPerBar; i++) if (sums[i]! > sums[downbeat]!) downbeat = i;
  return { bpm: tempo.bpm, offset: start, beats, downbeat, beatsPerBar };
}
