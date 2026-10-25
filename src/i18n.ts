// UI strings (shared with the mobile plugin). Language follows Discord's own; unknown languages
// fall back to English. Plurals are hand-rolled, as in the mobile plugin.

type Plural = (n: number) => string;

interface Strings {
    main: string;
    total: string;
    totalNote: string;
    shared: string;
    blocked: string;
    ignored: string;
    replies: string;
    modes: Record<"inherit" | "off" | "reveal" | "bar" | "remove", string>;
    countsNew: string;
    countsNewNote: string;
    display: string;
    merge: string;
    mergeNote: string;
    reactions: string;
    reactionsNote: string;
    serverAck: string;
    serverAckNote: string;
    cached: (blocked: number, ignored: number) => string;
    blockedBar: Plural;
    ignoredBar: Plural;
    repliesBar: Plural;
    /** Merged bar: total hidden messages, then the per-category parts. */
    mergedTotal: Plural;
    mergedBlocked: Plural;
    mergedIgnored: Plural;
    mergedReplies: Plural;
    collapse: string;
    /** Settings window (web only). */
    settings: string;
    close: string;
}

/** one / other (English, German, Spanish, Italian, Portuguese, Dutch, Swedish) */
const oneOther = (one: string, other: string): Plural => n => (n === 1 ? one : other).replace("#", String(n));
/** French counts 0 and 1 as singular. */
const frPlural = (one: string, other: string): Plural => n => (n === 0 || n === 1 ? one : other).replace("#", String(n));
/** Russian: 1, 21 / 2-4, 22-24 / rest */
const ruPlural = (one: string, few: string, many: string): Plural => n => {
    const m10 = n % 10, m100 = n % 100;
    const form = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
    return form.replace("#", String(n));
};
/** Polish: only exactly 1 is singular; 2-4 (not 12-14) few; rest many. */
const plPlural = (one: string, few: string, many: string): Plural => n => {
    const m10 = n % 10, m100 = n % 100;
    const form = n === 1 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
    return form.replace("#", String(n));
};
const noPlural = (form: string): Plural => n => form.replace("#", String(n));

const en: Strings = {
    main: "Main",
    total: "Total exclusion",
    totalNote: "Blocked users, ignored users and replies to them are hidden everywhere, can't be opened and never count as new",
    shared: "Shared setting (blocked + ignored)",
    blocked: "Blocked users",
    ignored: "Ignored users",
    replies: "Replies to blocked and ignored users",
    modes: { inherit: "Same as shared setting", off: "Show as usual", reveal: "Bar, can be opened", bar: "Bar, can't be opened", remove: "Hide completely" },
    countsNew: "Counts as new",
    countsNewNote: "Marks the chat unread and moves DMs up",
    display: "Display",
    merge: "Merge bars",
    mergeNote: "Several bars in a row (a back-and-forth) collapse into one; opening it shows them as usual",
    reactions: "Hide their reactions",
    reactionsNote: "Not counted in reaction counters and not listed in \"who reacted\". Uses extra API requests",
    serverAck: "Mark as read on the server",
    serverAckNote: "If a chat has nothing new except hidden messages, mark it read on other devices too",
    cached: (b, i) => `Cached: ${b} blocked, ${i} ignored`,
    blockedBar: oneOther("# blocked message", "# blocked messages"),
    ignoredBar: oneOther("# ignored message", "# ignored messages"),
    repliesBar: oneOther("# reply to hidden users", "# replies to hidden users"),
    mergedTotal: oneOther("# hidden message", "# hidden messages"),
    mergedBlocked: noPlural("# blocked"),
    mergedIgnored: noPlural("# ignored"),
    mergedReplies: oneOther("# reply", "# replies"),
    collapse: "Collapse",
    settings: "Settings",
    close: "Close",
};

const de: Strings = {
    main: "Allgemein",
    total: "Vollständiger Ausschluss",
    totalNote: "Blockierte und ignorierte Nutzer sowie Antworten an sie werden überall ausgeblendet, lassen sich nicht öffnen und zählen nie als neu",
    shared: "Gemeinsame Einstellung (blockiert + ignoriert)",
    blocked: "Blockierte Nutzer",
    ignored: "Ignorierte Nutzer",
    replies: "Antworten an blockierte und ignorierte Nutzer",
    modes: { inherit: "Wie gemeinsame Einstellung", off: "Normal anzeigen", reveal: "Hinweis, aufklappbar", bar: "Hinweis, nicht aufklappbar", remove: "Vollständig ausblenden" },
    countsNew: "Als neu zählen",
    countsNewNote: "Chat als ungelesen markieren, DMs nach oben schieben",
    display: "Anzeige",
    merge: "Hinweise zusammenfassen",
    mergeNote: "Mehrere Hinweise hintereinander (ein Schlagabtausch) werden zu einem; beim Aufklappen erscheinen sie wie gewohnt",
    reactions: "Ihre Reaktionen ausblenden",
    reactionsNote: "Werden nicht in Reaktionszählern mitgezählt und nicht in der Liste „Wer hat reagiert“ angezeigt. Benötigt zusätzliche API-Anfragen",
    serverAck: "Auf dem Server als gelesen markieren",
    serverAckNote: "Wenn ein Chat außer Ausgeblendetem nichts Neues enthält, auch auf anderen Geräten als gelesen markieren",
    cached: (b, i) => `Im Cache: ${b} blockiert, ${i} ignoriert`,
    blockedBar: oneOther("# blockierte Nachricht", "# blockierte Nachrichten"),
    ignoredBar: oneOther("# ignorierte Nachricht", "# ignorierte Nachrichten"),
    repliesBar: oneOther("# Antwort an ausgeblendete Nutzer", "# Antworten an ausgeblendete Nutzer"),
    mergedTotal: oneOther("# ausgeblendete Nachricht", "# ausgeblendete Nachrichten"),
    mergedBlocked: noPlural("# blockiert"),
    mergedIgnored: noPlural("# ignoriert"),
    mergedReplies: oneOther("# Antwort", "# Antworten"),
    collapse: "Einklappen",
    settings: "Einstellungen",
    close: "Schließen",
};

const fr: Strings = {
    main: "Général",
    total: "Exclusion totale",
    totalNote: "Les utilisateurs bloqués, ignorés et les réponses qui leur sont adressées sont masqués partout, ne peuvent pas être ouverts et ne comptent jamais comme nouveaux",
    shared: "Réglage commun (bloqués + ignorés)",
    blocked: "Utilisateurs bloqués",
    ignored: "Utilisateurs ignorés",
    replies: "Réponses aux utilisateurs bloqués et ignorés",
    modes: { inherit: "Comme le réglage commun", off: "Afficher normalement", reveal: "Bandeau, peut être ouvert", bar: "Bandeau, ne peut pas être ouvert", remove: "Masquer complètement" },
    countsNew: "Compter comme nouveau",
    countsNewNote: "Marque la discussion comme non lue, fait remonter les MP",
    display: "Affichage",
    merge: "Fusionner les bandeaux",
    mergeNote: "Plusieurs bandeaux à la suite (un échange) n'en forment qu'un ; l'ouvrir les affiche comme d'habitude",
    reactions: "Masquer leurs réactions",
    reactionsNote: "Non comptées dans les compteurs de réactions et absentes de la liste « Qui a réagi ». Utilise des requêtes API supplémentaires",
    serverAck: "Marquer comme lu sur le serveur",
    serverAckNote: "Si une discussion ne contient rien de nouveau à part des messages masqués, la marquer comme lue sur les autres appareils aussi",
    cached: (b, i) => `En cache : ${b} bloqués, ${i} ignorés`,
    blockedBar: frPlural("# message bloqué", "# messages bloqués"),
    ignoredBar: frPlural("# message ignoré", "# messages ignorés"),
    repliesBar: frPlural("# réponse à des utilisateurs masqués", "# réponses à des utilisateurs masqués"),
    mergedTotal: frPlural("# message masqué", "# messages masqués"),
    mergedBlocked: frPlural("# bloqué", "# bloqués"),
    mergedIgnored: frPlural("# ignoré", "# ignorés"),
    mergedReplies: frPlural("# réponse", "# réponses"),
    collapse: "Réduire",
    settings: "Paramètres",
    close: "Fermer",
};

const es: Strings = {
    main: "General",
    total: "Exclusión total",
    totalNote: "Los usuarios bloqueados, ignorados y las respuestas a ellos se ocultan en todas partes, no se pueden abrir y nunca cuentan como nuevos",
    shared: "Ajuste común (bloqueados + ignorados)",
    blocked: "Usuarios bloqueados",
    ignored: "Usuarios ignorados",
    replies: "Respuestas a usuarios bloqueados e ignorados",
    modes: { inherit: "Igual que el ajuste común", off: "Mostrar normalmente", reveal: "Aviso, se puede abrir", bar: "Aviso, no se puede abrir", remove: "Ocultar por completo" },
    countsNew: "Contar como nuevo",
    countsNewNote: "Marca el chat como no leído y sube los MD",
    display: "Visualización",
    merge: "Agrupar avisos",
    mergeNote: "Varios avisos seguidos (un intercambio) se agrupan en uno; al abrirlo se muestran como siempre",
    reactions: "Ocultar sus reacciones",
    reactionsNote: "No se cuentan en los contadores de reacciones ni aparecen en la lista «Quién reaccionó». Usa solicitudes extra a la API",
    serverAck: "Marcar como leído en el servidor",
    serverAckNote: "Si un chat no tiene nada nuevo salvo mensajes ocultos, marcarlo como leído también en otros dispositivos",
    cached: (b, i) => `En caché: ${b} bloqueados, ${i} ignorados`,
    blockedBar: oneOther("# mensaje bloqueado", "# mensajes bloqueados"),
    ignoredBar: oneOther("# mensaje ignorado", "# mensajes ignorados"),
    repliesBar: oneOther("# respuesta a usuarios ocultos", "# respuestas a usuarios ocultos"),
    mergedTotal: oneOther("# mensaje oculto", "# mensajes ocultos"),
    mergedBlocked: oneOther("# bloqueado", "# bloqueados"),
    mergedIgnored: oneOther("# ignorado", "# ignorados"),
    mergedReplies: oneOther("# respuesta", "# respuestas"),
    collapse: "Contraer",
    settings: "Ajustes",
    close: "Cerrar",
};

const it: Strings = {
    main: "Generale",
    total: "Esclusione totale",
    totalNote: "Utenti bloccati, ignorati e le risposte a loro vengono nascosti ovunque, non si possono aprire e non contano mai come nuovi",
    shared: "Impostazione comune (bloccati + ignorati)",
    blocked: "Utenti bloccati",
    ignored: "Utenti ignorati",
    replies: "Risposte a utenti bloccati e ignorati",
    modes: { inherit: "Come l'impostazione comune", off: "Mostra normalmente", reveal: "Avviso, apribile", bar: "Avviso, non apribile", remove: "Nascondi del tutto" },
    countsNew: "Conta come nuovo",
    countsNewNote: "Segna la chat come non letta e sposta in alto i DM",
    display: "Visualizzazione",
    merge: "Unisci gli avvisi",
    mergeNote: "Più avvisi di fila (uno scambio) diventano uno solo; aprendolo si vedono come al solito",
    reactions: "Nascondi le loro reazioni",
    reactionsNote: "Non vengono contate nei contatori delle reazioni né mostrate nell'elenco «Chi ha reagito». Usa richieste API aggiuntive",
    serverAck: "Segna come letto sul server",
    serverAckNote: "Se una chat non ha nulla di nuovo oltre ai messaggi nascosti, segnala come letta anche sugli altri dispositivi",
    cached: (b, i) => `In cache: ${b} bloccati, ${i} ignorati`,
    blockedBar: oneOther("# messaggio bloccato", "# messaggi bloccati"),
    ignoredBar: oneOther("# messaggio ignorato", "# messaggi ignorati"),
    repliesBar: oneOther("# risposta a utenti nascosti", "# risposte a utenti nascosti"),
    mergedTotal: oneOther("# messaggio nascosto", "# messaggi nascosti"),
    mergedBlocked: oneOther("# bloccato", "# bloccati"),
    mergedIgnored: oneOther("# ignorato", "# ignorati"),
    mergedReplies: oneOther("# risposta", "# risposte"),
    collapse: "Comprimi",
    settings: "Impostazioni",
    close: "Chiudi",
};

const pt: Strings = {
    main: "Geral",
    total: "Exclusão total",
    totalNote: "Utilizadores bloqueados, ignorados e as respostas a eles ficam ocultos em todo o lado, não podem ser abertos e nunca contam como novos",
    shared: "Definição comum (bloqueados + ignorados)",
    blocked: "Utilizadores bloqueados",
    ignored: "Utilizadores ignorados",
    replies: "Respostas a utilizadores bloqueados e ignorados",
    modes: { inherit: "Igual à definição comum", off: "Mostrar normalmente", reveal: "Aviso, pode ser aberto", bar: "Aviso, não pode ser aberto", remove: "Ocultar completamente" },
    countsNew: "Contar como novo",
    countsNewNote: "Marca o chat como não lido e sobe as MD",
    display: "Apresentação",
    merge: "Juntar avisos",
    mergeNote: "Vários avisos seguidos (uma troca de mensagens) juntam-se num só; ao abri-lo aparecem como de costume",
    reactions: "Ocultar as reações deles",
    reactionsNote: "Não contam nos contadores de reações nem aparecem na lista «Quem reagiu». Usa pedidos extra à API",
    serverAck: "Marcar como lido no servidor",
    serverAckNote: "Se um chat não tiver nada de novo além de mensagens ocultas, marcá-lo como lido também nos outros dispositivos",
    cached: (b, i) => `Em cache: ${b} bloqueados, ${i} ignorados`,
    blockedBar: oneOther("# mensagem bloqueada", "# mensagens bloqueadas"),
    ignoredBar: oneOther("# mensagem ignorada", "# mensagens ignoradas"),
    repliesBar: oneOther("# resposta a utilizadores ocultos", "# respostas a utilizadores ocultos"),
    mergedTotal: oneOther("# mensagem oculta", "# mensagens ocultas"),
    mergedBlocked: oneOther("# bloqueada", "# bloqueadas"),
    mergedIgnored: oneOther("# ignorada", "# ignoradas"),
    mergedReplies: oneOther("# resposta", "# respostas"),
    collapse: "Recolher",
    settings: "Definições",
    close: "Fechar",
};

const pl: Strings = {
    main: "Ogólne",
    total: "Całkowite wykluczenie",
    totalNote: "Zablokowani i ignorowani użytkownicy oraz odpowiedzi do nich są wszędzie ukryte, nie da się ich rozwinąć i nigdy nie liczą się jako nowe",
    shared: "Ustawienie wspólne (zablokowani + ignorowani)",
    blocked: "Zablokowani użytkownicy",
    ignored: "Ignorowani użytkownicy",
    replies: "Odpowiedzi do zablokowanych i ignorowanych",
    modes: { inherit: "Jak w ustawieniu wspólnym", off: "Pokazuj normalnie", reveal: "Pasek, można rozwinąć", bar: "Pasek, nie można rozwinąć", remove: "Ukryj całkowicie" },
    countsNew: "Licz jako nowe",
    countsNewNote: "Oznacza czat jako nieprzeczytany, przesuwa DM w górę",
    display: "Wyświetlanie",
    merge: "Łącz paski",
    mergeNote: "Kilka pasków z rzędu (wymiana zdań) łączy się w jeden; po rozwinięciu wyglądają jak zwykle",
    reactions: "Ukrywaj ich reakcje",
    reactionsNote: "Nie są liczone w licznikach reakcji ani pokazywane na liście „Kto zareagował”. Wymaga dodatkowych zapytań do API",
    serverAck: "Oznaczaj jako przeczytane na serwerze",
    serverAckNote: "Jeśli w czacie nie ma nic nowego poza ukrytymi wiadomościami, oznacz go jako przeczytany także na innych urządzeniach",
    cached: (b, i) => `W pamięci: ${b} zablok., ${i} ignor.`,
    blockedBar: plPlural("# zablokowana wiadomość", "# zablokowane wiadomości", "# zablokowanych wiadomości"),
    ignoredBar: plPlural("# zignorowana wiadomość", "# zignorowane wiadomości", "# zignorowanych wiadomości"),
    repliesBar: plPlural("# odpowiedź do ukrytych użytkowników", "# odpowiedzi do ukrytych użytkowników", "# odpowiedzi do ukrytych użytkowników"),
    mergedTotal: plPlural("# ukryta wiadomość", "# ukryte wiadomości", "# ukrytych wiadomości"),
    mergedBlocked: noPlural("# zablok."),
    mergedIgnored: noPlural("# ignor."),
    mergedReplies: plPlural("# odpowiedź", "# odpowiedzi", "# odpowiedzi"),
    collapse: "Zwiń",
    settings: "Ustawienia",
    close: "Zamknij",
};

const nl: Strings = {
    main: "Algemeen",
    total: "Volledige uitsluiting",
    totalNote: "Geblokkeerde en genegeerde gebruikers en antwoorden aan hen worden overal verborgen, kunnen niet worden geopend en tellen nooit als nieuw",
    shared: "Gedeelde instelling (geblokkeerd + genegeerd)",
    blocked: "Geblokkeerde gebruikers",
    ignored: "Genegeerde gebruikers",
    replies: "Antwoorden aan geblokkeerde en genegeerde gebruikers",
    modes: { inherit: "Zoals gedeelde instelling", off: "Normaal tonen", reveal: "Balk, kan worden geopend", bar: "Balk, kan niet worden geopend", remove: "Volledig verbergen" },
    countsNew: "Als nieuw tellen",
    countsNewNote: "Markeert de chat als ongelezen, zet DM's bovenaan",
    display: "Weergave",
    merge: "Balken samenvoegen",
    mergeNote: "Meerdere balken achter elkaar (een woordenwisseling) worden er één; openen toont ze zoals gewoonlijk",
    reactions: "Hun reacties verbergen",
    reactionsNote: "Tellen niet mee in reactietellers en staan niet in de lijst „Wie heeft gereageerd”. Gebruikt extra API-verzoeken",
    serverAck: "Op de server als gelezen markeren",
    serverAckNote: "Als een chat niets nieuws heeft behalve verborgen berichten, ook op andere apparaten als gelezen markeren",
    cached: (b, i) => `In cache: ${b} geblokkeerd, ${i} genegeerd`,
    blockedBar: oneOther("# geblokkeerd bericht", "# geblokkeerde berichten"),
    ignoredBar: oneOther("# genegeerd bericht", "# genegeerde berichten"),
    repliesBar: oneOther("# antwoord aan verborgen gebruikers", "# antwoorden aan verborgen gebruikers"),
    mergedTotal: oneOther("# verborgen bericht", "# verborgen berichten"),
    mergedBlocked: noPlural("# geblokkeerd"),
    mergedIgnored: noPlural("# genegeerd"),
    mergedReplies: oneOther("# antwoord", "# antwoorden"),
    collapse: "Inklappen",
    settings: "Instellingen",
    close: "Sluiten",
};

const sv: Strings = {
    main: "Allmänt",
    total: "Fullständig uteslutning",
    totalNote: "Blockerade och ignorerade användare samt svar till dem döljs överallt, kan inte öppnas och räknas aldrig som nytt",
    shared: "Gemensam inställning (blockerade + ignorerade)",
    blocked: "Blockerade användare",
    ignored: "Ignorerade användare",
    replies: "Svar till blockerade och ignorerade användare",
    modes: { inherit: "Som gemensam inställning", off: "Visa som vanligt", reveal: "Fält, kan öppnas", bar: "Fält, kan inte öppnas", remove: "Dölj helt" },
    countsNew: "Räkna som nytt",
    countsNewNote: "Markerar chatten som oläst, flyttar upp DM",
    display: "Visning",
    merge: "Slå ihop fält",
    mergeNote: "Flera fält i rad (en ordväxling) blir ett; när det öppnas visas de som vanligt",
    reactions: "Dölj deras reaktioner",
    reactionsNote: "Räknas inte i reaktionsräknare och visas inte i listan ”Vem reagerade”. Kräver extra API-anrop",
    serverAck: "Markera som läst på servern",
    serverAckNote: "Om en chatt inte har något nytt utöver dolda meddelanden markeras den som läst även på andra enheter",
    cached: (b, i) => `I cache: ${b} blockerade, ${i} ignorerade`,
    blockedBar: oneOther("# blockerat meddelande", "# blockerade meddelanden"),
    ignoredBar: oneOther("# ignorerat meddelande", "# ignorerade meddelanden"),
    repliesBar: noPlural("# svar till dolda användare"),
    mergedTotal: oneOther("# dolt meddelande", "# dolda meddelanden"),
    mergedBlocked: oneOther("# blockerat", "# blockerade"),
    mergedIgnored: oneOther("# ignorerat", "# ignorerade"),
    mergedReplies: noPlural("# svar"),
    collapse: "Fäll ihop",
    settings: "Inställningar",
    close: "Stäng",
};

const ru: Strings = {
    main: "Главное",
    total: "Полное исключение",
    totalNote: "Заблокированных, игнорируемых и ответы им не видно нигде, раскрыть нельзя, новым не считается",
    shared: "Общая настройка (заблок + игнор)",
    blocked: "Заблокированные",
    ignored: "Игнорируемые",
    replies: "Ответы заблокированным и игнорируемым",
    modes: { inherit: "Как в общей настройке", off: "Показывать как обычно", reveal: "Плашка, можно раскрыть", bar: "Плашка, раскрыть нельзя", remove: "Не показывать вовсе" },
    countsNew: "Считать новым в чате",
    countsNewNote: "Отмечать чат непрочитанным, поднимать ЛС",
    display: "Отображение",
    merge: "Склеивать плашки",
    mergeNote: "Несколько плашек подряд (перепалка) сворачиваются в одну; её раскрытие показывает их как обычно",
    reactions: "Скрывать их реакции",
    reactionsNote: "Не учитываются в счётчиках реакций и не показываются в списке «кто поставил реакцию». Требует дополнительных запросов к API",
    serverAck: "Отмечать прочитанным на сервере",
    serverAckNote: "Если в чате нет ничего нового, кроме скрытого — помечать прочитанным и на других устройствах",
    cached: (b, i) => `В кэше: ${b} заблок., ${i} игнор.`,
    blockedBar: ruPlural("# заблокированное сообщение", "# заблокированных сообщения", "# заблокированных сообщений"),
    ignoredBar: ruPlural("# игнорируемое сообщение", "# игнорируемых сообщения", "# игнорируемых сообщений"),
    repliesBar: ruPlural("# ответ скрытым пользователям", "# ответа скрытым пользователям", "# ответов скрытым пользователям"),
    mergedTotal: ruPlural("# скрытое сообщение", "# скрытых сообщения", "# скрытых сообщений"),
    mergedBlocked: noPlural("# заблок."),
    mergedIgnored: noPlural("# игнор."),
    mergedReplies: ruPlural("# ответ", "# ответа", "# ответов"),
    collapse: "Свернуть",
    settings: "Настройки",
    close: "Закрыть",
};

const zh: Strings = {
    main: "常规",
    total: "完全排除",
    totalNote: "已屏蔽、已忽略的用户以及对他们的回复会在所有地方隐藏，无法展开，也永远不算作新消息",
    shared: "通用设置（屏蔽 + 忽略）",
    blocked: "已屏蔽的用户",
    ignored: "已忽略的用户",
    replies: "对已屏蔽和已忽略用户的回复",
    modes: { inherit: "与通用设置相同", off: "正常显示", reveal: "提示条，可展开", bar: "提示条，不可展开", remove: "完全隐藏" },
    countsNew: "算作新消息",
    countsNewNote: "将聊天标记为未读、把私信顶到前面",
    display: "显示",
    merge: "合并提示条",
    mergeNote: "连续的多个提示条（一段你来我往的对话）合并为一个；展开后按原样显示",
    reactions: "隐藏他们的回应",
    reactionsNote: "不计入回应计数，也不出现在“谁做了回应”列表中。需要额外的 API 请求",
    serverAck: "在服务器上标记为已读",
    serverAckNote: "如果聊天中除了被隐藏的消息外没有新内容，在其他设备上也标记为已读",
    cached: (b, i) => `缓存：${b} 个已屏蔽，${i} 个已忽略`,
    blockedBar: noPlural("# 条已屏蔽的消息"),
    ignoredBar: noPlural("# 条已忽略的消息"),
    repliesBar: noPlural("# 条对隐藏用户的回复"),
    mergedTotal: noPlural("# 条隐藏消息"),
    mergedBlocked: noPlural("# 条屏蔽"),
    mergedIgnored: noPlural("# 条忽略"),
    mergedReplies: noPlural("# 条回复"),
    collapse: "收起",
    settings: "设置",
    close: "关闭",
};

const LOCALES: Record<string, Strings> = { en, de, fr, es, it, pt, pl, nl, sv, ru, zh };
export const SUPPORTED_LANGUAGES = Object.keys(LOCALES);

let localeSource: () => string | undefined = () => navigator.language;

/** Where the current language comes from (Discord's LocaleStore once it exists). */
export function setLocaleSource(fn: () => string | undefined) {
    localeSource = fn;
}

/** Strings for Discord's current language. Read on every call so a language switch applies at once. */
export function t(): Strings {
    let locale = "";
    try { locale = localeSource() ?? ""; } catch {}
    return LOCALES[locale.slice(0, 2).toLowerCase()] ?? en;
}
