import type { KeyInfo } from "../shared/types";
import type { ChordSym } from "../music/theory";
import { chordEquals, mod12 } from "../music/theory";
import { dedupe, type RefChart } from "../music/chordpro";

export type KeyVerdict = "exact" | "relative" | "fifth" | "wrong" | "none";

/** exact = same tonic and mode; relative = relative major/minor (a typical confusion). */
export function scoreKey(found: KeyInfo | null, ref: RefChart["key"]): KeyVerdict {
  if (!ref) return "none";
  if (!found) return "wrong";
  if (found.tonic === ref.tonic && found.mode === ref.mode) return "exact";
  const relTonic = ref.mode === "major" ? mod12(ref.tonic + 9) : mod12(ref.tonic + 3);
  if (found.mode !== ref.mode && found.tonic === relTonic) return "relative";
  if (found.mode === ref.mode && (found.tonic === mod12(ref.tonic + 7) || found.tonic === mod12(ref.tonic + 5))) return "fifth";
  return "wrong";
}

/** Edit-distance based similarity (0..1) between two chord sequences. */
export function sequenceSimilarity(
  found: ChordSym[], ref: ChordSym[], eq: (a: ChordSym, b: ChordSym) => boolean = chordEquals,
): number {
  const a = dedupe(found), b = dedupe(ref);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (eq(a[i - 1]!, b[j - 1]!) ? 0 : 1));
  }
  return 1 - d[a.length]![b.length]! / Math.max(a.length, b.length);
}

export const rootEquals = (a: ChordSym, b: ChordSym) => a.root === b.root;
/** Root + major/minor family, ignoring extensions and slash bass. */
export const triadEquals = (a: ChordSym, b: ChordSym) => {
  const fam = (c: ChordSym) => (c.quality === "min" || c.quality === "m7" || c.quality === "dim" ? "m" : "M");
  return a.root === b.root && fam(a) === fam(b);
};
