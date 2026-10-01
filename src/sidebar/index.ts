import type { StatusMsg, ToContent } from "../shared/messages";
import { isToSidebar } from "../shared/messages";
import type { ChordEvent, ChordQuality, PitchClass, SongRecord } from "../shared/types";
import { buildBars } from "../analysis/bars";
import { placeChords } from "../music/lyrics";
import { searchUrls } from "../music/title";
import { chordName, chordNumber, prefersFlats, noteName, mod12, simplifyQuality, QUALITY_SUFFIX } from "../music/theory";

const QUALITIES: ChordQuality[] = ["maj", "min", "7", "maj7", "m7", "sus4", "sus2", "add9", "dim", "aug"];

type DisplayMode = "names" | "numbers" | "both";
const prefs = { mode: "names" as DisplayMode, simplify: false, view: "chart" as "chart" | "lyrics" };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("wcc-prefs") ?? "{}")); } catch { /* ignore */ }
const savePrefs = () => { try { localStorage.setItem("wcc-prefs", JSON.stringify(prefs)); } catch { /* ignore */ } };

let tabId: number | null = null;
let status: StatusMsg | null = null;
let record: SongRecord | null = null;

const $app = document.getElementById("app")!;

declare const __WCC_TEST__: boolean;

/**
 * Extension pages embedded in a web page (only the automated test does this) get no tabs API,
 * so test builds route the three tabs calls we use through the background script.
 */
const tabsApi: Pick<typeof browser.tabs, "query" | "sendMessage"> = (typeof browser.tabs !== "undefined" ? browser.tabs : null) ?? {
  query: (q: any) => browser.runtime.sendMessage({ type: "test:tabs.query", q }),
  sendMessage: (id: number, m: any) => browser.runtime.sendMessage({ type: "test:tabs.send", id, m }),
} as any;

async function findTab(): Promise<void> {
  // Test builds can open the sidebar as a normal tab and point it at another tab: ?tab=<url fragment>
  const want = __WCC_TEST__ ? new URLSearchParams(location.search).get("tab") : null;
  const tabs = want ? (await tabsApi.query({})).filter((x) => x.url?.includes(want)) : await tabsApi.query({ active: true, currentWindow: true });
  const t = tabs[0];
  tabId = t?.id !== undefined && t.url && (/^https?:\/\/www\.youtube\.com\//.test(t.url) || (__WCC_TEST__ && !!want)) ? t.id : null;
  status = null; record = null;
  if (tabId !== null) { const s = await send({ type: "hello" }); if (s) status = s; }
  render();
}

async function send(m: ToContent): Promise<StatusMsg | null> {
  if (tabId === null) return null;
  try { return (await tabsApi.sendMessage(tabId, m)) as StatusMsg; } catch { return null; }
}

function onBroadcast(m: unknown, senderTabId: number | undefined): void {
  if (!isToSidebar(m) || senderTabId !== tabId) return;
  if (m.type === "status") { status = m; updateLive(); }
  else {
    const fresh = !record || !m.record || record.videoId !== m.record.videoId;
    record = m.record;
    if (fresh || !document.getElementById("chart")) render();
    else { const t = document.getElementById("title"); if (t) t.textContent = record?.title ?? ""; updateLive(); renderChart(); }
  }
}
browser.runtime.onMessage.addListener((m: unknown, sender) => { onBroadcast(m, sender.tab?.id); });

if (__WCC_TEST__ && typeof browser.tabs === "undefined") {
  // embedded test frames do not receive runtime broadcasts; poll what the background has seen
  let songVersion = -1;
  setInterval(async () => {
    if (tabId === null) return;
    const r = (await browser.runtime.sendMessage({ type: "test:poll", tabId })) as { status?: unknown; song?: unknown; version: number } | undefined;
    if (!r) return;
    if (r.status) onBroadcast(r.status, tabId);
    if (r.song && r.version !== songVersion) { songVersion = r.version; onBroadcast(r.song, tabId); }
  }, 250);
}
if (typeof browser.tabs !== "undefined") {
  browser.tabs.onActivated.addListener(() => void findTab());
  browser.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === "complete") void findTab(); });
}

// ---- formatting ----
function display(c: ChordEvent | StatusMsg["live"], r: SongRecord | null): string {
  if (!c) return "–";
  const key = r?.key;
  const tr = r?.transpose ?? 0;
  const q = c.quality && prefs.simplify ? simplifyQuality(c.quality) : c.quality;
  const sym = { root: c.root, quality: q, ...(prefs.simplify || c.bass === undefined ? {} : { bass: c.bass }) };
  const flats = key ? prefersFlats(mod12(key.tonic + tr), key.mode) : false;
  const name = chordName(sym, flats, tr);
  const num = key ? chordNumber(sym, key.tonic, key.mode) : name;
  return prefs.mode === "names" ? name : prefs.mode === "numbers" ? num : `${name} · ${num}`;
}

function keyText(r: SongRecord | null, s: StatusMsg | null): string {
  const k = r && r.key.confidence ? r.key : s?.key;
  if (!k) return "key: …";
  const tr = r?.transpose ?? 0;
  const t = mod12(k.tonic + tr);
  return `${noteName(t, prefersFlats(t, k.mode))} ${k.mode} (${Math.round(k.confidence * 100)}%)`;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---- rendering ----
function render(): void {
  if (tabId === null) {
    $app.innerHTML = `<p class="muted">Open a YouTube video in the active tab.</p>`;
    return;
  }
  $app.innerHTML = `
    <header>
      <div class="title" id="title">${esc(record?.title ?? status?.title ?? "")}</div>
      <div class="row">
        <button id="connect" class="primary"></button>
        <span id="state" class="muted"></span>
      </div>
    </header>
    <section class="now">
      <div class="cur"><div class="label">now</div><div id="cur" class="big">–</div></div>
      <div class="nxt"><div class="label">next</div><div id="nxt" class="mid">–</div></div>
    </section>
    <section class="meta">
      <span id="key"></span>
      <label>transpose <select id="transpose">${Array.from({ length: 25 }, (_, i) => i - 12)
        .map((n) => `<option value="${n}" ${n === (record?.transpose ?? 0) ? "selected" : ""}>${n > 0 ? "+" : ""}${n}</option>`).join("")}</select></label>
      <label>show <select id="mode">
        ${(["names", "numbers", "both"] as DisplayMode[]).map((m) => `<option ${m === prefs.mode ? "selected" : ""}>${m}</option>`).join("")}
      </select></label>
      <label><input type="checkbox" id="simplify" ${prefs.simplify ? "checked" : ""}> simple</label>
    </section>
    <section class="viz">
      <div class="meter"><div id="level"></div></div>
      <div class="chroma" id="chroma">${Array.from({ length: 12 }, (_, i) => `<div><i></i><b>${noteName(i, false)}</b></div>`).join("")}</div>
    </section>
    <section class="controls">
      <label>speed <select id="rate">${[0.5, 0.75, 0.9, 1, 1.25].map((r) => `<option value="${r}">${r}×</option>`).join("")}</select></label>
      <span id="loopinfo" class="muted"></span>
    </section>
    <details class="song" id="songpanel">
      <summary>Song info · reference · import chart</summary>
      <div class="row"><input id="f-title" placeholder="title" value="${esc(record?.title ?? "")}"><input id="f-artist" placeholder="artist" value="${esc(record?.artist ?? "")}"></div>
      <div class="row" id="searches">${searchUrls(record?.title ?? "", record?.artist).map((u) => `<button class="search" data-url="${esc(u.url)}">${esc(u.label)} ↗</button>`).join("")}</div>
      <p class="muted">Opens a web search in a new tab. Nothing is downloaded or copied automatically.</p>
      <textarea id="f-chart" rows="6" placeholder="Paste a chart you already have (ChordPro or bars):&#10;{key: G}&#10;{order: 전주 1절 후렴 1절 후렴}&#10;{section: 전주}&#10;| G | D/F# | Em7 | C |"></textarea>
      <div class="row"><button id="f-import">Import &amp; line up</button><span id="f-msg" class="muted"></span></div>
    </details>
    <section class="tabs"><button id="tab-chart" class="${prefs.view === 'chart' ? 'on' : ''}">Chart</button><button id="tab-lyrics" class="${prefs.view === 'lyrics' ? 'on' : ''}">Lyrics</button></section>
    <section id="chart"></section>
    <section class="foot">
      <button id="reanalyze">Re-analyze</button>
      <button id="export">Export</button>
      <button id="import">Import</button>
      <button id="conti">콘티</button>
      <input type="file" id="file" accept="application/json" hidden>
    </section>`;
  bind();
  updateLive();
  renderChart();
}

function bind(): void {
  const $ = (id: string) => document.getElementById(id)!;
  $("connect").onclick = async () => { const s = await send({ type: status?.connected ? "disconnect" : "connect" }); if (s) status = s; updateLive(); };
  ($("transpose") as HTMLSelectElement).onchange = (e) => void send({ type: "setTranspose", semitones: +(e.target as HTMLSelectElement).value });
  ($("mode") as HTMLSelectElement).onchange = (e) => { prefs.mode = (e.target as HTMLSelectElement).value as DisplayMode; savePrefs(); updateLive(); renderChart(); };
  ($("simplify") as HTMLInputElement).onchange = (e) => { prefs.simplify = (e.target as HTMLInputElement).checked; savePrefs(); updateLive(); renderChart(); };
  ($("rate") as HTMLSelectElement).value = String(status?.rate ?? 1);
  ($("rate") as HTMLSelectElement).onchange = (e) => void send({ type: "setRate", rate: +(e.target as HTMLSelectElement).value });
  const saveInfo = () => void send({ type: "setTitle", title: ($("f-title") as HTMLInputElement).value, artist: ($("f-artist") as HTMLInputElement).value });
  $("f-title").onchange = saveInfo;
  $("f-artist").onchange = saveInfo;
  document.querySelectorAll<HTMLButtonElement>(".search").forEach((b) => { b.onclick = () => void browser.tabs.create({ url: b.dataset.url! }); });
  $("f-import").onclick = async () => {
    const msg = $("f-msg");
    msg.textContent = "…";
    const r = await send({ type: "importChart", text: ($("f-chart") as HTMLTextAreaElement).value });
    msg.textContent = r?.importResult?.message ?? "Could not reach the page.";
    msg.className = r?.importResult?.ok ? "ok" : "warn";
  };
  $("tab-chart").onclick = () => { prefs.view = "chart"; savePrefs(); render(); };
  $("tab-lyrics").onclick = () => { prefs.view = "lyrics"; savePrefs(); render(); };
  $("reanalyze").onclick = () => void send({ type: "reanalyze" });
  $("export").onclick = () => void exportBackup();
  $("import").onclick = () => $("file").click();
  $("conti").onclick = () => void browser.tabs.create({ url: browser.runtime.getURL("conti.html") });
  ($("file") as HTMLInputElement).onchange = (e) => void importBackup((e.target as HTMLInputElement).files?.[0]);
}

const AUDIO_TEXT: Record<StatusMsg["audio"], string> = {
  idle: "not listening", running: "listening", suspended: "audio blocked – click the video, then Connect",
  ad: "ad playing – paused", paused: "video paused", error: "error",
};

function updateLive(): void {
  const s = status;
  const set = (id: string, v: string) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
  const btn = document.getElementById("connect");
  if (!btn) return;
  btn.textContent = s?.connected ? "Disconnect" : "Connect";
  set("state", s ? (s.error ? `${AUDIO_TEXT[s.audio]}: ${s.error}` : AUDIO_TEXT[s.audio]) + (s.known ? " · saved" : "") : "…");
  set("key", keyText(record, s));
  if (!s) return;
  const chords = record?.chords ?? [];
  const cur = s.liveChordIdx >= 0 ? chords[s.liveChordIdx] : undefined;
  const useLive = s.audio === "running" && (!cur || cur.source === "detected") && s.live;
  set("cur", display(useLive ? s.live : cur ?? null, record));
  set("nxt", s.nextChordIdx >= 0 ? display(chords[s.nextChordIdx]!, record) : "–");
  const lv = document.getElementById("level");
  if (lv) lv.style.width = `${Math.round(s.level * 100)}%`;
  document.querySelectorAll<HTMLElement>("#chroma > div").forEach((d, i) => {
    (d.firstElementChild as HTMLElement).style.height = `${Math.round((s.chroma[i] ?? 0) * 100)}%`;
  });
  set("loopinfo", s.loop ? `loop ${fmtTime(s.loop[0])}–${fmtTime(s.loop[1])}` : "");
  highlightChart(s.liveChordIdx);
  highlightLyric(s.time);
}

// ---- chart ----
let lastHighlight = -2;
let selected: number | null = null;

function chordButton(c: ChordEvent, i: number): string {
  const cls = ["chord", c.source !== "detected" ? "edited" : "", c.confidence < 0.55 ? "weak" : "", i === selected ? "sel" : ""].join(" ");
  return `<button class="${cls}" data-i="${i}" title="${fmtTime(c.startSec)}">${esc(display(c, record))}</button>`;
}

function renderLyrics(el: HTMLElement): void {
  const lines = record?.lyrics ?? [];
  const chords = record?.chords ?? [];
  if (lines.length === 0) {
    el.innerHTML = `<p class="muted">No Korean captions found for this video.</p><button id="refetch">Look again</button>`;
    document.getElementById("refetch")!.onclick = () => void send({ type: "fetchLyrics" });
    return;
  }
  const nudge: Record<number, number> = {};
  chords.forEach((c, i) => { const n = record?.lyricNudge?.[c.startSec.toFixed(1)]; if (n) nudge[i] = n; });
  const note = record?.lyricsAuto ? `<p class="muted">Auto-generated captions: lines may be inaccurate. Chord positions inside a line are approximate – click a chord, then ◀ ▶ to nudge.</p>` : `<p class="muted">Chord positions inside a line are approximate – click a chord, then ◀ ▶ to nudge.</p>`;
  const rows = lines.map((l, li) => {
    const placed = placeChords(l, chords, nudge, (i) => Math.ceil([...display(chords[i]!, record)].length * 0.7));
    const chars = [...l.text];
    const at = new Map(placed.map((p) => [p.col, p.eventIndex]));
    let html = "";
    for (let c = 0; c <= chars.length; c++) {
      const ei = at.get(c);
      const chord = ei !== undefined ? `<button class="lc ${ei === selected ? "sel" : ""}" data-i="${ei}">${esc(display(chords[ei]!, record))}</button>` : "";
      if (c === chars.length) { if (chord) html += `<span class="cw">${chord}&nbsp;</span>`; }
      else html += `<span class="cw">${chord}${esc(chars[c]!)}</span>`;
    }
    return `<div class="lyr" data-li="${li}" data-start="${l.startSec}"><div class="ltext">${html}</div></div>`;
  }).join("");
  const selChord = selected !== null ? chords[selected] : undefined;
  el.innerHTML = `${note}<div class="lyrics">${rows}</div>${selChord ? `<div class="editor"><div class="row"><b>${esc(display(selChord, record))}</b>
    <button id="ln-l">◀</button><button id="ln-r">▶</button><button id="ln-0">reset</button></div></div>` : ""}`;
  el.querySelectorAll<HTMLElement>(".lyr").forEach((d) => { d.onclick = (e) => { if (!(e.target as HTMLElement).closest(".lc")) void send({ type: "seek", sec: +d.dataset.start! }); }; });
  el.querySelectorAll<HTMLButtonElement>(".lc").forEach((b) => { b.onclick = () => { const i = +b.dataset.i!; selected = selected === i ? null : i; renderChart(); }; });
  if (selChord) {
    const key = selChord.startSec.toFixed(1);
    const cur = record?.lyricNudge?.[key] ?? 0;
    document.getElementById("ln-l")!.onclick = () => void send({ type: "setLyricNudge", key, chars: cur - 1 });
    document.getElementById("ln-r")!.onclick = () => void send({ type: "setLyricNudge", key, chars: cur + 1 });
    document.getElementById("ln-0")!.onclick = () => void send({ type: "setLyricNudge", key, chars: 0 });
  }
  lastLyric = -2;
  highlightLyric(status?.time ?? 0);
}

let lastLyric = -2;
function highlightLyric(t: number): void {
  const lines = record?.lyrics;
  if (!lines || prefs.view !== "lyrics") return;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.startSec <= t) idx = i; else break;
  if (idx === lastLyric) return;
  lastLyric = idx;
  document.querySelectorAll(".lyr.on").forEach((e) => e.classList.remove("on"));
  const el = document.querySelector<HTMLElement>(`.lyr[data-li="${idx}"]`);
  if (el) { el.classList.add("on"); el.scrollIntoView({ block: "center" }); }
}

function renderChart(): void {
  const el = document.getElementById("chart");
  if (!el) return;
  if (prefs.view === "lyrics") { renderLyrics(el); return; }
  const chords = record?.chords ?? [];
  if (chords.length === 0) { el.innerHTML = `<p class="muted">Play the video with the sidebar connected to build the chart.</p>`; return; }
  let body: string;
  if (record?.beats && record.downbeat !== undefined && record.tempoBpm) {
    const bars = buildBars(chords, { bpm: record.tempoBpm, offset: record.beats[0] ?? 0, beats: record.beats, downbeat: record.downbeat, beatsPerBar: record.beatsPerBar ?? 4 }, record.durationSec);
    const barHtml = (b: (typeof bars)[number], n: number) =>
      `<div class="bar" data-start="${b.startSec.toFixed(2)}" data-end="${b.endSec.toFixed(2)}"><span class="barno">${n + 1}</span>${b.chords.map((x) => chordButton(chords[x.eventIndex]!, x.eventIndex)).join("")}</div>`;
    const secs = record.sections;
    if (secs.length === 0) body = `<div class="bars">${bars.map(barHtml).join("")}</div>`;
    else {
      const used = new Set<number>();
      body = secs.map((sec, si) => {
        const mine = bars.map((b, n) => ({ b, n })).filter(({ b }) => (b.startSec + b.endSec) / 2 >= sec.startSec && (b.startSec + b.endSec) / 2 < sec.endSec);
        mine.forEach(({ n }) => used.add(n));
        return `<div class="section" data-si="${si}"><div class="sechead">
          <input class="seclabel" data-si="${si}" value="${esc(sec.label)}" size="8">
          <span class="muted">${fmtTime(sec.startSec)}</span>
          <button class="secloop" data-si="${si}" title="Loop this section">⟲</button>
          <button class="secsplit" data-si="${si}" title="Split at the selected chord">✂</button>
          <button class="secmerge" data-si="${si}" title="Merge with next section">⇣</button></div>
          <div class="bars">${mine.map(({ b, n }) => barHtml(b, n)).join("")}</div></div>`;
      }).join("") + (() => { const rest = bars.map((b, n) => ({ b, n })).filter(({ n }) => !used.has(n)); return rest.length ? `<div class="bars">${rest.map(({ b, n }) => barHtml(b, n)).join("")}</div>` : ""; })();
    }
  } else {
    body = `<div class="grid">${chords.map((c, i) => chordButton(c, i)).join("")}</div>`;
  }
  const kc = (record?.keyChanges ?? []).map((k) => {
    const t = mod12(k.tonic + record!.transpose);
    return `전조 → ${noteName(t, prefersFlats(t, k.mode))}${k.mode === "minor" ? "m" : ""} @ ${fmtTime(k.atSec)}`;
  }).join(" · ");
  el.innerHTML = `${record?.tempoBpm ? `<div class="muted">${record.tempoBpm} BPM${kc ? " · " + esc(kc) : ""}</div>` : ""}${body}<div id="editor"></div>`;
  el.querySelectorAll<HTMLButtonElement>(".chord").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i!;
      selected = selected === i ? null : i;
      const c = chords[i];
      if (c && selected !== null) void send({ type: "seek", sec: c.startSec });
      renderChart();
    };
  });
  bindSections();
  renderEditor();
  lastHighlight = -2;
  highlightChart(status?.liveChordIdx ?? -1);
}

function bindSections(): void {
  const secs = record?.sections ?? [];
  const commit = (next: typeof secs) => void send({ type: "setSections", sections: next });
  document.querySelectorAll<HTMLInputElement>(".seclabel").forEach((inp) => {
    inp.onchange = () => {
      const si = +inp.dataset.si!;
      commit(secs.map((x, i) => (i === si ? { ...x, label: inp.value, source: "user" as const } : x)));
    };
  });
  document.querySelectorAll<HTMLButtonElement>(".secloop").forEach((b) => {
    b.onclick = () => { const x = secs[+b.dataset.si!]; if (x) { void send({ type: "setLoop", range: [x.startSec, x.endSec] }); void send({ type: "seek", sec: x.startSec }); } };
  });
  document.querySelectorAll<HTMLButtonElement>(".secmerge").forEach((b) => {
    b.onclick = () => {
      const si = +b.dataset.si!;
      const a = secs[si], n = secs[si + 1];
      if (!a || !n) return;
      commit([...secs.slice(0, si), { ...a, endSec: n.endSec, source: "user" as const }, ...secs.slice(si + 2)]);
    };
  });
  document.querySelectorAll<HTMLButtonElement>(".secsplit").forEach((b) => {
    b.onclick = () => {
      const si = +b.dataset.si!;
      const x = secs[si];
      const at = selected !== null ? record?.chords[selected]?.startSec : undefined;
      if (!x || at === undefined || at <= x.startSec + 0.5 || at >= x.endSec - 0.5) { alert("Select a chord inside this section first."); return; }
      commit([...secs.slice(0, si), { ...x, endSec: at, source: "user" as const }, { ...x, startSec: at, label: x.label, source: "user" as const }, ...secs.slice(si + 1)]);
    };
  });
}

function renderEditor(): void {
  const el = document.getElementById("editor");
  const c = selected !== null ? record?.chords[selected] : undefined;
  if (!el || !c || selected === null) { if (el) el.innerHTML = ""; return; }
  const idx = selected;
  const key = record!.key;
  const flats = prefersFlats(mod12(key.tonic + record!.transpose), key.mode);
  const note = (pc: number) => noteName(pc + record!.transpose, flats);
  const roots = `<option value="-1" ${c.root === null ? "selected" : ""}>N.C.</option>` +
    Array.from({ length: 12 }, (_, pc) => `<option value="${pc}" ${c.root === pc ? "selected" : ""}>${note(pc)}</option>`).join("");
  const quals = QUALITIES.map((q) => `<option value="${q}" ${c.quality === q ? "selected" : ""}>${QUALITY_SUFFIX[q] || "maj"}</option>`).join("");
  const basses = `<option value="-1">–</option>` +
    Array.from({ length: 12 }, (_, pc) => `<option value="${pc}" ${c.bass === pc ? "selected" : ""}>${note(pc)}</option>`).join("");
  el.innerHTML = `<div class="editor">
    <div class="row"><b>${fmtTime(c.startSec)}–${fmtTime(c.endSec)}</b>
      <select id="e-root">${roots}</select><select id="e-q">${quals}</select> / <select id="e-bass">${basses}</select></div>
    <div class="row">
      <button id="e-split">Split here</button><button id="e-merge">Merge next</button>
      <button id="e-la">Loop from here</button><button id="e-lb">Loop to here end</button><button id="e-lc">Clear loop</button>
    </div></div>`;
  const apply = () => {
    const root = +(document.getElementById("e-root") as HTMLSelectElement).value;
    const q = (document.getElementById("e-q") as HTMLSelectElement).value as ChordQuality;
    const bass = +(document.getElementById("e-bass") as HTMLSelectElement).value;
    void send({ type: "editChord", index: idx, chord: root < 0 ? { root: null, quality: null } : { root: root as PitchClass, quality: q, ...(bass >= 0 ? { bass: bass as PitchClass } : {}) } });
  };
  for (const id of ["e-root", "e-q", "e-bass"]) document.getElementById(id)!.onchange = apply;
  document.getElementById("e-split")!.onclick = () => void send({ type: "splitChord", index: idx, atSec: status?.time ?? c.startSec });
  document.getElementById("e-merge")!.onclick = () => void send({ type: "mergeChordWithNext", index: idx });
  let loopA = c.startSec;
  document.getElementById("e-la")!.onclick = () => { loopA = c.startSec; void send({ type: "setLoop", range: [loopA, Math.max(c.endSec, loopA + 1)] }); };
  document.getElementById("e-lb")!.onclick = () => void send({ type: "setLoop", range: [status?.loop?.[0] ?? loopA, c.endSec] });
  document.getElementById("e-lc")!.onclick = () => void send({ type: "setLoop", range: null });
}

function highlightChart(idx: number): void {
  if (idx === lastHighlight) return;
  lastHighlight = idx;
  document.querySelectorAll(".chord.on").forEach((e) => e.classList.remove("on"));
  const b = document.querySelector<HTMLElement>(`.chord[data-i="${idx}"]`);
  if (b) { b.classList.add("on"); b.scrollIntoView({ block: "nearest" }); }
}

async function exportBackup(): Promise<void> {
  const { bundle } = (await browser.runtime.sendMessage({ type: "db:exportAll" })) as { bundle: unknown };
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = `worship-chords-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importBackup(file: File | undefined): Promise<void> {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    await browser.runtime.sendMessage({ type: "db:importAll", data });
    await findTab();
  } catch (e) { alert(`Import failed: ${e instanceof Error ? e.message : e}`); }
}

void findTab().catch((e) => { (window as any).__err = String(e); $app.textContent = `Could not start: ${e instanceof Error ? e.message : e}`; });
