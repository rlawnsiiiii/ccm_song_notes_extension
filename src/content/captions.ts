import { parseJson3, type LyricLine } from "../music/lyrics";

interface CaptionTrack { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string } }

interface PlayerInfo { videoId: string | null; tracks: CaptionTrack[] }

/**
 * Firefox lets the content script look at the page's own JS objects via wrappedJSObject.
 * Values coming back from page functions are Xray-wrapped, so each object is unwrapped once
 * and the few fields we need are copied into plain content-script objects.
 */
function playerInfo(): PlayerInfo | null {
  const unwrap = (o: any) => (o && o.wrappedJSObject ? o.wrappedJSObject : o);
  try {
    const player = document.querySelector("#movie_player") as any;
    let resp = unwrap(player)?.getPlayerResponse?.();
    if (!resp) resp = unwrap(window).ytInitialPlayerResponse;
    resp = unwrap(resp);
    if (!resp) return null;
    const list = unwrap(unwrap(resp.captions)?.playerCaptionsTracklistRenderer)?.captionTracks;
    const tracks: CaptionTrack[] = [];
    const n = Number(list?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const t = unwrap(list[i]);
      tracks.push({ baseUrl: String(t.baseUrl), languageCode: String(t.languageCode), ...(t.kind ? { kind: String(t.kind) } : {}) });
    }
    const vid = unwrap(resp.videoDetails)?.videoId;
    return { videoId: vid ? String(vid) : null, tracks };
  } catch (e) {
    console.debug("[wcc] cannot read player response", e);
    if (typeof document !== "undefined") document.documentElement.dataset.wccLyricsErr = String(e);
    return null;
  }
}

export interface CaptionResult { lines: LyricLine[]; auto: boolean; language: string }

/**
 * Reads the Korean caption track that the video already offers. Channel-uploaded tracks are
 * preferred over auto-generated ones. Nothing is sent anywhere except YouTube's own timedtext URL.
 */
export async function fetchKoreanCaptions(expectVideoId: string): Promise<CaptionResult | null> {
  const info = playerInfo();
  if (!info || (info.videoId && info.videoId !== expectVideoId)) return null;
  const ko = info.tracks.filter((t) => t.languageCode?.startsWith("ko"));
  const track = ko.find((t) => t.kind !== "asr") ?? ko[0];
  if (!track) return null;
  const url = new URL(track.baseUrl, location.href);
  if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== location.hostname) return null;
  url.searchParams.set("fmt", "json3");
  const res = await fetch(url.toString(), { credentials: "same-origin" });
  if (!res.ok) return null;
  const lines = parseJson3(await res.json());
  return lines.length ? { lines, auto: track.kind === "asr", language: track.languageCode } : null;
}
