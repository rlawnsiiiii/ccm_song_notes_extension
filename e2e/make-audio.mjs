// Generates e2e/fixtures/song.wav: G D Em C (one chord per 4/4 bar, 100 BPM) with kick/snare-ish clicks.
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";

const out = await build({
  stdin: { contents: `export { chordSamples, SR } from "./tests/synth";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node",
});
const { chordSamples, SR } = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

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
// percussion: noise bursts on every beat, stronger on the downbeat
for (let k = 0; k < bars * 4; k++) {
  const s = Math.floor(k * beat * SR), amp = k % 4 === 0 ? 0.5 : 0.2;
  for (let i = 0; i < 1500 && s + i < n; i++) pcm[s + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 400);
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
