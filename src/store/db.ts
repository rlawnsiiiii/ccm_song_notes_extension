import type { FeatureFrame, SongRecord } from "../shared/types";
import type { ExportBundle } from "../shared/messages";
import { FEATURE_VERSION } from "../analysis/chroma";

const DB_NAME = "wcc";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "videoId" });
      if (!db.objectStoreNames.contains("frames")) db.createObjectStore("frames", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => { resolve(r.result); db.close(); };
        t.onerror = () => { reject(t.error); db.close(); };
        t.onabort = () => { reject(t.error); db.close(); };
      }),
  );
}

export const saveSong = (record: SongRecord) => tx("songs", "readwrite", (s) => s.put(record)).then(() => undefined);
export const getSong = (videoId: string) => tx<SongRecord | undefined>("songs", "readonly", (s) => s.get(videoId));
export const listSongs = () => tx<SongRecord[]>("songs", "readonly", (s) => s.getAll());
export const deleteSong = (videoId: string) =>
  tx("songs", "readwrite", (s) => s.delete(videoId)).then(() =>
    tx("frames", "readwrite", (s) => s.delete(framesKey(videoId, "*"))).catch(() => undefined),
  );

const framesKey = (videoId: string, version: string) => `${videoId}|${version}`;

/** Frames are stored packed: [t, energy, chroma×12, bass×12] per frame. */
const STRIDE = 26;

export function packFrames(frames: FeatureFrame[]): Float32Array {
  const out = new Float32Array(frames.length * STRIDE);
  frames.forEach((f, i) => {
    const o = i * STRIDE;
    out[o] = f.t; out[o + 1] = f.energy;
    for (let k = 0; k < 12; k++) { out[o + 2 + k] = f.chroma[k]!; out[o + 14 + k] = f.bass[k]!; }
  });
  return out;
}

export function unpackFrames(data: Float32Array): FeatureFrame[] {
  const n = Math.floor(data.length / STRIDE);
  const out: FeatureFrame[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    out.push({
      t: data[o]!, energy: data[o + 1]!,
      chroma: Array.from(data.subarray(o + 2, o + 14)),
      bass: Array.from(data.subarray(o + 14, o + 26)),
    });
  }
  return out;
}

export const saveFrames = (videoId: string, version: string, frames: FeatureFrame[]) =>
  tx("frames", "readwrite", (s) => s.put({ key: framesKey(videoId, version), videoId, version, data: packFrames(frames) })).then(() => undefined);

export async function getFrames(videoId: string, version: string): Promise<FeatureFrame[]> {
  const rec = await tx<{ data: Float32Array } | undefined>("frames", "readonly", (s) => s.get(framesKey(videoId, version)));
  return rec ? unpackFrames(rec.data) : [];
}

export async function exportAll(withFrames = true): Promise<ExportBundle> {
  const songs = await listSongs();
  const bundle: ExportBundle = { format: "worship-chord-companion", version: 1, songs };
  if (withFrames) {
    bundle.frames = {};
    for (const s of songs) {
      const f = await getFrames(s.videoId, FEATURE_VERSION);
      if (f.length) bundle.frames[s.videoId] = Array.from(packFrames(f));
    }
  }
  return bundle;
}

export async function importAll(data: ExportBundle): Promise<number> {
  if (data?.format !== "worship-chord-companion" || !Array.isArray(data.songs)) throw new Error("Not a Worship Chord Companion backup");
  for (const s of data.songs) {
    await saveSong(s);
    const packed = data.frames?.[s.videoId];
    if (packed?.length) await saveFrames(s.videoId, FEATURE_VERSION, unpackFrames(Float32Array.from(packed)));
  }
  return data.songs.length;
}
