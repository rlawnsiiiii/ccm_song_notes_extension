import type { ChordEvent } from "../shared/types";

/**
 * Re-analysis replaces only `detected` events. User and imported events are kept
 * as they are, and detected events are clipped around them.
 */
export function mergeChords(existing: ChordEvent[], detected: ChordEvent[]): ChordEvent[] {
  const fixed = existing.filter((c) => c.source !== "detected").sort((a, b) => a.startSec - b.startSec);
  if (fixed.length === 0) return detected.map((d) => ({ ...d }));
  const out: ChordEvent[] = [...fixed];
  for (const d of detected) {
    let pieces: [number, number][] = [[d.startSec, d.endSec]];
    for (const f of fixed) {
      const next: [number, number][] = [];
      for (const [s, e] of pieces) {
        if (f.endSec <= s || f.startSec >= e) { next.push([s, e]); continue; }
        if (f.startSec > s) next.push([s, f.startSec]);
        if (f.endSec < e) next.push([f.endSec, e]);
      }
      pieces = next;
    }
    for (const [s, e] of pieces) if (e - s > 0.05) out.push({ ...d, startSec: s, endSec: e });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/** Chord active at time t (binary search over sorted, non-overlapping events). */
export function chordIndexAt(chords: ChordEvent[], t: number): number {
  let lo = 0, hi = chords.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid]!.startSec <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans >= 0 && chords[ans]!.endSec < t - 1) return -1;
  return ans;
}

/** Index of the next event after `idx` whose chord differs from it (ignoring N.C. if asked). */
export function nextDifferent(chords: ChordEvent[], idx: number): number {
  if (idx < 0) return chords.length > 0 ? 0 : -1;
  const cur = chords[idx]!;
  for (let i = idx + 1; i < chords.length; i++) {
    const c = chords[i]!;
    if (c.root !== cur.root || c.quality !== cur.quality || (c.bass ?? c.root) !== (cur.bass ?? cur.root)) return i;
  }
  return -1;
}
