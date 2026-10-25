// NoBlocked for Discord web. Runs at document-start, before Discord's own scripts:
// 1. hook webpack and register source patches (they apply as modules arrive);
// 2. the moment RelationshipStore exists, lend it our cached block/ignore list;
// 3. the moment Flux exists, add our interceptor. From the first dispatch on, each feature starts
//    as soon as the stores it needs exist — before they have handled any message.
import { devHandle, startDev } from "./dev";
import { Flux, GatewayConnectionStore, isFlux, LocaleStore, MessageReactionsStore, MessageStore, ReadStateStore, RelationshipStore } from "./discord";
import { isAuthoritative, kindOf, lendCache, onHiddenChange, startHidden } from "./hidden";
import { setLocaleSource, t } from "./i18n";
import { startLoadMore } from "./loadmore";
import { log } from "./log";
import { interceptReactions, startReactions } from "./reactions";
import { applyDefaults, onSettingsChange, storage } from "./settings";
import { installStreamPatches, rerender } from "./stream";
import { openSettings } from "./ui";
import { interceptPassive, startUnreads } from "./unreads";
import * as wp from "./webpack";

const t0 = performance.now();
if (__DEV__) startDev({ href: location.href, t0, readyState: document.readyState });

applyDefaults();
setLocaleSource(() => LocaleStore()?.locale ?? document.documentElement.lang);
installStreamPatches();
wp.hookWebpack();

wp.waitFor(wp.byStoreName("RelationshipStore"), R => {
    try { lendCache(R); } catch (e) { log.error("RelationshipStore patch failed", e); }
});

interface Feature { name: string; ready(): unknown; start(): () => void; started?: boolean }

// Order matters: hidden IDs first, the rest reads them.
const features: Feature[] = [
    { name: "hidden", ready: () => RelationshipStore() && GatewayConnectionStore(), start: startHidden },
    { name: "unreads", ready: () => ReadStateStore(), start: startUnreads },
    { name: "loadmore", ready: () => MessageStore(), start: startLoadMore },
    { name: "reactions", ready: () => MessageReactionsStore(), start: startReactions },
];
let lastCheck = 0;

function startReady() {
    const now = performance.now();
    if (now - lastCheck < 50) return;
    lastCheck = now;
    for (const f of features) {
        if (f.started) continue;
        if (!features.slice(0, features.indexOf(f)).every(p => p.started)) break;
        let ok = false;
        try { ok = !!f.ready(); } catch {}
        if (!ok) break;
        f.started = true;
        try {
            f.start();
            log.info(`${f.name} started at ${Math.round(performance.now() - t0)}ms`);
        } catch (e) {
            log.error(`${f.name} failed`, e);
        }
    }
}

const pending = () => features.some(f => !f.started);

function interceptor(action: any): boolean {
    if (pending()) startReady();
    try {
        return interceptReactions(action) || interceptPassive(action);
    } catch (e) {
        log.error("interceptor", e);
        return false;
    }
}

wp.waitFor(isFlux, F => {
    F.addInterceptor(interceptor);
    // Started after Discord (installed mid-session): no dispatch may come soon, start right away.
    if (MessageStore()) startReady();
});

onSettingsChange(rerender);
onHiddenChange(rerender);

if (typeof GM_registerMenuCommand === "function") {
    try { GM_registerMenuCommand(`⚙ NoBlocked · ${t().settings}`, openSettings); } catch {}
}

if (__DEV__) Object.assign(devHandle, { wp, storage, kindOf, isAuthoritative, rerender, Flux, openSettings, features });
log.info("loaded");
