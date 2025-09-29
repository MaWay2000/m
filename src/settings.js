const SETTINGS_KEY = "codexSettings";

export const DEFAULT_SETTINGS = Object.freeze({
  soundNotifications: {
    enabled: true,
  },
  toolbarIcon: {
    visible: true,
  },
});

function cloneDefaultSettings() {
  return {
    soundNotifications: {
      enabled: DEFAULT_SETTINGS.soundNotifications.enabled,
    },
    toolbarIcon: {
      visible: DEFAULT_SETTINGS.toolbarIcon.visible,
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

    const rawToolbar = rawValue.toolbarIcon;
    if (rawToolbar && typeof rawToolbar === "object") {
      if (rawToolbar.visible !== undefined) {
        normalized.toolbarIcon.visible = Boolean(rawToolbar.visible);
      }
    } else if (rawValue.showToolbarIcon !== undefined) {
      // Support a potential legacy flag name.
      normalized.toolbarIcon.visible = Boolean(rawValue.showToolbarIcon);
    }
  }

  return normalized;
}

export async function getSettings() {
  const storage = getStorageArea();
  if (!storage) {
    return cloneDefaultSettings();
  }
  const raw = await wrapStorageGet(storage, SETTINGS_KEY);
  return normalizeSettings(raw);
}

async function writeSettings(nextSettings) {
  const storage = getStorageArea();
  if (!storage) {
    return cloneDefaultSettings();
  }
  const normalized = normalizeSettings(nextSettings);
  await wrapStorageSet(storage, SETTINGS_KEY, normalized);
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
    toolbarIcon: {
      ...current.toolbarIcon,
      ...(partialSettings?.toolbarIcon || {}),
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

export async function setToolbarIconVisibility(visible) {
  return saveSettings({
    toolbarIcon: {
      visible: Boolean(visible),
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
