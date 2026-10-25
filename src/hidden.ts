// Who is hidden. Discord learns relationships from the gateway (READY / CONNECTION_OPEN); until
// then the chat stays blank (see stream.ts) rather than showing messages we can't classify yet.
// Offline, the chat opens after READY_TIMEOUT_MS with the persisted list from the last session.
import { Flux, GatewayConnectionStore, RelationshipStore, RELATIONSHIP_EVENTS } from "./discord";
import { log } from "./log";
import { Kind, persist, storage } from "./settings";

const READY_TIMEOUT_MS = 5000;

let blocked = new Set<string>(storage.cache?.blocked ?? []);
let ignored = new Set<string>((storage.cache?.ignored ?? []).filter(id => !blocked.has(id)));
/** Discord's own relationship list is loaded. */
let authoritative = false;
/** The chat may render: relationships are known, or we gave up waiting and use the cache. */
let ready = false;
const listeners = new Set<() => void>();

/** Dev builds: user ids treated as ignored, to simulate histories full of hidden messages. */
export const devForceIgnored = new Set<string>();

export function kindOf(userId: string | undefined | null): Kind | null {
    if (!userId) return null;
    if (__DEV__ && devForceIgnored.has(userId)) return "ignored";
    if (blocked.has(userId)) return "blocked";
    if (ignored.has(userId)) return "ignored";
    return null;
}

export function hiddenIds(): string[] {
    return [...blocked, ...ignored];
}

export function isReady() {
    return ready;
}

/** Called when the hidden list changes or the chat becomes ready to render. */
export function onHiddenChange(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

function notify() {
    for (const fn of listeners) {
        try { fn(); } catch (e) { log.error("hidden listener", e); }
    }
}

function sameSet(a: Set<string>, b: Set<string>) {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
}

function sync() {
    const R = RelationshipStore();
    if (!R) return;
    const liveBlocked: string[] = R.getBlockedIDs();
    const liveIgnored: string[] = R.getIgnoredIDs?.() ?? [];

    const nextBlocked = new Set(authoritative ? liveBlocked : [...liveBlocked, ...storage.cache.blocked]);
    const nextIgnored = new Set(authoritative ? liveIgnored : [...liveIgnored, ...storage.cache.ignored]);
    for (const id of nextBlocked) nextIgnored.delete(id);

    if (authoritative) {
        const cache = { blocked: [...nextBlocked], ignored: [...nextIgnored] };
        if (!sameSet(new Set(storage.cache.blocked), nextBlocked) || !sameSet(new Set(storage.cache.ignored), nextIgnored)) {
            storage.cache = cache;
            persist();
        }
    }
    if (sameSet(blocked, nextBlocked) && sameSet(ignored, nextIgnored)) return;
    blocked = nextBlocked;
    ignored = nextIgnored;
    notify();
}

function markReady() {
    if (ready) return;
    ready = true;
    notify();
}

function onConnectionOpen() {
    authoritative = true;
    sync();
    markReady();
}

export function isAuthoritative() {
    return authoritative;
}

export function startHidden() {
    // Started late (script installed mid-session): Discord already has the real relationship list.
    authoritative = ready = !!GatewayConnectionStore()?.isConnected?.();
    sync();
    const timer = setTimeout(markReady, READY_TIMEOUT_MS);
    const F = Flux();
    RelationshipStore().addChangeListener(sync);
    F.subscribe("CONNECTION_OPEN", onConnectionOpen);
    for (const t of RELATIONSHIP_EVENTS) F.subscribe(t, sync);
    return () => {
        clearTimeout(timer);
        RelationshipStore().removeChangeListener(sync);
        F.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
        for (const t of RELATIONSHIP_EVENTS) F.unsubscribe(t, sync);
        listeners.clear();
    };
}
