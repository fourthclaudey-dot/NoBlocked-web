// Minimal webpack hook for Discord web. Runs at document-start, before Discord's runtime:
// - every module factory pushed to `webpackChunkdiscord_app` is wrapped, so we see each module's
//   exports the moment it is created (and get `__webpack_require__` from the first one);
// - `__webpack_require__.d` defines export getters as configurable, so exports can be patched;
// - lookups (by store name, by export props, by source code text) work on loaded modules, and
//   `waitFor` fires as soon as a matching module loads — before Discord's UI can use it.
import { log } from "./log";

type Exports = any;
type Filter = (exports: Exports, id: string) => boolean;

const CHUNK_GLOBAL = "webpackChunkdiscord_app";
const win = window as any;

/** Discord loads several webpack runtimes (app, sentry, …) on one chunk array; each has its own require. */
const requires = new Set<any>();
/** Original factory source by module id, for code search. */
const sources = new Map<string, string>();
const waiters: { filter: Filter; cb: (exports: Exports, id: string) => void }[] = [];

function configurableDefine(this: any, exports: any, getters: Record<string, () => unknown>) {
    for (const key in getters) {
        if (Object.prototype.hasOwnProperty.call(getters, key) && !Object.prototype.hasOwnProperty.call(exports, key)) {
            Object.defineProperty(exports, key, { enumerable: true, configurable: true, get: getters[key] });
        }
    }
}

function captureRequire(req: any) {
    if (!req?.m || requires.has(req)) return;
    requires.add(req);
    req.d = configurableDefine;
    // Modules bundled into the runtime chunk itself never pass through `push`.
    const pending: Record<string, Function> = {};
    for (const id in req.m) if (!req.c?.[id]) pending[id] = req.m[id];
    wrapFactories(pending);
    for (const id in pending) req.m[id] = pending[id];
}

function checkWaiters(exports: Exports, id: string) {
    if (!waiters.length || exports == null) return;
    for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        let hit: Exports = undefined;
        try { hit = matchExports(exports, id, w.filter); } catch {}
        if (hit === undefined) continue;
        waiters.splice(i, 1);
        try { w.cb(hit, id); } catch (e) { log.error("waitFor callback", e); }
    }
}

// ---- source patches --------------------------------------------------------------------------
// For code Discord keeps inside a module (not exported), the module's factory source is edited
// before it first runs. Each patch is all-or-nothing: if any replacement stops matching after a
// Discord update, the whole patch is skipped and logged, and only its feature is lost.

export interface SourcePatch {
    name: string;
    /** Strings the module source must contain. */
    find: string[];
    replacements: { match: RegExp; replace: string }[];
}

const sourcePatches: SourcePatch[] = [];
/** Patch name -> module id it was applied to, or an error. */
export const patchStatus: Record<string, string> = {};

export function addSourcePatch(patch: SourcePatch) {
    sourcePatches.push(patch);
    patchStatus[patch.name] = "pending";
}

function applySourcePatches(id: string, src: string, orig: Function): Function {
    let code = src;
    const applied: string[] = [];
    for (const patch of sourcePatches) {
        if (patchStatus[patch.name] !== "pending" || !patch.find.every(f => code.includes(f))) continue;
        let next = code;
        const missing = patch.replacements.filter(r => {
            const before = next;
            next = next.replace(r.match, r.replace);
            return next === before;
        });
        if (missing.length) {
            patchStatus[patch.name] = `no match: ${missing.map(r => r.match).join(", ")}`;
            log.warn(`source patch "${patch.name}" does not match module ${id}, feature disabled`);
            continue;
        }
        code = next;
        applied.push(patch.name);
    }
    if (!applied.length) return orig;
    try {
        // Factories print as `123(e,t,n){…}` (method shorthand), `function(e,t,n){…}` or arrows.
        const expr = /^[\w$]+\s*\(/.test(code) && !code.startsWith("function") ? `function${code.slice(code.indexOf("("))}` : code;
        const fn = (0, eval)(`(${expr})
//# sourceURL=NoBlocked-patched-${id}`);
        for (const name of applied) patchStatus[name] = `module ${id}`;
        return fn;
    } catch (e) {
        for (const name of applied) patchStatus[name] = `compile failed: ${e}`;
        log.error(`patched module ${id} does not compile, running the original`, e);
        return orig;
    }
}

function wrapFactories(modules: Record<string, Function>) {
    for (const id in modules) {
        const orig = modules[id];
        if (typeof orig !== "function" || (orig as any).__nb) continue;
        const src = Function.prototype.toString.call(orig);
        sources.set(id, src);
        const factory = sourcePatches.length ? applySourcePatches(id, src, orig) : orig;
        const wrapped = function (this: any, module: any, exports: any, require: any) {
            captureRequire(require);
            const ret = factory.call(this, module, exports, require);
            checkWaiters(module.exports, id);
            return ret;
        };
        (wrapped as any).__nb = true;
        (wrapped as any).toString = () => sources.get(id);
        modules[id] = wrapped;
    }
}

/** Install the hook. Must run before Discord's webpack runtime. */
export function hookWebpack() {
    const arr: any = win[CHUNK_GLOBAL] ?? (win[CHUNK_GLOBAL] = []);
    if (arr.__nbHooked) return;
    arr.__nbHooked = true;
    // Chunks pushed before the runtime takes over `push` are wrapped here...
    for (const chunk of arr) if (chunk?.[1]) wrapFactories(chunk[1]);
    // ...and later ones in front of whatever `push` is at the time. Each runtime wraps the `push`
    // it reads, so the getter hands out a wrapper of the current one rather than a fixed function
    // (a fixed one would end up calling itself once a second runtime wraps it).
    let current = arr.push;
    Object.defineProperty(arr, "push", {
        configurable: true,
        get: () => {
            const target = current;
            return function (this: any, ...chunks: any[]) {
                for (const chunk of chunks) if (chunk?.[1]) wrapFactories(chunk[1]);
                return target.apply(this, chunks);
            };
        },
        set: v => { current = v; },
    });
    if (win[CHUNK_GLOBAL] !== arr) log.warn("chunk array replaced before hook");
}

/** Every require seen so far; the late path (started after Discord) asks via a fake chunk. */
function allRequires(): any[] {
    const arr = win[CHUNK_GLOBAL];
    if (!requires.size && arr && !arr.__nbHooked) {
        arr.push?.([[Symbol("nb")], {}, (r: any) => captureRequire(r)]);
    }
    return [...requires];
}

/** The require whose runtime owns this module id. */
function requireFor(id: string) {
    return allRequires().find(r => r.m && Object.prototype.hasOwnProperty.call(r.m, id));
}

/** Proxies that answer any key (e.g. react-aria's context objects) match every filter: skip them. */
function answersAnything(v: any) {
    try { return "\u0000nb" in v || v["\u0000nb"] !== undefined; } catch { return true; }
}

function matchExports(exports: Exports, id: string, filter: Filter): Exports {
    if (exports == null || typeof exports !== "object" && typeof exports !== "function") return undefined;
    if (!answersAnything(exports) && filter(exports, id)) return exports;
    for (const key in exports) {
        let v: any;
        try { v = exports[key]; } catch { continue; }
        if (v && (typeof v === "object" || typeof v === "function") && !answersAnything(v) && filter(v, id)) return v;
    }
    return undefined;
}

/** Exports of every module created so far. */
function* loaded(): Generator<[string, Exports]> {
    for (const r of allRequires()) {
        const cache = r.c;
        if (!cache) continue;
        for (const id in cache) {
            const exports = cache[id]?.exports;
            if (exports != null && exports !== win) yield [id, exports];
        }
    }
}

export function find(filter: Filter): Exports {
    for (const [id, exports] of loaded()) {
        try {
            const hit = matchExports(exports, id, filter);
            if (hit !== undefined) return hit;
        } catch {}
    }
    return undefined;
}

export function findAll(filter: Filter): Exports[] {
    const out: Exports[] = [];
    for (const [id, exports] of loaded()) {
        try {
            const hit = matchExports(exports, id, filter);
            if (hit !== undefined) out.push(hit);
        } catch {}
    }
    return out;
}

export const byProps = (...props: string[]): Filter => e => props.every(p => { try { return e[p] !== undefined; } catch { return false; } });
export const byStoreName = (name: string): Filter => e => typeof e?.getName === "function" && safeName(e) === name;

function safeName(e: any) {
    try { return e.getName(); } catch { return undefined; }
}

/** Ids of modules whose factory source contains every string. */
export function idsByCode(...needles: string[]): string[] {
    const out: string[] = [];
    for (const [id, src] of sources) if (needles.every(n => src.includes(n))) out.push(id);
    if (!out.length) {
        for (const r of allRequires()) {
            for (const id in r.m) {
                if (sources.has(id)) continue;
                const src = String(r.m[id]);
                if (needles.every(n => src.includes(n))) out.push(id);
            }
        }
    }
    return out;
}

/** Exports of the (first) module whose source contains every string; loads it if needed. */
export function byCode(...needles: string[]): Exports {
    const id = idsByCode(...needles)[0];
    if (id === undefined) return undefined;
    const r = requireFor(id);
    return r ? r(id) : undefined;
}

export const findByProps = (...props: string[]) => find(byProps(...props));
export const findStore = (name: string) => find(byStoreName(name));

/** Calls back with the first module matching the filter: now if loaded, else the moment it loads. */
export function waitFor(filter: Filter, cb: (exports: Exports, id: string) => void) {
    const hit = find(filter);
    if (hit !== undefined) return void cb(hit, "");
    waiters.push({ filter, cb });
}

export function moduleSource(id: string) {
    if (sources.has(id)) return sources.get(id);
    const r = requireFor(id);
    return r ? Function.prototype.toString.call(r.m[id]) : undefined;
}

export function getRequires() {
    return allRequires();
}
