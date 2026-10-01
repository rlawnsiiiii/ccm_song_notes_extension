import type { ChordEvent, FeatureFrame, KeyInfo, SongRecord } from "../shared/types";
import { ANALYZER_VERSION, analyzeFrames, estimateKey } from "./analyzer";
import { mergeChords } from "./merge";
import { buildBars } from "./bars";
import { cleanTitle } from "../music/title";
import { barInfos, detectKeyChanges, findStructure, mergeSections } from "./structure";
import { estimateBeatGrid, gridFromTempo, onsetEnvelope, snapChords } from "./beats";
import { estimateTempo } from "./tempo";
import { ONSET_HOP_SEC, normalizeOnsets } from "./onset";

export const HOP_SEC = 0.1;
/** Seconds of audio needed before a tempo is shown. */
const MIN_TEMPO_SEC = 10;
/** Per-unit stay probability for the live chord: lower than offline so a change shows within a beat or two. */
export const LIVE_STAY = 0.55;
const bucket = (t: number) => Math.round(t / HOP_SEC);

/** All frames heard so far for one video, plus the record built from them. */
export class SongSession {
  readonly frames = new Map<number, FeatureFrame>();
  /** fine onset strength (hop ONSET_HOP_SEC) keyed by bucket; used for tempo */
  readonly onsets = new Map<number, number>();
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

  addOnset(t: number, v: number): void {
    const k = Math.round(t / ONSET_HOP_SEC);
    if (k < 0) return;
    this.onsets.set(k, Math.max(this.onsets.get(k) ?? 0, v));
    this.dirty = true;
  }

  /** [t0, v0, t1, v1, …] */
  packOnsets(): Float32Array {
    const keys = [...this.onsets.keys()].sort((a, b) => a - b);
    const out = new Float32Array(keys.length * 2);
    keys.forEach((k, i) => { out[2 * i] = k * ONSET_HOP_SEC; out[2 * i + 1] = this.onsets.get(k)!; });
    return out;
  }

  loadOnsets(packed: ArrayLike<number>): void {
    for (let i = 0; i + 1 < packed.length; i += 2) this.onsets.set(Math.round(packed[i]! / ONSET_HOP_SEC), packed[i + 1]!);
  }

  private onsetEnvelopeArray(): Float32Array {
    let max = 0;
    for (const k of this.onsets.keys()) if (k > max) max = k;
    const env = new Float32Array(max + 1);
    for (const [k, v] of this.onsets) env[k] = v;
    return normalizeOnsets(env);
  }

  /** User flipped the tempo octave: ×2 or ÷2. Bar starts stay where they are. */
  rescaleTempo(factor: 2 | 0.5): void {
    const r = this.record;
    if (!r.beats || r.tempoBpm === undefined) return;
    const per = r.beatsPerBar ?? 4;
    const dbIdx = r.downbeat ?? 0;
    if (factor === 0.5) {
      // keep every second beat, starting from the beat that begins a bar
      const keepEven = dbIdx % 2 === 0;
      const kept = r.beats.filter((_, i) => (i % 2 === 0) === keepEven);
      const firstBarBeat = r.beats[dbIdx]!;
      r.beats = kept;
      r.downbeat = Math.max(0, kept.findIndex((t) => Math.abs(t - firstBarBeat) < 1e-6)) % per;
    } else {
      const out: number[] = [];
      r.beats.forEach((t, i) => { out.push(t); const next = r.beats![i + 1]; out.push(next !== undefined ? (t + next) / 2 : t + 30 / r.tempoBpm!); });
      r.beats = out;
      r.downbeat = (dbIdx * 2) % per;
    }
    r.tempoBpm = Math.round(r.tempoBpm * factor * 10) / 10;
    r.tempoLocked = true;
    this.reanalyze();
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
    const ranges: [number, number][] = segs.map((seg) => [seg[0]!.t - HOP_SEC / 2, seg[seg.length - 1]!.t + HOP_SEC / 2]);
    if (key && (keyChanged || this.record.key.confidence === 0)) this.record.key = key;
    else if (key && !locked) this.record.key.confidence = key.confidence;
    const dur = this.record.durationSec || all[all.length - 1]!.t + 1;
    const heard = ranges.reduce((s, r) => s + r[1] - r[0], 0);
    // tempo first (it only needs onsets), so chords can then be decoded beat by beat
    if (!this.record.tempoLocked && heard >= MIN_TEMPO_SEC && (!this.record.beats || heard - this.gridHeard > 10)) {
      this.gridHeard = heard;
      let grid: { bpm: number; beats: number[]; downbeat: number; beatsPerBar: number } | null = null;
      if (this.onsets.size > 200) {
        const est = estimateTempo(this.onsetEnvelopeArray());
        if (est) grid = gridFromTempo(est, dur, onsetEnvelope(all));
      }
      // saved songs from before the fine onset signal existed: fall back to the chroma-based estimate
      if (!grid) grid = estimateBeatGrid(onsetEnvelope(all), dur);
      if (grid) {
        this.record.tempoBpm = Math.round(grid.bpm * 10) / 10;
        this.record.beats = grid.beats.map((b) => Math.round(b * 1000) / 1000);
        this.record.downbeat = grid.downbeat;
        this.record.beatsPerBar = grid.beatsPerBar;
      }
    }
    const lite = this.gridLite();
    let detected: ChordEvent[] = [];
    for (const seg of segs) detected = detected.concat(analyzeFrames(seg, this.record.key.confidence ? this.record.key : key, lite).chords);
    if (this.record.beats) detected = snapChords(detected, this.record.beats);
    this.record.chords = mergeChords(this.record.chords, detected);
    this.record.analyzedRanges = ranges;
    this.updateStructure(all, ranges);
    this.record.analyzerVersion = ANALYZER_VERSION;
    this.record.updatedAt = new Date().toISOString();
  }

  /** The beat grid in the form the chord decoder wants, if a tempo is known. */
  gridLite(): { period: number; offset: number } | null {
    const r = this.record;
    return r.beats && r.beats.length > 1 && r.tempoBpm ? { period: 60 / r.tempoBpm, offset: r.beats[0]! } : null;
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
    const ch = analyzeFrames(win, key, this.gridLite(), { stay: LIVE_STAY }).chords;
    return ch[ch.length - 1] ?? null;
  }

  get key(): KeyInfo { return this.record.key; }
}
