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
  beats?: number[]; // seconds
  downbeat?: number; // index into beats of the first bar start (mod beatsPerBar)
  beatsPerBar?: number;
  chords: ChordEvent[];
  sections: Section[];
  lyrics?: { startSec: number; endSec: number; text: string }[];
  lyricsAuto?: boolean; // true when the captions were auto-generated
  /** chord start time (1 decimal) → characters to shift in the lyrics view */
  lyricNudge?: Record<string, number>;
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

export interface ContiItem {
  videoId: string;
  /** target key for this service; null = keep the song's own key */
  targetKey: { tonic: PitchClass; mode: Mode } | null;
  notes: string; // e.g. "후렴 2번 반복"
}

/** 콘티: the setlist for one service. */
export interface Conti {
  id: string;
  name: string;
  date: string; // yyyy-mm-dd
  items: ContiItem[];
  numbers: boolean; // print numbers instead of chord names
  updatedAt: string;
}
