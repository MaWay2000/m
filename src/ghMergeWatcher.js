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

  const storage =
    (typeof browser !== "undefined" && browser?.storage) ||
    (typeof chrome !== "undefined" && chrome?.storage);
  const runtime =
    (typeof browser !== "undefined" && browser?.runtime) ||
    (typeof chrome !== "undefined" && chrome?.runtime);

  const MERGE_PR_AUTO_CLICK_KEY = "codexMergePrAutoClickEnabled";
  const CONFIRM_MERGE_AUTO_CLICK_KEY = "codexConfirmMergeAutoClickEnabled";
  const CLOSE_GITHUB_AFTER_MERGE_KEY = "codexCloseGithubAfterMergeEnabled";

  // Default values when storage is unavailable or preferences are
  // missing. All options default to false (no auto-click).
  const DEFAULT_MERGE_PR_AUTO_CLICK = false;
  const DEFAULT_CONFIRM_MERGE_AUTO_CLICK = false;
  const DEFAULT_CLOSE_AFTER = false;

  let mergePrEnabled = DEFAULT_MERGE_PR_AUTO_CLICK;
  let confirmMergeEnabled = DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
  let closeAfterEnabled = DEFAULT_CLOSE_AFTER;

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
    const candidates = document.querySelectorAll("button, summary");
    for (const el of candidates) {
      const t = (el.textContent || "").trim().toLowerCase();
      if (t.includes(lc)) {
        return el;
      }
    }
    return null;
  }

  function findMergeButton() {
    // Try specific selectors first. GitHub often uses id starting with
    // "merge" or data-action names. Then fallback to text search.
    let btn = document.querySelector(
      'button.js-merge-commit-button, button#merge_pull_request, button.btn-primary[type="submit"]'
    );
    if (btn) {
      return btn;
    }
    // Fallback: search by text
    return findButtonWithText("merge pull request");
  }

  function findConfirmButton() {
    // GitHub uses a button with name="commit" for the confirm merge
    // action. Attempt to match that or search by text.
    let btn = document.querySelector('button[name="commit"]');
    if (btn) {
      return btn;
    }
    // Fallback: search for text
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
    if (!el || typeof el.click !== "function") {
      return false;
    }
    if (isElementDisabled(el)) {
      return false;
    }
    try {
      el.click();
      console.log(`codex-autorun: auto-clicked ${description}`);
      return true;
    } catch (error) {
      console.warn(`codex-autorun: failed to auto-click ${description}`, error);
      return false;
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
      if (mergePrEnabled) startMergeAutoClick();
      if (confirmMergeEnabled) startConfirmAutoClick();
      return;
    }
    try {
      storage.local.get([
        MERGE_PR_AUTO_CLICK_KEY,
        CONFIRM_MERGE_AUTO_CLICK_KEY,
        CLOSE_GITHUB_AFTER_MERGE_KEY,
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
        mergePrEnabled = typeof m === "boolean" ? m : DEFAULT_MERGE_PR_AUTO_CLICK;
        confirmMergeEnabled = typeof c === "boolean" ? c : DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
        closeAfterEnabled = typeof x === "boolean" ? x : DEFAULT_CLOSE_AFTER;
        if (mergePrEnabled) startMergeAutoClick();
        if (confirmMergeEnabled) startConfirmAutoClick();
      });
    } catch (error) {
      console.error("codex-autorun: unable to read merge preferences", error);
      mergePrEnabled = DEFAULT_MERGE_PR_AUTO_CLICK;
      confirmMergeEnabled = DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
      closeAfterEnabled = DEFAULT_CLOSE_AFTER;
      if (mergePrEnabled) startMergeAutoClick();
      if (confirmMergeEnabled) startConfirmAutoClick();
    }
  }

  loadPreferencesAndInit();
})();