/**
 * Synthetic "band" for testing tempo and chord analysis with a known ground truth.
 * Much harsher than a click track: strummed guitar with staggered strings, bass, a drum kit
 * (kick/snare/hi-hat), a sung melody with off-beat onsets, pads without any attacks, swing, 3/4 and 6/8.
 */
export const SR = 44100;

export type Style = "rock" | "ballad" | "pad-only" | "acoustic";
export interface SongSpec {
  bpm: number;          // beats per minute, quarter-note (or dotted quarter in 6/8) feel
  style: Style;
  beatsPerBar?: number; // 4 (default), 3, or 6 (6/8: six eighths; the "beat" is the dotted quarter = 2 pulses)
  key?: number;         // tonic pitch class of a major key
  seconds?: number;
  seed?: number;
  swing?: number;       // 0..0.3 delays off-beat eighths
  melody?: number;      // melody loudness relative to chords
  offset?: number;      // seconds of silence/noise before beat 1
}

export interface SongTruth { bpm: number; beatSec: number; offset: number; beatsPerBar: number; barSec: number; chordAt: (t: number) => number }

const MAJ = [0, 4, 7], MIN = [0, 3, 7];

export function makeSong(spec: SongSpec): { pcm: Float32Array; truth: SongTruth } {
  const seconds = spec.seconds ?? 40;
  const n = Math.floor(seconds * SR);
  const pcm = new Float32Array(n);
  let seed = spec.seed ?? 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const key = spec.key ?? 7;
  const compound = spec.beatsPerBar === 6;
  const pulsesPerBar = compound ? 6 : (spec.beatsPerBar ?? 4);
  const beatsPerBar = compound ? 2 : pulsesPerBar;
  const beatSec = 60 / spec.bpm;
  const pulseSec = compound ? beatSec / 3 : beatSec;      // 6/8: eighth notes
  const barSec = beatSec * beatsPerBar;
  const offset = spec.offset ?? 0.35;
  const swing = spec.swing ?? 0;
  const melodyAmp = spec.melody ?? 0.8;

  // G D Em C (I V vi IV) in the key
  const prog = [[0, MAJ], [7, MAJ], [9, MIN], [5, MAJ]] as const;
  const chordIdx = (t: number) => (t < offset ? 0 : Math.floor((t - offset) / barSec) % 4);
  const chordRoot = (t: number) => (key + prog[chordIdx(t)]![0]) % 12;
  const chordNotes = (t: number) => { const [r, q] = prog[chordIdx(t)]!; return q.map((iv) => (key + r + iv) % 12); };
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const midiOf = (pc: number, base: number) => base + ((pc - base) % 12 + 12) % 12;

  const add = (start: number, dur: number, fn: (t: number, i: number) => number, gain = 1) => {
    const s0 = Math.max(0, Math.floor(start * SR)), s1 = Math.min(n, Math.floor((start + dur) * SR));
    for (let i = s0; i < s1; i++) pcm[i]! += gain * fn((i - s0) / SR, i);
  };
  const pluck = (f: number, decay: number) => (t: number) => {
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h ** 1.2;
    return v * Math.exp(-t / decay) * Math.min(1, t / 0.004);
  };
  const noise = () => rnd() * 2 - 1;

  const pulses = Math.ceil((seconds - offset) / pulseSec);
  for (let p = 0; p < pulses; p++) {
    const isOff = p % 2 === 1;
    const tStart = offset + p * pulseSec + (isOff && !compound ? swing * pulseSec * 0.5 : 0);
    const posInBar = p % pulsesPerBar;
    const beatIdx = compound ? Math.floor(posInBar / 3) : posInBar;
    const onBeat = compound ? posInBar % 3 === 0 : true;
    const notes = chordNotes(tStart);
    const root = chordRoot(tStart);

    if (spec.style === "rock") {
      // drums: kick on 1 (and 3 in 4/4), snare on 2 and 4, hi-hat on every eighth
      const eighthsPerBeat = compound ? 3 : 2;
      for (let e = 0; e < (compound ? 1 : eighthsPerBeat); e++) {
        const t = tStart + (compound ? 0 : e * pulseSec / eighthsPerBeat) + (e === 1 ? swing * pulseSec * 0.25 : 0);
        add(t, 0.06, (x) => noise() * Math.exp(-x / 0.012), 0.10); // hi-hat
      }
      if (compound) { for (const e of [1, 2]) add(tStart + e * pulseSec / 1, 0.06, (x) => noise() * Math.exp(-x / 0.012), 0.10); }
      const kick = (beatIdx === 0) || (!compound && beatsPerBar === 4 && beatIdx === 2);
      const snare = !compound ? (beatsPerBar === 4 ? beatIdx === 1 || beatIdx === 3 : beatIdx === 1) : (posInBar === 3);
      if (kick && onBeat) add(tStart, 0.25, (x) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-x / 0.03)) * x) * Math.exp(-x / 0.09), 0.6);
      if (snare && (onBeat || compound)) add(tStart, 0.18, (x) => (noise() * 0.7 + 0.5 * Math.sin(2 * Math.PI * 190 * x)) * Math.exp(-x / 0.05), 0.4);
      // bass: root on every beat
      if (onBeat) add(tStart, beatSec * 0.9, pluck(hz(midiOf(root, 36)), 0.35), 0.5);
      // guitar strum on every pulse that is not a rest; downstrokes on beats, upstrokes on offs
      const order = isOff ? [...notes].reverse() : notes;
      order.concat(order[0]!).forEach((pc, k) => add(tStart + k * 0.012, 0.8, pluck(hz(midiOf(pc, 55 + (k > 2 ? 12 : 0))), 0.5), isOff ? 0.09 : 0.14));
    } else if (spec.style === "acoustic") {
      // fingerpicked arpeggio, bass on the beat, no drums
      const arp = [notes[0]!, notes[2]!, notes[1]!, notes[2]!];
      add(tStart, 1.2, pluck(hz(midiOf(arp[p % 4]!, 55)), 0.7), 0.16);
      if (onBeat) add(tStart, beatSec, pluck(hz(midiOf(root, 40)), 0.5), 0.35);
    } else if (spec.style === "ballad") {
      // pad + soft kick on 1 + sparse piano on beat
      if (posInBar === 0) add(tStart, 0.4, (x) => Math.sin(2 * Math.PI * (45 + 60 * Math.exp(-x / 0.04)) * x) * Math.exp(-x / 0.12), 0.25);
      if (onBeat && beatIdx % 2 === 0) notes.forEach((pc) => add(tStart, beatSec * 1.8, pluck(hz(midiOf(pc, 60)), 1.0), 0.07));
    }
    // pad-only has no per-pulse events
  }
  // pads (all styles except rock and acoustic): slow attack, sustained per bar, no onsets
  if (spec.style === "ballad" || spec.style === "pad-only") {
    const bars = Math.ceil((seconds - offset) / barSec);
    for (let b = 0; b < bars; b++) {
      const t0 = offset + b * barSec;
      const notes = chordNotes(t0);
      add(t0 - 0.2, barSec + 0.4, (x) => {
        const env = Math.min(1, x / 0.5, (barSec + 0.4 - x) / 0.5);
        let v = 0;
        for (const pc of notes) v += Math.sin(2 * Math.PI * hz(midiOf(pc, 60)) * (x + t0)) + 0.5 * Math.sin(2 * Math.PI * hz(midiOf(pc, 48)) * (x + t0));
        return v * env;
      }, spec.style === "pad-only" ? 0.12 : 0.07);
    }
  }
  // sung melody: off-beat onsets, non-chord tones, 0.2–0.9 s notes
  const scale = [0, 2, 4, 5, 7, 9, 11].map((s) => (key + s) % 12);
  let mt = offset + 2;
  while (mt < seconds) {
    const dur = 0.2 + rnd() * 0.7;
    const pc = scale[Math.floor(rnd() * scale.length)]!;
    const f = hz(midiOf(pc, 69));
    const vib = 5 + rnd() * 2;
    add(mt, dur, (x) => {
      const env = Math.min(1, x / 0.04, (dur - x) / 0.06);
      return env * (Math.sin(2 * Math.PI * (f * (1 + 0.004 * Math.sin(2 * Math.PI * vib * x))) * x) + 0.35 * Math.sin(2 * Math.PI * 2 * f * x));
    }, 0.11 * melodyAmp);
    mt += dur + (rnd() < 0.3 ? rnd() * 0.5 : 0);
  }
  // noise floor
  for (let i = 0; i < n; i++) pcm[i]! += (rnd() * 2 - 1) * 0.004;
  // soft limiter
  for (let i = 0; i < n; i++) pcm[i] = Math.tanh(pcm[i]! * 1.2) * 0.7;

  return { pcm, truth: { bpm: spec.bpm, beatSec, offset, beatsPerBar, barSec, chordAt: chordRoot } };
}
