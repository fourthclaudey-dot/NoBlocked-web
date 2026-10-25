// Run JS in the Discord page through the dev server and print the result.
//   node tools/eval.mjs "nb.stores.RelationshipStore.getBlockedIDs()"   (expression)
//   node tools/eval.mjs -f scratch.js                                     (function body, use `return`)
//   node tools/eval.mjs --reload                                          (reload the Discord tab)
//   node tools/eval.mjs --logs [since]                                    (dump page logs)
// Code may use `await`. In the page: `nb` (dev handle: stores, wp, flux, …), `find*` helpers.
import { readFileSync } from "fs";
import vm from "vm";

const PORT = Number(process.env.PORT ?? 4042);
const base = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);

function opt(name, fallback) {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
}

/** An expression becomes `return (expr)`; anything else is used as a function body. */
function asBody(src) {
    const expr = `return (${src}\n);`;
    try {
        new vm.Script(`(async function(){${expr}})`);
        return expr;
    } catch {
        return src;
    }
}

async function post(path, payload) {
    const r = await fetch(base + path, { method: "POST", body: JSON.stringify(payload ?? {}) });
    return r.json();
}

if (argv[0] === "--reload") {
    console.log(JSON.stringify(await post("/reload")));
} else if (argv[0] === "--logs") {
    const r = await fetch(`${base}/logs?since=${argv[1] ?? 0}`);
    for (const l of await r.json()) console.log(`${l.n} [${l.level}] ${l.text}`);
} else {
    const depth = Number(opt("--depth", 3));
    const timeout = Number(opt("--timeout", 20000));
    const file = opt("-f");
    const body = asBody(file ? readFileSync(file, "utf8") : argv.join(" "));
    const res = await post("/eval", { code: body, depth, timeout });
    if (!res.ok) console.log("ERROR:");
    console.log(typeof res.result === "string" ? res.result : JSON.stringify(res.result, null, 2));
    process.exitCode = res.ok ? 0 : 1;
}
