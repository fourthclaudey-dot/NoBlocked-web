// Link between the two halves of the script.
// Tampermonkey decides which JavaScript world a userscript runs in (the page's or an isolated
// one), and Discord's internals are only reachable from the page's. So the userscript itself
// (userscript.ts, Tampermonkey's world) only holds the GM_* APIs and injects the main code into
// the page; both talk through DOM events, the one thing the two worlds share. Payloads are JSON
// strings so they cross worlds unchanged (Firefox wraps objects passed between them).

export const TO_LOADER = "noblocked:to-loader";
export const TO_PAGE = "noblocked:to-page";
/** Attribute the page half sets on <html> once it runs, so the loader knows the injection worked. */
export const RUNNING_ATTR = "data-noblocked";
/** Global the loader sets right before the page code, with the stored values. */
export const INIT_GLOBAL = "__NoBlockedInit";

export interface Init {
    /** Stored values as Tampermonkey holds them (JSON strings), by key. */
    values: Record<string, string | undefined>;
}

export type ToLoader =
    | { op: "set"; key: string; value: string }
    | { op: "xhr"; id: number; method: string; url: string; data?: string };

export type ToPage =
    | { op: "open-settings" }
    | { op: "xhr-done"; id: number; status: number; text: string };

export function send(name: string, msg: ToLoader | ToPage) {
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(msg) }));
}

export function listen<T>(name: string, fn: (msg: T) => void) {
    document.addEventListener(name, e => {
        let msg: T;
        try { msg = JSON.parse(String((e as CustomEvent).detail)); } catch { return; }
        fn(msg);
    });
}
