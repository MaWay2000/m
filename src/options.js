import {
  DEFAULT_SETTINGS,
  addSettingsChangeListener,
  getSettings,
  normalizeSettings,
  setSoundNotificationsEnabled,
  setToolbarIconVisibility,
  setAllHostsPermissionPreference,
} from "./settings.js";

const soundToggle = document.getElementById("sound-enabled");
const toolbarIconToggle = document.getElementById("toolbar-icon-visible");
const allowAllHostsToggle = document.getElementById("allow-all-hosts");
const statusOutput = document.getElementById("options-status");

let isInitializing = true;
let clearStatusTimeout = null;

const permissionsApi =
  (typeof browser !== "undefined" && browser?.permissions) ||
  (typeof chrome !== "undefined" && chrome?.permissions) ||
  null;
const usesPromisePermissionsApi =
  permissionsApi &&
  typeof browser !== "undefined" &&
  browser?.permissions === permissionsApi;
const ALL_HOSTS_PERMISSION = { origins: ["<all_urls>"] };

function getRuntimeLastError() {
  if (typeof browser !== "undefined" && browser?.runtime?.lastError) {
    return browser.runtime.lastError;
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.lastError) {
    return chrome.runtime.lastError;
  }
  return null;
}

function setStatus(message, { isError = false } = {}) {
  if (!statusOutput) {
    return;
  }
  statusOutput.textContent = message ?? "";
  if (isError) {
    statusOutput.classList.add("error");
  } else {
    statusOutput.classList.remove("error");
  }
  if (clearStatusTimeout) {
    clearTimeout(clearStatusTimeout);
    clearStatusTimeout = null;
  }
  if (message) {
    clearStatusTimeout = setTimeout(() => {
      if (statusOutput.textContent === message) {
        statusOutput.textContent = "";
        statusOutput.classList.remove("error");
      }
    }, isError ? 6000 : 2500);
  }
}

function updateForm(settings) {
  const normalized = normalizeSettings(settings ?? DEFAULT_SETTINGS);
  if (soundToggle) {
    soundToggle.checked = normalized.soundNotifications.enabled !== false;
  }
  if (toolbarIconToggle) {
    toolbarIconToggle.checked = normalized.toolbarIcon.visible !== false;
  }
  if (allowAllHostsToggle) {
    allowAllHostsToggle.checked = Boolean(
      normalized.hostPermissions?.allowAllHosts,
    );
  }
}

async function loadSettingsIntoForm() {
  try {
    const settings = await getSettings();
    updateForm(settings);
    await syncAllHostsPermission(settings);
  } catch (error) {
    console.error("Failed to load settings", error);
    updateForm(DEFAULT_SETTINGS);
    setStatus(`Unable to load settings: ${error.message}`, { isError: true });
  } finally {
    isInitializing = false;
  }
}

async function handleSoundToggleChange() {
  if (isInitializing || !soundToggle) {
    return;
  }
  const enabled = soundToggle.checked;
  setStatus("Saving preferences…");
  try {
    await setSoundNotificationsEnabled(enabled);
    setStatus("Preferences saved.");
  } catch (error) {
    console.error("Failed to save sound settings", error);
    setStatus(`Unable to save changes: ${error.message}`, { isError: true });
    soundToggle.checked = !enabled;
  }
}

async function handleToolbarIconToggleChange() {
  if (isInitializing || !toolbarIconToggle) {
    return;
  }
  const visible = toolbarIconToggle.checked;
  setStatus("Saving preferences…");
  try {
    await setToolbarIconVisibility(visible);
    setStatus("Preferences saved.");
  } catch (error) {
    console.error("Failed to save toolbar icon setting", error);
    setStatus(`Unable to save changes: ${error.message}`, { isError: true });
    toolbarIconToggle.checked = !visible;
  }
}

function hasPermissionsApi() {
  return Boolean(permissionsApi);
}

async function requestAllHostsPermission() {
  if (!hasPermissionsApi() || !permissionsApi?.request) {
    throw new Error("Browser does not support runtime permissions.");
  }
  if (usesPromisePermissionsApi) {
    return Boolean(await permissionsApi.request(ALL_HOSTS_PERMISSION));
  }
  return new Promise((resolve, reject) => {
    try {
      permissionsApi.request(ALL_HOSTS_PERMISSION, (granted) => {
        const lastError = getRuntimeLastError();
        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }
        resolve(Boolean(granted));
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function removeAllHostsPermission() {
  if (!hasPermissionsApi() || !permissionsApi?.remove) {
    throw new Error("Browser does not support revoking permissions.");
  }
  if (usesPromisePermissionsApi) {
    return Boolean(await permissionsApi.remove(ALL_HOSTS_PERMISSION));
  }
  return new Promise((resolve, reject) => {
    try {
      permissionsApi.remove(ALL_HOSTS_PERMISSION, (removed) => {
        const lastError = getRuntimeLastError();
        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }
        resolve(Boolean(removed));
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function hasAllHostsPermission() {
  if (!hasPermissionsApi() || !permissionsApi?.contains) {
    return false;
  }
  if (usesPromisePermissionsApi) {
    return Boolean(await permissionsApi.contains(ALL_HOSTS_PERMISSION));
  }
  return new Promise((resolve, reject) => {
    try {
      permissionsApi.contains(ALL_HOSTS_PERMISSION, (result) => {
        const lastError = getRuntimeLastError();
        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }
        resolve(Boolean(result));
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function syncAllHostsPermission(settings) {
  if (!allowAllHostsToggle) {
    return;
  }
  try {
    const hasPermission = await hasAllHostsPermission();
    allowAllHostsToggle.checked = hasPermission;
    const normalized = normalizeSettings(settings ?? DEFAULT_SETTINGS);
    if (normalized.hostPermissions?.allowAllHosts !== hasPermission) {
      await setAllHostsPermissionPreference(hasPermission);
    }
  } catch (error) {
    console.error("Failed to synchronize host permissions", error);
  }
}

async function handleAllowAllHostsToggleChange() {
  if (isInitializing || !allowAllHostsToggle) {
    return;
  }
  const enableAllHosts = allowAllHostsToggle.checked;
  setStatus("Updating permissions…");
  try {
    if (enableAllHosts) {
      const granted = await requestAllHostsPermission();
      const hasPermission = granted || (await hasAllHostsPermission());
      if (!hasPermission) {
        throw new Error("Permission request was dismissed.");
      }
      await setAllHostsPermissionPreference(true);
    } else {
      await removeAllHostsPermission();
      const stillGranted = await hasAllHostsPermission();
      if (stillGranted) {
        throw new Error("Permission could not be removed.");
      }
      await setAllHostsPermissionPreference(false);
    }
    setStatus("Preferences saved.");
  } catch (error) {
    console.error("Failed to update all-host permission", error);
    setStatus(`Unable to update permissions: ${error.message}`, {
      isError: true,
    });
    allowAllHostsToggle.checked = !enableAllHosts;
  }
}

soundToggle?.addEventListener("change", handleSoundToggleChange);
toolbarIconToggle?.addEventListener("change", handleToolbarIconToggleChange);
allowAllHostsToggle?.addEventListener("change", handleAllowAllHostsToggleChange);

document.addEventListener("DOMContentLoaded", () => {
  loadSettingsIntoForm();
});

addSettingsChangeListener((settings) => {
  if (isInitializing) {
    return;
  }
  updateForm(settings);
});

if (permissionsApi?.onAdded && typeof permissionsApi.onAdded.addListener === "function") {
  permissionsApi.onAdded.addListener((permissions) => {
    if (!permissions || !Array.isArray(permissions.origins)) {
      return;
    }
    if (permissions.origins.includes("<all_urls>") && allowAllHostsToggle) {
      allowAllHostsToggle.checked = true;
      setAllHostsPermissionPreference(true).catch((error) => {
        console.error("Failed to persist all-host permission state", error);
      });
    }
  });
}

if (permissionsApi?.onRemoved && typeof permissionsApi.onRemoved.addListener === "function") {
  permissionsApi.onRemoved.addListener((permissions) => {
    if (!permissions || !Array.isArray(permissions.origins)) {
      return;
    }
    if (permissions.origins.includes("<all_urls>") && allowAllHostsToggle) {
      allowAllHostsToggle.checked = false;
      setAllHostsPermissionPreference(false).catch((error) => {
        console.error("Failed to persist all-host permission removal", error);
      });
    }
  });
}
