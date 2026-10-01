import { ONSET_HOP_SEC } from "./onset";

export interface TempoEstimate {
  bpm: number;
  /** time of a beat (seconds, relative to the start of `env`) */
  offset: number;
  /** 0..1: how much better the winner is than the average candidate */
  confidence: number;
  /** other plausible readings (octave / triplet relatives), best first */
  alternatives: number[];
}

/** Gaussian bump on a log-tempo axis around the typical worship tempo. */
const prior = (bpm: number, centre = 95, sigmaOct = 0.7) => Math.exp(-0.5 * (Math.log2(bpm / centre) / sigmaOct) ** 2);

/**
 * Tempo from an onset-strength envelope (hop ONSET_HOP_SEC).
 * 1) autocorrelation → candidate periodicities,
 * 2) each candidate is scored by how well it explains the onsets at the beat AND its multiples/halves
 *    (enhanced autocorrelation) with a mild prior,
 * 3) the phase (beat offset) of the winner is found by a comb filter.
 */
export interface TempoOptions { minBpm?: number; maxBpm?: number; midWeight?: number; prior?: number; centre?: number; acfWeight?: number }

export function estimateTempo(env: Float32Array, hop = ONSET_HOP_SEC, opts: TempoOptions = {}): TempoEstimate | null {
  const minBpm = opts.minBpm ?? 55, maxBpm = opts.maxBpm ?? 180;
  // defaults chosen with scripts/tempo-sweep.mjs on synthetic songs (see docs/eval-log.md)
  const midW = opts.midWeight ?? 0.6, acfW = opts.acfWeight ?? 0;
  const sigmaOct = opts.prior ?? 1.0, centre = opts.centre ?? 100;
  const n = env.length;
  if (n * hop < 6) return null;
  // light smoothing (±2 hops) so slightly early/late onsets still count as hits
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0, w = 0;
    for (let d = -2; d <= 2; d++) { const j = i + d; if (j >= 0 && j < n) { const k = 3 - Math.abs(d); v += env[j]! * k; w += k; } }
    sm[i] = v / w;
  }
  const sample = (x: number) => { const i = Math.floor(x); if (i < 0 || i + 1 >= n) return 0; const f = x - i; return sm[i]! * (1 - f) + sm[i + 1]! * f; };
  // autocorrelation for the tie-break term
  const maxLag = Math.min(n - 1, Math.floor(60 / minBpm / hop) * 4 + 2);
  const acf = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag; l++) { let s = 0; for (let i = l; i < n; i++) s += env[i]! * env[i - l]!; acf[l] = s / (n - l); }
  const a0 = acf[0]! || 1;
  const acfAt = (lagSec: number) => { const x = lagSec / hop, i = Math.floor(x), f = x - i; return i < 1 || i + 1 > maxLag ? 0 : acf[i]! * (1 - f) + acf[i + 1]! * f; };

  const cands: { bpm: number; score: number; phase: number }[] = [];
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const Tn = 60 / bpm / hop; // period in hops (fractional)
    const beats = Math.floor((n - 2) / Tn);
    if (beats < 6) continue;
    let bestC = -Infinity, bestPhase = 0;
    const phases = Math.max(4, Math.round(Tn));
    for (let p = 0; p < phases; p++) {
      const ph = (p / phases) * Tn;
      let on = 0, mid = 0;
      for (let k = 0; k < beats; k++) { on += sample(ph + k * Tn); mid += sample(ph + (k + 0.5) * Tn); }
      const c = on / beats - midW * (mid / beats);
      if (c > bestC) { bestC = c; bestPhase = ph; }
    }
    const T = 60 / bpm;
    const reinforce = (acfAt(T) + 0.5 * acfAt(2 * T)) / a0;
    cands.push({ bpm, score: Math.max(0, bestC + acfW * reinforce * 0.2) * prior(bpm, centre, sigmaOct), phase: bestPhase * hop });
  }
  if (cands.length === 0) return null;
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const best = sorted[0]!;
  if (best.score <= 0) return null;
  const mean = cands.reduce((s, c) => s + c.score, 0) / cands.length;
  const alts: number[] = [];
  for (const c of sorted) {
    if (Math.abs(c.bpm - best.bpm) < best.bpm * 0.06) continue;
    if (alts.every((a) => Math.abs(a - c.bpm) > c.bpm * 0.06) && alts.length < 3) alts.push(c.bpm);
  }
  return { bpm: best.bpm, offset: best.phase, confidence: Math.min(1, Math.max(0, 1 - mean / best.score)), alternatives: alts };
}
