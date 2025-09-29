const storageApi =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : typeof chrome !== "undefined" && chrome?.storage
      ? chrome.storage
      : null;

const SOUND_STATUSES = ["ready", "pr-created", "merged"];
const SOUND_STATUS_STORAGE_KEY = "codexSoundStatuses";
const SOUND_SELECTION_STORAGE_KEY = "codexSoundSelections";
const DEFAULT_SOUND_STATUSES = ["ready", "merged"];
const DEFAULT_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  merged: "1.mp3",
};
const SOUND_STATUS_VALUES = new Set(SOUND_STATUSES);
const SOUND_FILE_OPTIONS = [
  "1.mp3",
  "2.mp3",
  "3.mp3",
  "4.mp3",
  "5.mp3",
  "6.mp3",
  "7.mp3",
  "8.mp3",
];
const SOUND_FILE_VALUES = new Set(SOUND_FILE_OPTIONS);

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

function sanitizeSoundSelections(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const sanitized = {};
  for (const status of SOUND_STATUSES) {
    const rawValue = value?.[status];
    if (typeof rawValue !== "string") {
      continue;
    }
    const normalized = rawValue.trim();
    if (!normalized || !SOUND_FILE_VALUES.has(normalized)) {
      continue;
    }
    sanitized[status] = normalized;
  }
  return sanitized;
}

function updateSoundSelectState(statuses) {
  const form = document.getElementById("sound-preferences");
  if (!form) {
    return;
  }
  const enabled = new Set(statuses);
  const selects = form.querySelectorAll('select[name="sound-selection"]');
  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }
    select.disabled = !enabled.has(status);
  }
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
  updateSoundSelectState(statuses);
}

function applySoundSelections(selections) {
  const form = document.getElementById("sound-preferences");
  if (!form) {
    return;
  }
  const selects = form.querySelectorAll('select[name="sound-selection"]');
  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }
    const desired = selections?.[status] ?? DEFAULT_SOUND_SELECTIONS[status];
    if (desired && SOUND_FILE_VALUES.has(desired)) {
      select.value = desired;
    } else {
      select.value = DEFAULT_SOUND_SELECTIONS[status];
    }
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
    const [storedStatuses, storedSelections] = await Promise.all([
      storageGet(SOUND_STATUS_STORAGE_KEY),
      storageGet(SOUND_SELECTION_STORAGE_KEY),
    ]);
    const sanitizedStatuses = sanitizeSoundStatuses(storedStatuses);
    const statuses =
      sanitizedStatuses !== null ? sanitizedStatuses : DEFAULT_SOUND_STATUSES;
    applyStatuses(statuses);

    const sanitizedSelections = sanitizeSoundSelections(storedSelections);
    const selections = { ...DEFAULT_SOUND_SELECTIONS, ...(sanitizedSelections ?? {}) };
    applySoundSelections(selections);
  } catch (error) {
    console.error("Unable to load sound preferences", error);
    applyStatuses(DEFAULT_SOUND_STATUSES);
    applySoundSelections(DEFAULT_SOUND_SELECTIONS);
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

function readSoundSelections() {
  const form = document.getElementById("sound-preferences");
  if (!form) {
    return {};
  }
  const selections = {};
  const selects = form.querySelectorAll('select[name="sound-selection"]');
  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }
    selections[status] = select.value;
  }
  return selections;
}

async function handlePreferencesChange(event) {
  const target = event?.target;
  if (!target) {
    return;
  }

  if (target instanceof HTMLInputElement && target.name === "sound-status") {
    const selected = readSelectedStatuses();
    const sanitized = sanitizeSoundStatuses(selected) ?? [];
    try {
      await storageSet(SOUND_STATUS_STORAGE_KEY, sanitized);
      updateSoundSelectState(sanitized);
      if (sanitized.length) {
        showStatusMessage("Preferences saved.");
      } else {
        showStatusMessage("Notification sounds are disabled.");
      }
    } catch (error) {
      console.error("Unable to save sound preferences", error);
      showStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }
    return;
  }

  if (target instanceof HTMLSelectElement && target.name === "sound-selection") {
    const selectedSounds = readSoundSelections();
    const sanitized = sanitizeSoundSelections(selectedSounds);
    const selectionsToStore = {
      ...DEFAULT_SOUND_SELECTIONS,
      ...(sanitized ?? {}),
    };
    try {
      await storageSet(SOUND_SELECTION_STORAGE_KEY, selectionsToStore);
      showStatusMessage("Sound choice saved.");
    } catch (error) {
      console.error("Unable to save sound selection", error);
      showStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadSoundPreferences();
  const form = document.getElementById("sound-preferences");
  form?.addEventListener("change", handlePreferencesChange);
});
