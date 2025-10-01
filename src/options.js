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
const DEFAULT_NOTIFICATION_STATUSES = ["ready", "pr-created"];
const DEFAULT_NOTIFICATION_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  merged: "1.mp3",
};
const DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES = [...STATUS_OPTIONS];
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
// Keys and defaults for the custom notification popup appearance. These
// values mirror the constants used in the background script. They
// control where the custom popup window appears, its size and its
// colours. When a coordinate is null or undefined the browser will
// choose a sensible default. Colours are specified as hex strings.
const NOTIFICATION_POPUP_POSITION_STORAGE_KEY =
  "codexNotificationPopupPosition";
const NOTIFICATION_POPUP_SIZE_STORAGE_KEY = "codexNotificationPopupSize";
const NOTIFICATION_POPUP_COLORS_STORAGE_KEY = "codexNotificationPopupColors";
const DEFAULT_NOTIFICATION_POPUP_POSITION = { left: null, top: null };
const DEFAULT_NOTIFICATION_POPUP_SIZE = { width: 360, height: 120 };
const DEFAULT_NOTIFICATION_POPUP_COLORS = {
  background: "#f7fafc",
  text: "#1a1a1a",
};

// Cached popup appearance values. These are populated from storage on
// page load and updated when the user saves changes. Keeping local
// copies avoids repeatedly reading from storage.
let cachedPopupPosition = { ...DEFAULT_NOTIFICATION_POPUP_POSITION };
let cachedPopupSize = { ...DEFAULT_NOTIFICATION_POPUP_SIZE };
let cachedPopupColors = { ...DEFAULT_NOTIFICATION_POPUP_COLORS };

/**
 * Sanitize a stored popup position. Accepts objects with numeric
 * `left` and `top` properties. Returns an object containing left and
 * top coordinates if valid or null if invalid. Null coordinates are
 * interpreted as undefined positions (let the browser decide).
 *
 * @param {any} value
 * @returns {object|null}
 */
function sanitizePopupPositionOption(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result = {};
  if (Object.prototype.hasOwnProperty.call(value, "left")) {
    const left = Number(value.left);
    if (!Number.isNaN(left) && Number.isFinite(left)) {
      result.left = left;
    } else {
      result.left = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "top")) {
    const top = Number(value.top);
    if (!Number.isNaN(top) && Number.isFinite(top)) {
      result.top = top;
    } else {
      result.top = null;
    }
  }
  // If neither property was valid return null to signal invalid input.
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Sanitize a stored popup size. Accepts objects with numeric `width` and
 * `height` properties. Enforces minimum and maximum reasonable sizes
 * (200–800 px width and 80–600 px height). Returns null for invalid
 * input.
 *
 * @param {any} value
 * @returns {object|null}
 */
function sanitizePopupSizeOption(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result = {};
  if (Object.prototype.hasOwnProperty.call(value, "width")) {
    let width = Number(value.width);
    if (!Number.isNaN(width) && Number.isFinite(width)) {
      width = Math.max(200, Math.min(width, 800));
      result.width = width;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "height")) {
    let height = Number(value.height);
    if (!Number.isNaN(height) && Number.isFinite(height)) {
      height = Math.max(80, Math.min(height, 600));
      result.height = height;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Sanitize a stored popup colour configuration. Accepts objects with
 * `background` and `text` properties. Each value must be a valid CSS
 * hex colour string (e.g. "#ffffff" or "#abc"). Returns null if the
 * input is invalid or missing both values.
 *
 * @param {any} value
 * @returns {object|null}
 */
function sanitizePopupColorOption(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const result = {};
  if (typeof value.background === "string" && hexRegex.test(value.background)) {
    result.background = value.background;
  }
  if (typeof value.text === "string" && hexRegex.test(value.text)) {
    result.text = value.text;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Populate the popup appearance controls with the current cached
 * colours. This function updates the colour input elements to show
 * the selected values. The cachedPopupColors object is merged with
 * defaults to ensure both values exist.
 */
function applyPopupColorInputs() {
  const bgInput = document.getElementById("popup-bg-color");
  const textInput = document.getElementById("popup-text-color");
  if (bgInput) {
    bgInput.value =
      cachedPopupColors?.background || DEFAULT_NOTIFICATION_POPUP_COLORS.background;
  }
  if (textInput) {
    textInput.value =
      cachedPopupColors?.text || DEFAULT_NOTIFICATION_POPUP_COLORS.text;
  }
}

/**
 * Load popup position, size and colour preferences from storage. Any
 * missing or invalid values fall back to defaults. The cached values
 * are updated and the colour inputs are refreshed.
 */
async function loadPopupAppearancePreferences() {
  try {
    const [storedPosition, storedSize, storedColors] = await Promise.all([
      storageGet(NOTIFICATION_POPUP_POSITION_STORAGE_KEY),
      storageGet(NOTIFICATION_POPUP_SIZE_STORAGE_KEY),
      storageGet(NOTIFICATION_POPUP_COLORS_STORAGE_KEY),
    ]);
    const pos = sanitizePopupPositionOption(storedPosition);
    if (pos) {
      cachedPopupPosition = {
        ...DEFAULT_NOTIFICATION_POPUP_POSITION,
        ...pos,
      };
    } else {
      cachedPopupPosition = { ...DEFAULT_NOTIFICATION_POPUP_POSITION };
    }
    const size = sanitizePopupSizeOption(storedSize);
    if (size) {
      cachedPopupSize = {
        ...DEFAULT_NOTIFICATION_POPUP_SIZE,
        ...size,
      };
    } else {
      cachedPopupSize = { ...DEFAULT_NOTIFICATION_POPUP_SIZE };
    }
    const colors = sanitizePopupColorOption(storedColors);
    if (colors) {
      cachedPopupColors = {
        ...DEFAULT_NOTIFICATION_POPUP_COLORS,
        ...colors,
      };
    } else {
      cachedPopupColors = { ...DEFAULT_NOTIFICATION_POPUP_COLORS };
    }
    applyPopupColorInputs();
    const statusEl = document.getElementById("popup-appearance-status");
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove("error");
    }
  } catch (err) {
    console.error("Unable to load popup appearance preferences", err);
    // On error fallback to defaults and notify the user.
    cachedPopupPosition = { ...DEFAULT_NOTIFICATION_POPUP_POSITION };
    cachedPopupSize = { ...DEFAULT_NOTIFICATION_POPUP_SIZE };
    cachedPopupColors = { ...DEFAULT_NOTIFICATION_POPUP_COLORS };
    applyPopupColorInputs();
    const statusEl = document.getElementById("popup-appearance-status");
    if (statusEl) {
      statusEl.textContent = `Unable to load popup settings: ${err.message}`;
      statusEl.classList.add("error");
    }
  }
}

/**
 * Save the popup colour preferences selected in the options form. Reads
 * the values from the colour inputs, updates storage and local
 * caches, and updates the UI with a confirmation or error message.
 *
 * @returns {Promise<void>}
 */
async function handleSavePopupColorsClick() {
  const bgInput = document.getElementById("popup-bg-color");
  const textInput = document.getElementById("popup-text-color");
  const statusEl = document.getElementById("popup-appearance-status");
  if (!bgInput || !textInput) {
    return;
  }
  const colorsToStore = {};
  const bgValue = String(bgInput.value || "").trim();
  const textValue = String(textInput.value || "").trim();
  if (bgValue) {
    colorsToStore.background = bgValue;
  }
  if (textValue) {
    colorsToStore.text = textValue;
  }
  try {
    await storageSet(NOTIFICATION_POPUP_COLORS_STORAGE_KEY, colorsToStore);
    cachedPopupColors = {
      ...DEFAULT_NOTIFICATION_POPUP_COLORS,
      ...colorsToStore,
    };
    applyPopupColorInputs();
    if (statusEl) {
      statusEl.textContent = "Popup colours saved.";
      statusEl.classList.remove("error");
    }
  } catch (err) {
    console.error("Unable to save popup colours", err);
    if (statusEl) {
      statusEl.textContent = `Unable to save popup colours: ${err.message}`;
      statusEl.classList.add("error");
    }
  }
}

/**
 * Open a preview window to allow the user to reposition and resize the
 * custom notification popup. While the preview window is open the
 * extension listens for bounds changes and updates local variables with
 * the latest position and size. When the window is closed, the final
 * bounds are persisted to storage and the UI is updated accordingly.
 */
async function handleEditPopupPositionClick() {
  const statusEl = document.getElementById("popup-appearance-status");
  // Determine the runtime and windows APIs. We prefer the standard
  // browser API but fallback to chrome when necessary.
  const runtimeApi =
    (typeof browser !== "undefined" && browser?.runtime) ||
    (typeof chrome !== "undefined" && chrome?.runtime) ||
    null;
  const windowsApi =
    (typeof browser !== "undefined" && browser?.windows) ||
    (typeof chrome !== "undefined" && chrome?.windows) ||
    null;
  if (!runtimeApi || !windowsApi || !windowsApi.create) {
    if (statusEl) {
      statusEl.textContent = "Popup preview is not supported in this browser.";
      statusEl.classList.add("error");
    }
    return;
  }
  // Build the URL for the preview window. Set edit=1 so the custom
  // notification page does not auto-close or play audio. Provide a
  // short message instructing the user to move the window.
  const params = new URLSearchParams();
  params.set("title", "Preview");
  params.set("message", "Move this window to choose position");
  params.set("edit", "1");
  // Pass through the currently selected colours to match the final
  // appearance. These override the defaults in the notification page.
  if (cachedPopupColors?.background) {
    params.set("bg", cachedPopupColors.background);
  }
  if (cachedPopupColors?.text) {
    params.set("text", cachedPopupColors.text);
  }
  const previewUrl = runtimeApi.getURL(
    `src/custom-notification.html?${params.toString()}`,
  );
  // Determine initial dimensions. Use cached values when present.
  const width =
    typeof cachedPopupSize?.width === "number"
      ? cachedPopupSize.width
      : DEFAULT_NOTIFICATION_POPUP_SIZE.width;
  const height =
    typeof cachedPopupSize?.height === "number"
      ? cachedPopupSize.height
      : DEFAULT_NOTIFICATION_POPUP_SIZE.height;
  // Compose the options for the preview window. Only set left and top
  // coordinates when they are numbers. When null, omit them to let
  // the browser choose a default (usually centred).
  const createOptions = {
    url: previewUrl,
    type: "popup",
    width,
    height,
    allowScriptsToClose: true,
  };
  if (
    cachedPopupPosition &&
    typeof cachedPopupPosition.left === "number"
  ) {
    createOptions.left = cachedPopupPosition.left;
  }
  if (
    cachedPopupPosition &&
    typeof cachedPopupPosition.top === "number"
  ) {
    createOptions.top = cachedPopupPosition.top;
  }
  try {
    const createdWindow = await windowsApi.create(createOptions);
    const editingWindowId =
      createdWindow && typeof createdWindow.id === "number"
        ? createdWindow.id
        : null;
    if (editingWindowId === null) {
      if (statusEl) {
        statusEl.textContent = "Unable to open the preview window.";
        statusEl.classList.add("error");
      }
      return;
    }
    // Local variables to hold the latest bounds while editing. Start with
    // the existing cached values so unchanged coordinates persist.
    let lastPosition = { ...cachedPopupPosition };
    let lastSize = { ...cachedPopupSize };
    // Listener for bounds changes. Signature varies between browsers:
    // Firefox passes a Window object while Chrome may pass a windowId
    // followed by bounds. This handler accounts for both. When the event
    // pertains to our preview window, update the lastPosition and lastSize.
    const boundsListener = (...args) => {
      // Determine the window ID and bounds from the event arguments.
      let winInfo = null;
      let id = null;
      if (args.length && typeof args[0] === "object" && args[0] !== null) {
        // Firefox: first arg is the window object.
        winInfo = args[0];
        id = winInfo.id;
      } else if (args.length && typeof args[0] === "number") {
        // Chrome: first arg is the windowId. Attempt to fetch details.
        id = args[0];
      }
      if (id !== editingWindowId) {
        return;
      }
      // If we did not receive the window object directly, retrieve it.
      const updateFromWin = (info) => {
        if (!info) {
          return;
        }
        if (typeof info.left === "number") {
          lastPosition.left = info.left;
        }
        if (typeof info.top === "number") {
          lastPosition.top = info.top;
        }
        if (typeof info.width === "number") {
          lastSize.width = info.width;
        }
        if (typeof info.height === "number") {
          lastSize.height = info.height;
        }
      };
      if (winInfo) {
        updateFromWin(winInfo);
      } else if (windowsApi.get) {
        try {
          // Fetch asynchronously; ignore errors.
          windowsApi.get(id).then((info) => {
            updateFromWin(info);
          });
        } catch (e) {
          // ignore
        }
      }
    };
    windowsApi.onBoundsChanged.addListener(boundsListener);
    // Listener for when the preview window is closed. Finalise the
    // position and size by writing the last known bounds to storage and
    // updating local caches. Remove event listeners to avoid leaks.
    const removedListener = async (removedWindowId) => {
      if (removedWindowId !== editingWindowId) {
        return;
      }
      try {
        windowsApi.onBoundsChanged.removeListener(boundsListener);
        windowsApi.onRemoved.removeListener(removedListener);
      } catch (e) {
        // ignore errors removing listeners
      }
      try {
        const positionToStore = {};
        if (typeof lastPosition.left === "number") {
          positionToStore.left = lastPosition.left;
        }
        if (typeof lastPosition.top === "number") {
          positionToStore.top = lastPosition.top;
        }
        const sizeToStore = {};
        if (typeof lastSize.width === "number") {
          sizeToStore.width = lastSize.width;
        }
        if (typeof lastSize.height === "number") {
          sizeToStore.height = lastSize.height;
        }
        await Promise.all([
          storageSet(NOTIFICATION_POPUP_POSITION_STORAGE_KEY, positionToStore),
          storageSet(NOTIFICATION_POPUP_SIZE_STORAGE_KEY, sizeToStore),
        ]);
        // Update caches and UI.
        cachedPopupPosition = {
          ...DEFAULT_NOTIFICATION_POPUP_POSITION,
          ...positionToStore,
        };
        cachedPopupSize = {
          ...DEFAULT_NOTIFICATION_POPUP_SIZE,
          ...sizeToStore,
        };
        if (statusEl) {
          statusEl.textContent = "Popup position and size saved.";
          statusEl.classList.remove("error");
        }
      } catch (err) {
        console.error("Failed to save popup bounds", err);
        if (statusEl) {
          statusEl.textContent = `Unable to save popup bounds: ${err.message}`;
          statusEl.classList.add("error");
        }
      }
    };
    windowsApi.onRemoved.addListener(removedListener);
  } catch (err) {
    console.error("Unable to open preview window", err);
    if (statusEl) {
      statusEl.textContent = `Unable to open preview window: ${err.message}`;
      statusEl.classList.add("error");
    }
  }
}
let cachedNotificationStatuses = [...DEFAULT_NOTIFICATION_STATUSES];
let cachedSoundEnabledStatuses = [...DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES];

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
    const [storedStatuses, storedSelections, storedSoundEnabledStatuses] =
      await Promise.all([
        storageGet(NOTIFICATION_STATUS_STORAGE_KEY),
        storageGet(NOTIFICATION_SOUND_SELECTION_STORAGE_KEY),
        storageGet(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY),
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

    showNotificationStatusMessage("");
  } catch (error) {
    console.error("Unable to load notification preferences", error);
    applyNotificationStatuses(DEFAULT_NOTIFICATION_STATUSES);
    applyNotificationSoundSelections(DEFAULT_NOTIFICATION_SOUND_SELECTIONS);
    applyNotificationSoundEnabledStatuses(
      DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
    );
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

/**
 * Send a message to the background script using the browser or chrome
 * runtime API. Falls back to chrome.runtime.sendMessage if necessary.
 * Returns a promise that resolves with the response or rejects on error.
 *
 * @param {any} message The message payload to send.
 * @returns {Promise<any>} A promise resolving to the response.
 */
function sendRuntimeMessage(message) {
  // Prefer the standard browser API when available.
  if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
    try {
      const result = browser.runtime.sendMessage(message);
      if (result && typeof result.then === "function") {
        return result;
      }
    } catch (error) {
      return Promise.reject(error);
    }
  }
  // Fallback to chrome API with callback pattern.
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome?.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  return Promise.reject(new Error("Runtime API is unavailable."));
}

/**
 * Handles clicks on the test notification button. Reads the selected
 * notification statuses and triggers a sample notification via the
 * background script. Displays a status message to the user on
 * completion or failure.
 *
 * @param {Event} event The click event.
 */
async function handleTestNotificationClick(event) {
  const button = event?.target instanceof HTMLButtonElement ? event.target : null;
  if (button) {
    // Prevent multiple concurrent clicks.
    button.disabled = true;
  }
  try {
    const selectedStatuses = readNotificationStatuses();
    // Sanitise the list; returns null if invalid but we treat that as empty.
    const sanitised = sanitizeNotificationStatuses(selectedStatuses);
    const statusesToTest = Array.isArray(sanitised) ? sanitised : [];
    await sendRuntimeMessage({ type: "test-notification", statuses: statusesToTest });
    showNotificationStatusMessage("Test notification sent.");
  } catch (error) {
    console.error("Unable to send test notification", error);
    showNotificationStatusMessage(`Unable to send test notification: ${error.message}`, true);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
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
    } catch (error) {
      console.error("Unable to save notification sound setting", error);
      showNotificationStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }

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

  // Hook up the test notification button if it exists. This allows
  // users to trigger a sample notification based on their current
  // preferences. We defer adding the listener until DOMContentLoaded to
  // ensure the element is present.
  const testButton = document.getElementById("test-notification-btn");
  if (testButton) {
    testButton.addEventListener("click", handleTestNotificationClick);
  }

  // Load popup appearance settings and wire up controls. This ensures the
  // colour inputs reflect stored values and the preview button and save
  // colours button operate correctly.
  loadPopupAppearancePreferences();
  const editPopupBtn = document.getElementById("edit-popup-position-btn");
  if (editPopupBtn) {
    editPopupBtn.addEventListener("click", handleEditPopupPositionClick);
  }
  const savePopupColorsBtn = document.getElementById("save-popup-colors-btn");
  if (savePopupColorsBtn) {
    savePopupColorsBtn.addEventListener("click", handleSavePopupColorsClick);
  }
});
