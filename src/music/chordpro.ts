import type { ChordEvent, SongRecord } from "../shared/types";
import { chordName, chordNumber, parseChord, noteName, parseNote, prefersFlats, mod12, type ChordSym } from "./theory";
import type { Mode, PitchClass } from "../shared/types";

/**
 * Reference chart format (ChordPro flavoured, bar-based, lyrics optional):
 *
 *   {title: 곡명}
 *   {video: dQw4w9WgXcQ}
 *   {key: G}            or {key: Em}
 *   {section: 전주}
 *   | G | D/F# | Em7 | C |
 *   {section: 1절}
 *   | G D/F# | Em | C |
 *
 * Inline chords in lyric lines ("[G]주를 [D]찬양") are supported too: every chord
 * in order is appended to the section.
 */
export interface RefSection { label: string; chords: ChordSym[] }
export interface RefChart {
  title?: string; videoId?: string; artist?: string;
  /** play order of section labels, e.g. 전주 1절 후렴 2절 후렴 */
  order?: string[];
  key?: { tonic: PitchClass; mode: Mode };
  sections: RefSection[];
}

export function parseKey(s: string): { tonic: PitchClass; mode: Mode } | null {
  const t = s.trim();
  const root = parseNote(t);
  if (root === null) return null;
  const rest = t.replace(/^[A-G][#b]?/, "");
  return { tonic: root, mode: /^m(?!aj)|^min/.test(rest) ? "minor" : "major" };
}

export function parseChordPro(text: string): RefChart {
  const chart: RefChart = { sections: [] };
  let cur: RefSection | null = null;
  const ensure = () => (cur ??= (chart.sections.push({ label: "", chords: [] }), chart.sections[chart.sections.length - 1]!));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const dir = /^\{\s*([\w]+)\s*:?\s*(.*?)\s*\}$/.exec(line);
    if (dir) {
      const [, name, val] = dir as unknown as [string, string, string];
      switch (name.toLowerCase()) {
        case "title": case "t": chart.title = val; break;
        case "artist": chart.artist = val; break;
        case "video": case "videoid": chart.videoId = val; break;
        case "order": chart.order = val.split(/[\s,>→]+/).filter(Boolean); break;
        case "key": { const k = parseKey(val); if (k) chart.key = k; break; }
        case "section": case "comment": case "c": case "start_of_verse": case "start_of_chorus":
          chart.sections.push({ label: val || name, chords: [] }); cur = chart.sections[chart.sections.length - 1]!; break;
      }
      continue;
    }
    const target = ensure();
    if (line.includes("[")) {
      for (const m of line.matchAll(/\[([^\]]+)\]/g)) { const c = parseChord(m[1]!); if (c) target.chords.push(c); }
    } else {
      for (const tok of line.split(/[|\s]+/)) {
        if (!tok || tok === "%" ) continue;
        if (tok === "-" ) continue;
        const c = parseChord(tok);
        if (c) target.chords.push(c);
      }
    }
  }
  return chart;
}

/** Collapse consecutive duplicate chords. */
export function dedupe(chords: ChordSym[]): ChordSym[] {
  const out: ChordSym[] = [];
  for (const c of chords) {
    const p = out[out.length - 1];
    if (!p || p.root !== c.root || p.quality !== c.quality || (p.bass ?? p.root) !== (c.bass ?? c.root)) out.push(c);
  }
  return out;
}

/** Export a record as ChordPro (bar-based, 4 chords per line), in the requested key offset. */
export function toChordPro(rec: SongRecord, opts: { transpose?: number; numbers?: boolean } = {}): string {
  const tr = opts.transpose ?? rec.transpose;
  const flats = prefersFlats(mod12(rec.key.tonic + tr), rec.key.mode);
  const lines: string[] = [`{title: ${rec.title}}`];
  if (rec.artist) lines.push(`{artist: ${rec.artist}}`);
  lines.push(`{key: ${noteName(rec.key.tonic + tr, flats)}${rec.key.mode === "minor" ? "m" : ""}}`);
  lines.push(`{video: ${rec.videoId}}`);
  if (rec.notes) lines.push(`{comment: ${rec.notes}}`);
  const sym = (c: ChordEvent) => (opts.numbers ? chordNumber(c, rec.key.tonic, rec.key.mode) : chordName(c, flats, tr));
  const emit = (chords: ChordEvent[]) => {
    const d = chords.filter((c, i) => i === 0 || sym(c) !== sym(chords[i - 1]!));
    for (let i = 0; i < d.length; i += 4) lines.push("| " + d.slice(i, i + 4).map(sym).join(" | ") + " |");
  };
  if (rec.sections.length === 0) emit(rec.chords);
  for (const s of rec.sections) {
    lines.push(`{section: ${s.label}}`);
    emit(rec.chords.filter((c) => c.startSec >= s.startSec - 0.01 && c.startSec < s.endSec - 0.01));
  }
  return lines.join("\n") + "\n";
}

/** Sections in play order. Without an {order:} line the chart is taken as written. */
export function expandChart(chart: RefChart): RefSection[] {
  if (!chart.order?.length) return chart.sections;
  const out: RefSection[] = [];
  for (const label of chart.order) {
    const sec = chart.sections.find((s) => s.label === label);
    if (sec) out.push(sec);
  }
  return out.length ? out : chart.sections;
}
