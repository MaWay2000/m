# Changelog

# 1.1.24 - 2025-09-30

- Added `test4.txt`, a placeholder text asset used to verify repository
  updates that include simple documentation files.

# 1.1.23 - 2025-09-30

- Renamed the **PR created** status label to **PR ready to view** across the
  extension, ensuring notifications, logs, and settings all reflect the updated
  wording.

# 1.1.22 - 2025-09-30

- **Manifest fix for Firefox:** The previous release added a `windows` permission
  to the manifest to support the preview window feature. Firefox does not
  recognise this permission and rejected the add‑on. The `browser.windows`
  API is available without an explicit permission on Firefox, so the
  unnecessary entry has been removed. Bumped the version to **1.1.22**
  accordingly.


# 1.1.21 - 2025-09-30

- **Configurable pop‑up appearance:** Added a new section to the settings page
  allowing you to customise where the in‑extension notification pop‑up
  appears, how large it is and what colours it uses. The new
  **Edit position and size** button launches a resizable preview window; move
  and resize it to your preferred location and close it to persist the
  changes. You can also pick background and text colours using colour
  pickers and save them independently. These settings apply to all
  future notifications and are stored in extension storage.

- Internally introduced new storage keys for the pop‑up position
  (`codexNotificationPopupPosition`), size (`codexNotificationPopupSize`) and
  colours (`codexNotificationPopupColors`). The background script now
  respects these values when creating the custom notification window.

- Added the `windows` permission to the manifest so the extension can
  monitor and persist the preview window’s bounds. Bumped the version to
  **1.1.21** accordingly.

# 1.1.18 - 2025-09-30
- Added a **Test notification** button to the settings page. This button
  triggers a sample browser notification using your current notification
  preferences, including the selected statuses and sound settings, so
  you can verify that alerts are configured to your liking.
- Removed the built‑in notification sound from all extension alerts. The
  extension now sets notifications to be silent and plays only the
  selected custom sound (if any), preventing duplicate sounds when a
  custom alert is configured or the default sound is muted.

# 1.1.19 - 2025-09-30
- Restored notification popups on Firefox by removing the unsupported
  `silent` option from the notification API. In some browsers the
  `silent` field is recognised and suppresses the default system sound,
  but Firefox does not implement this feature and will ignore the
  notification entirely when unknown properties are provided.
- As a result, the default system sound may continue to play along
  with any custom alert. To mute the system sound on Windows, adjust
  the Firefox notification settings in your operating system's control
  panel. The extension continues to play custom sounds only when
  enabled in the preferences.

# 1.1.20 - 2025-09-30

- **Custom notification pop‑up:** Replaced system notifications with an
  in‑extension pop‑up window. When a task changes status the extension
  opens a small window displaying the task name and status label. Any
  configured sound plays inside the pop‑up, and the window closes
  automatically once the sound finishes or after a short delay if no
  sound is selected. Clicking the pop‑up opens the associated task in
  a new tab.
- The pop‑up runs entirely within the extension so it never triggers the
  host operating system’s default chime. You no longer need to adjust
  OS‑level notification settings to silence codex‑autorun alerts.

# 1.1.17 - 2025-09-28
- Added a settings toggle to mute the default notification sound unless a custom alert is chosen.

# 1.1.16 - 2025-09-28
- Renamed the Ready status label across the extension to **Task ready to view** so notifications and settings reflect the new wording.

# 1.1.15 - 2025-09-28
- Added notification sound preferences to the settings page so you can choose which task statuses play audio alerts.

# 1.1.14 - 2025-09-28
- Allow the toolbar icon to unpin immediately when the options toggle is unchecked.

# 1.1.13 - 2025-09-28
- Removed the smart check action from the popup and background services.

# 1.1.12 - 2025-09-28
- Added a smart check action for in-progress tasks that asks the active Codex tab to verify their latest status.
- Allow the popup to show feedback when a smart check completes or fails.

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
- Restore automatic handling of ready Codex tasks by opening them in a new tab and marking them as PR ready to view without opening the popup.

# 1.1.3 - 2025-09-28
- Automatically click the Codex **Create PR** button after opening ready tasks in a new tab.

# 1.1.2 - 2025-09-28
- Automated the **Create PR** action for ready tasks and update their status to **PR ready to view** when successful.

# 1.1.1 - 2025-09-28
- Added popup actions to open ready tasks, trigger the "Create PR" workflow, and mark the status as PR ready to view.
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
