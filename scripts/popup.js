// Promptly — Popup Script
// Renders the button list and handles click actions + backlog

let isAndroid = false;

async function detectPlatform() {
  try {
    const info = await Promise.race([
      browser.runtime.getPlatformInfo(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 300))
    ]);
    isAndroid = info && info.os === "android";
    if (isAndroid) document.body.classList.add("is-android");
  } catch (e) {}
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return u;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    let path = url.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    url.pathname = path;
    return url.toString();
  } catch (e) {
    return u;
  }
}

function truncateUrl(url, budget) {
  try {
    const u = new URL(url);
    const host = u.host;
    const path = u.pathname + u.search;
    if (host.length + path.length <= budget) return host + path;
    const lastSeg = path.split("/").filter(Boolean).pop() || "";
    const remaining = budget - host.length - 4;
    if (lastSeg.length <= remaining && remaining > 4) return host + "/…/" + lastSeg;
    return host + "/…";
  } catch (e) {
    return url.length > budget ? url.slice(0, budget - 1) + "…" : url;
  }
}

async function waitForSchema() {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const { schemaVersion } = await browser.storage.local.get("schemaVersion");
      if (schemaVersion === 2) return;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await detectPlatform();
  await waitForSchema();

  const buttonList = document.getElementById("button-list");
  const emptyState = document.getElementById("empty-state");
  const emptyStateSettings = document.getElementById("empty-state-settings");
  const statusMessage = document.getElementById("status-message");
  const openSettings = document.getElementById("open-settings");

  let currentTabUrl = "";
  let currentTabRawUrl = "";
  let currentTabId = null;

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentTabRawUrl = tabs[0].url || "";
      currentTabUrl = normalizeUrl(currentTabRawUrl);
      currentTabId = tabs[0].id;
    }
  } catch (e) {}

  const data = await browser.storage.local.get(["buttons", "backlogs"]);
  let sortedButtons = (data.buttons || []).sort((a, b) => a.order - b.order);
  let backlogs = data.backlogs || {};

  const expandedButtons = new Set();
  const rowRefs = {};
  let listCounter = 0;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const oldBacklogs = changes.backlogs ? (changes.backlogs.oldValue || {}) : null;
    if (changes.backlogs) {
      backlogs = changes.backlogs.newValue || {};
    }
    if (changes.buttons) {
      sortedButtons = (changes.buttons.newValue || []).sort((a, b) => a.order - b.order);
      const validIds = new Set(sortedButtons.map((b) => b.id));
      Object.keys(rowRefs).forEach((id) => {
        if (!validIds.has(id)) {
          expandedButtons.delete(id);
        }
      });
      while (buttonList.firstChild) buttonList.removeChild(buttonList.firstChild);
      Object.keys(rowRefs).forEach((id) => delete rowRefs[id]);
      if (sortedButtons.length === 0) {
        emptyState.style.display = "block";
      } else {
        emptyState.style.display = "none";
        sortedButtons.forEach((btn) => {
          const backlog = backlogs[btn.id] || [];
          if (backlog.length === 0) {
            expandedButtons.delete(btn.id);
          }
          renderButtonRow(btn);
        });
      }
    } else if (changes.backlogs) {
      for (const btn of sortedButtons) {
        const oldArr = oldBacklogs[btn.id] || [];
        const newArr = backlogs[btn.id] || [];
        let changed = oldArr.length !== newArr.length;
        if (!changed) {
          for (let i = 0; i < newArr.length; i++) {
            if (!oldArr[i] || oldArr[i].content !== newArr[i].content) {
              changed = true;
              break;
            }
          }
        }
        if (changed) renderButtonRow(btn);
      }
    }
  });

  if (emptyStateSettings) {
    emptyStateSettings.addEventListener("click", () => {
      browser.runtime.openOptionsPage();
      window.close();
    });
  }

  openSettings.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });

  if (sortedButtons.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  sortedButtons.forEach((btn) => {
    renderButtonRow(btn);
  });

  async function refreshBacklog(buttonId) {
    const fresh = await browser.storage.local.get("backlogs");
    const freshBacklogs = fresh.backlogs || {};
    if (buttonId) {
      if (freshBacklogs[buttonId]) {
        backlogs[buttonId] = freshBacklogs[buttonId];
      } else {
        delete backlogs[buttonId];
      }
    } else {
      backlogs = freshBacklogs;
    }
  }

  function renderButtonRow(btn) {
    const backlog = backlogs[btn.id] || [];
    const backlogCount = backlog.length;
    const isSelectionMode = btn.contentMode === "selection";
    const isInBacklog = !isSelectionMode && backlog.some((item) => item.content === currentTabUrl);

    const wrapper = document.createElement("div");
    wrapper.className = "button-row-wrapper";

    const row = document.createElement("div");
    row.className = "button-row";

    const listElementId = "backlog-list-" + btn.id + "-" + (++listCounter);

    const caret = document.createElement("button");
    caret.className = "disclosure-caret";
    if (backlogCount === 0) {
      caret.classList.add("hidden");
      caret.setAttribute("tabindex", "-1");
      caret.setAttribute("aria-hidden", "true");
    }
    const isExpanded = expandedButtons.has(btn.id) && backlogCount > 0;
    caret.textContent = isExpanded ? "▾" : "▸";
    caret.title = isExpanded ? "Hide queued items" : "Show queued items";
    caret.setAttribute("aria-expanded", String(isExpanded));
    caret.setAttribute("aria-label", isExpanded ? "Hide queued items" : "Show queued items");
    caret.setAttribute("aria-controls", listElementId);
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      if ((backlogs[btn.id] || []).length === 0) return;
      if (expandedButtons.has(btn.id)) {
        expandedButtons.delete(btn.id);
      } else {
        expandedButtons.add(btn.id);
      }
      rerenderButtonRow(btn);
    });

    const runBtn = document.createElement("button");
    runBtn.className = "action-button";
    const nameSpan = document.createElement("span");
    nameSpan.className = "action-button-name";
    nameSpan.textContent = btn.name;
    runBtn.appendChild(nameSpan);
    if (backlogCount > 0) {
      const badge = document.createElement("span");
      badge.className = "backlog-badge";
      badge.textContent = backlogCount;
      runBtn.appendChild(badge);
    }
    if (backlogCount > 0) {
      runBtn.title = "Run with " + backlogCount + " backlog item" + (backlogCount === 1 ? "" : "s") + " — clears backlog after";
    } else {
      const previewLine = "Run with current page (or selected text)";
      const promptPreview = (btn.promptTemplate || "").substring(0, 100);
      runBtn.title = previewLine + (promptPreview ? "\n" + promptPreview : "");
    }
    runBtn.setAttribute("aria-label", btn.name + (backlogCount > 0
      ? ", run with " + backlogCount + " queued item" + (backlogCount === 1 ? "" : "s")
      : ", run with current page"));
    runBtn.addEventListener("click", () => executeButton(btn));

    const addBtn = document.createElement("button");
    addBtn.className = "backlog-add-button" + (isInBacklog ? " in-backlog" : "");
    if (isInBacklog) {
      addBtn.textContent = isAndroid ? "−" : "✓";
    } else {
      addBtn.textContent = "+";
    }
    if (isSelectionMode) {
      addBtn.title = "Add current selection to backlog";
      addBtn.setAttribute("aria-label", "Add current selection to " + btn.name + " backlog");
    } else if (isInBacklog) {
      addBtn.title = "Click to remove this page from backlog";
      addBtn.setAttribute("aria-label", "Remove current page from " + btn.name + " backlog");
    } else {
      addBtn.title = "Add to backlog";
      addBtn.setAttribute("aria-label", "Add current page to " + btn.name + " backlog");
    }
    if (isInBacklog && !isAndroid) {
      addBtn.addEventListener("mouseenter", () => {
        addBtn.textContent = "×";
      });
      addBtn.addEventListener("mouseleave", () => {
        addBtn.textContent = "✓";
      });
    }
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isInBacklog) {
        removeCurrentFromBacklog(btn);
      } else {
        addToBacklog(btn);
      }
    });

    row.appendChild(caret);
    row.appendChild(runBtn);
    row.appendChild(addBtn);
    wrapper.appendChild(row);

    if (isAndroid && backlogCount > 0) {
      const meta = document.createElement("div");
      meta.className = "run-meta";
      meta.textContent = "Sends " + backlogCount + " backlog item" + (backlogCount === 1 ? "" : "s") + ", then clears";
      wrapper.appendChild(meta);
    }

    if (isAndroid && isSelectionMode && backlogCount === 0) {
      const hint = document.createElement("div");
      hint.className = "row-hint";
      hint.textContent = "Select text first, then open this menu";
      wrapper.appendChild(hint);
    }

    if (isExpanded) {
      const list = buildBacklogList(btn, listElementId);
      wrapper.appendChild(list);
    }

    const oldNode = rowRefs[btn.id];
    if (oldNode && oldNode.parentNode) {
      oldNode.replaceWith(wrapper);
    } else {
      buttonList.appendChild(wrapper);
    }
    rowRefs[btn.id] = wrapper;
  }

  function rerenderButtonRow(btn) {
    renderButtonRow(btn);
  }

  function rerenderAll() {
    sortedButtons.forEach((btn) => {
      const backlog = backlogs[btn.id] || [];
      if (backlog.length === 0) {
        expandedButtons.delete(btn.id);
      }
      renderButtonRow(btn);
    });
  }

  function buildBacklogList(btn, listElementId) {
    const BUDGET = 55;
    const list = document.createElement("div");
    list.className = "backlog-list";
    list.id = listElementId;
    const items = backlogs[btn.id] || [];
    items.forEach((item) => {
      const itemRow = document.createElement("div");
      itemRow.className = "backlog-item";
      const isCurrentPage = item.type === "url" && item.content === currentTabUrl;
      if (isCurrentPage) {
        itemRow.classList.add("is-current");
      }

      const label = document.createElement("span");
      label.className = "backlog-item-label";

      const SUFFIX = isCurrentPage ? " (current page)" : "";
      const maxLabel = BUDGET - SUFFIX.length;
      let rawText;
      if (item.type === "url") {
        rawText = truncateUrl(item.content, maxLabel);
      } else {
        rawText = item.content;
      }
      let labelText = rawText.length > maxLabel ? rawText.slice(0, maxLabel - 1) + "…" : rawText;
      label.textContent = labelText + SUFFIX;
      label.title = item.content;

      const displayText = labelText;
      const removeBtn = document.createElement("button");
      removeBtn.className = "backlog-item-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove from backlog";
      removeBtn.setAttribute("aria-label", "Remove " + displayText + " from " + btn.name + " backlog");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeBacklogItem(btn, item.content);
      });

      itemRow.appendChild(label);
      itemRow.appendChild(removeBtn);
      list.appendChild(itemRow);
    });
    return list;
  }

  async function removeBacklogItem(btn, content) {
    try {
      const response = await browser.runtime.sendMessage({
        action: "removeBacklogItems",
        buttonId: btn.id,
        contents: [content]
      });
      await refreshBacklog(btn.id);
      if ((backlogs[btn.id] || []).length === 0) {
        expandedButtons.delete(btn.id);
      }
      if (response && response.ok) {
        showStatus("Removed from " + btn.name + " backlog");
      }
      rerenderButtonRow(btn);
    } catch (e) {
      showStatus("Error: " + e.message, true);
    }
  }

  async function removeCurrentFromBacklog(btn) {
    try {
      const response = await browser.runtime.sendMessage({
        action: "removeBacklogItems",
        buttonId: btn.id,
        contents: [currentTabUrl]
      });
      await refreshBacklog(btn.id);
      if ((backlogs[btn.id] || []).length === 0) {
        expandedButtons.delete(btn.id);
      }
      if (response && response.ok) {
        showStatus("Removed from " + btn.name + " backlog");
      }
      rerenderButtonRow(btn);
    } catch (e) {
      showStatus("Error: " + e.message, true);
    }
  }

  async function executeButton(btn) {
    showStatus("Getting page info...");

    try {
      const backlog = backlogs[btn.id] || [];

      let content = "";

      if (backlog.length > 0) {
        content = backlog.map((item, i) => (i + 1) + ". " + item.content).join("\n");
      } else {
        const result = await getCurrentContent(btn);
        content = result.content;
        if (!content) {
          if (result.privilegedBlocked) {
            showStatus("Promptly can't read content from this page (browser-protected URL).", true);
          } else if (btn.contentMode === "selection" && isAndroid) {
            showStatus("Selection lost — Android often clears selection when the popup opens. Try changing this button to Auto mode in Settings.", true);
          } else if (btn.contentMode === "auto" && isAndroid && result.selectionAttempted) {
            showStatus("Couldn't read page content. On Android, opening the popup may clear your selection — try copy-paste or switch this button to URL mode.", true);
          } else {
            showStatus("No content found. Select text or use URL mode.", true);
          }
          return;
        }
      }

      const response = await browser.runtime.sendMessage({
        action: "executeButton",
        button: btn,
        content: content
      });

      if (response && response.ok) {
        let clearOk = true;
        if (backlog.length > 0) {
          const clearResp = await browser.runtime.sendMessage({
            action: "clearBacklog",
            buttonId: btn.id
          });
          clearOk = clearResp && clearResp.ok;
          if (clearOk) {
            showStatus("Sent " + backlog.length + " " + (backlog.length === 1 ? "item" : "items") + " to Claude");
          } else {
            showStatus("Sent " + backlog.length + " items but couldn't clear backlog", true);
          }
        } else {
          showStatus("Opening Claude...");
        }
        const closeDelay = isAndroid
          ? (backlog.length > 0 ? (clearOk ? 2500 : 4000) : 1500)
          : (backlog.length > 0 ? (clearOk ? 900 : 2500) : 500);
        setTimeout(() => window.close(), closeDelay);
      } else {
        if (backlog.length > 0) {
          showStatus("Failed to open Claude — backlog kept", true);
        } else {
          showStatus("Opening Claude...");
          setTimeout(() => window.close(), isAndroid ? 1500 : 500);
        }
      }

    } catch (e) {
      showStatus("Error: " + e.message, true);
    }
  }

  async function addToBacklog(btn) {
    try {
      const result = await getCurrentContent(btn);
      const content = result.content;
      if (!content) {
        if (result.privilegedBlocked) {
          showStatus("Promptly can't read content from this page (browser-protected URL).", true);
        } else if (btn.contentMode === "selection" && isAndroid) {
          showStatus("Selection lost — Android often clears selection when the popup opens. Try changing this button to Auto mode in Settings.", true);
        } else if (btn.contentMode === "auto" && isAndroid && result.selectionAttempted) {
          showStatus("Couldn't read page content. On Android, opening the popup may clear your selection — try copy-paste or switch this button to URL mode.", true);
        } else {
          showStatus("No content to add.", true);
        }
        return;
      }

      let type;
      if (btn.contentMode === "url") {
        type = "url";
      } else if (btn.contentMode === "selection") {
        type = "selection";
      } else {
        type = result.selectionAttempted && content !== currentTabUrl ? "selection" : "url";
      }

      const response = await browser.runtime.sendMessage({
        action: "addToBacklog",
        buttonId: btn.id,
        items: [{
          content: type === "url" ? normalizeUrl(content) : content,
          type: type,
          addedAt: Date.now()
        }]
      });

      await refreshBacklog(btn.id);

      if (response && response.ok) {
        if (response.added === 0 && response.skippedDupes > 0) {
          showStatus("Already in " + btn.name + " backlog");
        } else {
          showStatus("Added — " + btn.name + " now has " + response.total + " queued");
        }
      } else if (response && response.error) {
        showStatus("Error: " + response.error, true);
      }

      rerenderButtonRow(btn);

    } catch (e) {
      showStatus("Error: " + e.message, true);
    }
  }

  const PRIVILEGED_SCHEMES = ["about:", "chrome:", "moz-extension:", "view-source:", "resource:", "javascript:", "data:", "file:", "blob:"];

  function isPrivilegedUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return PRIVILEGED_SCHEMES.some((s) => lower.startsWith(s));
  }

  async function getCurrentContent(btn) {
    let content = "";
    let selectionAttempted = false;
    const privilegedBlocked = isPrivilegedUrl(currentTabRawUrl);

    if (!privilegedBlocked && (btn.contentMode === "selection" || btn.contentMode === "auto")) {
      selectionAttempted = true;
      try {
        const results = await browser.tabs.executeScript(currentTabId, {
          code: "window.getSelection().toString();"
        });
        if (results && results[0] && results[0].trim()) {
          content = results[0].trim();
        }
      } catch (e) {}
    }

    if (!content && (btn.contentMode === "url" || btn.contentMode === "auto")) {
      if (!privilegedBlocked) {
        content = currentTabUrl;
      }
    }

    return { content, selectionAttempted, privilegedBlocked };
  }

  function showStatus(text, isError = false) {
    statusMessage.style.display = "block";
    statusMessage.textContent = text;
    statusMessage.className = "status-message" + (isError ? " error" : "");
  }
});
