import type { FeatureFrame } from "../shared/types";
import { FFT } from "./fft";

export const FRAME_SIZE = 8192;
export const FEATURE_VERSION = "chroma-1";

export interface ChromaOptions {
  sampleRate: number;
  frameSize?: number;
}

/**
 * Turns blocks of mono PCM into chroma vectors. Spectral peaks (with parabolic
 * interpolation) are assigned to the nearest semitone, weighted by how close
 * they are to it, so slightly detuned recordings still work.
 */
export class ChromaExtractor {
  readonly frameSize: number;
  readonly sampleRate: number;
  private fft: FFT;
  private window: Float32Array;
  private re: Float32Array;
  private im: Float32Array;
  private mag: Float32Array;

  constructor(opts: ChromaOptions) {
    this.frameSize = opts.frameSize ?? FRAME_SIZE;
    this.sampleRate = opts.sampleRate;
    this.fft = new FFT(this.frameSize);
    this.window = new Float32Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.frameSize - 1));
    }
    this.re = new Float32Array(this.frameSize);
    this.im = new Float32Array(this.frameSize);
    this.mag = new Float32Array(this.frameSize / 2);
  }

  /** `samples.length` must equal frameSize. `t` is the time of the frame centre. */
  extract(samples: Float32Array, t: number): FeatureFrame {
    const n = this.frameSize;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i]!;
      sumSq += s * s;
      this.re[i] = s * this.window[i]!;
      this.im[i] = 0;
    }
    const energy = Math.sqrt(sumSq / n);
    this.fft.transform(this.re, this.im);
    const half = n / 2;
    for (let k = 0; k < half; k++) this.mag[k] = Math.hypot(this.re[k]!, this.im[k]!);

    const chroma = new Array<number>(12).fill(0);
    const bass = new Array<number>(12).fill(0);
    const binHz = this.sampleRate / n;
    const kMin = Math.max(2, Math.floor(50 / binHz));
    const kMax = Math.min(half - 2, Math.floor(4000 / binHz));

    // noise floor: median-ish via mean of the range
    let mean = 0;
    for (let k = kMin; k <= kMax; k++) mean += this.mag[k]!;
    mean /= Math.max(1, kMax - kMin + 1);
    const thresh = mean * 1.5;

    for (let k = kMin; k <= kMax; k++) {
      const m = this.mag[k]!;
      if (m <= thresh || m < this.mag[k - 1]! || m <= this.mag[k + 1]!) continue;
      const a = Math.log(this.mag[k - 1]! + 1e-9);
      const b = Math.log(m + 1e-9);
      const c = Math.log(this.mag[k + 1]! + 1e-9);
      const denom = a - 2 * b + c;
      const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const freq = (k + delta) * binHz;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const nearest = Math.round(midi);
      const cents = Math.abs(midi - nearest);
      if (cents > 0.4) continue;
      const w = Math.cos((cents / 0.4) * (Math.PI / 2)) ** 2;
      const amp = Math.sqrt(m) * w;
      const pc = ((nearest % 12) + 12) % 12;
      if (freq >= 70) chroma[pc]! += amp * (freq > 1500 ? 0.5 : 1);
      if (freq <= 300) bass[pc]! += amp;
    }
    return { t, chroma: normalize(chroma), bass: normalize(bass), energy };
  }
}

export function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n < 1e-9) return v.map(() => 0);
  return v.map((x) => x / n);
}
