import "@logseq/libs";
import { Entry, NoticeLog, when } from "./log";

// Logseq 2.0 draws each pop-up as .ui__toast (with a success / warning / error class) inside .ui__toaster-viewport of the
// main window. The plugin runs with `effect: true`, so it can watch that DOM directly.
const doc = top!.document;
// elements of the main window are instances of ITS HTMLElement, not the iframe's
const HostElement = (top as unknown as typeof globalThis).HTMLElement;
const STORE = "history.json";
type Saved = { entries?: (Entry & { error?: boolean })[] };

const log = new NoticeLog();
const errors = new Set<number>();
const ids = new WeakMap<HTMLElement, number>();
let unseen = 0, quiet = 0, saveTimer = 0;
let viewport: MutationObserver | undefined, body: MutationObserver | undefined;
let panel: HTMLElement | undefined;
let filter = "", errorsOnly = false;

const settings = () => ({ persist: logseq.settings?.persist !== false, max: Number(logseq.settings?.max ?? 200) || 200 });

function text(el: HTMLElement): string {
	const b = el.querySelector<HTMLElement>(".ui__toast-body") || el.querySelector<HTMLElement>(".ui__toast-content") || el;
	// keep the message, not the buttons inside it ("Disable now", "Undo")
	const c = b.cloneNode(true) as HTMLElement;
	c.querySelectorAll("button, .button, [role=button]").forEach((x) => x.remove());
	return (c.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function seen(el: HTMLElement): void {
	if (ids.has(el)) return edited(el);
	if (quiet > 0) { quiet--; ids.set(el, 0); return; }
	const e = log.add(text(el), Date.now());
	if (!e) return;
	ids.set(el, e.id);
	if (el.classList.contains("error")) errors.add(e.id);
	unseen++;
	changed();
}

function edited(node: Node): void {
	const el = (node instanceof HostElement ? node as HTMLElement : node.parentElement)?.closest<HTMLElement>(".ui__toast");
	if (!el) return;
	const id = ids.get(el);
	if (id === undefined) return seen(el);
	if (!id) return;
	const before = log.entries.find((x) => x.id === id)?.text;
	log.update(id, text(el));
	if (log.entries.find((x) => x.id === id)?.text !== before) changed();
}

function watch() {
	const attach = () => {
		const vp = doc.querySelector<HTMLElement>(".ui__toaster-viewport");
		if (!vp || viewport) return !!vp;
		vp.querySelectorAll<HTMLElement>(".ui__toast").forEach(seen);
		viewport = new MutationObserver((muts) => {
			for (const m of muts) {
				m.addedNodes.forEach((n) => {
					if (!(n instanceof HostElement)) return;
					const el = n as HTMLElement;
					if (el.classList.contains("ui__toast")) seen(el); else edited(el);
				});
				if (m.type === "characterData") edited(m.target);
			}
		});
		viewport.observe(vp, { childList: true, subtree: true, characterData: true });
		return true;
	};
	if (attach()) return;
	body = new MutationObserver(() => { if (attach()) body?.disconnect(); });
	body.observe(doc.body, { childList: true, subtree: true });
}

function changed() {
	drawBadge();
	draw();
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => void persist(), 2000);
}

async function persist() {
	const entries = settings().persist ? log.entries.map((e) => ({ ...e, error: errors.has(e.id) || undefined })) : [];
	await logseq.FileStorage.setItem(STORE, JSON.stringify({ entries }));
}

function drawBadge() {
	doc.querySelectorAll<HTMLElement>(".nh-toolbar-badge").forEach((b) => { b.textContent = unseen ? String(unseen) : ""; b.style.display = unseen ? "" : "none"; });
}

function clearAll() { log.clear(); errors.clear(); unseen = 0; changed(); }

function copy(t: string) {
	const done = () => { quiet++; logseq.UI.showMsg("Copied", "success", { timeout: 1500 }); };
	// the main window has clipboard access; the plugin's own frame may not
	const nav = (top as unknown as typeof globalThis).navigator;
	nav.clipboard.writeText(t).then(done, () => {
		const ta = doc.createElement("textarea");
		ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
		doc.body.append(ta); ta.select();
		const ok = doc.execCommand("copy");
		ta.remove();
		if (ok) done(); else logseq.UI.showMsg("Could not copy to the clipboard", "error");
	});
}

function onKey(e: KeyboardEvent) {
	if (e.key === "Escape" && panel) { e.preventDefault(); e.stopPropagation(); close(); }
}

function open() {
	unseen = 0; drawBadge();
	if (panel) return;
	panel = doc.createElement("div");
	panel.className = "nh-overlay";
	panel.innerHTML = `<div class="nh-panel" role="dialog" aria-label="Notification history">
	<div class="nh-head"><b>Notification history</b><button class="nh-x" data-a="close" aria-label="Close">×</button></div>
	<div class="nh-bar"><input class="nh-search" type="search" placeholder="Filter">
		<label class="nh-errors"><input type="checkbox"> Errors only</label>
		<button data-a="copy">Copy all</button><button data-a="clear" class="nh-danger">Clear</button></div>
	<div class="nh-list"></div></div>`;
	doc.body.append(panel);
	const search = panel.querySelector<HTMLInputElement>(".nh-search")!;
	search.addEventListener("input", () => { filter = search.value.toLowerCase(); draw(); });
	panel.querySelector<HTMLInputElement>(".nh-errors input")!.addEventListener("change", (e) => { errorsOnly = (e.target as HTMLInputElement).checked; draw(); });
	panel.addEventListener("click", (e) => {
		const t = e.target as HTMLElement;
		if (t === panel) return close();
		const a = t.closest<HTMLElement>("[data-a]")?.dataset.a;
		if (a === "close") close();
		else if (a === "copy") copy(shown().map((x) => `${when(x.time, Date.now())}  ${x.text}`).join("\n\n"));
		else if (a === "clear") clearAll();
		const c = t.closest<HTMLElement>("[data-copy]");
		const entry = c && log.entries.find((x) => x.id === Number(c.dataset.copy));
		if (entry) copy(entry.text);
	});
	doc.addEventListener("keydown", onKey, true); // capture: Logseq handles Escape itself before it would bubble to us
	draw();
	search.focus();
}

function close() { doc.removeEventListener("keydown", onKey, true); panel?.remove(); panel = undefined; filter = ""; errorsOnly = false; }

function shown() {
	return log.entries.filter((e) => (!filter || e.text.toLowerCase().includes(filter)) && (!errorsOnly || errors.has(e.id)));
}

function draw() {
	const list = panel?.querySelector<HTMLElement>(".nh-list");
	if (!list) return;
	list.innerHTML = "";
	const items = shown();
	if (!items.length) {
		const d = doc.createElement("div"); d.className = "nh-empty";
		d.textContent = filter || errorsOnly ? "No notification matches." : "No notifications yet. They will appear here as Logseq and your plugins show them.";
		list.append(d); return;
	}
	const now = Date.now();
	for (const e of items) {
		const row = doc.createElement("div");
		row.className = "nh-row" + (errors.has(e.id) ? " nh-row--error" : "");
		const meta = doc.createElement("div"); meta.className = "nh-meta";
		const time = doc.createElement("span"); time.textContent = when(e.time, now); meta.append(time);
		if (e.count > 1) { const c = doc.createElement("span"); c.className = "nh-count"; c.textContent = `×${e.count}`; meta.append(c); }
		const cp = doc.createElement("button"); cp.className = "nh-copy"; cp.dataset.copy = String(e.id); cp.title = "Copy"; cp.textContent = "Copy"; meta.append(cp);
		const t = doc.createElement("div"); t.className = "nh-text"; t.textContent = e.text;
		row.append(meta, t); list.append(row);
	}
}

const CSS = `
.nh-toolbar { position: relative; }
.nh-toolbar-badge { position: absolute; top: 2px; right: 0; min-width: 14px; padding: 0 3px; border-radius: 7px; font-size: 10px; line-height: 14px; text-align: center; background: var(--ls-active-primary-color, #0f766e); color: #fff; }
.nh-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }
.nh-panel { width: min(720px, 92vw); max-height: 78vh; display: flex; flex-direction: column; background: var(--ls-primary-background-color, #fff); color: var(--ls-primary-text-color, #222); border: 1px solid var(--ls-border-color, #ddd); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.25); padding: 14px 16px; box-sizing: border-box; }
.nh-head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; margin-bottom: 10px; }
.nh-x { font-size: 20px; line-height: 1; padding: 0 6px; opacity: .6; }
.nh-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.nh-bar button, .nh-copy { border: 1px solid var(--ls-border-color, #ccc); border-radius: 6px; padding: 3px 10px; font-size: 13px; background: transparent; color: inherit; }
.nh-danger { color: var(--ls-error-text-color, #c0392b) !important; }
.nh-search { flex: 1 1 200px; min-width: 0; padding: 4px 8px; border: 1px solid var(--ls-border-color, #ccc); border-radius: 6px; background: var(--ls-secondary-background-color, transparent); color: inherit; }
.nh-errors { display: flex; align-items: center; gap: 5px; font-size: 13px; white-space: nowrap; }
.nh-list { overflow-y: auto; min-height: 100px; }
.nh-row { padding: 8px 4px 8px 10px; border-bottom: 1px solid var(--ls-border-color, #eee); border-left: 3px solid transparent; }
.nh-row--error { border-left-color: var(--ls-error-text-color, #e5484d); }
.nh-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: .7; }
.nh-meta .nh-copy { margin-left: auto; padding: 0 8px; font-size: 12px; }
.nh-count { color: var(--ls-link-text-color, #0f766e); }
.nh-text { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; margin-top: 2px; }
.nh-empty { opacity: .7; padding: 16px 0; }
`;

async function main() {
	logseq.useSettingsSchema([
		{ key: "persist", type: "boolean", default: true, title: "Keep history after restart", description: "Off: the list starts empty each time Logseq opens." },
		{ key: "max", type: "enum", enumChoices: ["50", "100", "200", "500", "1000"], enumPicker: "select", default: "200", title: "Notifications to keep", description: "Older ones are dropped." },
	]);
	logseq.provideStyle(CSS);
	logseq.provideModel({ openHistory: open });
	logseq.App.registerUIItem("toolbar", {
		key: "notification-history",
		template: `<a class="button nh-toolbar" data-on-click="openHistory" title="Notification history"><i class="ti ti-bell"></i><span class="nh-toolbar-badge" style="display:none"></span></a>`,
	});
	logseq.App.registerCommandPalette({ key: "notification-history-open", label: "Show notification history" }, () => open());
	logseq.App.registerCommandPalette({ key: "notification-history-clear", label: "Clear notification history" }, () => clearAll());
	logseq.onSettingsChanged(() => { log.load(log.entries, settings().max); changed(); });
	logseq.beforeunload(async () => {
		viewport?.disconnect(); body?.disconnect(); close();
		window.clearTimeout(saveTimer); await persist();
	});
	watch();
	// Load the saved history without holding up start-up; anything recorded meanwhile goes on top of it.
	void restore();
}

async function restore() {
	const raw = await logseq.FileStorage.getItem(STORE).catch(() => null);
	let saved: Saved = {};
	try { saved = raw ? JSON.parse(raw as string) : {}; } catch { saved = {}; }
	const s = settings();
	const fresh = log.entries;
	log.load(s.persist ? saved.entries : [], s.max);
	for (const e of (s.persist ? saved.entries : []) || []) if (e?.error) errors.add(e.id);
	for (const e of [...fresh].reverse()) { const n = log.add(e.text, e.time); if (n && errors.has(e.id)) { errors.delete(e.id); errors.add(n.id); } }
	draw();
}

logseq.ready(main).catch(console.error);
