const storageApi =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : typeof chrome !== "undefined" && chrome?.storage
      ? chrome.storage
      : null;

const SOUND_STATUS_STORAGE_KEY = "codexSoundStatuses";
const DEFAULT_SOUND_STATUSES = ["ready", "merged"];
const SOUND_STATUS_VALUES = new Set(["ready", "pr-created", "merged"]);

function storageGet(key) {
  if (!storageApi?.local) {
    return Promise.resolve(undefined);
  }
  try {
    const result = storageApi.local.get(key);
    if (result && typeof result.then === "function") {
      return result.then((data) => data?.[key]);
    }
  } catch (error) {
    console.error("Failed to get storage value", error);
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    try {
      storageApi.local.get(key, (data) => {
        const runtimeError =
          typeof chrome !== "undefined" && chrome?.runtime?.lastError
            ? chrome.runtime.lastError
            : null;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(data?.[key]);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageSet(key, value) {
  if (!storageApi?.local) {
    return Promise.reject(new Error("Storage API is unavailable."));
  }
  const payload = { [key]: value };
  try {
    const result = storageApi.local.set(payload);
    if (result && typeof result.then === "function") {
      return result;
    }
  } catch (error) {
    console.error("Failed to set storage value", error);
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    try {
      storageApi.local.set(payload, () => {
        const runtimeError =
          typeof chrome !== "undefined" && chrome?.runtime?.lastError
            ? chrome.runtime.lastError
            : null;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function sanitizeSoundStatuses(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const sanitized = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized) || !SOUND_STATUS_VALUES.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    sanitized.push(normalized);
  }
  return sanitized;
}

function applyStatuses(statuses) {
  const form = document.getElementById("sound-preferences");
  if (!form) {
    return;
  }
  const checkboxes = form.querySelectorAll('input[name="sound-status"]');
  const enabled = new Set(statuses);
  for (const input of checkboxes) {
    input.checked = enabled.has(input.value);
  }
}

function showStatusMessage(message, isError = false) {
  const output = document.getElementById("sound-status-message");
  if (!output) {
    return;
  }
  output.textContent = message ?? "";
  if (isError) {
    output.classList.add("error");
  } else {
    output.classList.remove("error");
  }
}

async function loadSoundPreferences() {
  try {
    const stored = await storageGet(SOUND_STATUS_STORAGE_KEY);
    const sanitized = sanitizeSoundStatuses(stored);
    const statuses = sanitized !== null ? sanitized : DEFAULT_SOUND_STATUSES;
    applyStatuses(statuses);
  } catch (error) {
    console.error("Unable to load sound preferences", error);
    applyStatuses(DEFAULT_SOUND_STATUSES);
    showStatusMessage(`Unable to load preferences: ${error.message}`, true);
  }
}

function readSelectedStatuses() {
  const form = document.getElementById("sound-preferences");
  if (!form) {
    return [];
  }
  const inputs = form.querySelectorAll('input[name="sound-status"]:checked');
  const selected = [];
  for (const input of inputs) {
    selected.push(input.value);
  }
  return selected;
}

async function handlePreferencesChange(event) {
  if (!event?.target || !(event.target instanceof HTMLInputElement)) {
    return;
  }
  const selected = readSelectedStatuses();
  const sanitized = sanitizeSoundStatuses(selected) ?? [];
  try {
    await storageSet(SOUND_STATUS_STORAGE_KEY, sanitized);
    if (sanitized.length) {
      showStatusMessage("Preferences saved.");
    } else {
      showStatusMessage("Notification sounds are disabled.");
    }
  } catch (error) {
    console.error("Unable to save sound preferences", error);
    showStatusMessage(`Unable to save preferences: ${error.message}`, true);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadSoundPreferences();
  const form = document.getElementById("sound-preferences");
  form?.addEventListener("change", handlePreferencesChange);
});
