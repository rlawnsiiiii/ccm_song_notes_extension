import type { ChordEvent } from "../shared/types";

export interface LyricLine { startSec: number; endSec: number; text: string }

/** Parses YouTube's json3 timedtext format into timed lines. */
export function parseJson3(json: unknown): LyricLine[] {
  const events = (json as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] })?.events;
  if (!Array.isArray(events)) return [];
  const lines: LyricLine[] = [];
  for (const e of events) {
    if (e.tStartMs === undefined || !e.segs) continue;
    const text = e.segs.map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text || /^\[.*\]$/.test(text)) continue; // [음악] etc.
    const start = e.tStartMs / 1000;
    lines.push({ startSec: start, endSec: start + (e.dDurationMs ?? 2000) / 1000, text });
  }
  // captions sometimes overlap; make them contiguous but never negative
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i]!.endSec > lines[i + 1]!.startSec) lines[i]!.endSec = lines[i + 1]!.startSec;
  }
  return lines.filter((l) => l.endSec > l.startSec);
}

export interface PlacedChord { col: number; eventIndex: number }

/**
 * Places chords of a line proportionally along its text. Subtitle timing is per line, so the
 * column is approximate. `nudge[eventIndex]` shifts a chord by whole characters.
 */
export function placeChords(
  line: LyricLine, chords: ChordEvent[], nudge: Record<number, number> = {}, minGap: (eventIndex: number) => number = () => 1,
): PlacedChord[] {
  const len = Math.max(1, [...line.text].length);
  const dur = Math.max(0.001, line.endSec - line.startSec);
  const out: PlacedChord[] = [];
  let lastCol = -Infinity, lastGap = 1;
  chords.forEach((c, i) => {
    if (c.startSec < line.startSec - 0.05 || c.startSec >= line.endSec - 0.05) return;
    const prev = chords[i - 1];
    if (prev && prev.root === c.root && prev.quality === c.quality && prev.bass === c.bass) return; // same chord continues
    let col = Math.round(((c.startSec - line.startSec) / dur) * len) + (nudge[i] ?? 0);
    col = Math.max(0, Math.min(len, col));
    if (col < lastCol + lastGap) col = lastCol + lastGap; // never overlap labels
    out.push({ col, eventIndex: i });
    lastCol = col; lastGap = Math.max(1, minGap(i));
  });
  return out;
}

/** Text similarity 0..1 from character bigrams (works for Korean without word splitting). */
export function textSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/[\s.,!?'"~…]/g, "");
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a), B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
