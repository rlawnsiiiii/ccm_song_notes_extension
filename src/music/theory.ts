import type { ChordQuality, Mode, PitchClass } from "../shared/types";

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const mod12 = (n: number): PitchClass => (((n % 12) + 12) % 12) as PitchClass;

/** Major keys that are conventionally written with flats. */
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db
/** Minor keys written with flats: Dm Gm Cm Fm Bbm. */
const FLAT_MINOR_TONICS = new Set([2, 7, 0, 5, 10]);

export function prefersFlats(tonic: PitchClass, mode: Mode): boolean {
  return mode === "major" ? FLAT_MAJOR_TONICS.has(tonic) : FLAT_MINOR_TONICS.has(tonic);
}

export function noteName(pc: number, flats: boolean): string {
  return (flats ? FLAT : SHARP)[mod12(pc)]!;
}

export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "", min: "m", "7": "7", maj7: "maj7", m7: "m7",
  sus4: "sus4", sus2: "sus2", add9: "add9", dim: "dim", aug: "aug",
};

export interface ChordSym {
  root: PitchClass | null;
  quality: ChordQuality | null;
  bass?: PitchClass;
}

export function chordName(c: ChordSym, flats: boolean, transpose = 0): string {
  if (c.root === null || c.quality === null) return "N.C.";
  const root = mod12(c.root + transpose);
  let s = noteName(root, flats) + QUALITY_SUFFIX[c.quality];
  if (c.bass !== undefined && c.bass !== c.root) s += "/" + noteName(c.bass + transpose, flats);
  return s;
}

const MAJOR_DEGREES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

function degreeName(interval: number): string {
  return MAJOR_DEGREES[mod12(interval)]!;
}

/**
 * Nashville-style number: degree relative to the tonic of the key.
 * In a minor key the numbers are still relative to the *tonic* of that key
 * (so Am in A minor is "1m"); worship teams usually think relative-major,
 * so for minor keys we offset to the relative major (Am key: Am = 6m).
 */
export function chordNumber(c: ChordSym, tonic: PitchClass, mode: Mode): string {
  if (c.root === null || c.quality === null) return "N.C.";
  const ref = mode === "major" ? tonic : mod12(tonic + 3);
  let s = degreeName(c.root - ref) + QUALITY_SUFFIX[c.quality];
  if (c.bass !== undefined && c.bass !== c.root) s += "/" + degreeName(c.bass - ref);
  return s;
}

/** Interval pattern (semitones from root) per quality. */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  add9: [0, 2, 4, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

/** Reduce to a triad-ish chord for the "simplify" toggle. */
export function simplifyQuality(q: ChordQuality): ChordQuality {
  switch (q) {
    case "7": case "maj7": case "add9": case "sus2": case "sus4": return "maj";
    case "m7": return "min";
    default: return q;
  }
}

const NOTE_RE = /^([A-G])([#b]?)/;
export function parseNote(s: string): PitchClass | null {
  const m = NOTE_RE.exec(s);
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1]!]!;
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  return mod12(pc);
}

const SUFFIX_TO_QUALITY: [string, ChordQuality][] = [
  ["maj7", "maj7"], ["M7", "maj7"], ["m7", "m7"], ["min7", "m7"],
  ["add9", "add9"], ["sus4", "sus4"], ["sus2", "sus2"], ["sus", "sus4"],
  ["dim", "dim"], ["aug", "aug"], ["min", "min"], ["m", "min"], ["7", "7"], ["", "maj"],
];

/** Parse a chord symbol such as "D/F#", "Bm7", "Gsus4". Returns null if unparseable. */
export function parseChord(sym: string): ChordSym | null {
  const t = sym.trim();
  if (/^(N\.?C\.?)$/i.test(t)) return { root: null, quality: null };
  const root = parseNote(t);
  if (root === null) return null;
  const rootLen = NOTE_RE.exec(t)![0].length;
  let rest = t.slice(rootLen);
  let bass: PitchClass | undefined;
  const slash = rest.indexOf("/");
  if (slash >= 0) {
    const b = parseNote(rest.slice(slash + 1));
    if (b === null) return null;
    bass = b;
    rest = rest.slice(0, slash);
  }
  for (const [suf, q] of SUFFIX_TO_QUALITY) {
    if (rest === suf) return { root, quality: q, ...(bass !== undefined ? { bass } : {}) };
  }
  return null;
}

export function chordEquals(a: ChordSym, b: ChordSym): boolean {
  return a.root === b.root && a.quality === b.quality && (a.bass ?? a.root) === (b.bass ?? b.root);
}
