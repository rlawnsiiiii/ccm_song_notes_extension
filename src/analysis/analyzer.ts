import type { ChordEvent, FeatureFrame, KeyInfo } from "../shared/types";
import { dominantBass, chordFromBass } from "./chords";
import { KeyAccumulator } from "./key";
import { viterbi } from "./smoothing";

export const ANALYZER_VERSION = "0.2.0";

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

/** Offline analysis of an ordered list of frames (also used by the live analyzer on a window). */
export function analyzeFrames(frames: FeatureFrame[], keyHint?: KeyInfo | null): AnalysisResult {
  if (frames.length === 0) return { key: null, chords: [] };
  const acc = new KeyAccumulator();
  for (const f of frames) acc.add(f.chroma, Math.min(1, f.energy * 20));
  const key = keyHint ?? acc.key();
  const { states, path, confidence } = viterbi(frames, { key });
  const chords: ChordEvent[] = [];
  const hop = frames.length > 1 ? (frames[frames.length - 1]!.t - frames[0]!.t) / (frames.length - 1) : 0.1;
  let start = 0;
  const flush = (end: number) => {
    const st = states[path[start]!]!;
    const slice = frames.slice(start, end);
    let conf = 0;
    for (let i = start; i < end; i++) conf += confidence[i]!;
    conf /= end - start;
    let bass;
    if (st.root !== null && st.quality !== null) {
      const avg = new Array<number>(12).fill(0);
      for (const f of slice) f.bass.forEach((v, i) => (avg[i]! += v));
      bass = chordFromBass(st.root, st.quality, dominantBass(avg.map((v) => v / slice.length)));
    }
    chords.push({
      startSec: Math.max(0, frames[start]!.t - hop / 2),
      endSec: frames[end - 1]!.t + hop / 2,
      root: st.root,
      quality: st.quality,
      ...(bass !== undefined ? { bass } : {}),
      confidence: conf,
      source: "detected",
    });
  };
  for (let i = 1; i < frames.length; i++) {
    if (path[i] !== path[i - 1]) { flush(i); start = i; }
  }
  flush(frames.length);
  return { key, chords };
}
