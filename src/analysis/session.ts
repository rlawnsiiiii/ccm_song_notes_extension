import type { ChordEvent, FeatureFrame, KeyInfo, SongRecord } from "../shared/types";
import { ANALYZER_VERSION, analyzeFrames, estimateKey } from "./analyzer";
import { mergeChords } from "./merge";
import { buildBars } from "./bars";
import { cleanTitle } from "../music/title";
import { barInfos, detectKeyChanges, findStructure, mergeSections } from "./structure";
import { estimateBeatGrid, onsetEnvelope, snapChords } from "./beats";

export const HOP_SEC = 0.1;
const bucket = (t: number) => Math.round(t / HOP_SEC);

/** All frames heard so far for one video, plus the record built from them. */
export class SongSession {
  readonly frames = new Map<number, FeatureFrame>();
  record: SongRecord;
  dirty = false;
  private gridHeard = 0;

  constructor(record: SongRecord) {
    this.record = record;
  }

  static blank(videoId: string, rawTitle: string, durationSec: number): SongRecord {
    const clean = cleanTitle(rawTitle);
    return {
      videoId, rawTitle, title: clean.title, ...(clean.artist ? { artist: clean.artist } : {}), durationSec,
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
    const key = estimateKey(all);
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
    const dur = this.record.durationSec || all[all.length - 1]!.t + 1;
    const heard = ranges.reduce((s, r) => s + r[1] - r[0], 0);
    if (heard >= 30 && (!this.record.beats || heard - this.gridHeard > 15)) {
      const grid = estimateBeatGrid(onsetEnvelope(all), dur);
      this.gridHeard = heard;
      if (grid) {
        this.record.tempoBpm = Math.round(grid.bpm * 10) / 10;
        this.record.beats = grid.beats.map((b) => Math.round(b * 1000) / 1000);
        this.record.downbeat = grid.downbeat;
        this.record.beatsPerBar = grid.beatsPerBar;
      }
    }
    if (this.record.beats) detected = snapChords(detected, this.record.beats);
    this.record.chords = mergeChords(this.record.chords, detected);
    this.record.analyzedRanges = ranges;
    this.updateStructure(all, ranges);
    this.record.analyzerVersion = ANALYZER_VERSION;
    this.record.updatedAt = new Date().toISOString();
  }

  /** Sections and key changes need a (nearly) complete pass plus a beat grid. */
  private updateStructure(all: FeatureFrame[], ranges: [number, number][]): void {
    const rec = this.record;
    const heard = ranges.reduce((s, r) => s + r[1] - r[0], 0);
    const coverage = rec.durationSec > 0 ? heard / rec.durationSec : 0;
    if (!rec.beats || rec.downbeat === undefined || !rec.tempoBpm || coverage < 0.85) return;
    const grid = { bpm: rec.tempoBpm, offset: rec.beats[0] ?? 0, beats: rec.beats, downbeat: rec.downbeat, beatsPerBar: rec.beatsPerBar ?? 4 };
    const bars = buildBars(rec.chords, grid, rec.durationSec);
    const detected = findStructure(barInfos(bars, rec.chords, all, rec.lyrics));
    rec.sections = mergeSections(rec.sections, detected);
    rec.keyChanges = detectKeyChanges(all, rec.key);
  }

  /** Quick estimate of the chord right now from the most recent frames (low lag). */
  liveChord(nowT: number, windowSec = 2.5): ChordEvent | null {
    const key = this.record.key.confidence ? this.record.key : null;
    const win: FeatureFrame[] = [];
    let misses = 0;
    for (let b = bucket(nowT); b > bucket(nowT) - windowSec / HOP_SEC; b--) {
      const f = this.frames.get(b);
      if (!f) { if (win.length && ++misses > 2) break; continue; } // tolerate timer jitter
      misses = 0;
      win.unshift(f);
    }
    if (win.length < 3) return null;
    const ch = analyzeFrames(win, key).chords;
    return ch[ch.length - 1] ?? null;
  }

  get key(): KeyInfo { return this.record.key; }
}
