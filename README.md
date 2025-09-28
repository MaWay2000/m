# codex-autorun

This repository contains the codex-autorun Firefox-compatible WebExtension with a background script, a Codex page watcher, and an interactive popup for reviewing detected tasks.

## Project structure

- `manifest.json` – extension manifest referencing the background script and popup UI for codex-autorun
- `src/background.js` – background script that persists detected task history and responds to popup/content requests
- `src/codexWatcher.js` – content script injected into `https://chatgpt.com/codex*` that scans for the "working" square indicator every three seconds and reports new tasks
- `src/popup.html` – popup UI shown when the toolbar button is clicked
- `src/popup.js` – popup script that renders the tracked history and lets the user refresh it on demand
- `src/popup.css` – styles used by the popup

## Load the extension in Firefox

1. Clone this repository and ensure all files are available locally.
2. Open Firefox and navigate to `about:debugging` in the address bar.
3. Select **This Firefox** in the sidebar.
4. Click **Load Temporary Add-on...**.
5. In the file picker, choose the `manifest.json` file from this project.
6. A new toolbar button labelled **codex-autorun** appears. Click it to open the popup and review the tracked task history.

The extension remains installed until you restart Firefox. Repeat the steps above to load it again after restarting the browser.

## Project update rules

To keep the project history consistent:

1. Document every change in `CHANGELOG.md` with a brief description of what was updated.
2. Update the `version` field in `manifest.json` whenever the project changes.
   - For routine or small adjustments, increment the patch number (`x.x.+1`).
   - For new functions or other major additions, increment the minor number (`x.+1.x`).
