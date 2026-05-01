const DEFAULT_BUTTONS = [
  {
    id: "example-summarize",
    name: "Summarize Page",
    contentMode: "url",
    promptTemplate: "Please summarize the content at this URL in a few clear bullet points:\n\n{content}",
    projectUuid: "",
    autoSend: false,
    autoClose: false,
    order: 0
  },
  {
    id: "example-job-apply",
    name: "Analyze Job Posting",
    contentMode: "auto",
    promptTemplate: "Analyze this job posting. Identify key requirements, qualifications, and any red flags. Then suggest how to tailor a resume and cover letter for it:\n\n{content}",
    projectUuid: "",
    autoSend: false,
    autoClose: false,
    order: 1
  },
  {
    id: "example-explain",
    name: "Explain This",
    contentMode: "auto",
    promptTemplate: "Explain the following in simple, easy-to-understand terms:\n\n{content}",
    projectUuid: "",
    autoSend: false,
    autoClose: false,
    order: 2
  }
];

const BADGE_COLOR = "#6b4c9a";

let cachedPlatform = null;
const platformPromise = browser.runtime.getPlatformInfo()
  .then((info) => {
    cachedPlatform = info && info.os ? info.os : "unknown";
    return cachedPlatform;
  })
  .catch(() => {
    cachedPlatform = "unknown";
    return "unknown";
  });
function isAndroid() {
  return cachedPlatform === "android";
}
async function getPlatform() {
  if (cachedPlatform) return cachedPlatform;
  return await platformPromise;
}

let writeChain = Promise.resolve();
function serializeWrite(fn) {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

const SCHEMA_VERSION = 2;

async function safeStorageSet(obj) {
  try {
    await browser.storage.local.set(obj);
    return { ok: true };
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/quota/i.test(msg)) {
      return { ok: false, error: "Storage full — clear some backlog items first", code: "QUOTA" };
    }
    return { ok: false, error: msg };
  }
}

function isFromExtensionPage(sender) {
  if (!sender) return false;
  if (sender.id !== browser.runtime.id) return false;
  if (sender.tab) {
    const extPrefix = browser.runtime.getURL("");
    return Boolean(sender.url) && sender.url.startsWith(extPrefix);
  }
  return true;
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    let path = url.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    url.pathname = path;
    return url.toString();
  } catch (e) {
    return null;
  }
}

function notify(title, message) {
  if (isAndroid()) return;
  try {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-96.png"),
      title: title,
      message: message || ""
    });
  } catch (e) {
    // notifications API may not be available (e.g. Android Firefox)
  }
}

async function addToBacklog(buttonId, newItems) {
  return serializeWrite(async () => {
    if (typeof buttonId !== "string" || !buttonId) {
      return { ok: false, added: 0, skippedDupes: 0, total: 0, buttonName: "", error: "Invalid buttonId" };
    }
    if (!Array.isArray(newItems)) {
      return { ok: false, added: 0, skippedDupes: 0, total: 0, buttonName: "", error: "Invalid items" };
    }
    const data = await browser.storage.local.get(["buttons", "backlogs"]);
    const buttons = data.buttons || [];
    const backlogs = data.backlogs || {};
    const button = buttons.find((b) => b.id === buttonId);
    if (!button) {
      return { ok: false, added: 0, skippedDupes: 0, total: 0, buttonName: "", error: "Unknown buttonId" };
    }
    const buttonName = button.name;

    const existing = backlogs[buttonId] || [];
    const existingContent = new Set(existing.map((it) => it.content));

    let added = 0;
    let skippedDupes = 0;
    const merged = existing.slice();

    for (const item of newItems) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.content !== "string" || !item.content) continue;
      if (item.type !== "url" && item.type !== "selection") continue;
      if (typeof item.addedAt !== "number") continue;
      let content = item.content;
      if (item.type === "url") {
        const normalized = normalizeUrl(content);
        if (!normalized) {
          skippedDupes++;
          continue;
        }
        content = normalized;
      }
      if (existingContent.has(content)) {
        skippedDupes++;
        continue;
      }
      existingContent.add(content);
      merged.push({ content, type: item.type, addedAt: item.addedAt });
      added++;
    }

    if (added > 0) {
      backlogs[buttonId] = merged;
      const setResult = await safeStorageSet({ backlogs });
      if (!setResult.ok) {
        return { ok: false, added: 0, skippedDupes, total: existing.length, buttonName, error: setResult.error, code: setResult.code };
      }
    }

    return {
      ok: true,
      added,
      skippedDupes,
      total: merged.length,
      buttonName
    };
  });
}

async function removeBacklogItems(buttonId, contents) {
  return serializeWrite(async () => {
    const data = await browser.storage.local.get("backlogs");
    const backlogs = data.backlogs || {};
    const existing = backlogs[buttonId] || [];
    const removeSet = new Set(contents || []);
    const remaining = existing.filter((it) => !removeSet.has(it.content));
    const removed = existing.length - remaining.length;
    if (remaining.length === 0) {
      delete backlogs[buttonId];
    } else {
      backlogs[buttonId] = remaining;
    }
    const setResult = await safeStorageSet({ backlogs });
    if (!setResult.ok) return { ok: false, removed: 0, total: existing.length, error: setResult.error };
    return { ok: true, removed, total: remaining.length };
  });
}

async function clearBacklog(buttonId) {
  return serializeWrite(async () => {
    const data = await browser.storage.local.get("backlogs");
    const backlogs = data.backlogs || {};
    delete backlogs[buttonId];
    const setResult = await safeStorageSet({ backlogs });
    if (!setResult.ok) return { ok: false, total: 0, error: setResult.error };
    return { ok: true, total: 0 };
  });
}

async function deleteBacklog(buttonId) {
  return serializeWrite(async () => {
    if (typeof buttonId !== "string" || !buttonId) {
      return { ok: false, error: "Invalid buttonId" };
    }
    const data = await browser.storage.local.get("backlogs");
    const backlogs = data.backlogs || {};
    if (!(buttonId in backlogs)) return { ok: true };
    delete backlogs[buttonId];
    const setResult = await safeStorageSet({ backlogs });
    if (!setResult.ok) return { ok: false, error: setResult.error };
    return { ok: true };
  });
}

async function updateBadge() {
  try {
    const { backlogs } = await browser.storage.local.get("backlogs");
    let total = 0;
    if (backlogs && typeof backlogs === "object") {
      total = Object.values(backlogs).reduce((sum, items) => {
        if (!Array.isArray(items)) return sum;
        return sum + items.length;
      }, 0);
    }
    await browser.browserAction.setBadgeText({ text: total > 0 ? String(total) : "" });
    await browser.browserAction.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch (e) {
    // setBadge* may be unavailable on Android Firefox
  }
}

let buildingMenus = null;
async function buildContextMenus() {
  if (isAndroid()) return;
  if (buildingMenus) return buildingMenus;
  buildingMenus = (async () => {
    try {
      try {
        await browser.contextMenus.removeAll();
      } catch (e) {
        return;
      }

      const { buttons } = await browser.storage.local.get("buttons");
      const list = (buttons || []).slice().sort((a, b) => a.order - b.order);

      const safeCreate = (props) => {
        try {
          browser.contextMenus.create(props);
        } catch (e) {
          // ignore duplicate-id or platform errors
        }
      };

      safeCreate({
        id: "promptly-root",
        title: "Promptly",
        contexts: ["link", "selection"]
      });

      if (list.length === 0) {
        safeCreate({
          id: "promptly-empty",
          parentId: "promptly-root",
          title: "Open Settings to add buttons",
          contexts: ["link", "selection"],
          enabled: true
        });
      } else {
        list.forEach((btn) => {
          const escName = btn.name.replace(/&/g, "&&");
          safeCreate({
            id: "promptly-link-direct::" + btn.id,
            parentId: "promptly-root",
            title: escName,
            contexts: ["link"]
          });
          safeCreate({
            id: "promptly-sel-direct::" + btn.id,
            parentId: "promptly-root",
            title: escName,
            contexts: ["selection"]
          });
        });

        safeCreate({
          id: "promptly-this-link-root",
          parentId: "promptly-root",
          title: "Add this link to",
          contexts: ["link"],
          visible: false
        });
        list.forEach((btn) => {
          safeCreate({
            id: "promptly-this-link::" + btn.id,
            parentId: "promptly-this-link-root",
            title: btn.name.replace(/&/g, "&&"),
            contexts: ["link"]
          });
        });

        safeCreate({
          id: "promptly-this-sel-root",
          parentId: "promptly-root",
          title: "Add selection to",
          contexts: ["selection"],
          visible: false
        });
        list.forEach((btn) => {
          safeCreate({
            id: "promptly-this-sel::" + btn.id,
            parentId: "promptly-this-sel-root",
            title: btn.name.replace(/&/g, "&&"),
            contexts: ["selection"]
          });
        });

        safeCreate({
          id: "promptly-sel-addall-root",
          parentId: "promptly-root",
          title: "Add all links to",
          contexts: ["selection"],
          visible: false
        });
        list.forEach((btn) => {
          safeCreate({
            id: "promptly-sel-addall::" + btn.id,
            parentId: "promptly-sel-addall-root",
            title: btn.name.replace(/&/g, "&&"),
            contexts: ["selection"]
          });
        });
      }
    } finally {
      buildingMenus = null;
    }
  })();
  return buildingMenus;
}

function isProtectedUrl(u) {
  if (!u) return true;
  return /^(about:|chrome:|moz-extension:|view-source:|file:|data:|javascript:|blob:|resource:)/i.test(u);
}

async function handleQuickAddLink(url) {
  if (!url || typeof url !== "string") {
    return { ok: false, error: "Invalid URL" };
  }
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return { ok: false, error: "Only http/https links can be queued" };
  }
  const { quickAddTarget } = await browser.storage.local.get("quickAddTarget");
  if (!quickAddTarget) {
    return { ok: false, error: "No quick-add target configured" };
  }
  const result = await addToBacklog(quickAddTarget, [
    { content: normalized, type: "url", addedAt: Date.now() }
  ]);
  if (result.added > 0) {
    notify(`Added to ${result.buttonName}`, `${result.total} in backlog`);
  }
  return {
    ok: true,
    added: result.added,
    skippedDupes: result.skippedDupes,
    buttonName: result.buttonName,
    total: result.total
  };
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let updateListener;
    let removeListener;
    let timeoutId;
    function cleanup() {
      try { browser.tabs.onUpdated.removeListener(updateListener); } catch (e) {}
      try { browser.tabs.onRemoved.removeListener(removeListener); } catch (e) {}
      if (timeoutId) clearTimeout(timeoutId);
    }
    updateListener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };
    removeListener = (id) => {
      if (id === tabId) {
        cleanup();
        reject(new Error("tab closed"));
      }
    };
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    browser.tabs.onUpdated.addListener(updateListener);
    browser.tabs.onRemoved.addListener(removeListener);
  });
}

async function handleButtonExecution(button, content) {
  if (!button || typeof button !== "object") return { ok: false, error: "Invalid button" };
  if (typeof button.promptTemplate !== "string") return { ok: false, error: "Invalid prompt" };
  if (button.projectUuid && !/^[a-f0-9-]{32,40}$/i.test(button.projectUuid)) {
    return { ok: false, error: "Invalid project UUID" };
  }
  const autoSend = Boolean(button.autoSend);
  const autoClose = Boolean(button.autoClose);
  const prompt = button.promptTemplate.split("{content}").join(content);

  let tab;
  try {
    const url = button.projectUuid
      ? `https://claude.ai/project/${button.projectUuid}`
      : "https://claude.ai/new";
    tab = await browser.tabs.create({ url });
  } catch (e) {
    return { ok: false, error: "Couldn't open tab" };
  }

  await waitForTabComplete(tab.id).catch(() => {});
  setTimeout(() => {
    browser.tabs.sendMessage(tab.id, {
      action: "fillPrompt",
      prompt: prompt,
      autoSend: autoSend,
      autoClose: autoClose
    }).catch(() => {});
  }, 2000);
  return { ok: true };
}

const VALID_CONTENT_MODES = ["auto", "url", "selection"];
const MAX_NAME_LEN = 200;
const MAX_TEMPLATE_LEN = 100 * 1024;

function validateButtonsForSave(buttons) {
  if (!Array.isArray(buttons)) return "buttons must be an array";
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b || typeof b !== "object") return `buttons[${i}] is not an object`;
    if (typeof b.id !== "string" || !b.id) return `buttons[${i}].id missing`;
    if (typeof b.name !== "string") return `buttons[${i}].name must be string`;
    if (b.name.length > MAX_NAME_LEN) return `buttons[${i}].name too long`;
    if (typeof b.contentMode !== "string" || VALID_CONTENT_MODES.indexOf(b.contentMode) === -1) {
      return `buttons[${i}].contentMode invalid`;
    }
    if (typeof b.promptTemplate !== "string") return `buttons[${i}].promptTemplate must be string`;
    if (b.promptTemplate.length > MAX_TEMPLATE_LEN) return `buttons[${i}].promptTemplate too long`;
  }
  return null;
}

async function saveButtons(buttons) {
  return serializeWrite(async () => {
    const err = validateButtonsForSave(buttons);
    if (err) return { ok: false, error: err };
    const setResult = await safeStorageSet({ buttons });
    if (!setResult.ok) return { ok: false, error: setResult.error };
    return { ok: true };
  });
}

async function saveQuickAddTarget(target) {
  return serializeWrite(async () => {
    if (typeof target !== "string") {
      return { ok: false, error: "quickAddTarget must be a string" };
    }
    const setResult = await safeStorageSet({ quickAddTarget: target });
    if (!setResult.ok) return { ok: false, error: setResult.error };
    return { ok: true };
  });
}

function migrateButton(b) {
  if (!b || typeof b !== "object") return null;
  const out = { ...b };
  let changed = false;
  if (typeof out.id !== "string" || !out.id) {
    out.id = "btn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    changed = true;
  }
  if (typeof out.contentMode !== "string" || VALID_CONTENT_MODES.indexOf(out.contentMode) === -1) {
    out.contentMode = "auto";
    changed = true;
  }
  if (typeof out.autoSend !== "boolean") { out.autoSend = false; changed = true; }
  if (typeof out.autoClose !== "boolean") { out.autoClose = false; changed = true; }
  if (typeof out.name !== "string") { out.name = ""; changed = true; }
  if (typeof out.promptTemplate !== "string") { out.promptTemplate = ""; changed = true; }
  return { value: out, changed };
}

function migrateBacklogEntry(entry) {
  if (typeof entry === "string") {
    return { value: { content: entry, type: "url", addedAt: Date.now() }, changed: true };
  }
  if (!entry || typeof entry !== "object") return null;
  const out = { ...entry };
  let changed = false;
  if (typeof out.content !== "string") return null;
  if (typeof out.type !== "string") {
    out.type = normalizeUrl(out.content) ? "url" : "selection";
    changed = true;
  }
  if (typeof out.addedAt !== "number") { out.addedAt = Date.now(); changed = true; }
  return { value: out, changed };
}

async function runMigration() {
  return serializeWrite(async () => {
    const data = await browser.storage.local.get(["buttons", "backlogs"]);
    const writes = {};

    if (Array.isArray(data.buttons)) {
      let buttonsChanged = false;
      const migratedButtons = [];
      for (const b of data.buttons) {
        const m = migrateButton(b);
        if (!m) { buttonsChanged = true; continue; }
        if (m.changed) buttonsChanged = true;
        migratedButtons.push(m.value);
      }
      if (buttonsChanged) writes.buttons = migratedButtons;
    }

    if (data.backlogs && typeof data.backlogs === "object") {
      let backlogsChanged = false;
      const migratedBacklogs = {};
      for (const key of Object.keys(data.backlogs)) {
        const items = data.backlogs[key];
        if (!Array.isArray(items)) { backlogsChanged = true; continue; }
        const migratedItems = [];
        for (const it of items) {
          const m = migrateBacklogEntry(it);
          if (!m) { backlogsChanged = true; continue; }
          if (m.changed) backlogsChanged = true;
          migratedItems.push(m.value);
        }
        if (migratedItems.length > 0) {
          migratedBacklogs[key] = migratedItems;
        } else {
          backlogsChanged = true;
        }
      }
      if (backlogsChanged) writes.backlogs = migratedBacklogs;
    }

    writes.schemaVersion = SCHEMA_VERSION;
    await browser.storage.local.set(writes);
    return { ok: true };
  });
}

async function fetchClaudeProjects() {
  try {
    const orgResponse = await fetch("https://claude.ai/api/organizations", {
      credentials: "include"
    });
    if (!orgResponse.ok) return { error: "Not logged in to Claude.ai" };
    const orgs = await orgResponse.json();
    if (!orgs || orgs.length === 0) return { error: "No organizations found" };

    const orgId = orgs[0].uuid;

    const projResponse = await fetch(
      `https://claude.ai/api/organizations/${orgId}/projects`,
      { credentials: "include" }
    );
    if (!projResponse.ok) return { error: "Could not fetch projects" };
    const projects = await projResponse.json();

    return {
      projects: projects.map((p) => ({
        uuid: p.uuid,
        name: p.name
      }))
    };
  } catch (e) {
    return { error: "Could not connect to Claude.ai. Make sure you are logged in." };
  }
}

const PRIVILEGED_WRITE_ACTIONS = new Set([
  "executeButton",
  "addToBacklog",
  "removeBacklogItems",
  "clearBacklog",
  "deleteBacklog",
  "saveButtons",
  "saveQuickAddTarget",
  "fetchProjects"
]);

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== "string") return;

  if (PRIVILEGED_WRITE_ACTIONS.has(message.action) && !isFromExtensionPage(sender)) {
    return Promise.resolve({ ok: false, error: "Unauthorized sender" });
  }

  if (message.action === "ensureSeeded") {
    return ensureSeeded().then(() => ({ ok: true }));
  }

  if (message.action === "getPlatform") {
    if (cachedPlatform) return Promise.resolve({ os: cachedPlatform });
    return platformPromise.then((os) => ({ os }));
  }

  if (message.action === "executeButton") {
    return handleButtonExecution(message.button, message.content);
  }
  if (message.action === "fetchProjects") {
    return fetchClaudeProjects();
  }
  if (message.action === "quickAddLink") {
    return handleQuickAddLink(message.url);
  }
  if (message.action === "addToBacklog") {
    return addToBacklog(message.buttonId, message.items || []).catch((e) => ({
      ok: false,
      error: String(e && e.message || e)
    }));
  }
  if (message.action === "removeBacklogItems") {
    return removeBacklogItems(message.buttonId, message.contents || []).catch((e) => ({
      ok: false,
      error: String(e && e.message || e)
    }));
  }
  if (message.action === "clearBacklog") {
    return clearBacklog(message.buttonId).catch((e) => ({
      ok: false,
      total: 0,
      error: String(e && e.message || e)
    }));
  }
  if (message.action === "deleteBacklog") {
    return deleteBacklog(message.buttonId).catch((e) => ({
      ok: false,
      error: String(e && e.message || e)
    }));
  }
  if (message.action === "saveButtons") {
    return saveButtons(message.buttons).catch((e) => ({
      ok: false,
      error: String(e && e.message || e)
    }));
  }
  if (message.action === "saveQuickAddTarget") {
    return saveQuickAddTarget(message.quickAddTarget).catch((e) => ({
      ok: false,
      error: String(e && e.message || e)
    }));
  }
  if (message.action === "openOptionsPage") {
    try {
      browser.runtime.openOptionsPage();
    } catch (e) {
      // ignore
    }
    return Promise.resolve({ ok: true });
  }
});

function extractLinkButtonId(id) {
  if (id.startsWith("promptly-link-direct::")) return id.substring("promptly-link-direct::".length);
  if (id.startsWith("promptly-this-link::")) return id.substring("promptly-this-link::".length);
  return null;
}
function extractSelButtonId(id) {
  if (id.startsWith("promptly-sel-direct::")) return id.substring("promptly-sel-direct::".length);
  if (id.startsWith("promptly-this-sel::")) return id.substring("promptly-this-sel::".length);
  return null;
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (isAndroid()) return;
  const id = info.menuItemId;
  if (typeof id !== "string") return;

  if (id === "promptly-empty") {
    try {
      browser.runtime.openOptionsPage();
    } catch (e) {
      // ignore
    }
    return;
  }

  const linkButtonId = extractLinkButtonId(id);
  if (linkButtonId) {
    const url = info.linkUrl || "";
    const normalized = normalizeUrl(url);
    if (!normalized) {
      notify("Unsupported link type", "Only http/https links can be queued");
      return;
    }
    const result = await addToBacklog(linkButtonId, [
      { content: normalized, type: "url", addedAt: Date.now() }
    ]);
    if (result.added > 0) {
      notify(`Added to ${result.buttonName}`, `${result.buttonName} now has ${result.total} queued`);
    } else if (result.skippedDupes > 0) {
      notify("Already queued", `Already in ${result.buttonName} backlog`);
    }
    return;
  }

  const selButtonId = extractSelButtonId(id);
  if (selButtonId) {
    const text = (info.selectionText || "").trim();
    if (!text) {
      notify("Promptly", "No text selected");
      return;
    }
    const result = await addToBacklog(selButtonId, [
      { content: text, type: "selection", addedAt: Date.now() }
    ]);
    if (result.added > 0) {
      notify(`Added to ${result.buttonName}`, `${result.buttonName} now has ${result.total} queued`);
    } else if (result.skippedDupes > 0) {
      notify("Already queued", `Already in ${result.buttonName} backlog`);
    }
    return;
  }

  if (id.startsWith("promptly-sel-addall::")) {
    const buttonId = id.substring("promptly-sel-addall::".length);
    if (!tab || typeof tab.id !== "number") {
      notify("Promptly", "Could not access the active tab");
      return;
    }
    let response;
    try {
      response = await browser.tabs.sendMessage(tab.id, {
        action: "extractLinksFromSelection"
      });
    } catch (e) {
      if (isProtectedUrl(tab.url)) {
        notify("Promptly", "Promptly can't read selections on this page (browser-protected)");
      } else {
        notify("Promptly", "Couldn't read selection — try reloading the page");
      }
      return;
    }
    const links = (response && Array.isArray(response.links)) ? response.links : [];
    const truncated = !!(response && response.truncated);

    if (links.length === 0) {
      notify("No links found in selection", "");
      return;
    }
    const items = links.map((url) => ({
      content: url,
      type: "url",
      addedAt: Date.now()
    }));
    const result = await addToBacklog(buttonId, items);
    const word = result.added === 1 ? "link" : "links";
    if (result.added > 0) {
      let body = `${result.total} in backlog`;
      if (truncated) body += " (truncated at 500)";
      notify(`Added ${result.added} ${word} to ${result.buttonName}`, body);
    } else if (result.skippedDupes > 0) {
      notify("All links already queued", `Nothing added to ${result.buttonName}`);
    } else {
      notify("No links found in selection", "");
    }
    return;
  }
});

const menusApi = (typeof browser.menus !== "undefined") ? browser.menus : browser.contextMenus;
if (menusApi && typeof menusApi.onShown !== "undefined") {
  menusApi.onShown.addListener(async (info, tab) => {
    if (isAndroid()) return;
    if (!info || !Array.isArray(info.menuIds)) return;
    if (!info.menuIds.some((id) => typeof id === "string" && id.startsWith("promptly-"))) return;

    const isLink = info.contexts && info.contexts.includes("link");
    const isSelection = info.contexts && info.contexts.includes("selection");
    const both = isLink && isSelection;

    let hasLinksInSelection = false;
    if (isSelection && tab && typeof tab.id === "number" && !isProtectedUrl(tab.url)) {
      try {
        const response = await browser.tabs.sendMessage(tab.id, {
          action: "checkSelectionLinks"
        });
        hasLinksInSelection = !!(response && response.hasLinks);
      } catch (e) {
        // content script unavailable; default false
      }
    }

    const updates = [];
    const tryUpdate = (id, props) => {
      try {
        updates.push(menusApi.update(id, props));
      } catch (e) {
        // ignore
      }
    };

    const { buttons } = await browser.storage.local.get("buttons");
    const list = (buttons || []).slice().sort((a, b) => a.order - b.order);

    list.forEach((btn) => {
      tryUpdate("promptly-link-direct::" + btn.id, { visible: !both });
      tryUpdate("promptly-sel-direct::" + btn.id, { visible: !both });
    });
    tryUpdate("promptly-this-link-root", { visible: !!both });
    tryUpdate("promptly-this-sel-root", { visible: !!both });
    tryUpdate("promptly-sel-addall-root", { visible: hasLinksInSelection });

    await Promise.allSettled(updates);
    try {
      await menusApi.refresh();
    } catch (e) {
      // ignore refresh errors
    }
  });
}

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const { buttons } = await browser.storage.local.get("buttons");
    if (!buttons || buttons.length === 0) {
      await browser.storage.local.set({ buttons: DEFAULT_BUTTONS, schemaVersion: SCHEMA_VERSION });
    } else {
      await browser.storage.local.set({ schemaVersion: SCHEMA_VERSION });
    }
  } else if (details.reason === "update") {
    try {
      await runMigration();
    } catch (e) {
      // migration failures must not break startup
    }
  }
  buildContextMenus();
  updateBadge();
});

browser.runtime.onStartup.addListener(() => {
  buildContextMenus();
  updateBadge();
});

if (browser.commands && typeof browser.commands.onCommand !== "undefined") {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "quick-add-hovered-link") return;
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0] || typeof tabs[0].id !== "number") return;
      if (isProtectedUrl(tabs[0].url)) return;
      await browser.tabs.sendMessage(tabs[0].id, { action: "quickAddHovered" }).catch(() => {});
    } catch (e) {
      // ignore
    }
  });
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.buttons) {
    buildContextMenus();
  }
  if (changes.backlogs) {
    updateBadge();
  }
});

async function ensureSeeded() {
  try {
    const data = await browser.storage.local.get(["buttons", "schemaVersion"]);
    const writes = {};
    if (data.schemaVersion !== SCHEMA_VERSION) writes.schemaVersion = SCHEMA_VERSION;
    if (!Array.isArray(data.buttons) || data.buttons.length === 0) writes.buttons = DEFAULT_BUTTONS;
    if (Object.keys(writes).length > 0) {
      await browser.storage.local.set(writes);
    }
  } catch (e) {
    // ignore; caller will see via storage state
  }
}

platformPromise.then(async () => {
  await ensureSeeded();
  buildContextMenus();
  updateBadge();
});
