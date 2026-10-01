/** All YouTube-specific page knowledge lives here. */

export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video.html5-main-video") ?? document.querySelector("video");
}

export function getVideoId(): string | null {
  const u = new URL(location.href);
  if (u.pathname === "/watch") return u.searchParams.get("v");
  const m = /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname);
  return m ? m[1]! : null;
}

export function getTitle(): string {
  const h1 = document.querySelector("h1.ytd-watch-metadata, #title h1, h1.title");
  const t = h1?.textContent?.trim();
  if (t) return t;
  return document.title.replace(/ - YouTube$/, "").replace(/^\(\d+\)\s*/, "");
}

export function isAdPlaying(): boolean {
  const player = document.querySelector("#movie_player");
  return !!player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"));
}

/** Calls back when the video id or element changes (YouTube navigates without reloads). */
export function watchNavigation(cb: () => void): void {
  window.addEventListener("yt-navigate-finish", cb);
  window.addEventListener("popstate", cb);
  let last = getVideoId();
  setInterval(() => {
    const id = getVideoId();
    if (id !== last) { last = id; cb(); }
  }, 1000);
}
