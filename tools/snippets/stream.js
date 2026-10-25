// Dump the last processed chat stream: one line per item (in = Discord's, out = after NoBlocked).
const short = it => {
  if (!it) return "?";
  if (it.type === "MESSAGE" || it.type === "THREAD_STARTER_MESSAGE") return `MSG ${it.content.author.username}${it.groupId === it.content.id ? "*" : ""}: ${(it.content.content || "").slice(0, 25).replace(/\n/g, " ")}`;
  if (it.type === "DIVIDER") return it.unreadId ? "--- NEW ---" : `--- ${it.content} ---`;
  if (/GROUP/.test(it.type)) return `BAR ${it.type.replace("MESSAGE_GROUP_", "")} n=${it.content.length}${it.__nb ? ` nb=${JSON.stringify(it.__nb)}` : ""}`;
  return it.type;
};
const s = nb.lastStream;
if (!s) return "no stream yet";
const which = globalThis.__which || "out";
return s[which].slice(-(globalThis.__n || 40)).map(short);
