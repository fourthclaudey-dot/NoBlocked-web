// The userscript itself, in whatever world Tampermonkey runs it (see bridge.ts). It keeps the
// GM_* APIs here and injects the main code (index.ts) into the page synchronously, at
// document-start, so it is in place before Discord's own scripts run.
import { INIT_GLOBAL, listen, RUNNING_ATTR, send, TO_LOADER, TO_PAGE, ToLoader } from "./bridge";
import { t } from "./i18n";

/** Release: the page code. Dev: empty, the dev server sends it. */
declare const __PAGE_CODE__: string;

/** Keys the page code reads at start. */
const KEYS = ["settings", "reactionCache", "devNoFix"];

function values() {
    const out: Record<string, string | undefined> = {};
    for (const key of KEYS) {
        try { out[key] = GM_getValue?.<string | undefined>(key, undefined); } catch {}
    }
    return out;
}

function inject(code: string) {
    const src = `window.${INIT_GLOBAL}=${JSON.stringify({ values: values() })};\n${code}\n//# sourceURL=NoBlocked.page.js`;
    const parent = document.head ?? document.documentElement;
    // Discord's CSP lets scripts with its nonce run; an inline script runs right on insertion.
    const nonce = [...document.querySelectorAll("script")].map(s => s.nonce).find(Boolean);
    const inline = document.createElement("script");
    if (nonce) inline.nonce = nonce;
    inline.textContent = src;
    parent.append(inline);
    inline.remove();
    if (document.documentElement.hasAttribute(RUNNING_ATTR)) return;
    // No usable nonce: blob: is allowed too, but runs a moment later.
    const blob = document.createElement("script");
    blob.src = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    blob.onload = () => { URL.revokeObjectURL(blob.src); blob.remove(); };
    parent.append(blob);
}

declare const GM_xmlhttpRequest: (req: { method: string; url: string; data?: string; headers?: Record<string, string>; timeout?: number; onload?: (r: { status: number; responseText: string }) => void; onerror?: () => void; ontimeout?: () => void }) => void;

listen<ToLoader>(TO_LOADER, msg => {
    if (msg.op === "set") {
        try { GM_setValue?.(msg.key, msg.value); } catch {}
    } else if (__DEV__ && msg.op === "xhr") {
        const done = (status: number, text: string) => send(TO_PAGE, { op: "xhr-done", id: msg.id, status, text });
        GM_xmlhttpRequest({
            method: msg.method, url: msg.url, data: msg.data, timeout: 30000,
            headers: msg.data ? { "Content-Type": "application/json" } : undefined,
            onload: r => done(r.status, r.responseText), onerror: () => done(0, ""), ontimeout: () => done(0, ""),
        });
    }
});

try {
    GM_registerMenuCommand?.(`⚙ NoBlocked · ${t().settings}`, () => send(TO_PAGE, { op: "open-settings" }));
} catch {}

/**
 * Dev: run the build stored last time, fetch the current one from the dev server, and reload
 * once if it changed (Tampermonkey cannot fetch synchronously). GM_setValue persists
 * asynchronously in Manifest V3 Tampermonkey, hence the delay before reloading.
 */
function devLoad() {
    const KEY = "nbDevBuild";
    const cached = GM_getValue?.<string>(KEY, "") ?? "";
    if (cached) inject(cached);
    const mayReload = () => {
        try {
            const now = Date.now();
            const hist = (JSON.parse(sessionStorage.getItem("nbDevReloads") || "[]") as number[]).filter(x => now - x < 30000);
            if (hist.length >= 3) return false;
            hist.push(now);
            sessionStorage.setItem("nbDevReloads", JSON.stringify(hist));
            return true;
        } catch { return false; }
    };
    GM_xmlhttpRequest({
        method: "GET",
        url: `http://${__DEV_HOST__}/NoBlocked.dev.js?t=${Date.now()}`,
        onload: r => {
            if (r.status !== 200 || r.responseText === cached) return;
            GM_setValue?.(KEY, r.responseText);
            if (!cached) inject(r.responseText);
            else if (mayReload()) setTimeout(() => location.reload(), 1500);
        },
        onerror: () => console.warn("[NoBlocked dev] dev server unreachable, running the stored build"),
    });
}

if (__DEV__) devLoad();
else inject(__PAGE_CODE__);
