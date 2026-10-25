// The message count next to a thread's title is the server's total and includes blocked and
// ignored users. When that total fits into one request (< 100), we fetch the thread's messages
// once, count the hidden ones and subtract them; afterwards new/deleted messages keep it current.
// Larger threads keep Discord's number: counting them would take several requests each.
import { HTTP, MessageStore } from "./discord";
import { kindOf, onHiddenChange } from "./hidden";
import { log } from "./log";
import { after } from "./patcher";
import { findStore } from "./webpack";

const PAGE = 100;
const RECOUNT_AFTER_MS = 10 * 60 * 1000;
/** Message types that count as thread messages (default, reply); system messages are skipped. */
const COUNTED_TYPES = new Set([0, 19]);

/** threadId -> number of hidden messages in it, and when that was counted. */
const hidden = new Map<string, { n: number; at: number }>();
const queued = new Set<string>();
const queue: string[] = [];
let running = false;

const ThreadMessageStore = () => findStore("ThreadMessageStore");

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

const isHiddenMessage = (m: any) => COUNTED_TYPES.has(m?.type ?? 0) && !!kindOf(m?.author?.id);

async function count(threadId: string) {
    const msgs = await request(`/channels/${threadId}/messages`, { limit: PAGE });
    hidden.set(threadId, { n: msgs.filter(isHiddenMessage).length, at: Date.now() });
    ThreadMessageStore()?.emitChange?.();
}

function pump() {
    if (running) return;
    const id = queue.shift();
    if (!id) return;
    running = true;
    count(id)
        .catch(e => log.warn("thread count failed", e?.status ?? e))
        .finally(() => {
            queued.delete(id);
            setTimeout(() => { running = false; pump(); }, 300);
        });
}

function schedule(threadId: string) {
    if (queued.has(threadId)) return;
    queued.add(threadId);
    queue.push(threadId);
    pump();
}

/** Discord's count for a thread, minus hidden messages when we could count them. */
function adjust(threadId: string, total: unknown) {
    if (typeof total !== "number" || !threadId) return total;
    if (total >= PAGE) return total;
    const known = hidden.get(threadId);
    if (!known || Date.now() - known.at > RECOUNT_AFTER_MS) schedule(threadId);
    return known ? Math.max(0, total - known.n) : total;
}

/**
 * Interceptor (runs before stores, so a deleted message is still there): keeps known counts
 * current between recounts. Never swallows.
 */
export function interceptThreadCount(action: any): boolean {
    if (action.type === "MESSAGE_CREATE" || action.type === "MESSAGE_DELETE") onMessage(action);
    return false;
}

function onMessage(action: any) {
    const channelId: string | undefined = action.channelId ?? action.message?.channel_id;
    const known = channelId && hidden.get(channelId);
    if (!known) return;
    if (action.type === "MESSAGE_CREATE" && !action.optimistic && isHiddenMessage(action.message)) known.n++;
    if (action.type === "MESSAGE_DELETE") {
        const m = MessageStore().getMessage(channelId, action.id);
        if (m && isHiddenMessage(m)) known.n = Math.max(0, known.n - 1);
    }
}

export function startThreadCount() {
    const store = ThreadMessageStore();
    if (typeof store?.getCount !== "function") {
        log.warn("ThreadMessageStore.getCount not found, thread message counts unchanged");
        return () => {};
    }
    const unpatch = after(store, "getCount", ([threadId]: any[], total: unknown) => adjust(threadId, total));
    const off = onHiddenChange(() => { hidden.clear(); store.emitChange?.(); });
    return () => {
        unpatch();
        off();
        queue.length = 0;
        queued.clear();
    };
}
