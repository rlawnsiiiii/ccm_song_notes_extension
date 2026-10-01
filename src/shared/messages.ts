import type { ChordEvent, KeyInfo, Section, SongRecord } from "./types";

/** Periodic snapshot from the content script (about 4 per second). */
export interface StatusMsg {
  type: "status";
  videoId: string | null;
  title: string;
  connected: boolean;
  audio: "idle" | "running" | "suspended" | "ad" | "paused" | "error";
  error?: string;
  level: number; // 0..1
  chroma: number[]; // 12
  time: number;
  duration: number;
  rate: number;
  live: Pick<ChordEvent, "root" | "quality" | "bass" | "confidence"> | null; // low-lag estimate while analysing
  liveChordIdx: number; // index into record.chords, -1 if unknown
  nextChordIdx: number;
  key: KeyInfo | null;
  loop: [number, number] | null;
  known: boolean; // a saved analysis was loaded
}

export interface SongMsg { type: "song"; record: SongRecord | null }

export type ToSidebar = StatusMsg | SongMsg;

export type ToContent =
  | { type: "hello" }
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "seek"; sec: number }
  | { type: "setRate"; rate: number }
  | { type: "setLoop"; range: [number, number] | null }
  | { type: "editChord"; index: number; chord: Pick<ChordEvent, "root" | "quality" | "bass"> }
  | { type: "splitChord"; index: number; atSec: number }
  | { type: "mergeChordWithNext"; index: number }
  | { type: "setSections"; sections: Section[] }
  | { type: "setTranspose"; semitones: number }
  | { type: "setTitle"; title: string; artist?: string }
  | { type: "setKey"; tonic: number; mode: "major" | "minor" }
  | { type: "reanalyze" }
  | { type: "resetAnalysis" }
  | { type: "importRecord"; record: SongRecord };

/** Content/sidebar → background (IndexedDB owner). */
export type ToBackground =
  | { type: "db:saveSong"; record: SongRecord }
  | { type: "db:getSong"; videoId: string }
  | { type: "db:listSongs" }
  | { type: "db:deleteSong"; videoId: string }
  | { type: "db:saveFrames"; videoId: string; version: string; data: number[] }
  | { type: "db:getFrames"; videoId: string; version: string }
  | { type: "db:exportAll" }
  | { type: "db:importAll"; data: ExportBundle };

export interface ExportBundle {
  format: "worship-chord-companion";
  version: 1;
  songs: SongRecord[];
  /** Packed feature frames per video id, so analysis can be re-run offline. */
  frames?: Record<string, number[]>;
}

export const isToSidebar = (m: unknown): m is ToSidebar =>
  typeof m === "object" && m !== null && ((m as any).type === "status" || (m as any).type === "song");
