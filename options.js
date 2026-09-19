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

browser.storage.sync.get(DEFAULTS).then((s) => {
  // "none" was retired when the default-menu setting arrived; the content
  // script treats it as Ctrl, so show that rather than leaving all unchecked.
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
});

browser.storage.local.get({ customCss: "" }).then(({ customCss }) => {
  cssBox.value = customCss;
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

themeSelect.addEventListener("change", () =>
  browser.storage.sync.set({ theme: themeSelect.value })
);
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
