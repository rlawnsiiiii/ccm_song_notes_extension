export interface CleanTitle { title: string; artist?: string; extra?: string }

const NOISE = /(official|live|m\/?v|music video|lyrics?|lyric video|audio|video|ver\.?|version|performance|cover|session|가사|라이브|영상|뮤직비디오|공식|풀버전|full|hd|4k|1080p|fhd|예배|실황|연주|악보|코드|자막|\bpt\.?\s*\d+)/i;

/**
 * Korean worship titles are messy: `[팀명] 곡명 (인도자) | Official Live …`.
 * The result is only a starting point; the sidebar lets the user edit it.
 */
export function cleanTitle(raw: string): CleanTitle {
  let s = raw.replace(/\s+/g, " ").trim();
  let artist: string | undefined;
  const extras: string[] = [];

  // leading [팀명] / 【팀명】
  const lead = /^[\[【\(]([^\]】\)]{1,40})[\]】\)]\s*/.exec(s);
  if (lead && !NOISE.test(lead[1]!)) { artist = lead[1]!.trim(); s = s.slice(lead[0].length); }
  else if (lead) s = s.slice(lead[0].length);

  // "A | B | C": the song is normally first, unless the first part is only noise
  const parts = s.split(/\s*[|｜]\s*/).filter(Boolean);
  if (parts.length > 1) {
    const idx = parts.findIndex((p) => !NOISE.test(p) || p.replace(NOISE, "").trim().length > 2);
    s = parts[Math.max(0, idx)]!;
    for (const p of parts) if (p !== s && !NOISE.test(p)) extras.push(p);
  }

  // "Artist - Title" (also with en/em dash)
  const dash = /^(.{1,40}?)\s+[-–—]\s+(.+)$/.exec(s);
  if (dash && !NOISE.test(dash[1]!)) { artist ??= dash[1]!.trim(); s = dash[2]!; }

  // parentheses: drop noise words, keep other content (often the worship leader) as extra
  s = s.replace(/\s*[\(\[【]([^\)\]】]*)[\)\]】]/g, (_, inner: string) => {
    if (NOISE.test(inner)) return "";
    if (inner.trim()) extras.push(inner.trim());
    return "";
  });
  s = s.replace(/\s*(official|live|lyrics?)\b.*$/i, "").replace(/\s*[-–—:]\s*$/, "").replace(/\s+/g, " ").trim();
  return { title: s || raw.trim(), ...(artist ? { artist } : {}), ...(extras.length ? { extra: extras.join(", ") } : {}) };
}

/** Web search URLs the sidebar opens in a new tab (nothing is fetched automatically). */
export function searchUrls(title: string, artist?: string): { label: string; url: string }[] {
  const q = (suffix: string) => encodeURIComponent([title, artist, suffix].filter(Boolean).join(" "));
  return [
    { label: "코드 악보", url: `https://www.google.com/search?q=${q("코드 악보")}` },
    { label: "악보 (이미지)", url: `https://www.google.com/search?tbm=isch&q=${q("악보")}` },
    { label: "가사", url: `https://www.google.com/search?q=${q("가사")}` },
  ];
}
