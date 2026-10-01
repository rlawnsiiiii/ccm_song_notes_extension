// Usage: npm run eval -- <backup.json> [--log]
// Re-runs the current analyzer on stored feature frames and scores it against testdata/*.chordpro
import { build } from "esbuild";
import { readFileSync, readdirSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const backup = args.find((a) => !a.startsWith("--"));
if (!backup) { console.error("usage: npm run eval -- <backup.json> [--log]"); process.exit(1); }

const out = await build({
  stdin: {
    contents: `export * from "./src/analysis/analyzer"; export * from "./src/analysis/evaluate";
      export * from "./src/music/chordpro"; export { unpackFrames } from "./src/store/db";`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

let data;
try { data = JSON.parse(readFileSync(backup, "utf8")); }
catch (e) { console.error(`Cannot read backup "${backup}": ${e.message}`); process.exit(1); }
const refs = readdirSync("testdata").filter((f) => f.endsWith(".chordpro"))
  .map((f) => ({ f, chart: mod.parseChordPro(readFileSync(`testdata/${f}`, "utf8")) }));

const rows = [];
for (const { f, chart } of refs) {
  const packed = data.frames?.[chart.videoId];
  if (!packed) { rows.push({ song: f, note: "no stored frames" }); continue; }
  const frames = mod.unpackFrames(Float32Array.from(packed));
  const res = mod.analyzeFrames(frames);
  const ref = chart.sections.flatMap((s) => s.chords);
  const found = res.chords.filter((c) => c.root !== null);
  rows.push({
    song: f,
    key: mod.scoreKey(res.key, chart.key),
    exact: +mod.sequenceSimilarity(found, ref).toFixed(2),
    triad: +mod.sequenceSimilarity(found, ref, mod.triadEquals).toFixed(2),
    root: +mod.sequenceSimilarity(found, ref, mod.rootEquals).toFixed(2),
  });
}
console.table(rows);
const ok = rows.filter((r) => r.key);
const keyOk = ok.filter((r) => r.key === "exact").length;
const mean = (k) => (ok.length ? (ok.reduce((s, r) => s + r[k], 0) / ok.length).toFixed(2) : "n/a");
const summary = `key ${keyOk}/${ok.length} · exact ${mean("exact")} · triad ${mean("triad")} · root ${mean("root")}`;
console.log(summary);
if (args.includes("--log")) {
  const v = mod.ANALYZER_VERSION;
  appendFileSync("docs/eval-log.md", `| ${new Date().toISOString().slice(0, 10)} | ${v} | ${ok.length} songs | ${keyOk}/${ok.length} | exact ${mean("exact")} / triad ${mean("triad")} / root ${mean("root")} | |\n`);
}
