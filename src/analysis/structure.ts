import type { ChordEvent, FeatureFrame, KeyInfo, PitchClass, Section } from "../shared/types";
import type { BarCell } from "./bars";
import { KeyAccumulator } from "./key";

/** What the structure finder needs to know about each bar. */
export interface BarInfo {
  startSec: number;
  endSec: number;
  /** chord names, one per beat slot that starts a chord, e.g. ["G","D/F#"] (triad-level compare) */
  chords: string[];
  energy: number;
}

export function barInfos(bars: BarCell[], chords: ChordEvent[], frames: FeatureFrame[]): BarInfo[] {
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  let fi = 0;
  return bars.map((b) => {
    while (fi < sorted.length && sorted[fi]!.t < b.startSec) fi++;
    let j = fi, e = 0, n = 0;
    while (j < sorted.length && sorted[j]!.t < b.endSec) { e += sorted[j]!.energy; n++; j++; }
    return {
      startSec: b.startSec, endSec: b.endSec,
      chords: b.chords.map((c) => triadKey(chords[c.eventIndex]!)),
      energy: n ? e / n : 0,
    };
  });
}

/** Root + major/minor family: ignores extensions and slash bass, which are noisy. */
function triadKey(c: ChordEvent): string {
  if (c.root === null) return "N";
  const minor = c.quality === "min" || c.quality === "m7" || c.quality === "dim";
  return `${c.root}${minor ? "m" : ""}`;
}

/** Similarity of two bars, 0..1: compares the chord at each of 4 beat positions. */
function barSim(a: BarInfo, b: BarInfo): number {
  if (a.chords.length === 0 || b.chords.length === 0) return a.chords.length === b.chords.length ? 1 : 0;
  const slots = 4;
  const at = (x: BarInfo, k: number) => x.chords[Math.min(x.chords.length - 1, Math.floor((k * x.chords.length) / slots))]!;
  let m = 0;
  for (let k = 0; k < slots; k++) if (at(a, k) === at(b, k)) m++;
  // identical sequences score fully even when beat positions differ
  if (a.chords.join() === b.chords.join()) return 1;
  return m / slots;
}

export function blockSim(bars: BarInfo[], i: number, j: number, len: number): number {
  let s = 0, n = 0;
  for (let k = 0; k < len; k++) {
    const a = bars[i + k], b = bars[j + k];
    if (!a || !b) continue;
    s += barSim(a, b); n++;
  }
  return n === 0 ? 0 : s / n;
}

interface Block { start: number; len: number; group: number }

function segment(bars: BarInfo[], len: number, offset: number): Block[] {
  const blocks: Block[] = [];
  if (offset > 0) blocks.push({ start: 0, len: offset, group: -1 });
  for (let i = offset; i < bars.length; i += len) blocks.push({ start: i, len: Math.min(len, bars.length - i), group: -1 });
  return blocks;
}

const GROUP_THRESHOLD = 0.7;

function cluster(bars: BarInfo[], blocks: Block[]): number {
  let next = 0;
  for (const b of blocks) {
    let best = -1, bestSim = 0;
    for (const o of blocks) {
      if (o === b) break;
      if (o.group < 0) continue;
      const sim = blockSim(bars, b.start, o.start, Math.min(b.len, o.len));
      if (sim > bestSim) { bestSim = sim; best = o.group; }
    }
    b.group = bestSim >= GROUP_THRESHOLD && b.len >= 2 ? best : next++;
  }
  return next;
}

/** How well a segmentation explains the song: share of full blocks that repeat. */
function repeatScore(bars: BarInfo[], blocks: Block[]): number {
  const usable = blocks.filter((b) => b.len >= 2);
  if (usable.length < 2) return 0;
  let s = 0, w = 0;
  for (const b of usable) {
    let best = 0;
    for (const o of usable) if (o !== b) best = Math.max(best, blockSim(bars, b.start, o.start, Math.min(b.len, o.len)));
    s += best * b.len; w += b.len; // short edge blocks count less, but they count
  }
  return s / w;
}

export interface StructureOptions { lens?: number[] }

export function findStructure(bars: BarInfo[], opts: StructureOptions = {}): Section[] {
  if (bars.length < 8) return [];
  const lens = opts.lens ?? [8, 4];
  // best segmentation per phrase length; then prefer the longest phrase that is nearly as good,
  // because short blocks always repeat inside longer ones.
  const perLen: { len: number; blocks: Block[]; score: number }[] = [];
  for (const len of lens) {
    let b: { blocks: Block[]; score: number } | null = null;
    for (let offset = 0; offset <= Math.min(len - 1, 4); offset++) {
      const blocks = segment(bars, len, offset);
      const score = repeatScore(bars, blocks);
      if (!b || score > b.score + 0.15) b = { blocks, score }; // offset 0 unless clearly better
    }
    if (b) perLen.push({ len, ...b });
  }
  const top = Math.max(...perLen.map((p) => p.score));
  const best = [...perLen].sort((a, b) => b.len - a.len).find((p) => p.score >= top - 0.2) ?? null;
  if (!best) return [];
  const blocks = best.blocks;
  const groups = cluster(bars, blocks);
  return label(bars, blocks, groups);
}

function label(bars: BarInfo[], blocks: Block[], groupCount: number): Section[] {
  const stats = Array.from({ length: groupCount }, (_, g) => {
    const mine = blocks.filter((b) => b.group === g);
    const energy = mine.reduce((s, b) => s + meanEnergy(bars, b), 0) / mine.length;
    return { g, count: mine.length, energy, first: mine[0]!.start };
  });
  const repeated = stats.filter((s) => s.count >= 2);
  // chorus: the loudest repeated group (ties → most repeats)
  const chorus = [...repeated].sort((a, b) => b.energy - a.energy || b.count - a.count)[0];
  const names = new Map<number, string>();
  if (chorus) names.set(chorus.g, "후렴");
  // verse: the earliest remaining repeated group, else the earliest group after the intro
  const verse = repeated.filter((s) => s.g !== chorus?.g).sort((a, b) => a.first - b.first)[0];
  if (verse) names.set(verse.g, "절");

  const lastIdx = blocks.length - 1;
  const sections: Section[] = [];
  let verseN = 0;
  const seen = new Map<number, number>();
  blocks.forEach((b, i) => {
    let label = names.get(b.group);
    // an opening block that reuses the verse harmony but is clearly quieter is the intro
    if (i === 0 && label === "절") {
      const others = blocks.filter((o, k) => k > 0 && o.group === b.group);
      const avg = others.reduce((a, o) => a + meanEnergy(bars, o), 0) / Math.max(1, others.length);
      if (meanEnergy(bars, b) < avg * 0.8) label = "전주";
    }
    const isUnique = stats[b.group]!.count === 1;
    const next = blocks[i + 1];
    if (label === "절") label = `${++verseN}절`;
    else if (!label) {
      if (i === 0) label = "전주";
      else if (i === lastIdx && isUnique) label = "후주";
      else if (isUnique && next && names.get(next.group) === "후렴" && blocks[i - 1] && names.get(blocks[i - 1]!.group)?.endsWith("절")) label = "프리코러스";
      else if (isUnique && i >= blocks.length * 0.5) label = "브릿지";
      else if (stats[b.group]!.count >= 2) label = i === 0 ? "전주" : "간주";
      else label = "구간";
    }
    seen.set(b.group, (seen.get(b.group) ?? 0) + 1);
    sections.push({
      startSec: bars[b.start]!.startSec,
      endSec: bars[b.start + b.len - 1]!.endSec,
      group: String.fromCharCode(65 + (b.group % 26)),
      label, source: "detected",
    });
  });
  return sections;
}

function meanEnergy(bars: BarInfo[], b: Block): number {
  let s = 0;
  for (let k = 0; k < b.len; k++) s += bars[b.start + k]!.energy;
  return s / b.len;
}

/** Re-analysis keeps user/imported sections; detected ones fill the rest. */
export function mergeSections(existing: Section[], detected: Section[]): Section[] {
  const fixed = existing.filter((s) => s.source !== "detected");
  if (fixed.length === 0) return detected;
  const free = detected.filter((d) => !fixed.some((f) => f.startSec < d.endSec - 0.01 && f.endSec > d.startSec + 0.01));
  return [...fixed, ...free].sort((a, b) => a.startSec - b.startSec);
}

// ---- key changes (전조) ----

export interface KeyChange { atSec: number; tonic: PitchClass; mode: "major" | "minor" }

/** Sliding-window key estimate; a change must persist for several windows. */
export function detectKeyChanges(frames: FeatureFrame[], main: KeyInfo, opts: { win?: number; hop?: number; minRun?: number } = {}): KeyChange[] {
  const win = opts.win ?? 14, hop = opts.hop ?? 3, minRun = opts.minRun ?? 3;
  if (frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const end = sorted[sorted.length - 1]!.t;
  const keys: { t: number; tonic: number; mode: "major" | "minor" }[] = [];
  for (let t = sorted[0]!.t; t + win <= end + 0.01; t += hop) {
    const acc = new KeyAccumulator();
    for (const f of sorted) if (f.t >= t && f.t < t + win) acc.add(f.chroma, Math.min(1, f.energy * 20));
    const k = acc.key();
    if (k) keys.push({ t, tonic: k.tonic, mode: k.mode });
  }
  const changes: KeyChange[] = [];
  let current = { tonic: main.tonic as number, mode: main.mode };
  // relative major/minor are the same key for our purposes
  const same = (a: { tonic: number; mode: string }, b: { tonic: number; mode: string }) =>
    a.mode === b.mode ? a.tonic === b.tonic : relTonic(a) === b.tonic;
  const relTonic = (k: { tonic: number; mode: string }) => (k.mode === "major" ? (k.tonic + 9) % 12 : (k.tonic + 3) % 12);
  for (let i = 0; i + minRun <= keys.length; i++) {
    const k = keys[i]!;
    if (same(k, current)) continue;
    const run = keys.slice(i, i + minRun);
    if (run.every((r) => same(r, k))) {
      // time of the change: the window centre minus half a window pulls it towards the boundary
      changes.push({ atSec: k.t + win / 2 - hop, tonic: k.tonic as PitchClass, mode: k.mode });
      current = { tonic: k.tonic, mode: k.mode };
      i += minRun - 1;
    }
  }
  return changes;
}
