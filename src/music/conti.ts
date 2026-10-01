import type { Conti, ContiItem, Mode, PitchClass, SongRecord } from "../shared/types";
import { buildBars } from "../analysis/bars";
import { chordName, chordNumber, mod12, noteName, prefersFlats } from "./theory";
import { toChordPro } from "./chordpro";

/** Semitones to move the song from its own key to the target key (nearest direction, -5..+6). */
export function transposeFor(item: ContiItem, rec: SongRecord): number {
  if (!item.targetKey) return 0;
  const d = mod12(item.targetKey.tonic - rec.key.tonic);
  return d > 6 ? d - 12 : d;
}

export function keyLabel(tonic: PitchClass, mode: Mode): string {
  return `${noteName(tonic, prefersFlats(tonic, mode))}${mode === "minor" ? "m" : ""}`;
}

export interface Sheet {
  title: string;
  artist?: string;
  key: string;
  bpm?: number;
  notes: string;
  sections: { label: string; bars: string[][] }[];
}

/** A printable, key-adjusted chart: sections → bars → chord labels. */
export function songSheet(rec: SongRecord, item: ContiItem, numbers: boolean): Sheet {
  const tr = transposeFor(item, rec);
  const tonic = mod12(rec.key.tonic + tr);
  const flats = prefersFlats(tonic, rec.key.mode);
  const label = (i: number) => {
    const c = rec.chords[i]!;
    return numbers ? chordNumber(c, rec.key.tonic, rec.key.mode) : chordName(c, flats, tr);
  };
  let bars: { start: number; end: number; labels: string[] }[];
  if (rec.beats && rec.downbeat !== undefined && rec.tempoBpm) {
    bars = buildBars(rec.chords, { bpm: rec.tempoBpm, offset: rec.beats[0] ?? 0, beats: rec.beats, downbeat: rec.downbeat, beatsPerBar: rec.beatsPerBar ?? 4 }, rec.durationSec)
      .map((b) => {
        const labels: string[] = [];
        for (const x of b.chords) { const l = label(x.eventIndex); if (labels[labels.length - 1] !== l) labels.push(l); }
        return { start: b.startSec, end: b.endSec, labels };
      })
      .filter((b) => b.labels.length > 0);
  } else {
    bars = rec.chords.map((c, i) => ({ start: c.startSec, end: c.endSec, labels: [label(i)] }))
      .filter((b, i, a) => i === 0 || b.labels[0] !== a[i - 1]!.labels[0]);
  }
  const secs = rec.sections.length ? rec.sections : [{ label: "", startSec: 0, endSec: Infinity }];
  const sections = secs.map((s) => ({
    label: s.label,
    bars: bars.filter((b) => (b.start + b.end) / 2 >= s.startSec && (b.start + b.end) / 2 < s.endSec).map((b) => b.labels),
  })).filter((s) => s.bars.length > 0);
  return {
    title: rec.title, ...(rec.artist ? { artist: rec.artist } : {}),
    key: keyLabel(tonic as PitchClass, rec.key.mode), ...(rec.tempoBpm ? { bpm: rec.tempoBpm } : {}),
    notes: item.notes, sections,
  };
}

/** One ChordPro text for the whole 콘티 (songs separated by {new_song}). */
export function contiToChordPro(conti: Conti, records: Map<string, SongRecord>): string {
  const parts: string[] = [`# ${conti.name} (${conti.date})\n`];
  conti.items.forEach((item, n) => {
    const rec = records.get(item.videoId);
    if (!rec) return;
    const body = toChordPro({ ...rec, notes: [rec.notes, item.notes].filter(Boolean).join(" / ") }, { transpose: transposeFor(item, rec), numbers: conti.numbers });
    parts.push(`{new_song}\n# ${n + 1}.\n${body}`);
  });
  return parts.join("\n");
}

export function newConti(): Conti {
  return {
    id: crypto.randomUUID(), name: "새 콘티", date: new Date().toISOString().slice(0, 10),
    items: [], numbers: false, updatedAt: new Date().toISOString(),
  };
}

/** Order helpers for the editor. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length || from === to) return arr;
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}
