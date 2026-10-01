import type { KeyInfo, Mode, PitchClass } from "../shared/types";

// Krumhansl-Kessler profiles (a worship-friendly alternative can be swapped in later).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma, y = b[i]! - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export interface KeyScore { tonic: PitchClass; mode: Mode; score: number }

export function scoreKeys(chroma: number[]): KeyScore[] {
  const out: KeyScore[] = [];
  for (let t = 0; t < 12; t++) {
    for (const mode of ["major", "minor"] as Mode[]) {
      const prof = mode === "major" ? MAJOR : MINOR;
      const rotated = chroma.map((_, i) => prof[(i - t + 12) % 12]!);
      out.push({ tonic: t as PitchClass, mode, score: corr(chroma, rotated) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function detectKey(chroma: number[]): KeyInfo {
  const s = scoreKeys(chroma);
  const best = s[0]!, second = s.find((k) => !isRelative(best, k) && k !== best) ?? s[1]!;
  // confidence from margin over the best non-relative alternative
  const margin = best.score - second.score;
  const confidence = Math.max(0, Math.min(0.99, 0.5 * best.score + margin * 3));
  return { tonic: best.tonic, mode: best.mode, confidence };
}

function isRelative(a: KeyScore, b: KeyScore): boolean {
  if (a.mode === b.mode) return false;
  const major = a.mode === "major" ? a : b;
  const minor = a.mode === "major" ? b : a;
  return (major.tonic + 9) % 12 === minor.tonic;
}

/** Sum of chroma (energy-weighted) → key; used by the live analyzer. */
export class KeyAccumulator {
  private sum = new Array<number>(12).fill(0);
  add(chroma: number[], weight = 1): void {
    for (let i = 0; i < 12; i++) this.sum[i]! += chroma[i]! * weight;
  }
  get total(): number { return this.sum.reduce((s, x) => s + x, 0); }
  key(): KeyInfo | null {
    if (this.total <= 0) return null;
    return detectKey(this.sum);
  }
  reset(): void { this.sum.fill(0); }
}
