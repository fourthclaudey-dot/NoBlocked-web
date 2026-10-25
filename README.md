# NoBlocked for Discord web

A userscript for [Tampermonkey](https://www.tampermonkey.net/) that takes blocked and ignored
users out of Discord in the browser (discord.com, PTB, Canary). It is the browser version of the
[NoBlocked Kettu plugin](https://github.com/fourthclaudey-dot/NoBlocked) for Discord on Android,
with the same settings and behaviour.

**Install:** with Tampermonkey installed, open
**[NoBlocked.user.js](https://fourthclaudey-dot.github.io/NoBlocked-web/NoBlocked.user.js)**
and confirm. Tampermonkey keeps it up to date from the same address.

Settings: Tampermonkey menu → **⚙ NoBlocked · Settings**, or Discord → User Settings →
**NoBlocked**.

- **Idea:** Imperator
- **Code:** Claude (Anthropic)

> 💡 **Have an idea or missing something?** Don't hesitate to
> [open an issue](https://github.com/fourthclaudey-dot/NoBlocked-web/issues/new) — feature
> suggestions are very welcome, big or small, in any language.

## What it does

- **Chat** — messages from blocked/ignored users become a bar you can open, a bar that
  can't be opened, or disappear completely. Shared setting plus separate choices for blocked
  and ignored users.
- **Replies to them** — replies from other people to blocked/ignored users can be folded the
  same way (off by default). Your own messages are never hidden.
- **Merged bars** — a back-and-forth between hidden users (blocked, ignored, replies
  alternating) becomes one bar ("5 hidden messages · 3 blocked · 2 replies"); opening it shows
  the original bars as Discord would, clicking again closes it.
- **No "new message" noise** — their messages don't mark chats unread, don't move DMs up,
  don't change message previews, don't reach the inbox and trigger **no desktop notification
  and no message sound**. Chats that only got hidden messages are also marked read on the
  server, so other devices and the next start agree; at start, unread chats that only have
  hidden messages are checked and marked read. "Passive" server updates (a new last message id
  with no author) are checked before they can light a channel up. Configurable per category.
- **Reactions** — their reactions are subtracted from reaction counters and they are removed
  from the "who reacted" list (the script asks the API who reacted, only for the open chat;
  costs extra requests). Separate switch for blocked and for ignored users.
- **Clean history** — date dividers of days where only hidden users wrote, and a "NEW
  MESSAGES" line with nothing visible below it, are dropped. When a whole page of older
  messages is hidden, the script keeps loading until something visible arrives.
- **No flash** — it starts before Discord's own code and keeps its own copy of the
  block/ignore list, which it lends to Discord until the server's list arrives. Opening a link
  to a hidden message no longer unfolds it.
- **Total exclusion** — one switch that overrides everything above to "hide completely".

Languages: English, Deutsch, Français, Español, Italiano, Português, Polski, Nederlands,
Svenska, Русский, 中文. The script follows Discord's language.

## Known limitations

- Discord's web app changes often. The script finds its internals by stable names and edits
  three spots of the chat module; if one of them stops matching after an update, only that
  feature switches off (merged bars, own bar texts, or the whole chat folding) and the rest
  keeps working. Please open an issue when that happens.
- Tested on Chrome with Tampermonkey. In Chrome, Tampermonkey needs **"Allow User Scripts"**
  (chrome://extensions → Tampermonkey → Details). Firefox with Tampermonkey uses the same code
  path but was not tested by us.
- Hiding reactions needs one extra API request per reaction (or per hidden user, whichever is
  cheaper), only for messages on screen.
- Typing indicators, the member list and DM list entries of hidden users are left as Discord
  shows them.

## How it works

The script has two halves. Tampermonkey may run a userscript in the page's JavaScript world or
in an isolated one (it differs between browsers and versions), and Discord's internals are only
reachable from the page's. So the userscript itself only keeps the `GM_*` APIs (storage, menu)
and, at `document-start`, injects the main code into the page as an inline script carrying
Discord's CSP nonce (`blob:` as a fallback); the halves talk through DOM events. In the page the
main code runs before Discord's webpack runtime and wraps every module factory as chunks arrive
(Discord loads several runtimes on one chunk array). Stores and helpers are found by their names and exports. The chat's
"channel stream" is built inside Discord's chat module, so that module's source is patched
before it first runs to pass the finished stream through NoBlocked. Unread silencing filters
`MESSAGE_CREATE` for the stores behind unread dots, DM order, previews, the inbox and
notifications. Settings live in Tampermonkey storage; the userscript hands the stored values
over together with the main code, so the cached block list is there before anything renders.

## Building

```
npm install
npm test           # shared logic: chat stream, settings, locales
npm run build      # dist/NoBlocked.user.js
```

Pushing to `main` publishes `dist/` to GitHub Pages (`.github/workflows/pages.yml`).

## Developing

```
npm run dev        # dev server on 127.0.0.1:4042
```

Install `http://127.0.0.1:4042/dev-loader.user.js` in Tampermonkey (instead of the release
script). The loader runs the dev build it stored last time and fetches the current one; after
an edit, F5 is enough (the page reloads once more by itself). Then:

```
node tools/eval.mjs "nb.storage"                  # run code in the Discord page
node tools/eval.mjs -f tools/snippets/stream.js   # last chat stream after NoBlocked
node tools/eval.mjs --reload                      # reload the Discord tab
node tools/eval.mjs --logs                        # page logs (also logs/page.log)
```

The page talks to the dev server through `GM_xmlhttpRequest`: Chrome's Local Network Access
blocks a site's own requests to 127.0.0.1.

## License

MIT
