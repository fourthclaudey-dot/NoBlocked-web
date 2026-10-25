// Every locale has every key, and plural rules pick the right forms (same checks as the mobile plugin).
import assert from "assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const { t, setLocaleSource, SUPPORTED_LANGUAGES } = await load("i18n.ts");
let current = "en-US";
setLocaleSource(() => current);

test("every locale is complete", () => {
    const keys = Object.keys(t());
    for (const lang of SUPPORTED_LANGUAGES) {
        current = lang;
        const s = t();
        for (const k of keys) assert.ok(s[k] !== undefined && s[k] !== "", `${lang}.${k} missing`);
        for (const k of Object.keys(s.modes)) assert.ok(s.modes[k], `${lang}.modes.${k}`);
        for (const n of [0, 1, 2, 5, 11, 21, 22, 25, 112]) for (const k of ["blockedBar", "ignoredBar", "repliesBar", "mergedTotal", "mergedReplies"]) {
            const out = s[k](n);
            assert.ok(out.includes(String(n)) && !out.includes("#"), `${lang}.${k}(${n}) = ${out}`);
        }
    }
    assert.equal(SUPPORTED_LANGUAGES.length, 11);
});

test("plural forms", () => {
    const check = (lang, k, n, expected) => { current = lang; assert.equal(t()[k](n), expected); };
    check("ru-RU", "mergedTotal", 1, "1 скрытое сообщение");
    check("ru", "mergedTotal", 3, "3 скрытых сообщения");
    check("ru", "mergedTotal", 11, "11 скрытых сообщений");
    check("ru", "mergedTotal", 21, "21 скрытое сообщение");
    check("pl", "mergedTotal", 1, "1 ukryta wiadomość");
    check("pl", "mergedTotal", 22, "22 ukryte wiadomości");
    check("pl", "mergedTotal", 21, "21 ukrytych wiadomości");
    check("pl", "mergedTotal", 12, "12 ukrytych wiadomości");
    check("fr", "blockedBar", 0, "0 message bloqué");
    check("de", "ignoredBar", 2, "2 ignorierte Nachrichten");
    check("zh-CN", "blockedBar", 3, "3 条已屏蔽的消息");
    check("es-ES", "repliesBar", 1, "1 respuesta a usuarios ocultos");
    check("sv-SE", "mergedTotal", 2, "2 dolda meddelanden");
    check("nl", "mergedTotal", 1, "1 verborgen bericht");
    check("it", "mergedTotal", 4, "4 messaggi nascosti");
});

test("language fallbacks", () => {
    current = "zh-TW"; assert.equal(t().collapse, "收起");
    current = "pt-BR"; assert.equal(t().settings, "Definições");
    current = "ja"; assert.equal(t().settings, "Settings");
    current = ""; assert.equal(t().close, "Close");
});
