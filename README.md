# Sample WebExtension

This repository contains a minimal Firefox-compatible WebExtension with a background service worker and an interactive popup.

## Project structure

- `manifest.json` – extension manifest referencing the background service worker and popup UI
- `src/background.js` – background service worker with installation logging and a sample message handler
- `src/popup.html` – popup UI shown when the toolbar button is clicked
- `src/popup.js` – popup script that sends a message to the background worker
- `src/popup.css` – basic styles for the popup

## Load the extension in Firefox

1. Clone this repository and ensure all files are available locally.
2. Open Firefox and navigate to `about:debugging` in the address bar.
3. Select **This Firefox** in the sidebar.
4. Click **Load Temporary Add-on...**.
5. In the file picker, choose the `manifest.json` file from this project.
6. A new toolbar button labelled **Sample Extension** appears. Click it to open the popup and test the ping/pong interaction.

The extension remains installed until you restart Firefox. Repeat the steps above to load it again after restarting the browser.
