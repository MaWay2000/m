import {
  DEFAULT_SETTINGS,
  addSettingsChangeListener,
  getSettings,
  normalizeSettings,
  setSoundNotificationsEnabled,
  setPinReminderEnabled,
} from "./settings.js";

const soundToggle = document.getElementById("sound-enabled");
const pinReminderToggle = document.getElementById("pin-reminder-enabled");
const statusOutput = document.getElementById("options-status");

let isInitializing = true;
let clearStatusTimeout = null;

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
  if (pinReminderToggle) {
    pinReminderToggle.checked = normalized.pinReminder.enabled !== false;
  }
}

async function loadSettingsIntoForm() {
  try {
    const settings = await getSettings();
    updateForm(settings);
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

async function handlePinReminderToggleChange() {
  if (isInitializing || !pinReminderToggle) {
    return;
  }
  const enabled = pinReminderToggle.checked;
  setStatus("Saving preferences…");
  try {
    await setPinReminderEnabled(enabled);
    setStatus("Preferences saved.");
  } catch (error) {
    console.error("Failed to save pin reminder setting", error);
    setStatus(`Unable to save changes: ${error.message}`, { isError: true });
    pinReminderToggle.checked = !enabled;
  }
}

soundToggle?.addEventListener("change", handleSoundToggleChange);
pinReminderToggle?.addEventListener("change", handlePinReminderToggleChange);

document.addEventListener("DOMContentLoaded", () => {
  loadSettingsIntoForm();
});

addSettingsChangeListener((settings) => {
  if (isInitializing) {
    return;
  }
  updateForm(settings);
});
