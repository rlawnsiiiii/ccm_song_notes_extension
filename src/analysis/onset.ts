import { FFT } from "./fft";

/**
 * Onset strength from short spectral windows: log-compressed band energies, half-wave rectified
 * difference to the previous window (spectral flux). Much finer in time than chroma frames, so
 * strums, hi-hats and piano attacks show up as sharp peaks.
 */
export const ONSET_WIN = 1024;
export const ONSET_HOP_SEC = 0.025;

const BANDS = 28;

export class OnsetExtractor {
  private fft = new FFT(ONSET_WIN);
  private win = new Float32Array(ONSET_WIN);
  private re = new Float32Array(ONSET_WIN);
  private im = new Float32Array(ONSET_WIN);
  private prev = new Float32Array(BANDS);
  private edges: number[];
  private hasPrev = false;

  constructor(readonly sampleRate: number) {
    for (let i = 0; i < ONSET_WIN; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (ONSET_WIN - 1));
    // log-spaced bands 60 Hz .. 10 kHz as FFT bin edges
    const lo = 60, hi = Math.min(10000, sampleRate / 2 - 100);
    this.edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round(((lo * (hi / lo) ** (i / BANDS)) / sampleRate) * ONSET_WIN));
    for (let i = 1; i < this.edges.length; i++) if (this.edges[i]! <= this.edges[i - 1]!) this.edges[i] = this.edges[i - 1]! + 1;
  }

  reset(): void { this.hasPrev = false; }

  /** `samples` is the most recent ONSET_WIN samples. Returns the flux for this window. */
  push(samples: Float32Array): number {
    for (let i = 0; i < ONSET_WIN; i++) { this.re[i] = samples[i]! * this.win[i]!; this.im[i] = 0; }
    this.fft.transform(this.re, this.im);
    let flux = 0;
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      for (let k = this.edges[b]!; k < this.edges[b + 1]!; k++) e += this.re[k]! * this.re[k]! + this.im[k]! * this.im[k]!;
      const v = Math.log1p(1000 * Math.sqrt(e));
      if (this.hasPrev) { const d = v - this.prev[b]!; if (d > 0) flux += d; }
      this.prev[b] = v;
    }
    this.hasPrev = true;
    return flux;
  }
}

/** Removes the slowly varying level so that peaks are comparable across the song. */
export function normalizeOnsets(env: Float32Array, hopSec = ONSET_HOP_SEC): Float32Array {
  const w = Math.max(3, Math.round(1.0 / hopSec));
  const out = new Float32Array(env.length);
  let sum = 0;
  const q: number[] = [];
  for (let i = 0; i < env.length; i++) {
    q.push(env[i]!); sum += env[i]!;
    if (q.length > 2 * w) sum -= q.shift()!;
    const mean = sum / q.length;
    out[i] = Math.max(0, env[i]! - mean * 1.0);
  }
  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / max;
  return out;
}
