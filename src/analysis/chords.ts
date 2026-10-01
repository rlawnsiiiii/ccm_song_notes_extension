import type { ChordQuality, PitchClass } from "../shared/types";
import { QUALITY_INTERVALS, mod12 } from "../music/theory";

export interface ChordCandidate {
  root: PitchClass;
  quality: ChordQuality;
  score: number; // cosine similarity, 0..1
}

/** Qualities available for detection per phase. Triads first; extensions are penalised. */
export const DEFAULT_QUALITIES: ChordQuality[] = ["maj", "min", "7", "maj7", "m7", "sus4", "sus2", "add9"];

/** Penalty so a richer chord only wins when it explains the data clearly better. */
const COMPLEXITY_PENALTY: Record<ChordQuality, number> = {
  maj: 0, min: 0, "7": 0.05, maj7: 0.06, m7: 0.04, sus4: 0.05, sus2: 0.06, add9: 0.06, dim: 0.08, aug: 0.1,
};

/** Root gets weight 1.0, fifth 0.8, others 0.9 — roots and thirds define quality. */
function template(root: number, q: ChordQuality): number[] {
  const t = new Array<number>(12).fill(0);
  QUALITY_INTERVALS[q].forEach((iv, i) => {
    t[mod12(root + iv)] = i === 0 ? 1.0 : iv === 7 ? 0.8 : 0.9;
  });
  let n = 0;
  for (const x of t) n += x * x;
  n = Math.sqrt(n);
  return t.map((x) => x / n);
}

const templateCache = new Map<string, number[]>();
function tpl(root: number, q: ChordQuality): number[] {
  const key = `${root}:${q}`;
  let t = templateCache.get(key);
  if (!t) { t = template(root, q); templateCache.set(key, t); }
  return t;
}

export function scoreChords(
  chroma: number[],
  bass: number[] | undefined,
  qualities: ChordQuality[] = DEFAULT_QUALITIES,
): ChordCandidate[] {
  const out: ChordCandidate[] = [];
  for (let root = 0; root < 12; root++) {
    for (const q of qualities) {
      const t = tpl(root, q);
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += t[i]! * chroma[i]!;
      let score = dot - COMPLEXITY_PENALTY[q];
      if (bass) score += 0.04 * (bass[root]! > 0.5 ? bass[root]! : 0);
      out.push({ root: root as PitchClass, quality: q, score: Math.max(0, score) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** The strongest bass pitch class, if it is clearly dominant. */
export function dominantBass(bass: number[]): PitchClass | undefined {
  let best = -1, bi = 0, second = 0;
  for (let i = 0; i < 12; i++) {
    const v = bass[i]!;
    if (v > best) { second = best; best = v; bi = i; }
    else if (v > second) second = v;
  }
  if (best < 0.5 || best < second * 1.3) return undefined;
  return bi as PitchClass;
}

export function chordFromBass(
  root: PitchClass,
  quality: ChordQuality,
  bassPc: PitchClass | undefined,
): PitchClass | undefined {
  if (bassPc === undefined || bassPc === root) return undefined;
  const ivs = QUALITY_INTERVALS[quality].map((iv) => mod12(root + iv));
  return ivs.includes(bassPc) ? bassPc : undefined;
}
