// Keeps hidden messages from making chats look new (same design as the mobile plugin).
// 1. Live: the stores that compute unread dots, mention badges, DM order, previews, the inbox and
//    desktop notifications + their sound simply never see a silenced MESSAGE_CREATE (the message
//    itself still reaches MessageStore, so bars keep working).
// 2. Server: if the chat was fully read, we ack the silenced message so other devices and the
//    next start agree.
// 3. Startup: Discord's own unread state comes from the server; channels that only got hidden
//    messages while we were away are checked (one request each) and acked.
// 4. Passive guild updates carry no author: held back until one request shows who wrote.
import { log } from "./log";
import { silentForUnread } from "./classify";
import { ChannelStore, Flux, HTTP, invalidateFluxCaches, ReadStateStore, SelectedChannelStore, storeNodes, UserGuildSettingsStore } from "./discord";
import { onHiddenChange } from "./hidden";
import { before } from "./patcher";
import { storage } from "./settings";

const SILENCED_STORES = new Set([
    "ReadStateStore",
    "GuildReadStateStore",
    "ChannelListStore",
    "ChannelListUnreadsStore",
    "PrivateChannelReadStateStore",
    "PrivateChannelSortStore",
    "NotificationStore", // desktop notifications and the message sound
    "NotificationsInboxStore",
    "RecentMentionsStore",
    "MessagePreviewStore",
    "ForumPostUnreadCountStore",
    "ForumPostRecentMessageStore",
    "ActiveJoinedThreadsStore",
    "UnreadSettingNoticeStore2",
    "MessageRequestPreviewStore",
    "ActiveChannelsStore",
    "FriendsWidgetMessagesStore",
]);

/** Stores whose display name is minified away, recognised by the actions they handle. */
function isSilenced(name: string, handlers: Record<string, unknown>) {
    return SILENCED_STORES.has(name) || "MESSAGE_PREVIEWS_LOADED" in handlers; // MessagePreviewStore
}

function shouldSilence(action: any) {
    return !!action?.message && !action.optimistic && silentForUnread(action.message);
}

const WRAPPED = Symbol("nbSilenced");

function silence(orig: Function) {
    if ((orig as any)[WRAPPED]) return orig;
    const fn = function (this: any, action: any) {
        if (shouldSilence(action)) return false; // false: no change, no re-render
        return orig.apply(this, arguments as any);
    };
    (fn as any)[WRAPPED] = orig;
    return fn;
}

function wrapStoreHandlers() {
    const restore: (() => void)[] = [];
    let count = 0;
    for (const node of storeNodes()) {
        const handlers = node?.actionHandler;
        if (!handlers || typeof handlers.MESSAGE_CREATE !== "function" || !isSilenced(node.name, handlers)) continue;
        const orig = handlers.MESSAGE_CREATE;
        handlers.MESSAGE_CREATE = silence(orig);
        restore.push(() => void (handlers.MESSAGE_CREATE = orig));
        count++;
    }
    // Stores created later (lazily loaded chunks) are wrapped as they register.
    const unpatchRegister = before(Flux(), "register", args => {
        const [name, handlers] = args;
        if (handlers && typeof handlers.MESSAGE_CREATE === "function" && isSilenced(name, handlers)) {
            args[1] = { ...handlers, MESSAGE_CREATE: silence(handlers.MESSAGE_CREATE) };
        }
        return args;
    });
    if (!count) log.error("no unread-related stores found, unread silencing disabled");
    invalidateFluxCaches();
    return () => {
        unpatchRegister();
        restore.forEach(f => f());
        invalidateFluxCaches();
    };
}

// ---- server acks ----------------------------------------------------------------------------

const pendingAcks = new Map<string, string>();
let ackTimer: ReturnType<typeof setTimeout> | null = null;

function snowflakeMax(a: string | undefined, b: string) {
    if (!a) return b;
    return a.length !== b.length ? (a.length > b.length ? a : b) : a > b ? a : b;
}

function queueAck(channelId: string, messageId: string) {
    if (!storage.serverAck) return;
    pendingAcks.set(channelId, snowflakeMax(pendingAcks.get(channelId), messageId));
    ackTimer ??= setTimeout(flushAcks, 2500);
}

async function flushAcks() {
    ackTimer = null;
    const readStates = [...pendingAcks].map(([channel_id, message_id]) => ({ channel_id, message_id, read_state_type: 0 }));
    pendingAcks.clear();
    if (!readStates.length) return;
    // Discord's own BULK_ACK action skips channels that look read, which ours do: post directly.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await HTTP().post({ url: "/read-states/ack-bulk", body: { read_states: readStates }, oldFormErrors: true });
            log.info(`acked hidden activity in ${readStates.length} channel(s)`);
            return;
        } catch (e: any) {
            if (e?.status !== 429) return log.error("bulk ack failed", e?.status ?? e);
            await new Promise(r => setTimeout(r, Math.max(1000, (e.body?.retry_after ?? 2) * 1000)));
        }
    }
}

function onMessageCreate(action: any) {
    if (!shouldSilence(action)) return;
    const { channelId, message } = action;
    // Chat had nothing new before this message: moving the server ack keeps it that way.
    if (!ReadStateStore().hasUnread(channelId)) queueAck(channelId, message.id);
}

// ---- startup reconcile ----------------------------------------------------------------------

const DISCORD_EPOCH = 1420070400000;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

function ackAnchor(state: any): string | null {
    if (state._ackMessageId) return state._ackMessageId;
    if (state._ackMessageTimestamp) return String((BigInt(state._ackMessageTimestamp) - BigInt(DISCORD_EPOCH)) << BigInt(22));
    return null;
}

function isMuted(channelId: string) {
    const ch = ChannelStore().getChannel(channelId);
    if (!ch?.guild_id) return false;
    return !!UserGuildSettingsStore()?.isGuildOrCategoryOrChannelMuted?.(ch.guild_id, channelId);
}

async function get(url: string, query: Record<string, unknown>): Promise<any[]> {
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

async function reconcile() {
    reconcileTimer = null;
    const RS = ReadStateStore();
    const states = (RS.getAllReadStates?.() ?? []).filter((s: any) =>
        s.type === 0 && RS.hasUnread(s.channelId) && (!isMuted(s.channelId) || RS.getMentionCount(s.channelId) > 0));

    let acked = 0;
    for (const s of states.slice(0, 60)) {
        let after = ackAnchor(s);
        if (!after) continue;
        try {
            for (let page = 0; page < 3; page++) {
                const msgs = await get(`/channels/${s.channelId}/messages`, { after, limit: 100 });
                if (!msgs.length || !msgs.every(m => silentForUnread(m))) break;
                const newest = msgs.reduce((a: string | undefined, m: any) => snowflakeMax(a, m.id), undefined as any);
                queueAck(s.channelId, newest);
                acked++;
                if (msgs.length < 100) break;
                after = newest;
            }
        } catch {}
        await new Promise(r => setTimeout(r, 350));
    }
    if (states.length) log.info(`reconcile: checked ${states.length} unread channel(s), ${acked} only had hidden messages`);
}

function scheduleReconcile(delay = 4000) {
    if (!storage.serverAck) return;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => void reconcile().catch(e => log.error("reconcile", e)), delay);
}

const onConnectionOpen = () => scheduleReconcile();

// ---- passive updates ------------------------------------------------------------------------
// For "passive" guilds Discord sends PASSIVE_UPDATE_V2 with only a channel's new last message id,
// no author. ReadStateStore would light the channel up at once. Entries that would turn a read
// channel unread are held back, checked with one request, and released only if something visible
// arrived; hidden-only activity is acked instead.

function snowflakeGreater(a: string, b: string) {
    return a.length !== b.length ? a.length > b.length : a > b;
}

/** Same action with only these channels and every other list emptied, so no other update repeats. */
function passiveWith(action: any, key: string, channels: any[]) {
    const out: any = { __nb: true };
    for (const [k, v] of Object.entries(action)) out[k] = Array.isArray(v) ? [] : v;
    out[key] = channels;
    return out;
}

async function verifyPassive(action: any, key: string, held: any[]) {
    const RS = ReadStateStore();
    const release: any[] = [];
    for (const entry of held) {
        const channelId = entry.id;
        const state = RS.getAllReadStates?.().find((s: any) => s.channelId === channelId);
        const after = (state && ackAnchor(state)) ?? RS.lastMessageId(channelId);
        try {
            const msgs = after ? await get(`/channels/${channelId}/messages`, { after, limit: 50 }) : [];
            if (!msgs.length) continue; // nothing there anymore (deleted): drop
            if (msgs.every(m => silentForUnread(m))) {
                queueAck(channelId, msgs.reduce((a: string | undefined, m: any) => snowflakeMax(a, m.id), undefined as any));
                continue;
            }
            release.push(entry);
        } catch {
            release.push(entry); // fail open: never lose a real unread
        }
        await new Promise(r => setTimeout(r, 250));
    }
    log.info(`passive update: ${held.length} held, ${release.length} released`);
    if (release.length) Flux().dispatch(passiveWith(action, key, release));
}

/** Interceptor: mutates PASSIVE_UPDATE_V2 in place; never swallows the whole action. */
export function interceptPassive(action: any): boolean {
    if (action.type !== "PASSIVE_UPDATE_V2" || action.__nb) return false;
    const key = Array.isArray(action.channels) ? "channels" : Array.isArray(action.updatedChannels) ? "updatedChannels" : null;
    if (!key) return false;
    const RS = ReadStateStore();
    const selected = SelectedChannelStore()?.getChannelId?.();
    const held: any[] = [];
    action[key] = action[key].filter((c: any) => {
        const last: string | undefined = c?.lastMessageId ?? c?.last_message_id;
        if (!c?.id || !last || c.id === selected || RS.hasUnread(c.id)) return true;
        const local = RS.lastMessageId(c.id);
        if (local && !snowflakeGreater(last, local)) return true;
        held.push(c);
        return false;
    });
    if (held.length) void verifyPassive(action, key, held).catch(e => log.error("passive verify", e));
    return false;
}

export function startUnreads() {
    const unwrap = wrapStoreHandlers();
    const F = Flux();
    F.subscribe("MESSAGE_CREATE", onMessageCreate);
    F.subscribe("CONNECTION_OPEN", onConnectionOpen);
    const offHidden = onHiddenChange(() => scheduleReconcile(1500));
    scheduleReconcile(1500);
    return () => {
        unwrap();
        offHidden();
        F.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        F.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
        if (reconcileTimer) clearTimeout(reconcileTimer);
        if (ackTimer) clearTimeout(ackTimer);
        void flushAcks();
    };
}
