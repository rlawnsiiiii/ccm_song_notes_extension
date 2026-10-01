import type { ToContent } from "../shared/messages";
import type { SongRecord } from "../shared/types";

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
