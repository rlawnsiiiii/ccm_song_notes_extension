import { describe, expect, it } from "vitest";
import { buildStates, transitionBoosts, viterbi, keyPrior } from "../src/analysis/smoothing";
import { QUALITY_INTERVALS, mod12 } from "../src/music/theory";
import { normalize } from "../src/analysis/chroma";
import type { ChordQuality, KeyInfo } from "../src/shared/types";

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function noisyFrame(root: number, q: ChordQuality, noise: number) {
  const c = new Array<number>(12).fill(0);
  QUALITY_INTERVALS[q].forEach((iv) => (c[mod12(root + iv)] = 1));
  return { chroma: normalize(c.map((x) => x + noise * rnd())), bass: normalize(c.map((x, i) => (i === root ? 1 : 0.05 * rnd()))), energy: 0.05 };
}

describe("progression priors", () => {
  const key: KeyInfo = { tonic: 7, mode: "major", confidence: 0.9 };
  const prog: [number, ChordQuality][] = [[7, "maj"], [2, "maj"], [4, "min"], [0, "maj"], [7, "maj"], [2, "maj"], [0, "maj"], [0, "maj"]];
  const truth: number[] = [];
  const mk = (noise: number) => {
    seed = 7;
    const frames = [];
    truth.length = 0;
    for (let rep = 0; rep < 6; rep++) for (const [r, q] of prog) for (let i = 0; i < 12; i++) { frames.push(noisyFrame(r, q, noise)); truth.push(r * 100 + (q === "min" ? 1 : 0)); }
    return frames;
  };
  const accuracy = (priors: boolean, noise: number) => {
    const frames = mk(noise);
    const { states, path } = viterbi(frames, { key, priors });
    let ok = 0;
    path.forEach((si, t) => {
      const s = states[si]!;
      if (s.root !== null && s.root * 100 + (s.quality === "min" || s.quality === "m7" ? 1 : 0) === truth[t]) ok++;
    });
    return ok / path.length;
  };

  it("never hurts and helps on noisy input", () => {
    const noise = 1.1;
    const without = accuracy(false, noise);
    const withP = accuracy(true, noise);
    console.log(`noisy accuracy without priors ${without.toFixed(3)}, with ${withP.toFixed(3)}`);
    expect(withP).toBeGreaterThanOrEqual(without - 0.005);
    expect(withP).toBeGreaterThan(0.8);
  });

  it("uses the key to resolve power chords (no third) to the diatonic quality", () => {
    seed = 3;
    const power = (root: number) => {
      const c = new Array<number>(12).fill(0);
      c[root] = 1; c[mod12(root + 7)] = 0.9;
      return { chroma: normalize(c.map((x) => x + 0.08 * rnd())), bass: normalize(c.map((x, i) => (i === root ? 1 : 0))), energy: 0.05 };
    };
    const prog = [7, 2, 4, 0];
    const frames: ReturnType<typeof power>[] = [];
    const want: string[] = [];
    for (let rep = 0; rep < 8; rep++) for (const r of prog) for (let i = 0; i < 10; i++) { frames.push(power(r)); want.push(`${r}${r === 4 ? "m" : ""}`); }
    const score = (k: KeyInfo | null) => {
      const { states, path } = viterbi(frames, { key: k });
      let ok = 0;
      path.forEach((si, t) => { const st = states[si]!; if (st.root !== null && `${st.root}${st.quality === "min" || st.quality === "m7" ? "m" : ""}` === want[t]) ok++; });
      return ok / path.length;
    };
    const withKey = score(key), without = score(null);
    console.log(`power chords: with key ${withKey.toFixed(2)}, without ${without.toFixed(2)}`);
    expect(withKey).toBeGreaterThan(0.9);
    expect(withKey).toBeGreaterThan(without);
  });

  it("boosts the classic moves in the right key", () => {
    const states = buildStates();
    const b = transitionBoosts(states, key);
    const idx = (r: number, q: ChordQuality) => states.findIndex((s) => s.root === r && s.quality === q);
    const target = idx(4, "min"); // Em (6m in G)
    expect(b[target]!.some(([i]) => i === idx(2, "maj"))).toBe(true); // D → Em  (5 → 6m)
    expect(b[target]!.some(([i]) => i === idx(8, "maj"))).toBe(false);
  });

  it("prefers diatonic chord families", () => {
    expect(keyPrior({ root: 4, quality: "min" }, key)).toBeGreaterThan(keyPrior({ root: 4, quality: "maj" }, key));
    expect(keyPrior({ root: 7, quality: "maj" }, key)).toBeGreaterThan(keyPrior({ root: 6, quality: "maj" }, key));
  });
});
