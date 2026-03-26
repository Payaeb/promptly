// Promptly — Popup Script
// Renders the button list and handles click actions + backlog

document.addEventListener("DOMContentLoaded", async () => {
  const buttonList = document.getElementById("button-list");
  const emptyState = document.getElementById("empty-state");
  const statusMessage = document.getElementById("status-message");
  const openSettings = document.getElementById("open-settings");

  let currentTabUrl = "";
  let currentTabId = null;

  // Get current tab info right away
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentTabUrl = tabs[0].url;
      currentTabId = tabs[0].id;
    }
  } catch (e) {}

  // Load buttons and backlogs from storage
  const data = await browser.storage.local.get(["buttons", "backlogs"]);
  const sortedButtons = (data.buttons || []).sort((a, b) => a.order - b.order);
  const backlogs = data.backlogs || {}; // { buttonId: [ { content, type, addedAt } ] }

  if (sortedButtons.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  // Render each button
  sortedButtons.forEach((btn) => {
    const backlog = backlogs[btn.id] || [];
    const backlogCount = backlog.length;
    const isInBacklog = backlog.some((item) => item.content === currentTabUrl);

    const row = document.createElement("div");
    row.className = "button-row";

    // Main run button
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
    runBtn.title = backlogCount > 0
      ? `Run with ${backlogCount} backlog item(s)`
      : btn.promptTemplate.substring(0, 100) + "...";
    runBtn.addEventListener("click", () => executeButton(btn, backlogs));

    // Add to backlog button
    const addBtn = document.createElement("button");
    addBtn.className = "backlog-add-button" + (isInBacklog ? " in-backlog" : "");
    addBtn.textContent = isInBacklog ? "\u2713" : "+";
    addBtn.title = isInBacklog ? "Already in backlog" : "Add to backlog";
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isInBacklog) return;
      addToBacklog(btn, backlogs);
    });

    row.appendChild(runBtn);
    row.appendChild(addBtn);
    buttonList.appendChild(row);
  });

  // Execute a button action
  async function executeButton(btn, backlogs) {
    showStatus("Getting page info...");

    try {
      const backlog = backlogs[btn.id] || [];

      let content = "";

      if (backlog.length > 0) {
        // Use backlog items as numbered list
        content = backlog.map((item, i) => `${i + 1}. ${item.content}`).join("\n");
      } else {
        // No backlog — get current page content
        content = await getCurrentContent(btn);
        if (!content) {
          showStatus("No content found. Select text or use URL mode.", true);
          return;
        }
      }

      // Send to background script
      browser.runtime.sendMessage({
        action: "executeButton",
        button: btn,
        content: content
      });

      // Clear the backlog for this button after running
      if (backlog.length > 0) {
        delete backlogs[btn.id];
        await browser.storage.local.set({ backlogs });
      }

      showStatus("Opening Claude...");
      setTimeout(() => window.close(), 500);

    } catch (e) {
      showStatus("Error: " + e.message, true);
    }
  }

  // Add current page to a button's backlog
  async function addToBacklog(btn, backlogs) {
    try {
      const content = await getCurrentContent(btn);
      if (!content) {
        showStatus("No content to add.", true);
        return;
      }

      if (!backlogs[btn.id]) backlogs[btn.id] = [];

      // Don't add duplicates
      if (backlogs[btn.id].some((item) => item.content === content)) {
        showStatus("Already in backlog.", false);
        return;
      }

      backlogs[btn.id].push({
        content,
        type: content.startsWith("http") ? "url" : "selection",
        addedAt: Date.now()
      });

      await browser.storage.local.set({ backlogs });
      showStatus(`Added to ${btn.name} backlog (${backlogs[btn.id].length})`);

      // Refresh the popup to update badges and indicators
      setTimeout(() => location.reload(), 600);

    } catch (e) {
      showStatus("Error: " + e.message, true);
    }
  }

  // Get content from the current tab based on button's content mode
  async function getCurrentContent(btn) {
    let content = "";

    if (btn.contentMode === "selection" || btn.contentMode === "auto") {
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
      content = currentTabUrl;
    }

    return content;
  }

  function showStatus(text, isError = false) {
    statusMessage.style.display = "block";
    statusMessage.textContent = text;
    statusMessage.className = "status-message" + (isError ? " error" : "");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Open settings page
  openSettings.addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });
});
