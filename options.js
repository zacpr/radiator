"use strict";

const DEFAULTS = {
  modifier: "ctrl",
  defaultMenu: "native",
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

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function showScale() {
  scaleVal.textContent = `${Number(itemScale.value).toFixed(2)}×`;
}

browser.storage.sync.get(DEFAULTS).then((s) => {
  for (const r of radios) r.checked = r.value === s.modifier;
  for (const r of defaultMenuRadios) r.checked = r.value === s.defaultMenu;
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
