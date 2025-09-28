# codex-autorun

This repository contains the codex-autorun Firefox-compatible WebExtension with a background script and an interactive popup.

## Project structure

- `manifest.json` – extension manifest referencing the background script and popup UI for codex-autorun
- `src/background.js` – background script with installation logging and a sample message handler
- `src/popup.html` – popup UI shown when the toolbar button is clicked
- `src/popup.js` – popup script that sends a message to the background worker
- `src/popup.css` – basic styles for the popup

## Load the extension in Firefox

1. Clone this repository and ensure all files are available locally.
2. Open Firefox and navigate to `about:debugging` in the address bar.
3. Select **This Firefox** in the sidebar.
4. Click **Load Temporary Add-on...**.
5. In the file picker, choose the `manifest.json` file from this project.
6. A new toolbar button labelled **codex-autorun** appears. Click it to open the popup and test the ping/pong interaction.

The extension remains installed until you restart Firefox. Repeat the steps above to load it again after restarting the browser.

## Project update rules

To keep the project history consistent:

1. Document every change in `CHANGELOG.md` with a brief description of what was updated.
2. Update the `version` field in `manifest.json` whenever the project changes.
   - For routine or small adjustments, increment the patch number (`x.x.+1`).
   - For new functions or other major additions, increment the minor number (`x.+1.x`).
