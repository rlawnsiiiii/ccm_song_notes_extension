import { describe, expect, it } from "vitest";
import { parseChordPro, parseKey, toChordPro } from "../src/music/chordpro";
import { scoreKey, sequenceSimilarity, triadEquals } from "../src/analysis/evaluate";
import { SongSession } from "../src/analysis/session";

const text = `
{title: 테스트}
{video: abc123}
{key: Em}
{section: 전주}
| G | D/F# | Em7 | C |
{section: 후렴}
[G]주를 [D]찬양 [C]해
`;

describe("chordpro", () => {
  it("parses reference charts", () => {
    const c = parseChordPro(text);
    expect(c.title).toBe("테스트");
    expect(c.key).toEqual({ tonic: 4, mode: "minor" });
    expect(c.sections.map((s) => [s.label, s.chords.length])).toEqual([["전주", 4], ["후렴", 3]]);
    expect(c.sections[0]!.chords[1]).toEqual({ root: 2, quality: "maj", bass: 6 });
  });
  it("parses keys", () => {
    expect(parseKey("F#m")).toEqual({ tonic: 6, mode: "minor" });
    expect(parseKey("Bb")).toEqual({ tonic: 10, mode: "major" });
  });
  it("scores keys", () => {
    expect(scoreKey({ tonic: 4, mode: "minor", confidence: 1 }, { tonic: 7, mode: "major" })).toBe("relative");
    expect(scoreKey({ tonic: 7, mode: "major", confidence: 1 }, { tonic: 7, mode: "major" })).toBe("exact");
  });
  it("similarity", () => {
    const a = parseChordPro("| G | D | Em | C |").sections[0]!.chords;
    const b = parseChordPro("| G | D | Em7 | C |").sections[0]!.chords;
    expect(sequenceSimilarity(a, a)).toBe(1);
    expect(sequenceSimilarity(a, b)).toBeCloseTo(0.75);
    expect(sequenceSimilarity(a, b, triadEquals)).toBe(1);
  });
  it("round-trips export", () => {
    const rec = SongSession.blank("v", "곡", 10);
    rec.key = { tonic: 7, mode: "major", confidence: 1 };
    rec.chords = parseChordPro("| G | D/F# | Em | C |").sections[0]!.chords.map((c, i) => ({ ...c, startSec: i, endSec: i + 1, confidence: 1, source: "user" as const }));
    const out = toChordPro(rec);
    expect(out).toContain("| G | D/F# | Em | C |");
    expect(out).toContain("{key: G}");
    expect(toChordPro(rec, { transpose: 2 })).toContain("| A | E/G# | F#m | D |");
  });
});
