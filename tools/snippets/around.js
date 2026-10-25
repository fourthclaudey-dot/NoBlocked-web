// Source around each occurrence of a needle in a module: set globalThis.__a = [id, needle, before, after, max]
const [id, needle, before = 300, after = 1500, max = 3] = globalThis.__a;
const src = nb.wp.moduleSource(id) ?? "";
const out = [];
let i = -1;
while (out.length < max && (i = src.indexOf(needle, i + 1)) !== -1) out.push(`@${i}: ` + src.slice(Math.max(0, i - before), i + after));
return out.join("\n-----\n");
