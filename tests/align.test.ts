import { describe, expect, it } from "vitest";
import { alignChart, alignSequences } from "../src/analysis/align";
import { expandChart, parseChordPro } from "../src/music/chordpro";
import type { ChordEvent } from "../src/shared/types";

const ev = (s: number, e: number, root: number, quality: any = "maj", bass?: number): ChordEvent =>
  ({ startSec: s, endSec: e, root: root as any, quality, ...(bass !== undefined ? { bass: bass as any } : {}), confidence: 0.6, source: "detected" });

describe("alignment", () => {
  const chart = parseChordPro(`{key: G}
{section: 전주}
| G | D/F# | Em7 | C |
{section: 후렴}
| G | D | Em | C |`);

  it("fixes quality errors and keeps the audio timing", () => {
    // detected: D/F# heard as F#m, Em7 heard as G, an extra passing chord, timings 2 s per chord
    const det = [ev(0, 2, 7), ev(2, 4, 6, "min"), ev(4, 6, 7), ev(6, 8, 0), ev(8, 10, 7), ev(10, 12, 2), ev(12, 14, 4, "min"), ev(14, 16, 0)];
    const r = alignChart(chart, det)!;
    expect(r).not.toBeNull();
    expect(r.chords.map((c) => `${c.root}${c.quality}${c.bass ?? ""}`)).toEqual(["7maj", "2maj6", "4m7", "0maj", "7maj", "2maj", "4min", "0maj"]);
    expect(r.chords[1]!.startSec).toBe(2);
    expect(r.chords[4]!.startSec).toBe(8);
    expect(r.chords.every((c) => c.source === "imported")).toBe(true);
    expect(r.sections.map((s) => [s.label, s.startSec, s.endSec])).toEqual([["전주", 0, 8], ["후렴", 8, 16]]);
  });

  it("interpolates chords the detector missed", () => {
    const det = [ev(0, 2, 7), ev(2, 6, 2), ev(6, 8, 0), ev(8, 12, 7), ev(12, 16, 0)]; // Em chords never detected
    const r = alignChart(chart, det)!;
    expect(r.chords.length).toBe(8);
    const t = r.chords.map((c) => c.startSec);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
  });

  it("rejects a chart that does not match the song", () => {
    const other = parseChordPro("| F# | B | C# | G#m |");
    expect(alignChart(other, [ev(0, 2, 7), ev(2, 4, 2), ev(4, 6, 4, "min"), ev(6, 8, 0)])).toBeNull();
  });

  it("expands {order:} so repeated sections line up with the song", () => {
    const c = parseChordPro(`{order: 전주 후렴 후렴}
{section: 전주}
| G | D |
{section: 후렴}
| C | G |`);
    expect(expandChart(c).map((s) => s.label)).toEqual(["전주", "후렴", "후렴"]);
    const det = [ev(0, 2, 7), ev(2, 4, 2), ev(4, 6, 0), ev(6, 8, 7), ev(8, 10, 0), ev(10, 12, 7)];
    const r = alignChart(c, det)!;
    expect(r.chords.length).toBe(6);
    expect(r.sections.map((s) => s.label)).toEqual(["전주", "후렴", "후렴"]);
  });

  it("alignSequences gives -1 for unmatched", () => {
    const a = parseChordPro("| G | D | Em |").sections[0]!.chords;
    const b = parseChordPro("| G | Em |").sections[0]!.chords;
    expect(alignSequences(a, b)).toEqual([0, -1, 1]);
  });
});
