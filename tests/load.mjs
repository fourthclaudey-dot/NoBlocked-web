// Bundles a TypeScript module from src/ with esbuild and imports it, for tests of the shared logic.
import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function load(entry, globals = {}) {
    Object.assign(globalThis, globals);
    const { outputFiles } = await build({
        entryPoints: [path.join(root, "src", entry)],
        bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent",
        define: { __DEV__: "false", __DEV_HOST__: '""' },
    });
    return import("data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64"));
}
