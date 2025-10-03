const storageApi =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : typeof chrome !== "undefined" && chrome?.storage
      ? chrome.storage
      : null;
const runtimeApi =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : typeof chrome !== "undefined" && chrome?.runtime
      ? chrome.runtime
      : null;

const previewEditingSessions = new Map();

if (runtimeApi?.onMessage && typeof runtimeApi.onMessage.addListener === "function") {
  runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "codexPopupPreviewBounds") {
      return undefined;
    }
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : null;
    if (!sessionId || !previewEditingSessions.has(sessionId)) {
      if (typeof sendResponse === "function") {
        try {
          sendResponse({ success: false });
        } catch (err) {
          // Ignore sendResponse errors
        }
      }
      return false;
    }
    const session = previewEditingSessions.get(sessionId);
    if (session && typeof session.updateBounds === "function") {
      try {
        session.updateBounds(message.position ?? {}, message.size ?? {});
      } catch (err) {
        // Ignore errors updating bounds from preview message
      }
    }
    if (typeof sendResponse === "function") {
      try {
        sendResponse({ success: true });
      } catch (err) {
        // Ignore sendResponse errors
      }
    }
    return false;
  });
}

// Include the new "pr-ready" status representing a pull request that is
// ready to view. This array controls the order of statuses displayed in
// the settings and is used to derive default sound enablement.
const STATUS_OPTIONS = ["ready", "pr-created", "pr-ready", "merged"];
const STATUS_VALUES = new Set(STATUS_OPTIONS);
const NOTIFICATION_STATUS_STORAGE_KEY = "codexNotificationStatuses";
const NOTIFICATION_SOUND_SELECTION_STORAGE_KEY =
  "codexNotificationSoundSelections";
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY =
  "codexNotificationSoundEnabledStatuses";
// By default, enable notifications for tasks that are ready, have an
// associated pull request created and when that pull request is ready to
// view. The user can disable any of these statuses via the settings.
const DEFAULT_NOTIFICATION_STATUSES = ["ready", "pr-created", "pr-ready"];
const DEFAULT_NOTIFICATION_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  // Default audio file for the PR ready status. Can be customised in the UI.
  "pr-ready": "1.mp3",
  merged: "1.mp3",
};
const DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES = [...STATUS_OPTIONS];
const STATUS_LABELS = {
  ready: "Task ready to view",
  "pr-created": "PR ready to create",
  // Human‑friendly label for the PR ready status.
  "pr-ready": "PR ready to view (Open github)",
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

// Storage key and defaults for auto-click preferences. When a status
// appears in this list the extension will automatically perform the
// associated click behaviour (opening tasks or creating pull requests)
// for that status. Users can toggle each status via the settings UI.
const AUTO_CLICK_STATUS_STORAGE_KEY = "codexAutoClickStatuses";
const DEFAULT_AUTO_CLICK_STATUSES = ["ready", "pr-created"];

// Storage key and default for the PR ready auto-click delay. This controls
// how long (in milliseconds) to wait after the "View PR" button appears
// before automatically clicking it when auto-click for the pr-ready status
// is enabled. Users can customise this value in the settings. A value of
// 0 disables the delay entirely. The UI presents the delay in seconds.
const PR_READY_AUTO_CLICK_DELAY_KEY = "codexPrReadyAutoClickDelayMs";
const DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS = 3000;

// Cached copy of the PR ready auto-click delay (milliseconds). Loaded on
// page initialisation and updated when the user changes the delay. This
// value is referenced when applying the delay in the content script.
let cachedPrReadyAutoClickDelayMs = DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS;

// Storage key and default for whether the task tab should be closed when
// the PR becomes ready. When true, the extension will close the tab
// opened for the ready task once the pull request is ready to view. Only
// applicable to the pr-ready status. Exposed via a checkbox in the
// settings.
const PR_READY_CLOSE_TAB_KEY = "codexPrReadyCloseTab";
const DEFAULT_PR_READY_CLOSE_TAB = false;

// Cached copy of the close-tab preference. Updated on load and when the
// user changes the setting. Used by the UI to reflect the current
// preference.
let cachedPrReadyCloseTab = DEFAULT_PR_READY_CLOSE_TAB;

// Storage keys and defaults for GitHub merge automation preferences. These
// control whether the extension should automatically click the "Merge pull
// request" and "Confirm merge" buttons on GitHub PR pages, and whether
// to close the GitHub tab after confirming the merge. Each preference
// defaults to false (disabled).
const MERGE_PR_AUTO_CLICK_KEY = "codexMergePrAutoClickEnabled";
const DEFAULT_MERGE_PR_AUTO_CLICK = false;
const CONFIRM_MERGE_AUTO_CLICK_KEY = "codexConfirmMergeAutoClickEnabled";
const DEFAULT_CONFIRM_MERGE_AUTO_CLICK = false;
const CLOSE_GITHUB_AFTER_MERGE_KEY = "codexCloseGithubAfterMergeEnabled";
const DEFAULT_CLOSE_GITHUB_AFTER_MERGE = false;

// Cached copies of the GitHub merge automation preferences. These values
// are updated when loading from storage and when the user toggles the
// corresponding checkbox in the options UI. Keeping local copies avoids
// repeatedly reading from storage and allows immediate UI updates.
let cachedMergePrAutoClick = DEFAULT_MERGE_PR_AUTO_CLICK;
let cachedConfirmMergeAutoClick = DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
let cachedCloseGithubAfterMerge = DEFAULT_CLOSE_GITHUB_AFTER_MERGE;
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
  page: "#ffffff",
  text: "#1a1a1a",
};

// Cached popup appearance values. These are populated from storage on
// page load and updated when the user changes the settings. Keeping local
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
 * `background`, `page`, and `text` properties. Each value must be a valid CSS
 * hex colour string (e.g. "#ffffff" or "#abc"). Returns null if the
 * input is invalid or missing all values.
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
  if (typeof value.page === "string" && hexRegex.test(value.page)) {
    result.page = value.page;
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
  const pageInput = document.getElementById("popup-page-color");
  const textInput = document.getElementById("popup-text-color");
  if (bgInput) {
    bgInput.value =
      cachedPopupColors?.background || DEFAULT_NOTIFICATION_POPUP_COLORS.background;
  }
  if (pageInput) {
    pageInput.value =
      cachedPopupColors?.page || DEFAULT_NOTIFICATION_POPUP_COLORS.page;
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
async function handlePopupColorChange() {
  const bgInput = document.getElementById("popup-bg-color");
  const pageInput = document.getElementById("popup-page-color");
  const textInput = document.getElementById("popup-text-color");
  const statusEl = document.getElementById("popup-appearance-status");
  if (!bgInput || !pageInput || !textInput) {
    return;
  }
  const bgValue = String(bgInput.value || "").trim();
  const pageValue = String(pageInput.value || "").trim();
  const textValue = String(textInput.value || "").trim();
  const colorsToStore = {};
  if (bgValue) {
    colorsToStore.background = bgValue;
  }
  if (pageValue) {
    colorsToStore.page = pageValue;
  }
  if (textValue) {
    colorsToStore.text = textValue;
  }
  const normalizedColors = {
    ...DEFAULT_NOTIFICATION_POPUP_COLORS,
    ...colorsToStore,
  };
  if (
    cachedPopupColors.background === normalizedColors.background &&
    cachedPopupColors.page === normalizedColors.page &&
    cachedPopupColors.text === normalizedColors.text
  ) {
    return;
  }
  try {
    await storageSet(NOTIFICATION_POPUP_COLORS_STORAGE_KEY, colorsToStore);
    cachedPopupColors = normalizedColors;
    applyPopupColorInputs();
    if (statusEl) {
      statusEl.textContent = "Popup colours updated.";
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
  const sessionId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const params = new URLSearchParams();
  params.set("title", "Preview");
  params.set("message", "Move and click here to save");
  params.set("edit", "1");
  params.set("session", sessionId);
  // Pass through the currently selected colours to match the final
  // appearance. These override the defaults in the notification page.
  if (cachedPopupColors?.background) {
    params.set("bg", cachedPopupColors.background);
  }
  if (cachedPopupColors?.page) {
    params.set("page", cachedPopupColors.page);
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
    let autosaveTimeoutId = null;

    const persistBounds = async (
      position,
      size,
      { showSuccessMessage = true } = {},
    ) => {
      const positionToStore = {};
      if (typeof position.left === "number") {
        positionToStore.left = position.left;
      }
      if (typeof position.top === "number") {
        positionToStore.top = position.top;
      }
      const sizeToStore = {};
      if (typeof size.width === "number") {
        sizeToStore.width = size.width;
      }
      if (typeof size.height === "number") {
        sizeToStore.height = size.height;
      }

      try {
        await Promise.all([
          storageSet(
            NOTIFICATION_POPUP_POSITION_STORAGE_KEY,
            positionToStore,
          ),
          storageSet(NOTIFICATION_POPUP_SIZE_STORAGE_KEY, sizeToStore),
        ]);
        cachedPopupPosition = {
          ...DEFAULT_NOTIFICATION_POPUP_POSITION,
          ...positionToStore,
        };
        cachedPopupSize = {
          ...DEFAULT_NOTIFICATION_POPUP_SIZE,
          ...sizeToStore,
        };
        if (showSuccessMessage && statusEl) {
          statusEl.textContent = "Popup position and size updated.";
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

    const scheduleAutosave = () => {
      if (autosaveTimeoutId !== null) {
        return;
      }
      autosaveTimeoutId = setTimeout(() => {
        autosaveTimeoutId = null;
        persistBounds(lastPosition, lastSize, { showSuccessMessage: false });
      }, 500);
    };
    previewEditingSessions.set(sessionId, {
      updateBounds(position = {}, size = {}) {
        if (position && typeof position.left === "number") {
          lastPosition.left = position.left;
        }
        if (position && typeof position.top === "number") {
          lastPosition.top = position.top;
        }
        if (size && typeof size.width === "number") {
          lastSize.width = size.width;
        }
        if (size && typeof size.height === "number") {
          lastSize.height = size.height;
        }
        scheduleAutosave();
      },
    });
    const fetchWindowInfo = async (id) => {
      if (!windowsApi?.get || typeof windowsApi.get !== "function") {
        return null;
      }
      try {
        const result = windowsApi.get(id);
        if (result && typeof result.then === "function") {
          return await result;
        }
      } catch (err) {
        // Some browsers (notably Chrome) throw when the callback is omitted.
        // Fall back to the callback form below.
      }
      return new Promise((resolve) => {
        try {
          windowsApi.get(id, (info) => {
            if (
              typeof chrome !== "undefined" &&
              chrome?.runtime?.lastError
            ) {
              resolve(null);
              return;
            }
            resolve(info ?? null);
          });
        } catch (error) {
          resolve(null);
        }
      });
    };
    // Listener for bounds changes. Signature varies between browsers:
    // Firefox passes a Window object while Chrome may pass a windowId
    // followed by bounds. This handler accounts for both. When the event
    // pertains to our preview window, update the lastPosition and lastSize.
    let boundsListener = null;
    if (
      windowsApi.onBoundsChanged &&
      typeof windowsApi.onBoundsChanged.addListener === "function"
    ) {
      boundsListener = (...args) => {
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
          scheduleAutosave();
          return;
        }
        fetchWindowInfo(id)
          .then((info) => {
            if (info) {
              updateFromWin(info);
            }
          })
          .finally(() => {
            scheduleAutosave();
          });
      };
      windowsApi.onBoundsChanged.addListener(boundsListener);
    } else {
      console.warn(
        "windows.onBoundsChanged API not available; popup position will only be stored when the window closes.",
      );
    }
    // Listener for when the preview window is closed. Finalise the
    // position and size by writing the last known bounds to storage and
    // updating local caches. Remove event listeners to avoid leaks.
    const removedListener = async (removedWindowId) => {
      if (removedWindowId !== editingWindowId) {
        return;
      }
      try {
        if (
          boundsListener &&
          windowsApi.onBoundsChanged &&
          typeof windowsApi.onBoundsChanged.removeListener === "function"
        ) {
          windowsApi.onBoundsChanged.removeListener(boundsListener);
        }
        windowsApi.onRemoved.removeListener(removedListener);
      } catch (e) {
        // ignore errors removing listeners
      }
      previewEditingSessions.delete(sessionId);
      try {
        if (autosaveTimeoutId !== null) {
          clearTimeout(autosaveTimeoutId);
          autosaveTimeoutId = null;
        }
        await persistBounds(lastPosition, lastSize, { showSuccessMessage: true });
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
    previewEditingSessions.delete(sessionId);
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

/**
 * Sanitize a list of auto-click statuses. Accepts an array of strings and
 * returns a lower‑cased, deduplicated array containing only valid status
 * keys. Returns null if the input is not a valid array. This mirrors
 * sanitizeNotificationStatuses but is defined separately for clarity.
 *
 * @param {any} value
 * @returns {string[]|null}
 */
function sanitizeAutoClickStatuses(value) {
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

/**
 * Apply auto-click statuses to the UI. Checks the appropriate
 * checkboxes for each status and clears others. If no statuses are
 * provided, all auto-click checkboxes will be unchecked.
 *
 * @param {string[]} statuses
 */
function applyAutoClickStatuses(statuses) {
  const values = new Set(Array.isArray(statuses) ? statuses : []);
  for (const status of STATUS_OPTIONS) {
    const input = document.querySelector(
      `input[name="autoclick-status"][value="${status}"]`,
    );
    if (input) {
      input.checked = values.has(status);
    }
  }
}

/**
 * Sanitize the stored PR ready auto-click delay. Accepts any input and
 * returns a non-negative integer representing milliseconds. Values
 * greater than 60000 ms (1 minute) are clamped down to 60000. Returns
 * null if the input cannot be interpreted as a number.
 *
 * @param {any} value
 * @returns {number|null}
 */
function sanitizePrReadyAutoClickDelayMs(value) {
  if (value == null) {
    return null;
  }
  const delay = Number(value);
  if (Number.isNaN(delay) || !Number.isFinite(delay)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(60000, Math.round(delay)));
  return clamped;
}

/**
 * Apply the PR ready close-tab preference to the UI and update the cached
 * value. Expects a boolean; anything truthy becomes true.
 *
 * @param {any} value
 */
function applyPrReadyCloseTabPreference(value) {
  const input = document.querySelector(
    'input[name="close-task-tab"][data-status="pr-ready"]',
  );
  if (!input) {
    return;
  }
  const enabled = Boolean(value);
  input.checked = enabled;
  cachedPrReadyCloseTab = enabled;
}

/**
 * Apply the merge PR auto-click preference to the UI and update the
 * cached value. Accepts any value and converts it to a boolean. When
 * enabled the checkbox labelled "Auto-click \"Merge pull request\"
 * is checked.
 *
 * @param {any} value
 */
function applyMergePrAutoClick(value) {
  const input = document.getElementById("auto-merge-pr");
  if (!input) {
    return;
  }
  const enabled = Boolean(value);
  input.checked = enabled;
  cachedMergePrAutoClick = enabled;
}

/**
 * Apply the confirm merge auto-click preference to the UI and update
 * the cached value. When enabled the checkbox labelled "Auto-click
 * \"Confirm merge\"" is checked.
 *
 * @param {any} value
 */
function applyConfirmMergeAutoClick(value) {
  const input = document.getElementById("auto-confirm-merge");
  if (!input) {
    return;
  }
  const enabled = Boolean(value);
  input.checked = enabled;
  cachedConfirmMergeAutoClick = enabled;
}

/**
 * Apply the close GitHub after merge preference to the UI and update
 * the cached value. When enabled the checkbox labelled "Close GitHub
 * window when Confirm merge clicked" is checked.
 *
 * @param {any} value
 */
function applyCloseGithubAfterMerge(value) {
  const input = document.getElementById("close-github-after-merge");
  if (!input) {
    return;
  }
  const enabled = Boolean(value);
  input.checked = enabled;
  cachedCloseGithubAfterMerge = enabled;
}

/**
 * Load the merge PR auto-click preference from storage and apply it to
 * the settings page. Defaults to false when missing or invalid.
 */
async function loadMergePrAutoClickPreference() {
  try {
    const stored = await storageGet(MERGE_PR_AUTO_CLICK_KEY);
    const enabled = typeof stored === "boolean" ? stored : DEFAULT_MERGE_PR_AUTO_CLICK;
    applyMergePrAutoClick(enabled);
  } catch (error) {
    console.error("Unable to load merge PR auto-click preference", error);
    applyMergePrAutoClick(DEFAULT_MERGE_PR_AUTO_CLICK);
  }
}

/**
 * Load the confirm merge auto-click preference from storage and apply it.
 */
async function loadConfirmMergeAutoClickPreference() {
  try {
    const stored = await storageGet(CONFIRM_MERGE_AUTO_CLICK_KEY);
    const enabled = typeof stored === "boolean" ? stored : DEFAULT_CONFIRM_MERGE_AUTO_CLICK;
    applyConfirmMergeAutoClick(enabled);
  } catch (error) {
    console.error("Unable to load confirm merge auto-click preference", error);
    applyConfirmMergeAutoClick(DEFAULT_CONFIRM_MERGE_AUTO_CLICK);
  }
}

/**
 * Load the close GitHub after merge preference from storage and apply it.
 */
async function loadCloseGithubAfterMergePreference() {
  try {
    const stored = await storageGet(CLOSE_GITHUB_AFTER_MERGE_KEY);
    const enabled = typeof stored === "boolean" ? stored : DEFAULT_CLOSE_GITHUB_AFTER_MERGE;
    applyCloseGithubAfterMerge(enabled);
  } catch (error) {
    console.error("Unable to load close GitHub after merge preference", error);
    applyCloseGithubAfterMerge(DEFAULT_CLOSE_GITHUB_AFTER_MERGE);
  }
}

/**
 * Handle changes to the merge PR auto-click checkbox. Persists the new
 * value in storage and updates the UI. Displays a status message
 * indicating whether the setting was saved successfully.
 *
 * @param {Event} event
 */
async function handleMergePrAutoClickChange(event) {
  const input = event?.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "auto-merge-pr") {
    return;
  }
  const enabled = Boolean(input.checked);
  try {
    await storageSet(MERGE_PR_AUTO_CLICK_KEY, enabled);
    applyMergePrAutoClick(enabled);
    showNotificationStatusMessage(
      enabled
        ? 'The "Merge pull request" button will be clicked automatically.'
        : 'Automatic clicking of the "Merge pull request" button has been disabled.',
    );
  } catch (error) {
    console.error("Unable to save merge PR auto-click preference", error);
    showNotificationStatusMessage(
      `Unable to save merge PR auto-click preference: ${error.message}`,
      true,
    );
  }
}

/**
 * Handle changes to the confirm merge auto-click checkbox. Persists
 * the new value in storage and updates the UI.
 *
 * @param {Event} event
 */
async function handleConfirmMergeAutoClickChange(event) {
  const input = event?.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "auto-confirm-merge") {
    return;
  }
  const enabled = Boolean(input.checked);
  try {
    await storageSet(CONFIRM_MERGE_AUTO_CLICK_KEY, enabled);
    applyConfirmMergeAutoClick(enabled);
    showNotificationStatusMessage(
      enabled
        ? 'The "Confirm merge" button will be clicked automatically.'
        : 'Automatic clicking of the "Confirm merge" button has been disabled.',
    );
  } catch (error) {
    console.error("Unable to save confirm merge auto-click preference", error);
    showNotificationStatusMessage(
      `Unable to save confirm merge auto-click preference: ${error.message}`,
      true,
    );
  }
}

/**
 * Handle changes to the close GitHub after merge checkbox. Persists
 * the new value in storage and updates the UI.
 *
 * @param {Event} event
 */
async function handleCloseGithubAfterMergeChange(event) {
  const input = event?.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "close-github-after-merge") {
    return;
  }
  const enabled = Boolean(input.checked);
  try {
    await storageSet(CLOSE_GITHUB_AFTER_MERGE_KEY, enabled);
    applyCloseGithubAfterMerge(enabled);
    showNotificationStatusMessage(
      enabled
        ? 'The GitHub tab will be closed after the merge is confirmed.'
        : 'The GitHub tab will remain open after confirming the merge.',
    );
  } catch (error) {
    console.error("Unable to save close GitHub after merge preference", error);
    showNotificationStatusMessage(
      `Unable to save close GitHub after merge preference: ${error.message}`,
      true,
    );
  }
}

/**
 * Load the PR ready close-tab preference from storage and apply it to
 * the settings page. Falls back to the default when missing or
 * invalid.
 */
async function loadPrReadyCloseTabPreference() {
  try {
    const stored = await storageGet(PR_READY_CLOSE_TAB_KEY);
    const enabled = typeof stored === "boolean" ? stored : DEFAULT_PR_READY_CLOSE_TAB;
    applyPrReadyCloseTabPreference(enabled);
  } catch (error) {
    console.error("Unable to load PR ready close-tab preference", error);
    applyPrReadyCloseTabPreference(DEFAULT_PR_READY_CLOSE_TAB);
  }
}

/**
 * Handle changes to the close-tab checkbox for the pr-ready status. When
 * toggled, persist the new value and update the UI. Other statuses are
 * ignored since they are disabled.
 *
 * @param {Event} event
 */
async function handlePrReadyCloseTabChange(event) {
  const input = event?.target;
  if (!(input instanceof HTMLInputElement) || input.name !== "close-task-tab") {
    return;
  }
  const status = input.dataset?.status;
  if (status !== "pr-ready") {
    return;
  }
  const enabled = Boolean(input.checked);
  try {
    await storageSet(PR_READY_CLOSE_TAB_KEY, enabled);
    applyPrReadyCloseTabPreference(enabled);
    showNotificationStatusMessage(
      enabled
        ? "The task tab will be closed when the PR is ready."
        : "The task tab will remain open when the PR is ready.",
    );
  } catch (error) {
    console.error("Unable to save PR ready close-tab preference", error);
    showNotificationStatusMessage(
      `Unable to save close-tab preference: ${error.message}`,
      true,
    );
  }
}

/**
 * Apply the PR ready auto-click delay to the UI and update the cached
 * value. Converts milliseconds to seconds for display. If the input is
 * invalid the default value is used. Does not persist the value to
 * storage; call handlePrReadyDelayChange instead for persistence.
 *
 * @param {number} delayMs
 */
function applyPrReadyAutoClickDelay(delayMs) {
  const input = document.getElementById("pr-ready-delay");
  if (!input) {
    return;
  }
  const ms = typeof delayMs === "number" && Number.isFinite(delayMs)
    ? Math.max(0, delayMs)
    : DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS;
  const seconds = Math.round(ms / 1000);
  input.value = String(seconds);
  cachedPrReadyAutoClickDelayMs = ms;
}

/**
 * Load the PR ready auto-click delay from storage and apply it to the
 * settings page. Falls back to the default when the stored value is
 * missing or invalid. Errors are logged but ignored.
 */
async function loadPrReadyAutoClickDelay() {
  try {
    const stored = await storageGet(PR_READY_AUTO_CLICK_DELAY_KEY);
    const sanitised = sanitizePrReadyAutoClickDelayMs(stored);
    const effective = sanitised !== null ? sanitised : DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS;
    applyPrReadyAutoClickDelay(effective);
  } catch (error) {
    console.error("Unable to load PR ready auto-click delay", error);
    applyPrReadyAutoClickDelay(DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS);
  }
}

/**
 * Handle changes to the PR ready auto-click delay input. Persists the
 * new delay in storage and updates the UI. Displays a status message
 * indicating whether the value was saved successfully.
 *
 * @param {Event} event
 */
async function handlePrReadyDelayChange(event) {
  const input = event?.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "pr-ready-delay") {
    return;
  }
  const rawSeconds = Number(input.value);
  const seconds = Number.isFinite(rawSeconds) ? Math.max(0, Math.round(rawSeconds)) : 0;
  const ms = seconds * 1000;
  const sanitised = sanitizePrReadyAutoClickDelayMs(ms);
  const valueToStore = sanitised !== null ? sanitised : DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS;
  try {
    await storageSet(PR_READY_AUTO_CLICK_DELAY_KEY, valueToStore);
    applyPrReadyAutoClickDelay(valueToStore);
    showNotificationStatusMessage(
      `PR ready auto‑click delay set to ${Math.round(valueToStore / 1000)} seconds.`,
    );
  } catch (error) {
    console.error("Unable to save PR ready auto-click delay", error);
    showNotificationStatusMessage(
      `Unable to save PR ready auto‑click delay: ${error.message}`,
      true,
    );
  }
}

/**
 * Read the currently selected auto-click statuses from the UI. Returns
 * an array of status keys corresponding to checkboxes that are checked.
 *
 * @returns {string[]}
 */
function readAutoClickStatuses() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return [];
  }
  const inputs = form.querySelectorAll(
    'input[name="autoclick-status"]:checked',
  );
  const selected = [];
  for (const input of inputs) {
    selected.push(input.value);
  }
  return selected;
}

/**
 * Load the auto-click preferences from storage and apply them to the UI.
 * Falls back to the default list when preferences are missing or invalid.
 */
async function loadAutoClickPreferences() {
  try {
    const stored = await storageGet(AUTO_CLICK_STATUS_STORAGE_KEY);
    const sanitized = sanitizeAutoClickStatuses(stored);
    const statuses = sanitized !== null ? sanitized : DEFAULT_AUTO_CLICK_STATUSES;
    applyAutoClickStatuses(statuses);
  } catch (error) {
    console.error("Unable to load auto-click preferences", error);
    applyAutoClickStatuses(DEFAULT_AUTO_CLICK_STATUSES);
  }
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

  const toggles = form.querySelectorAll(
    'input[name="notification-sound-enabled"]',
  );
  // Do not disable sound toggles based on notification status. Users can
  // enable or disable sound independently of whether popups are shown.
  for (const toggle of toggles) {
    toggle.disabled = false;
  }
}

function updateNotificationSoundSelectState() {
  const form = document.getElementById("notification-preferences");
  if (!form) {
    return;
  }

  const soundEnabled = new Set(cachedSoundEnabledStatuses);
  const selects = form.querySelectorAll(
    'select[name="notification-sound-selection"]',
  );

  for (const select of selects) {
    const status = select.dataset?.status;
    if (!status) {
      continue;
    }
    // Only disable the select if the sound is not enabled for this status.
    const enabled = soundEnabled.has(status);
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

  // Auto-click status toggles. These checkboxes control whether the
  // extension automatically performs actions (like opening tasks or
  // creating pull requests) when a task enters a given status. When
  // changed, update the stored preferences and reflect the selection in
  // the UI. Provide feedback to the user via the status message.
  if (target instanceof HTMLInputElement && target.name === "autoclick-status") {
    const selected = readAutoClickStatuses();
    const sanitized = sanitizeAutoClickStatuses(selected);
    const statusesToStore = sanitized !== null ? sanitized : [];
    try {
      await storageSet(AUTO_CLICK_STATUS_STORAGE_KEY, statusesToStore);
      applyAutoClickStatuses(statusesToStore);
      const statusKey = target.value;
      const label = statusKey ? STATUS_LABELS[statusKey] ?? statusKey : null;
      if (label) {
        showNotificationStatusMessage(
          target.checked
            ? `${label} auto‑click enabled.`
            : `${label} auto‑click disabled.`,
        );
      } else {
        showNotificationStatusMessage("Auto‑click preferences updated.");
      }
    } catch (error) {
      console.error("Unable to save auto-click preferences", error);
      showNotificationStatusMessage(
        `Unable to save auto‑click preferences: ${error.message}`,
        true,
      );
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.name === "notification-status") {
    const selected = readNotificationStatuses();
    const sanitized = sanitizeNotificationStatuses(selected);
    const statusesToStore = sanitized !== null ? sanitized : [];

    try {
      await storageSet(NOTIFICATION_STATUS_STORAGE_KEY, statusesToStore);
      applyNotificationStatuses(statusesToStore);
      if (statusesToStore.length) {
        showNotificationStatusMessage("Preferences updated.");
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
        showNotificationStatusMessage("Sound preference updated.");
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
      showNotificationStatusMessage("Sound choice updated.");
    } catch (error) {
      console.error("Unable to save notification sound selection", error);
      showNotificationStatusMessage(`Unable to save preferences: ${error.message}`, true);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadNotificationPreferences();
  // Load auto-click preferences so that the state of each auto-click toggle
  // reflects the user’s saved settings. If preferences are missing the
  // defaults defined in DEFAULT_AUTO_CLICK_STATUSES are applied.
  loadAutoClickPreferences();

  // Load the PR ready auto-click delay and apply it to the input. This
  // ensures that the delay input reflects the stored value (in
  // seconds) when the settings page is opened.
  loadPrReadyAutoClickDelay();

  // Load the close-tab preference for PR ready and apply it to the
  // checkbox. This keeps the checkbox in sync with stored settings.
  loadPrReadyCloseTabPreference();
  const notificationForm = document.getElementById("notification-preferences");
  notificationForm?.addEventListener("change", handleNotificationPreferencesChange);

  // Listen for changes to the PR ready auto-click delay input. When the
  // user changes the value the delay is sanitised, persisted and
  // reflected immediately in the UI. Use the input's change event to
  // avoid saving on every keystroke (only on commit).
  const prReadyDelayInput = document.getElementById("pr-ready-delay");
  if (prReadyDelayInput) {
    prReadyDelayInput.addEventListener("change", handlePrReadyDelayChange);
  }

  // Listen for changes to the close-task-tab checkbox for pr-ready.
  const closeTabInput = document.querySelector(
    'input[name="close-task-tab"][data-status="pr-ready"]',
  );
  if (closeTabInput) {
    closeTabInput.addEventListener("change", handlePrReadyCloseTabChange);
  }

  // Load GitHub merge automation preferences and wire up handlers. These
  // preferences control whether the extension automatically clicks the
  // "Merge pull request" and "Confirm merge" buttons on GitHub, and
  // whether the GitHub tab should close after the merge is confirmed.
  loadMergePrAutoClickPreference();
  loadConfirmMergeAutoClickPreference();
  loadCloseGithubAfterMergePreference();

  const mergePrInput = document.getElementById("auto-merge-pr");
  if (mergePrInput) {
    mergePrInput.addEventListener("change", handleMergePrAutoClickChange);
  }
  const confirmMergeInput = document.getElementById("auto-confirm-merge");
  if (confirmMergeInput) {
    confirmMergeInput.addEventListener("change", handleConfirmMergeAutoClickChange);
  }
  const closeGithubInput = document.getElementById("close-github-after-merge");
  if (closeGithubInput) {
    closeGithubInput.addEventListener("change", handleCloseGithubAfterMergeChange);
  }

  // Hook up the test notification button if it exists. This allows
  // users to trigger a sample notification based on their current
  // preferences. We defer adding the listener until DOMContentLoaded to
  // ensure the element is present.
  const testButton = document.getElementById("test-notification-btn");
  if (testButton) {
    testButton.addEventListener("click", handleTestNotificationClick);
  }

  // Load popup appearance settings and wire up controls. This ensures the
  // colour inputs reflect stored values and that updates are persisted as
  // soon as the user selects new colours.
  loadPopupAppearancePreferences();
  const editPopupBtn = document.getElementById("edit-popup-position-btn");
  if (editPopupBtn) {
    editPopupBtn.addEventListener("click", handleEditPopupPositionClick);
  }
  const bgColorInput = document.getElementById("popup-bg-color");
  if (bgColorInput) {
    bgColorInput.addEventListener("change", handlePopupColorChange);
  }
  const textColorInput = document.getElementById("popup-text-color");
  if (textColorInput) {
    textColorInput.addEventListener("change", handlePopupColorChange);
  }
});
