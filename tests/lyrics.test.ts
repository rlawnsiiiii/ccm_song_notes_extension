import { describe, expect, it } from "vitest";
import { parseJson3, placeChords, textSimilarity } from "../src/music/lyrics";
import type { ChordEvent } from "../src/shared/types";

const ev = (s: number, e: number, root: number): ChordEvent => ({ startSec: s, endSec: e, root: root as any, quality: "maj", confidence: 1, source: "detected" });

describe("lyrics", () => {
  it("parses json3 and skips sound annotations", () => {
    const lines = parseJson3({ events: [
      { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: "주를 " }, { utf8: "찬양해" }] },
      { tStartMs: 4000, dDurationMs: 500, segs: [{ utf8: "[음악]" }] },
      { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: "\n" }] },
      { tStartMs: 6000, dDurationMs: 4000, segs: [{ utf8: "영원히" }] },
    ] });
    expect(lines).toEqual([{ startSec: 1, endSec: 4, text: "주를 찬양해" }, { startSec: 6, endSec: 10, text: "영원히" }]);
  });
  it("places chords proportionally without overlaps", () => {
    const line = { startSec: 10, endSec: 14, text: "주를 찬양하며 노래해" };
    const chords = [ev(10, 12, 7), ev(12, 13, 2), ev(13, 14, 4)];
    const placed = placeChords(line, chords);
    expect(placed.map((p) => p.eventIndex)).toEqual([0, 1, 2]);
    expect(placed[0]!.col).toBe(0);
    expect(placed[1]!.col).toBeGreaterThan(placed[0]!.col);
    expect(placed[2]!.col).toBeGreaterThan(placed[1]!.col);
    expect(placeChords(line, chords, { 1: 2 })[1]!.col).toBe(placed[1]!.col + 2);
  });
  it("scores repeated lines as similar", () => {
    expect(textSimilarity("주님을 찬양해 영원히", "주님을 찬양해 영원히!")).toBeGreaterThan(0.9);
    expect(textSimilarity("주님을 찬양해", "바람이 불어오네")).toBeLessThan(0.2);
  });
});
