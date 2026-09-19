"use strict";

// ---------- orbit: the ring of action buttons outside the tabs ----------

/*
 * Firefox exposes no way to read the native context menu — `browser.menus`
 * only manages an extension's *own* items, and there's no API to enumerate
 * or invoke Firefox's built-ins or another add-on's entries. So the orbit
 * can't mirror that menu; instead this is a catalog of actions Radiator
 * performs itself, and Options lets you assign any of them to the eight
 * compass positions around the ring.
 *
 * Each action carries either a `msg` (handled in background.js) or a `run`
 * (needs the page itself), plus optional `middleMsg` for middle-click and
 * `keepOpen` for the ones you'd plausibly hit twice in a row.
 */
const ACTIONS = [
  // — navigation —
  { id: "back", title: "Back", group: "Navigation",
    msg: { type: "navBack" }, paths: ["M15 18l-6-6 6-6"] },
  { id: "forward", title: "Forward", group: "Navigation",
    msg: { type: "navForward" }, paths: ["M9 6l6 6-6 6"] },
  { id: "reload", title: "Reload", group: "Navigation",
    msg: { type: "reloadTab" },
    paths: ["M23 4v6h-6", "M20.49 15a9 9 0 1 1-2.12-9.36L23 10"] },
  { id: "hardReload", title: "Reload (bypass cache)", group: "Navigation",
    msg: { type: "hardReload" },
    paths: ["M23 4v6h-6", "M20.49 15a9 9 0 1 1-2.12-9.36L23 10", "M13 8l-3 4h4l-3 4"] },
  { id: "home", title: "Home", group: "Navigation",
    msg: { type: "goHome" }, paths: ["M3 10.5L12 3l9 7.5", "M5 9.5V21h14V9.5"] },
  { id: "scrollTop", title: "Top of page", group: "Navigation",
    run: () => window.scrollTo({ top: 0, behavior: "smooth" }),
    paths: ["M12 19V7", "M5 12l7-7 7 7", "M5 4h14"] },
  { id: "scrollBottom", title: "Bottom of page", group: "Navigation",
    run: () =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }),
    paths: ["M12 5v12", "M19 12l-7 7-7-7", "M5 20h14"] },

  // — tabs & windows —
  { id: "newTab", title: "New Tab", group: "Tabs & windows",
    msg: { type: "newTab" }, middleMsg: { type: "newTab", background: true },
    paths: ["M12 5v14", "M5 12h14"] },
  { id: "newWindow", title: "New Window", group: "Tabs & windows",
    msg: { type: "newWindow" },
    paths: ["M3 5h18v14H3z", "M3 9h18", "M12 12.5v4", "M10 14.5h4"] },
  { id: "privateWindow", title: "New Private Window", group: "Tabs & windows",
    msg: { type: "privateWindow" },
    paths: ["M4 13h16", "M7 13a2.5 2.5 0 1 0 5 0", "M12 13a2.5 2.5 0 1 0 5 0",
            "M6 13l1.5-5.5A2 2 0 0 1 9.5 6h5a2 2 0 0 1 2 1.5L18 13"] },
  { id: "duplicateTab", title: "Duplicate Tab", group: "Tabs & windows",
    msg: { type: "duplicateCurrentTab" }, paths: ["M9 9h11v11H9z", "M4 15V4h11"] },
  { id: "moveToNewWindow", title: "Move Tab to New Window", group: "Tabs & windows",
    msg: { type: "moveTabToNewWindow" },
    paths: ["M15 3h6v6", "M10 14L21 3",
            "M20 14v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6"] },
  { id: "pinTab", title: "Pin / Unpin Tab", group: "Tabs & windows",
    msg: { type: "togglePin" }, keepOpen: true,
    paths: ["M12 17v5", "M9 3h6l-1 6 3 3v2H7v-2l3-3z"] },
  { id: "muteTab", title: "Mute / Unmute Tab", group: "Tabs & windows",
    msg: { type: "toggleMute" }, keepOpen: true,
    paths: ["M11 5L6 9H2v6h4l5 4z", "M23 9l-6 6", "M17 9l6 6"] },
  { id: "closeTab", title: "Close Tab", group: "Tabs & windows",
    msg: { type: "closeCurrentTab" }, paths: ["M18 6L6 18", "M6 6l12 12"] },

  // — page —
  { id: "bookmarkPage", title: "Bookmark / Unbookmark Page", group: "Page",
    msg: { type: "bookmarkPage" }, paths: ["M6 3h12v18l-6-4.5L6 21z"] },
  { id: "readerView", title: "Reader View", group: "Page",
    msg: { type: "readerView" },
    paths: ["M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z",
            "M20 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z"] },
  { id: "zoomIn", title: "Zoom In", group: "Page",
    msg: { type: "zoomIn" }, keepOpen: true,
    paths: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M21 21l-4.35-4.35",
            "M11 8v6", "M8 11h6"] },
  { id: "zoomOut", title: "Zoom Out", group: "Page",
    msg: { type: "zoomOut" }, keepOpen: true,
    paths: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M21 21l-4.35-4.35", "M8 11h6"] },
  { id: "zoomReset", title: "Reset Zoom", group: "Page",
    msg: { type: "zoomReset" }, keepOpen: true,
    paths: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M21 21l-4.35-4.35",
            "M9 9l4 4", "M13 9l-4 4"] },
  { id: "print", title: "Print…", group: "Page",
    run: () => window.print(),
    paths: ["M6 9V3h12v6", "M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2",
            "M6 14h12v7H6z"] },
  { id: "selectAll", title: "Select All", group: "Page",
    run: () => document.execCommand("selectAll"),
    paths: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2",
            "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M8 8h8v8H8z"] },
  { id: "fullscreen", title: "Toggle Full Screen", group: "Page",
    run: () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    },
    paths: ["M8 3H5a2 2 0 0 0-2 2v3", "M16 3h3a2 2 0 0 1 2 2v3",
            "M16 21h3a2 2 0 0 0 2-2v-3", "M8 21H5a2 2 0 0 1-2-2v-3"] },

  // — radiator —
  { id: "settings", title: "Radiator Settings", group: "Radiator",
    msg: { type: "openOptions" },
    paths: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
            "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"] },
];

const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

// Eight compass positions on the orbit; "" leaves the position empty.
const ORBIT_SLOTS = [
  { id: "nw", label: "Top left", angle: (-3 * Math.PI) / 4 },
  { id: "n", label: "Top", angle: -Math.PI / 2 },
  { id: "ne", label: "Top right", angle: -Math.PI / 4 },
  { id: "w", label: "Left", angle: Math.PI },
  { id: "e", label: "Right", angle: 0 },
  { id: "sw", label: "Bottom left", angle: (3 * Math.PI) / 4 },
  { id: "s", label: "Bottom", angle: Math.PI / 2 },
  { id: "se", label: "Bottom right", angle: Math.PI / 4 },
];

const DEFAULT_ORBIT = {
  nw: "newTab", n: "home", ne: "newWindow",
  w: "back", e: "forward",
  sw: "", s: "reload", se: "",
};

