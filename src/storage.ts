// Persistent JSON values, kept in Tampermonkey storage by the loader half (userscript.ts).
// The loader hands over the stored values with the page code, so they are there synchronously,
// before Discord draws anything; writes go back to it through the bridge.
import { INIT_GLOBAL, Init, send, TO_LOADER } from "./bridge";

const init: Init = (globalThis as any)[INIT_GLOBAL] ?? { values: {} };

export function load<T>(key: string): T | undefined {
    const v = init.values[key];
    if (v === undefined) return undefined;
    try { return JSON.parse(v); } catch { return undefined; }
}

export function save(key: string, value: unknown) {
    const json = JSON.stringify(value);
    init.values[key] = json;
    send(TO_LOADER, { op: "set", key, value: json });
}
