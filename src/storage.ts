// Persistent JSON values. Tampermonkey storage (GM_getValue is synchronous, so the block/ignore
// cache is there before Discord draws anything); localStorage as a fallback, captured at
// document-start because Discord deletes `window.localStorage` later.
const local: Storage | null = (() => {
    try { return window.localStorage; } catch { return null; }
})();
const PREFIX = "NoBlocked:";

export function load<T>(key: string): T | undefined {
    try {
        if (typeof GM_getValue === "function") {
            const v = GM_getValue<string | undefined>(key, undefined);
            return v === undefined ? undefined : JSON.parse(v);
        }
        const v = local?.getItem(PREFIX + key);
        return v == null ? undefined : JSON.parse(v);
    } catch {
        return undefined;
    }
}

export function save(key: string, value: unknown) {
    const json = JSON.stringify(value);
    try {
        if (typeof GM_setValue === "function") GM_setValue(key, json);
        else local?.setItem(PREFIX + key, json);
    } catch {}
}
