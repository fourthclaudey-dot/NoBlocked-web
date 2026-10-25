// Occurrence offsets + short context of a needle in a module: globalThis.__g = [id, needle, radius]
const [id, needle, r = 120] = globalThis.__g;
const src = nb.wp.moduleSource(id) ?? "";
const out = [];
let i = -1;
while (out.length < 40 && (i = src.indexOf(needle, i + 1)) !== -1) out.push(`@${i}: ` + src.slice(Math.max(0, i - r), i + r));
return out;
