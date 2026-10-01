import { describe, expect, it } from "vitest";
import { contiToChordPro, moveItem, songSheet, transposeFor } from "../src/music/conti";
import { parseChordPro } from "../src/music/chordpro";
import { SongSession } from "../src/analysis/session";
import type { Conti, ContiItem, SongRecord } from "../src/shared/types";

function rec(): SongRecord {
  const r = SongSession.blank("vid1", "[팀] 곡명 | Official", 100);
  r.key = { tonic: 7, mode: "major", confidence: 1 };
  r.tempoBpm = 120;
  r.beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
  r.downbeat = 0; r.beatsPerBar = 4;
  const prog = parseChordPro("| G | D/F# | Em | C | G | D | C | C |").sections[0]!.chords;
  r.chords = prog.map((c, i) => ({ ...c, startSec: i * 2, endSec: i * 2 + 2, confidence: 1, source: "detected" as const }));
  r.sections = [
    { startSec: 0, endSec: 8, group: "A", label: "절", source: "user" },
    { startSec: 8, endSec: 16, group: "B", label: "후렴", source: "user" },
  ];
  return r;
}
const item = (over: Partial<ContiItem> = {}): ContiItem => ({ videoId: "vid1", targetKey: null, notes: "", ...over });

describe("conti", () => {
  it("picks the nearest transposition", () => {
    const r = rec();
    expect(transposeFor(item(), r)).toBe(0);
    expect(transposeFor(item({ targetKey: { tonic: 9, mode: "major" } }), r)).toBe(2); // G → A
    expect(transposeFor(item({ targetKey: { tonic: 2, mode: "major" } }), r)).toBe(-5); // G → D
    expect(transposeFor(item({ targetKey: { tonic: 1, mode: "major" } }), r)).toBe(6);
  });
  it("builds a transposed sheet by sections and bars", () => {
    const sh = songSheet(rec(), item({ targetKey: { tonic: 9, mode: "major" }, notes: "후렴 2번 반복" }), false);
    expect(sh.key).toBe("A");
    expect(sh.title).toBe("곡명");
    expect(sh.notes).toBe("후렴 2번 반복");
    expect(sh.sections.map((s) => s.label)).toEqual(["절", "후렴"]);
    expect(sh.sections[0]!.bars.flat()).toEqual(["A", "E/G#", "F#m", "D"]);
  });
  it("numbers-only sheet", () => {
    const sh = songSheet(rec(), item(), true);
    expect(sh.sections[0]!.bars.flat()).toEqual(["1", "5/7", "6m", "4"]);
  });
  it("exports ChordPro for the whole conti", () => {
    const c: Conti = { id: "x", name: "주일예배", date: "2026-10-04", numbers: false, updatedAt: "", items: [item({ targetKey: { tonic: 9, mode: "major" }, notes: "간주 생략" })] };
    const txt = contiToChordPro(c, new Map([["vid1", rec()]]));
    expect(txt).toContain("주일예배");
    expect(txt).toContain("{key: A}");
    expect(txt).toContain("{comment: 간주 생략}");
    expect(txt).toContain("{new_song}");
    expect(txt).toContain("| A | E/G# | F#m | D |");
    expect(contiToChordPro({ ...c, numbers: true }, new Map([["vid1", rec()]]))).toContain("| 1 | 5/7 | 6m | 4 |");
  });
  it("reorders", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
