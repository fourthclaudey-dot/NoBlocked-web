// Chat stream processing: folding, modes, merging, unread and date dividers, author groups.
import assert from "assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const { processStream, dropEmptyDays, mergedText } = await load("stream-core.ts");
const { t, setLocaleSource } = await load("i18n.ts");

// Authors: b* blocked, i* ignored, anything else visible. "r:<author>" replies to that author.
let n = 0;
function msg(author, opts = {}) {
    const id = String(++n);
    return { type: "MESSAGE", content: { id, author: { username: author }, replyTo: opts.replyTo }, groupId: opts.groupId ?? id };
}
const day = d => ({ type: "DIVIDER", content: d, contentKey: d });
const unread = id => ({ type: "DIVIDER", unreadId: id });

function deps(over = {}) {
    const modes = { blocked: "reveal", ignored: "reveal", replies: "reveal", ...over.modes };
    return {
        category: m => {
            const a = m.author.username;
            if (a.startsWith("b")) return "blocked";
            if (a.startsWith("i")) return "ignored";
            if (m.replyTo && /^[bi]/.test(m.replyTo) && modes.replies !== "off") return "replies";
            return null;
        },
        mode: cat => modes[cat],
        merge: over.merge ?? true,
        expanded: new Set(over.expanded ?? []),
        barLabel: (cat, count) => (cat === "replies" ? `${count} replies` : undefined),
        mergedLabel: stats => `merged ${stats.blocked}/${stats.ignored}/${stats.replies}`,
    };
}

const show = items => items.map(it => {
    if (it.type === "MESSAGE") return `${it.content.author.username}${it.groupId === it.content.id ? "*" : ""}`;
    if (it.type === "DIVIDER") return it.unreadId ? "NEW" : `[${it.content}]`;
    if (it.__nb?.cat === "merged") return `M(${it.__nb.label})`;
    return `${it.__nb ? it.__nb.cat : it.type}:${it.content.length}${it.__nb && !it.__nb.open ? "!" : ""}`;
});

test("hidden messages fold into one bar per run and category", () => {
    const out = processStream([day("1"), msg("a"), msg("b1"), msg("b2"), msg("a"), msg("i1")], deps({ merge: false }));
    assert.deepEqual(show(out), ["[1]", "a*", "blocked:2", "a*", "ignored:1"]);
});

test("Discord's own groups are reclassified by us", () => {
    const native = { type: "MESSAGE_GROUP_BLOCKED", key: "x", content: [msg("b1"), msg("b2")] };
    const out = processStream([msg("a"), native, msg("c")], deps({ modes: { blocked: "remove" } }));
    assert.deepEqual(show(out), ["a*", "c*"]);
});

test("modes: bar cannot open, remove leaves nothing", () => {
    const out = processStream([msg("a"), msg("b1"), msg("c"), msg("i1"), msg("d")], deps({ modes: { blocked: "bar", ignored: "remove" } }));
    assert.deepEqual(show(out), ["a*", "blocked:1!", "c*", "d*"]);
});

test("replies to hidden users are their own category; off shows them", () => {
    const items = () => [msg("a"), msg("c", { replyTo: "b1" }), msg("d")];
    assert.deepEqual(show(processStream(items(), deps())), ["a*", "replies:1", "d*"]);
    assert.deepEqual(show(processStream(items(), deps({ modes: { replies: "off" } }))), ["a*", "c*", "d*"]);
});

test("adjacent bars merge; an opened run shows its original bars after the header", () => {
    const list = [msg("a"), msg("b1"), msg("i1"), msg("c", { replyTo: "i1" }), msg("b2"), msg("d")];
    const items = () => list; // same message ids every pass, like re-renders of one chat
    const closed = processStream(items(), deps());
    assert.deepEqual(show(closed), ["a*", "M(merged 2/1/1)", "d*"]);
    const key = closed[1].__nb.toggle;
    const open = processStream(items(), deps({ expanded: [key] }));
    assert.deepEqual(show(open), ["a*", "M(merged 2/1/1)", "blocked:1", "ignored:1", "replies:1", "blocked:1", "d*"]);
    assert.equal(open[1].content.length, 0, "a merged bar holds no messages of its own");
    assert.deepEqual(show(processStream(items(), deps({ merge: false }))), ["a*", "blocked:1", "ignored:1", "replies:1", "blocked:1", "d*"]);
});

test("NEW MESSAGES goes when nothing visible follows it", () => {
    assert.deepEqual(show(processStream([msg("a"), unread("x"), msg("b1"), msg("i1")], deps())), ["a*", "M(merged 1/1/0)"]);
    assert.deepEqual(show(processStream([msg("a"), unread("x"), msg("b1"), msg("c")], deps())), ["a*", "NEW", "blocked:1", "c*"]);
    // with the divider gone, the bars around it become adjacent and merge
    assert.deepEqual(show(processStream([msg("b1"), unread("x"), msg("i1")], deps())), ["M(merged 1/1/0)"]);
});

test("a visible message after a bar starts a new author group", () => {
    const a1 = msg("a");
    const a2 = msg("a", { replyTo: "b9", groupId: a1.content.id });
    const a3 = msg("a", { groupId: a1.content.id });
    const out = processStream([a1, a2, a3], deps());
    assert.deepEqual(show(out), ["a*", "replies:1", "a*"]);
    // untouched when nothing in between was hidden
    const c1 = msg("c"), c2 = msg("c", { groupId: c1.content.id });
    assert.deepEqual(show(processStream([c1, c2], deps())), ["c*", "c"]);
});

test("date dividers of days that lost everything go", () => {
    const items = [day("1"), msg("b1"), day("2"), msg("a"), day("3"), msg("i1"), unread("u"), day("4")];
    assert.deepEqual(show(processStream(items, deps({ modes: { blocked: "remove", ignored: "remove" } }))), ["[2]", "a*"]);
    // a bar counts as content
    assert.deepEqual(show(processStream([day("1"), msg("b1"), day("2"), msg("a")], deps())), ["[1]", "blocked:1", "[2]", "a*"]);
    assert.deepEqual(show(dropEmptyDays([day("1"), unread("u"), day("2")])), ["NEW"]);
});

test("merged bar text", () => {
    setLocaleSource(() => "ru");
    assert.equal(mergedText({ blocked: 3, ignored: 0, replies: 2 }, t()), "5 скрытых сообщений · 3 заблок. · 2 ответа");
    setLocaleSource(() => "en");
    assert.equal(mergedText({ blocked: 1, ignored: 1, replies: 0 }, t()), "2 hidden messages · 1 blocked · 1 ignored");
});
