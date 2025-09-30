const storageApi =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : typeof chrome !== "undefined" && chrome?.storage
      ? chrome.storage
      : null;

const STATUS_OPTIONS = ["ready", "pr-created", "merged"];
const STATUS_VALUES = new Set(STATUS_OPTIONS);
const NOTIFICATION_STATUS_STORAGE_KEY = "codexNotificationStatuses";
const NOTIFICATION_SOUND_SELECTION_STORAGE_KEY =
  "codexNotificationSoundSelections";
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY =
  "codexNotificationSoundEnabledStatuses";
const NOTIFICATION_DEFAULT_SOUND_MUTED_STORAGE_KEY =
  "codexNotificationDefaultSoundMuted";
const DEFAULT_NOTIFICATION_STATUSES = ["ready", "pr-created"];
const DEFAULT_NOTIFICATION_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  merged: "1.mp3",
};
const DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES = [...STATUS_OPTIONS];
const DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED = false;
const STATUS_LABELS = {
  ready: "Task ready to view",
  "pr-created": "PR created",
  merged: "Merged",
};
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
let cachedNotificationStatuses = [...DEFAULT_NOTIFICATION_STATUSES];
let cachedSoundEnabledStatuses = [...DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES];
let cachedDefaultSoundMuted = DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED;

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

function sanitizeStatuses(value) {
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
    if (!normalized || seen.has(normalized) || !STATUS_VALUES.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    sanitized.push(normalized);
  }
  return sanitized;
}

function sanitizeNotificationStatuses(value) {
  return sanitizeStatuses(value);
}

function sanitizeSoundEnabledStatuses(value) {
  return sanitizeStatuses(value);
}

function sanitizeSoundSelections(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const sanitized = {};
  for (const status of STATUS_OPTIONS) {
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

function sanitizeBoolean(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return null;
}

function applyNotificationStatuses(statuses) {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return;
  }

  const checkboxes = form.querySelectorAll('input[name="notification-status"]');
  const enabled = new Set(statuses);

  for (const input of checkboxes) {
    input.checked = enabled.has(input.value);
  }

  cachedNotificationStatuses = [...statuses];
  updateNotificationSoundToggleState();
  updateNotificationSoundSelectState();
}

function applyNotificationSoundSelections(selections) {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return;
  }

  const selects = form.querySelectorAll(
    'select[name="notification-sound-selection"]',
  );

  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }

    const desired =
      selections?.[status] ?? DEFAULT_NOTIFICATION_SOUND_SELECTIONS[status];

    if (desired && SOUND_FILE_VALUES.has(desired)) {
      select.value = desired;
    } else {
      select.value = DEFAULT_NOTIFICATION_SOUND_SELECTIONS[status];
    }
  }
}

function applyNotificationSoundEnabledStatuses(statuses) {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return;
  }

  const toggles = form.querySelectorAll(
    'input[name="notification-sound-enabled"]',
  );
  const enabled = new Set(statuses);

  for (const toggle of toggles) {
    const status = toggle.dataset?.status;
    if (!status) {
      continue;
    }

    toggle.checked = enabled.has(status);
  }

  cachedSoundEnabledStatuses = [...statuses];
  updateNotificationSoundToggleState();
  updateNotificationSoundSelectState();
}

function applyNotificationDefaultSoundMuted(isMuted) {
  const checkbox = document.getElementById("notification-default-sound-muted");
  if (!checkbox) {
    return;
  }

  checkbox.checked = Boolean(isMuted);
  cachedDefaultSoundMuted = Boolean(isMuted);
  updateNotificationSoundToggleState();
  updateNotificationSoundSelectState();
}

async function persistDefaultSoundMuted(isMuted, options = {}) {
  const normalized = Boolean(isMuted);
  try {
    await storageSet(NOTIFICATION_DEFAULT_SOUND_MUTED_STORAGE_KEY, normalized);
    applyNotificationDefaultSoundMuted(normalized);

    if (Object.prototype.hasOwnProperty.call(options, "successMessage")) {
      showNotificationStatusMessage(options.successMessage ?? "");
    }

    return true;
  } catch (error) {
    console.error("Unable to save default sound setting", error);
    showNotificationStatusMessage(`Unable to save preferences: ${error.message}`, true);
    return false;
  }
}

async function ensureDefaultSoundMutedConsistency(soundEnabledStatuses) {
  const hasCustomSoundEnabled =
    Array.isArray(soundEnabledStatuses) && soundEnabledStatuses.length > 0;

  if (hasCustomSoundEnabled && !cachedDefaultSoundMuted) {
    return persistDefaultSoundMuted(true);
  }

  if (!hasCustomSoundEnabled && cachedDefaultSoundMuted) {
    return persistDefaultSoundMuted(false);
  }

  return true;
}

function updateNotificationSoundToggleState() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return;
  }

  const notificationEnabled = new Set(cachedNotificationStatuses);
  const toggles = form.querySelectorAll(
    'input[name="notification-sound-enabled"]',
  );

  for (const toggle of toggles) {
    const status = toggle.dataset?.status;
    if (!status) {
      continue;
    }

    toggle.disabled = !notificationEnabled.has(status);
  }
}

function updateNotificationSoundSelectState() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return;
  }

  const notificationEnabled = new Set(cachedNotificationStatuses);
  const soundEnabled = new Set(cachedSoundEnabledStatuses);
  const selects = form.querySelectorAll(
    'select[name="notification-sound-selection"]',
  );

  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }

    const enabled =
      notificationEnabled.has(status) && soundEnabled.has(status);

    select.disabled = !enabled;
  }
}

function showNotificationStatusMessage(message, isError = false) {
  const output = document.getElementById("notification-status-message");
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

async function loadNotificationPreferences() {
  try {
    const [
      storedStatuses,
      storedSelections,
      storedSoundEnabledStatuses,
      storedDefaultSoundMuted,
    ] = await Promise.all([
      storageGet(NOTIFICATION_STATUS_STORAGE_KEY),
      storageGet(NOTIFICATION_SOUND_SELECTION_STORAGE_KEY),
      storageGet(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY),
      storageGet(NOTIFICATION_DEFAULT_SOUND_MUTED_STORAGE_KEY),
    ]);
    const sanitizedStatuses = sanitizeNotificationStatuses(storedStatuses);
    const statuses =
      sanitizedStatuses !== null ? sanitizedStatuses : DEFAULT_NOTIFICATION_STATUSES;
    applyNotificationStatuses(statuses);

    const sanitizedSelections = sanitizeSoundSelections(storedSelections);
    const selections = {
      ...DEFAULT_NOTIFICATION_SOUND_SELECTIONS,
      ...(sanitizedSelections ?? {}),
    };
    applyNotificationSoundSelections(selections);

    const sanitizedSoundEnabled = sanitizeSoundEnabledStatuses(
      storedSoundEnabledStatuses,
    );
    const soundEnabledStatuses =
      sanitizedSoundEnabled !== null
        ? sanitizedSoundEnabled
        : DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES;
    applyNotificationSoundEnabledStatuses(soundEnabledStatuses);

    const sanitizedDefaultMuted = sanitizeBoolean(storedDefaultSoundMuted);
    const defaultMuted =
      sanitizedDefaultMuted !== null
        ? sanitizedDefaultMuted
        : DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED;
    applyNotificationDefaultSoundMuted(defaultMuted);

    const ensureResult = await ensureDefaultSoundMutedConsistency(
      soundEnabledStatuses,
    );
    if (ensureResult !== false) {
      showNotificationStatusMessage("");
    }
  } catch (error) {
    console.error("Unable to load notification preferences", error);
    applyNotificationStatuses(DEFAULT_NOTIFICATION_STATUSES);
    applyNotificationSoundSelections(DEFAULT_NOTIFICATION_SOUND_SELECTIONS);
    applyNotificationSoundEnabledStatuses(
      DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
    );
    applyNotificationDefaultSoundMuted(DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED);
    showNotificationStatusMessage(`Unable to load preferences: ${error.message}`, true);
  }
}

function readNotificationStatuses() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return [];
  }

  const inputs = form.querySelectorAll(
    'input[name="notification-status"]:checked',
  );
  const selected = [];

  for (const input of inputs) {
    selected.push(input.value);
  }

  return selected;
}

function readNotificationSoundEnabledStatuses() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return [];
  }

  const toggles = form.querySelectorAll(
    'input[name="notification-sound-enabled"]:checked',
  );
  const selected = [];

  for (const toggle of toggles) {
    const status = toggle.dataset?.status;
    if (!status) {
      continue;
    }

    selected.push(status);
  }

  return selected;
}

function readNotificationSoundSelections() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return {};
  }

  const selections = {};
  const selects = form.querySelectorAll(
    'select[name="notification-sound-selection"]',
  );

  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }

    selections[status] = select.value;
  }

  return selections;
}

async function handleNotificationPreferencesChange(event) {
  const target = event?.target;
  if (target instanceof HTMLInputElement && target.name === "notification-status") {
    const selected = readNotificationStatuses();
    const sanitized = sanitizeNotificationStatuses(selected);
    const statusesToStore = sanitized !== null ? sanitized : [];

    try {
      await storageSet(NOTIFICATION_STATUS_STORAGE_KEY, statusesToStore);
      applyNotificationStatuses(statusesToStore);
      if (statusesToStore.length) {
        showNotificationStatusMessage("Preferences saved.");
      } else {
        showNotificationStatusMessage("Browser notifications are disabled.");
      }
    } catch (error) {
      console.error("Unable to save notification preferences", error);
      showNotificationStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }
    return;
  }

  if (
    target instanceof HTMLInputElement &&
    target.name === "notification-sound-enabled"
  ) {
    const selected = readNotificationSoundEnabledStatuses();
    const sanitized = sanitizeSoundEnabledStatuses(selected);
    const statusesToStore = sanitized !== null ? sanitized : [];

    try {
      await storageSet(
        NOTIFICATION_SOUND_ENABLED_STORAGE_KEY,
        statusesToStore,
      );
      applyNotificationSoundEnabledStatuses(statusesToStore);

      const statusKey = target.dataset?.status;
      const label = statusKey ? STATUS_LABELS[statusKey] ?? statusKey : null;

      if (!statusesToStore.length) {
        showNotificationStatusMessage("Notification sounds are disabled.");
      } else if (label) {
        showNotificationStatusMessage(
          target.checked
            ? `${label} sound enabled.`
            : `${label} sound disabled.`,
        );
      } else {
        showNotificationStatusMessage("Sound preference saved.");
      }

      await ensureDefaultSoundMutedConsistency(statusesToStore);
    } catch (error) {
      console.error("Unable to save notification sound setting", error);
      showNotificationStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }

    return;
  }

  if (
    target instanceof HTMLInputElement &&
    target.name === "notification-default-sound-muted"
  ) {
    const isMuted = Boolean(target.checked);

    const successMessage = isMuted
      ? "Default notification sound muted."
      : "Default notification sound enabled.";
    await persistDefaultSoundMuted(isMuted, { successMessage });

    return;
  }

  if (
    target instanceof HTMLSelectElement &&
    target.name === "notification-sound-selection"
  ) {
    const selectedSounds = readNotificationSoundSelections();
    const sanitized = sanitizeSoundSelections(selectedSounds);
    const selectionsToStore = {
      ...DEFAULT_NOTIFICATION_SOUND_SELECTIONS,
      ...(sanitized ?? {}),
    };
    try {
      await storageSet(
        NOTIFICATION_SOUND_SELECTION_STORAGE_KEY,
        selectionsToStore,
      );
      applyNotificationSoundSelections(selectionsToStore);
      showNotificationStatusMessage("Sound choice saved.");
    } catch (error) {
      console.error("Unable to save notification sound selection", error);
      showNotificationStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadNotificationPreferences();
  const notificationForm = document.getElementById("notification-preferences");
  notificationForm?.addEventListener("change", handleNotificationPreferencesChange);
});
