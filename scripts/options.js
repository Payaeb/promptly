// Promptly — Options Page Script
// Manages button configuration, project picker, import/export

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

document.addEventListener("DOMContentLoaded", async () => {
  await detectPlatform();

  const quickAddSection = document.getElementById("quick-add-section");
  const androidShortcutInfo = document.getElementById("android-shortcut-info");
  if (isAndroid) {
    if (quickAddSection) quickAddSection.hidden = true;
    if (androidShortcutInfo) androidShortcutInfo.hidden = false;
  }

  const buttonsContainer = document.getElementById("buttons-container");
  const noButtons = document.getElementById("no-buttons");
  const addButton = document.getElementById("add-button");
  const editorOverlay = document.getElementById("editor-overlay");
  const editorTitle = document.getElementById("editor-title");
  const buttonForm = document.getElementById("button-form");
  const cancelEdit = document.getElementById("cancel-edit");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFile = document.getElementById("import-file");
  const autoSendCheckbox = document.getElementById("edit-auto-send");
  const autoCloseGroup = document.getElementById("auto-close-group");
  const loadProjectsBtn = document.getElementById("load-projects-btn");
  const projectSelect = document.getElementById("edit-project-select");
  const projectUuidInput = document.getElementById("edit-project-uuid");
  const projectStatus = document.getElementById("project-status");
  const quickAddTargetSelect = document.getElementById("quick-add-target");
  const quickAddEmptyHelp = document.getElementById("quick-add-empty-help");

  let buttons = [];
  let quickAddTarget = "";
  let editorDirty = false;

  async function persistButtons() {
    const response = await browser.runtime.sendMessage({ action: "saveButtons", buttons });
    if (!response || !response.ok) {
      alert("Couldn't save: " + ((response && response.error) || "unknown error"));
      return false;
    }
    return true;
  }

  async function persistQuickAddTarget(value) {
    const response = await browser.runtime.sendMessage({ action: "saveQuickAddTarget", quickAddTarget: value });
    if (!response || !response.ok) {
      alert("Couldn't save: " + ((response && response.error) || "unknown error"));
      return false;
    }
    return true;
  }

  // Load and render buttons
  async function loadButtons() {
    const data = await browser.storage.local.get(["buttons", "quickAddTarget"]);
    buttons = (data.buttons || []).sort((a, b) => a.order - b.order);
    quickAddTarget = data.quickAddTarget || "";
    renderButtons();
    await renderQuickAddTarget();
  }

  async function renderQuickAddTarget() {
    if (!quickAddTargetSelect) return;
    while (quickAddTargetSelect.firstChild) {
      quickAddTargetSelect.removeChild(quickAddTargetSelect.firstChild);
    }
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "None — disables quick-add shortcut";
    quickAddTargetSelect.appendChild(noneOpt);

    buttons.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      quickAddTargetSelect.appendChild(opt);
    });

    const stillExists = quickAddTarget && buttons.some((b) => b.id === quickAddTarget);
    if (quickAddTarget && !stillExists) {
      const cleared = await persistQuickAddTarget("");
      if (cleared) {
        quickAddTarget = "";
      } else {
        console.warn("[Promptly] Failed to clear stale quickAddTarget; will retry on next save.");
      }
    }
    quickAddTargetSelect.value = quickAddTarget;

    if (buttons.length === 0) {
      quickAddTargetSelect.style.display = "none";
      if (quickAddEmptyHelp) quickAddEmptyHelp.style.display = "block";
    } else {
      quickAddTargetSelect.style.display = "";
      if (quickAddEmptyHelp) quickAddEmptyHelp.style.display = "none";
    }
  }

  function renderButtons() {
    while (buttonsContainer.firstChild) buttonsContainer.removeChild(buttonsContainer.firstChild);

    if (buttons.length === 0) {
      noButtons.style.display = "block";
      return;
    }

    noButtons.style.display = "none";

    buttons.forEach((btn, index) => {
      const card = document.createElement("div");
      card.className = "button-card";

      // Info section
      const info = document.createElement("div");
      info.className = "button-card-info";

      const name = document.createElement("div");
      name.className = "button-card-name";
      name.textContent = btn.name;
      info.appendChild(name);

      const details = document.createElement("div");
      details.className = "button-card-details";

      const modeTag = document.createElement("span");
      modeTag.className = "tag";
      modeTag.textContent = contentModeLabel(btn.contentMode);
      details.appendChild(modeTag);

      if (btn.projectUuid) {
        const projTag = document.createElement("span");
        projTag.className = "tag tag-project";
        projTag.textContent = "Project";
        details.appendChild(projTag);
      }
      if (btn.autoSend) {
        const sendTag = document.createElement("span");
        sendTag.className = "tag tag-auto";
        sendTag.textContent = "Auto-send";
        details.appendChild(sendTag);
      }
      if (btn.autoClose) {
        const closeTag = document.createElement("span");
        closeTag.className = "tag tag-auto";
        closeTag.textContent = "Auto-close";
        details.appendChild(closeTag);
      }
      info.appendChild(details);

      const prompt = document.createElement("div");
      prompt.className = "button-card-prompt";
      prompt.textContent = btn.promptTemplate.substring(0, 120) + (btn.promptTemplate.length > 120 ? "..." : "");
      info.appendChild(prompt);

      card.appendChild(info);

      // Actions section
      const actions = document.createElement("div");
      actions.className = "button-card-actions";

      function addActionBtn(label, action, extraClass) {
        const b = document.createElement("button");
        b.className = "btn btn-icon" + (extraClass ? " " + extraClass : "");
        b.title = action;
        b.textContent = label;
        b.addEventListener("click", () => {
          if (action === "edit") openEditor(btn);
          if (action === "delete") deleteButton(btn.id);
          if (action === "move-up") moveButton(index, -1);
          if (action === "move-down") moveButton(index, 1);
        });
        actions.appendChild(b);
      }

      if (index > 0) addActionBtn("\u2191", "move-up");
      if (index < buttons.length - 1) addActionBtn("\u2193", "move-down");
      addActionBtn("\u270E", "edit");
      addActionBtn("\u2715", "delete", "btn-danger");

      card.appendChild(actions);
      buttonsContainer.appendChild(card);
    });
  }

  let modalHistoryPushed = false;

  function openEditor(btn = null) {
    editorTitle.textContent = btn ? "Edit Button" : "Add Button";
    document.getElementById("edit-id").value = btn ? btn.id : "";
    document.getElementById("edit-name").value = btn ? btn.name : "";
    document.getElementById("edit-content-mode").value = btn ? btn.contentMode : "auto";
    document.getElementById("edit-prompt").value = btn ? btn.promptTemplate : "";
    document.getElementById("edit-auto-send").checked = btn ? btn.autoSend : false;
    document.getElementById("edit-auto-close").checked = btn ? btn.autoClose : false;

    projectSelect.style.display = "none";
    projectUuidInput.style.display = "block";
    projectUuidInput.value = btn ? btn.projectUuid || "" : "";
    projectStatus.textContent = "";

    autoCloseGroup.style.display = autoSendCheckbox.checked ? "block" : "none";

    editorOverlay.style.display = "flex";
    editorDirty = false;

    if (isAndroid && !modalHistoryPushed) {
      history.pushState({ promptlyModal: true }, "");
      modalHistoryPushed = true;
    }
  }

  function tryCloseEditor(fromPopstate = false) {
    if (editorDirty) {
      if (!confirm("Discard unsaved changes?")) return false;
    }
    editorDirty = false;
    closeEditor(fromPopstate);
    return true;
  }

  function closeEditor(fromPopstate = false) {
    editorOverlay.style.display = "none";
    if (isAndroid && modalHistoryPushed) {
      modalHistoryPushed = false;
      // When closing via popstate the history entry is already consumed,
      // so calling history.back() would navigate away from the page.
      if (!fromPopstate && history.state && history.state.promptlyModal) {
        history.back();
      }
    }
  }

  window.addEventListener("popstate", () => {
    if (!isAndroid) return;
    if (editorOverlay.style.display === "none") return;
    if (!tryCloseEditor(true)) {
      history.pushState({ promptlyModal: true }, "");
      modalHistoryPushed = true;
    }
  });

  // Save button from form
  async function saveButton(e) {
    e.preventDefault();

    const id = document.getElementById("edit-id").value || generateId();
    const projectValue = projectSelect.style.display !== "none"
      ? projectSelect.value
      : projectUuidInput.value.trim();

    const promptTemplate = document.getElementById("edit-prompt").value;
    if (!promptTemplate.includes("{content}")) {
      if (!confirm("This prompt has no {content} placeholder — the URL/selection won't be inserted. Save anyway?")) {
        return;
      }
    }

    const buttonData = {
      id,
      name: document.getElementById("edit-name").value.trim(),
      contentMode: document.getElementById("edit-content-mode").value,
      promptTemplate: promptTemplate,
      projectUuid: projectValue,
      autoSend: document.getElementById("edit-auto-send").checked,
      autoClose: document.getElementById("edit-auto-close").checked,
      order: 0
    };

    const existingIndex = buttons.findIndex((b) => b.id === id);
    const snapshot = buttons.map((b) => ({ ...b }));
    if (existingIndex >= 0) {
      buttonData.order = buttons[existingIndex].order;
      buttons[existingIndex] = buttonData;
    } else {
      buttonData.order = buttons.length;
      buttons.push(buttonData);
    }

    const ok = await persistButtons();
    if (!ok) {
      buttons.length = 0;
      buttons.push(...snapshot);
      return;
    }
    editorDirty = false;
    closeEditor();
    renderButtons();
    await renderQuickAddTarget();
  }

  // Delete a button
  async function deleteButton(id) {
    if (!confirm("Delete this button?")) return;
    const snapshot = buttons.map((b) => ({ ...b }));
    const previousQuickAdd = quickAddTarget;
    const filtered = buttons.filter((b) => b.id !== id);
    buttons.length = 0;
    buttons.push(...filtered);
    reindex();
    const ok = await persistButtons();
    if (!ok) {
      buttons.length = 0;
      buttons.push(...snapshot);
      return;
    }
    if (previousQuickAdd === id) {
      quickAddTarget = "";
      const cleared = await persistQuickAddTarget("");
      if (!cleared) {
        quickAddTarget = previousQuickAdd;
        console.warn("[Promptly] Failed to clear quickAddTarget after button delete; will retry on next save.");
      }
    }
    try {
      await browser.runtime.sendMessage({ action: "deleteBacklog", buttonId: id });
    } catch (e) {
      console.warn("[Promptly] Failed to remove orphan backlog for deleted button:", e);
    }
    renderButtons();
    await renderQuickAddTarget();
  }

  // Move a button up or down
  async function moveButton(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= buttons.length) return;
    const snapshot = buttons.map((b) => ({ ...b }));
    [buttons[index], buttons[newIndex]] = [buttons[newIndex], buttons[index]];
    reindex();
    const ok = await persistButtons();
    if (!ok) {
      buttons.length = 0;
      buttons.push(...snapshot);
      return;
    }
    renderButtons();
    await renderQuickAddTarget();
  }

  function reindex() {
    buttons.forEach((b, i) => (b.order = i));
  }

  // Project picker
  async function loadProjects() {
    loadProjectsBtn.disabled = true;
    projectStatus.textContent = "Loading projects...";

    try {
      const response = await browser.runtime.sendMessage({ action: "fetchProjects" });

      if (response.error) {
        projectStatus.textContent = response.error;
        loadProjectsBtn.disabled = false;
        return;
      }

      if (!response.projects || response.projects.length === 0) {
        projectStatus.textContent = "No projects found.";
        loadProjectsBtn.disabled = false;
        return;
      }

      while (projectSelect.firstChild) projectSelect.removeChild(projectSelect.firstChild);
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "No project (new chat)";
      projectSelect.appendChild(noneOpt);
      response.projects.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.uuid;
        opt.textContent = p.name;
        projectSelect.appendChild(opt);
      });

      // Pre-select current value
      const currentUuid = projectUuidInput.value.trim();
      if (currentUuid) projectSelect.value = currentUuid;

      projectSelect.style.display = "block";
      projectUuidInput.style.display = "none";
      projectStatus.textContent = `Found ${response.projects.length} project(s)`;
      loadProjectsBtn.disabled = false;
    } catch (e) {
      projectStatus.textContent = "Error loading projects.";
      loadProjectsBtn.disabled = false;
    }
  }

  function exportButtons() {
    const exportData = {
      promptly_version: "1.2.0",
      exported_at: new Date().toISOString(),
      buttons: buttons.map((b) => ({
        name: b.name,
        contentMode: b.contentMode,
        promptTemplate: b.promptTemplate,
        projectUuid: b.projectUuid,
        autoSend: b.autoSend,
        autoClose: b.autoClose
      })),
      quickAddTarget: quickAddTarget || ""
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "promptly-buttons.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function isValidImportButton(b) {
    if (!b || typeof b !== "object") return false;
    if (typeof b.name !== "string" || b.name.length < 1 || b.name.length > 200) return false;
    const validModes = ["auto", "url", "selection"];
    if (validModes.indexOf(b.contentMode) < 0) return false;
    if (typeof b.promptTemplate !== "string" || b.promptTemplate.length > 100000) return false;
    if (b.projectUuid !== undefined && b.projectUuid !== null && b.projectUuid !== "") {
      if (typeof b.projectUuid !== "string") return false;
      if (!/^[a-f0-9-]{32,40}$/i.test(b.projectUuid)) return false;
    }
    return true;
  }

  // Import buttons from JSON
  async function importButtons(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (text.length > 5_000_000) {
        alert("File too large (5MB cap).");
        importFile.value = "";
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        alert("Invalid file format: not valid JSON.");
        importFile.value = "";
        return;
      }

      if (!data || typeof data !== "object" || !Array.isArray(data.buttons)) {
        alert("Invalid file format.");
        importFile.value = "";
        return;
      }

      const total = data.buttons.length;
      if (!confirm(`Import ${total} button(s)? This will add them to your existing buttons.`)) {
        importFile.value = "";
        return;
      }

      const snapshot = buttons.map((b) => ({ ...b }));

      // Resolve the import's quickAddTarget by NAME, since the original id from
      // the export will not match — every imported button gets a fresh id below.
      let restoredQuickAddTargetName = null;
      if (typeof data.quickAddTarget === "string" && data.quickAddTarget) {
        const oldTargetButton = data.buttons.find((b) => b && b.id === data.quickAddTarget);
        if (oldTargetButton && typeof oldTargetButton.name === "string") {
          restoredQuickAddTargetName = oldTargetButton.name;
        }
      }

      let imported = 0;
      let skipped = 0;
      const newlyImported = [];
      data.buttons.forEach((b) => {
        if (!isValidImportButton(b)) {
          skipped++;
          return;
        }
        const fresh = {
          id: generateId(),
          name: b.name,
          contentMode: b.contentMode,
          promptTemplate: b.promptTemplate,
          projectUuid: b.projectUuid || "",
          autoSend: b.autoSend === true,
          autoClose: b.autoClose === true,
          order: buttons.length
        };
        buttons.push(fresh);
        newlyImported.push(fresh);
        imported++;
      });

      const ok = await persistButtons();
      if (!ok) {
        buttons.length = 0;
        buttons.push(...snapshot);
        importFile.value = "";
        return;
      }

      if (restoredQuickAddTargetName) {
        const newTarget = newlyImported.find((b) => b.name === restoredQuickAddTargetName);
        if (newTarget) {
          const qOk = await persistQuickAddTarget(newTarget.id);
          if (qOk) quickAddTarget = newTarget.id;
        }
      }

      renderButtons();
      await renderQuickAddTarget();
      if (skipped > 0) {
        alert(`Imported ${imported} of ${total} buttons; ${skipped} skipped (invalid).`);
      } else {
        alert(`Imported ${imported} button(s) successfully.`);
      }
    } catch (err) {
      alert("Error reading file: " + err.message);
    }

    // Reset file input
    importFile.value = "";
  }

  // Helpers
  function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return "btn-" + crypto.randomUUID();
    }
    return "btn-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8);
  }

  function contentModeLabel(mode) {
    const labels = { url: "URL", selection: "Selected text", auto: "Selection or URL" };
    return labels[mode] || mode;
  }

  const modalCloseBtn = document.getElementById("modal-close");
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => tryCloseEditor());
  }

  const dirtyFieldIds = [
    "edit-name",
    "edit-prompt",
    "edit-content-mode",
    "edit-project-uuid",
    "edit-project-select",
    "edit-auto-send",
    "edit-auto-close"
  ];
  dirtyFieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => { editorDirty = true; });
    el.addEventListener("change", () => { editorDirty = true; });
  });

  // Event listeners
  addButton.addEventListener("click", () => openEditor());
  cancelEdit.addEventListener("click", () => tryCloseEditor());
  buttonForm.addEventListener("submit", saveButton);
  exportBtn.addEventListener("click", exportButtons);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", importButtons);
  loadProjectsBtn.addEventListener("click", loadProjects);

  if (quickAddTargetSelect) {
    quickAddTargetSelect.addEventListener("change", async () => {
      const previous = quickAddTarget;
      quickAddTarget = quickAddTargetSelect.value || "";
      const ok = await persistQuickAddTarget(quickAddTarget);
      if (!ok) {
        quickAddTarget = previous;
        quickAddTargetSelect.value = previous;
      }
    });
  }

  autoSendCheckbox.addEventListener("change", () => {
    autoCloseGroup.style.display = autoSendCheckbox.checked ? "block" : "none";
    if (!autoSendCheckbox.checked) {
      document.getElementById("edit-auto-close").checked = false;
    }
  });

  // Close modal on overlay click
  editorOverlay.addEventListener("click", (e) => {
    if (e.target === editorOverlay) tryCloseEditor();
  });

  // Close modal on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editorOverlay.style.display === "flex") tryCloseEditor();
  });

  // Init
  loadButtons();
});
