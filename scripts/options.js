// Promptly — Options Page Script
// Manages button configuration, project picker, import/export

document.addEventListener("DOMContentLoaded", () => {
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

  let buttons = [];

  // Load and render buttons
  async function loadButtons() {
    const data = await browser.storage.local.get("buttons");
    buttons = (data.buttons || []).sort((a, b) => a.order - b.order);
    renderButtons();
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

  // Open the editor modal
  function openEditor(btn = null) {
    editorTitle.textContent = btn ? "Edit Button" : "Add Button";
    document.getElementById("edit-id").value = btn ? btn.id : "";
    document.getElementById("edit-name").value = btn ? btn.name : "";
    document.getElementById("edit-content-mode").value = btn ? btn.contentMode : "auto";
    document.getElementById("edit-prompt").value = btn ? btn.promptTemplate : "";
    document.getElementById("edit-auto-send").checked = btn ? btn.autoSend : false;
    document.getElementById("edit-auto-close").checked = btn ? btn.autoClose : false;

    // Project field
    projectSelect.style.display = "none";
    projectUuidInput.style.display = "block";
    projectUuidInput.value = btn ? btn.projectUuid || "" : "";
    projectStatus.textContent = "";

    // Auto-close visibility
    autoCloseGroup.style.display = autoSendCheckbox.checked ? "block" : "none";

    editorOverlay.style.display = "flex";
  }

  function closeEditor() {
    editorOverlay.style.display = "none";
  }

  // Save button from form
  async function saveButton(e) {
    e.preventDefault();

    const id = document.getElementById("edit-id").value || generateId();
    const projectValue = projectSelect.style.display !== "none"
      ? projectSelect.value
      : projectUuidInput.value.trim();

    const buttonData = {
      id,
      name: document.getElementById("edit-name").value.trim(),
      contentMode: document.getElementById("edit-content-mode").value,
      promptTemplate: document.getElementById("edit-prompt").value,
      projectUuid: projectValue,
      autoSend: document.getElementById("edit-auto-send").checked,
      autoClose: document.getElementById("edit-auto-close").checked,
      order: 0
    };

    const existingIndex = buttons.findIndex((b) => b.id === id);
    if (existingIndex >= 0) {
      buttonData.order = buttons[existingIndex].order;
      buttons[existingIndex] = buttonData;
    } else {
      buttonData.order = buttons.length;
      buttons.push(buttonData);
    }

    await browser.storage.local.set({ buttons });
    closeEditor();
    renderButtons();
  }

  // Delete a button
  async function deleteButton(id) {
    if (!confirm("Delete this button?")) return;
    buttons = buttons.filter((b) => b.id !== id);
    reindex();
    await browser.storage.local.set({ buttons });
    renderButtons();
  }

  // Move a button up or down
  async function moveButton(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= buttons.length) return;
    [buttons[index], buttons[newIndex]] = [buttons[newIndex], buttons[index]];
    reindex();
    await browser.storage.local.set({ buttons });
    renderButtons();
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

      // Populate dropdown
      projectSelect.innerHTML = '<option value="">No project (new chat)</option>';
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

  // Export buttons as JSON
  function exportButtons() {
    const exportData = {
      promptly_version: "1.0.0",
      exported_at: new Date().toISOString(),
      buttons: buttons.map((b) => ({
        name: b.name,
        contentMode: b.contentMode,
        promptTemplate: b.promptTemplate,
        projectUuid: b.projectUuid,
        autoSend: b.autoSend,
        autoClose: b.autoClose
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "promptly-buttons.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Import buttons from JSON
  async function importButtons(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.buttons || !Array.isArray(data.buttons)) {
        alert("Invalid file. Expected a Promptly export file.");
        return;
      }

      const count = data.buttons.length;
      if (!confirm(`Import ${count} button(s)? This will add them to your existing buttons.`)) return;

      data.buttons.forEach((b) => {
        buttons.push({
          id: generateId(),
          name: b.name || "Imported Button",
          contentMode: b.contentMode || "auto",
          promptTemplate: b.promptTemplate || "",
          projectUuid: b.projectUuid || "",
          autoSend: b.autoSend || false,
          autoClose: b.autoClose || false,
          order: buttons.length
        });
      });

      await browser.storage.local.set({ buttons });
      renderButtons();
      alert(`Imported ${count} button(s) successfully.`);
    } catch (err) {
      alert("Error reading file: " + err.message);
    }

    // Reset file input
    importFile.value = "";
  }

  // Helpers
  function generateId() {
    return "btn-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8);
  }

  function contentModeLabel(mode) {
    const labels = { url: "URL", selection: "Selected text", auto: "Auto" };
    return labels[mode] || mode;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Event listeners
  addButton.addEventListener("click", () => openEditor());
  cancelEdit.addEventListener("click", closeEditor);
  buttonForm.addEventListener("submit", saveButton);
  exportBtn.addEventListener("click", exportButtons);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", importButtons);
  loadProjectsBtn.addEventListener("click", loadProjects);

  autoSendCheckbox.addEventListener("change", () => {
    autoCloseGroup.style.display = autoSendCheckbox.checked ? "block" : "none";
    if (!autoSendCheckbox.checked) {
      document.getElementById("edit-auto-close").checked = false;
    }
  });

  // Close modal on overlay click
  editorOverlay.addEventListener("click", (e) => {
    if (e.target === editorOverlay) closeEditor();
  });

  // Close modal on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEditor();
  });

  // Init
  loadButtons();
});
