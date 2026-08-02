"use strict";

const PREVIEW_TTL_MS = 15000;
const previewCache = new Map(); // tabId -> { dataUrl, ts }

browser.tabs.onRemoved.addListener((tabId) => previewCache.delete(tabId));

// Fallback launcher inside the native context menu.
browser.menus.removeAll().then(() => {
  browser.menus.create({
    id: "radiator-open",
    title: "Open Radial Tab Menu",
    contexts: ["all"],
  });
});

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "radiator-open" && tab && tab.id != null) {
    // No content script on privileged pages — the catch swallows that case.
    browser.tabs.sendMessage(tab.id, { type: "openRadiator" }).catch(() => {});
  }
});

// Toolbar button: same fallback trigger as the context menu item, one click
// away. Silently does nothing on privileged pages (no content script there).
browser.browserAction.onClicked.addListener((tab) => {
  browser.tabs.sendMessage(tab.id, { type: "openRadiator" }).catch(() => {});
});

async function getTabsPayload() {
  const [tabs, identities] = await Promise.all([
    browser.tabs.query({ currentWindow: true }),
    // Container colors; empty if containers are disabled or the API is out.
    browser.contextualIdentities
      ? browser.contextualIdentities.query({}).catch(() => [])
      : Promise.resolve([]),
  ]);
  const colors = new Map(identities.map((i) => [i.cookieStoreId, i.colorCode]));
  return tabs.map((t) => ({
    id: t.id,
    title: t.title || t.url || "Untitled",
    favIconUrl: t.favIconUrl || null,
    active: t.active,
    lastAccessed: t.lastAccessed || 0,
    containerColor: colors.get(t.cookieStoreId) || null,
  }));
}

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {
    case "getTabs":
      return getTabsPayload();

    case "activateTab":
      return browser.tabs.update(msg.tabId, { active: true });

    case "duplicateTab":
      return browser.tabs.duplicate(msg.tabId, { active: false });

    case "closeTab":
      return browser.tabs.remove(msg.tabId);

    case "newTab":
      return browser.tabs.create({ active: !msg.background, url: msg.url || undefined });

    case "openHere":
      return browser.tabs.update(sender.tab.id, { url: msg.url });

    case "getBookmarks":
      return browser.bookmarks
        .getTree()
        .then((roots) => {
          const out = [];
          const walk = (node) => {
            if (node.url && /^https?:/i.test(node.url)) {
              out.push({
                id: `bm-${node.id}`,
                title: node.title || node.url,
                url: node.url,
                favIconUrl: null,
                active: false,
                lastAccessed: node.dateAdded || 0,
                containerColor: null,
              });
            }
            (node.children || []).forEach(walk);
          };
          roots.forEach(walk);
          return out.slice(0, 400);
        })
        .catch(() => []);

    case "getHistory":
      return browser.history
        .search({ text: "", maxResults: 150, startTime: 0 })
        .then((entries) =>
          entries
            .filter((h) => /^https?:/i.test(h.url))
            .map((h) => ({
              id: `h-${h.id}`,
              title: h.title || h.url,
              url: h.url,
              favIconUrl: null,
              active: false,
              lastAccessed: h.lastVisitTime || 0,
              containerColor: null,
            }))
        )
        .catch(() => []);

    case "newWindow":
      return browser.windows.create({});

    case "navBack":
      return browser.tabs.goBack(sender.tab.id);

    case "navForward":
      return browser.tabs.goForward(sender.tab.id);

    case "reloadTab":
      return browser.tabs.reload(sender.tab.id);

    case "goHome":
      // Extensions can't navigate to privileged about: pages, so if the
      // homepage is the default Firefox Home we open a new tab instead.
      return browser.browserSettings.homepageOverride
        .get({})
        .then(({ value }) => {
          const url = (value || "").split("|")[0].trim();
          if (/^(https?|file):/i.test(url)) {
            return browser.tabs.update(sender.tab.id, { url });
          }
          return browser.tabs.create({});
        })
        .catch(() => browser.tabs.create({}));

    case "getPreview": {
      const cached = previewCache.get(msg.tabId);
      if (cached && Date.now() - cached.ts < PREVIEW_TTL_MS) {
        return Promise.resolve(cached.dataUrl);
      }
      // Firefox-only: captureTab works on background tabs too. Fails on
      // discarded/never-rendered tabs — callers treat null as "no preview".
      return browser.tabs
        .captureTab(msg.tabId, { format: "jpeg", quality: 60 })
        .then((dataUrl) => {
          previewCache.set(msg.tabId, { dataUrl, ts: Date.now() });
          return dataUrl;
        })
        .catch(() => null);
    }
  }
});
