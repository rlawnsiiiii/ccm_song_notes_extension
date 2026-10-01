import type { Conti, ContiItem, Mode, PitchClass, SongRecord } from "../shared/types";
import type { ExportBundle } from "../shared/messages";
import { contiToChordPro, keyLabel, moveItem, newConti, songSheet } from "../music/conti";

const send = <T = any>(m: unknown): Promise<T> => browser.runtime.sendMessage(m) as Promise<T>;

let songs: SongRecord[] = [];
let contis: Conti[] = [];
let current: Conti | null = null;

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on")) (el as any)[k] = v;
    else if (k === "class") el.className = v;
    else if (k === "value" || k === "checked" || k === "selected") (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

let saveTimer: number | undefined;
function touch(): void {
  if (!current) return;
  current.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void send({ type: "db:saveConti", conti: current }); }, 300);
}

async function load(): Promise<void> {
  songs = ((await send<{ songs: SongRecord[] }>({ type: "db:listSongs" })).songs ?? []).sort((a, b) => a.title.localeCompare(b.title, "ko"));
  contis = ((await send<{ contis: Conti[] }>({ type: "db:listContis" })).contis ?? []).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  current = contis[0] ?? null;
  if (!current) { current = newConti(); contis.push(current); touch(); } // start with an empty 콘티 so songs can be added right away
  render();
}

const byId = (id: string) => songs.find((s) => s.videoId === id);

function keyOptions(item: ContiItem, rec: SongRecord): HTMLOptionElement[] {
  const opts = [h("option", { value: "", selected: !item.targetKey }, `원래 키 (${keyLabel(rec.key.tonic, rec.key.mode)})`)];
  for (let pc = 0; pc < 12; pc++) {
    const label = keyLabel(pc as PitchClass, rec.key.mode);
    opts.push(h("option", { value: String(pc), selected: item.targetKey?.tonic === pc }, label));
  }
  return opts;
}

function render(): void {
  const app = document.getElementById("app")!;
  app.replaceChildren();
  const editor = h("div", { id: "editor" });
  app.append(h("h1", {}, "콘티 (Setlist)"), editor);

  // --- conti picker ---
  const picker = h("select", { id: "conti-pick", onchange: (e: Event) => { current = contis.find((c) => c.id === (e.target as HTMLSelectElement).value) ?? null; render(); } },
    ...contis.map((c) => h("option", { value: c.id, selected: c.id === current?.id }, `${c.date} · ${c.name}`)));
  editor.append(h("div", { class: "row" }, picker,
    h("button", { id: "conti-new", class: "primary", onclick: () => { current = newConti(); contis.unshift(current); touch(); render(); } }, "새 콘티"),
    current && h("button", { onclick: async () => {
      if (!current || !confirm(`"${current.name}" 삭제?`)) return;
      await send({ type: "db:deleteConti", id: current.id });
      contis = contis.filter((c) => c !== current); current = contis[0] ?? null; render();
    } }, "삭제")));
  if (!current) { editor.append(h("p", { class: "muted" }, "콘티가 없습니다. “새 콘티”를 눌러 시작하세요.")); renderBackup(editor); return; }
  const c = current;

  editor.append(h("div", { class: "row" },
    h("input", { id: "conti-name", value: c.name, placeholder: "이름", oninput: (e: Event) => { c.name = (e.target as HTMLInputElement).value; touch(); } }),
    h("input", { id: "conti-date", type: "date", value: c.date, oninput: (e: Event) => { c.date = (e.target as HTMLInputElement).value; touch(); } }),
    h("label", {}, h("input", { id: "conti-numbers", type: "checkbox", checked: c.numbers, onchange: (e: Event) => { c.numbers = (e.target as HTMLInputElement).checked; touch(); renderPreview(); } }), " 숫자 코드만")));

  // --- two columns: saved songs | conti ---
  const left = h("div", {}, h("h2", {}, "저장된 곡"));
  if (songs.length === 0) left.append(h("p", { class: "muted" }, "아직 분석된 곡이 없습니다. YouTube에서 곡을 재생하세요."));
  for (const s of songs) {
    left.append(h("div", { class: "card row song-entry", "data-id": s.videoId },
      h("span", { style: "flex:1" }, `${s.title}`, h("span", { class: "muted" }, ` · ${keyLabel(s.key.tonic, s.key.mode)}`)),
      h("button", { class: "add", onclick: () => { c.items.push({ videoId: s.videoId, targetKey: null, notes: "" }); touch(); render(); } }, "추가")));
  }
  const right = h("div", {}, h("h2", {}, `순서 (${c.items.length}곡)`));
  c.items.forEach((item, i) => {
    const rec = byId(item.videoId);
    right.append(h("div", { class: "card item", "data-i": i },
      h("b", {}, String(i + 1)),
      h("div", {}, rec ? rec.title : `(삭제된 곡 ${item.videoId})`),
      h("div", { class: "row" },
        rec && h("select", { class: "keysel", onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          item.targetKey = v === "" ? null : { tonic: Number(v) as PitchClass, mode: rec.key.mode as Mode };
          touch(); renderPreview();
        } }, ...keyOptions(item, rec)),
        h("button", { class: "up", onclick: () => { c.items = moveItem(c.items, i, i - 1); touch(); render(); } }, "▲"),
        h("button", { class: "down", onclick: () => { c.items = moveItem(c.items, i, i + 1); touch(); render(); } }, "▼"),
        h("button", { class: "del", onclick: () => { c.items.splice(i, 1); touch(); render(); } }, "✕")),
      h("input", { class: "notes", value: item.notes, placeholder: "메모 (예: 후렴 2번 반복)", oninput: (e: Event) => { item.notes = (e.target as HTMLInputElement).value; touch(); renderPreview(); } })));
  });
  editor.append(h("div", { class: "cols" }, left, right));

  // --- export ---
  const ta = h("textarea", { id: "export-text", class: "export", readonly: true, hidden: true });
  editor.append(h("h2", {}, "내보내기"), h("div", { class: "row" },
    h("button", { id: "show-text", onclick: () => { ta.hidden = false; ta.value = exportText(); } }, "ChordPro 텍스트 보기"),
    h("button", { id: "dl-text", onclick: () => download(`${c.date}-${c.name}.chordpro`, exportText(), "text/plain") }, "텍스트 저장"),
    h("button", { id: "print", class: "primary", onclick: () => window.print() }, "인쇄 (A4, 곡당 1페이지)")), ta);
  renderBackup(editor);
  app.append(h("div", { id: "preview" }));
  renderPreview();
}

function exportText(): string {
  return current ? contiToChordPro(current, new Map(songs.map((s) => [s.videoId, s]))) : "";
}

function renderPreview(): void {
  const box = document.getElementById("preview");
  if (!box || !current) return;
  box.replaceChildren();
  for (const item of current.items) {
    const rec = byId(item.videoId);
    if (!rec) continue;
    const sh = songSheet(rec, item, current.numbers);
    const sheet = h("div", { class: "sheet" },
      h("h3", {}, sh.title),
      h("div", { class: "meta" }, `Key ${sh.key}${sh.bpm ? ` · ${Math.round(sh.bpm)} BPM` : ""}${sh.artist ? ` · ${sh.artist}` : ""}`));
    for (const s of sh.sections) {
      if (s.label) sheet.append(h("div", { class: "sec" }, s.label));
      sheet.append(h("div", { class: "bars" }, ...s.bars.map((labels) => h("div", { class: "bar" }, ...labels.map((l) => h("span", {}, l))))));
    }
    if (sh.notes) sheet.append(h("div", { class: "notes" }, sh.notes));
    box.append(sheet);
  }
}

function renderBackup(parent: HTMLElement): void {
  const file = h("input", { type: "file", id: "restore-file", accept: "application/json", hidden: true, onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as ExportBundle;
      const r = await send<{ count: number }>({ type: "db:importAll", data });
      alert(`${r.count}곡을 복원했습니다.`);
      await load();
    } catch (err) { alert(`복원 실패: ${err instanceof Error ? err.message : err}`); }
  } });
  parent.append(h("h2", {}, "백업"), h("div", { class: "row" },
    h("button", { id: "backup", onclick: async () => {
      const { bundle } = await send<{ bundle: ExportBundle }>({ type: "db:exportAll" });
      download(`worship-chords-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle), "application/json");
    } }, "모든 데이터 백업"),
    h("button", { onclick: () => file.click() }, "복원"), file));
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

void load().catch((e) => { document.getElementById("app")!.textContent = `시작 실패: ${e instanceof Error ? e.message : e}`; });
