import { ChromaExtractor } from "../src/analysis/chroma";
import type { FeatureFrame, PitchClass } from "../src/shared/types";
import { QUALITY_INTERVALS } from "../src/music/theory";
import type { ChordQuality } from "../src/shared/types";

export const SR = 44100;

export function chordSamples(root: number, q: ChordQuality, bass: number, n: number, offset = 0): Float32Array {
  const out = new Float32Array(n);
  const notes = QUALITY_INTERVALS[q].map((iv) => 60 + ((root + iv) % 12)); // around C4..
  const freq = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const bassMidi = 36 + (bass % 12); // C2..B2
  for (let i = 0; i < n; i++) {
    const t = (i + offset) / SR;
    let s = 0;
    for (const m of notes) for (let h = 1; h <= 4; h++) s += Math.sin(2 * Math.PI * freq(m) * h * t) / h;
    for (let h = 1; h <= 3; h++) s += (1.5 * Math.sin(2 * Math.PI * freq(bassMidi) * h * t)) / h;
    out[i] = s * 0.05;
  }
  return out;
}

/** Frames for a progression: [root, quality, bass?, seconds]. */
export function progressionFrames(
  prog: [number, ChordQuality, number | undefined, number][],
  hopSec = 0.1,
): FeatureFrame[] {
  const ex = new ChromaExtractor({ sampleRate: SR });
  const frames: FeatureFrame[] = [];
  let t0 = 0;
  for (const [root, q, bass, dur] of prog) {
    const steps = Math.round(dur / hopSec);
    for (let i = 0; i < steps; i++) {
      const t = t0 + i * hopSec;
      const buf = chordSamples(root, q, bass ?? root, ex.frameSize, Math.round(t * SR));
      frames.push(ex.extract(buf, t + ex.frameSize / SR / 2));
    }
    t0 += dur;
  }
  return frames;
}
export type { PitchClass };
