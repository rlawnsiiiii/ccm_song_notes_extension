// Generates e2e/fixtures/song.wav: G D Em C (one chord per 4/4 bar, 100 BPM) with kick/snare-ish clicks.
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";

const out = await build({
  stdin: { contents: `export { chordSamples, SR } from "./tests/synth";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node",
});
const { chordSamples, SR } = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

let seed = 12345; // deterministic noise so the test is repeatable
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const BPM = 100, beat = 60 / BPM, bar = beat * 4;
const prog = [[7, "maj"], [2, "maj"], [4, "min"], [0, "maj"]];
const bars = 28; // ~67 s
const n = Math.floor(bars * bar * SR);
const pcm = new Float32Array(n);
for (let b = 0; b < bars; b++) {
  const [root, q] = prog[b % 4];
  const start = Math.floor(b * bar * SR);
  const len = Math.min(Math.floor(bar * SR), n - start);
  pcm.set(chordSamples(root, q, root, len, start), start);
}
// vocal-like melody: scale tones of G major (many are NOT chord tones) changing every 0.25-0.6 s
const scale = [7, 9, 11, 0, 2, 4, 6]; // G A B C D E F#
let mt = 0, mnote = 0;
while (mt < n / SR) {
  const dur = 0.25 + rnd() * 0.35;
  mnote = scale[Math.floor(rnd() * scale.length)];
  const f = 440 * 2 ** ((72 + mnote - 69) / 12); // around C5
  const s0 = Math.floor(mt * SR), s1 = Math.min(n, Math.floor((mt + dur) * SR));
  for (let i = s0; i < s1; i++) {
    const t = i / SR, env = Math.min(1, (i - s0) / 800, (s1 - i) / 800);
    pcm[i] += env * 0.16 * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t));
  }
  mt += dur;
}
// percussion: noise bursts on every beat, stronger on the downbeat
for (let k = 0; k < bars * 4; k++) {
  const s = Math.floor(k * beat * SR), amp = k % 4 === 0 ? 0.5 : 0.2;
  for (let i = 0; i < 1500 && s + i < n; i++) pcm[s + i] += (rnd() * 2 - 1) * amp * Math.exp(-i / 400);
}
const buf = Buffer.alloc(44 + n * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
mkdirSync("e2e/fixtures", { recursive: true });
writeFileSync("e2e/fixtures/song.wav", buf);
console.log(`wrote e2e/fixtures/song.wav (${(n / SR).toFixed(1)} s, ${bars} bars)`);
