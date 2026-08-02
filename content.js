"use strict";

/*
 * Radiator content script.
 *
 * Either the native context menu or the radial ring can be the default on
 * plain right-click (Options → Default menu); the configured modifier key
 * always opens whichever one *isn't* the default. On links, the radial only
 * ever opens with the modifier held, regardless of the default — links carry
 * native-menu actions (copy link, open in new tab, etc.) worth protecting.
 * Shift+right-click and a second right-click always fall through to native.
 *
 * The ring's selector notch is fixed at 12 o'clock; the scroll wheel
 * revolves the ring so a new lozenge lands under it. Hovering a lozenge
 * highlights it directly (without rotating). The center shows a screenshot
 * preview of the highlighted tab plus two dials: sort (Tab bar order /
 * Recent / A–Z) above, ring mode (History / Sites / Bookmarks) below —
 * click a label or wheel over a dial to spin it.
 *
 * The ring holds at most `maxItems` slots. With more tabs than slots it
 * becomes a wrap-around window over the full tab list: wheeling slides tabs
 * in and out at the 6 o'clock edges, endlessly, and every tab stays
 * reachable. With fewer tabs than slots the fill mode decides the layout:
 *   equidistant — spread the tabs around the whole circle
 *   blanks      — keep the full-ring slot spacing, leaving a gap
 *   repeat      — refill the circle with the tab cycle again (endless wheel)
 *
 * Type to filter: printable keys build a query that narrows the ring to
 * matching titles (first match lands under the selector, so type + Enter is
 * a launcher). Backspace edits it; Esc clears the filter, and closes when
 * the filter is already empty. Delete closes the highlighted tab (Sites mode
 * only, except the one this menu lives in) and the ring re-flows.
 *
 * Left-click / Enter activates (switches tabs in Sites mode, navigates here
 * in History/Bookmarks); middle-click duplicates (Sites) or opens in a
 * background tab (History/Bookmarks) and keeps the menu open so several can
 * be queued up. Compass controls sit outside the ring: Back (W), Forward
 * (E), Home (N), Reload (S), New Tab (NW, middle-click = background), New
 * Window (NE).
 *
 * The whole assembly pops in from the cursor with a slight overshoot and
 * pops back out on close; everything lives inside one `.wrap` element so a
 * single transform on it animates the group without disturbing each
 * lozenge's own position math.
 *
 * Appearance lives in constructed stylesheets adopted by the shadow root
 * (page CSP can't block those; a <style> tag is the fallback). Themes and
 * user CSS layer on top of the base CSS via the class names:
 *   .loz .title .fav .badge .active .hi .ctrl .preview .label .filterq
 *   .sort .sort.on .notch
 */

(() => {
  if (window.__radiatorLoaded) return;
  window.__radiatorLoaded = true;

  const CTRL_SIZE = 52;
  const HI_SCALE = 1.25;
  const POP_MS = 150; // entrance/exit duration

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // ---------- styles ----------

  function baseCss(d) {
    return `
      * { box-sizing: border-box; }
      .wrap {
        position: fixed; inset: 0; pointer-events: none;
        opacity: 0; transform: scale(0.82) rotate(-2deg);
        transition: opacity ${POP_MS}ms ease, transform ${POP_MS + 70}ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .wrap.in { opacity: 1; transform: none; }
      .wrap.out {
        opacity: 0; transform: scale(0.85);
        transition: opacity ${POP_MS - 20}ms ease, transform ${POP_MS - 20}ms ease;
      }
      .loz {
        position: fixed; left: 0; top: 0;
        height: ${d.lozH}px; max-width: ${d.lozMaxW}px;
        padding: 0 ${d.padR}px 0 ${d.padL}px;
        border-radius: 999px; display: flex; align-items: center; gap: ${d.gap}px;
        cursor: pointer; pointer-events: auto;
        transition: transform 130ms cubic-bezier(0.34, 1.56, 0.64, 1);
        will-change: transform;
      }
      .loz.hi { z-index: 2; }
      @keyframes rad-pulse {
        0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; }
      }
      .pulse { animation: rad-pulse 220ms ease; }
      .loz .title {
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        user-select: none; font: ${d.fontPx}px/1 system-ui, sans-serif;
      }
      .fav { width: ${d.favPx}px; height: ${d.favPx}px; flex: 0 0 auto; pointer-events: none; }
      .badge {
        width: ${d.favPx}px; text-align: center; flex: 0 0 auto; user-select: none;
        font: 700 ${d.fontPx}px/1 system-ui, sans-serif;
      }
      .ctrl {
        position: fixed; transform: translate(-50%, -50%);
        width: ${CTRL_SIZE}px; height: ${CTRL_SIZE}px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; pointer-events: auto;
      }
      .ctrl svg { pointer-events: none; }
      .preview {
        position: fixed; transform: translate(-50%, -50%);
        border-radius: 10px; overflow: hidden; pointer-events: none;
        display: flex; flex-direction: column;
      }
      .preview img {
        width: 100%; object-fit: cover; object-position: top;
        display: none; pointer-events: none;
      }
      .label {
        padding: 6px 12px; text-align: center;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font: 12px/1.4 system-ui, sans-serif;
      }
      .mq { white-space: nowrap; }
      .label .mq, .loz.hi .title .mq { display: inline-block; }
      .loz .title .mq { display: inline; } /* inline so ellipsis still works unselected */
      @keyframes rad-marquee {
        0%, 12% { transform: translateX(0); }
        88%, 100% { transform: translateX(var(--mq-shift, 0)); }
      }
      .scroll { text-overflow: clip; }
      .scroll .mq {
        animation: rad-marquee var(--mq-dur, 6s) linear infinite alternate;
      }
      .filterq {
        padding: 0 10px 8px; text-align: center; display: none;
        font: 11px/1.3 monospace; opacity: 0.85;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .sorter {
        position: fixed; transform: translate(-50%, -50%);
        pointer-events: auto;
      }
      .sort {
        position: absolute; left: 50%; top: 50%;
        cursor: pointer; user-select: none; white-space: nowrap;
        font: 700 11px/1 system-ui, sans-serif;
        opacity: 0.45;
        transition: transform 160ms ease, opacity 160ms ease;
        will-change: transform;
      }
      .sort.on { opacity: 1; }
      .notch {
        position: fixed; transform: translate(-50%, -50%) rotate(45deg);
        width: 10px; height: 10px; pointer-events: none;
      }
    `;
  }

  const THEMES = {
    slate: `
      .loz, .ctrl {
        background: rgba(28, 30, 34, 0.95);
        border: 2px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
        color: #dedede;
      }
      .loz.active { border-color: rgba(120, 170, 255, 0.9); }
      .loz.hi, .ctrl:hover { border-color: #3fb950; }
      .badge { color: #cfcfcf; }
      .preview {
        background: rgba(20, 22, 25, 0.92); color: #e6e6e6;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
      }
      .sort { color: #9ca3af; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }
      .sort.on { color: #3fb950; }
      .notch { background: #3fb950; box-shadow: 0 0 6px rgba(63, 185, 80, 0.8); }
    `,
    quest: `
      .loz {
        background: linear-gradient(#f3e4bf, #e0ca96);
        border: 2px solid #7a5b2f; color: #3b2a12;
        box-shadow: 0 2px 6px rgba(40, 25, 5, 0.6), inset 0 0 6px rgba(122, 91, 47, 0.35);
      }
      .loz .title, .label, .sort { font-family: Georgia, 'Times New Roman', serif; }
      .loz.active { border-color: #2d6cdf; }
      .loz.hi, .ctrl:hover {
        border-color: #b8860b;
        box-shadow: 0 0 12px rgba(212, 175, 55, 0.85);
      }
      .ctrl {
        background: radial-gradient(#5b3d1e, #3c2812);
        border: 2px solid #8a6a3a; color: #e8d5a8;
        box-shadow: 0 2px 6px rgba(40, 25, 5, 0.6);
      }
      .badge { color: #6b4c1f; }
      .preview {
        background: linear-gradient(#f7ecd0, #ead9ac);
        border: 3px solid #7a5b2f; color: #3b2a12;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      }
      .sort { color: #e8d5a8; text-shadow: 0 1px 3px rgba(40, 25, 5, 0.9); }
      .sort.on {
        color: #d4af37;
        text-shadow: 0 1px 3px rgba(40, 25, 5, 0.9), 0 0 8px rgba(212, 175, 55, 0.6);
      }
      .notch { background: #d4af37; box-shadow: 0 0 6px rgba(212, 175, 55, 0.9); }
    `,
    holo: `
      .loz {
        background: rgba(4, 18, 28, 0.85); border-radius: 4px;
        border: 1px solid rgba(0, 229, 255, 0.55); color: #bdeeff;
        box-shadow: 0 0 8px rgba(0, 229, 255, 0.25), inset 0 0 8px rgba(0, 229, 255, 0.08);
      }
      .loz .title, .label, .sort {
        font-family: Consolas, 'DejaVu Sans Mono', monospace; letter-spacing: 0.5px;
      }
      .loz.active { border-color: #ff9df5; box-shadow: 0 0 10px rgba(255, 157, 245, 0.45); }
      .loz.hi, .ctrl:hover {
        border-color: #00e5ff;
        box-shadow: 0 0 14px rgba(0, 229, 255, 0.8), inset 0 0 10px rgba(0, 229, 255, 0.2);
      }
      .ctrl {
        background: rgba(4, 18, 28, 0.88); border-radius: 8px;
        border: 1px solid rgba(0, 229, 255, 0.55); color: #9fe8ff;
        box-shadow: 0 0 8px rgba(0, 229, 255, 0.25);
      }
      .badge { color: #7fdcff; }
      .preview {
        background: rgba(3, 14, 22, 0.92); border-radius: 6px;
        border: 1px solid rgba(0, 229, 255, 0.4); color: #bdeeff;
        box-shadow: 0 0 18px rgba(0, 229, 255, 0.3);
      }
      .sort { color: rgba(127, 220, 255, 0.8); text-shadow: 0 0 6px rgba(0, 229, 255, 0.35); }
      .sort.on { color: #00e5ff; text-shadow: 0 0 10px rgba(0, 229, 255, 0.9); }
      .notch { background: #00e5ff; box-shadow: 0 0 8px #00e5ff; }
    `,
    runestone: `
      .loz {
        background: linear-gradient(145deg, #8f8b83, #6e6a63); border-radius: 8px;
        border: 2px solid #4c4942; color: #26241f;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25),
                    inset 0 -2px 3px rgba(0, 0, 0, 0.35),
                    0 3px 6px rgba(0, 0, 0, 0.5);
      }
      .loz .title, .label, .sort {
        font-family: 'Trebuchet MS', Verdana, sans-serif;
        font-variant: small-caps; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
      }
      .loz.active { border-color: #5d7f9e; }
      .loz.hi, .ctrl:hover {
        border-color: #56713d;
        box-shadow: 0 0 12px rgba(111, 143, 79, 0.75);
      }
      .ctrl {
        background: radial-gradient(#7d7970, #57544d);
        border: 2px solid #45423c; color: #26241f;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 3px 6px rgba(0, 0, 0, 0.5);
      }
      .badge { color: #3a372f; }
      .preview {
        background: linear-gradient(#96928a, #767269); border-radius: 8px;
        border: 3px solid #4c4942; color: #26241f;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
      }
      .sort { color: #b5b0a5; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
      .sort.on { color: #a9c982; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7), 0 0 8px rgba(111, 143, 79, 0.5); }
      .notch { background: #6f8f4f; box-shadow: 0 0 6px rgba(111, 143, 79, 0.9); }
    `,
  };

  // Constructed stylesheets aren't subject to page CSP; fall back to <style>
  // tags (blocked only on strict style-src sites) if the constructor fails.
  function applyStyles(root, cssTexts) {
    try {
      root.adoptedStyleSheets = cssTexts.map((text) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        return sheet;
      });
    } catch {
      for (const text of cssTexts) {
        const el = document.createElement("style");
        el.textContent = text;
        root.appendChild(el);
      }
    }
  }

  // ---------- settings ----------

  const settings = {
    modifier: "ctrl",
    defaultMenu: "native", // native | radial — which one plain right-click opens
    theme: "slate",
    customCss: "",
    maxItems: 20,
    minRadius: 120,
    maxRadius: 260,
    itemScale: 1,
    fillMode: "equidistant", // equidistant | blanks | repeat
    sortMode: "tab", // tab | recent | alpha
    containerColors: true,
  };
  browser.storage.sync
    .get({
      modifier: settings.modifier,
      defaultMenu: settings.defaultMenu,
      theme: settings.theme,
      maxItems: settings.maxItems,
      minRadius: settings.minRadius,
      maxRadius: settings.maxRadius,
      itemScale: settings.itemScale,
      fillMode: settings.fillMode,
      sortMode: settings.sortMode,
      containerColors: settings.containerColors,
    })
    .then((s) => Object.assign(settings, s))
    .catch(() => {});
  browser.storage.local
    .get({ customCss: "" })
    .then((s) => Object.assign(settings, s))
    .catch(() => {});
  browser.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in settings) settings[key] = change.newValue;
    }
  });

  // ---------- outer controls ----------

  const CONTROLS = [
    {
      title: "Back", angle: Math.PI,
      msg: { type: "navBack" },
      paths: ["M15 18l-6-6 6-6"],
    },
    {
      title: "Forward", angle: 0,
      msg: { type: "navForward" },
      paths: ["M9 6l6 6-6 6"],
    },
    {
      title: "Home", angle: -Math.PI / 2,
      msg: { type: "goHome" },
      paths: ["M3 10.5L12 3l9 7.5", "M5 9.5V21h14V9.5"],
    },
    {
      title: "Reload", angle: Math.PI / 2,
      msg: { type: "reloadTab" },
      paths: ["M23 4v6h-6", "M20.49 15a9 9 0 1 1-2.12-9.36L23 10"],
    },
    {
      title: "New Tab", angle: (-3 * Math.PI) / 4,
      msg: { type: "newTab" },
      middleMsg: { type: "newTab", background: true },
      paths: ["M12 5v14", "M5 12h14"],
    },
    {
      title: "New Window", angle: -Math.PI / 4,
      msg: { type: "newWindow" },
      paths: ["M3 5h18v14H3z", "M3 9h18", "M12 12.5v4", "M10 14.5h4"],
    },
  ];

  const SORTS = [
    { id: "tab", label: "Tab" },
    { id: "recent", label: "Recent" },
    { id: "alpha", label: "A–Z" },
  ];

  const MODES = [
    { id: "history", label: "History" },
    { id: "sites", label: "Sites" },
    { id: "bookmarks", label: "Bookmarks" },
  ];

  function svgIcon(paths) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of paths) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    }
    return svg;
  }

  // ---------- state ----------

  let host = null; // outer <div> holding the closed shadow root
  let wrapRef = null; // single group element inside the shadow root — the
                       // pop in/out transform target and the parent for
                       // everything else
  let items = []; // ring slots: [{ el, tabId, title, active }]
  let ringTabs = []; // raw tab list for this open; re-sorted/filtered on demand
  let query = ""; // type-to-filter string
  let sel = 0; // slot currently under the 12 o'clock selector
  let hoverIdx = null; // hover overrides the displayed highlight
  let geom = null; // { cx, cy, rx, ry, K, fillMode, dims, step, windowed }
  let previewImg = null;
  let label = null;
  let filterEl = null;
  let sorterChips = []; // [{ id, el }]
  let sorterHovered = false; // mouse is over the sort switcher
  let modeChips = []; // [{ id, el }]
  let modeHovered = false; // mouse is over the mode switcher
  let ringMode = "sites"; // sites | history | bookmarks
  let modeData = null; // { sites, history, bookmarks } — lazy-fetched per open
  let previewToken = 0;
  let dismissing = false; // exit animation in flight; blocks re-entrant close()
  const previewLocal = new Map(); // tabId -> dataUrl, for this open only

  // ---------- lifecycle ----------

  function close() {
    if (!host || dismissing) return;
    dismissing = true;
    // Stop taking input immediately; the exit animation is purely visual.
    window.removeEventListener("wheel", onWheel, { capture: true });
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("blur", close);
    wrapRef.style.pointerEvents = "none";
    wrapRef.classList.remove("in");
    wrapRef.classList.add("out");

    const dyingHost = host;
    setTimeout(() => {
      dyingHost.remove();
      dismissing = false;
    }, POP_MS);

    host = null;
    wrapRef = null;
    items = [];
    ringTabs = [];
    query = "";
    sel = 0;
    hoverIdx = null;
    geom = null;
    previewImg = label = filterEl = null;
    sorterChips = [];
    sorterHovered = false;
    modeChips = [];
    modeHovered = false;
    ringMode = "sites";
    modeData = null;
    previewToken++;
    previewLocal.clear();
  }

  async function open(x, y) {
    let tabs;
    try {
      tabs = await browser.runtime.sendMessage({ type: "getTabs" });
    } catch {
      return; // background not ready / extension reloading
    }
    if (!tabs || !tabs.length || host || dismissing) return;

    const n = tabs.length;
    const K = clamp(Math.round(settings.maxItems) || 20, 3, 60);
    const mode = settings.fillMode;

    // Scaled lozenge dimensions.
    const s = clamp(Number(settings.itemScale) || 1, 0.5, 2);
    const dims = {
      lozH: Math.round(30 * s),
      lozMaxW: Math.round(150 * s),
      padL: Math.round(8 * s),
      padR: Math.round(12 * s),
      gap: Math.round(6 * s),
      fontPx: Math.max(9, Math.round(12 * s)),
      favPx: Math.max(10, Math.round(16 * s)),
    };
    const padX = dims.lozMaxW / 2 + 34; // control clearance past the widest lozenge
    const padY = dims.lozH + 34;

    // Radius from the unfiltered ring occupancy (kept fixed while open so
    // filtering doesn't make the ring jump around), clamped to the user's
    // range, then to the viewport.
    const ringSlots = mode === "equidistant" && n < K ? n : K;
    const minR = clamp(Number(settings.minRadius) || 120, 40, 1000);
    const maxR = Math.max(minR, clamp(Number(settings.maxRadius) || 260, 40, 1000));
    let ry = clamp(((ringSlots * (dims.lozH + 12)) / (2 * Math.PI)) * 1.2, minR, maxR);
    let rx = ry * 1.55;
    rx = Math.min(rx, window.innerWidth / 2 - padX - CTRL_SIZE / 2 - 8);
    ry = Math.min(ry, window.innerHeight / 2 - padY - CTRL_SIZE / 2 - 8);
    const marginX = rx + padX + CTRL_SIZE / 2 + 8;
    const marginY = ry + padY + CTRL_SIZE / 2 + 8;
    const cx = clamp(x, marginX, window.innerWidth - marginX);
    const cy = clamp(y, marginY, window.innerHeight - marginY);
    geom = { cx, cy, rx, ry, K, fillMode: mode, dims, step: 0, windowed: false };

    host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    const root = host.attachShadow({ mode: "closed" });
    applyStyles(root, [
      baseCss(dims),
      THEMES[settings.theme] || THEMES.slate,
      settings.customCss || "",
    ]);

    // Everything lives inside one wrapper so the pop in/out animation is a
    // single transform on this element, anchored at the cursor. Fixed-
    // position descendants become positioned relative to a transformed
    // ancestor's box (a CSS transforms rule), which is exactly what makes
    // the whole assembly scale together from that point; at rest the
    // wrapper carries no transform, so their coordinates read as ordinary
    // viewport-fixed px again.
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.style.transformOrigin = `${cx}px ${cy}px`;
    root.appendChild(wrap);
    wrapRef = wrap;

    // Fixed selector notch at 12 o'clock
    const notch = document.createElement("div");
    notch.className = "notch";
    notch.style.left = `${cx}px`;
    notch.style.top = `${cy - ry - dims.lozH / 2 - 10}px`;
    wrap.appendChild(notch);

    // Center cluster (sort chips + preview + mode chips) must fit inside
    // the ring: constrain the preview by the inner height as well as rx.
    const SWITCHER_H = 26;
    const innerH = 2 * (ry - dims.lozH / 2 - 10);
    const maxBoxH = innerH - 2 * SWITCHER_H - 8;
    const pvW = clamp(Math.min(rx * 0.9, (maxBoxH - 30) / 0.625), 90, 260);
    const pvH = Math.round(pvW * 0.625) + 30;

    // Center preview panel
    const previewBox = document.createElement("div");
    previewBox.className = "preview";
    previewBox.style.left = `${cx}px`;
    previewBox.style.top = `${cy}px`;
    previewBox.style.width = `${pvW}px`;
    previewImg = document.createElement("img");
    previewImg.decoding = "async"; // don't block a frame decoding screenshots
    previewImg.style.height = `${Math.round(pvW * 0.625)}px`;
    label = document.createElement("div");
    label.className = "label";
    filterEl = document.createElement("div");
    filterEl.className = "filterq";
    previewBox.appendChild(previewImg);
    previewBox.appendChild(label);
    previewBox.appendChild(filterEl);
    wrap.appendChild(previewBox);

    // Switcher dials: bare text labels on a little arc; the active one is
    // centered and the others slide along the arc when it "rotates".
    // Click a label, or wheel while hovering, to spin. Sort above the
    // preview, ring mode below it. The strip is an invisible hover area.
    const makeSwitcher = (y, defs, onPick, onHover) => {
      const strip = document.createElement("div");
      strip.className = "sorter";
      strip.style.left = `${cx}px`;
      strip.style.top = `${y}px`;
      strip.style.width = "200px";
      strip.style.height = `${SWITCHER_H}px`;
      strip.addEventListener("mouseenter", () => onHover(true));
      strip.addEventListener("mouseleave", () => onHover(false));
      const chips = defs.map((d) => {
        const el = document.createElement("div");
        el.className = "sort";
        el.textContent = d.label;
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onPick(d.id);
        });
        strip.appendChild(el);
        return { id: d.id, el };
      });
      wrap.appendChild(strip);
      return chips;
    };
    sorterChips = makeSwitcher(cy - pvH / 2 - SWITCHER_H / 2 - 2, SORTS, setSort, (h) => (sorterHovered = h));
    modeChips = makeSwitcher(cy + pvH / 2 + SWITCHER_H / 2 + 2, MODES, setMode, (h) => (modeHovered = h));
    layoutSorter();
    layoutModer();

    // Compass controls outside the ring
    for (const ctrl of CONTROLS) {
      const el = document.createElement("div");
      el.className = "ctrl";
      el.style.left = `${cx + (rx + padX) * Math.cos(ctrl.angle)}px`;
      el.style.top = `${cy + (ry + padY) * Math.sin(ctrl.angle)}px`;
      el.appendChild(svgIcon(ctrl.paths));

      el.addEventListener("mouseenter", () => {
        previewToken++; // cancel any pending tab preview
        previewImg.style.display = "none";
        setLabel(ctrl.title);
      });
      el.addEventListener("mouseleave", () => updateHighlight());
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        send(ctrl.msg);
        close();
      });
      el.addEventListener("auxclick", (e) => {
        if (e.button !== 1 || !ctrl.middleMsg) return;
        e.preventDefault();
        e.stopPropagation();
        send(ctrl.middleMsg);
        pulse(el); // stay open, matching middle-click on lozenges
      });

      wrap.appendChild(el);
    }

    document.documentElement.appendChild(host);

    modeData = { sites: tabs, history: null, bookmarks: null };
    ringTabs = tabs;
    buildRing("active");

    // Pop in: kick the entrance transition on the next frame so the
    // browser has painted the "before" state first.
    requestAnimationFrame(() => wrap.classList.add("in"));

    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("blur", close);
  }

  // ---------- ring building (sort + filter aware) ----------

  function sortRing(tabs) {
    if (settings.sortMode === "recent") {
      return tabs.slice().sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    }
    if (settings.sortMode === "alpha") {
      return tabs
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    }
    return tabs; // tab-bar order
  }

  // selPolicy: "active" = slot after the active tab under the selector,
  // "zero" = first slot (used while filtering), "keep" = stay in place.
  function buildRing(selPolicy) {
    for (const it of items) it.el.remove();
    items = [];
    hoverIdx = null;

    const q = query.trim().toLowerCase();
    const filtered = q
      ? ringTabs.filter((t) => t.title.toLowerCase().includes(q))
      : ringTabs;
    const sorted = sortRing(filtered);
    const n = sorted.length;

    filterEl.textContent = query ? `⌕ ${query}` : "";
    filterEl.style.display = query ? "block" : "none";

    const slotTabs =
      geom.fillMode === "repeat" && n > 0 && n < geom.K
        ? Array.from({ length: geom.K }, (_, j) => sorted[j % n])
        : sorted;
    const m = slotTabs.length;
    geom.windowed = m > geom.K;
    const ringSlots = geom.windowed || geom.fillMode === "blanks" ? geom.K : m;
    geom.step = m ? (2 * Math.PI) / ringSlots : 0;

    const isSites = ringMode === "sites";
    slotTabs.forEach((tab, i) => {
      const el = document.createElement("div");
      el.className = tab.active ? "loz active" : "loz";
      el.style.transition = "none"; // positioned first, animated after
      if (isSites && settings.containerColors && tab.containerColor) {
        el.style.borderLeft = `4px solid ${tab.containerColor}`;
      }

      el.appendChild(makeIcon(tab));
      const text = document.createElement("span");
      text.className = "title";
      const mq = document.createElement("span");
      mq.className = "mq";
      mq.textContent = tab.title;
      text.appendChild(mq);
      el.appendChild(text);

      el.addEventListener("mouseenter", () => {
        hoverIdx = i;
        updateHighlight();
      });
      el.addEventListener("mouseleave", () => {
        if (hoverIdx === i) hoverIdx = null;
        updateHighlight();
      });
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateItem({ tabId: tab.id, url: tab.url });
      });
      el.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        // Tabs duplicate; history/bookmarks open in a background tab.
        send(
          isSites
            ? { type: "duplicateTab", tabId: tab.id }
            : { type: "newTab", background: true, url: tab.url }
        );
        pulse(el); // stay open so more items can be middle-clicked
      });

      wrapRef.appendChild(el);
      items.push({
        el,
        titleEl: text,
        mqEl: mq,
        tabId: tab.id,
        title: tab.title,
        active: tab.active,
        url: tab.url,
      });
    });

    if (selPolicy === "keep") {
      sel = m ? Math.min(sel, m - 1) : 0;
    } else if (selPolicy === "zero" || m === 0) {
      sel = 0;
    } else {
      const activeIdx = slotTabs.findIndex((t) => t.active);
      sel = activeIdx >= 0 ? (activeIdx + 1) % m : 0;
    }

    updateHighlight(); // place without animation first…
    requestAnimationFrame(() => {
      for (const it of items) it.el.style.transition = "";
    }); // …then let the base CSS transition animate rotation
  }

  function setSort(id) {
    if (settings.sortMode === id) return;
    settings.sortMode = id;
    browser.storage.sync.set({ sortMode: id }).catch(() => {});
    layoutSorter();
    buildRing(query ? "zero" : "active");
  }

  // Lay a dial's labels along a shallow arc. `bow` is -1 for the top dial
  // (arc bows upward) and +1 for the bottom one; the active label sits at
  // the arc's apex and the rest wrap around, sliding when the dial spins.
  function layoutChips(chips, activeId, bow) {
    const activeI = Math.max(0, chips.findIndex((c) => c.id === activeId));
    chips.forEach((chip, i) => {
      const d = ((i - activeI + chips.length + 1) % chips.length) - 1; // -1 | 0 | +1
      const x = d * 58;
      const y = d === 0 ? 0 : -bow * 5; // sides tuck toward the preview
      const rot = -bow * d * 12; // tilt along the arc's tangent
      chip.el.style.transform =
        `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) ` +
        `scale(${d === 0 ? 1 : 0.7})`;
      chip.el.classList.toggle("on", d === 0);
      chip.el.style.zIndex = d === 0 ? "1" : "0";
    });
  }

  function layoutSorter() {
    layoutChips(sorterChips, settings.sortMode, -1);
  }

  function layoutModer() {
    layoutChips(modeChips, ringMode, 1);
  }

  // Switch the ring between open tabs, history, and bookmarks. History and
  // bookmarks are fetched once per menu open, on first use.
  async function setMode(id) {
    if (ringMode === id || !host) return;
    ringMode = id;
    layoutModer();
    if (!modeData[id]) {
      setLabel("Loading…");
      let data = [];
      try {
        data = await browser.runtime.sendMessage({
          type: id === "bookmarks" ? "getBookmarks" : "getHistory",
        });
      } catch {
        data = [];
      }
      if (!host) return;
      modeData[id] = data || [];
      if (ringMode !== id) return; // user already moved on
    }
    ringTabs = modeData[id];
    buildRing(id === "sites" ? "active" : "zero");
  }

  function send(msg) {
    browser.runtime.sendMessage(msg).catch(() => {});
  }

  const trimUrl = (u) => (u || "").replace(/^https?:\/\//i, "");

  // Put text in the center label; with marquee=true it scrolls back and
  // forth when it overflows instead of truncating.
  function setLabel(text, marquee = false) {
    if (!label) return;
    label.classList.remove("scroll");
    label.textContent = "";
    const span = document.createElement("span");
    span.className = "mq";
    span.textContent = text;
    label.appendChild(span);
    if (!marquee) return;
    requestAnimationFrame(() => {
      if (!label || label.firstChild !== span) return; // superseded
      const over = span.scrollWidth - (label.clientWidth - 24); // minus padding
      if (over > 4) {
        label.style.setProperty("--mq-shift", `-${over}px`);
        label.style.setProperty("--mq-dur", `${Math.max(4, over / 25)}s`);
        label.classList.add("scroll");
      }
    });
  }

  // Marquee the highlighted lozenge's title when it's truncated.
  function startTitleMarquee(item) {
    const t = item.titleEl;
    t.classList.remove("scroll");
    requestAnimationFrame(() => {
      if (!host || !t.isConnected || !t.closest(".hi")) return; // superseded
      const over = item.mqEl.scrollWidth - t.clientWidth;
      if (over > 4) {
        t.style.setProperty("--mq-shift", `-${over}px`);
        t.style.setProperty("--mq-dur", `${Math.max(3, over / 25)}s`);
        t.classList.add("scroll");
      }
    });
  }

  // Primary action: switch to the tab (Sites) or open the URL in this tab
  // (History / Bookmarks), then dismiss the menu.
  function activateItem(item) {
    if (ringMode === "sites") {
      send({ type: "activateTab", tabId: item.tabId });
    } else {
      send({ type: "openHere", url: item.url });
    }
    close();
  }

  function pulse(el) {
    el.classList.remove("pulse");
    void el.offsetWidth; // restart the animation if already running
    el.classList.add("pulse");
    el.addEventListener("animationend", () => el.classList.remove("pulse"), { once: true });
  }

  function makeIcon(tab) {
    const letterBadge = () => {
      const d = document.createElement("div");
      d.className = "badge";
      d.textContent = (tab.title[0] || "?").toUpperCase();
      return d;
    };
    if (!tab.favIconUrl || tab.favIconUrl.startsWith("chrome://")) {
      return letterBadge();
    }
    const img = document.createElement("img");
    img.className = "fav";
    img.src = tab.favIconUrl;
    img.addEventListener("error", () => img.replaceWith(letterBadge()));
    return img;
  }

  // ---------- layout & highlight ----------

  // Position and scale live in one transform so rotation and the highlight
  // grow both animate on the compositor thread — no layout work per frame.
  function layout() {
    const m = items.length;
    if (!m) return;
    const idx = hoverIdx ?? sel;
    const half = Math.floor(m / 2);
    // Visible window when the ring overflows: K slots centered on sel.
    const lo = Math.floor(geom.K / 2);
    const hi = Math.ceil(geom.K / 2) - 1;
    items.forEach((it, i) => {
      // Slot distance from the selector; when windowed, normalize into
      // [-m/2, m/2) so the ring wraps around continuously.
      let d = i - sel;
      if (geom.windowed) {
        d = ((d % m) + m + half) % m - half;
        it.el.style.visibility = d >= -lo && d <= hi ? "visible" : "hidden";
      }
      // Selected slot sits at -90° (12 o'clock); the ring revolves as sel changes.
      const angle = -Math.PI / 2 + geom.step * d;
      const px = geom.cx + geom.rx * Math.cos(angle);
      const py = geom.cy + geom.ry * Math.sin(angle);
      const scale = i === idx ? HI_SCALE : 1;
      it.el.style.transform =
        `translate(${px}px, ${py}px) translate(-50%, -50%) scale(${scale})`;
    });
  }

  function updateHighlight() {
    layout();
    if (!items.length) {
      previewToken++;
      previewImg.style.display = "none";
      setLabel(query ? "No matches" : "Nothing here");
      return;
    }
    if (sel >= items.length) sel = 0;
    const idx = Math.min(hoverIdx ?? sel, items.length - 1);
    items.forEach((it, i) => {
      const on = i === idx;
      it.el.classList.toggle("hi", on);
      if (!on) it.titleEl.classList.remove("scroll");
    });
    const item = items[idx];
    startTitleMarquee(item);
    if (ringMode === "sites") {
      setLabel(item.title);
      loadPreview(item);
    } else {
      // No live page to capture — show the address instead, scheme trimmed.
      setLabel(trimUrl(item.url), true);
      previewToken++;
      previewImg.style.display = "none";
    }
  }

  function loadPreview(item) {
    const token = ++previewToken;
    previewImg.style.display = "none";

    const cached = previewLocal.get(item.tabId);
    if (cached) {
      previewImg.src = cached;
      previewImg.style.display = "block";
      return;
    }
    // Small debounce so wheeling through the ring doesn't spam captures.
    setTimeout(async () => {
      if (token !== previewToken || !host) return;
      let dataUrl = null;
      try {
        dataUrl = await browser.runtime.sendMessage({
          type: "getPreview",
          tabId: item.tabId,
        });
      } catch {
        return;
      }
      if (!dataUrl || token !== previewToken || !host) return;
      previewLocal.set(item.tabId, dataUrl);
      previewImg.src = dataUrl;
      previewImg.style.display = "block";
    }, 120);
  }

  // ---------- interaction ----------

  function rotate(dir) {
    if (!items.length) return;
    sel = (sel + dir + items.length) % items.length;
    hoverIdx = null; // wheel/keys take over from hover
    updateHighlight();
  }

  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    const dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
    // Wheeling over the sort switcher spins it instead of the ring.
    // (Can't use composedPath here: the closed shadow root retargets the
    // path to the host, so we track hover state on the switcher directly.)
    if (sorterHovered) {
      const activeI = Math.max(0, SORTS.findIndex((s) => s.id === settings.sortMode));
      setSort(SORTS[(activeI + dir + SORTS.length) % SORTS.length].id);
      return;
    }
    if (modeHovered) {
      const activeI = Math.max(0, MODES.findIndex((m) => m.id === ringMode));
      setMode(MODES[(activeI + dir + MODES.length) % MODES.length].id);
      return;
    }
    rotate(dir);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        query = "";
        buildRing("active");
      } else {
        close();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const item = items[Math.min(hoverIdx ?? sel, items.length - 1)];
      if (!item) return;
      activateItem(item);
    } else if (e.key === "Delete") {
      e.preventDefault();
      e.stopPropagation();
      const item = items[Math.min(hoverIdx ?? sel, items.length - 1)];
      // Tabs only; closing the active tab would tear down this page (and
      // the menu with it), so leave that one alone too.
      if (ringMode !== "sites" || !item || item.active) return;
      send({ type: "closeTab", tabId: item.tabId });
      previewLocal.delete(item.tabId);
      ringTabs = ringTabs.filter((t) => t.id !== item.tabId);
      buildRing("keep");
    } else if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        query = query.slice(0, -1);
        buildRing(query ? "zero" : "active");
      }
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      rotate(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      rotate(-1);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type to filter: narrow the ring to matching titles.
      e.preventDefault();
      e.stopPropagation();
      query += e.key;
      buildRing("zero");
    }
  }

  function onMouseDown(e) {
    if (e.button === 2) return; // handled by the contextmenu listener
    if (host && e.composedPath().includes(host)) {
      if (e.button === 1) e.preventDefault(); // stop middle-click autoscroll
      return;
    }
    close();
  }

  // ---------- trigger ----------

  function keyMatchesModifier(e, mod) {
    switch (mod) {
      case "ctrl":
        return e.ctrlKey && !e.altKey && !e.metaKey;
      case "alt":
        return e.altKey && !e.ctrlKey && !e.metaKey;
      case "meta":
        return e.metaKey && !e.ctrlKey && !e.altKey;
      case "none":
        return !e.ctrlKey && !e.altKey && !e.metaKey;
      default:
        return false;
    }
  }

  const modifierMatches = (e) => keyMatchesModifier(e, settings.modifier);

  // Links carry native-menu actions worth protecting (copy link, open in
  // new tab, etc.), so the radial only opens there with the modifier held —
  // regardless of the default-menu setting. composedPath already lists
  // ancestors, so no manual DOM walk is needed.
  function isLinkTarget(e) {
    return e.composedPath().some((el) => el instanceof HTMLAnchorElement && el.href);
  }

  let lastCtx = null; // last right-click spot, for the native-menu fallback item

  window.addEventListener(
    "contextmenu",
    (e) => {
      lastCtx = { x: e.clientX, y: e.clientY };
      if (host) {
        // Second right-click: drop our menu and let the native one through.
        close();
        return;
      }
      if (e.shiftKey) return; // native menu, always

      let openRadial;
      if (isLinkTarget(e)) {
        // "none" has no real key to hold, so fall back to Ctrl here — a
        // link always needs *some* keypress to reach the radial menu.
        const guardMod = settings.modifier === "none" ? "ctrl" : settings.modifier;
        openRadial = keyMatchesModifier(e, guardMod);
      } else {
        const mod = modifierMatches(e);
        openRadial = settings.defaultMenu === "radial" ? !mod : mod;
      }
      if (!openRadial) return; // native menu

      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY);
    },
    true
  );

  // "Open Radial Tab Menu" item in the native context menu, and the
  // toolbar button — both bypass the default/modifier/link logic above
  // since they're an explicit ask to open the radial menu.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "openRadiator" && !host) {
      const x = lastCtx ? lastCtx.x : window.innerWidth / 2;
      const y = lastCtx ? lastCtx.y : window.innerHeight / 2;
      open(x, y);
    }
  });
})();
