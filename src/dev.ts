// Dev-only client for tools/dev-server.mjs: logs out, code in (tools/eval.mjs).
// Transport is HTTP through the loader's GM_xmlhttpRequest (bridge.ts): Chrome's Local Network
// Access blocks the page's own requests to 127.0.0.1. Release builds strip every call site
// (`if (__DEV__)`), so this module is dropped from them.
import { listen, send, TO_LOADER, TO_PAGE, ToPage } from "./bridge";

let session = "";
const outbox: unknown[] = [];
let flushQueued = false;
/** Objects the REPL sees as `nb`. */
export const devHandle: Record<string, any> = {};

let xhrId = 0;
const xhrPending = new Map<number, (text: string) => void>();

function http(method: string, path: string, data?: string): Promise<string> {
    if (!xhrId) listen<ToPage>(TO_PAGE, msg => {
        if (msg.op !== "xhr-done") return;
        xhrPending.get(msg.id)?.(msg.status === 200 ? msg.text : "");
        xhrPending.delete(msg.id);
    });
    session ||= Math.random().toString(36).slice(2);
    const id = ++xhrId;
    return new Promise(resolve => {
        xhrPending.set(id, resolve);
        send(TO_LOADER, { op: "xhr", id, method, url: `http://${__DEV_HOST__}${path}${path.includes("?") ? "&" : "?"}s=${session}`, data });
    });
}

function sendRaw(msg: unknown) {
    if (outbox.length < 5000) outbox.push(msg);
    // A microtask, not a timer: Chrome throttles timers of background tabs to once a minute.
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => {
        flushQueued = false;
        void http("POST", "/push", JSON.stringify(outbox.splice(0)));
    });
}

/** Cycle/depth-safe copy of a value so it survives JSON transport. */
function inspect(v: any, depth: number): any {
    const seen: any[] = [];
    const ins = (v: any, d: number): any => {
        if (v === undefined) return "<undefined>";
        if (v === null || typeof v === "number" || typeof v === "boolean") return v;
        if (typeof v === "string") return v.length > 4000 ? `${v.slice(0, 4000)}…(${v.length})` : v;
        if (typeof v === "function") return `<fn ${v.displayName || v.name || "anon"}(${v.length})>`;
        if (typeof v === "symbol" || typeof v === "bigint") return String(v);
        if (v instanceof Error) return { __error: String(v), stack: String(v.stack || "").split("\n").slice(0, 8).join("\n") };
        if (typeof Node !== "undefined" && v instanceof Node) return `<${v.nodeName}${(v as any).className ? "." + String((v as any).className).split(" ").join(".") : ""}>`;
        if (seen.includes(v)) return "<cycle>";
        if (d >= depth) return Array.isArray(v) ? `<array ${v.length}>` : `<object ${v.constructor?.name ?? ""} keys=${Object.keys(v).length}>`;
        seen.push(v);
        let out: any;
        if (Array.isArray(v)) {
            out = v.slice(0, 100).map(x => ins(x, d + 1));
            if (v.length > 100) out.push(`…+${v.length - 100}`);
        } else if (v instanceof Map || v instanceof Set) {
            out = { __type: v.constructor.name, size: v.size, entries: ins([...v].slice(0, 50), d + 1) };
        } else {
            out = {};
            const keys = Object.keys(v);
            for (const k of keys.slice(0, 150)) {
                try { out[k] = ins(v[k], d + 1); } catch (e) { out[k] = `<throws ${e}>`; }
            }
            if (keys.length > 150) out["…"] = `+${keys.length - 150} keys`;
        }
        seen.pop();
        return out;
    };
    return ins(v, 0);
}

async function run({ id, code, depth = 3 }: { id: number; code: string; depth?: number }) {
    let ok = true;
    let value: any;
    try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        value = await new AsyncFunction("nb", code)(devHandle);
    } catch (e) {
        ok = false;
        value = e;
    }
    if (id) sendRaw({ type: "result", data: { id, ok, result: inspect(value, ok ? depth : 2) } });
}

export function devLog(level: string, args: any[]) {
    sendRaw({ type: "log", data: { level, message: args.map(a => (typeof a === "string" ? a : inspect(a, 3))) } });
}

async function poll() {
    for (;;) {
        const body = await http("GET", "/poll");
        let msgs: any[] = [];
        try { msgs = body ? JSON.parse(body) : []; } catch {}
        if (!body) await new Promise(r => setTimeout(r, 2000));
        for (const msg of msgs) {
            if (msg.type === "run") void run(msg.data);
            if (msg.type === "idle") return; // another tab took over the REPL
        }
    }
}

export function startDev(hello: Record<string, unknown>) {
    (globalThis as any).nb = devHandle;
    addEventListener("error", e => devLog("error", ["uncaught", String(e.error?.stack ?? e.message)]));
    addEventListener("unhandledrejection", e => devLog("error", ["unhandled rejection", String(e.reason?.stack ?? e.reason)]));
    sendRaw({ type: "hello", data: hello });
    void poll();
}
