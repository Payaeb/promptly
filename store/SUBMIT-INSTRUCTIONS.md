# How to Submit Promptly to Firefox Add-ons

Follow these steps exactly. It should take about 10 minutes.

---

## Step 1: Take Screenshots (5 minutes)

Follow the instructions in `screenshots-guide.md` to take 3 screenshots.
Save them anywhere you can find them.

---

## Step 2: Go to the Submission Page

1. Open Firefox and go to: https://addons.mozilla.org/developers/
2. Log in with your Mozilla account (the one you already created)
3. Click **"Submit a New Add-on"**

---

## Step 3: Upload the Extension

1. Choose **"On this site"** (distribute on addons.mozilla.org)
2. Click **"Select a file"** and choose: `store/promptly-v1.0.0.zip`
3. Wait for validation (should pass with no errors)
4. Click **Continue**

---

## Step 4: Describe Your Add-on

Fill in each field as follows:

**Name:**
```
Promptly — Quick Actions for Claude AI
```

**Add-on URL (slug):**
```
promptly-claude
```

**Summary:**
```
One-click actions for Claude.ai. Send any page URL or selected text to Claude with pre-configured prompts. Queue up links and batch-process them. Fully customizable.
```

**Description:**
Copy the full description from `listing.md` (the section under "Description").

**Categories:**
Select **Productivity**

**Privacy Policy:**
Copy the full text from `privacy-policy.md`
(Or paste a link if you host it somewhere — GitHub, personal site, etc.)

**Tags:**
```
claude, ai, productivity, automation, prompt
```

---

## Step 5: Upload Screenshots

Upload the 3 screenshots you took in Step 1.
Drag them in order: popup first, settings second, editor third.

---

## Step 6: Version Notes

In the "Version Notes" field (what's new for reviewers), write:
```
Initial release of Promptly v1.0.0
```

---

## Step 7: Reviewer Notes

Mozilla reviewers will read this. Paste this:
```
Promptly is a simple browser extension that creates shortcut buttons for Claude.ai.

When a user clicks a button, the extension either:
1. Opens claude.ai/new with a pre-filled prompt via the ?q= URL parameter
2. Opens a claude.ai project page and uses a content script to type the prompt

The extension only interacts with claude.ai. It uses browser.storage.local for all data. No external servers or analytics.

Permissions used:
- activeTab: to read the current page URL and selected text
- storage: to save button configurations locally
- tabs: to open new tabs on claude.ai
- *://claude.ai/*: to run the content script that fills in prompts
```

---

## Step 8: Submit

Click **"Submit Version"**.

That's it! Mozilla will review the extension (usually 1-5 days).
You'll get an email when it's approved.

Your extension will be live at:
**addons.mozilla.org/firefox/addon/promptly-claude/**

---

## After Approval

- Share the link on LinkedIn, social media, etc.
- When you update the extension, re-package and upload a new version
- Users with auto-update enabled will get the new version automatically
