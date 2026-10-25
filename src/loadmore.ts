// The chat list asks for older messages once, when its top is reached. If that page consists
// only of hidden messages no new rows appear, the list never asks again and history gets stuck.
// We keep fetching on our own until a page brings something visible (or history ends).
import { log } from "./log";
import { Flux, MessageActions, MessageStore } from "./discord";
import { displayCategory } from "./classify";
import { modeOf, storage } from "./settings";

/** Visible messages we want to have gained before giving the list back to the user. */
const MIN_VISIBLE = 10;
const MAX_CHAIN = 15;
const chains = new Map<string, { visible: number; fetches: number }>();

/** True when a message adds no row of its own (removed, or folded into a merged bar). */
function addsNoRow(message: any) {
    const cat = displayCategory(message);
    if (!cat) return false;
    return modeOf(cat) === "remove" || storage.merge;
}

function onLoadSuccess(action: any) {
    const { channelId, messages, hasMoreBefore, isAfter, jump } = action;
    if (!channelId || !Array.isArray(messages) || isAfter || jump?.messageId) return;

    const visible = messages.filter(m => !addsNoRow(m)).length;
    const chain = chains.get(channelId) ?? { visible: 0, fetches: 0 };
    chain.visible += visible;

    if (!hasMoreBefore || chain.visible >= MIN_VISIBLE || chain.fetches >= MAX_CHAIN || messages.length === 0) {
        chains.delete(channelId);
        return;
    }

    // Payload is newest-first; continue right before its oldest message.
    const oldest = messages.reduce((a: any, m: any) => (snowflakeLess(m.id, a.id) ? m : a), messages[0]);
    chain.fetches++;
    chains.set(channelId, chain);
    setTimeout(() => {
        const cm = MessageStore().getMessages(channelId);
        if (cm?.loadingMore) return;
        log.info(`page had ${visible} visible, fetching more before ${oldest.id} (#${chain.fetches})`);
        MessageActions().fetchMessages({ channelId, before: oldest.id, limit: 100 });
    }, 50);
}

/** Snowflake comparison without relying on BigInt support. */
function snowflakeLess(a: string, b: string) {
    return a.length !== b.length ? a.length < b.length : a < b;
}

export function startLoadMore() {
    const F = Flux();
    F.subscribe("LOAD_MESSAGES_SUCCESS", onLoadSuccess);
    return () => {
        F.unsubscribe("LOAD_MESSAGES_SUCCESS", onLoadSuccess);
        chains.clear();
    };
}
