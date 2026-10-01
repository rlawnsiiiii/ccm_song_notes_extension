import type { ChordQuality, KeyInfo, PitchClass } from "../shared/types";
import { mod12 } from "../music/theory";
import { DEFAULT_QUALITIES, scoreOne } from "./chords";

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
  // numbers are relative to the relative major (like the sidebar's number display)
  const ref = key.mode === "major" ? key.tonic : mod12(key.tonic + 3);
  const deg = mod12(s.root - ref);
  if (inScale && (deg === 0 || deg === 5 || deg === 7)) p += 0.1;
  const expected = DIATONIC_MINOR_DEGREES.has(deg) ? "min" : "maj";
  if (inScale && s.quality) p += familyOf(s.quality) === expected ? 0.12 : -0.1;
  return p;
}

const DIATONIC_MINOR_DEGREES = new Set([2, 4, 9]); // 2m 3m 6m (7 is dim, rare in worship)
const familyOf = (q: ChordQuality): "maj" | "min" => (q === "min" || q === "m7" || q === "dim" ? "min" : "maj");

// ---- transition priors (worship progressions, written as degrees of the major key) ----

/** [from, to, weight]: semitone degrees above the (relative) major tonic. */
const MOVES: [number, number, number][] = [
  [0, 7, 4], [7, 9, 4], [9, 5, 4], [5, 0, 4], [5, 7, 4], [7, 0, 4], [2, 7, 4], [0, 5, 4], // 1-5-6m-4, 4-5, 5-1, 2m-5
  [4, 9, 3], [7, 5, 3], [0, 9, 3], [9, 7, 3], [5, 9, 3], [9, 2, 3], [2, 5, 3], [0, 2, 3], // 3m-6m, 6m-2m, 2m-4 …
  [4, 5, 3], [0, 4, 3], [9, 4, 3], [7, 2, 2], [5, 4, 2],
];

/** Same-root quality changes that are idiomatic: sus resolves, add9/maj flip, m7/min flip. */
const QUALITY_MOVES = new Set([
  "sus4>maj", "sus4>7", "maj>sus4", "sus2>maj", "maj>sus2", "add9>maj", "maj>add9", "m7>min", "min>m7", "7>maj", "maj>7",
]);

/**
 * For each target state j, the list of [i, logBoost] predecessors that get a bonus on top of
 * the uniform switch cost. Sparse so that Viterbi stays cheap.
 */
export function transitionBoosts(states: State[], key: KeyInfo | null): [number, number][][] {
  const boosts: [number, number][][] = states.map(() => []);
  const ref = key ? (key.mode === "major" ? key.tonic : mod12(key.tonic + 3)) : null;
  for (let j = 1; j < states.length; j++) {
    const to = states[j]!;
    for (let i = 1; i < states.length; i++) {
      if (i === j) continue;
      const from = states[i]!;
      if (from.root === null || to.root === null) continue;
      if (from.root === to.root) {
        if (from.quality && to.quality && QUALITY_MOVES.has(`${from.quality}>${to.quality}`)) boosts[j]!.push([i, Math.log(3)]);
        continue;
      }
      if (ref === null) continue;
      const a = mod12(from.root - ref), b = mod12(to.root - ref);
      const m = MOVES.find(([x, y]) => x === a && y === b);
      if (m && qualityPlausible(from.quality, to.quality)) boosts[j]!.push([i, Math.log(m[2])]);
    }
  }
  return boosts;
}

/** Numeric moves are written for plain chords; allow colour tones but not odd qualities. */
function qualityPlausible(a: ChordQuality | null, b: ChordQuality | null): boolean {
  const ok = (q: ChordQuality | null) => q !== null && q !== "dim" && q !== "aug";
  return ok(a) && ok(b);
}

export interface ViterbiOptions {
  states?: State[];
  stay?: number; // probability of staying on the same chord per frame
  beta?: number; // sharpness of emission
  key?: KeyInfo | null;
  noChordEnergy?: number;
  /** set false to disable the progression priors (for A/B evaluation) */
  priors?: boolean;
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
  const boosts = opts.priors === false ? states.map(() => [] as [number, number][]) : transitionBoosts(states, opts.key ?? null);
  const silence = opts.noChordEnergy ?? 0.003;

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
      for (let i = 1; i < S; i++) {
        const st = states[i]!;
        e[i] = beta * scoreOne(st.root!, st.quality!, o.chroma, o.bass) + priors[i]!;
      }
      e[0] = beta * 0.2; // "no chord" baseline: only wins when nothing fits
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
      let switchVal = bestPrev === j ? -Infinity : bestVal + logSwitch;
      let from = bestPrev;
      for (const [i, boost] of boosts[j]!) {
        const v = delta[i]! + logSwitch + boost;
        if (v > switchVal) { switchVal = v; from = i; }
      }
      if (stayVal >= switchVal) { next[j] = stayVal; bp[j] = j; }
      else { next[j] = switchVal; bp[j] = from; }
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
    return Math.max(0, Math.min(1, scoreOne(st.root, st.quality!, obs[t]!.chroma, obs[t]!.bass)));
  });
  return { states, path, confidence };
}
