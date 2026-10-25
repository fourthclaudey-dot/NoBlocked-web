// Removes hidden users from reaction counters.
// Discord only sends counts, so for every visible message with reactions we ask the API who
// reacted. Reactor lists are sorted by user ID, so "did user X react?" is one request:
// GET .../reactions/{emoji}?after=X-1&limit=1. Per emoji we pick the cheaper of that (one per
// hidden user) or paging the full list (ceil(count/100)).
// Found reactions are subtracted locally with a synthetic MESSAGE_REACTION_REMOVE, and re-applied
// to payloads whenever Discord reloads the message. The "who reacted" list is filtered too.
import { log } from "./log";
import { ChannelStore, Flux, HTTP, MessageReactionsStore } from "./discord";
import { hiddenIds, kindOf, onHiddenChange } from "./hidden";
import { after } from "./patcher";
import { onVisibleMessages } from "./stream";
import { hidesReactions } from "./settings";

type ReactionType = 0 | 1; // normal, burst ("super")

/** `${messageId}|${emojiKey}|${type}` -> hidden user id -> reacted? */
const known = new Map<string, Map<string, boolean>>();
const checkedAt = new Map<string, number>();
/** Hidden reactions already subtracted from the message record currently in the store. */
const applied = new Map<string, Set<string>>();
const RECHECK_MS = 10 * 60 * 1000;
const queue: { channelId: string; key: string; run: () => Promise<void> }[] = [];
const queued = new Set<string>();
let running = false;

const emojiKey = (e: any) => (e.id ? `${e.name}:${e.id}` : e.name);
const keyOf = (messageId: string, e: any, t: ReactionType) => `${messageId}|${emojiKey(e)}|${t}`;

/** Hidden user whose reactions the settings say to drop. */
function reactionHidden(userId: string): boolean {
    const kind = kindOf(userId);
    return !!kind && hidesReactions(kind);
}

function decSnowflake(id: string) {
    return (BigInt(id) - BigInt(1)).toString();
}

/** Hidden users that could have reacted in this channel (DMs: only participants). */
function candidates(channelId: string): string[] {
    const ids = hiddenIds().filter(reactionHidden);
    const ch = ChannelStore().getChannel(channelId);
    if (ch && !ch.guild_id && Array.isArray(ch.recipients)) return ids.filter(id => ch.recipients.includes(id));
    return ids;
}

function hiddenReactors(key: string): string[] {
    const m = known.get(key);
    if (!m) return [];
    return [...m].filter(([id, reacted]) => reacted && reactionHidden(id)).map(([id]) => id);
}

async function request(url: string, query: Record<string, any>): Promise<any[]> {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return (await HTTP().get({ url, query })).body ?? [];
        } catch (e: any) {
            if (e?.status !== 429) throw e;
            await new Promise(r => setTimeout(r, Math.max(500, (e.body?.retry_after ?? 1) * 1000)));
        }
    }
    return [];
}

async function probe(channelId: string, messageId: string, reaction: any, t: ReactionType, users: string[]) {
    const key = keyOf(messageId, reaction.emoji, t);
    const count = t === 1 ? reaction.burst_count ?? reaction.count_details?.burst ?? 0 : reaction.count_details?.normal ?? reaction.count ?? 0;
    const url = `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emojiKey(reaction.emoji))}`;
    const result = known.get(key) ?? new Map<string, boolean>();
    const pages = Math.ceil(count / 100);

    if (pages <= users.length) {
        let after: string | undefined;
        const all = new Set<string>();
        for (let p = 0; p < pages; p++) {
            const list = await request(url, { limit: 100, type: t, ...(after ? { after } : {}) });
            list.forEach(u => all.add(u.id));
            if (list.length < 100) break;
            after = list[list.length - 1].id;
        }
        for (const id of users) result.set(id, all.has(id));
    } else {
        for (const id of users) {
            const list = await request(url, { limit: 1, type: t, after: decSnowflake(id) });
            result.set(id, list[0]?.id === id);
        }
    }
    known.set(key, result);
    checkedAt.set(key, Date.now());

    const done = applied.get(key) ?? new Set<string>();
    applied.set(key, done);
    for (const id of users) {
        if (!result.get(id) || done.has(id)) continue;
        done.add(id);
        Flux().dispatch({
            type: "MESSAGE_REACTION_REMOVE", channelId, messageId, userId: id,
            emoji: reaction.emoji, burst: t === 1, reactionType: t, __nb: true,
        });
    }
}

function pump() {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    running = true;
    job.run().catch(e => log.warn("reaction probe failed", e?.status ?? e))
        .finally(() => setTimeout(() => { running = false; pump(); }, 250));
}

function schedule(channelId: string, messages: any[]) {
    // Only the open chat matters: drop work queued for chats that are no longer on screen.
    for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].channelId === channelId) continue;
        queued.delete(queue[i].key);
        queue.splice(i, 1);
    }
    const users = candidates(channelId);
    if (!users.length) return;
    // newest messages first: they are the ones on screen when a chat opens
    for (const msg of messages) {
        for (const r of msg.reactions ?? []) {
            for (const t of [0, 1] as ReactionType[]) {
                const n = t === 1 ? r.burst_count ?? r.count_details?.burst : r.count_details?.normal ?? r.count;
                if (!n) continue;
                const key = keyOf(msg.id, r.emoji, t);
                const done = known.get(key);
                const fresh = Date.now() - (checkedAt.get(key) ?? 0) < RECHECK_MS;
                const missing = users.filter(id => !done?.has(id));
                if ((fresh && !missing.length) || queued.has(key)) continue;
                queued.add(key);
                queue.push({ channelId, key, run: () => probe(channelId, msg.id, r, t, fresh ? missing : users).finally(() => queued.delete(key)) });
            }
        }
    }
    pump();
}

/** Subtract already-known hidden reactions from raw message payloads before stores see them. */
function adjustPayload(message: any) {
    if (!message?.reactions?.length) return;
    message.reactions = message.reactions.filter((r: any) => {
        for (const t of [0, 1] as ReactionType[]) {
            const key = keyOf(message.id, r.emoji, t);
            const ids = hiddenReactors(key);
            applied.set(key, new Set(ids)); // fresh server payload: exactly these get subtracted below
            const n = ids.length;
            if (!n) continue;
            if (t === 0) {
                r.count = Math.max(0, (r.count ?? 0) - n);
                if (r.count_details) r.count_details.normal = Math.max(0, (r.count_details.normal ?? 0) - n);
            } else {
                r.burst_count = Math.max(0, (r.burst_count ?? 0) - n);
                r.count = Math.max(0, (r.count ?? 0) - n);
                if (r.count_details) r.count_details.burst = Math.max(0, (r.count_details.burst ?? 0) - n);
            }
        }
        return (r.count ?? 0) > 0 || (r.burst_count ?? 0) > 0;
    });
}

/** Interceptor: live reaction events and payload rewriting. Returns true to swallow. */
export function interceptReactions(action: any): boolean {
    if (action.__nb) return false;
    switch (action.type) {
        case "MESSAGE_REACTION_ADD":
        case "MESSAGE_REACTION_REMOVE": {
            if (!reactionHidden(action.userId)) return false;
            const t: ReactionType = action.reactionType === 1 || action.burst ? 1 : 0;
            const key = keyOf(action.messageId, action.emoji, t);
            const m = known.get(key) ?? new Map<string, boolean>();
            m.set(action.userId, action.type === "MESSAGE_REACTION_ADD");
            known.set(key, m);
            applied.get(key)?.delete(action.userId);
            return true; // counts already exclude hidden users
        }
        case "LOAD_MESSAGES_SUCCESS":
        case "LOCAL_MESSAGES_LOADED":
        case "LOAD_MESSAGES_AROUND_SUCCESS":
            action.messages?.forEach?.(adjustPayload);
            return false;
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            adjustPayload(action.message);
            return false;
    }
    return false;
}

// ---- "who reacted" sheet ---------------------------------------------------------------------
// MessageReactionsStore.getReactions returns Map<userId, User>. The filtered copy is cached per
// source Map so components see a stable object until the store or the hidden list changes.

let filteredCache = new WeakMap<Map<string, any>, { size: number; sig: string; out: Map<string, any> }>();

/** Changes whenever the settings that decide whose reactions are hidden change. */
const settingsSig = () => `${hidesReactions("blocked")}${hidesReactions("ignored")}`;

function filterReactors(users: unknown) {
    if (!(users instanceof Map)) return users;
    const sig = settingsSig();
    const hit = filteredCache.get(users);
    if (hit && hit.size === users.size && hit.sig === sig) return hit.out; // the store may also grow the Map in place
    let out = users as Map<string, any>;
    for (const id of users.keys()) {
        if (!reactionHidden(id)) continue;
        if (out === users) out = new Map(users);
        out.delete(id);
    }
    filteredCache.set(users, { size: users.size, sig, out });
    return out;
}

function patchReactorList() {
    const store = MessageReactionsStore();
    if (!store?.getReactions) {
        log.warn("MessageReactionsStore.getReactions not found, reactor list unfiltered");
        return () => {};
    }
    return after(store, "getReactions", (_args, users) => filterReactors(users));
}

export function startReactions() {
    onVisibleMessages(schedule);
    const unpatchList = patchReactorList();
    const off = onHiddenChange(() => { known.clear(); checkedAt.clear(); applied.clear(); filteredCache = new WeakMap(); });
    return () => {
        onVisibleMessages(null);
        unpatchList();
        off();
        queue.length = 0;
        queued.clear();
    };
}

