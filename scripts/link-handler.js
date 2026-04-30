(function () {
  "use strict";

  function trimTrailingChars(url) {
    const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
    while (true) {
      let trimmed = false;
      for (const [open, close] of pairs) {
        if (url.endsWith(close)) {
          const opens = (url.match(new RegExp("\\" + open, "g")) || []).length;
          const closes = (url.match(new RegExp("\\" + close, "g")) || []).length;
          if (closes > opens) {
            url = url.slice(0, -1);
            trimmed = true;
          }
        }
      }
      if (!trimmed) break;
    }
    url = url.replace(/[.,;:!?>"']+$/, "");
    return url;
  }

  let lastHoveredLink = null;

  function mouseHandler(e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const anchor = e.target.closest("a[href]");
    if (anchor && /^https?:\/\//i.test(anchor.href)) {
      lastHoveredLink = anchor.href;
    }
  }
  document.addEventListener("mouseover", mouseHandler, true);

  function quickAddViaShortcut() {
    if (!lastHoveredLink) {
      showToast("Hover a link first, then press the shortcut");
      return;
    }
    const href = lastHoveredLink;
    if (!/^https?:\/\//i.test(href)) {
      showToast("Only http/https links can be queued");
      return;
    }
    try {
      browser.runtime
        .sendMessage({ action: "quickAddLink", url: href })
        .then(function (response) {
          if (!response) {
            showToast("Couldn't reach Promptly — try again");
            return;
          }
          if (response.ok) {
            if (response.added > 0) {
              showToast(
                "Added to " + response.buttonName + " (" + response.total + " queued)"
              );
            } else {
              showToast("Already in " + response.buttonName + " backlog");
            }
          } else {
            const err = response.error || "Couldn't reach Promptly — try again";
            if (err === "No quick-add target configured") {
              showToast("Pick a Quick-Add Target — opening Settings…");
              try {
                browser.runtime
                  .sendMessage({ action: "openOptionsPage" })
                  .catch(function () {});
              } catch (e) {
                // ignore
              }
            } else {
              showToast(err);
            }
          }
        })
        .catch(function () {
          showToast("Couldn't reach Promptly — try again");
        });
    } catch (err) {
      showToast("Couldn't reach Promptly — try again");
    }
  }

  function selectionHasLinks() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const text = sel.toString();
      if (!text || !text.trim()) return false;
      for (let i = 0; i < sel.rangeCount; i++) {
        try {
          const fragment = sel.getRangeAt(i).cloneContents();
          if (fragment.querySelector && fragment.querySelector("a[href]")) return true;
        } catch (e) {}
      }
      if (/\bhttps?:\/\//i.test(text)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message) return;
    if (message.action === "quickAddHovered") {
      quickAddViaShortcut();
      return Promise.resolve({ ok: true });
    }
    if (message.action === "checkSelectionLinks") {
      return Promise.resolve({ hasLinks: selectionHasLinks() });
    }
    if (message.action !== "extractLinksFromSelection") return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return Promise.resolve({ links: [], error: "No selection" });
    }

    const text = selection.toString();
    if (!text || !text.trim()) {
      return Promise.resolve({ links: [], error: "No selection" });
    }

    const collected = [];

    for (let i = 0; i < selection.rangeCount; i++) {
      try {
        const range = selection.getRangeAt(i);
        const fragment = range.cloneContents();
        const anchors = fragment.querySelectorAll("a[href]");
        anchors.forEach(function (a) {
          let resolved = "";
          const raw = a.getAttribute("href") || "";
          try {
            resolved = new URL(raw, document.baseURI).href;
          } catch (e) {
            resolved = "";
          }
          if (resolved) collected.push(resolved);
        });
      } catch (e) {
        // skip malformed range
      }
    }

    const urlRegex = /\bhttps?:\/\/[^\s<>"']+/gi;
    const matches = text.match(urlRegex) || [];
    matches.forEach(function (m) {
      const cleaned = trimTrailingChars(m);
      if (cleaned) collected.push(cleaned);
    });

    const seen = new Set();
    const out = [];
    for (const url of collected) {
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= 500) break;
    }

    return Promise.resolve({
      links: out,
      truncated: out.length >= 500 && collected.length > 500
    });
  });

  let toastEl = null;
  let toastTimer = null;
  let toastFadeTimer = null;

  function showToast(text) {
    try {
      if (toastEl && toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
      if (toastTimer) clearTimeout(toastTimer);
      if (toastFadeTimer) clearTimeout(toastFadeTimer);

      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; " +
        "background: #1a1a1a; color: white; padding: 10px 16px; " +
        "border-radius: 6px; font: 14px sans-serif; " +
        "border: 1px solid #444; " +
        "box-shadow: 0 4px 16px rgba(0,0,0,0.5); " +
        "transition: opacity 0.3s; opacity: 1; pointer-events: none;";
      toastEl.textContent = text;

      const host = document.body || document.documentElement;
      if (!host) return;
      host.appendChild(toastEl);

      toastFadeTimer = setTimeout(function () {
        if (toastEl) toastEl.style.opacity = "0";
      }, 1700);
      toastTimer = setTimeout(function () {
        if (toastEl && toastEl.parentNode) {
          toastEl.parentNode.removeChild(toastEl);
        }
        toastEl = null;
      }, 2000);
    } catch (e) {
      // DOM may be unavailable on some pages — ignore
    }
  }
})();
