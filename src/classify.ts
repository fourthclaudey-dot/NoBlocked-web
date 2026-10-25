// Decides which category (if any) a message belongs to. Works with both raw API payloads
// (snake_case, from flux actions) and MessageRecords (camelCase, from stores/stream items).
import { MessageStore, ReferencedMessageStore, UserStore } from "./discord";
import { kindOf } from "./hidden";
import { Category, countsAsNew, modeOf } from "./settings";

function referencedAuthorId(message: any): string | undefined {
    const raw = message.referenced_message;
    if (raw?.author?.id) return raw.author.id;
    const ref = message.messageReference ?? message.message_reference;
    if (!ref?.message_id || (ref.type ?? 0) !== 0) return undefined; // type 1 = forward, not a reply
    const fromRef = ReferencedMessageStore()?.getMessageByReference?.(ref)?.message;
    if (fromRef?.author?.id) return fromRef.author.id;
    return MessageStore()?.getMessage(ref.channel_id, ref.message_id)?.author?.id;
}

function isMe(id: string | undefined) {
    return !!id && id === UserStore()?.getCurrentUser()?.id;
}

/** Category of a message, regardless of settings for that category. */
export function categoryOf(message: any): Category | null {
    if (!message) return null;
    const author = message.author?.id;
    const kind = kindOf(author);
    if (kind) return kind;
    if (isMe(author)) return null;
    const replyTo = referencedAuthorId(message);
    if (kindOf(replyTo)) return "replies";
    return null;
}

/** Category whose display settings apply to this message, or null if it shows normally. */
export function displayCategory(message: any): Category | null {
    const cat = categoryOf(message);
    if (!cat) return null;
    return modeOf(cat) === "off" ? null : cat;
}

/** True when this message must not make the chat look unread / notify. */
export function silentForUnread(message: any): boolean {
    const cat = categoryOf(message);
    return !!cat && !countsAsNew(cat);
}
