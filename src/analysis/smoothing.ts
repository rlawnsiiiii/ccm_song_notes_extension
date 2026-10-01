import type { ChordQuality, KeyInfo, PitchClass } from "../shared/types";
import { mod12 } from "../music/theory";
import { DEFAULT_QUALITIES, scoreChords } from "./chords";

/** A Viterbi state: a chord, or "no chord" (index 0). */
export interface State { root: PitchClass | null; quality: ChordQuality | null }

export function buildStates(qualities: ChordQuality[] = DEFAULT_QUALITIES): State[] {
  const states: State[] = [{ root: null, quality: null }];
  for (let r = 0; r < 12; r++) for (const q of qualities) states.push({ root: r as PitchClass, quality: q });
  return states;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** How plausible a chord is in the key, as a log-prior (0 = neutral). */
export function keyPrior(s: State, key: KeyInfo | null): number {
  if (s.root === null || key === null) return 0;
  const scale = (key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE).map((d) => mod12(key.tonic + d));
  const inScale = scale.includes(s.root);
  let p = inScale ? 0.15 : -0.35;
  // primary chords are most likely
  const deg = mod12(s.root - key.tonic);
  if (inScale && (deg === 0 || deg === 5 || deg === 7)) p += 0.1;
  return p;
}

export interface ViterbiOptions {
  states?: State[];
  stay?: number; // probability of staying on the same chord per frame
  beta?: number; // sharpness of emission
  key?: KeyInfo | null;
  noChordEnergy?: number;
}

export interface FrameObs { chroma: number[]; bass?: number[]; energy: number }

/**
 * Returns the best state index sequence for the observations.
 * Emission: softmax-ish exp(beta * score); a silent frame forces "no chord".
 */
export function viterbi(obs: FrameObs[], opts: ViterbiOptions = {}): { states: State[]; path: number[]; confidence: number[] } {
  const states = opts.states ?? buildStates();
  const S = states.length;
  const stay = opts.stay ?? 0.9;
  const beta = opts.beta ?? 12;
  const logStay = Math.log(stay);
  const logSwitch = Math.log((1 - stay) / (S - 1));
  const priors = states.map((s) => keyPrior(s, opts.key ?? null));
  const silence = opts.noChordEnergy ?? 0.003;
  const qualities = Array.from(new Set(states.filter((s) => s.quality).map((s) => s.quality!))) as ChordQuality[];

  const T = obs.length;
  const delta = new Float64Array(S);
  const next = new Float64Array(S);
  const back: Int16Array[] = [];
  const emis: Float64Array[] = [];

  for (let t = 0; t < T; t++) {
    const o = obs[t]!;
    const e = new Float64Array(S);
    if (o.energy < silence) {
      e.fill(-8); e[0] = 0;
    } else {
      const scores = scoreChords(o.chroma, o.bass, qualities);
      const lookup = new Map<string, number>();
      for (const c of scores) lookup.set(`${c.root}:${c.quality}`, c.score);
      for (let i = 1; i < S; i++) {
        const st = states[i]!;
        e[i] = beta * (lookup.get(`${st.root}:${st.quality}`) ?? 0) + priors[i]!;
      }
      e[0] = beta * 0.35; // "no chord" baseline
    }
    emis.push(e);
  }

  for (let i = 0; i < S; i++) delta[i] = emis[0] ? emis[0][i]! : 0;
  for (let t = 1; t < T; t++) {
    const bp = new Int16Array(S);
    // best previous state overall (for switch transitions)
    let bestPrev = 0, bestVal = -Infinity;
    for (let i = 0; i < S; i++) if (delta[i]! > bestVal) { bestVal = delta[i]!; bestPrev = i; }
    for (let j = 0; j < S; j++) {
      const stayVal = delta[j]! + logStay;
      const switchVal = bestVal + logSwitch;
      if (stayVal >= switchVal || bestPrev === j) { next[j] = stayVal; bp[j] = j; }
      else { next[j] = switchVal; bp[j] = bestPrev; }
      next[j]! += emis[t]![j]!;
    }
    back.push(bp);
    delta.set(next);
  }
  const path = new Array<number>(T);
  let cur = 0, best = -Infinity;
  for (let i = 0; i < S; i++) if (delta[i]! > best) { best = delta[i]!; cur = i; }
  for (let t = T - 1; t >= 0; t--) {
    path[t] = cur;
    if (t > 0) cur = back[t - 1]![cur]!;
  }
  // confidence: the raw template score of the chosen chord, clamped
  const confidence = path.map((si, t) => {
    const st = states[si]!;
    if (st.root === null) return obs[t]!.energy < silence ? 1 : 0.3;
    const sc = scoreChords(obs[t]!.chroma, obs[t]!.bass, qualities).find((c) => c.root === st.root && c.quality === st.quality);
    return Math.max(0, Math.min(1, sc?.score ?? 0));
  });
  return { states, path, confidence };
}
