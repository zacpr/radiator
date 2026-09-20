"use strict";

const DEFAULTS = {
  modifier: "ctrl",
  defaultMenu: "native",
  nativeOn: { links: true, editable: true, selection: true, media: true },
  orbit: DEFAULT_ORBIT, // from actions.js
  theme: "slate",
  maxItems: 20,
  minRadius: 120,
  maxRadius: 260,
  itemScale: 1,
  fillMode: "equidistant",
  containerColors: true,
};

const radios = document.querySelectorAll('input[name="modifier"]');
const defaultMenuRadios = document.querySelectorAll('input[name="defaultMenu"]');
const themeSelect = document.getElementById("theme");
const fillSelect = document.getElementById("fillMode");
const maxItems = document.getElementById("maxItems");
const minRadius = document.getElementById("minRadius");
const maxRadius = document.getElementById("maxRadius");
const itemScale = document.getElementById("itemScale");
const containerColors = document.getElementById("containerColors");
const scaleVal = document.getElementById("scaleVal");
const cssBox = document.getElementById("customCss");
const saveBtn = document.getElementById("save");
const savedTick = document.getElementById("saved");
const orbitGrid = document.getElementById("orbitGrid");
const orbitReset = document.getElementById("orbitReset");

const NATIVE_ON_BOXES = {
  links: document.getElementById("nativeLinks"),
  editable: document.getElementById("nativeEditable"),
  selection: document.getElementById("nativeSelection"),
  media: document.getElementById("nativeMedia"),
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function showScale() {
  scaleVal.textContent = `${Number(itemScale.value).toFixed(2)}×`;
}

// ---------- orbit editor ----------

const orbitSelects = new Map(); // slot id -> <select>

// One <select> per compass position, laid out in a 3×3 grid with a ring
// glyph in the middle so the control matches what you see on the page.
function buildOrbitGrid() {
  const cellFor = (slot) => {
    const cell = document.createElement("div");
    cell.className = "orbit-cell";
    const name = document.createElement("span");
    name.textContent = slot.label;
    const select = document.createElement("select");

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— empty —";
    select.appendChild(none);

    // Group the catalog by its `group` field, preserving catalog order.
    let group = null;
    for (const action of ACTIONS) {
      if (action.group !== group) {
        group = action.group;
        const g = document.createElement("optgroup");
        g.label = group;
        select.appendChild(g);
      }
      const opt = document.createElement("option");
      opt.value = action.id;
      opt.textContent = action.title;
      select.lastElementChild.appendChild(opt);
    }

    select.addEventListener("change", saveOrbit);
    orbitSelects.set(slot.id, select);
    cell.append(name, select);
    return cell;
  };

  const bySlot = new Map(ORBIT_SLOTS.map((s) => [s.id, s]));
  const hub = document.createElement("div");
  hub.className = "orbit-hub";
  hub.innerHTML =
    '<div><svg width="26" height="26" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/>' +
    '<circle cx="12" cy="12" r="3.5"/></svg>the ring</div>';

  // Row-major order, hub in the centre cell.
  for (const id of ["nw", "n", "ne", "w", null, "e", "sw", "s", "se"]) {
    orbitGrid.appendChild(id === null ? hub : cellFor(bySlot.get(id)));
  }
}

function showOrbit(orbit) {
  for (const [id, select] of orbitSelects) {
    const value = orbit[id] || "";
    // Drop ids that no longer exist in the catalog rather than showing blank.
    select.value = ACTIONS.some((a) => a.id === value) ? value : "";
  }
}

function saveOrbit() {
  const orbit = {};
  for (const [id, select] of orbitSelects) orbit[id] = select.value;
  browser.storage.sync.set({ orbit });
}

buildOrbitGrid();

orbitReset.addEventListener("click", () => {
  showOrbit(DEFAULT_ORBIT);
  saveOrbit();
});

const BUILTIN_THEME_CSS = {
  slate: `.loz, .ctrl {
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
.notch { background: #3fb950; box-shadow: 0 0 8px rgba(63, 185, 80, 0.9); }`,

  quest: `.loz {
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
.notch { background: #d4af37; box-shadow: 0 0 8px rgba(212, 175, 55, 0.9); }`,

  holo: `.loz {
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
.notch { background: #00e5ff; box-shadow: 0 0 10px #00e5ff; }`,

  runestone: `.loz {
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
.notch { background: #6f8f4f; box-shadow: 0 0 6px rgba(111, 143, 79, 0.9); }`,

  aether: `.loz, .ctrl {
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
.notch { background: #ffffff; box-shadow: 0 0 12px rgba(255, 255, 255, 0.95); }`,

  synthwave: `.loz {
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
.notch { background: #ff007f; box-shadow: 0 0 14px #ff007f, 0 0 24px #00f3ff; }`,

  cyberhud: `.loz {
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
.notch { background: #ffee00; box-shadow: 0 0 12px #ffee00; }`
};

const customThemeGroup = document.getElementById("customThemeGroup");
const deleteCustomThemeBtn = document.getElementById("deleteCustomTheme");
const loadThemeCssBtn = document.getElementById("loadThemeCss");
const saveAsThemeBtn = document.getElementById("saveAsTheme");
const exportThemesBtn = document.getElementById("exportThemes");
const importThemesBtn = document.getElementById("importThemes");
const importFile = document.getElementById("importFile");

let userCustomThemes = {};

function renderCustomThemesDropdown() {
  if (!customThemeGroup) return;
  customThemeGroup.innerHTML = "";
  const keys = Object.keys(userCustomThemes);
  if (!keys.length) {
    customThemeGroup.style.display = "none";
  } else {
    customThemeGroup.style.display = "";
    for (const key of keys) {
      const t = userCustomThemes[key];
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${t.name || key} (Custom)`;
      customThemeGroup.appendChild(opt);
    }
  }
  updateDeleteBtnVisibility();
}

function updateDeleteBtnVisibility() {
  const isCustom = Boolean(userCustomThemes[themeSelect.value]);
  deleteCustomThemeBtn.style.display = isCustom ? "inline-block" : "none";
}

loadThemeCssBtn.addEventListener("click", () => {
  const current = themeSelect.value;
  if (userCustomThemes[current]) {
    cssBox.value = userCustomThemes[current].css;
  } else if (BUILTIN_THEME_CSS[current]) {
    cssBox.value = BUILTIN_THEME_CSS[current];
  }
  savedTick.textContent = "Theme CSS Loaded ✓";
  savedTick.style.visibility = "visible";
  setTimeout(() => {
    savedTick.style.visibility = "hidden";
    savedTick.textContent = "Saved ✓";
  }, 1500);
});

saveAsThemeBtn.addEventListener("click", async () => {
  const name = prompt("Enter a name for your Custom Theme:");
  if (!name || !name.trim()) return;
  const id = `custom_${Date.now()}`;
  userCustomThemes[id] = {
    name: name.trim(),
    css: cssBox.value,
  };
  await browser.storage.local.set({ customThemes: userCustomThemes });
  await browser.storage.sync.set({ theme: id });
  renderCustomThemesDropdown();
  themeSelect.value = id;
  updateDeleteBtnVisibility();
  savedTick.textContent = "Custom Theme Saved ✓";
  savedTick.style.visibility = "visible";
  setTimeout(() => {
    savedTick.style.visibility = "hidden";
    savedTick.textContent = "Saved ✓";
  }, 1500);
});

deleteCustomThemeBtn.addEventListener("click", async () => {
  const current = themeSelect.value;
  if (!userCustomThemes[current]) return;
  if (!confirm(`Delete custom theme "${userCustomThemes[current].name}"?`)) return;
  delete userCustomThemes[current];
  await browser.storage.local.set({ customThemes: userCustomThemes });
  await browser.storage.sync.set({ theme: "slate" });
  renderCustomThemesDropdown();
  themeSelect.value = "slate";
  updateDeleteBtnVisibility();
  savedTick.textContent = "Theme Deleted ✓";
  savedTick.style.visibility = "visible";
  setTimeout(() => {
    savedTick.style.visibility = "hidden";
    savedTick.textContent = "Saved ✓";
  }, 1500);
});

exportThemesBtn.addEventListener("click", () => {
  const payload = JSON.stringify(userCustomThemes, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "radiator-custom-themes.json";
  a.click();
  URL.revokeObjectURL(url);
});

importThemesBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const imported = JSON.parse(evt.target.result);
      if (typeof imported === "object" && imported !== null) {
        Object.assign(userCustomThemes, imported);
        await browser.storage.local.set({ customThemes: userCustomThemes });
        renderCustomThemesDropdown();
        savedTick.textContent = "Themes Imported ✓";
        savedTick.style.visibility = "visible";
        setTimeout(() => {
          savedTick.style.visibility = "hidden";
          savedTick.textContent = "Saved ✓";
        }, 1500);
      }
    } catch {
      alert("Invalid custom theme JSON file.");
    }
  };
  reader.readAsText(file);
});

browser.storage.sync.get(DEFAULTS).then((s) => {
  const modifier = s.modifier === "none" ? "ctrl" : s.modifier;
  for (const r of radios) r.checked = r.value === modifier;
  for (const r of defaultMenuRadios) r.checked = r.value === s.defaultMenu;
  const nativeOn = { ...DEFAULTS.nativeOn, ...s.nativeOn };
  for (const [key, box] of Object.entries(NATIVE_ON_BOXES)) box.checked = !!nativeOn[key];
  showOrbit({ ...DEFAULT_ORBIT, ...s.orbit });
  themeSelect.value = s.theme;
  fillSelect.value = s.fillMode;
  maxItems.value = s.maxItems;
  minRadius.value = s.minRadius;
  maxRadius.value = s.maxRadius;
  itemScale.value = s.itemScale;
  containerColors.checked = s.containerColors;
  showScale();
  updateDeleteBtnVisibility();
});

browser.storage.local.get({ customCss: "", customThemes: {} }).then((res) => {
  cssBox.value = res.customCss || "";
  userCustomThemes = res.customThemes || {};
  renderCustomThemesDropdown();
});

for (const r of radios) {
  r.addEventListener("change", () => {
    if (r.checked) browser.storage.sync.set({ modifier: r.value });
  });
}
for (const r of defaultMenuRadios) {
  r.addEventListener("change", () => {
    if (r.checked) browser.storage.sync.set({ defaultMenu: r.value });
  });
}

for (const box of Object.values(NATIVE_ON_BOXES)) {
  box.addEventListener("change", () => {
    const nativeOn = {};
    for (const [k, b] of Object.entries(NATIVE_ON_BOXES)) nativeOn[k] = b.checked;
    browser.storage.sync.set({ nativeOn });
  });
}

themeSelect.addEventListener("change", () => {
  browser.storage.sync.set({ theme: themeSelect.value });
  updateDeleteBtnVisibility();
});
fillSelect.addEventListener("change", () =>
  browser.storage.sync.set({ fillMode: fillSelect.value })
);

function numberSaver(input, key, lo, hi, fallback) {
  input.addEventListener("change", () => {
    const v = clamp(Number(input.value) || fallback, lo, hi);
    input.value = v;
    browser.storage.sync.set({ [key]: v });
  });
}
numberSaver(maxItems, "maxItems", 3, 60, DEFAULTS.maxItems);
numberSaver(minRadius, "minRadius", 60, 600, DEFAULTS.minRadius);
numberSaver(maxRadius, "maxRadius", 60, 600, DEFAULTS.maxRadius);

containerColors.addEventListener("change", () =>
  browser.storage.sync.set({ containerColors: containerColors.checked })
);

itemScale.addEventListener("input", showScale);
itemScale.addEventListener("change", () =>
  browser.storage.sync.set({ itemScale: Number(itemScale.value) })
);

saveBtn.addEventListener("click", async () => {
  await browser.storage.local.set({ customCss: cssBox.value });
  savedTick.style.visibility = "visible";
  setTimeout(() => (savedTick.style.visibility = "hidden"), 1500);
});
