import type { ChordEvent, FeatureFrame, KeyInfo } from "../shared/types";
import { dominantBass, chordFromBass } from "./chords";
import { KeyAccumulator } from "./key";
import { normalize } from "./chroma";
import { viterbi } from "./smoothing";

export const ANALYZER_VERSION = "0.4.0";

export interface AnalysisResult {
  key: KeyInfo | null;
  chords: ChordEvent[];
}

/** Key from energy-weighted chroma only (no chord decoding). */
export function estimateKey(frames: FeatureFrame[]): KeyInfo | null {
  const acc = new KeyAccumulator();
  for (const f of frames) acc.add(f.chroma, Math.min(1, f.energy * 20));
  return acc.key();
}

export interface GridLite { period: number; offset: number }

interface Unit { start: number; end: number; chroma: number[]; bass: number[]; energy: number; frames: FeatureFrame[] }

/** One unit per frame, or (with a beat grid) one per beat: melody and drum flicker average out within a beat. */
function toUnits(frames: FeatureFrame[], grid?: GridLite | null): Unit[] {
  const hop = frames.length > 1 ? (frames[frames.length - 1]!.t - frames[0]!.t) / (frames.length - 1) : 0.1;
  if (!grid) {
    return frames.map((f) => ({ start: Math.max(0, f.t - hop / 2), end: f.t + hop / 2, chroma: f.chroma, bass: f.bass, energy: f.energy, frames: [f] }));
  }
  const groups = new Map<number, FeatureFrame[]>();
  for (const f of frames) {
    const k = Math.floor((f.t - grid.offset) / grid.period);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  const units: Unit[] = [];
  const first = frames[0]!.t - hop / 2, last = frames[frames.length - 1]!.t + hop / 2;
  for (const k of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(k)!;
    const chroma = new Array<number>(12).fill(0), bass = new Array<number>(12).fill(0);
    let energy = 0;
    for (const f of g) { for (let i = 0; i < 12; i++) { chroma[i]! += f.chroma[i]!; bass[i]! += f.bass[i]!; } energy += f.energy; }
    units.push({
      start: Math.max(first, grid.offset + k * grid.period), end: Math.min(last, grid.offset + (k + 1) * grid.period),
      chroma: normalize(chroma), bass: normalize(bass), energy: energy / g.length, frames: g,
    });
  }
  return units.filter((u) => u.end - u.start > 0.02);
}

/**
 * Offline analysis of an ordered list of frames (also used by the live analyzer on a window).
 * With a beat grid the chords are decoded per beat, which is far steadier on real recordings.
 */
export function analyzeFrames(frames: FeatureFrame[], keyHint?: KeyInfo | null, grid?: GridLite | null, opts: { stay?: number } = {}): AnalysisResult {
  if (frames.length === 0) return { key: null, chords: [] };
  const key = keyHint ?? estimateKey(frames);
  const units = toUnits(frames, grid);
  const { states, path, confidence } = viterbi(units, { key, stay: opts.stay ?? (grid ? 0.8 : 0.93) });
  const chords: ChordEvent[] = [];
  let start = 0;
  const flush = (end: number) => {
    const st = states[path[start]!]!;
    let conf = 0;
    const avg = new Array<number>(12).fill(0);
    let n = 0;
    for (let i = start; i < end; i++) {
      conf += confidence[i]!;
      for (const f of units[i]!.frames) { f.bass.forEach((v, k) => (avg[k]! += v)); n++; }
    }
    conf /= end - start;
    let bass;
    if (st.root !== null && st.quality !== null) bass = chordFromBass(st.root, st.quality, dominantBass(avg.map((v) => v / Math.max(1, n))));
    chords.push({
      startSec: units[start]!.start, endSec: units[end - 1]!.end,
      root: st.root, quality: st.quality,
      ...(bass !== undefined ? { bass } : {}),
      confidence: conf, source: "detected",
    });
  };
  for (let i = 1; i < units.length; i++) {
    if (path[i] !== path[i - 1]) { flush(i); start = i; }
  }
  flush(units.length);
  return { key, chords: grid ? chords : mergeShort(chords, 0.45) };
}

/** Without a beat grid: absorb blips shorter than `minSec` into the neighbour that explains them best. */
export function mergeShort(chords: ChordEvent[], minSec: number): ChordEvent[] {
  const out = chords.map((c) => ({ ...c }));
  let changed = true;
  while (changed && out.length > 1) {
    changed = false;
    let idx = -1, shortest = minSec;
    out.forEach((c, i) => { const d = c.endSec - c.startSec; if (d < shortest) { shortest = d; idx = i; } });
    if (idx < 0) break;
    const prev = out[idx - 1], next = out[idx + 1];
    const target = !prev ? next! : !next ? prev : (prev.endSec - prev.startSec) * prev.confidence >= (next.endSec - next.startSec) * next.confidence ? prev : next;
    if (target === prev) prev!.endSec = out[idx]!.endSec; else next!.startSec = out[idx]!.startSec;
    out.splice(idx, 1);
    changed = true;
  }
  // neighbours that became identical are one chord again
  const merged: ChordEvent[] = [];
  for (const c of out) {
    const p = merged[merged.length - 1];
    if (p && p.root === c.root && p.quality === c.quality && (p.bass ?? p.root) === (c.bass ?? c.root)) p.endSec = c.endSec;
    else merged.push(c);
  }
  return merged;
}
