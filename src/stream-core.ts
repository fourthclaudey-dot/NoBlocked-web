// Post-processing of the chat "channel stream" (Discord web), free of Discord dependencies so it
// can be tested on its own. Same steps as the mobile plugin's rows.ts, but web items run oldest ->
// newest (mobile rows run newest -> oldest):
//   1. Discord's own blocked/ignored groups are opened up, so every message is classified by us
//      (our cached IDs before Discord knows relationships, replies to hidden users, …);
//   2. hidden messages fold into bars per category, or vanish in `remove` mode;
//   3. "NEW MESSAGES" with nothing visible below it goes;
//   4. runs of adjacent bars merge into one bar (expandable into the original bars);
//   5. a visible message right after a bar starts a new author group;
//   6. date dividers whose day lost all its content go.
import type { Category, Mode } from "./settings";

export type Item = Record<string, any>;

export const T = {
    MESSAGE: "MESSAGE",
    THREAD_STARTER: "THREAD_STARTER_MESSAGE",
    DIVIDER: "DIVIDER",
    BLOCKED: "MESSAGE_GROUP_BLOCKED",
    IGNORED: "MESSAGE_GROUP_IGNORED",
} as const;

/** What our bars carry for the patched bar component. */
export interface BarInfo {
    cat: Category | "merged";
    /** Own text, or undefined for Discord's own ("3 blocked messages"). */
    label?: string;
    /** Whether the bar has an open/close link. */
    open: boolean;
    /** Merged bars: the run key their click toggles. */
    toggle?: string;
}

export interface StreamDeps {
    /** Display category of a message record, null when it shows normally. */
    category(message: any): Category | null;
    mode(cat: Category): Mode;
    merge: boolean;
    /** Run keys of merged bars the user opened. */
    expanded: ReadonlySet<string>;
    barLabel(cat: Category, count: number): string | undefined;
    mergedLabel(stats: Record<Category, number>, open: boolean): string;
}

interface Bar { __bar: true; cat: Category; items: Item[] }

const isBar = (x: unknown): x is Bar => !!x && (x as Bar).__bar === true;
const isMessage = (x: Item | undefined) => !!x && (x.type === T.MESSAGE || x.type === T.THREAD_STARTER);
const isNativeGroup = (x: Item) => x.type === T.BLOCKED || x.type === T.IGNORED;
const isUnreadDivider = (x: Item | undefined) => !!x && x.type === T.DIVIDER && x.unreadId != null;
const isDayDivider = (x: Item | undefined) => !!x && x.type === T.DIVIDER && x.unreadId == null && !x.isConversationChannelHeader;

/** Step 1-2: flatten Discord's groups, classify messages, fold into bars, drop `remove` ones. */
function collect(items: Item[], deps: StreamDeps): (Item | Bar)[] {
    const out: (Item | Bar)[] = [];
    const flat: Item[] = [];
    for (const item of items) {
        if (isNativeGroup(item) && Array.isArray(item.content)) flat.push(...item.content);
        else flat.push(item);
    }
    for (const item of flat) {
        if (!isMessage(item)) {
            out.push(item);
            continue;
        }
        const cat = deps.category(item.content);
        if (!cat) {
            out.push(item);
            continue;
        }
        if (deps.mode(cat) === "remove") continue;
        const prev = out[out.length - 1];
        if (isBar(prev) && prev.cat === cat) prev.items.push(item);
        else out.push({ __bar: true, cat, items: [item] });
    }
    return out;
}

/** Step 3: "NEW MESSAGES" divider with no visible message after it (all new messages were hidden). */
function dropDanglingUnread(items: (Item | Bar)[]): (Item | Bar)[] {
    const i = items.findIndex(x => !isBar(x) && isUnreadDivider(x));
    if (i === -1) return items;
    for (let j = i + 1; j < items.length; j++) if (!isBar(items[j]) && isMessage(items[j] as Item)) return items;
    return items.filter((_, j) => j !== i);
}

function barItem(b: Bar, deps: StreamDeps): Item {
    const count = b.items.length;
    const nb: BarInfo = { cat: b.cat, label: deps.barLabel(b.cat, count), open: deps.mode(b.cat) === "reveal" };
    return { type: b.cat === "blocked" ? T.BLOCKED : T.IGNORED, content: b.items, key: b.items[0].content?.id, __nb: nb };
}

/** Step 4: merge runs of adjacent bars into one; an opened run shows its bars under the header. */
function finish(items: (Item | Bar)[], deps: StreamDeps): Item[] {
    const out: Item[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isBar(item)) {
            out.push(item);
            continue;
        }
        const run: Bar[] = [item];
        while (deps.merge && isBar(items[i + 1])) run.push(items[++i] as Bar);
        if (run.length < 2) {
            out.push(barItem(item, deps));
            continue;
        }
        const stats: Record<Category, number> = { blocked: 0, ignored: 0, replies: 0 };
        for (const b of run) stats[b.cat] += b.items.length;
        const key = String(run[0].items[0].content?.id);
        const open = deps.expanded.has(key);
        const nb: BarInfo = { cat: "merged", label: deps.mergedLabel(stats, open), open: true, toggle: key };
        // no messages inside: opening it shows nothing of its own, the original bars follow it
        out.push({ type: stats.blocked ? T.BLOCKED : T.IGNORED, content: [], key: `nb-merged-${key}`, __nb: nb });
        if (open) for (const b of run) out.push(barItem(b, deps));
    }
    return out;
}

/** Step 5: a message that follows anything but a visible message of its group starts a new group. */
function fixGroupStarts(items: Item[]): Item[] {
    const shown = new Set<string>();
    return items.map((item, i) => {
        if (!isMessage(item)) return item;
        const id = item.content?.id;
        if (id != null) shown.add(id);
        if (item.groupId == null || item.groupId === id) return item;
        const prev = items[i - 1];
        if (isMessage(prev) && shown.has(item.groupId)) return item;
        return { ...item, groupId: id };
    });
}

/**
 * Step 6: date dividers whose day lost all its items: otherwise "1 Oct" would sit right above
 * "2 Oct", or today's date above nothing, revealing that hidden users talked. Unread dividers
 * only decorate the list and never count as a day having content.
 */
export function dropEmptyDays(items: Item[]): Item[] {
    const drop = new Set<number>();
    let hasContent = false;
    // newest -> oldest: a day's content is between its divider and the next divider below it
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (isDayDivider(item)) {
            if (!hasContent) drop.add(i);
            hasContent = false;
        } else if (!isUnreadDivider(item)) {
            hasContent = true;
        }
    }
    return drop.size ? items.filter((_, i) => !drop.has(i)) : items;
}

export function processStream(items: Item[], deps: StreamDeps): Item[] {
    return dropEmptyDays(fixGroupStarts(finish(dropDanglingUnread(collect(items, deps)), deps)));
}

/** Text of the single bar that replaces a run of adjacent bars ("5 hidden messages · 3 blocked · 2 replies"). */
export function mergedText(
    stats: Record<Category, number>,
    s: { mergedTotal(n: number): string; mergedBlocked(n: number): string; mergedIgnored(n: number): string; mergedReplies(n: number): string },
) {
    const total = stats.blocked + stats.ignored + stats.replies;
    const parts: string[] = [];
    if (stats.blocked) parts.push(s.mergedBlocked(stats.blocked));
    if (stats.ignored) parts.push(s.mergedIgnored(stats.ignored));
    if (stats.replies) parts.push(s.mergedReplies(stats.replies));
    return `${s.mergedTotal(total)} · ${parts.join(" · ")}`;
}
