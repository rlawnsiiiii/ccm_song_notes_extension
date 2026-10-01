import type { ChordEvent } from "../shared/types";
import type { BeatGrid } from "./beats";

export interface BarCell {
  startSec: number;
  endSec: number;
  /** distinct chords in this bar in order, each with the event index it came from */
  chords: { eventIndex: number; beatInBar: number }[];
}

/** Lay chords out on a bar grid. Bars with no heard audio are skipped at the ends. */
export function buildBars(chords: ChordEvent[], grid: BeatGrid, durationSec: number): BarCell[] {
  if (chords.length === 0) return [];
  const per = grid.beatsPerBar;
  const first = chords[0]!.startSec, last = chords[chords.length - 1]!.endSec;
  const beats = grid.beats;
  const barStarts: number[] = [];
  for (let i = grid.downbeat; i < beats.length; i += per) barStarts.push(beats[i]!);
  const period = 60 / grid.bpm;
  const bars: BarCell[] = [];
  for (let b = 0; b < barStarts.length; b++) {
    const start = barStarts[b]!;
    const end = barStarts[b + 1] ?? start + period * per;
    if (end <= first - 0.01 || start >= Math.min(last, durationSec || last) - 0.01) continue;
    const cell: BarCell = { startSec: start, endSec: end, chords: [] };
    let prevKey = "";
    for (let k = 0; k < per; k++) {
      const t = start + (k + 0.5) * ((end - start) / per);
      const idx = chordAt(chords, t);
      if (idx < 0) continue;
      const c = chords[idx]!;
      const key = `${idx}`;
      if (key !== prevKey) { cell.chords.push({ eventIndex: idx, beatInBar: k }); prevKey = key; }
    }
    bars.push(cell);
  }
  return bars;
}

function chordAt(chords: ChordEvent[], t: number): number {
  let lo = 0, hi = chords.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (chords[m]!.startSec <= t) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans >= 0 && chords[ans]!.endSec >= t ? ans : -1;
}
