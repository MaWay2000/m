# Changelog

# 1.1.11 - 2025-09-28
- Added toolbar icon sizes to the manifest icon map so Safari keeps the codex-autorun button visible in the menu bar.

# 1.1.10 - 2025-09-28
- Inject the Codex watcher on debuggpt.tools so new tasks appear in the history again.

# 1.1.9 - 2025-09-28
- Refresh task names while Codex is still working so the popup stays aligned with the UI.

# 1.1.8 - 2025-09-28
- Added dedicated SVG toolbar icons so the codex-autorun button is visible in the menu bar again.

# 1.1.7 - 2025-09-28
- Added explicit 19 px/38 px SVG toolbar icons in the manifest so the browser menu button renders without requiring binary assets.

# 1.1.6 - 2025-09-28
- Replaced the PNG toolbar icons with equivalent SVG assets so the repository no longer depends on binary files.

# 1.1.5 - 2025-09-28
- Added Firefox toolbar icon assets and wired them up in the manifest so the button renders again.

# 1.1.4 - 2025-09-28
- Restore automatic handling of ready Codex tasks by opening them in a new tab and marking them as PR created without opening the popup.

# 1.1.3 - 2025-09-28
- Automatically click the Codex **Create PR** button after opening ready tasks in a new tab.

# 1.1.2 - 2025-09-28
- Automated the **Create PR** action for ready tasks and update their status to **PR created** when successful.

# 1.1.1 - 2025-09-28
- Added popup actions to open ready tasks, trigger the "Create PR" workflow, and mark the status as PR created.
- Introduced new styling for task actions and status badges.
- Granted the extension permission to open task links in new tabs.

# 1.1.0 - 2025-09-28
- Added a Codex page content watcher that scans every three seconds for the "working" status indicator square and reports detected tasks to the background script.
- Persist detected task history in extension storage and expose it through the popup UI.
- Rebuilt the popup to show the tracked task history with refresh controls and improved styling.

## 1.0.2 - 2024-07-06
- Renamed the extension and associated UI text to **codex-autorun**.

## 1.0.1 - 2024-07-06
- Added project update rules documenting version bump expectations and change logging requirements.
