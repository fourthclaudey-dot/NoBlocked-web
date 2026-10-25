// Hooks the chat list. Discord builds the "channel stream" (messages, dividers, blocked/ignored
// groups) inside its chat module without exporting it, so the module source is patched:
//   stream — the finished stream goes through processStream (stream-core.ts) on every render;
//   bar    — our bars bring their own text and say whether they open;
//   toggle — clicking a merged bar opens/closes it (our state, not the bar's own).
// The patched code calls into `window.__NoBlocked` (the `NB` object below).
import { displayCategory } from "./classify";
import { devHandle } from "./dev";
import { React } from "./discord";
import { t } from "./i18n";
import { log } from "./log";
import { modeOf, storage } from "./settings";
import { BarInfo, Item, mergedText, processStream } from "./stream-core";
import { addSourcePatch } from "./webpack";

const GLOBAL = "__NoBlocked";
const FIND = ["MESSAGE_GROUP_BLOCKED", "channelStream:"];

let version = 0;
const subscribers = new Set<() => void>();
const expanded = new Set<string>();
const cache = new WeakMap<object, { version: number; out: Item[] }>();
let visibleListener: ((channelId: string, messages: any[]) => void) | null = null;

/** Receives the message records that ended up visible after each pass (used by reactions). */
export function onVisibleMessages(fn: typeof visibleListener) {
    visibleListener = fn;
}

/** Make open chats rebuild their stream (settings or hidden users changed). */
export function rerender() {
    version++;
    for (const fn of subscribers) {
        try { fn(); } catch {}
    }
}

function barLabel(cat: "blocked" | "ignored" | "replies", n: number) {
    // Blocked/ignored bars keep Discord's own text; only replies need ours.
    return cat === "replies" ? t().repliesBar(n) : undefined;
}

function process(stream: Item[], messages: any): Item[] {
    const hit = cache.get(stream);
    if (hit && hit.version === version) return hit.out;
    let out = stream;
    try {
        out = processStream(stream, {
            category: displayCategory,
            mode: modeOf,
            merge: storage.merge,
            expanded,
            barLabel,
            // the bar's own Show/Hide link says whether it is open
            mergedLabel: stats => mergedText(stats, t()),
        });
    } catch (e) {
        log.error("stream processing failed", e);
    }
    cache.set(stream, { version, out });
    if (__DEV__) devHandle.lastStream = { input: stream, out };
    const channelId = messages?.channelId;
    if (visibleListener && channelId) {
        const visible: any[] = [];
        for (const item of out) if (item.type === "MESSAGE" && item.content) visible.push(item.content);
        try { visibleListener(channelId, visible.reverse()); } catch (e) { log.error("visible listener", e); }
    }
    return out;
}

/** Bar texts are `intl.format(reason, {count})` in Discord; ours travel as a marked object. */
interface Reason { __nb: true; base: unknown; text: string }
const reasons = new WeakMap<object, Reason>();

const NB = {
    stream(stream: unknown, messages: unknown, _version?: number) {
        return Array.isArray(stream) ? process(stream, messages) : stream;
    },
    /** React hook: re-render the chat whenever `rerender()` runs. */
    useVersion() {
        const R = React();
        if (!R?.useSyncExternalStore) return version;
        return R.useSyncExternalStore((fn: () => void) => {
            subscribers.add(fn);
            return () => void subscribers.delete(fn);
        }, () => version);
    },
    reason(group: any, base: unknown) {
        const nb: BarInfo | undefined = group?.__nb;
        if (!nb?.label) return base;
        let r = reasons.get(group);
        if (!r) reasons.set(group, (r = { __nb: true, base, text: nb.label }));
        return r;
    },
    canOpen(group: any, fallback: boolean) {
        const nb: BarInfo | undefined = group?.__nb;
        return nb ? nb.open : fallback;
    },
    /** Icon choice compares the reason with Discord's own messages: hand it the original. */
    icon(reason: any) {
        return reason?.__nb ? reason.base : reason;
    },
    text(reason: any): string | undefined {
        return reason?.__nb ? reason.text : undefined;
    },
    /** Whether a merged bar is open; undefined for every other bar. */
    isOpen(group: any): boolean | undefined {
        const key = (group?.__nb as BarInfo | undefined)?.toggle;
        return key ? expanded.has(key) : undefined;
    },
    /** Click on a bar: merged bars open/close their run. */
    toggle(group: any) {
        const key = (group?.__nb as BarInfo | undefined)?.toggle;
        if (!key) return;
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        rerender();
    },
};

export function installStreamPatches() {
    Object.defineProperty(window, GLOBAL, { value: NB, configurable: true });
    const g = `window.${GLOBAL}`;
    addSourcePatch({
        name: "stream",
        find: FIND,
        replacements: [{
            match: /return\{messages:([\w$]+),channelStream:([\w$]+),/,
            replace: `return{messages:$1,channelStream:${g}.stream($2,$1,${g}.useVersion()),`,
        }],
    });
    addSourcePatch({
        name: "bar",
        find: FIND,
        replacements: [
            {
                match: /collapsedReason:([\w$]+),canUncollapse:([\w$]+)\},([\w$]+)\.key\)/,
                replace: `collapsedReason:${g}.reason($3,$1),canUncollapse:${g}.canOpen($3,$2)},$3.key)`,
            },
            {
                match: /\(\{collapsedReason:([\w$]+)\}\)\.with\(/,
                replace: `({collapsedReason:${g}.icon($1)}).with(`,
            },
            {
                // every such call: text() passes anything that isn't ours through
                match: /([\w$]+)\.intl\.format\(([\w$]+),\{count:([\w$]+)\}\)/g,
                replace: `(${g}.text($2)??$1.intl.format($2,{count:$3}))`,
            },
        ],
    });
    // The bar component keeps its own open state; for merged bars it starts from ours (it remounts
    // while scrolling) and every click also flips ours. A merged bar has no messages of its own,
    // so "open" shows nothing inside it — its original bars come right after it in the stream.
    addSourcePatch({
        name: "toggle",
        find: FIND,
        replacements: [{
            match: /(\{messages:([\w$]+),channel:[\s\S]{0,300}?)\[([\w$]+),([\w$]+)\]=([\w$]+)\.useState\(([\w$]+)&&([\w$]+)\),([\w$]+)=\5\.useCallback\(\(\)=>\{\7&&\4\(e=>!e\)\},\[\7\]\)/,
            replace: `$1[$3,$4]=$5.useState(${g}.isOpen($2)??($6&&$7)),$8=$5.useCallback(()=>{${g}.toggle($2);$7&&$4(e=>!e)},[$7,$2])`,
        }],
    });
}
