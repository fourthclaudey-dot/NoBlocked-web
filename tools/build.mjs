// Builds src/index.ts into the userscript.
//   release: dist/NoBlocked.user.js  (metadata block + bundle)
//   dev:     the bare bundle with dev tooling, served by tools/dev-server.mjs to the dev loader
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

/** Where GitHub Pages serves the release; Tampermonkey checks it for updates. */
export const PAGES_URL = "https://fourthclaudey-dot.github.io/NoBlocked-web/";

/** Tampermonkey grants. Shared with the dev loader so dev runs in the same sandbox as release. */
export const GRANTS = ["GM_getValue", "GM_setValue", "GM_registerMenuCommand"];
export const SANDBOX = "raw";
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
        ["sandbox", SANDBOX],
        ...grants.map(g => ["grant", g]),
        ...extra,
    ];
    const width = Math.max(...lines.map(([k]) => k.length)) + 1;
    return ["// ==UserScript==", ...lines.map(([k, v]) => `// @${k.padEnd(width)}${v}`), "// ==/UserScript=="].join("\n");
}

export async function bundle({ dev = false, devHost = "127.0.0.1:4042" } = {}) {
    const result = await build({
        entryPoints: [path.join(root, "src/index.ts")],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "firefox115",
        legalComments: "none",
        minifySyntax: true, // folds `if (__DEV__)`: release builds carry no dev code
        define: { __DEV__: JSON.stringify(dev), __DEV_HOST__: JSON.stringify(devHost) },
        logLevel: "silent",
    });
    return result.outputFiles[0].text;
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
    const js = `${header}\n\n${await bundle()}`;
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "NoBlocked.user.js"), js);
    return { js, ms: Date.now() - started };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const { js, ms } = await buildRelease();
    console.log(`built dist/NoBlocked.user.js in ${ms}ms (${js.length} bytes)`);
}
