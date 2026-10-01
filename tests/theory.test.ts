import { describe, expect, it } from "vitest";
import { chordName, chordNumber, parseChord, prefersFlats, mod12 } from "../src/music/theory";

describe("theory", () => {
  it("spells by key", () => {
    expect(chordName({ root: 6, quality: "min" }, false)).toBe("F#m");
    expect(chordName({ root: 10, quality: "maj" }, true)).toBe("Bb");
    expect(prefersFlats(5, "major")).toBe(true);
    expect(prefersFlats(7, "major")).toBe(false);
  });
  it("transposes", () => {
    expect(chordName({ root: 7, quality: "maj", bass: 11 }, false, 2)).toBe("A/C#");
    expect(mod12(-1)).toBe(11);
  });
  it("numbers", () => {
    expect(chordNumber({ root: 2, quality: "maj", bass: 6 }, 7, "major")).toBe("5/7");
    expect(chordNumber({ root: 4, quality: "min" }, 7, "major")).toBe("6m");
    expect(chordNumber({ root: 9, quality: "min" }, 9, "minor")).toBe("6m");
  });
  it("parses", () => {
    expect(parseChord("D/F#")).toEqual({ root: 2, quality: "maj", bass: 6 });
    expect(parseChord("Bbm7")).toEqual({ root: 10, quality: "m7" });
    expect(parseChord("Gsus4")).toEqual({ root: 7, quality: "sus4" });
    expect(parseChord("N.C.")).toEqual({ root: null, quality: null });
    expect(parseChord("H")).toBeNull();
  });
});
