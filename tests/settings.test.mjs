// Settings defaults, migrations and how modes resolve (same rules as the mobile plugin).
import assert from "assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const { applyDefaults, modeOf, countsAsNew, hidesReactions, defaults } = await load("settings.ts", { GM_getValue: undefined, GM_setValue: undefined });

test("fresh install gets the defaults", () => {
    assert.deepEqual(applyDefaults({}), defaults);
});

test("1.x shared reactions switch is carried over to both kinds", () => {
    const s = applyDefaults({ reactions: false, blocked: { mode: "bar", unread: true } });
    assert.equal(s.reactions, undefined);
    assert.equal(s.blocked.reactions, false);
    assert.equal(s.ignored.reactions, true, "ignored had no settings yet: default");
    assert.equal(s.blocked.mode, "bar");
});

test("broken values are replaced, missing nested keys filled", () => {
    const s = applyDefaults({ merge: "yes", replies: { mode: "remove" } });
    assert.equal(s.merge, true);
    assert.deepEqual(s.replies, { mode: "remove", unread: true });
});

test("modes, total exclusion, unread and reactions", () => {
    const s = applyDefaults({ mode: "bar", ignored: { mode: "remove" } });
    assert.equal(modeOf("blocked", s), "bar");
    assert.equal(modeOf("ignored", s), "remove");
    assert.equal(modeOf("replies", s), "off");
    assert.equal(countsAsNew("replies", s), true);
    assert.equal(countsAsNew("blocked", s), false);
    s.total = true;
    for (const c of ["blocked", "ignored", "replies"]) {
        assert.equal(modeOf(c, s), "remove");
        assert.equal(countsAsNew(c, s), false);
    }
    s.blocked.reactions = false;
    assert.equal(hidesReactions("blocked", s), true);
});
