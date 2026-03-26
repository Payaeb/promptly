// Promptly — Background Script
// Coordinates between popup, options page, and content scripts

// Default buttons that ship with the extension
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

// Initialize default buttons on first install
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const { buttons } = await browser.storage.local.get("buttons");
    if (!buttons || buttons.length === 0) {
      await browser.storage.local.set({ buttons: DEFAULT_BUTTONS });
    }
  }
});

// Listen for messages from popup or options page
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "executeButton") {
    handleButtonExecution(message.button, message.content);
  }
  if (message.action === "fetchProjects") {
    fetchClaudeProjects().then(sendResponse);
    return true; // keep channel open for async response
  }
});

// Main logic: open claude.ai and send the prompt
async function handleButtonExecution(button, content) {
  const prompt = button.promptTemplate.replace("{content}", content);

  if (button.projectUuid) {
    // Open project page, content script will handle typing + sending
    const tab = await browser.tabs.create({
      url: `https://claude.ai/project/${button.projectUuid}`
    });
    // Wait for tab to load, then send instructions to content script
    browser.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        browser.tabs.onUpdated.removeListener(listener);
        // Small delay to let claude.ai SPA fully render
        setTimeout(() => {
          browser.tabs.sendMessage(tab.id, {
            action: "fillPrompt",
            prompt: prompt,
            autoSend: button.autoSend,
            autoClose: button.autoClose
          });
        }, 2000);
      }
    });
  } else {
    // No project — use ?q= parameter
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://claude.ai/new?q=${encodedPrompt}`;
    const tab = await browser.tabs.create({ url });

    if (button.autoSend) {
      browser.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          browser.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            browser.tabs.sendMessage(tab.id, {
              action: "autoSendOnly",
              autoClose: button.autoClose
            });
          }, 2000);
        }
      });
    }
  }
}

// Fetch the user's Claude projects using their session cookies
async function fetchClaudeProjects() {
  try {
    // First get the organization ID
    const orgResponse = await fetch("https://claude.ai/api/organizations", {
      credentials: "include"
    });
    if (!orgResponse.ok) return { error: "Not logged in to Claude.ai" };
    const orgs = await orgResponse.json();
    if (!orgs || orgs.length === 0) return { error: "No organizations found" };

    const orgId = orgs[0].uuid;

    // Then fetch projects
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
