// Dev server for the userscript (Discord web + Tampermonkey).
//  - GET  /dev-loader.user.js       -> install once in Tampermonkey (src/userscript.ts, dev mode)
//  - GET  /NoBlocked.dev.js         -> fresh dev build of the page half (with src/dev.ts)
//  - GET  /NoBlocked.user.js        -> fresh release build
//  - POST /push   [{type, data}]    -> page -> server: "hello" / "log" / "result"
//  - GET  /poll                     -> server -> page: long poll for "run" messages
//  - POST /eval     {code}          -> run code in the Discord page, wait for the result
//  - POST /reload                   -> reload the Discord tab
//  - GET  /logs?since=N             -> page log lines (also appended to logs/page.log)
// The page talks to this server through GM_xmlhttpRequest: Chrome's Local Network Access blocks
// a public page's own fetch/XHR/WebSocket to 127.0.0.1, while extension requests are exempt.
import { appendFileSync, mkdirSync } from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import { GRANTS, buildRelease, bundleLoader, bundlePage, metadata } from "./build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4042);
const HOST = `127.0.0.1:${PORT}`;
const POLL_MS = 20000;

mkdirSync(path.join(root, "logs"), { recursive: true });
const logFile = path.join(root, "logs", "page.log");

/** @type {{ n: number, t: number, level: string, text: string }[]} */
const logs = [];
let logCounter = 0;
const pending = new Map(); // eval id -> { resolve, timer }

/** The page that said hello last; only it receives "run" messages. */
let session = null;
let lastPoll = 0;
/** @type {object[]} */
let outbox = [];
/** @type {((msgs: object[]) => void) | null} */
let waiter = null;

function pushLog(level, text) {
    const entry = { n: ++logCounter, t: Date.now(), level, text };
    logs.push(entry);
    if (logs.length > 5000) logs.shift();
    appendFileSync(logFile, `${new Date(entry.t).toISOString()} [${level}] ${text}\n`);
    return entry;
}

const stringifyArg = a => (typeof a === "string" ? a : JSON.stringify(a));
const connected = () => !!session && Date.now() - lastPoll < POLL_MS + 10000;

function handlePageMessage(msg, from) {
    if (msg.type === "hello") {
        if (session !== from) outbox = [];
        session = from;
        return pushLog("info", `page hello ${JSON.stringify(msg.data)}`);
    }
    if (msg.type === "result") {
        const p = pending.get(msg.data?.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.data.id);
        return p.resolve({ ok: !!msg.data.ok, result: msg.data.result });
    }
    if (msg.type === "log") return pushLog(msg.data?.level ?? "log", (msg.data?.message ?? []).map(stringifyArg).join(" "));
    pushLog("raw", JSON.stringify(msg));
}

function sendToPage(msg) {
    outbox.push(msg);
    if (waiter) {
        const w = waiter;
        waiter = null;
        w(outbox.splice(0));
    }
}

let evalCounter = 0;
function evalInPage(code, { depth = 3, timeout = 20000 } = {}) {
    if (!connected()) return Promise.resolve({ ok: false, result: "page not connected" });
    const id = ++evalCounter;
    return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, result: "timeout" }); }, timeout);
        pending.set(id, { resolve, timer });
        sendToPage({ type: "run", data: { id, code, depth } });
    });
}

/** Dev loader: the release grants plus GM_xmlhttpRequest for talking to this server. */
async function devLoader() {
    const header = await metadata({ name: "NoBlocked (dev)", grants: [...GRANTS, "GM_xmlhttpRequest"], extra: [["connect", "127.0.0.1"]] });
    return `${header}

${await bundleLoader({ dev: true, devHost: HOST })}`;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", c => (data += c));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function send(res, status, body, type = "application/json") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
        if (req.method === "GET" && url.pathname === "/dev-loader.user.js") return send(res, 200, await devLoader(), "text/javascript");
        if (req.method === "GET" && url.pathname === "/NoBlocked.dev.js") {
            if (process.env.NB_HOLD) return send(res, 503, "held");
            const started = Date.now();
            const js = await bundlePage({ dev: true, devHost: HOST });
            pushLog("server", `served dev build (${Date.now() - started}ms, ${js.length} bytes)`);
            return send(res, 200, js, "text/javascript");
        }
        if (req.method === "GET" && url.pathname === "/NoBlocked.user.js") return send(res, 200, (await buildRelease()).js, "text/javascript");
        if (req.method === "POST" && url.pathname === "/push") {
            const from = url.searchParams.get("s");
            for (const msg of JSON.parse(await readBody(req))) handlePageMessage(msg, from);
            return send(res, 200, { ok: true });
        }
        if (req.method === "GET" && url.pathname === "/poll") {
            const from = url.searchParams.get("s");
            if (from !== session) return setTimeout(() => send(res, 200, from ? [{ type: "idle" }] : []), POLL_MS);
            lastPoll = Date.now();
            if (outbox.length) return send(res, 200, outbox.splice(0));
            if (waiter) waiter([]);
            const timer = setTimeout(() => { if (waiter === w) waiter = null; send(res, 200, []); }, POLL_MS);
            const w = msgs => { clearTimeout(timer); send(res, 200, msgs); };
            waiter = w;
            return;
        }
        if (req.method === "GET" && url.pathname === "/status") return send(res, 200, { connected: connected(), session, logs: logCounter });
        if (req.method === "GET" && url.pathname === "/logs") {
            const since = Number(url.searchParams.get("since") ?? 0);
            return send(res, 200, logs.filter(l => l.n > since));
        }
        if (req.method === "POST" && url.pathname === "/eval") {
            const { code, depth, timeout } = JSON.parse(await readBody(req));
            return send(res, 200, await evalInPage(code, { depth, timeout }));
        }
        if (req.method === "POST" && url.pathname === "/reload") {
            if (!connected()) return send(res, 200, { ok: false, result: "page not connected" });
            sendToPage({ type: "run", data: { id: 0, code: "setTimeout(function(){ location.reload(); }, 50);" } });
            return send(res, 200, { ok: true, result: "reloading" });
        }
        send(res, 404, { error: "not found" });
    } catch (e) {
        pushLog("server-error", String(e?.stack ?? e));
        send(res, 500, { error: String(e?.message ?? e) });
    }
});

server.listen(PORT, "127.0.0.1", () => console.log(`NoBlocked dev server on http://${HOST} (install http://${HOST}/dev-loader.user.js)`));
