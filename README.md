# Promptly

A Firefox extension that adds one-click Claude AI actions to your toolbar.

Instead of copy-pasting URLs and writing prompts every time, configure custom buttons that automatically send page content to Claude with pre-written prompts.

## Features

- **One-click actions** — each button sends the current page URL or selected text to Claude.ai with a pre-configured prompt
- **Project targeting** — link buttons to specific Claude.ai projects so work goes to the right place
- **Backlog/batch mode** — queue up multiple URLs across browsing sessions, then process them all at once with a single click
- **Fully customizable** — create your own buttons with custom prompt templates using `{content}` placeholders
- **Shareable configs** — export/import button setups as JSON files to share workflows with others
- **Privacy-first** — all data stored locally, nothing sent to external servers

## Install

**From Firefox Add-ons (recommended):**

[Install Promptly from addons.mozilla.org](https://addons.mozilla.org/firefox/addon/promptly-actions/)

**For development:**

1. Clone this repo
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `manifest.json` from the project folder

## How It Works

1. Click the Promptly icon in your Firefox toolbar
2. A dropdown shows your list of action buttons
3. Click a button — it opens Claude.ai with your prompt pre-filled
4. Claude starts working. Check progress anytime in the Claude app

## Button Setup

Each button has:
- **Name** — displayed in the dropdown menu
- **Content mode** — "URL", "Selection", or "Auto" (uses selection if available, otherwise URL)
- **Prompt template** — your prompt with `{content}` where the URL or text gets inserted
- **Project** — optionally target a specific Claude.ai project
- **Auto-send** — automatically send the prompt or pause to review
- **Auto-close** — close the Claude tab after sending (for auto-send buttons)

## Backlog / Batch Mode

Any button can work as a batch processor:
1. Click the **+** icon next to a button to add the current page to its backlog
2. Keep browsing and adding pages
3. When ready, click **Run** — all backlog items get combined into one prompt
4. The backlog clears after processing

## Sharing Button Configs

1. Go to Settings (gear icon in the popup)
2. Click **Export** to save your buttons as a JSON file
3. Share the file — others click **Import** to load your buttons

## Example Use Cases

- **Job hunting** — queue up job postings, then batch-analyze them for fit
- **Research** — one-click to summarize any article or page
- **Content creation** — highlight text and send it to Claude with a rewrite prompt
- **Development** — send error pages or docs to Claude for analysis

## Privacy

Promptly stores all data locally in your browser. No personal data is collected, transmitted, or stored on external servers. The extension only interacts with claude.ai when you click a button.

## License

[Mozilla Public License 2.0](LICENSE)
