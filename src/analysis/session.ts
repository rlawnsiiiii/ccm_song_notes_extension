import type { ChordEvent, FeatureFrame, KeyInfo, SongRecord } from "../shared/types";
import { ANALYZER_VERSION, analyzeFrames } from "./analyzer";
import { mergeChords } from "./merge";

export const HOP_SEC = 0.1;
const bucket = (t: number) => Math.round(t / HOP_SEC);

/** All frames heard so far for one video, plus the record built from them. */
export class SongSession {
  readonly frames = new Map<number, FeatureFrame>();
  record: SongRecord;
  dirty = false;

  constructor(record: SongRecord) {
    this.record = record;
  }

  static blank(videoId: string, rawTitle: string, durationSec: number): SongRecord {
    return {
      videoId, rawTitle, title: rawTitle, durationSec,
      analyzerVersion: ANALYZER_VERSION,
      analyzedRanges: [],
      key: { tonic: 0, mode: "major", confidence: 0 },
      keyChanges: [], chords: [], sections: [],
      transpose: 0, updatedAt: new Date().toISOString(),
    };
  }

  addFrame(f: FeatureFrame): void {
    this.frames.set(bucket(f.t), f);
    this.dirty = true;
  }

  loadFrames(frames: FeatureFrame[]): void {
    for (const f of frames) this.frames.set(bucket(f.t), f);
  }

  sortedFrames(): FeatureFrame[] {
    return [...this.frames.values()].sort((a, b) => a.t - b.t);
  }

  /** Split into contiguous runs; a gap of more than ~0.5 s starts a new run. */
  segments(): FeatureFrame[][] {
    const all = this.sortedFrames();
    const segs: FeatureFrame[][] = [];
    let cur: FeatureFrame[] = [];
    for (const f of all) {
      const prev = cur[cur.length - 1];
      if (prev && f.t - prev.t > 0.55) { segs.push(cur); cur = []; }
      cur.push(f);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  reanalyze(): void {
    if (this.frames.size === 0) return;
    const segs = this.segments().filter((s) => s.length >= 3);
    const all = this.sortedFrames();
    const key = analyzeFrames(all).key;
    const locked = this.record.key.confidence >= 1; // set by the user
    const keyChanged = key && !locked && (key.tonic !== this.record.key.tonic || key.mode !== this.record.key.mode);
    let detected: ChordEvent[] = [];
    const ranges: [number, number][] = [];
    for (const seg of segs) {
      detected = detected.concat(analyzeFrames(seg, this.record.key.confidence ? this.record.key : key).chords);
      ranges.push([seg[0]!.t - HOP_SEC / 2, seg[seg.length - 1]!.t + HOP_SEC / 2]);
    }
    if (key && (keyChanged || this.record.key.confidence === 0)) this.record.key = key;
    else if (key && !locked) this.record.key.confidence = key.confidence;
    this.record.chords = mergeChords(this.record.chords, detected);
    this.record.analyzedRanges = ranges;
    this.record.analyzerVersion = ANALYZER_VERSION;
    this.record.updatedAt = new Date().toISOString();
  }

  /** Quick estimate of the chord right now from the most recent frames (low lag). */
  liveChord(nowT: number, windowSec = 2.5): ChordEvent | null {
    const key = this.record.key.confidence ? this.record.key : null;
    const win: FeatureFrame[] = [];
    for (let b = bucket(nowT); b > bucket(nowT) - windowSec / HOP_SEC; b--) {
      const f = this.frames.get(b);
      if (!f) { if (win.length) break; else continue; }
      win.unshift(f);
    }
    if (win.length < 3) return null;
    const ch = analyzeFrames(win, key).chords;
    return ch[ch.length - 1] ?? null;
  }

  get key(): KeyInfo { return this.record.key; }
}
