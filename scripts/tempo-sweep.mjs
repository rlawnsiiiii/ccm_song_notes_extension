// Parameter sweep for the tempo estimator on cached synthetic songs. Usage: node scripts/tempo-sweep.mjs
import { build } from "esbuild";
const out = await build({
  stdin: { contents: `export * from "./src/analysis/onset"; export * from "./src/analysis/tempo"; export { makeSong, SR } from "./tests/songgen";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node",
});
const m = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
function onsets(pcm, secs) {
  const ex = new m.OnsetExtractor(m.SR); const hop = Math.round(m.ONSET_HOP_SEC * m.SR); const o = [];
  for (let s = 0; s + m.ONSET_WIN <= Math.min(secs * m.SR, pcm.length); s += hop) o.push(ex.push(pcm.subarray(s, s + m.ONSET_WIN)));
  return m.normalizeOnsets(Float32Array.from(o));
}
const tempos = [60, 66, 72, 80, 88, 96, 104, 112, 120, 130, 140, 150];
const songs = [];
for (const style of ["rock", "acoustic", "ballad"]) for (const bpm of tempos) for (const seed of [1, 2, 3]) {
  const { pcm } = m.makeSong({ bpm, style, seed, key: [7, 2, 9, 4, 0, 5][seed % 6], swing: seed === 2 ? 0.15 : seed === 3 ? 0.08 : 0, melody: seed === 3 ? 1.5 : 0.8 });
  songs.push({ style, bpm, seed, env: onsets(pcm, 40) });
}
console.log("songs", songs.length);
const rate = (est, truth) => { const r = est / truth; return Math.abs(r - 1) < 0.03 ? "ok" : Math.abs(r - 2) < 0.06 || Math.abs(r - 0.5) < 0.03 ? "oct" : "bad"; };
const configs = [];
for (const midWeight of [0.4, 0.6, 0.8]) for (const centre of [105, 115, 125]) for (const prior of [1.0, 1.4]) for (const acfWeight of [0]) configs.push({ midWeight, centre, prior, acfWeight });
const rows = [];
for (const cfg of configs) {
  const c = { ok: 0, oct: 0, bad: 0 }; const per = {};
  for (const s of songs) {
    const t = m.estimateTempo(s.env, undefined, cfg);
    const v = t ? rate(t.bpm, s.bpm) : "bad"; c[v]++;
    per[s.style] = (per[s.style] ?? 0) + (v === "ok" ? 1 : 0);
  }
  rows.push({ ...cfg, ok: c.ok, oct: c.oct, bad: c.bad, rock: per.rock, acoustic: per.acoustic, ballad: per.ballad });
}
rows.sort((a, b) => b.ok - a.ok);
console.table(rows.slice(0, 12));
