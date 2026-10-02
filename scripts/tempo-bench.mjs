// Runs the tempo estimator on synthetic songs with known tempo. Usage: node scripts/tempo-bench.mjs [--quick]
import { build } from "esbuild";
const out = await build({
  stdin: { contents: `export * from "./src/analysis/beats"; export * from "./src/analysis/onset"; export * from "./src/analysis/tempo"; export { ChromaExtractor } from "./src/analysis/chroma"; export { makeSong, SR } from "./tests/songgen";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node",
});
const m = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const quick = process.argv.includes("--quick");

function frames(pcm, secs) {
  const ex = new m.ChromaExtractor({ sampleRate: m.SR, frameSize: 8192 });
  const fr = [];
  for (let t = 0; t + 8192 / m.SR < Math.min(secs, pcm.length / m.SR); t += 0.1) {
    const s = Math.floor(t * m.SR);
    fr.push(ex.extract(pcm.subarray(s, s + 8192), t + 8192 / m.SR / 2));
  }
  return fr;
}
function onsets(pcm, secs) {
  const ex = new m.OnsetExtractor(m.SR);
  const hopS = Math.round(m.ONSET_HOP_SEC * m.SR);
  const out = [];
  for (let s = 0; s + m.ONSET_WIN <= Math.min(secs * m.SR, pcm.length); s += hopS) out.push(ex.push(pcm.subarray(s, s + m.ONSET_WIN)));
  return m.normalizeOnsets(Float32Array.from(out));
}
const verdict = (est, truth, compound) => {
  if (compound && Math.abs(est / truth - 3) < 0.08) return "x3(8ths)";
  const r = est / truth;
  if (Math.abs(r - 1) < 0.03) return "ok";
  if (Math.abs(r - 2) < 0.06) return "x2";
  if (Math.abs(r - 0.5) < 0.03) return "/2";
  if (Math.abs(r - 1.5) < 0.05) return "x1.5";
  if (Math.abs(r - 2 / 3) < 0.03) return "x2/3";
  if (Math.abs(r - 4 / 3) < 0.04) return "x4/3";
  if (Math.abs(r - 0.75) < 0.03) return "x3/4";
  return "bad";
};
const tempos = process.argv.includes("--ccm") && !quick ? [50, 60, 66, 72, 80, 88, 96, 104, 112, 120, 130, 140] : quick ? [70, 100, 130] : [60, 66, 72, 80, 88, 96, 104, 112, 120, 130, 140, 150];
const styles = process.argv.includes("--ccm") ? ["ccm", "ccm68"] : ["rock", "acoustic", "ballad", "pad-only"];
const results = [];
for (const style of styles) for (const bpm of tempos) for (const seed of quick ? [1] : [1, 2]) {
  const { pcm } = m.makeSong({ bpm, style, seed, beatsPerBar: style === "ccm68" ? 6 : 4, key: [7, 2, 9, 4, 0, 5][seed % 6], swing: seed === 2 ? 0.15 : 0 });
  for (const secs of [12, 40]) {
    const useNew = !process.argv.includes("--old");
    let est = null;
    if (useNew) { const t = m.estimateTempo(onsets(pcm, secs)); est = t ? t.bpm : null; }
    else { const g = m.estimateBeatGrid(m.onsetEnvelope(frames(pcm, secs)), secs); est = g ? g.bpm : null; }
    results.push({ style, bpm, seed, secs, est: est ? +est.toFixed(1) : null, v: est ? verdict(est, bpm, style === "ccm68") : "none" });
  }
}
const summary = {};
for (const r of results) { const k = `${r.style} @${r.secs}s`; (summary[k] ??= { ok: 0, n: 0, other: {} }); summary[k].n++; if (r.v === "ok") summary[k].ok++; else summary[k].other[r.v] = (summary[k].other[r.v] ?? 0) + 1; }
console.table(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { correct: `${v.ok}/${v.n}`, errors: JSON.stringify(v.other) }])));
const tot = results.filter((r) => r.secs === 40);
console.log(`overall @40s: ${tot.filter((r) => r.v === "ok").length}/${tot.length} within 3%`);
if (process.argv.includes("--list")) console.log(results.filter((r) => r.v !== "ok").map((r) => `${r.style} ${r.bpm} s${r.seed} @${r.secs}s -> ${r.est} (${r.v})`).join("\n"));
