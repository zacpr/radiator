# Radiator — Radial Tab Switcher for Firefox

Right-click anywhere on a page and a ring of tab lozenges (favicon + title)
appears on an ellipse around the cursor, with a fixed selector notch at 12
o'clock, a screenshot preview of the highlighted tab in the center, and
compass navigation controls around the outside. Scrolling the mouse wheel
revolves the ring so a new tab lands under the selector.

## Why it replaces the context menu instead of wrapping it

WebExtensions cannot see or decorate Firefox's native context menu — it's
browser chrome, and while it's open no events (including wheel) reach the
page. So Radiator intercepts the right-click and draws its own menu instead.
The native menu is still one gesture away (see below).

## Which menu is default?

Either menu can be the default on plain right-click (Options → Default
right-click menu). The configured modifier key (Ctrl by default) always
opens whichever menu *isn't* the default.

Some targets are **protected**: plain right-click there always gives the
native menu whatever the default is, because the native menu carries items
the ring can't reproduce. Each is toggleable in Options, all on by default:

| Protected target | What the native menu offers there |
| --- | --- |
| Links | Copy Link, Open Link in New Tab / Window |
| Text boxes & editable fields | Spellcheck suggestions, Paste, Undo |
| Selected text | Copy, "Search for …" |
| Images, video, audio | Save Image As, Copy Image, video controls |

The ring is still reachable on a protected target by holding the modifier.
Shift+right-click, and a second right-click while the ring is open, always
fall through to the native menu.

## Controls

| Gesture | Action |
| --- | --- |
| Right-click *(modifier configurable in Options)* | Open the ring (the *next* tab starts under the selector) |
| Scroll wheel / arrow keys | Revolve the ring; whatever sits at 12 o'clock is selected |
| Hover a lozenge | Highlight + preview it directly, without rotating |
| Left-click a lozenge / Enter | Switch to that tab (Sites) or navigate here (History/Bookmarks) |
| Middle-click a lozenge | Duplicate the tab (Sites) or open in a background tab (History/Bookmarks); the menu stays open so you can middle-click several |
| Type letters | Filter the ring to matching titles (first match under the selector — type + Enter is a launcher); Backspace edits |
| Delete | Close the highlighted tab and re-flow the ring (Sites mode only; the tab the menu is on is protected) |
| Sort dial (above preview) | Click a label or wheel over it: Tab order / Recent (last used) / A–Z; with Recent, open + Enter = Alt-Tab |
| Mode dial (below preview) | History / **Sites** (open tabs, default) / Bookmarks — click a label or wheel over it |
| Esc / click outside | Clear the filter if one is typed, otherwise cancel |
| Right-click again | Close Radiator and show the native context menu |
| Shift+right-click | Native context menu directly (built into Firefox) |
| "Open Radial Tab Menu" in the native menu, or the toolbar button | Fallback launcher — opens the ring regardless of the default/modifier/link settings |

## Orbit buttons

Eight compass positions around the outside of the ring, each holding an
action of your choice (Options → Orbit buttons). The default layout:

```
        New Tab    Home    New Window
   Back                          Forward
                  Reload
```

**Firefox gives add-ons no way to read the native context menu.**
`browser.menus` only manages an extension's *own* items — there is no API to
enumerate or invoke Firefox's built-ins or another add-on's entries. So the
orbit can't mirror that menu; instead it draws from a catalog of 24 actions
Radiator performs itself:

| Group | Actions |
| --- | --- |
| Navigation | Back, Forward, Reload, Reload (bypass cache), Home, Top of page, Bottom of page |
| Tabs & windows | New Tab, New Window, New Private Window, Duplicate Tab, Move Tab to New Window, Pin/Unpin, Mute/Unmute, Close Tab |
| Page | Bookmark/Unbookmark, Reader View, Zoom In, Zoom Out, Reset Zoom, Print…, Select All, Toggle Full Screen |
| Radiator | Radiator Settings |

Middle-clicking **New Tab** opens it in the background. **Zoom**, **Pin** and
**Mute** keep the ring open so they can be hit repeatedly; every other action
dismisses it. **Home** navigates to your homepage; if that's the default
Firefox Home (a privileged page extensions can't navigate to), it opens a new
tab instead. **New Private Window** only works if you've ticked "Run in
Private Windows" for the add-on.

## Options

Add-ons Manager → Radiator → Preferences:

- **Default right-click menu** — native or radial; the modifier key reaches
  whichever one isn't picked.
- **Modifier key** — Ctrl (default), Alt, or Meta/Super.
- **Always use the normal menu on…** — links, editable fields, selected text,
  images/video/audio. All on by default; see the table above.
- **Orbit buttons** — assign any catalogued action to each of the eight
  compass positions, or leave a position empty. "Reset orbit to defaults"
  restores the standard layout.
- **Ring** — max items (default 20; with more tabs the ring becomes an endless
  wrap-around window and every tab stays reachable by wheel), min/max radius,
  item scale, and fill mode for underfull rings: *equidistant* (spread out),
  *blanks* (fixed spacing with a gap at the seam), *repeat* (cycle the tabs
  again to fill the circle — endless wheel even with few tabs).
- **Container colours** — lozenges get a coloured left edge matching their
  Multi-Account Container (toggleable; needs the `contextualIdentities`
  permission).
- **Sort** — the dial's choice (Tab / Recent / A–Z) persists across opens.
- **Theme** — Slate (dark minimal), Quest (RPG parchment & leather),
  Holo (sci-fi neon), Runestone (ancient stonework).
- **Custom CSS** — applied on top of the theme. Style hooks: `.loz` (tab
  pill), `.loz .title`, `.fav` (favicon), `.badge` (letter fallback),
  `.loz.active` (current tab), `.loz.hi` (highlighted), `.ctrl` (outer
  buttons), `.preview`, `.label`, `.notch` (selector), `.sort` / `.sort.on`
  (dial labels).

Changes apply to already-open tabs immediately (next menu open).

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick `manifest.json` in this directory

Or with [web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/):

```sh
npx web-ext run
```

## Known limitations

- Content scripts can't run on privileged pages (`about:*`, `addons.mozilla.org`,
  reader view, PDF viewer, other extensions' pages), so right-click there gives
  the normal menu, and the toolbar button/fallback menu item silently do nothing.
- Previews use `tabs.captureTab()` (hence the `<all_urls>` permission), which
  fails on discarded / never-rendered tabs — those show just the title.
  Captures are cached for 15 s in the background script. History and
  Bookmarks entries never have a live preview (no tab to capture), so the
  center shows the URL (scheme trimmed, marquee-scrolling if it overflows).
- With very many tabs (~35+) the ellipse radius caps out and lozenges start
  to crowd.
- Favicons come from `tab.favIconUrl`; `chrome://` icons can't load in page
  content, so those tabs show a letter badge instead.
- Themes are injected as constructed stylesheets (`adoptedStyleSheets`), which
  page CSP can't block; on the rare engine path where that fails it falls back
  to `<style>` tags.

## Files

- `manifest.json` — MV2 manifest
- `actions.js` — the orbit action catalog and compass slot definitions;
  loaded by both the content script and the options page so the two can't
  drift apart
- `background.js` — tab/nav/bookmark/history actions and screenshot previews
  for the content script; toolbar button and native-menu fallback item
- `content.js` — renders the ring in a closed shadow DOM; base CSS + theme +
  user CSS as adopted stylesheets; pop in/out animation
- `options.html` / `options.js` — default menu, modifier, protected targets,
  orbit layout, ring, theme (`storage.sync`) and custom CSS (`storage.local`)
- `icons/ring.svg` — toolbar/extension icon
