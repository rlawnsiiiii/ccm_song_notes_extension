import { describe, expect, it } from "vitest";
import { chordIndexAt, mergeChords, nextDifferent } from "../src/analysis/merge";
import type { ChordEvent } from "../src/shared/types";

const ev = (s: number, e: number, root: number, source: ChordEvent["source"] = "detected"): ChordEvent =>
  ({ startSec: s, endSec: e, root: root as any, quality: "maj", confidence: 0.8, source });

describe("mergeChords", () => {
  it("keeps user edits and clips detected events around them", () => {
    const existing = [ev(2, 4, 5, "user")];
    const detected = [ev(0, 6, 7)];
    const m = mergeChords(existing, detected);
    expect(m.map((c) => [c.startSec, c.endSec, c.root, c.source])).toEqual([
      [0, 2, 7, "detected"], [2, 4, 5, "user"], [4, 6, 7, "detected"],
    ]);
  });
  it("replaces old detected events", () => {
    expect(mergeChords([ev(0, 2, 1)], [ev(0, 2, 3)]).map((c) => c.root)).toEqual([3]);
  });
});

describe("lookup", () => {
  const cs = [ev(0, 2, 0), ev(2, 4, 0), ev(4, 6, 7)];
  it("finds current and next", () => {
    expect(chordIndexAt(cs, 3)).toBe(1);
    expect(chordIndexAt(cs, 100)).toBe(-1);
    expect(nextDifferent(cs, 0)).toBe(2);
  });
});
