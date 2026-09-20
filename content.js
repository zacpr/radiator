"use strict";

/*
 * Radiator content script.
 *
 * Either the native context menu or the radial ring can be the default on
 * plain right-click (Options → Default menu); the configured modifier key
 * always opens whichever one *isn't* the default. On protected targets —
 * links, editable fields, selected text and media, each toggleable — plain
 * right-click always goes native regardless of the default, because the
 * native menu has items the ring can't reproduce (Copy Link, Save Image As,
 * spellcheck, Paste); the modifier still reaches the ring there.
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
 * be queued up. Orbit buttons sit outside the ring on eight compass
 * positions, each assigned an action from the catalog in actions.js via
 * Options (defaults: New Tab NW, Home N, New Window NE, Back W, Forward E,
 * Reload S).
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
        transition: transform 130ms cubic-bezier(0.34, 1.56, 0.64, 1),
                    opacity 130ms ease;
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
        transition: transform 130ms cubic-bezier(0.34, 1.56, 0.64, 1);
        /* 'backwards' holds the from-state through the stagger delay, so a
           button is invisible until its turn rather than flashing first. */
        animation: rad-ctrl-in 240ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
      }
      .ctrl:hover { transform: translate(-50%, -50%) scale(1.12); }
      @keyframes rad-ctrl-in {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
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
      .link-card {
        display: flex; flex-direction: column; justify-content: space-between;
        width: 100%; height: 100%; padding: 8px 10px; pointer-events: auto;
        user-select: none; box-sizing: border-box;
      }
      .link-header {
        display: flex; flex-direction: column; gap: 2px; text-align: center;
        overflow: hidden;
      }
      .link-title {
        font-weight: 700; font-size: 12px; line-height: 1.25;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        opacity: 0.95;
      }
      .link-url-text {
        font-size: 10px; opacity: 0.7; font-family: monospace;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .link-actions-grid {
        display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px;
        margin-top: 6px; padding-top: 6px;
        border-top: 1px solid rgba(128, 128, 128, 0.25);
      }
      .link-btn {
        display: flex; align-items: center; justify-content: center;
        height: 28px; border-radius: 6px; border: 1px solid currentColor;
        opacity: 0.8; background: rgba(128, 128, 128, 0.12); color: inherit;
        cursor: pointer; position: relative; transition: all 120ms ease;
        padding: 0; outline: none;
      }
      .link-btn:hover {
        opacity: 1; background: rgba(128, 128, 128, 0.3); transform: translateY(-1px);
      }
      .link-btn:active { transform: translateY(0); }
      .link-btn svg { width: 14px; height: 14px; pointer-events: none; }
      .link-btn[data-tooltip]::after {
        content: attr(data-tooltip);
        position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
        margin-bottom: 6px; padding: 4px 8px; border-radius: 4px;
        background: rgba(15, 17, 21, 0.95); color: #fff; font-size: 10px; font-weight: 500;
        line-height: 1; white-space: nowrap; pointer-events: none; opacity: 0;
        transition: opacity 120ms ease; z-index: 100;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }
      .link-btn[data-tooltip]:hover::after { opacity: 1; }
      .sorter {
        position: fixed; transform: translate(-50%, -50%);
        pointer-events: auto; z-index: 10;
      }
      .sort {
        position: absolute; left: 50%; top: 50%;
        cursor: pointer; user-select: none; white-space: nowrap;
        font: 700 13px/1 system-ui, sans-serif;
        padding: 5px 12px; border-radius: 999px;
        opacity: 0.75;
        transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 160ms ease, background 160ms ease, box-shadow 160ms ease;
        will-change: transform;
      }
      .sort.on { opacity: 1; }
      .notch {
        position: fixed; transform: translate(-50%, -50%) rotate(45deg);
        width: 10px; height: 10px; pointer-events: none;
        animation: rad-notch-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) 110ms backwards;
      }
      @keyframes rad-notch-in {
        from { opacity: 0; transform: translate(-50%, -50%) rotate(45deg) scale(0.2); }
      }
      /* Respect the OS "reduce motion" setting: everything still appears in
         the same place, just without the travel. */
      @media (prefers-reduced-motion: reduce) {
        .wrap, .wrap.out, .loz, .ctrl, .sort {
          transition-duration: 1ms !important;
          transition-delay: 0ms !important;
        }
        .ctrl, .notch { animation: none; }
        .scroll .mq { animation: none; }
      }
    `;
  }

  const THEMES = {
    slate: `
      .loz, .ctrl {
        background: rgba(28, 30, 34, 0.95);
        border: 2px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        color: #dedede;
      }
      .loz.active { border-color: rgba(120, 170, 255, 0.9); }
      .loz.hi, .ctrl:hover { border-color: #3fb950; box-shadow: 0 0 14px rgba(63, 185, 80, 0.6); }
      .badge { color: #cfcfcf; }
      .preview {
        background: rgba(20, 22, 25, 0.95); color: #e6e6e6;
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
      }
      .sort { color: #b0b7c3; background: rgba(20, 22, 26, 0.65); border: 1px solid rgba(255, 255, 255, 0.12); }
      .sort.on { color: #3fb950; background: rgba(28, 42, 32, 0.95); border-color: #3fb950; box-shadow: 0 0 10px rgba(63, 185, 80, 0.4); }
      .notch { background: #3fb950; box-shadow: 0 0 8px rgba(63, 185, 80, 0.9); }
    `,
    quest: `
      .loz {
        background: linear-gradient(#f3e4bf, #e0ca96);
        border: 2px solid #7a5b2f; color: #3b2a12;
        box-shadow: 0 3px 8px rgba(40, 25, 5, 0.6), inset 0 0 6px rgba(122, 91, 47, 0.35);
      }
      .loz .title, .label, .sort { font-family: Georgia, 'Times New Roman', serif; }
      .loz.active { border-color: #2d6cdf; }
      .loz.hi, .ctrl:hover {
        border-color: #b8860b;
        box-shadow: 0 0 14px rgba(212, 175, 55, 0.9);
      }
      .ctrl {
        background: radial-gradient(#5b3d1e, #3c2812);
        border: 2px solid #8a6a3a; color: #e8d5a8;
        box-shadow: 0 3px 8px rgba(40, 25, 5, 0.6);
      }
      .badge { color: #6b4c1f; }
      .preview {
        background: linear-gradient(#f7ecd0, #ead9ac);
        border: 3px solid #7a5b2f; color: #3b2a12;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
      }
      .sort { color: #5a411d; background: rgba(235, 218, 178, 0.85); border: 1px solid rgba(122, 91, 47, 0.45); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6); }
      .sort.on {
        color: #2c1a04; background: linear-gradient(#f7ecd0, #d4af37);
        border-color: #b8860b; box-shadow: 0 0 12px rgba(212, 175, 55, 0.7);
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      .notch { background: #d4af37; box-shadow: 0 0 8px rgba(212, 175, 55, 0.9); }
    `,
    holo: `
      .loz {
        background: rgba(4, 18, 28, 0.88); border-radius: 4px;
        border: 1px solid rgba(0, 229, 255, 0.55); color: #bdeeff;
        box-shadow: 0 0 10px rgba(0, 229, 255, 0.3), inset 0 0 8px rgba(0, 229, 255, 0.1);
      }
      .loz .title, .label, .sort {
        font-family: Consolas, 'DejaVu Sans Mono', monospace; letter-spacing: 0.5px;
      }
      .loz.active { border-color: #ff9df5; box-shadow: 0 0 12px rgba(255, 157, 245, 0.5); }
      .loz.hi, .ctrl:hover {
        border-color: #00e5ff;
        box-shadow: 0 0 16px rgba(0, 229, 255, 0.85), inset 0 0 10px rgba(0, 229, 255, 0.25);
      }
      .ctrl {
        background: rgba(4, 18, 28, 0.9); border-radius: 8px;
        border: 1px solid rgba(0, 229, 255, 0.55); color: #9fe8ff;
        box-shadow: 0 0 10px rgba(0, 229, 255, 0.3);
      }
      .badge { color: #7fdcff; }
      .preview {
        background: rgba(3, 14, 22, 0.95); border-radius: 6px;
        border: 1px solid rgba(0, 229, 255, 0.45); color: #bdeeff;
        box-shadow: 0 0 22px rgba(0, 229, 255, 0.35);
      }
      .sort { color: #7fdcff; background: rgba(4, 18, 28, 0.75); border: 1px solid rgba(0, 229, 255, 0.35); text-shadow: 0 0 4px rgba(0, 229, 255, 0.4); }
      .sort.on { color: #00e5ff; background: rgba(4, 28, 45, 0.95); border-color: #00e5ff; box-shadow: 0 0 14px rgba(0, 229, 255, 0.8); text-shadow: 0 0 8px #00e5ff; }
      .notch { background: #00e5ff; box-shadow: 0 0 10px #00e5ff; }
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
      .sort { color: #3a372f; background: rgba(143, 139, 131, 0.7); border: 1px solid #4c4942; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4); }
      .sort.on { color: #e4f0d5; background: linear-gradient(#7d7970, #56713d); border-color: #6f8f4f; box-shadow: 0 0 10px rgba(111, 143, 79, 0.6); }
      .notch { background: #6f8f4f; box-shadow: 0 0 6px rgba(111, 143, 79, 0.9); }
    `,
    aether: `
      .loz, .ctrl {
        background: rgba(255, 255, 255, 0.14);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.28); color: #ffffff;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
      .loz .title, .label, .sort { font-family: Inter, system-ui, -apple-system, sans-serif; font-weight: 600; }
      .loz.active { border-color: rgba(147, 197, 253, 0.9); box-shadow: 0 0 16px rgba(147, 197, 253, 0.6); }
      .loz.hi, .ctrl:hover {
        border-color: #a7f3d0;
        box-shadow: 0 0 20px rgba(167, 243, 208, 0.85), inset 0 0 10px rgba(255, 255, 255, 0.25);
      }
      .badge { color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
      .preview {
        background: rgba(255, 255, 255, 0.18);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.35); color: #ffffff;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
      }
      .sort { color: #f1f5f9; background: rgba(255, 255, 255, 0.18); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.3); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
      .sort.on { color: #0f172a; background: #ffffff; border-color: #ffffff; box-shadow: 0 0 16px rgba(255, 255, 255, 0.9); text-shadow: none; }
      .notch { background: #ffffff; box-shadow: 0 0 12px rgba(255, 255, 255, 0.95); }
    `,
    synthwave: `
      .loz {
        background: linear-gradient(135deg, rgba(42, 10, 56, 0.92), rgba(15, 8, 38, 0.95));
        border: 1.5px solid #ff007f; color: #ffe5f3;
        box-shadow: 0 0 12px rgba(255, 0, 127, 0.4), inset 0 0 10px rgba(255, 0, 127, 0.15);
      }
      .loz .title, .label, .sort { font-family: 'Segoe UI', Impact, sans-serif; letter-spacing: 0.6px; }
      .loz.active { border-color: #00f3ff; box-shadow: 0 0 14px rgba(0, 243, 255, 0.6); }
      .loz.hi, .ctrl:hover {
        border-color: #ffbe0b;
        box-shadow: 0 0 20px rgba(255, 190, 11, 0.9), inset 0 0 12px rgba(255, 190, 11, 0.3);
      }
      .ctrl {
        background: radial-gradient(rgba(255, 0, 127, 0.3), rgba(20, 5, 30, 0.95));
        border: 1.5px solid #00f3ff; color: #00f3ff;
        box-shadow: 0 0 14px rgba(0, 243, 255, 0.5);
      }
      .badge { color: #ff007f; text-shadow: 0 0 8px #ff007f; }
      .preview {
        background: linear-gradient(180deg, rgba(35, 12, 51, 0.96), rgba(15, 6, 28, 0.98));
        border: 2px solid #ff007f; color: #ffe5f3;
        box-shadow: 0 0 26px rgba(255, 0, 127, 0.5);
      }
      .sort { color: #ff99dd; background: rgba(35, 12, 51, 0.85); border: 1px solid rgba(255, 0, 127, 0.4); text-shadow: 0 0 6px rgba(255, 0, 127, 0.5); }
      .sort.on { color: #120320; background: linear-gradient(90deg, #ff007f, #00f3ff); border-color: #00f3ff; box-shadow: 0 0 16px rgba(0, 243, 255, 0.8); text-shadow: none; }
      .notch { background: #ff007f; box-shadow: 0 0 14px #ff007f, 0 0 24px #00f3ff; }
    `,
    cyberhud: `
      .loz {
        background: rgba(8, 20, 16, 0.92); border-radius: 2px;
        border: 1px solid #00ffaa; color: #a6ffe2;
        box-shadow: 0 0 10px rgba(0, 255, 170, 0.3), inset 0 0 8px rgba(0, 255, 170, 0.1);
      }
      .loz .title, .label, .sort { font-family: 'Courier New', monospace; font-weight: 700; text-transform: uppercase; }
      .loz.active { border-color: #ffee00; color: #ffffaa; box-shadow: 0 0 14px rgba(255, 238, 0, 0.6); }
      .loz.hi, .ctrl:hover {
        border-color: #00ffaa;
        box-shadow: 0 0 18px rgba(0, 255, 170, 0.9), inset 0 0 12px rgba(0, 255, 170, 0.3);
      }
      .ctrl {
        background: rgba(8, 20, 16, 0.95); border-radius: 4px;
        border: 1.5px solid #00ffaa; color: #00ffaa;
        box-shadow: 0 0 12px rgba(0, 255, 170, 0.4);
      }
      .badge { color: #00ffaa; text-shadow: 0 0 6px #00ffaa; }
      .preview {
        background: rgba(5, 15, 12, 0.96); border-radius: 2px;
        border: 1px solid #00ffaa; color: #a6ffe2;
        box-shadow: 0 0 24px rgba(0, 255, 170, 0.4);
      }
      .sort { color: #00ffaa; background: rgba(5, 15, 12, 0.85); border: 1px solid rgba(0, 255, 170, 0.35); text-shadow: 0 0 4px rgba(0, 255, 170, 0.5); }
      .sort.on { color: #050f0c; background: #00ffaa; border-color: #00ffaa; box-shadow: 0 0 16px rgba(0, 255, 170, 0.9); text-shadow: none; }
      .notch { background: #ffee00; box-shadow: 0 0 12px #ffee00; }
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
    // Targets that keep the native menu on plain right-click whatever the
    // default is, because the native menu has items the radial can't offer.
    nativeOn: { links: true, editable: true, selection: true, media: true },
    orbit: DEFAULT_ORBIT,
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
      nativeOn: settings.nativeOn,
      orbit: settings.orbit,
      theme: settings.theme,
      maxItems: settings.maxItems,
      minRadius: settings.minRadius,
      maxRadius: settings.maxRadius,
      itemScale: settings.itemScale,
      fillMode: settings.fillMode,
      sortMode: settings.sortMode,
      containerColors: settings.containerColors,
    })
    .then((s) => {
      Object.assign(settings, s);
      // The old "no modifier" choice is now the Default menu setting. Left
      // as-is it would defeat the protected-target guard, since "no keys
      // held" would count as holding the modifier, so retire it to Ctrl.
      if (settings.modifier === "none") settings.modifier = "ctrl";
      // A partial object from an older version would leave new keys
      // undefined, which reads as "off"; fill the gaps in.
      settings.nativeOn = { links: true, editable: true, selection: true, media: true, ...settings.nativeOn };
      settings.orbit = { ...DEFAULT_ORBIT, ...settings.orbit };
    })
    .catch(() => {});
  browser.storage.local
    .get({ customCss: "", customThemes: {} })
    .then((s) => Object.assign(settings, s))
    .catch(() => {});
  browser.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in settings) settings[key] = change.newValue;
    }
  });

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
  let currentLinkInfo = null; // { url, text, targetEl } if opened on a link
  let linkCardBox = null;
  let linkCardTitle = null;
  let linkCardSub = null;

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
    currentLinkInfo = null;
    linkCardBox = null;
    linkCardTitle = null;
    linkCardSub = null;
  }

  async function open(x, y, linkInfo = null) {
    currentLinkInfo = linkInfo;
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
    const customThemeCss = (settings.customThemes && settings.customThemes[settings.theme])
      ? settings.customThemes[settings.theme].css
      : "";
    const activeThemeCss = THEMES[settings.theme] || customThemeCss || THEMES.slate;
    applyStyles(root, [
      baseCss(dims),
      activeThemeCss,
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

    // Link card overlay (rendered if activated over a link)
    if (currentLinkInfo) {
      previewBox.style.pointerEvents = "auto";
      linkCardBox = document.createElement("div");
      linkCardBox.className = "link-card";

      const header = document.createElement("div");
      header.className = "link-header";

      linkCardTitle = document.createElement("div");
      linkCardTitle.className = "link-title";
      linkCardTitle.textContent = currentLinkInfo.text || currentLinkInfo.url;

      linkCardSub = document.createElement("div");
      linkCardSub.className = "link-url-text";
      linkCardSub.textContent = trimUrl(currentLinkInfo.url);

      header.appendChild(linkCardTitle);
      header.appendChild(linkCardSub);

      const actionsGrid = document.createElement("div");
      actionsGrid.className = "link-actions-grid";

      const linkButtons = [
        {
          id: "open",
          title: "Open",
          paths: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6", "M10 14L21 3"],
          run: () => { send({ type: "openHere", url: currentLinkInfo.url }); close(); }
        },
        {
          id: "newTab",
          title: "Open in New Tab",
          paths: ["M12 5v14", "M5 12h14"],
          run: () => { send({ type: "newTab", url: currentLinkInfo.url, background: false }); close(); }
        },
        {
          id: "newWindow",
          title: "Open in New Window",
          paths: ["M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M2 9h20"],
          run: () => { send({ type: "newWindow", url: currentLinkInfo.url }); close(); }
        },
        {
          id: "download",
          title: "Download Link",
          paths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
          run: () => { send({ type: "downloadLink", url: currentLinkInfo.url }); close(); }
        },
        {
          id: "search",
          title: "Search URL",
          paths: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"],
          run: () => { send({ type: "searchUrl", url: currentLinkInfo.url }); close(); }
        },
        {
          id: "nativeMenu",
          title: "Open Normal Context Menu",
          paths: ["M4 6h16", "M4 12h16", "M4 18h16"],
          run: () => {
            const target = currentLinkInfo ? currentLinkInfo.targetEl : null;
            close();
            if (target) {
              setTimeout(() => {
                const rect = target.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                target.dispatchEvent(new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: cx,
                  clientY: cy,
                  button: 2,
                  buttons: 2
                }));
              }, 20);
            }
          }
        }
      ];

      for (const btnDef of linkButtons) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "link-btn";
        btn.setAttribute("data-tooltip", btnDef.title);
        btn.appendChild(svgIcon(btnDef.paths));
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          btnDef.run();
        });
        actionsGrid.appendChild(btn);
      }

      linkCardBox.appendChild(header);
      linkCardBox.appendChild(actionsGrid);
      previewBox.appendChild(linkCardBox);
    }

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

    // Orbit action buttons outside the ring, one per filled compass slot
    const orbit = { ...DEFAULT_ORBIT, ...(settings.orbit || {}) };
    let orbitIndex = 0;
    for (const slot of ORBIT_SLOTS) {
      // Empty slot, or an id left over from an older version of the catalog.
      const action = ACTION_BY_ID.get(orbit[slot.id]);
      if (!action) continue;

      const el = document.createElement("div");
      el.className = "ctrl";
      el.style.left = `${cx + (rx + padX) * Math.cos(slot.angle)}px`;
      el.style.top = `${cy + (ry + padY) * Math.sin(slot.angle)}px`;
      // Stagger them in so the orbit assembles rather than blinking on.
      el.style.animationDelay = `${90 + orbitIndex++ * 32}ms`;
      el.appendChild(svgIcon(action.paths));

      el.addEventListener("mouseenter", () => {
        previewToken++; // cancel any pending tab preview
        previewImg.style.display = "none";
        setLabel(action.title);
      });
      el.addEventListener("mouseleave", () => updateHighlight());
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        runAction(action, el);
      });
      el.addEventListener("auxclick", (e) => {
        if (e.button !== 1 || !action.middleMsg) return;
        e.preventDefault();
        e.stopPropagation();
        send(action.middleMsg);
        pulse(el); // stay open, matching middle-click on lozenges
      });

      wrap.appendChild(el);
    }

    document.documentElement.appendChild(host);

    modeData = { sites: tabs, history: null, bookmarks: null };
    ringTabs = tabs;
    buildRing("active", true);

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
  // `entrance` is set only for the first build of an open, which animates the
  // slots outward from the cursor; later rebuilds (sort, filter, mode) just
  // re-flow in place.
  function buildRing(selPolicy, entrance = false) {
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

    if (!entrance) {
      requestAnimationFrame(() => {
        for (const it of items) it.el.style.transition = "";
      }); // …then let the base CSS transition animate rotation
      return;
    }

    // First build of an open: collapse the slots onto the cursor, then let
    // them fly out to the ring with a delay that grows with each hop away
    // from the selector notch, so the ring unfurls both ways from 12 o'clock.
    const centre =
      `translate(${geom.cx}px, ${geom.cy}px) translate(-50%, -50%) scale(0.4)`;
    for (const it of items) {
      it.el.style.opacity = "0";
      it.el.style.transform = centre;
    }
    requestAnimationFrame(() => {
      const total = items.length;
      items.forEach((it, i) => {
        const d = ((i - sel) % total + total) % total;
        const hops = Math.min(d, total - d); // distance either way round
        it.el.style.transition = "";
        it.el.style.transitionDelay = `${Math.min(hops * 14, 200)}ms`;
        it.el.style.opacity = "";
      });
      layout();
      // Drop the delays once they've played, so rotating later is immediate.
      setTimeout(() => {
        for (const it of items) it.el.style.transitionDelay = "";
      }, 420);
    });
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
      const x = d * 68;
      const y = d === 0 ? 0 : -bow * 6; // sides tuck toward the preview
      const rot = -bow * d * 10; // tilt along the arc's tangent
      const scale = d === 0 ? 1.05 : 0.88;
      chip.el.style.transform =
        `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`;
      chip.el.classList.toggle("on", d === 0);
      chip.el.style.zIndex = d === 0 ? "2" : "1";
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

  // Fire an orbit action. `keepOpen` ones (zoom, pin, mute) leave the menu up
  // so they can be repeated; the rest dismiss first. Page-local actions wait
  // out the exit animation, so the menu isn't caught in the print output or
  // the fullscreen frame — user activation from the click outlives the delay.
  function runAction(action, el) {
    if (action.keepOpen) {
      if (action.msg) send(action.msg);
      if (action.run) action.run();
      pulse(el);
      return;
    }
    close();
    if (action.msg) send(action.msg);
    if (action.run) setTimeout(action.run, POP_MS + 20);
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

    // Stagger radial offsets when slot count is high to prevent lozenge collision
    const isDense = m > 14;

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

      // 3D perspective depth scaling based on distance from selector (top)
      const distFromTop = Math.abs(d) / (m / 2);
      const depthScale = Math.max(0.86, 1.0 - distFromTop * 0.14);

      // Alternating radial offset for dense tab rings to eliminate lozenge overlap
      let radialOffset = 0;
      if (isDense && i !== idx) {
        radialOffset = (i % 2 === 0 ? 9 : -5);
      }

      const rxEff = geom.rx + radialOffset;
      const ryEff = geom.ry + (radialOffset * 0.65);

      const px = geom.cx + rxEff * Math.cos(angle);
      const py = geom.cy + ryEff * Math.sin(angle);
      const scale = i === idx ? HI_SCALE : depthScale;

      it.el.style.transform =
        `translate(${px}px, ${py}px) translate(-50%, -50%) scale(${scale})`;
      it.el.style.zIndex = i === idx ? "10" : `${Math.max(1, Math.round(10 - distFromTop * 5))}`;
    });
  }

  function updateHighlight() {
    layout();
    if (!items.length) {
      previewToken++;
      if (previewImg) previewImg.style.display = "none";
      if (linkCardBox) linkCardBox.style.display = "none";
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

    if (currentLinkInfo && hoverIdx === null) {
      if (linkCardBox) linkCardBox.style.display = "flex";
      if (previewImg) previewImg.style.display = "none";
      if (label) label.style.display = "none";
      previewToken++;
    } else {
      if (linkCardBox) linkCardBox.style.display = "none";
      if (label) label.style.display = "block";
      if (ringMode === "sites") {
        setLabel(item.title);
        loadPreview(item);
      } else {
        // No live page to capture — show the address instead, scheme trimmed.
        setLabel(trimUrl(item.url), true);
        previewToken++;
        if (previewImg) previewImg.style.display = "none";
      }
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

  function modifierMatches(e) {
    switch (settings.modifier) {
      case "alt":
        return e.altKey && !e.ctrlKey && !e.metaKey;
      case "meta":
        return e.metaKey && !e.ctrlKey && !e.altKey;
      case "ctrl":
      default:
        return e.ctrlKey && !e.altKey && !e.metaKey;
    }
  }

  const MEDIA_TAGS = new Set(["IMG", "VIDEO", "AUDIO", "CANVAS", "EMBED", "OBJECT"]);
  // Input types that get a text-editing context menu; everything else
  // (checkbox, button, range…) doesn't, so it isn't worth protecting.
  const TEXT_INPUT_TYPES = new Set([
    "", "text", "search", "url", "tel", "email", "password", "number",
    "date", "datetime-local", "month", "week", "time",
  ]);

  function isEditable(el) {
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") return TEXT_INPUT_TYPES.has((el.type || "").toLowerCase());
    return false;
  }

  // Targets where the native menu carries items the radial can't reproduce:
  // Copy Link on a link, spellcheck and Paste in a text field, Copy and
  // "Search for…" on a selection, Save Image As on media. On these, plain
  // right-click always goes native whatever the default is — the radial is
  // still one modifier away.
  function forcesNative(e) {
    const on = settings.nativeOn || {};
    if (on.selection) {
      const s = window.getSelection();
      if (s && !s.isCollapsed && String(s).trim()) return true;
    }
    // composedPath crosses shadow boundaries and already lists ancestors,
    // so no manual DOM walk is needed.
    for (const el of e.composedPath()) {
      if (!el || el.nodeType !== 1) continue;
      if (on.links && el.href && (el.tagName === "A" || el.tagName === "AREA")) return true;
      if (on.editable && isEditable(el)) return true;
      if (on.media && MEDIA_TAGS.has(el.tagName)) return true;
    }
    return false;
  }

  function findLink(e) {
    if (!e || !e.composedPath) return null;
    for (const el of e.composedPath()) {
      if (!el || el.nodeType !== 1) continue;
      if (el.href && (el.tagName === "A" || el.tagName === "AREA")) {
        return {
          url: el.href,
          text: (el.textContent || el.getAttribute("aria-label") || el.title || el.href).trim(),
          targetEl: el
        };
      }
    }
    return null;
  }

  let lastCtx = null; // last right-click spot, for the native-menu fallback item
  let lastLinkInfo = null;

  window.addEventListener(
    "contextmenu",
    (e) => {
      lastCtx = { x: e.clientX, y: e.clientY };
      const linkInfo = findLink(e);
      lastLinkInfo = linkInfo;

      if (host) {
        // Second right-click: drop our menu and let the native one through.
        close();
        return;
      }
      if (e.shiftKey) return; // native menu, always

      // A protected target flips the default to native for this click, which
      // also means the modifier still reaches the radial there — that's the
      // only way to get the ring on a link.
      const def = forcesNative(e) ? "native" : settings.defaultMenu;
      const mod = modifierMatches(e);
      const openRadial = def === "radial" ? !mod : mod;
      if (!openRadial) return; // native menu

      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY, linkInfo);
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
      open(x, y, lastLinkInfo);
    }
  });
})();
