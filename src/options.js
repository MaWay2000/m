const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome?.runtime;
const storage =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : chrome?.storage;

const SHOW_BROWSER_ACTION_ICON_KEY = "codexShowBrowserActionIcon";

const toggle = document.getElementById("toolbar-icon-toggle");
const statusOutput = document.getElementById("status");

function storageGet(key) {
  if (!storage?.local) {
    return Promise.resolve(undefined);
  }
  try {
    const result = storage.local.get(key);
    if (result && typeof result.then === "function") {
      return result.then((data) => data?.[key]);
    }
  } catch (error) {
    console.error("Failed to read storage", error);
  }
  return new Promise((resolve) => {
    storage.local.get(key, (data) => {
      if (runtime?.lastError) {
        console.error("Storage get error", runtime.lastError);
        resolve(undefined);
        return;
      }
      resolve(data?.[key]);
    });
  });
}

function storageSet(key, value) {
  if (!storage?.local) {
    return Promise.resolve();
  }
  const payload = { [key]: value };
  try {
    const result = storage.local.set(payload);
    if (result && typeof result.then === "function") {
      return result;
    }
  } catch (error) {
    console.error("Failed to write storage", error);
  }
  return new Promise((resolve, reject) => {
    storage.local.set(payload, () => {
      if (runtime?.lastError) {
        reject(new Error(runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function showStatus(message, { isError = false } = {}) {
  if (!statusOutput) {
    return;
  }
  statusOutput.textContent = message ?? "";
  if (isError) {
    statusOutput.classList.add("error");
  } else {
    statusOutput.classList.remove("error");
  }
}

async function loadSetting() {
  if (!toggle) {
    return;
  }

  toggle.disabled = true;
  try {
    const stored = await storageGet(SHOW_BROWSER_ACTION_ICON_KEY);
    toggle.checked = stored !== false;
    showStatus("");
  } catch (error) {
    console.error("Failed to load toolbar visibility setting", error);
    showStatus(`Unable to load setting: ${error.message}`, { isError: true });
  } finally {
    toggle.disabled = false;
  }
}

async function handleToggleChange() {
  if (!toggle) {
    return;
  }
  const nextValue = toggle.checked;
  toggle.disabled = true;
  showStatus("Saving…");
  try {
    await storageSet(SHOW_BROWSER_ACTION_ICON_KEY, nextValue);
    showStatus("Saved.");
  } catch (error) {
    console.error("Failed to update toolbar visibility", error);
    toggle.checked = !nextValue;
    showStatus(`Unable to save: ${error.message}`, { isError: true });
  } finally {
    toggle.disabled = false;
  }
}

if (toggle) {
  toggle.addEventListener("change", handleToggleChange);
}

loadSetting();
