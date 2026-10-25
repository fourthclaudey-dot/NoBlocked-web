// A "NoBlocked" item in Discord's own settings sidebar, opening our settings window.
// The item is a copy of one of Discord's sidebar items (so it looks native) with our icon, text
// and click handler. Pure DOM: if Discord changes the sidebar markup, the item simply doesn't
// appear and the Tampermonkey menu entry still opens the settings.
import { t } from "./i18n";
import { openSettings } from "./ui";

const MARK = "data-noblocked";
const ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 0 1 6.32 12.9L7.1 5.68A7.96 7.96 0 0 1 12 4Zm0 16a8 8 0 0 1-6.32-12.9L16.9 18.32A7.96 7.96 0 0 1 12 20Z"/></svg>`;

function sidebarList(): Element | null {
    // the settings sidebar: a list of sections, each with its own list of items
    for (const ul of document.querySelectorAll("ul[class*='sublist']")) {
        if (ul.querySelectorAll(":scope > li[class*='section']").length >= 3) return ul;
    }
    return null;
}

function inject() {
    const sidebar = sidebarList();
    if (!sidebar || sidebar.querySelector(`[${MARK}]`)) return;
    const list = sidebar.querySelector("li[class*='section'] ul[class*='sectionList']");
    const template = [...(list?.querySelectorAll(":scope > li[class*='itemContainer']") ?? [])]
        .find(li => !/selected/i.test(li.innerHTML.slice(0, 400)) && li.querySelector("[role='link']"));
    if (!list || !template) return;
    const item = template.cloneNode(true) as HTMLElement;
    item.setAttribute(MARK, "");
    // only the item itself: no sub-entries copied from the template
    for (const extra of [...item.children].slice(1)) extra.remove();
    const link = item.querySelector("[role='link']") as HTMLElement;
    const content = link.firstElementChild;
    const parts = content ? [...content.children] : [];
    if (parts.length >= 2) {
        parts[0].innerHTML = ICON;
        parts[parts.length - 1].textContent = "NoBlocked";
        for (const p of parts.slice(1, -1)) p.remove();
    } else {
        link.textContent = "NoBlocked";
    }
    link.title = `NoBlocked · ${t().settings}`;
    link.tabIndex = 0;
    link.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openSettings(); });
    link.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSettings(); } });
    list.append(item);
}

export function startSettingsEntry() {
    let queued = false;
    const obs = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            try { inject(); } catch {}
        });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
}
