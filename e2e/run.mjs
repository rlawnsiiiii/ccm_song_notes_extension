// End-to-end test in real Firefox: loads the test build, plays e2e/fixtures/song.wav on a
// localhost page that looks like /watch?v=..., and checks live + stored results.
// Usage: node e2e/run.mjs [--show]   (headless unless --show)
import { Builder, By } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const show = process.argv.includes("--show");
const PORT = 8731;
const VID = "TESTVID0001";
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const expectProg = ["G", "D", "Em", "C"];

execSync("node scripts/build.mjs", { env: { ...process.env, WCC_TEST: "1" }, stdio: "inherit" });
if (!existsSync("e2e/fixtures/song.wav")) execSync("node e2e/make-audio.mjs", { stdio: "inherit" });

const wav = readFileSync("e2e/fixtures/song.wav");
const server = createServer((req, res) => {
  if (req.url.startsWith("/song.wav")) {
    const range = req.headers.range;
    if (range) {
      const [a, b] = range.replace("bytes=", "").split("-");
      const start = +a, end = b ? +b : wav.length - 1;
      res.writeHead(206, { "Content-Type": "audio/wav", "Content-Range": `bytes ${start}-${end}/${wav.length}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      res.end(wav.subarray(start, end + 1));
    } else {
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length, "Accept-Ranges": "bytes" });
      res.end(wav);
    }
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>Test video</title><h1 class="title">Test Song</h1><video class="html5-main-video" src="/song.wav" controls></video>`);
  }
}).listen(PORT);

const opts = new firefox.Options();
if (!show) opts.addArguments("-headless");
opts.setPreference("media.autoplay.default", 0);
opts.setPreference("media.autoplay.blocking_policy", 0);
opts.setPreference("media.volume_scale", "0.0"); // keep the test silent
opts.setPreference("xpinstall.signatures.required", false);
opts.setBinary("/Applications/Firefox.app/Contents/MacOS/firefox");
const service = new firefox.ServiceBuilder(".cache/geckodriver");
const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(opts).setFirefoxService(service).build();

const results = [];
const check = (name, fn) => { try { fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", `${name}: ${e.message.split("\n")[0]}`]); } };
const state = async () => JSON.parse((await driver.executeScript("return document.documentElement.dataset.wcc || 'null'")) ?? "null");
const cmd = (c) => driver.executeScript(`document.documentElement.dataset.wccCmd = ${JSON.stringify(JSON.stringify(c))}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const symName = (c) => c && c.root !== null && c.root !== undefined ? NAMES[c.root] + (c.quality === "min" ? "m" : c.quality === "maj" ? "" : c.quality) : "N.C.";

let failed = false;
try {
  await driver.installAddon(process.cwd() + "/dist", true);
  await driver.get(`http://localhost:${PORT}/watch?v=${VID}`);
  await driver.wait(async () => (await state()) !== null, 15000, "content script never published state");
  await sleep(1000);
  await driver.executeScript("const v = document.querySelector('video'); v.muted = false; return v.play();");
  await cmd({ type: "connect" });

  // live phase: sample the live chord against the known progression
  const samples = [];
  const t0 = Date.now();
  let lastAudio = "";
  while (Date.now() - t0 < 72000) {
    const s = await state();
    if (s?.st) {
      lastAudio = s.st.audio;
      const t = s.st.time;
      if (s.st.audio === "running" && t > 3) {
        const bar = Math.floor(t / 2.4);
        const within = (t % 2.4);
        if (within > 0.6 && within < 2.0) samples.push({ t, live: symName(s.st.live), want: expectProg[bar % 4] });
      }
      if (t > 66.5) break;
    }
    await sleep(250);
  }
  await cmd({ type: "persist" });
  await sleep(2500);
  const s1 = await state();

  check("audio graph ran", () => assert.ok(["running", "paused"].includes(lastAudio), `audio state was ${lastAudio}`));
  check("collected live samples", () => assert.ok(samples.length > 100, `only ${samples.length}`));
  const ok = samples.filter((x) => x.live === x.want).length;
  const wrong = samples.filter((x) => x.live !== x.want);
  const confusion = {};
  for (const w of wrong) confusion[`${w.want}→${w.live}`] = (confusion[`${w.want}→${w.live}`] ?? 0) + 1;
  const byPos = wrong.map((w) => (w.t % 2.4).toFixed(1));
  check("live chord correct ≥85%", () => assert.ok(ok / samples.length >= 0.85, `${ok}/${samples.length} (${(100 * ok / samples.length).toFixed(0)}%) confusion=${JSON.stringify(confusion)} pos=${byPos.slice(0, 20).join(",")}`));
  check("key is G major", () => assert.equal(`${NAMES[s1.record.key.tonic]} ${s1.record.key.mode}`, "G major"));
  const chords = s1.record.chords.filter((c) => c.root !== null);
  check("chart has chords", () => assert.ok(chords.length >= 20, `${chords.length} chords`));
  const seq = chords.map(symName);
  const good = seq.filter((c, i) => c === expectProg[i % 4]).length;
  check("chart sequence matches G-D-Em-C", () => assert.ok(good / seq.length >= 0.8, `${good}/${seq.length}: ${seq.slice(0, 12).join(" ")}`));
  check("tempo ≈100 BPM", () => assert.ok(Math.abs((s1.record.tempoBpm ?? 0) - 100) < 4, `bpm=${s1.record.tempoBpm}`));
  check("sections detected", () => assert.ok(s1.record.sections.length >= 2, `${s1.record.sections.length} sections: ${s1.record.sections.map((x) => x.label).join(",")}`));
  check("lag-free: live chord available within 1 s of start", () => assert.ok(samples[0].t < 8, `first sample at ${samples[0]?.t}`));

  // persistence: reload and check the saved analysis comes back
  await driver.get(`http://localhost:${PORT}/watch?v=${VID}`);
  await driver.wait(async () => { const s = await state(); return s?.st?.known === true; }, 15000, "saved analysis not found after reload").catch((e) => results.push(["FAIL", e.message]));
  const s2 = await state();
  check("analysis reloaded from IndexedDB", () => assert.ok(s2?.st?.known && s2.record.chords.length === s1.record.chords.length, `known=${s2?.st?.known} chords=${s2?.record?.chords?.length}`));
  check("frames reloaded", () => assert.ok(s2.frames > 400, `frames=${s2.frames}`));

  // user edit survives re-analysis
  await cmd({ type: "edit", msg: { type: "editChord", index: 2, chord: { root: 5, quality: "maj" } } });
  await sleep(800);
  await cmd({ type: "reanalyze" });
  await sleep(1500);
  const s3 = await state();
  check("user edit survives re-analysis", () => assert.ok(s3.record.chords.some((c) => c.source === "user" && c.root === 5), "edit lost"));
} catch (e) {
  results.push(["FAIL", `harness: ${e.message}`]);
} finally {
  await driver.quit().catch(() => {});
  server.close();
}
for (const [r, n] of results) { console.log(r, n); if (r === "FAIL") failed = true; }
process.exit(failed ? 1 : 0);
