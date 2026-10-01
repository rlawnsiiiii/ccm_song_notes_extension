import type { ChordEvent, Section } from "../shared/types";
import type { ChordSym } from "../music/theory";
import { expandChart, type RefChart } from "../music/chordpro";

function pairScore(a: ChordSym, b: ChordSym): number {
  if (a.root === null || b.root === null) return a.root === b.root ? 1 : -1;
  if (a.root === b.root) {
    if (a.quality === b.quality) return (a.bass ?? a.root) === (b.bass ?? b.root) ? 4 : 3.5;
    const minor = (q: ChordSym["quality"]) => q === "min" || q === "m7" || q === "dim";
    return minor(a.quality) === minor(b.quality) ? 3 : 1.5; // same root, different colour
  }
  // a wrong root is worse than a gap, but a bass-note confusion (e.g. D/F# heard as F#m) is tolerable
  if (b.bass !== undefined && a.root === b.bass) return 0.5;
  if (a.bass !== undefined && b.root === a.bass) return 0.5;
  return -2;
}

const GAP = -1.2;

/** Needleman–Wunsch alignment of two chord sequences. Returns for each ref index the matched detected index or -1. */
export function alignSequences(ref: ChordSym[], det: ChordSym[]): number[] {
  const n = ref.length, m = det.length;
  const H: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const P: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 up(ref gap in det), 3 left
  for (let i = 1; i <= n; i++) { H[i]![0] = i * GAP; P[i]![0] = 2; }
  for (let j = 1; j <= m; j++) { H[0]![j] = j * GAP * 0.5; P[0]![j] = 3; } // extra detected chords at the start are cheap
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = H[i - 1]![j - 1]! + pairScore(ref[i - 1]!, det[j - 1]!);
      const up = H[i - 1]![j]! + GAP;
      const left = H[i]![j - 1]! + GAP * 0.5; // detected chords the chart does not list (passing chords, noise)
      const best = Math.max(diag, up, left);
      H[i]![j] = best;
      P[i]![j] = best === diag ? 1 : best === up ? 2 : 3;
    }
  }
  const map = new Array<number>(n).fill(-1);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const p = P[i]![j]!;
    if (i > 0 && j > 0 && p === 1) { if (pairScore(ref[i - 1]!, det[j - 1]!) > 0) map[i - 1] = j - 1; i--; j--; }
    else if (i > 0 && (p === 2 || j === 0)) i--;
    else j--;
  }
  return map;
}

export interface AlignResult { chords: ChordEvent[]; sections: Section[]; matched: number; total: number }

/**
 * Lines an imported chart up with the detected chords. Matching a known chord list is far more
 * reliable than detecting from scratch, so the chart's chords replace the detected ones and only
 * the timing comes from the audio.
 */
export function alignChart(chart: RefChart, detected: ChordEvent[]): AlignResult | null {
  const secs = expandChart(chart);
  const refChords: { chord: ChordSym; sec: number }[] = [];
  secs.forEach((s, si) => { for (const c of s.chords) refChords.push({ chord: c, sec: si }); });
  // collapse repeats in the reference too (the chart lists bars, we track changes)
  const ref: typeof refChords = [];
  for (const r of refChords) {
    const p = ref[ref.length - 1];
    if (!p || p.sec !== r.sec || p.chord.root !== r.chord.root || p.chord.quality !== r.chord.quality || (p.chord.bass ?? p.chord.root) !== (r.chord.bass ?? r.chord.root)) ref.push(r);
  }
  const det = detected.filter((c) => c.root !== null && c.endSec > c.startSec);
  if (ref.length === 0 || det.length === 0) return null;

  // collapse consecutive identical detected chords
  const dc: ChordEvent[] = [];
  for (const d of det) {
    const p = dc[dc.length - 1];
    if (p && p.root === d.root && p.quality === d.quality && (p.bass ?? p.root) === (d.bass ?? d.root)) p.endSec = d.endSec;
    else dc.push({ ...d });
  }
  const map = alignSequences(ref.map((r) => r.chord), dc);
  const matched = map.filter((x) => x >= 0).length;
  if (matched < Math.min(4, ref.length) || matched / ref.length < 0.4) return null; // does not look like this song

  // start time per ref chord: matched ones take the detected start, others are spread in between
  const first = dc[0]!.startSec, last = dc[dc.length - 1]!.endSec;
  const start = new Array<number>(ref.length).fill(NaN);
  map.forEach((j, i) => { if (j >= 0) start[i] = dc[j]!.startSec; });
  // keep times monotonic: drop matches that go backwards
  let prev = -Infinity;
  for (let i = 0; i < start.length; i++) {
    if (Number.isNaN(start[i]!)) continue;
    if (start[i]! <= prev) start[i] = NaN; else prev = start[i]!;
  }
  let i = 0;
  while (i < ref.length) {
    if (!Number.isNaN(start[i]!)) { i++; continue; }
    let k = i;
    while (k < ref.length && Number.isNaN(start[k]!)) k++;
    const tR = k === ref.length ? last : start[k]!;
    for (let q = i; q < k; q++) {
      // before the first anchor the gap chords share [first, tR); after an anchor chord they share [anchor, tR)
      start[q] = i === 0 ? first + (q * (tR - first)) / k : start[i - 1]! + ((q - i + 1) * (tR - start[i - 1]!)) / (k - i + 1);
    }
    i = k;
  }
  start[0] = Math.min(start[0]!, first);

  const chords: ChordEvent[] = ref.map((r, idx) => ({
    startSec: start[idx]!,
    endSec: idx + 1 < ref.length ? start[idx + 1]! : last,
    root: r.chord.root, quality: r.chord.quality,
    ...(r.chord.bass !== undefined ? { bass: r.chord.bass } : {}),
    confidence: 1, source: "imported" as const,
  })).filter((c) => c.endSec - c.startSec > 0.05);

  const sections: Section[] = [];
  const labelled = secs.some((s) => s.label);
  if (labelled) {
    let cur = -1;
    ref.forEach((r, idx) => {
      if (r.sec !== cur) {
        cur = r.sec;
        sections.push({ startSec: start[idx]!, endSec: last, group: String.fromCharCode(65 + (cur % 26)), label: secs[cur]!.label, source: "imported" });
      }
    });
    for (let s = 0; s + 1 < sections.length; s++) sections[s]!.endSec = sections[s + 1]!.startSec;
  }
  return { chords, sections, matched, total: ref.length };
}
