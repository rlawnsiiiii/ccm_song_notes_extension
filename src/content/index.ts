import { ChromaExtractor } from "../analysis/chroma";
import { OnsetExtractor, ONSET_HOP_SEC } from "../analysis/onset";
import { SongSession } from "../analysis/session";
import { chordIndexAt, nextDifferent } from "../analysis/merge";
import { ANALYZER_VERSION } from "../analysis/analyzer";
import { FEATURE_VERSION } from "../analysis/chroma";
import { packFrames, unpackFrames } from "../store/db";
import type { StatusMsg, SongMsg, ToBackground, ToContent } from "../shared/messages";
import type { SongRecord } from "../shared/types";
import { AudioTap, TAP_FFT } from "./audio-tap";
import { getTitle, getVideoElement, getVideoId, isAdPlaying, watchNavigation } from "./youtube";
import { applyEdit, importChart } from "./edits";
import { fetchKoreanCaptions } from "./captions";

declare const __WCC_TEST__: boolean;

const POLL_MS = 100;
const SAVE_MS = 15000;
const REANALYZE_MS = 4000;

let video: HTMLVideoElement | null = null;
let tap: AudioTap | null = null;
let extractor: ChromaExtractor | null = null;
let onsetExtractor: OnsetExtractor | null = null;
let lastOnsetT = -1;
let session: SongSession | null = null;
let connected = false;
let audioState: StatusMsg["audio"] = "idle";
let errorText: string | undefined;
let level = 0;
let lastChroma = new Array<number>(12).fill(0);
let loop: [number, number] | null = null;
let known = false;
let lastSave = 0;
let lastReanalyze = 0;
let reanalyzeEvery = REANALYZE_MS; // grows with the measured cost so long songs never hog the page thread
let lastFrameT = -1;
let saveInFlight = false;

const bg = <T = any>(m: ToBackground): Promise<T> => browser.runtime.sendMessage(m) as Promise<T>;
const toSidebar = (m: StatusMsg | SongMsg) => { browser.runtime.sendMessage(m).catch(() => undefined); };

async function loadSession(): Promise<void> {
  const id = getVideoId();
  video = getVideoElement();
  session = null; known = false; lastFrameT = -1; loop = null;
  if (!id || !video) { toSidebar({ type: "song", record: null }); return; }
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const { record } = await bg<{ record: SongRecord | null }>({ type: "db:getSong", videoId: id });
  if (getVideoId() !== id) return; // navigated away while loading
  session = new SongSession(record ?? SongSession.blank(id, getTitle(), duration));
  if (record) {
    known = true;
    const { data } = await bg<{ data: number[] }>({ type: "db:getFrames", videoId: id, version: FEATURE_VERSION });
    if (getVideoId() === id && data?.length) session.loadFrames(unpackFrames(Float32Array.from(data)));
    const on = await bg<{ data: number[] }>({ type: "db:getOnsets", videoId: id });
    if (getVideoId() === id && on?.data?.length) session.loadOnsets(on.data);
  }
  session.record.durationSec ||= duration;
  toSidebar({ type: "song", record: session.record });
  if (!session.record.lyrics) void loadLyrics(id);
}

/** The player may not have its caption list yet right after navigation, so retry a few times. */
async function loadLyrics(id: string, attempts = 6): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (getVideoId() !== id || !session) return;
    try {
      const res = await fetchKoreanCaptions(id);
      if (res && session && getVideoId() === id) {
        session.record.lyrics = res.lines;
        session.record.lyricsAuto = res.auto;
        session.record.updatedAt = new Date().toISOString();
        toSidebar({ type: "song", record: session.record });
        if (session.frames.size > 0) { session.reanalyze(); void persist(true); }
        else void bg({ type: "db:saveSong", record: session.record });
        return;
      }
    } catch (e) {
      console.debug("[wcc] captions failed", e);
      if (__WCC_TEST__) document.documentElement.dataset.wccLyricsErr = String(e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function connect(): Promise<void> {
  video = getVideoElement();
  if (!video) { errorText = "No video found on this page"; audioState = "error"; return; }
  try {
    if (!tap || tap.video !== video) {
      tap?.dispose();
      tap = new AudioTap(video);
      extractor = new ChromaExtractor({ sampleRate: tap.sampleRate, frameSize: TAP_FFT });
      onsetExtractor = new OnsetExtractor(tap.sampleRate);
    }
    connected = true;
    errorText = undefined;
    await tap.resume();
  } catch (e) {
    audioState = "error";
    errorText = e instanceof Error ? e.message : String(e);
    connected = false;
  }
}

function disconnect(): void { connected = false; audioState = "idle"; }

async function persist(force = false): Promise<void> {
  if (!session || saveInFlight) return;
  if (session.frames.size === 0) return;
  if (!force && !session.dirty) return;
  saveInFlight = true;
  try {
    const s = session;
    s.dirty = false;
    s.reanalyze();
    await bg({ type: "db:saveSong", record: s.record });
    await bg({ type: "db:saveFrames", videoId: s.record.videoId, version: FEATURE_VERSION, data: Array.from(packForSave(s)) });
    await bg({ type: "db:saveOnsets", videoId: s.record.videoId, data: Array.from(s.packOnsets()) });
    toSidebar({ type: "song", record: s.record });
  } catch (e) {
    console.warn("[wcc] save failed", e);
  } finally {
    saveInFlight = false;
    lastSave = performance.now();
    lastReanalyze = lastSave;
  }
}

const packForSave = (s: SongSession) => packFrames(s.sortedFrames());

function tick(): void {
  if (!video) video = getVideoElement();
  const v = video;
  if (!v || !session) return;

  // loop A–B
  if (loop && !v.paused && v.currentTime >= loop[1]) v.currentTime = loop[0];

  if (!connected || !tap || !extractor) return;
  if (isAdPlaying()) { audioState = "ad"; return; }
  if (!tap.running) { audioState = "suspended"; return; }
  if (v.paused || v.ended || v.seeking || v.readyState < 3) { audioState = "paused"; return; }
  audioState = "running";

  const samples = tap.read();
  const frameDur = TAP_FFT / tap.sampleRate;
  const t = v.currentTime - (v.playbackRate * frameDur) / 2;
  if (t < 0 || Math.abs(t - lastFrameT) < 0.04) return;
  const frame = extractor.extract(samples, t);
  lastFrameT = t;
  level = Math.min(1, frame.energy * 6);
  lastChroma = frame.chroma;
  session.addFrame(frame);

  const now = performance.now();
  if (now - lastReanalyze > reanalyzeEvery && session.dirty) {
    session.reanalyze();
    lastReanalyze = performance.now();
    reanalyzeEvery = Math.max(REANALYZE_MS, (lastReanalyze - now) * 30);
    toSidebar({ type: "song", record: session.record });
  }
  if (now - lastSave > SAVE_MS) void persist();
}

// The live chord only changes once the decoder has disagreed with what is shown for ~0.25 s without
// interruption, so a short blip never reaches the display. (Time based: status() is called from
// several places. The disagreement may flip between similar chords, e.g. C / Cadd9; the newest wins.)
const LIVE_HOLD_MS = 250;
let liveShown: StatusMsg["live"] = null;
let liveDiffSince = 0;
const sameChord = (a: StatusMsg["live"], b: StatusMsg["live"]) => !!a && !!b && a.root === b.root && a.quality === b.quality && (a.bass ?? a.root) === (b.bass ?? b.root);
function stableLive(raw: StatusMsg["live"]): StatusMsg["live"] {
  const now = performance.now();
  if (!raw) { liveShown = null; liveDiffSince = 0; return null; }
  if (!liveShown || sameChord(raw, liveShown)) { liveShown = raw; liveDiffSince = 0; return raw; }
  if (liveDiffSince === 0) liveDiffSince = now;
  if (now - liveDiffSince >= LIVE_HOLD_MS) { liveShown = raw; liveDiffSince = 0; }
  return liveShown;
}

/** ~40 Hz: onset strength from a short window, for tempo. Cheap (one 1024-point FFT). */
function onsetTick(): void {
  const v = video;
  if (!v || !session || !connected || !tap || !onsetExtractor || !tap.running) return;
  if (v.paused || v.ended || v.seeking || v.readyState < 3 || isAdPlaying()) { onsetExtractor.reset(); lastOnsetT = -1; return; }
  const t = v.currentTime - (v.playbackRate * 1024) / tap.sampleRate / 2;
  if (t < 0) return;
  const dt = t - lastOnsetT;
  if (lastOnsetT >= 0 && dt < 0.012) return;
  if (lastOnsetT < 0 || dt > 0.12 || dt < 0) onsetExtractor.reset(); // seek or stall: the previous window is not adjacent
  const flux = onsetExtractor.push(tap.readFast());
  const had = lastOnsetT >= 0 && dt > 0 && dt <= 0.12;
  lastOnsetT = t;
  // windows closer or further apart than the nominal hop change the flux size; normalise per hop
  if (had) session.addOnset(t, (flux * ONSET_HOP_SEC) / Math.max(0.012, dt));
}

function status(): StatusMsg {
  const v = video;
  const time = v?.currentTime ?? 0;
  const chords = session?.record.chords ?? [];
  const idx = chordIndexAt(chords, time);
  return {
    type: "status",
    videoId: getVideoId(),
    title: session?.record.title ?? getTitle(),
    connected, audio: audioState, error: errorText,
    level, chroma: lastChroma,
    time, duration: v && Number.isFinite(v.duration) ? v.duration : 0,
    rate: v?.playbackRate ?? 1,
    live: stableLive(connected && audioState === "running" && session ? session.liveChord(time) : null),
    liveChordIdx: idx, nextChordIdx: nextDifferent(chords, idx),
    key: session?.record.key.confidence ? session.record.key : null,
    loop, known,
  };
}

browser.runtime.onMessage.addListener((raw: unknown) => {
  const m = raw as ToContent;
  if (!m || typeof m.type !== "string" || m.type.startsWith("db:")) return undefined;
  switch (m.type) {
    case "hello":
      toSidebar({ type: "song", record: session?.record ?? null });
      return Promise.resolve(status());
    case "connect": return connect().then(status);
    case "disconnect": disconnect(); return Promise.resolve(status());
    case "seek": if (video) video.currentTime = m.sec; break;
    case "setRate": if (video) video.playbackRate = Math.max(0.25, Math.min(2, m.rate)); break;
    case "setLoop": loop = m.range; break;
    case "importChart": {
      if (!session) return Promise.resolve({ ...status(), importResult: { ok: false, message: "No song loaded." } });
      const r = importChart(session.record, m.text);
      if (r.ok) {
        session.record.updatedAt = new Date().toISOString();
        toSidebar({ type: "song", record: session.record });
        void bg({ type: "db:saveSong", record: session.record });
      }
      return Promise.resolve({ ...status(), importResult: r });
    }
    case "fetchLyrics": { const id = getVideoId(); if (id && session) { delete session.record.lyrics; void loadLyrics(id, 2); } break; }
    case "rescaleTempo": if (session) { session.rescaleTempo(m.factor); void persist(true); toSidebar({ type: "song", record: session.record }); } break;
    case "reanalyze": if (session) { session.reanalyze(); void persist(true); } break;
    case "resetAnalysis":
      if (session) {
        const id = session.record.videoId;
        session = new SongSession(SongSession.blank(id, session.record.title, session.record.durationSec));
        void persist(true);
      }
      break;
    case "importRecord":
      if (session && m.record.videoId === session.record.videoId) {
        session.record = m.record; known = true;
        void persist(true);
      }
      break;
    default:
      if (session && applyEdit(session.record, m)) {
        session.record.updatedAt = new Date().toISOString();
        toSidebar({ type: "song", record: session.record });
        void bg({ type: "db:saveSong", record: session.record });
      }
  }
  return Promise.resolve(status());
});

setInterval(tick, POLL_MS);
setInterval(onsetTick, 25);
setInterval(() => toSidebar(status()), 250);

if (__WCC_TEST__) {
  // Test hooks: auto-connect, publish state to the DOM, accept commands via a DOM attribute.
  setInterval(() => {
    const st = status();
    document.documentElement.dataset.wcc = JSON.stringify({ st, record: session?.record ?? null, frames: session?.frames.size ?? 0 });
    const cmd = document.documentElement.dataset.wccCmd;
    if (cmd) {
      delete document.documentElement.dataset.wccCmd;
      const c = JSON.parse(cmd);
      if (c.type === "connect") void connect();
      else if (c.type === "persist") void persist(true);
      else if (c.type === "reload") void loadSession();
      else if (c.type === "edit" || c.type === "reanalyze") {
        if (c.type === "reanalyze") session?.reanalyze();
        else if (session && applyEdit(session.record, c.msg)) void bg({ type: "db:saveSong", record: session.record });
      }
    }
  }, 300);
}
window.addEventListener("pagehide", () => { void persist(true); });
document.addEventListener("visibilitychange", () => { if (document.hidden) void persist(); });

watchNavigation(() => { void persist(true).then(loadSession); });
void loadSession();
console.debug("[wcc] content script ready", ANALYZER_VERSION);
