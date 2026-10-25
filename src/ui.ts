// Settings window: same sections, texts and order as the mobile plugin's settings page.
// Plain DOM styled with Discord's CSS variables, so it needs nothing from Discord's React tree.
import { t } from "./i18n";
import { Category, Mode, saveSettings, storage } from "./settings";

type ModeKey = "inherit" | Mode;

const ID = "noblocked-settings";
const CSS = `
#${ID}{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);font-family:var(--font-primary,"gg sans","Noto Sans",sans-serif)}
#${ID} .nb-modal{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 64px);display:flex;flex-direction:column;border-radius:8px;overflow:hidden;
  background:var(--modal-background,var(--background-base-low,var(--background-primary,#313338)));color:var(--text-default,var(--text-normal,#dbdee1));box-shadow:0 8px 24px rgba(0,0,0,.4)}
#${ID} .nb-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px}
#${ID} .nb-title{font-size:20px;font-weight:600;color:var(--header-primary,var(--text-strong,#f2f3f5))}
#${ID} .nb-close{background:none;border:0;color:inherit;font-size:22px;line-height:1;cursor:pointer;opacity:.7;padding:4px 8px}
#${ID} .nb-close:hover{opacity:1}
#${ID} .nb-body{overflow:auto;padding:0 16px 16px}
#${ID} .nb-section{margin-top:16px}
#${ID} .nb-section h3{margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;color:var(--header-secondary,var(--text-muted,#b5bac1))}
#${ID} label.nb-row{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:4px;cursor:pointer}
#${ID} label.nb-row:hover{background:var(--background-modifier-hover,rgba(78,80,88,.3))}
#${ID} label.nb-row.nb-disabled{opacity:.5;cursor:not-allowed}
#${ID} .nb-row input{margin:2px 0 0;flex:none;accent-color:var(--brand-500,var(--brand-experiment,#5865f2));width:16px;height:16px}
#${ID} .nb-text{display:flex;flex-direction:column;gap:2px;font-size:16px}
#${ID} .nb-sub{font-size:13px;color:var(--text-muted,#949ba4)}
#${ID} hr{border:0;border-top:1px solid var(--background-modifier-accent,rgba(78,80,88,.48));margin:6px 0}
#${ID} .nb-foot{margin-top:16px;font-size:13px;color:var(--text-muted,#949ba4)}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, any> = {}, ...children: (Node | string | null)[]) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) if (c != null) node.append(c);
    return node;
}

function row(type: "radio" | "checkbox", label: string, checked: boolean, disabled: boolean, onChange: (v: boolean) => void, sub?: string, name?: string) {
    const input = el("input", { type, checked, disabled, name: name ?? "" });
    input.addEventListener("change", () => onChange(input.checked));
    return el("label", { className: `nb-row${disabled ? " nb-disabled" : ""}` },
        input,
        el("span", { className: "nb-text" }, label, sub ? el("span", { className: "nb-sub" }, sub) : null));
}

function section(title: string, ...children: (Node | null)[]) {
    return el("div", { className: "nb-section" }, el("h3", {}, title), ...children);
}

let open: HTMLElement | null = null;

function changed() {
    saveSettings();
    render();
}

function modePicker(name: string, value: string, options: ModeKey[], onChange: (v: ModeKey) => void) {
    const labels = t().modes;
    return el("div", {}, ...options.map(o => row("radio", labels[o], value === o, storage.total, v => { if (v) { onChange(o); changed(); } }, undefined, name)));
}

function categorySection(cat: Category, title: string, options: ModeKey[]) {
    const s = storage[cat] as { mode: string; unread: boolean; reactions?: boolean };
    const str = t();
    return section(title,
        modePicker(`nb-${cat}`, s.mode, options, v => (s.mode = v)),
        el("hr"),
        row("checkbox", str.countsNew, !storage.total && s.unread, storage.total, v => { s.unread = v; changed(); }, str.countsNewNote),
        cat !== "replies"
            ? row("checkbox", str.reactions, storage.total || !!s.reactions, storage.total, v => { s.reactions = v; changed(); }, str.reactionsNote)
            : null,
    );
}

function render() {
    if (!open) return;
    const str = t();
    const toggle = (key: "total" | "merge" | "serverAck") => (v: boolean) => { storage[key] = v; changed(); };
    const body = el("div", { className: "nb-body" },
        section(str.main, row("checkbox", str.total, storage.total, false, toggle("total"), str.totalNote)),
        section(str.shared, modePicker("nb-shared", storage.mode, ["reveal", "bar", "remove"], v => (storage.mode = v as any))),
        categorySection("blocked", str.blocked, ["inherit", "reveal", "bar", "remove"]),
        categorySection("ignored", str.ignored, ["inherit", "reveal", "bar", "remove"]),
        categorySection("replies", str.replies, ["off", "reveal", "bar", "remove"]),
        section(str.display,
            row("checkbox", str.merge, storage.merge, false, toggle("merge"), str.mergeNote),
            row("checkbox", str.serverAck, storage.serverAck, false, toggle("serverAck"), str.serverAckNote)),
        el("div", { className: "nb-foot" }, str.cached(storage.cache.blocked.length, storage.cache.ignored.length)),
    );
    const scroll = open.querySelector(".nb-body")?.scrollTop ?? 0;
    open.querySelector(".nb-body")?.replaceWith(body);
    body.scrollTop = scroll;
    const title = open.querySelector(".nb-title");
    if (title) title.textContent = `NoBlocked · ${str.settings}`;
    open.querySelector(".nb-close")?.setAttribute("aria-label", str.close);
}

export function closeSettings() {
    open?.remove();
    open = null;
    document.removeEventListener("keydown", onKey, true);
}

function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closeSettings();
}

export function openSettings() {
    if (open) return;
    if (!document.getElementById(`${ID}-style`)) document.head.append(el("style", { id: `${ID}-style`, textContent: CSS }));
    const close = el("button", { className: "nb-close", type: "button", textContent: "×" });
    close.addEventListener("click", closeSettings);
    const modal = el("div", { className: "nb-modal", role: "dialog" },
        el("div", { className: "nb-head" }, el("div", { className: "nb-title" }), close),
        el("div", { className: "nb-body" }));
    open = el("div", { id: ID }, modal);
    open.addEventListener("mousedown", e => { if (e.target === open) closeSettings(); });
    document.body.append(open);
    document.addEventListener("keydown", onKey, true);
    render();
}
