// Dev-only flash detector for cold-start checks: from document-start on, every chat message
// element that appears in the DOM is checked against the cached hidden IDs. A message of a
// hidden author (or a reply preview quoting one) outside an opened bar is a leak, recorded with
// its time since navigation start. Results: `nb.leaks`, `nb.firstMessageAt`.
import { MessageStore } from "./discord";
import { kindOf } from "./hidden";
import { storage } from "./settings";

export const leaks: { t: number; id: string; what: string }[] = [];
export const probe = { firstMessageAt: 0, checked: 0 };

const cached = () => new Set([...(storage.cache?.blocked ?? []), ...(storage.cache?.ignored ?? [])]);

function check(li: Element, hidden: Set<string>) {
    const m = /^chat-messages-(\d+)-(\d+)$/.exec(li.id);
    if (!m) return;
    probe.checked++;
    if (!probe.firstMessageAt) probe.firstMessageAt = Math.round(performance.now());
    // Inside a bar the user opened: shown on purpose.
    if (li.closest("[class*='expanded']") || li.parentElement?.closest("[id^='chat-messages-']")) return;
    const msg = MessageStore()?.getMessage(m[1], m[2]);
    const author = msg?.author?.id;
    if (author && (hidden.has(author) || kindOf(author))) {
        leaks.push({ t: Math.round(performance.now()), id: m[2], what: `message by ${msg.author.username}` });
    }
    const refAuthor = msg?.messageReference && MessageStore()?.getMessage(msg.messageReference.channel_id, msg.messageReference.message_id)?.author?.id;
    if (refAuthor && (hidden.has(refAuthor) || kindOf(refAuthor))) {
        // the preview must say "Blocked/Ignored message", never quote the text
        const quoted = MessageStore()?.getMessage(msg.messageReference.channel_id, msg.messageReference.message_id)?.content;
        if (quoted && quoted.length > 3 && li.textContent?.includes(quoted.slice(0, 40))) {
            leaks.push({ t: Math.round(performance.now()), id: m[2], what: "reply preview quotes a hidden message" });
        }
    }
}

export function startProbe() {
    const hidden = cached();
    const obs = new MutationObserver(records => {
        for (const r of records) for (const n of r.addedNodes) {
            if (!(n instanceof Element)) continue;
            if (n.matches("li[id^='chat-messages-']")) check(n, hidden);
            for (const li of n.querySelectorAll?.("li[id^='chat-messages-']") ?? []) check(li, hidden);
        }
    });
    obs.observe(document, { childList: true, subtree: true });
}
