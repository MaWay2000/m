/*
 * GitHub Merge Automation Content Script
 *
 * This script runs on GitHub pull request pages. When enabled via the
 * extension’s options, it automatically clicks the "Merge pull request"
 * and "Confirm merge" buttons when they appear. After confirming the
 * merge, it can optionally close the tab. Preferences are stored
 * under keys defined below and are loaded on page initialisation.
 */

(function () {
  // Ensure the script only runs once per page load. Without this guard,
  // GitHub’s dynamic navigation could cause the script to be injected
  // multiple times via the extension’s manifest matches. A property on
  // window is used to track execution.
  if (window.__codexGhMergeAutoclickInitialized) {
    return;
  }
  window.__codexGhMergeAutoclickInitialized = true;

  // The GitHub merge automation feature has been removed. To ensure that
  // this content script no longer performs any actions, exit immediately.
  return;

  const storage =
    (typeof browser !== "undefined" && browser?.storage) ||
    (typeof chrome !== "undefined" && chrome?.storage);
  const runtime =
    (typeof browser !== "undefined" && browser?.runtime) ||
    (typeof chrome !== "undefined" && chrome?.runtime);

  const MERGE_PR_AUTO_CLICK_KEY = "codexMergePrAutoClickEnabled";
  const CONFIRM_MERGE_AUTO_CLICK_KEY = "codexConfirmMergeAutoClickEnabled";
  const CLOSE_GITHUB_AFTER_MERGE_KEY = "codexCloseGithubAfterMergeEnabled";

  // Keys for showing a popup and playing a sound when the merge actions
  // occur. These preferences mirror those defined in options.js and
  // control whether a notification is displayed or a sound played when
  // the "Merge pull request" or "Confirm merge" buttons are auto‑clicked.
  const MERGE_PR_SHOW_POPUP_KEY = "codexMergePrShowPopupEnabled";
  const MERGE_PR_PLAY_SOUND_KEY = "codexMergePrPlaySoundEnabled";
  const CONFIRM_MERGE_SHOW_POPUP_KEY = "codexConfirmMergeShowPopupEnabled";
  const CONFIRM_MERGE_PLAY_SOUND_KEY = "codexConfirmMergePlaySoundEnabled";

  // Defaults for the merge popup/sound preferences. These should match
  // the defaults in options.js. All default to true so that a popup is
  // shown and a sound is played when merge actions run.
  const DEFAULT_MERGE_PR_SHOW_POPUP = true;
  const DEFAULT_MERGE_PR_PLAY_SOUND = true;
  const DEFAULT_CONFIRM_MERGE_SHOW_POPUP = true;
  const DEFAULT_CONFIRM_MERGE_PLAY_SOUND = true;

  // Default values when storage is unavailable or preferences are
  // missing. These defaults should mirror the values exposed in the
  // options UI (see options.js). All GitHub merge automation toggles
  // default to true so the feature works out of the box.
  const DEFAULT_MERGE_PR_AUTO_CLICK = true;
  const DEFAULT_CONFIRM_MERGE_AUTO_CLICK = true;
  const DEFAULT_CLOSE_AFTER = true;

  let mergePrEnabled = DEFAULT_MERGE_PR_AUTO_CLICK;
  let confirmMergeEnabled = DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
  let closeAfterEnabled = DEFAULT_CLOSE_AFTER;

  // Whether to show a popup or play a sound when the merge actions
  // automatically run. These are loaded from storage on startup and
  // updated when preferences change. Default to true.
  let mergePrShowPopupEnabled = DEFAULT_MERGE_PR_SHOW_POPUP;
  let mergePrPlaySoundEnabled = DEFAULT_MERGE_PR_PLAY_SOUND;
  let confirmMergeShowPopupEnabled = DEFAULT_CONFIRM_MERGE_SHOW_POPUP;
  let confirmMergePlaySoundEnabled = DEFAULT_CONFIRM_MERGE_PLAY_SOUND;

  // Attempt counters to prevent infinite loops. When the count exceeds
  // MAX_ATTEMPTS the respective interval is cleared. Each interval
  // invokes find functions on a periodic basis (1 second).
  const MAX_ATTEMPTS = 120;
  let mergeAttempts = 0;
  let confirmAttempts = 0;
  let mergeIntervalId = null;
  let confirmIntervalId = null;

  function findButtonWithText(text) {
    const lc = text.toLowerCase();
    // Search across common interactive elements: buttons, summary items,
    // anchor tags and elements with role="button". This broadens the
    // search to accommodate GitHub markup changes (e.g. using anchors
    // or roles instead of <button>).
    const candidates = document.querySelectorAll(
      "button, summary, a, [role='button']",
    );
    for (const el of candidates) {
      const t = (el.textContent || "").trim().toLowerCase();
      if (t.includes(lc)) {
        return el;
      }
    }
    return null;
  }

  function findMergeButton() {
    // Try specific selectors first. GitHub may use various classes
    // and attributes for the merge button. Test multiple candidates.
    const selectors = [
      // Standard GitHub merge commit button selector
      'button.js-merge-commit-button',
      // Legacy merge button id
      'button#merge_pull_request',
      // Newer button name attribute used on some PR pages
      'button[name="merge"]',
      // Generic submit buttons styled as primary (GitHub uses these for merge)
      'button.btn-primary[type="submit"]',
      // Buttons with a data-details-container attribute (merge button often has this)
      'button[data-details-container]',
      // Fallback: any primary button (last resort)
      'button.btn-primary',
    ];
    for (const sel of selectors) {
      const candidate = document.querySelector(sel);
      if (candidate) {
        return candidate;
      }
    }
    // Fallback: search by text among various interactive elements
    return findButtonWithText("merge pull request");
  }

  function findConfirmButton() {
    // GitHub uses a button with name="commit" for the confirm merge
    // action but may also use other button styles. Try multiple selectors.
    const selectors = [
      // Confirm merge button often uses the name "commit"
      'button[name="commit"]',
      // On some pages GitHub may label the confirm button specifically
      'button[name="confirm-merge"]',
      // Generic primary button (e.g. fallback case)
      'button.btn-primary',
    ];
    for (const sel of selectors) {
      const candidate = document.querySelector(sel);
      if (candidate) {
        return candidate;
      }
    }
    // Fallback: search by text among interactive elements
    return findButtonWithText("confirm merge");
  }

  function isElementDisabled(el) {
    if (!el) {
      return true;
    }
    if (typeof el.disabled === "boolean" && el.disabled) {
      return true;
    }
    if (el.hasAttribute && el.hasAttribute("disabled")) {
      return true;
    }
    const ariaDisabled =
      typeof el.getAttribute === "function"
        ? (el.getAttribute("aria-disabled") || "").toLowerCase()
        : "";
    if (ariaDisabled && ariaDisabled !== "false") {
      return true;
    }
    const dataDisabled =
      typeof el.getAttribute === "function"
        ? (el.getAttribute("data-disabled") || "").toLowerCase()
        : "";
    if (dataDisabled && dataDisabled !== "false") {
      return true;
    }
    if (typeof el.closest === "function") {
      const disabledAncestor = el.closest(
        '[aria-disabled="true"], [data-disabled="true"], .disabled',
      );
      if (disabledAncestor) {
        return true;
      }
    }
    return false;
  }

  function clickButton(el, description) {
    if (!el) {
      return false;
    }
    // Attempt to avoid interacting with disabled elements
    if (isElementDisabled(el)) {
      return false;
    }
    let clicked = false;
    // Prefer the native click() if available
    try {
      if (typeof el.click === "function") {
        el.click();
        clicked = true;
      }
    } catch (error) {
      // Ignore click errors and fall back to dispatching an event
    }
    if (!clicked) {
      try {
        const evt = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        el.dispatchEvent(evt);
        clicked = true;
      } catch (error) {
        console.warn(`codex-autorun: failed to auto-click ${description}`, error);
      }
    }
    if (clicked) {
      console.log(`codex-autorun: auto-clicked ${description}`);
    }
    return clicked;
  }

  /**
   * Notify the background script that a merge action has been executed so
   * that it can display a popup or play a sound. The content script
   * cannot directly create notification windows so it delegates to the
   * background. The message includes the action ('merge-pr' or
   * 'confirm-merge') and the current popup/sound preferences.
   *
   * @param {string} action Either 'merge-pr' or 'confirm-merge'.
   */
  function maybeNotifyMerge(action) {
    if (!runtime || typeof runtime.sendMessage !== "function") {
      return;
    }
    // Determine whether a popup or sound should be triggered for this
    // action based on the loaded preferences. Only send a message when
    // at least one notification modality is enabled.
    let showPopup = false;
    let playSound = false;
    if (action === "merge-pr") {
      showPopup = !!mergePrShowPopupEnabled;
      playSound = !!mergePrPlaySoundEnabled;
    } else if (action === "confirm-merge") {
      showPopup = !!confirmMergeShowPopupEnabled;
      playSound = !!confirmMergePlaySoundEnabled;
    }
    if (!showPopup && !playSound) {
      return;
    }
    try {
      runtime.sendMessage({
        type: "codex-gh-merge-action",
        action,
        showPopup,
        playSound,
      });
    } catch (error) {
      // Ignore errors sending the message; the merge click is still
      // performed even if the notification fails.
    }
  }

  function maybeCloseTab() {
    if (!closeAfterEnabled) {
      return;
    }
    try {
      if (runtime && typeof runtime.sendMessage === "function") {
        runtime.sendMessage({ type: "close-github-tab" });
      } else {
        // As a fallback attempt to close the window. This will only
        // succeed if the tab was opened via window.open by the extension.
        window.close();
      }
    } catch (error) {
      console.error("codex-autorun: unable to request closing GitHub tab", error);
    }
  }

  function startMergeAutoClick() {
    if (mergeIntervalId !== null) {
      return;
    }
    mergeIntervalId = window.setInterval(() => {
      if (!mergePrEnabled) {
        // If the preference is disabled stop trying
        clearInterval(mergeIntervalId);
        mergeIntervalId = null;
        return;
      }
      mergeAttempts += 1;
      const btn = findMergeButton();
      if (btn) {
        const clicked = clickButton(btn, 'Merge pull request button');
        if (clicked) {
          // Notify background when the merge button is clicked
          maybeNotifyMerge('merge-pr');
          clearInterval(mergeIntervalId);
          mergeIntervalId = null;
        }
      }
      if (mergeAttempts >= MAX_ATTEMPTS) {
        clearInterval(mergeIntervalId);
        mergeIntervalId = null;
      }
    }, 1000);
  }

  function startConfirmAutoClick() {
    if (confirmIntervalId !== null) {
      return;
    }
    confirmIntervalId = window.setInterval(() => {
      if (!confirmMergeEnabled) {
        clearInterval(confirmIntervalId);
        confirmIntervalId = null;
        return;
      }
      confirmAttempts += 1;
      const btn = findConfirmButton();
      if (btn) {
        const clicked = clickButton(btn, 'Confirm merge button');
        if (clicked) {
          // Notify background when the confirm merge button is clicked
          maybeNotifyMerge('confirm-merge');
          clearInterval(confirmIntervalId);
          confirmIntervalId = null;
          maybeCloseTab();
        }
      }
      if (confirmAttempts >= MAX_ATTEMPTS) {
        clearInterval(confirmIntervalId);
        confirmIntervalId = null;
      }
    }, 1000);
  }

  function loadPreferencesAndInit() {
    if (!storage?.local) {
      // Storage unavailable; use defaults and start watchers accordingly
      mergePrEnabled = DEFAULT_MERGE_PR_AUTO_CLICK;
      confirmMergeEnabled = DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
      closeAfterEnabled = DEFAULT_CLOSE_AFTER;
      mergePrShowPopupEnabled = DEFAULT_MERGE_PR_SHOW_POPUP;
      mergePrPlaySoundEnabled = DEFAULT_MERGE_PR_PLAY_SOUND;
      confirmMergeShowPopupEnabled = DEFAULT_CONFIRM_MERGE_SHOW_POPUP;
      confirmMergePlaySoundEnabled = DEFAULT_CONFIRM_MERGE_PLAY_SOUND;
      if (mergePrEnabled) startMergeAutoClick();
      if (confirmMergeEnabled) startConfirmAutoClick();
      return;
    }
    try {
      storage.local.get([
        MERGE_PR_AUTO_CLICK_KEY,
        CONFIRM_MERGE_AUTO_CLICK_KEY,
        CLOSE_GITHUB_AFTER_MERGE_KEY,
        MERGE_PR_SHOW_POPUP_KEY,
        MERGE_PR_PLAY_SOUND_KEY,
        CONFIRM_MERGE_SHOW_POPUP_KEY,
        CONFIRM_MERGE_PLAY_SOUND_KEY,
      ], (data) => {
        const runtimeErr =
          typeof chrome !== "undefined" && chrome?.runtime?.lastError
            ? chrome.runtime.lastError
            : null;
        if (runtimeErr) {
          console.error("codex-autorun: error retrieving merge preferences", runtimeErr);
        }
        const m = data?.[MERGE_PR_AUTO_CLICK_KEY];
        const c = data?.[CONFIRM_MERGE_AUTO_CLICK_KEY];
        const x = data?.[CLOSE_GITHUB_AFTER_MERGE_KEY];
        const sMergePopup = data?.[MERGE_PR_SHOW_POPUP_KEY];
        const sMergeSound = data?.[MERGE_PR_PLAY_SOUND_KEY];
        const sConfirmPopup = data?.[CONFIRM_MERGE_SHOW_POPUP_KEY];
        const sConfirmSound = data?.[CONFIRM_MERGE_PLAY_SOUND_KEY];
        mergePrEnabled = typeof m === "boolean" ? m : DEFAULT_MERGE_PR_AUTO_CLICK;
        confirmMergeEnabled = typeof c === "boolean" ? c : DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
        closeAfterEnabled = typeof x === "boolean" ? x : DEFAULT_CLOSE_AFTER;
        mergePrShowPopupEnabled = typeof sMergePopup === "boolean" ? sMergePopup : DEFAULT_MERGE_PR_SHOW_POPUP;
        mergePrPlaySoundEnabled = typeof sMergeSound === "boolean" ? sMergeSound : DEFAULT_MERGE_PR_PLAY_SOUND;
        confirmMergeShowPopupEnabled = typeof sConfirmPopup === "boolean" ? sConfirmPopup : DEFAULT_CONFIRM_MERGE_SHOW_POPUP;
        confirmMergePlaySoundEnabled = typeof sConfirmSound === "boolean" ? sConfirmSound : DEFAULT_CONFIRM_MERGE_PLAY_SOUND;
        if (mergePrEnabled) startMergeAutoClick();
        if (confirmMergeEnabled) startConfirmAutoClick();
      });
    } catch (error) {
      console.error("codex-autorun: unable to read merge preferences", error);
      mergePrEnabled = DEFAULT_MERGE_PR_AUTO_CLICK;
      confirmMergeEnabled = DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
      closeAfterEnabled = DEFAULT_CLOSE_AFTER;
      mergePrShowPopupEnabled = DEFAULT_MERGE_PR_SHOW_POPUP;
      mergePrPlaySoundEnabled = DEFAULT_MERGE_PR_PLAY_SOUND;
      confirmMergeShowPopupEnabled = DEFAULT_CONFIRM_MERGE_SHOW_POPUP;
      confirmMergePlaySoundEnabled = DEFAULT_CONFIRM_MERGE_PLAY_SOUND;
      if (mergePrEnabled) startMergeAutoClick();
      if (confirmMergeEnabled) startConfirmAutoClick();
    }
  }

  loadPreferencesAndInit();
})();