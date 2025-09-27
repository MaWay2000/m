# Auto PR: Chime & Click

Auto PR is a Firefox extension that turns Codex task triage and GitHub pull-request handling into a mostly hands-free experience. It watches the ChatGPT Codex task feed for brand-new work, opens the task, marches through Create PR → View PR → Merge → Confirm merge buttons with configurable delays, and keeps every tab in sync with a shared flow timeline, notifications, and audible cues.

## Key capabilities

- **Automatic task pickup** – Scans the Codex task list for “just now” items (or the first visible task) and opens them after an optional delay, in a new window if desired, while recording task IDs to avoid repeats.
- **Guided PR workflow** – On the task page it auto-clicks **Create PR**, opens the **View PR** link in a fresh tab, and (when enabled) auto-clicks **Merge pull request** and **Confirm merge** on GitHub with per-step delay controls.
- **Cross-tab timeline** – Injects a floating timeline overlay showing the current stage (`task open`, `Create PR`, `View PR`, `Merge PR`, `Confirm merge`) and syncs progress across tabs so the automation respects strict ordering when configured.
- **History and approvals** – Persists task history, recently approved merge URLs, and the latest flow state in extension storage so background, popup, and content scripts share context.
- **Signals and safeguards** – Plays chimes and desktop notifications at each automated step, optionally closes tabs after completing View/Merge stages, and exposes strict-order toggles to keep the automation predictable.

## Controls & configuration

Open the extension popup or options page to tune behavior without editing code:

- Toggle each automation stage (open task, create, view, merge, confirm) individually.
- Choose delays (1–60 seconds) and enable/disable per-stage audio cues.
- Decide whether new tasks open in a separate window, steal focus, or require a “just now” badge.
- Enable strict ordering to ensure downstream steps wait for upstream ones, and surface a task history viewer with clearing tools.
- Turn on the floating timeline overlay and debugging logs for deeper visibility.

All preferences are stored via `browser.storage.local`, so they persist across sessions and sync when Firefox Sync is enabled.

## Installation

1. Clone or download this repository.
2. Open Firefox and visit `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select this directory’s `manifest.json` file.
4. Use the toolbar button to open the popup or **Manage Extension** to reach the full options page and configure delays, sounds, and automation stages.

## Development notes

- `background.js` maintains shared state (current task, flow stage, approval list, task history) and responds to messages from content and UI scripts. It also handles notifications, chimes, and tab management.
- `content.js` injects into `chatgpt.com` and `github.com`, watching for DOM mutations so it can trigger automation steps, mount the timeline overlay, and coordinate with the background script.
- `popup.js` and `options.js` present the live settings, history viewer, and reset controls that write to shared storage.
- Run `web-ext run` or `web-ext build` from the repository root to test or package the extension.

## Permissions

The extension requests access to `chatgpt.com` and `github.com` domains, tabs, notifications, and storage so it can monitor Codex tasks, orchestrate PR pages, show alerts, and persist shared automation state.
