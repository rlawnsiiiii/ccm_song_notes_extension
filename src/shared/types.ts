export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11; // C = 0
export type Mode = "major" | "minor";
export type ChordQuality =
  | "maj" | "min" | "7" | "maj7" | "m7"
  | "sus4" | "sus2" | "add9" | "dim" | "aug";
export type Source = "detected" | "user" | "imported";

export interface ChordEvent {
  startSec: number;
  endSec: number;
  root: PitchClass | null; // null = no chord (N.C.)
  quality: ChordQuality | null;
  bass?: PitchClass;
  confidence: number; // 0..1
  source: Source;
}

export interface Section {
  startSec: number;
  endSec: number;
  group: string;
  label: string;
  source: Source;
}

export interface KeyInfo {
  tonic: PitchClass;
  mode: Mode;
  confidence: number;
}

export interface SongRecord {
  videoId: string;
  rawTitle: string;
  title: string;
  artist?: string;
  durationSec: number;
  analyzerVersion: string;
  analyzedRanges: [number, number][];
  key: KeyInfo;
  keyChanges: { atSec: number; tonic: PitchClass; mode: Mode }[];
  tempoBpm?: number;
  beats?: number[];
  chords: ChordEvent[];
  sections: Section[];
  lyrics?: { startSec: number; endSec: number; text: string }[];
  transpose: number;
  notes?: string;
  updatedAt: string;
}

/** One analysis frame: chroma for the whole spectrum and for the bass range. */
export interface FeatureFrame {
  t: number; // video time in seconds (centre of the frame)
  chroma: number[]; // 12, L2-normalised-ish
  bass: number[]; // 12
  energy: number; // RMS
}
