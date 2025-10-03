# Changelog

# 1.1.39 - 2025-10-02

* **Manual override for GitHub merge automation:** The GitHub content script
  now listens for user interactions—mouse clicks, scrolling and key
  presses—before automatically merging a pull request. If any interaction is
  detected, the script cancels further auto-clicking (including the optional
  post-merge tab close) for the current page load so you can finish the merge
  manually.

* **Version bumped to 1.1.39.**

# 1.1.38 - 2025-10-02

* **Simplified status table:** Removed the “Merged” row from the
  notification preferences table. The extension no longer exposes
  auto‑click, popup or sound controls for the merged status, since
  merging is now handled by the GitHub automation features.

* **Wider settings layout:** Increased the maximum width of the
  settings page to 720 px. This prevents the GitHub automation
  controls from wrapping and makes the table easier to read.

* **Refined GitHub automation UI:** Replaced the previous stacked
  checkboxes for GitHub merge automation with a two‑column grid. The
  options “Auto‑click ‘Merge pull request’ button” and “Auto‑click
  ‘Confirm merge’ button” now align neatly with their toggles. A
  separate row labelled “Close GitHub window when Confirm merge
  clicked” is presented beneath these options, styled similarly to
  the “Close task window when PR ready to view” row. This makes the
  close behaviour more discoverable and consistent with other close
  options.

* **Version bumped to 1.1.38.**

# 1.1.37 - 2025-10-02

* **Automatic merging on GitHub:** Added a new section in the options page
  labelled “GitHub merge automation” that allows users to enable
  automatic clicks on the **Merge pull request** and **Confirm merge**
  buttons when viewing a GitHub PR. These actions are disabled by
  default and can be toggled independently. When enabled, the
  extension’s new `ghMergeWatcher.js` content script runs on
  `github.com` pages, detects the merge controls and triggers them
  automatically. After confirming the merge, the script can optionally
  close the GitHub tab; this behaviour is also configurable via a
  checkbox in the same section.

* **New storage keys:**
  - `codexMergePrAutoClickEnabled` – Whether to auto-click the
    **Merge pull request** button.
  - `codexConfirmMergeAutoClickEnabled` – Whether to auto-click the
    **Confirm merge** button.
  - `codexCloseGithubAfterMergeEnabled` – Whether to close the
    GitHub tab after the merge is confirmed.

* **GitHub content script and background integration:** A new
  `ghMergeWatcher.js` content script is injected into `github.com` pages
  to implement the merge automation. It listens to the new
  preferences via storage and uses interval polling to locate the
  relevant buttons. The background script listens for a
  `close-github-tab` message from this script and removes the sending
  tab when requested.

* **Options UI enhancements:** The settings page now includes a
  dedicated “GitHub merge automation” section with three checkboxes for
  controlling the new behaviours. Preferences are loaded on page
  initialisation and saved when toggles are changed. Informative
  status messages indicate when each setting is applied.

* **Version bumped to 1.1.37.**

# 1.1.36 - 2025-10-02

* **Integrate close‑tab option into PR ready row:** Refactored the notification
  preferences table so that the “Close task window when PR ready to view”
  checkbox is part of the **PR ready to view (Open github)** section rather
  than a separate column. The table now has four columns (status, auto‑click,
  show popup and play sound) and the close‑tab option appears directly
  beneath the PR ready row, spanning the first three columns for its
  description and using the fourth column for the toggle. Disabled close‑tab
  checkboxes for other statuses were removed. Renamed the option to
  “Close task window when PR ready to view” for clarity.

* **Version bumped to 1.1.36.**

# 1.1.33 - 2025-10-02

* **Configurable delay before auto‑clicking View PR:** Introduced a new setting
  labelled “PR ready auto‑click delay” that lets users specify how long to
  wait (in seconds) after a pull request becomes ready before the extension
  automatically clicks the **View PR** link. The delay defaults to 3 seconds
  and can be adjusted via the options page. The value is stored under
  `codexPrReadyAutoClickDelayMs` and used by the content script when
  auto‑clicking the **View PR** button. The click now respects this delay
  instead of firing immediately.

* **Eliminate unnecessary tabs for PR ready:** When a pull request becomes
  ready, the background script no longer opens the Codex task page in a
  separate tab. Instead, the content script waits for the **View PR**
  link to appear on the existing page and clicks it after the configured
  delay. This prevents the extension from spawning extra tabs during the
  PR ready workflow.

  Version bumped to **1.1.33**.

# 1.1.34 - 2025-10-02

* **Avoid duplicate tabs for tasks and PRs:** Updated the helper that
  opens Codex tasks (`openTaskInNewTab`) to first search for an existing
  tab with the same URL. If found, the existing tab is activated instead
  of creating a new one. This prevents multiple task pages from opening
  when the autorun workflow receives duplicate events or when the user
  interacts with notifications repeatedly.

* **Consistent PR auto‑click behaviour:** Removed the final automatic
  opening of the task page when a pull request transitions to
  `pr-ready` from `updateHistory`. Combined with the tab‑deduplication
  logic, this ensures that the **View PR** link is clicked exactly once
  per pull request and does not spawn extra tabs.

  Version bumped to **1.1.34**.

# 1.1.35 - 2025-10-02

* **Clarify PR ready label and closing tab option:** Renamed the
  **PR ready to view** status to **PR ready to view (Open github)** across
  the settings UI and internal labels to make it clear that this action
  opens the pull request on GitHub. Added a new “Close tab” column to the
  notification settings table with a checkbox specific to the pr-ready
  status. When enabled, the extension will close the Codex task tab
  automatically once the pull request is ready and the PR page has been
  opened. The preference is stored under `codexPrReadyCloseTab` and can
  be toggled alongside other notification settings.

* **Ignore additional noise phrases in task names:** Extended the
  sanitisation rules to strip out “checking git status” and repository
  identifiers (e.g. “MaWay2000/m”) from detected task names. This
  prevents irrelevant UI text from appearing in the task history.

  Version bumped to **1.1.35**.

# 1.1.31 - 2025-10-02

* **Granular control over auto‑click, popups and sounds:** The settings page has
  been redesigned with a table that exposes three independent controls for each
  task status (Task ready to view, PR created, PR ready to view and Merged).
  Users can now separately enable or disable automatic clicks (opening tasks
  and creating pull requests), showing a popup notification, and playing a
  custom sound. A new storage key, `codexAutoClickStatuses`, and default
  configuration (`ready` and `pr-created`) persist the auto‑click preferences.
  The options UI reads and writes these values alongside existing notification
  and sound settings.

* **Respect auto‑click preferences:** The background script now consults the
  auto‑click settings before automatically opening tasks or creating pull
  requests. If auto‑click is disabled for the **Task ready to view** status,
  the autorun feature will not open the task automatically. If disabled for
  **PR created**, the extension will no longer auto‑click the **Create PR**
  button or schedule the PR‑ready notification. In addition, the content
  script’s auto‑click logic now reads the same preferences from storage
  before attempting to click the **Create PR** button, preventing unintended
  actions when auto‑click is disabled.

  Version bumped to **1.1.31**.

# 1.1.32 - 2025-10-02

* **Rename PR status for clarity:** The status previously labelled **PR created**
  has been renamed to **PR ready to create** across the options page,
  notification labels and internal mappings. This better reflects the
  intermediate state before a pull request exists.

* **Auto‑open PR when ready:** Added auto‑click support for the **PR ready to
  view** status. When auto‑click is enabled for `pr-ready`, the background
  script opens the Codex task page as soon as the pull request is ready and
  the content script clicks the **View PR** button automatically to open the
  pull request in a new window. A new helper `setupViewPrAutoClick()` has
  been added to the content script to locate and click the **View PR** link,
  analogous to the existing auto‑click for the **Create PR** button. The
  background script similarly opens the task page when transitioning to
  `pr-ready`.

* **Always‑enabled popup and sound controls:** The options page no longer
  disables the “Show popup” and “Play sound” controls when a status is not
  currently enabled. Users can toggle popups and sounds independently of
  whether a status is enabled or disabled. Sound file selectors are still
  disabled only when the sound is off for that status.

  Version bumped to **1.1.32**.

# 1.1.26 - 2025-10-02

* **Guarantee multiple notification sounds**: Fixed a logic error that prevented
  the **PR created** and **PR ready to view** notifications from playing their
  configured sounds when tasks were auto‑processed. In previous releases the
  background script updated the stored history to `pr-created` or `pr-ready`
  before calling `updateHistory()`, which meant the subsequent call saw no
  status change and skipped triggering a notification. This resulted in only
  the first notification sound being heard. The autorun workflow now calls
  `updateHistory()` first when transitioning to `pr-created` or `pr-ready`,
  ensuring that each status change is detected and a notification is fired if
  enabled. After notifying, it persists the new status with
  `markTaskAsPrCreated()` or `markTaskAsPrReady()` so the history remains
  consistent without generating duplicate notifications.

  The version has been incremented to **1.1.26**.

# 1.1.27 - 2025-10-02

* **Ensure third notification sound plays reliably:** Some users reported
  that the **PR ready to view** sound did not play even after the fix
  introduced in 1.1.26. This was traced to the audio playback relying
  solely on the `<audio>` element within the custom notification window.
  When multiple notifications were shown quickly, browser autoplay rules
  occasionally prevented the third sound from playing. The
  `showStatusNotification()` function now invokes
  `playBrowserNotificationSound(statusKey)` in the background script
  before opening the popup. This plays the selected sound independently
  of the popup window and ensures that each notification has an audible
  cue. If the sound is disabled for a status or an invalid file is
  configured, the helper function simply returns without playing.

  The version has been incremented to **1.1.27**.

# 1.1.28 - 2025-10-02

* **Remove duplicate notification sounds and explicitly trigger PR‑ready
  notification:** Users reported hearing two sounds at once for each
  status change after 1.1.27. This was caused by the custom
  notification page still playing its own audio in addition to the
  background script. The notification URL no longer includes an
  `audio` parameter; all sounds are played through
  `playBrowserNotificationSound()` in the background script to avoid
  duplicates. In addition, the autorun workflow now explicitly calls
  `showStatusNotification()` for the **PR ready to view** status after
  updating the task history. This ensures the third notification is
  delivered even if `updateHistory()` does not detect a status change
  (e.g. due to a race condition or misconfiguration of enabled
  statuses).

  Version bumped to **1.1.28**.

# 1.1.29 - 2025-10-02

* **Keep PR‑ready timer alive with alarms API:** Users reported that the
  background script occasionally stopped and the third notification did
  not play. This was because the extension uses a non‑persistent
  background (event page), which can be suspended before a `setTimeout`
  fires, causing the PR‑ready timer to be discarded. The autorun logic
  now uses `browser.alarms`/`chrome.alarms` to schedule the PR‑ready
  update, storing task details in a map keyed by the alarm name. When
  the alarm fires it reopens the background context, updates history
  to `pr-ready`, persists the change, and explicitly displays the
  notification. A fallback to `setTimeout` remains for environments
  without the alarms API. This ensures the third sound plays even if
  the event page is suspended. New helper structures (`prReadyAlarmTasks`)
  and an `onAlarm` listener were added to handle these events.

  Version bumped to **1.1.29**.

# 1.1.30 - 2025-10-02

* **Filter out generic phrases from task names:** In some cases the
  extension recorded generic placeholder phrases like “Completing the
  task” instead of the actual task name in history. These phrases
  originate from UI elements that aren’t meant to be treated as
  meaningful task titles. Both `IGNORED_NAME_PATTERNS` in the
  background script and `IGNORED_TEXT_PATTERNS` in the content
  (codexWatcher) script now include a regular expression to skip
  “completing the task” and similar procedural wording. This prevents
  these strings from being stored as task names and ensures that only
  the bold/primary task text appears in history.

  Version bumped to **1.1.30**.

# 1.1.23 - 2025-10-02

* **Fix PR created notifications not showing:** Resolved an issue where
  tasks automatically transitioned from **Task ready to view** to
  **PR created** would update the task history without notifying the user.
  The background script now calls `updateHistory()` after marking a task as PR
  created so the change is propagated and the notification preferences are
  honoured. Users who have enabled **PR created** notifications in the
  settings will now see a pop‑up and hear the selected alert when the autorun
  feature opens a task and creates a pull request.

* **Enable PR created notifications by default:** Adjusted the default
  notification status list in the background script to include
  **PR created**. This aligns the underlying behaviour with the options page,
  where both **Task ready to view** and **PR created** are ticked on first
  launch.

  Bumped the version to **1.1.23**.

# 1.1.24 - 2025-10-02

* **Add “PR ready to view” notifications:** Introduced a new status
  (`pr-ready`) that represents a pull request being ready to view. The
  settings page now includes an option to enable or disable browser
  notifications and custom sounds for this status. A fourth checkbox and
  sound selector have been added between the existing **PR created** and
  **Merged** options. By default, notifications for **PR ready to view**
  are enabled and use the first sound file unless overridden by the user.

* **Background support for the new status:** Updated the background
  script to recognise the `pr-ready` status across the default
  preferences, sound selections, sound enablement, status validation,
  human‑friendly labels and the set of completed statuses. This ensures
  that if a task’s status is updated to `pr-ready` (for example via a
  future update to the Codex watcher), the extension will persist the
  state change and trigger notifications according to the user’s
  preferences.

* **Popup labelling:** Added a special case in the popup script so that
  tasks with a status of `pr-ready` display the label “PR ready to view”
  instead of the generic “PR Ready” formatting.

  Bumped the version to **1.1.24**.

# 1.1.25 - 2025-10-02

* **Trigger PR ready notifications automatically:** When the autorun
  workflow opens a task and creates a pull request, the extension now
  waits a few seconds and then marks the task as `pr-ready`. This
  change invokes `updateHistory` once more with the new status,
  prompting a “PR ready to view” notification (with sound, if
  configured) so users know when the pull request can be opened. The
  delay can be adjusted via the `PR_READY_DELAY_MS` constant in
  `background.js`.

  Bumped the version to **1.1.25**.

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
