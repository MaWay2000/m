# codex-autorun

This repository contains the codex-autorun Firefox-compatible WebExtension with a background script, a Codex page watcher, and an interactive popup for reviewing detected tasks.

## Project structure

- `manifest.json` – extension manifest referencing the background script and popup UI for codex-autorun
- `src/background.js` – background script that persists detected task history and responds to popup/content requests
- `src/codexWatcher.js` – content script injected into `https://chatgpt.com/codex*` that scans for the "working" square indicator every three seconds and reports new tasks
- `src/popup.html` – popup UI shown when the toolbar button is clicked
- `src/popup.js` – popup script that renders the tracked history and lets the user refresh it on demand
- `src/popup.css` – styles used by the popup

## Popup workflow

When a tracked task leaves the "working" state, the popup now highlights it as **Task ready to view** and provides a **Create PR** action. Clicking the button opens the original task link in a new tab and marks the stored status as **PR created** so you can track which tasks already have pull requests in flight. All other tasks expose an **Open task** action for quick access to their Codex links.

## Load the extension in Firefox

1. Clone this repository and ensure all files are available locally.
2. Open Firefox and navigate to `about:debugging` in the address bar.
3. Select **This Firefox** in the sidebar.
4. Click **Load Temporary Add-on...**.
5. In the file picker, choose the `manifest.json` file from this project.
6. A new toolbar button labelled **codex-autorun** appears. Click it to open the popup and review the tracked task history.

The extension remains installed until you restart Firefox. Repeat the steps above to load it again after restarting the browser.

### Update & debug the temporary add-on

- Open `about:debugging#/runtime/this-firefox` to jump straight to the runtime view the next time you start Firefox.
- After you edit any source files, click **Reload** beside **codex-autorun** in the **Temporary Extensions** list so Firefox picks up your changes without reselecting the manifest.
- Use the **Inspect** button on the same line to launch DevTools for the background page or popup and review console output while you test.
- Click the Extensions (puzzle) button in the Firefox toolbar and choose the pin icon next to **codex-autorun** if you want the button to stay visible.

### Package the extension for reuse (optional)

1. Install the [web-ext CLI](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-installation) (`npm install --global web-ext`).
2. From the project root, run `web-ext build`. The command creates an `.xpi`/`.zip` bundle inside `web-ext-artifacts/`.
3. Submit the generated archive to [Firefox Add-ons](https://addons.mozilla.org/developers/) or run `web-ext sign` with your Firefox Add-ons credentials to produce a signed build that works outside of temporary installations.

## Project update rules

To keep the project history consistent:

1. Document every change in `CHANGELOG.md` with a brief description of what was updated.
2. Update the `version` field in `manifest.json` whenever the project changes.
   - For routine or small adjustments, increment the patch number (`x.x.+1`).
   - For new functions or other major additions, increment the minor number (`x.+1.x`).
