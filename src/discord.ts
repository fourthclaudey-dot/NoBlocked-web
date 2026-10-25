// Lazy lookups of Discord internals. Modules are resolved on first use so a missing module
// (e.g. after a Discord update) only disables the feature that needs it.
import { byProps, find, findStore } from "./webpack";

function lazy<T>(get: () => T): () => T {
    let cached: T | undefined;
    return () => (cached ??= get());
}

const store = (name: string) => lazy(() => findStore(name));

export const isFlux = (e: any) => typeof e?.dispatch === "function" && typeof e.subscribe === "function" && !!e._actionHandlers && typeof e.addInterceptor === "function";
export const Flux = lazy(() => find(isFlux));

export const RelationshipStore = store("RelationshipStore");
export const MessageStore = store("MessageStore");
export const ReadStateStore = store("ReadStateStore");
export const ChannelStore = store("ChannelStore");
export const SelectedChannelStore = store("SelectedChannelStore");
export const UserGuildSettingsStore = store("UserGuildSettingsStore");
export const ReferencedMessageStore = store("ReferencedMessageStore");
export const UserStore = store("UserStore");
export const MessageReactionsStore = store("MessageReactionsStore");
export const LocaleStore = store("LocaleStore");
export const GatewayConnectionStore = store("GatewayConnectionStore");

export const React = lazy(() => find(byProps("useSyncExternalStore", "useState", "createElement")));
export const MessageActions = lazy(() => find(byProps("fetchMessages", "sendMessage", "jumpToMessage")));
/** Discord's REST client: { get, post, put, patch, del } taking { url, query, body }. */
export const HTTP = lazy(() => find(e =>
    typeof e?.get === "function" && typeof e.post === "function" && typeof e.del === "function" && typeof e.patch === "function" && !e.Request && !e.agent));

/** Stream item types of the chat list (Discord web). */
export const ItemType = {
    MESSAGE: "MESSAGE",
    THREAD_STARTER: "THREAD_STARTER_MESSAGE",
    DIVIDER: "DIVIDER",
    BLOCKED_GROUP: "MESSAGE_GROUP_BLOCKED",
    IGNORED_GROUP: "MESSAGE_GROUP_IGNORED",
} as const;

/** Raw relationship flux events that can change who is blocked/ignored. */
export const RELATIONSHIP_EVENTS = ["RELATIONSHIP_ADD", "RELATIONSHIP_UPDATE", "RELATIONSHIP_REMOVE"];

/** Flux store nodes: a Map since 2025, a plain object in older builds. */
export function storeNodes(): any[] {
    const AH = Flux()?._actionHandlers;
    const nodes = AH?._dependencyGraph?.nodes ?? AH?._nodes;
    if (!nodes) return [];
    return nodes instanceof Map ? [...nodes.values()] : Object.values(nodes);
}

export function invalidateFluxCaches() {
    Flux()?._actionHandlers?._invalidateCaches?.();
}
