import type { StatusMsg, ToContent } from "../shared/messages";
import { isToSidebar } from "../shared/messages";
import type { ChordEvent, SongRecord } from "../shared/types";
import { chordName, chordNumber, prefersFlats, noteName, mod12, simplifyQuality } from "../music/theory";

type DisplayMode = "names" | "numbers" | "both";
const prefs = { mode: "names" as DisplayMode, simplify: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("wcc-prefs") ?? "{}")); } catch { /* ignore */ }
const savePrefs = () => { try { localStorage.setItem("wcc-prefs", JSON.stringify(prefs)); } catch { /* ignore */ } };

let tabId: number | null = null;
let status: StatusMsg | null = null;
let record: SongRecord | null = null;

const $app = document.getElementById("app")!;

async function findTab(): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const t = tabs[0];
  tabId = t?.id !== undefined && t.url && /^https?:\/\/www\.youtube\.com\//.test(t.url) ? t.id : null;
  status = null; record = null;
  if (tabId !== null) { const s = await send({ type: "hello" }); if (s) status = s; }
  render();
}

async function send(m: ToContent): Promise<StatusMsg | null> {
  if (tabId === null) return null;
  try { return (await browser.tabs.sendMessage(tabId, m)) as StatusMsg; } catch { return null; }
}

browser.runtime.onMessage.addListener((m: unknown, sender) => {
  if (!isToSidebar(m) || sender.tab?.id !== tabId) return;
  if (m.type === "status") { status = m; updateLive(); }
  else { record = m.record; render(); }
});
browser.tabs.onActivated.addListener(() => void findTab());
browser.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === "complete") void findTab(); });

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
    <section id="chart"></section>
    <section class="foot">
      <button id="reanalyze">Re-analyze</button>
      <button id="export">Export</button>
      <button id="import">Import</button>
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
  $("reanalyze").onclick = () => void send({ type: "reanalyze" });
  $("export").onclick = () => void exportBackup();
  $("import").onclick = () => $("file").click();
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
}

// ---- chart (simple list of bars; sections come in Phase 4) ----
let lastHighlight = -2;
function renderChart(): void {
  const el = document.getElementById("chart");
  if (!el) return;
  const chords = record?.chords ?? [];
  if (chords.length === 0) { el.innerHTML = `<p class="muted">Play the video with the sidebar connected to build the chart.</p>`; return; }
  el.innerHTML = `<div class="grid">${chords.map((c, i) =>
    `<button class="chord ${c.source !== "detected" ? "edited" : ""} ${c.confidence < 0.55 ? "weak" : ""}" data-i="${i}" title="${fmtTime(c.startSec)}">${esc(display(c, record))}</button>`).join("")}</div>`;
  el.querySelectorAll<HTMLButtonElement>(".chord").forEach((b) => {
    b.onclick = () => { const c = chords[+b.dataset.i!]; if (c) void send({ type: "seek", sec: c.startSec }); };
  });
  lastHighlight = -2;
  highlightChart(status?.liveChordIdx ?? -1);
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

void findTab();
