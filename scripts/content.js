// Promptly — Content Script
// Runs on claude.ai pages to fill prompts and click send

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fillPrompt") {
    fillAndSend(message.prompt, message.autoSend, message.autoClose);
  }
  if (message.action === "autoSendOnly") {
    autoSendExisting(message.autoClose);
  }
});

// Fill the prompt into claude.ai's input and optionally send
async function fillAndSend(prompt, autoSend, autoClose) {
  const input = await waitForElement(
    // Claude.ai uses a contenteditable div for input
    'div[contenteditable="true"], textarea, [data-placeholder]',
    10000
  );

  if (!input) {
    console.error("Promptly: Could not find input field on claude.ai");
    return;
  }

  // Focus and fill the input
  input.focus();

  if (input.tagName === "TEXTAREA") {
    input.value = prompt;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    // contenteditable div — use a paragraph element
    input.innerHTML = "";
    const lines = prompt.split("\n");
    lines.forEach((line, i) => {
      const p = document.createElement("p");
      p.textContent = line || "\u200B"; // zero-width space for empty lines
      input.appendChild(p);
    });
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  if (autoSend) {
    // Small delay to let the UI react to the input
    await sleep(500);
    clickSendButton(autoClose);
  }
}

// For ?q= pre-filled chats, just click send
async function autoSendExisting(autoClose) {
  // Wait for the input to be populated by claude.ai
  await sleep(1000);
  clickSendButton(autoClose);
}

// Find and click the send button
function clickSendButton(autoClose) {
  // Claude.ai send button — look for common selectors
  const sendButton = document.querySelector(
    'button[aria-label="Send Message"], button[aria-label="Send message"], button[data-testid="send-button"]'
  );

  if (!sendButton) {
    // Fallback: find a button near the input area that looks like send
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const svg = btn.querySelector("svg");
      // Send buttons typically have an arrow icon and are near the bottom
      if (svg && btn.closest('form, [class*="input"], [class*="composer"]')) {
        btn.click();
        if (autoClose) scheduleClose();
        return;
      }
    }
    console.error("Promptly: Could not find send button");
    return;
  }

  sendButton.click();
  if (autoClose) scheduleClose();
}

// Close the tab after a delay to ensure the message is sent
function scheduleClose() {
  // Wait for the message to be sent and conversation to be created
  setTimeout(() => {
    window.close();
  }, 3000);
}

// Utility: wait for an element to appear in the DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
