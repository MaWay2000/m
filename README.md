# codex-autorun

[**Get the extension source**](https://github.com/MaWay2000/m) · [Installation](#install-in-firefox) · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/MaWay2000/m/issues)

A Firefox-compatible WebExtension for tracking tasks on supported ChatGPT/Codex pages, opening them from a popup, and optionally automating parts of the pull-request workflow.

This is a browser extension, not a standalone website. Install it in Firefox using the instructions below.

## Features

- Watch supported task pages and track task history.
- View detected tasks and workflow states in a toolbar popup.
- Open the original task directly from its saved entry.
- Highlight tasks that have finished working.
- Configure optional automation and notification behavior.
- Watch GitHub pull-request pages for supported merge actions.

The extension reads page interfaces rather than providing an authoritative GitHub or task-service API. Site layout changes can affect detection and automated clicks.

## Install in Firefox

1. Clone this repository, or choose **Code → Download ZIP** on GitHub and extract it.
2. Open `about:debugging` in Firefox.
3. Select **This Firefox**.
4. Click **Load Temporary Add-on…**.
5. Choose this repository's `manifest.json`.
6. Open **codex-autorun** from the Extensions menu or toolbar.

A temporary add-on is removed when Firefox restarts. Repeat the loading steps after restarting.

## Basic workflow

1. Load the extension and open a supported task page.
2. Open the extension popup to review the tracked history.
3. Use **Open task** to return to a task.
4. When a task is marked **Task ready to view**, review its result before proceeding.
5. Review the extension settings before enabling any automation.

The popup's **Create PR** action opens the original task and updates its stored workflow status to **PR created**. That status alone is **not proof that GitHub has created a pull request**; check the actual task and PR page.

Optional automation may click controls that create or merge pull requests. Automatic merge behavior is disabled by default. Enable it only for repositories and workflows where you intend those actions, and review changes before merging.

## Settings and access

The extension uses browser storage for its task history and configuration, and requests tab and notification access. Its manifest includes supported ChatGPT/debugging-site pages, with a separate watcher for GitHub pull-request pages.

Review `manifest.json` and the source before installing. Browser-stored history is local to the extension/profile; do not assume that it is a synchronized backup or the source of truth for a task's state.

## Project structure

- `manifest.json`: extension metadata, permissions, scripts, and popup configuration.
- `src/background.js`: persisted history and communication between extension components.
- `src/codexWatcher.js`: supported-page task detection and automation.
- `src/popup.html`, `src/popup.js`, and `src/popup.css`: toolbar popup.
- `src/options.html` and `src/options.js`: settings interface and behavior.
- `src/ghMergeWatcher.js`: GitHub pull-request watcher.
- `CHANGELOG.md`: release history.

## Develop and debug

Open `about:debugging#/runtime/this-firefox`:

- Choose **Reload** beside the extension after editing its files.
- Use **Inspect** to review background-script console output.
- Refresh the affected website tab when testing content-script changes.
- Keep automation disabled while diagnosing unrelated problems.

Test detection, popup navigation, saved history, and any setting you changed. Test merge automation only on a disposable pull request where the action is intended.

### Optional packaging

Use Mozilla's [web-ext tooling](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) to build an archive:

```bash
npm install --global web-ext
web-ext build
```

For normal installation outside the temporary-add-on workflow, follow Mozilla's [extension distribution and signing guidance](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). A locally built archive is not automatically a signed release.

## Release updates and feedback

Record extension release changes in [CHANGELOG.md](CHANGELOG.md) and update the version in `manifest.json`: patch versions for routine fixes, minor versions for new functionality.

[Report problems](https://github.com/MaWay2000/m/issues) with the extension version, Firefox version, affected workflow, and reproduction steps. Do not include private task contents, credentials, or access tokens.
