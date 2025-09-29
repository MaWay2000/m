const SETTINGS_KEY = "codexSettings";
const PIN_REMINDER_DISMISSED_KEY = "codexPinReminderDismissed";

export const DEFAULT_SETTINGS = Object.freeze({
  soundNotifications: {
    enabled: true,
  },
  pinReminder: {
    enabled: true,
  },
});

function cloneDefaultSettings() {
  return {
    soundNotifications: {
      enabled: DEFAULT_SETTINGS.soundNotifications.enabled,
    },
    pinReminder: {
      enabled: DEFAULT_SETTINGS.pinReminder.enabled,
    },
  };
}

function getStorageArea() {
  if (typeof browser !== "undefined" && browser?.storage?.local) {
    return browser.storage.local;
  }
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

function wrapStorageGet(storage, key) {
  try {
    const result = storage.get(key);
    if (result && typeof result.then === "function") {
      return result.then((data) => data?.[key]);
    }
  } catch (error) {
    console.error("Failed to read extension storage", error);
  }
  return new Promise((resolve) => {
    try {
      storage.get(key, (data) => {
        if (typeof chrome !== "undefined" && chrome?.runtime?.lastError) {
          console.error(
            "Storage get error",
            chrome.runtime.lastError.message || chrome.runtime.lastError,
          );
          resolve(undefined);
          return;
        }
        resolve(data?.[key]);
      });
    } catch (error) {
      console.error("Storage get failed", error);
      resolve(undefined);
    }
  });
}

function wrapStorageSet(storage, key, value) {
  const payload = { [key]: value };
  try {
    const result = storage.set(payload);
    if (result && typeof result.then === "function") {
      return result.then(() => {});
    }
  } catch (error) {
    console.error("Failed to write extension storage", error);
  }
  return new Promise((resolve) => {
    try {
      storage.set(payload, () => {
        if (typeof chrome !== "undefined" && chrome?.runtime?.lastError) {
          console.error(
            "Storage set error",
            chrome.runtime.lastError.message || chrome.runtime.lastError,
          );
        }
        resolve();
      });
    } catch (error) {
      console.error("Storage set failed", error);
      resolve();
    }
  });
}

function wrapStorageRemove(storage, key) {
  if (!storage?.remove) {
    return Promise.resolve();
  }
  try {
    const result = storage.remove(key);
    if (result && typeof result.then === "function") {
      return result.then(() => {});
    }
  } catch (error) {
    console.error("Failed to remove extension storage key", error);
  }
  return new Promise((resolve) => {
    try {
      storage.remove(key, () => {
        if (typeof chrome !== "undefined" && chrome?.runtime?.lastError) {
          console.error(
            "Storage remove error",
            chrome.runtime.lastError.message || chrome.runtime.lastError,
          );
        }
        resolve();
      });
    } catch (error) {
      console.error("Storage remove failed", error);
      resolve();
    }
  });
}

export function normalizeSettings(rawValue = {}) {
  const normalized = cloneDefaultSettings();

  if (rawValue && typeof rawValue === "object") {
    const rawSound = rawValue.soundNotifications;
    if (rawSound && typeof rawSound === "object") {
      if (rawSound.enabled !== undefined) {
        normalized.soundNotifications.enabled = Boolean(rawSound.enabled);
      }
    } else if (rawValue.playSoundNotifications !== undefined) {
      // Support a potential legacy flag name.
      normalized.soundNotifications.enabled = Boolean(
        rawValue.playSoundNotifications,
      );
    }

    const rawPinReminder = rawValue.pinReminder;
    if (rawPinReminder && typeof rawPinReminder === "object") {
      if (rawPinReminder.enabled !== undefined) {
        normalized.pinReminder.enabled = Boolean(rawPinReminder.enabled);
      }
    } else if (rawValue.pinReminderEnabled !== undefined) {
      normalized.pinReminder.enabled = Boolean(rawValue.pinReminderEnabled);
    }
  }

  return normalized;
}

export async function getSettings() {
  const storage = getStorageArea();
  if (!storage) {
    return cloneDefaultSettings();
  }
  const [raw, legacyDismissed] = await Promise.all([
    wrapStorageGet(storage, SETTINGS_KEY),
    wrapStorageGet(storage, PIN_REMINDER_DISMISSED_KEY),
  ]);
  const normalized = normalizeSettings(raw);
  if (legacyDismissed === true) {
    normalized.pinReminder.enabled = false;
  }
  return normalized;
}

async function writeSettings(nextSettings) {
  const storage = getStorageArea();
  if (!storage) {
    return cloneDefaultSettings();
  }
  const normalized = normalizeSettings(nextSettings);
  await wrapStorageSet(storage, SETTINGS_KEY, normalized);
  await syncLegacyPinReminderFlag(storage, normalized.pinReminder.enabled !== false);
  return normalized;
}

export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    ...partialSettings,
    soundNotifications: {
      ...current.soundNotifications,
      ...(partialSettings?.soundNotifications || {}),
    },
    pinReminder: {
      ...current.pinReminder,
      ...(partialSettings?.pinReminder || {}),
    },
  });
  return writeSettings(next);
}

export async function setSoundNotificationsEnabled(enabled) {
  return saveSettings({
    soundNotifications: {
      enabled: Boolean(enabled),
    },
  });
}

export async function setPinReminderEnabled(enabled) {
  return saveSettings({
    pinReminder: {
      enabled: Boolean(enabled),
    },
  });
}

export function addSettingsChangeListener(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }
  const storage = getStorageArea();
  const eventTarget =
    typeof browser !== "undefined" && browser?.storage
      ? browser.storage.onChanged
      : typeof chrome !== "undefined" && chrome?.storage
        ? chrome.storage.onChanged
        : null;

  if (!storage || !eventTarget || typeof eventTarget.addListener !== "function") {
    return () => {};
  }

  const handler = (changes, areaName) => {
    try {
      const area = areaName ?? (changes?.areaName ?? "local");
      if (area !== "local") {
        return;
      }
      const change = changes?.[SETTINGS_KEY];
      if (!change) {
        return;
      }
      const value =
        Object.prototype.hasOwnProperty.call(change, "newValue")
          ? change.newValue
          : change;
      const normalized = normalizeSettings(value);
      callback(normalized);
    } catch (error) {
      console.error("Failed to handle settings change", error);
    }
  };

  eventTarget.addListener(handler);
  return () => {
    try {
      eventTarget.removeListener(handler);
    } catch (error) {
      console.error("Failed to remove settings listener", error);
    }
  };
}

export { SETTINGS_KEY };

async function syncLegacyPinReminderFlag(storage, pinReminderEnabled) {
  const isEnabled = pinReminderEnabled !== false;
  if (isEnabled) {
    await wrapStorageRemove(storage, PIN_REMINDER_DISMISSED_KEY);
    return;
  }
  await wrapStorageSet(storage, PIN_REMINDER_DISMISSED_KEY, true);
}
