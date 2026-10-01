import type { ToContent } from "../shared/messages";
import type { SongRecord } from "../shared/types";
import { alignChart } from "../analysis/align";
import { mergeChords } from "../analysis/merge";
import { mergeSections } from "../analysis/structure";
import { parseChordPro } from "../music/chordpro";

/** Imports a typed chart: its chords replace the detected ones, timing comes from the audio. */
export function importChart(rec: SongRecord, text: string): { ok: boolean; message: string } {
  const chart = parseChordPro(text);
  const n = chart.sections.reduce((s, x) => s + x.chords.length, 0);
  if (n === 0) return { ok: false, message: "No chords found in the pasted chart." };
  const detected = rec.chords.filter((c) => c.source === "detected");
  if (detected.length === 0) return { ok: false, message: "Play the song with the sidebar connected first, so there is something to line the chart up with." };
  const res = alignChart(chart, detected);
  if (!res) return { ok: false, message: "The chart does not look like this video (too few chords match). Check the key/order, or add an {order: …} line if sections repeat." };
  const user = rec.chords.filter((c) => c.source === "user");
  rec.chords = mergeChords(mergeChords(user, res.chords), detected);
  if (res.sections.length) rec.sections = mergeSections(rec.sections.filter((s) => s.source === "user"), res.sections);
  if (chart.key) rec.key = { ...chart.key, confidence: 1 };
  if (chart.artist && !rec.artist) rec.artist = chart.artist;
  return { ok: true, message: `Lined up ${res.matched} of ${res.total} chart chords with the audio.` };
}

/** Applies a user edit to the record in place. Returns true if something changed. */
export function applyEdit(rec: SongRecord, m: ToContent): boolean {
  switch (m.type) {
    case "editChord": {
      const c = rec.chords[m.index];
      if (!c) return false;
      c.root = m.chord.root; c.quality = m.chord.quality;
      if (m.chord.bass !== undefined && m.chord.bass !== m.chord.root) c.bass = m.chord.bass; else delete c.bass;
      c.source = "user"; c.confidence = 1;
      return true;
    }
    case "splitChord": {
      const c = rec.chords[m.index];
      if (!c || m.atSec <= c.startSec + 0.1 || m.atSec >= c.endSec - 0.1) return false;
      const right = { ...c, startSec: m.atSec, source: "user" as const };
      c.endSec = m.atSec; c.source = "user";
      rec.chords.splice(m.index + 1, 0, right);
      return true;
    }
    case "mergeChordWithNext": {
      const c = rec.chords[m.index], n = rec.chords[m.index + 1];
      if (!c || !n) return false;
      c.endSec = n.endSec; c.source = "user";
      rec.chords.splice(m.index + 1, 1);
      return true;
    }
    case "setSections": rec.sections = m.sections; return true;
    case "setTranspose": rec.transpose = m.semitones; return true;
    case "setTitle": rec.title = m.title; if (m.artist !== undefined) rec.artist = m.artist; return true;
    case "setKey": rec.key = { tonic: m.tonic as any, mode: m.mode, confidence: 1 }; return true;
    case "setLyricNudge": {
      rec.lyricNudge = { ...(rec.lyricNudge ?? {}), [m.key]: m.chars };
      if (m.chars === 0) delete rec.lyricNudge[m.key];
      return true;
    }
    default: return false;
  }
}
