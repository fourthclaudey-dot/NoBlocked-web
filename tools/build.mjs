// Builds the userscript: src/index.ts (the page half) is bundled and embedded as a string into
// src/userscript.ts (the Tampermonkey half, which injects it into the page; see src/bridge.ts).
//   release: dist/NoBlocked.user.js  (metadata block + loader with the page code inside)
//   dev:     the dev loader (served by tools/dev-server.mjs) fetches the page code from the server
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

/** Where GitHub Pages serves the release; Tampermonkey checks it for updates. */
export const PAGES_URL = "https://fourthclaudey-dot.github.io/NoBlocked-web/";

/** Tampermonkey grants. The dev loader adds GM_xmlhttpRequest for talking to the dev server. */
export const GRANTS = ["GM_getValue", "GM_setValue", "GM_registerMenuCommand"];
export const MATCHES = ["https://discord.com/*", "https://ptb.discord.com/*", "https://canary.discord.com/*"];

export async function metadata({ name = "NoBlocked", grants = GRANTS, extra = [] } = {}) {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const lines = [
        ["name", name],
        ["namespace", "https://github.com/fourthclaudey-dot/NoBlocked-web"],
        ["version", pkg.version],
        ["description", "Hides blocked and ignored users everywhere in Discord"],
        ["author", "Imperator, Claude"],
        ["license", "MIT"],
        ...MATCHES.map(m => ["match", m]),
        ["run-at", "document-start"],
        ...grants.map(g => ["grant", g]),
        ...extra,
    ];
    const width = Math.max(...lines.map(([k]) => k.length)) + 1;
    return ["// ==UserScript==", ...lines.map(([k, v]) => `// @${k.padEnd(width)}${v}`), "// ==/UserScript=="].join("\n");
}

async function bundleEntry(entry, { dev, devHost, page }) {
    const result = await build({
        entryPoints: [path.join(root, "src", entry)],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "firefox115",
        legalComments: "none",
        minifySyntax: true, // folds `if (__DEV__)`: release builds carry no dev code
        define: { __DEV__: JSON.stringify(dev), __DEV_HOST__: JSON.stringify(devHost), __PAGE_CODE__: JSON.stringify(page ?? "") },
        logLevel: "silent",
    });
    return result.outputFiles[0].text;
}

/** The page half: everything that touches Discord. */
export function bundlePage({ dev = false, devHost = "127.0.0.1:4042" } = {}) {
    return bundleEntry("index.ts", { dev, devHost });
}

/** The Tampermonkey half; release builds carry the page half inside. */
export async function bundleLoader({ dev = false, devHost = "127.0.0.1:4042" } = {}) {
    const page = dev ? "" : await bundlePage({ dev, devHost });
    return bundleEntry("userscript.ts", { dev, devHost, page });
}

export async function buildRelease() {
    const started = Date.now();
    const header = await metadata({
        extra: [
            ["homepageURL", "https://github.com/fourthclaudey-dot/NoBlocked-web"],
            ["supportURL", "https://github.com/fourthclaudey-dot/NoBlocked-web/issues"],
            ["updateURL", `${PAGES_URL}NoBlocked.user.js`],
            ["downloadURL", `${PAGES_URL}NoBlocked.user.js`],
        ],
    });
    const js = `${header}\n\n${await bundleLoader()}`;
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "NoBlocked.user.js"), js);
    // GitHub Pages landing page: opening the .user.js link makes Tampermonkey offer the install.
    await writeFile(path.join(dist, "index.html"), `<!doctype html><meta charset="utf-8"><title>NoBlocked</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:3em auto;padding:0 1em;background:#313338;color:#dbdee1}a{color:#00a8fc}</style>
<h1>NoBlocked</h1>
<p>Hides blocked and ignored users everywhere in Discord (web).</p>
<p><a href="NoBlocked.user.js"><b>Install NoBlocked.user.js</b></a> (needs Tampermonkey)</p>
<p><a href="https://github.com/fourthclaudey-dot/NoBlocked-web">Source, details and issues</a></p>
`);
    return { js, ms: Date.now() - started };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const { js, ms } = await buildRelease();
    console.log(`built dist/NoBlocked.user.js in ${ms}ms (${js.length} bytes)`);
}
