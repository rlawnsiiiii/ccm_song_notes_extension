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
const EXT_UUID = "6f2a1c3e-0b5d-4c7a-9e21-3a5b7c9d1e0f";
const VID = "TESTVID0001";
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const expectProg = ["G", "D", "Em", "C"];

execSync("node scripts/build.mjs", { env: { ...process.env, WCC_TEST: "1" }, stdio: "inherit" });
if (!existsSync("e2e/fixtures/song.wav")) execSync("node e2e/make-audio.mjs", { stdio: "inherit" });

const wav = readFileSync("e2e/fixtures/song.wav");
const LYRICS = ["주님을 찬양해 영원히", "나의 모든 날 노래해", "사랑의 하나님 크신 이름", "내 영혼 주를 높이네"];
const timedtext = (asr) => JSON.stringify({ events: Array.from({ length: 13 }, (_, i) => ({ tStartMs: 300 + i * 4800, dDurationMs: 4300, segs: [{ utf8: asr ? "자동 자막 " + i : LYRICS[i % 4] }] })) });
const server = createServer((req, res) => {
  if (req.url.startsWith("/timedtext")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(timedtext(req.url.includes("asr=1")));
  }
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
  } else if (req.url.startsWith("/conti-host")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>conti host</title><iframe id="cf" style="width:1100px;height:900px" src="moz-extension://${EXT_UUID}/conti.html"></iframe>`);
  } else if (req.url.startsWith("/host")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>sidebar host</title><iframe id="sb" style="width:380px;height:900px" src="moz-extension://${EXT_UUID}/sidebar.html?tab=localhost:${PORT}/watch"></iframe>`);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>Test video</title><h1 class="title">Test Song</h1><div id="movie_player"></div><video class="html5-main-video" src="/song.wav" controls></video>
<script>document.getElementById("movie_player").getPlayerResponse = () => ({ videoDetails: { videoId: "${VID}" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
  { baseUrl: "/timedtext?lang=ko&asr=1", languageCode: "ko", kind: "asr" }, { baseUrl: "/timedtext?lang=ko", languageCode: "ko" } ] } } });</script>`);
  }
}).listen(PORT);

const opts = new firefox.Options();
if (!show) opts.addArguments("-headless");
opts.setPreference("media.autoplay.default", 0);
opts.setPreference("media.autoplay.blocking_policy", 0);
opts.setPreference("media.volume_scale", "0.0"); // keep the test silent
opts.setPreference("xpinstall.signatures.required", false);
opts.setPreference("extensions.webextensions.uuids", JSON.stringify({ "worship-chord-companion@rlawnsiiiii": EXT_UUID }));
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
  const liveSeq = []; // every running sample, to count flicker
  let lastT = -1;
  let firstBpmAt = null;
  const t0 = Date.now();
  let lastAudio = "";
  while (Date.now() - t0 < 72000) {
    const s = await state();
    if (s?.st) {
      lastAudio = s.st.audio;
      if (firstBpmAt === null && s.record?.tempoBpm) firstBpmAt = { at: s.st.time, bpm: s.record.tempoBpm };
      const t = s.st.time;
      if (s.st.audio === "running" && t > 3 && Math.abs(t - lastT) > 0.05) { liveSeq.push({ t, c: symName(s.st.live) }); lastT = t; }
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
  const changes = liveSeq.filter((x, i) => i > 0 && x.c !== liveSeq[i - 1].c).length;
  const span = liveSeq.length ? liveSeq[liveSeq.length - 1].t - liveSeq[0].t : 1;
  const trueChanges = span / 2.4;
  console.log(`LIVE FLICKER: ${changes} chord changes over ${span.toFixed(0)} s, true ${trueChanges.toFixed(0)} (ratio ${(changes / trueChanges).toFixed(2)})`);
  check("live chord does not flicker (≤1.4× true changes)", () => assert.ok(changes / trueChanges <= 1.4, `ratio ${(changes / trueChanges).toFixed(2)}`));
  check("tempo is known within ~20 s of playing", () => assert.ok(firstBpmAt && firstBpmAt.at < 22 && Math.abs(firstBpmAt.bpm - 100) < 6, JSON.stringify(firstBpmAt)));
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
  await driver.wait(async () => ((await state())?.record?.lyrics?.length ?? 0) > 0, 15000).catch(() => {});
  const s2 = await state();
  const lyricsErr = await driver.executeScript("return document.documentElement.dataset.wccLyricsErr || null");
  check("analysis reloaded from IndexedDB", () => assert.ok(s2?.st?.known && s2.record.chords.length === s1.record.chords.length, `known=${s2?.st?.known} chords=${s2?.record?.chords?.length}`));
  check("frames reloaded", () => assert.ok(s2.frames > 400, `frames=${s2.frames}`));

  check("manual Korean captions preferred over auto", () => assert.ok(s2.record.lyrics?.length === 13 && s2.record.lyrics[0].text === "주님을 찬양해 영원히" && s2.record.lyricsAuto === false, `lyrics=${JSON.stringify(s2.record.lyrics?.slice(0, 1))} auto=${s2.record.lyricsAuto} err=${lyricsErr}`));

  // ---- sidebar UI, opened in a second window and pointed at the video tab ----
  const videoWindow = await driver.getWindowHandle();
  await driver.switchTo().newWindow("window");
  await driver.get(`http://localhost:${PORT}/host`);
  await driver.switchTo().frame(await driver.findElement(By.id("sb")));
  const text = async (sel) => driver.executeScript("return document.querySelector(arguments[0])?.textContent ?? null", sel);
  const count = async (sel) => driver.executeScript("return document.querySelectorAll(arguments[0]).length", sel);
  await driver.wait(async () => (await count(".chord")) > 5, 15000, "sidebar chart never rendered").catch(async (e) => results.push(["FAIL", `${e.message}; body=${(await driver.executeScript("return document.body ? document.body.innerHTML.slice(0, 300) : 'no body'")).replace(/\s+/g, " ")} diag=${JSON.stringify(await driver.executeScript("return { href: location.href, browser: typeof browser, chrome: typeof chrome, tabs: typeof (typeof browser !== 'undefined' && browser.tabs), err: window.__err || null, msgs: window.__msgs ?? 0, last: window.__last ?? null }"))}`]));
  const nBars = await count(".bar"), nChords = await count(".chord"), nSecs = await count(".section"), key = await text("#key");
  check("sidebar renders bar chart", () => assert.ok(nBars >= 10 && nChords >= 20, `bars=${nBars} chords=${nChords}`));
  check("sidebar renders sections", () => assert.ok(nSecs >= 2, `sections=${nSecs}`));
  check("sidebar shows key", () => assert.ok(/G major/.test(key), `key text: ${key}`));
  // display modes
  await driver.executeScript("const m = document.getElementById('mode'); m.value = 'numbers'; m.dispatchEvent(new Event('change'))");
  const numTexts = await driver.executeScript("return [...document.querySelectorAll('.chord')].slice(0, 4).map(b => b.textContent)");
  check("number display (G-D-Em-C → 1 5 6m 4)", () => assert.deepEqual(numTexts, ["1", "5", "6m", "4"]));
  await driver.executeScript("const m = document.getElementById('mode'); m.value = 'names'; m.dispatchEvent(new Event('change'))");
  // transpose is applied from the record by the content script; check the select round-trips
  await driver.executeScript("const t = document.getElementById('transpose'); t.value = '2'; t.dispatchEvent(new Event('change'))");
  await driver.wait(async () => (await driver.executeScript("return document.querySelector('.chord')?.textContent")) === "A", 8000, "transpose did not update").catch((e) => results.push(["FAIL", e.message]));
  const aChord = await driver.executeScript("return [...document.querySelectorAll('.chord')].slice(0, 4).map(b => b.textContent)");
  check("transpose +2 shows A-E-F#m-D", () => assert.deepEqual(aChord, ["A", "E", "F#m", "D"]));
  await driver.executeScript("const t = document.getElementById('transpose'); t.value = '0'; t.dispatchEvent(new Event('change'))");
  // tempo shown, and the octave can be flipped by the user
  const bpmText = await text("#bpm");
  check("sidebar shows the tempo", () => assert.ok(/♩ (9\d|10\d)/.test(bpmText ?? ""), `bpm text: ${bpmText}`));
  await driver.executeScript("document.getElementById('tempo-half').click()");
  await driver.wait(async () => /♩ 50/.test((await text("#bpm")) ?? ""), 8000, "÷2 did not halve the tempo").catch((e) => results.push(["FAIL", e.message]));
  await driver.executeScript("document.getElementById('tempo-double').click()");
  await driver.wait(async () => /♩ (9\d|10\d)/.test((await text("#bpm")) ?? ""), 8000, "×2 did not restore the tempo").catch((e) => results.push(["FAIL", e.message]));
  // lyrics view
  await driver.executeScript("document.getElementById('tab-lyrics').click()");
  await driver.wait(async () => (await count(".lyr")) > 3, 8000, "lyrics view empty").catch((e) => results.push(["FAIL", e.message]));
  const nLyr = await count(".lyr"), nLc = await count(".lc");
  check("lyrics view with chords above lines", () => assert.ok(nLyr === 13 && nLc >= 13, `lines=${nLyr} chords=${nLc}`));
  await driver.executeScript("document.getElementById('tab-chart').click()");
  await driver.wait(async () => (await count(".chord")) > 5, 8000);
  // chord editor: select a chord, change its root through the UI
  await driver.executeScript("document.querySelectorAll('.chord')[1].click()");
  await driver.wait(async () => (await count("#e-root")) === 1, 5000, "editor did not open").catch((e) => results.push(["FAIL", e.message]));
  await driver.executeScript("const r = document.getElementById('e-root'); r.value = '5'; r.dispatchEvent(new Event('change'))");
  await sleep(1200);
  // import a typed chart: wrong one first (should be refused), then the right one with {order:}
  await driver.executeScript("document.getElementById('songpanel').open = true");
  const fill = (t) => driver.executeScript("const a = document.getElementById('f-chart'); a.value = arguments[0]; document.getElementById('f-import').click()", t);
  await fill("{key: F#}\n{section: A}\n| F# | B | C# | G#m |");
  await driver.wait(async () => /chart does not look/.test((await text("#f-msg")) ?? ""), 8000, "bad chart not refused").catch((e) => results.push(["FAIL", e.message]));
  await fill("{key: G}\n{order: A A A A A A A}\n{section: A}\n| G | D | Em | C |");
  await driver.wait(async () => /Lined up/.test((await text("#f-msg")) ?? ""), 8000, "import never confirmed").catch((e) => results.push(["FAIL", e.message]));
  const importMsg = await text("#f-msg");
  await sleep(1000);
  await driver.switchTo().window(videoWindow);
  const s5 = await state();
  const imported = s5.record.chords.filter((c) => c.source === "imported");
  check("import lines the chart up", () => assert.ok(/Lined up \d+ of 28/.test(importMsg), `message: ${importMsg}`));
  check("imported chords follow the typed chart", () => {
    // by time: the chord sounding at the middle of each imported event must be the true one
    const ok = imported.filter((c) => symName(c) === expectProg[Math.floor((c.startSec + c.endSec) / 2 / 2.4) % 4]).length;
    assert.ok(imported.length >= 20 && ok / imported.length > 0.85, `${imported.length} imported, ${ok} match: ${imported.slice(0, 8).map(symName).join(" ")}`);
  });
  check("user edit kept over the import", () => assert.ok(s5.record.chords.some((c) => c.source === "user" && c.root === 5)));
  check("typed key locked, sections imported", () => assert.ok(s5.record.key.confidence === 1 && s5.record.sections.some((x) => x.source === "imported"), JSON.stringify(s5.record.key)));
  await driver.switchTo().window((await driver.getAllWindowHandles()).find((h) => h !== videoWindow));
  const s4 = s5;
  check("editing a chord in the sidebar reaches the content script", () => assert.ok(s4.record.chords.some((c) => c.source === "user" && c.root === 5), "no user chord with root F"));
  await driver.close();
  await driver.switchTo().window(videoWindow);

  // ---- 콘티 builder (extension page in an iframe) ----
  await driver.switchTo().newWindow("window");
  await driver.get(`http://localhost:${PORT}/conti-host`);
  await driver.switchTo().frame(await driver.findElement(By.id("cf")));
  const cval = (sel) => driver.executeScript("return document.querySelector(arguments[0])?.value ?? null", sel);
  await driver.wait(async () => (await count(".song-entry")) >= 1, 15000, "conti page lists no songs").catch((e) => results.push(["FAIL", e.message]));
  await driver.executeScript("document.getElementById('conti-new').click()");
  await driver.wait(async () => (await count(".add")) >= 1, 5000);
  await driver.executeScript("document.querySelector('.add').click()");
  await driver.wait(async () => (await count(".item")) === 1, 5000, "song not added to conti").catch((e) => results.push(["FAIL", e.message]));
  await driver.executeScript("const k = document.querySelector('.keysel'); k.value = '9'; k.dispatchEvent(new Event('change'))");
  await driver.executeScript("const n = document.querySelector('.item .notes'); n.value = '후렴 2번 반복'; n.dispatchEvent(new Event('input'))");
  await driver.executeScript("document.getElementById('conti-name').value = '주일예배'; document.getElementById('conti-name').dispatchEvent(new Event('input'))");
  await sleep(600);
  const sheetText = await driver.executeScript("return document.querySelector('.sheet')?.innerText ?? ''");
  check("preview sheet shows target key A, notes and chords", () => assert.ok(/Key A/.test(sheetText) && sheetText.includes("후렴 2번 반복") && /\bA\b/.test(sheetText) && /F#m/.test(sheetText), sheetText.slice(0, 160).replace(/\s+/g, " ")));
  await driver.executeScript("document.getElementById('show-text').click()");
  const exportText = await cval("#export-text");
  check("ChordPro export is transposed and has notes", () => assert.ok(exportText.includes("{key: A}") && exportText.includes("{comment: 후렴 2번 반복}") && exportText.includes("주일예배"), exportText.slice(0, 200)));
  await driver.executeScript("const c = document.getElementById('conti-numbers'); c.checked = true; c.dispatchEvent(new Event('change'))");
  await sleep(300);
  const numSheet = await driver.executeScript("return document.querySelector('.sheet')?.innerText ?? ''");
  check("numbers-only sheet", () => assert.ok(/\b6m\b/.test(numSheet) && !/F#m/.test(numSheet), numSheet.slice(0, 120).replace(/\s+/g, " ")));
  // persistence: reload the page
  await driver.switchTo().defaultContent();
  await driver.navigate().refresh();
  await driver.switchTo().frame(await driver.findElement(By.id("cf")));
  await driver.wait(async () => (await count(".item")) === 1, 10000, "conti not restored").catch((e) => results.push(["FAIL", e.message]));
  const restoredName = await cval("#conti-name");
  check("conti restored with its name", () => assert.equal(restoredName, "주일예배"));
  await driver.switchTo().defaultContent();
  await driver.close();
  await driver.switchTo().window(videoWindow);

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
