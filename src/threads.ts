// Threads (and forum posts) created by hidden users.
// mask — the thread stays, its title is replaced everywhere (channel list, the thread bar under a
//        message, thread browser, the "started a thread" system message) and its creator is
//        replaced with a stand-in user, so the thread header says "Started by Blocked user";
// hide — the thread is dropped from every payload Discord receives and removed locally (a
//        client-side THREAD_DELETE), and messages lose their link to it.
// Payloads are rewritten before stores see them; threads that reached ChannelStore some other way
// (loaded before we ran, a mode change) are handled by a sweep over the store.
import { ChannelStore, Flux, UserStore } from "./discord";
import { kindOf, onHiddenChange } from "./hidden";
import { t } from "./i18n";
import { log } from "./log";
import { after } from "./patcher";
import { Kind, threadModeOf } from "./settings";
import { findStore } from "./webpack";

const THREAD_TYPES = new Set([10, 11, 12]); // announcement, public, private (forum posts are 11)
const MESSAGE_THREAD_CREATED = 18;
const FLAG_HAS_THREAD = 1 << 5;

/** Actions that can carry thread channels or messages that point at threads. */
const ACTIONS = new Set([
    "THREAD_CREATE", "THREAD_UPDATE", "THREAD_LIST_SYNC", "THREAD_CREATE_LOCAL",
    "LOAD_THREADS_SUCCESS", "LOAD_ARCHIVED_THREADS_SUCCESS", "LOAD_FORUM_POSTS",
    "CHANNEL_CREATE", "CHANNEL_UPDATES", "GUILD_CREATE", "GUILD_UPDATE",
    "CONNECTION_OPEN", "CONNECTION_OPEN_SUPPLEMENTAL", "CACHE_LOADED", "CACHE_LOADED_LAZY",
    "MESSAGE_CREATE", "MESSAGE_UPDATE", "LOAD_MESSAGES_SUCCESS", "LOAD_MESSAGES_AROUND_SUCCESS",
    "LOCAL_MESSAGES_LOADED", "SEARCH_MESSAGES_SUCCESS", "LOAD_PINNED_MESSAGES_SUCCESS",
]);
/** Big payload branches that never contain threads; skipped to keep CONNECTION_OPEN cheap. */
const SKIP_KEYS = new Set([
    "members", "merged_members", "presences", "merged_presences", "users", "roles", "emojis",
    "stickers", "voice_states", "read_state", "readState", "user_guild_settings", "relationships",
    "guild_experiments", "experiments", "embeds", "attachments", "reactions", "mentions", "components",
]);
const MAX_DEPTH = 5;

/** Original titles of masked threads, so they can be put back on unblock or a mode change. */
const originalNames = new Map<string, string>();
/**
 * Creators of masked threads. Their owner field points at a stand-in user instead, so the thread
 * header says "Started by Blocked user"; this map keeps the thread recognisable as theirs.
 */
const originalOwners = new Map<string, { key: "owner_id" | "ownerId"; id: string }>();

/** Stand-in users shown as the creator of a masked thread. Ids no real account can have. */
const STAND_IN: Record<Kind, string> = { blocked: "1000000000000000001", ignored: "1000000000000000002" };
const isStandIn = (id: any) => id === STAND_IN.blocked || id === STAND_IN.ignored;

function ownerOf(c: any): string | undefined {
    const raw = c?.owner_id ?? c?.ownerId;
    if (raw && !isStandIn(raw)) return raw;
    return c?.id ? originalOwners.get(c.id)?.id : undefined;
}

/** A user record for a stand-in id, built on the real UserRecord prototype so methods keep working. */
const standInUsers = new Map<string, any>();
function standInUser(id: string) {
    const kind: Kind = id === STAND_IN.blocked ? "blocked" : "ignored";
    const name = kind === "blocked" ? t().userBlocked : t().userIgnored;
    let user = standInUsers.get(id);
    if (!user || user.username !== name) {
        const me = UserStore().getCurrentUser();
        user = Object.assign(Object.create(me ? Object.getPrototypeOf(me) : Object.prototype), me ?? {}, {
            id, username: name, globalName: name, global_name: name, discriminator: "0",
            avatar: null, avatarDecorationData: null, banner: null, bot: false, system: false,
            publicFlags: 0, flags: 0, premiumType: 0, clan: null, primaryGuild: null,
        });
        standInUsers.set(id, user);
    }
    return user;
}
const isThread = (c: any) => !!c && THREAD_TYPES.has(c.type) && typeof c.name === "string" && !!ownerOf(c);

/** Hidden kind of the thread's creator, if the thread is to be treated at all. */
function threadKind(c: any): Kind | null {
    return isThread(c) ? kindOf(ownerOf(c)) : null;
}

function placeholder(kind: Kind) {
    return kind === "blocked" ? t().threadBlocked : t().threadIgnored;
}

function mask(c: any, kind: Kind) {
    const ph = placeholder(kind);
    if (c.name !== ph) {
        originalNames.set(c.id, c.name);
        c.name = ph;
    }
    for (const key of ["owner_id", "ownerId"] as const) {
        if (!c[key] || isStandIn(c[key])) continue;
        originalOwners.set(c.id, { key, id: c[key] });
        c[key] = STAND_IN[kind];
    }
}

/** Puts back what mask() replaced (after unblock/unignore). True if anything changed. */
function unmask(c: any): boolean {
    let changed = false;
    const name = originalNames.get(c.id);
    if (name !== undefined) {
        c.name = name;
        originalNames.delete(c.id);
        changed = true;
    }
    const owner = originalOwners.get(c.id);
    if (owner) {
        c[owner.key] = owner.id;
        originalOwners.delete(c.id);
        changed = true;
    }
    return changed;
}

const isMessage = (m: any) => !!m && typeof m.id === "string" && !!m.author && "content" in m;

/** Rewrites one message in place. */
function scrubMessage(m: any) {
    // "X started a thread: <title>" carries the title as its content.
    if (m.type === MESSAGE_THREAD_CREATED) {
        const kind = kindOf(m.author?.id);
        if (kind) m.content = placeholder(kind);
    }
    const thread = m.thread;
    const kind = threadKind(thread);
    if (!kind) return;
    if (threadModeOf(kind) === "mask") mask(thread, kind);
    else {
        delete m.thread;
        if (typeof m.flags === "number") m.flags &= ~FLAG_HAS_THREAD;
    }
}

/** Walks a payload: masks threads in place, returns false for threads to drop from their array. */
function visit(value: any, depth: number): boolean {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return true;
    if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) if (!visit(value[i], depth + 1)) value.splice(i, 1);
        return true;
    }
    const kind = threadKind(value);
    if (kind) {
        if (threadModeOf(kind) === "hide") return false;
        mask(value, kind);
        return true;
    }
    if (isMessage(value)) {
        scrubMessage(value);
        return true;
    }
    for (const key of Object.keys(value)) {
        if (SKIP_KEYS.has(key)) continue;
        const child = value[key];
        if (child && typeof child === "object" && !visit(child, depth + 1)) delete value[key];
    }
    return true;
}

/** Interceptor: rewrites thread payloads. Returns true to swallow (a hidden thread's own event). */
export function interceptThreads(action: any): boolean {
    if (action.__nb || !ACTIONS.has(action.type)) return false;
    // A hidden thread that is the action's own subject (THREAD_CREATE.channel, …): drop the whole
    // action rather than hand Discord's handler an empty field.
    for (const key of Object.keys(action)) {
        const kind = threadKind(action[key]);
        if (kind && threadModeOf(kind) === "hide") return true;
    }
    visit(action, 0);
    return false;
}

// ---- store sweep ----------------------------------------------------------------------------

function knownThreads(): any[] {
    const CS = ChannelStore();
    const out = new Map<string, any>();
    const add = (c: any) => isThread(c) && out.set(c.id, c);
    const guildIds: string[] = (() => {
        const GS = findStore("GuildStore");
        const ids = GS?.getGuildIds?.() ?? Object.keys(GS?.getGuilds?.() ?? {});
        return Array.isArray(ids) ? ids : [];
    })();
    for (const guildId of guildIds) {
        const byGuild = CS.getAllThreadsForGuild?.(guildId);
        if (byGuild) {
            (Array.isArray(byGuild) ? byGuild : Object.values(byGuild)).forEach(add);
            continue;
        }
        // Older stores: walk the guild's channels and ask for their threads.
        const channels = findStore("GuildChannelStore")?.getChannels?.(guildId);
        for (const group of Object.values<any>(channels ?? {})) {
            if (!Array.isArray(group)) continue;
            for (const entry of group) {
                const parent = entry?.channel ?? entry;
                const threads = parent?.id && CS.getAllThreadsForParent?.(parent.id);
                if (threads) (Array.isArray(threads) ? threads : Object.values(threads)).forEach(add);
            }
        }
    }
    for (const id of new Set([...originalNames.keys(), ...originalOwners.keys()])) add(CS.getChannel(id));
    return [...out.values()];
}

function sweep() {
    let masked = 0, removed = 0, restored = 0;
    for (const c of knownThreads()) {
        const kind = threadKind(c);
        if (!kind) {
            if (unmask(c)) restored++;
            continue;
        }
        if (threadModeOf(kind) === "mask") {
            const before = c.name + ownerOf(c) + (c.owner_id ?? c.ownerId);
            mask(c, kind);
            if (c.name + ownerOf(c) + (c.owner_id ?? c.ownerId) !== before) masked++;
        } else {
            Flux().dispatch({
                type: "THREAD_DELETE",
                channel: { id: c.id, guild_id: c.guild_id ?? c.guildId, parent_id: c.parent_id ?? c.parentId, type: c.type },
                __nb: true,
            });
            removed++;
        }
    }
    if (masked || restored) ChannelStore().emitChange?.();
    if (masked || removed || restored) log.info(`threads: ${masked} masked, ${removed} removed, ${restored} restored`);
}

/** Called when thread settings change. */
export function refreshThreads() {
    setTimeout(() => {
        try { sweep(); } catch (e) { log.error("thread sweep", e); }
    }, 0);
}

export function startThreads() {
    // Threads read straight from the store (e.g. loaded before we ran).
    const CS = ChannelStore();
    const unpatches = ["getChannel", "getBasicChannel"].filter(k => typeof CS?.[k] === "function").map(k =>
        after(CS, k, (_: any[], c: any) => {
            const kind = c && threadKind(c);
            if (kind && threadModeOf(kind) === "mask") mask(c, kind);
            return c;
        }));
    // "Started by …" resolves the creator through UserStore: answer for the stand-ins.
    const US = UserStore();
    if (typeof US?.getUser === "function") {
        unpatches.push(after(US, "getUser", ([id]: any[], user: any) => (isStandIn(id) ? standInUser(id) : user)));
    }
    const F = Flux();
    F.subscribe("CONNECTION_OPEN", refreshThreads);
    const offHidden = onHiddenChange(refreshThreads);
    refreshThreads();
    return () => {
        unpatches.forEach(u => u());
        F.unsubscribe("CONNECTION_OPEN", refreshThreads);
        offHidden();
    };
}
