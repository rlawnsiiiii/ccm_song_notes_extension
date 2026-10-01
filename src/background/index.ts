import * as db from "../store/db";
import type { ToBackground } from "../shared/messages";

browser.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as ToBackground;
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("db:")) return undefined;
  switch (msg.type) {
    case "db:saveSong": return db.saveSong(msg.record).then(() => ({ ok: true }));
    case "db:getSong": return db.getSong(msg.videoId).then((record) => ({ record: record ?? null }));
    case "db:listSongs": return db.listSongs().then((songs) => ({ songs }));
    case "db:deleteSong": return db.deleteSong(msg.videoId).then(() => ({ ok: true }));
    case "db:saveFrames": return db.saveFrames(msg.videoId, msg.version, db.unpackFrames(Float32Array.from(msg.data))).then(() => ({ ok: true }));
    case "db:getFrames": return db.getFrames(msg.videoId, msg.version).then((frames) => ({ data: Array.from(db.packFrames(frames)) }));
    case "db:exportAll": return db.exportAll().then((bundle) => ({ bundle }));
    case "db:importAll": return db.importAll(msg.data).then((count) => ({ count }));
  }
  return undefined;
});

// Toolbar button toggles the sidebar.
browser.action.onClicked.addListener(() => { void browser.sidebarAction.toggle(); });
