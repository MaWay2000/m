const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome.runtime;
const storage =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : chrome.storage;
const tabs =
  typeof browser !== "undefined" && browser?.tabs
    ? browser.tabs
    : chrome?.tabs;
const notifications =
  typeof browser !== "undefined" && browser?.notifications
    ? browser.notifications
    : typeof chrome !== "undefined" && chrome?.notifications
      ? chrome.notifications
      : null;

const autoProcessingTasks = new Set();

const HISTORY_KEY = "codexTaskHistory";
const CLOSED_TASKS_KEY = "codexClosedTaskIds";
const NOTIFICATION_STATUS_STORAGE_KEY = "codexNotificationStatuses";
const NOTIFICATION_SOUND_SELECTION_STORAGE_KEY =
  "codexNotificationSoundSelections";
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY =
  "codexNotificationSoundEnabledStatuses";
const NOTIFICATION_DEFAULT_SOUND_MUTED_STORAGE_KEY =
  "codexNotificationDefaultSoundMuted";
const DEFAULT_NOTIFICATION_STATUSES = ["ready", "merged"];
const DEFAULT_NOTIFICATION_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  merged: "1.mp3",
};
const DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES = [
  "ready",
  "pr-created",
  "merged",
];
const DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED = false;

// Keys and defaults for popup positioning and appearance. These values
// control where the custom popup window appears on screen, its size,
// and its colours. When undefined, the browser will choose sensible
// defaults (usually centering the window). Colours default to the
// built‑in notification styling.
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
let notificationPopupPosition = { ...DEFAULT_NOTIFICATION_POPUP_POSITION };
let notificationPopupSize = { ...DEFAULT_NOTIFICATION_POPUP_SIZE };
let notificationPopupColors = { ...DEFAULT_NOTIFICATION_POPUP_COLORS };
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
const SOUND_FILE_SET = new Set(SOUND_FILE_OPTIONS);
const STATUS_VALUE_SET = new Set(["ready", "pr-created", "merged"]);
let notificationEnabledStatuses = new Set(DEFAULT_NOTIFICATION_STATUSES);
let notificationSoundSelectionOverrides = {};
let notificationSoundSelections = { ...DEFAULT_NOTIFICATION_SOUND_SELECTIONS };
let notificationSoundEnabledStatuses = new Set(
  DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
);
let notificationDefaultSoundMuted = DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED;
const notificationTaskUrls = new Map();
const IGNORED_NAME_PATTERNS = [
  /working on your task/gi,
  /just now/gi,
  /committing changes?/gi,
];
const STATUS_LABELS = {
  ready: "Task ready to view",
  "pr-created": "PR created",
  merged: "Merged",
};

function sanitizeStatusList(value) {
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
    if (!normalized || seen.has(normalized) || !STATUS_VALUE_SET.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    sanitized.push(normalized);
  }

  return sanitized;
}

function sanitizeSoundSelectionMap(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const sanitized = {};

  for (const status of STATUS_VALUE_SET) {
    const rawValue = value?.[status];
    if (typeof rawValue !== "string") {
      continue;
    }

    const normalized = rawValue.trim();
    if (!normalized || !SOUND_FILE_SET.has(normalized)) {
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

/**
 * Sanitize a stored popup position. Accepts objects with numeric
 * `left` and `top` properties. Returns an object with left and top
 * coordinates if valid or null if invalid. Null coordinates are
 * interpreted as undefined positions (let the browser decide).
 *
 * @param {any} value
 */
function sanitizePopupPosition(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result = {};
  if ("left" in value) {
    const left = Number(value.left);
    if (!Number.isNaN(left) && Number.isFinite(left)) {
      result.left = left;
    } else {
      result.left = null;
    }
  }
  if ("top" in value) {
    const top = Number(value.top);
    if (!Number.isNaN(top) && Number.isFinite(top)) {
      result.top = top;
    } else {
      result.top = null;
    }
  }
  if (Object.keys(result).length === 0) {
    return null;
  }
  return result;
}

/**
 * Sanitize a stored popup size. Accepts objects with numeric
 * `width` and `height` properties. Enforces minimum reasonable sizes
 * (200x80). Returns null for invalid input.
 *
 * @param {any} value
 */
function sanitizePopupSize(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result = {};
  if ("width" in value) {
    let width = Number(value.width);
    if (!Number.isNaN(width) && Number.isFinite(width)) {
      width = Math.max(200, Math.min(width, 800));
      result.width = width;
    }
  }
  if ("height" in value) {
    let height = Number(value.height);
    if (!Number.isNaN(height) && Number.isFinite(height)) {
      height = Math.max(80, Math.min(height, 600));
      result.height = height;
    }
  }
  if (Object.keys(result).length === 0) {
    return null;
  }
  return result;
}

/**
 * Sanitize a stored popup colour configuration. Accepts objects with
 * `background` and `text` properties. Each value must be a valid CSS
 * colour string (we only accept hex colours like #rrggbb). Returns null
 * if the input is invalid.
 *
 * @param {any} value
 */
function sanitizePopupColors(value) {
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
  if (Object.keys(result).length === 0) {
    return null;
  }
  return result;
}

function updateNotificationEnabledStatuses(statuses) {
  notificationEnabledStatuses = new Set(statuses);
}

function updateNotificationSoundSelections(selections) {
  const overrides = {};
  if (selections && typeof selections === "object") {
    for (const status of STATUS_VALUE_SET) {
      const value = selections?.[status];
      if (typeof value !== "string") {
        continue;
      }
      if (value === DEFAULT_NOTIFICATION_SOUND_SELECTIONS[status]) {
        continue;
      }
      overrides[status] = value;
    }
  }

  notificationSoundSelectionOverrides = overrides;
  notificationSoundSelections = {
    ...DEFAULT_NOTIFICATION_SOUND_SELECTIONS,
    ...(selections ?? {}),
  };
}

function updateNotificationSoundEnabledStatuses(statuses) {
  const nextStatuses = Array.isArray(statuses)
    ? statuses
    : DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES;
  notificationSoundEnabledStatuses = new Set(nextStatuses);
}

function updateNotificationDefaultSoundMuted(isMuted) {
  notificationDefaultSoundMuted = Boolean(isMuted);
}

function updateNotificationPopupPosition(position) {
  notificationPopupPosition = {
    ...DEFAULT_NOTIFICATION_POPUP_POSITION,
    ...(position || {}),
  };
}

function updateNotificationPopupSize(size) {
  notificationPopupSize = {
    ...DEFAULT_NOTIFICATION_POPUP_SIZE,
    ...(size || {}),
  };
}

function updateNotificationPopupColors(colors) {
  notificationPopupColors = {
    ...DEFAULT_NOTIFICATION_POPUP_COLORS,
    ...(colors || {}),
  };
}

async function loadNotificationPreferences() {
  try {
    const [
      storedStatuses,
      storedSelections,
      storedSoundEnabled,
      storedDefaultSoundMuted,
    ] = await Promise.all([
      storageGet(NOTIFICATION_STATUS_STORAGE_KEY),
      storageGet(NOTIFICATION_SOUND_SELECTION_STORAGE_KEY),
      storageGet(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY),
      storageGet(NOTIFICATION_DEFAULT_SOUND_MUTED_STORAGE_KEY),
    ]);
    const sanitizedStatuses = sanitizeStatusList(storedStatuses);
    const statuses =
      sanitizedStatuses !== null ? sanitizedStatuses : DEFAULT_NOTIFICATION_STATUSES;
    updateNotificationEnabledStatuses(statuses);

    const sanitizedSelections = sanitizeSoundSelectionMap(storedSelections);
    updateNotificationSoundSelections(sanitizedSelections);

    const sanitizedSoundEnabled = sanitizeStatusList(storedSoundEnabled);
    const soundEnabledStatuses =
      sanitizedSoundEnabled !== null
        ? sanitizedSoundEnabled
        : DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES;
    updateNotificationSoundEnabledStatuses(soundEnabledStatuses);

    const sanitizedDefaultMuted = sanitizeBoolean(storedDefaultSoundMuted);
    const defaultSoundMuted =
      sanitizedDefaultMuted !== null
        ? sanitizedDefaultMuted
        : DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED;
    updateNotificationDefaultSoundMuted(defaultSoundMuted);
  } catch (error) {
    console.error("Failed to load notification preferences", error);
    updateNotificationEnabledStatuses(DEFAULT_NOTIFICATION_STATUSES);
    updateNotificationSoundSelections(null);
    updateNotificationSoundEnabledStatuses(
      DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
    );
    updateNotificationDefaultSoundMuted(DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED);
  }
}

function formatStatusLabel(status) {
  if (!status) {
    return "";
  }

  const normalized = String(status).trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return STATUS_LABELS[normalized] ?? normalized;
}

function createNotification(options) {
  if (!notifications?.create) {
    return Promise.resolve(null);
  }

  try {
    const result = notifications.create("", options);
    if (result && typeof result.then === "function") {
      return result;
    }
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    try {
      notifications.create("", options, (notificationId) => {
        if (runtime?.lastError) {
          reject(new Error(runtime.lastError.message));
          return;
        }
        resolve(notificationId ?? null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function clearNotification(notificationId) {
  if (!notificationId || !notifications?.clear) {
    return;
  }

  try {
    const result = notifications.clear(notificationId);
    if (result && typeof result.then === "function") {
      result.catch((error) => {
        console.error("Failed to clear notification", error);
      });
    }
  } catch (error) {
    console.error("Failed to clear notification", error);
  }
}

function getSoundFileUrl(fileName) {
  if (!fileName) {
    return null;
  }

  try {
    if (typeof runtime?.getURL === "function") {
      return runtime.getURL(`src/sounds/${fileName}`);
    }
  } catch (error) {
    console.error("Failed to resolve sound file URL", error);
  }

  if (typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function") {
    return chrome.runtime.getURL(`src/sounds/${fileName}`);
  }

  return `src/sounds/${fileName}`;
}

function playBrowserNotificationSound(statusKey) {
  if (typeof Audio !== "function") {
    return;
  }

  if (!notificationSoundEnabledStatuses.has(statusKey)) {
    return;
  }

  if (
    notificationDefaultSoundMuted &&
    !Object.prototype.hasOwnProperty.call(
      notificationSoundSelectionOverrides,
      statusKey,
    )
  ) {
    return;
  }

  const rawSelection = notificationSoundSelections?.[statusKey];
  const trimmed = typeof rawSelection === "string" ? rawSelection.trim() : "";
  const normalized =
    trimmed && SOUND_FILE_SET.has(trimmed)
      ? trimmed
      : DEFAULT_NOTIFICATION_SOUND_SELECTIONS[statusKey];

  if (!normalized || !SOUND_FILE_SET.has(normalized)) {
    return;
  }

  const url = getSoundFileUrl(normalized);
  if (!url) {
    return;
  }

  try {
    const audio = new Audio(url);
    audio.preload = "auto";
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch((error) => {
        console.error("Failed to play browser notification sound", error);
      });
    }
  } catch (error) {
    console.error("Failed to play browser notification sound", error);
  }
}

/**
 * Display a task status notification by opening a small popup window instead
 * of using the system notification API. This custom implementation avoids
 * playing the host operating system's default sound and gives the
 * extension complete control over the audio and dismissal logic. When a
 * `clickUrl` is provided the popup becomes clickable and opens the URL in a
 * new tab.
 *
 * @param {Object} task A task object containing at least an id, name and URL.
 * @param {string} statusKey One of the status values ("ready", "pr-created",
 *   or "merged").
 */
async function showStatusNotification(task, statusKey) {
  // Compose the primary and contextual text for the popup.
  const statusLabel = formatStatusLabel(statusKey);
  const taskId = normalizeTaskId(task?.id);
  const taskName = resolveTaskName(task?.name, taskId);
  const message = taskName || (taskId ? `Task ${taskId}` : "Tracked task");
  const contextMessage = taskId
    ? `Task ${taskId} is now ${statusLabel}.`
    : `Status changed to ${statusLabel}.`;

  // Determine if a custom sound should be played for this status. If the user
  // has disabled sounds for this status, omit the audio file entirely. When
  // provided, the audio file path must be resolved to a fully qualified URL
  // using runtime.getURL().
  let audioParam = "";
  try {
    if (
      notificationSoundEnabledStatuses.has(statusKey) &&
      typeof notificationSoundSelections?.[statusKey] === "string"
    ) {
      const fileName = notificationSoundSelections[statusKey];
      if (SOUND_FILE_SET.has(fileName) && runtime?.getURL) {
        audioParam = runtime.getURL(`src/sounds/${fileName}`);
      }
    }
  } catch (err) {
    console.error("Failed to resolve custom sound", err);
  }

  // Build the URL for the custom notification page. Encode each parameter to
  // ensure special characters do not break the query string. The clickUrl is
  // optional and only included when the task has a destination link.
  const params = new URLSearchParams();
  params.set("title", `${statusLabel} task`);
  params.set("message", message);
  if (audioParam) {
    params.set("audio", audioParam);
  }
  if (task?.url) {
    params.set("clickUrl", task.url);
  }

  // After populating the search params with any colour overrides, compose the
  // final URL. Defer this until all parameters have been added.
  // Compose colour parameters for the popup. These override the default
  // notification styling when provided. Only set after other parameters
  // have been added so they are included in the final URL.
  if (notificationPopupColors?.background) {
    params.set("bg", notificationPopupColors.background);
  }
  if (notificationPopupColors?.text) {
    params.set("text", notificationPopupColors.text);
  }

  // Build the final URL for the popup now that all parameters have been
  // appended. Deferring this until the end ensures the query string
  // includes colour overrides.
  const popupUrl = runtime?.getURL
    ? runtime.getURL(`src/custom-notification.html?${params.toString()}`)
    : undefined;
  if (!popupUrl) {
    return;
  }

  // Determine width and height based on saved preferences. If no custom size
  // has been provided, fall back to defaults. Height is not adjusted based
  // on the presence of audio to respect the user's chosen dimensions.
  const width =
    typeof notificationPopupSize?.width === "number"
      ? notificationPopupSize.width
      : 360;
  const height =
    typeof notificationPopupSize?.height === "number"
      ? notificationPopupSize.height
      : 120;


  // Choose the appropriate window API depending on the platform. Use
  // browser.windows.create where available, falling back to chrome.windows.create.
  const windowsApi =
    (typeof browser !== "undefined" && browser?.windows) ||
    (typeof chrome !== "undefined" && chrome?.windows);
  if (!windowsApi?.create) {
    return;
  }
  // Build the options for creating the popup window. Include left and
  // top coordinates only when they have been explicitly set by the user;
  // otherwise omit them so the browser chooses a sensible default.
  const createOptions = {
    url: popupUrl,
    type: "popup",
    width,
    height,
    allowScriptsToClose: true,
  };
  if (
    notificationPopupPosition &&
    typeof notificationPopupPosition.left === "number"
  ) {
    createOptions.left = notificationPopupPosition.left;
  }
  if (
    notificationPopupPosition &&
    typeof notificationPopupPosition.top === "number"
  ) {
    createOptions.top = notificationPopupPosition.top;
  }
  try {
    await windowsApi.create(createOptions);
  } catch (err) {
    console.error("Failed to open custom notification window", err);
  }
}

loadNotificationPreferences();
loadPopupPreferences();

const storageChangeEmitter =
  typeof browser !== "undefined" && browser?.storage?.onChanged
    ? browser.storage.onChanged
    : typeof chrome !== "undefined" && chrome?.storage?.onChanged
      ? chrome.storage.onChanged
      : null;

if (storageChangeEmitter) {
  storageChangeEmitter.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes) {
      return;
    }

    const notificationChange = changes[NOTIFICATION_STATUS_STORAGE_KEY];
    if (notificationChange) {
      const sanitized = sanitizeStatusList(notificationChange.newValue);
      if (sanitized !== null) {
        updateNotificationEnabledStatuses(sanitized);
      } else {
        updateNotificationEnabledStatuses(DEFAULT_NOTIFICATION_STATUSES);
      }
    }

    const notificationSoundChange =
      changes[NOTIFICATION_SOUND_SELECTION_STORAGE_KEY];
    if (notificationSoundChange) {
      const sanitized = sanitizeSoundSelectionMap(notificationSoundChange.newValue);
      updateNotificationSoundSelections(sanitized);
    }

    const notificationSoundEnabledChange =
      changes[NOTIFICATION_SOUND_ENABLED_STORAGE_KEY];
    if (notificationSoundEnabledChange) {
      const sanitized = sanitizeStatusList(
        notificationSoundEnabledChange.newValue,
      );
      if (sanitized !== null) {
        updateNotificationSoundEnabledStatuses(sanitized);
      } else {
        updateNotificationSoundEnabledStatuses(
          DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
        );
      }
    }

    const defaultSoundMutedChange =
      changes[NOTIFICATION_DEFAULT_SOUND_MUTED_STORAGE_KEY];
    if (defaultSoundMutedChange) {
      const sanitized = sanitizeBoolean(defaultSoundMutedChange.newValue);
      if (sanitized !== null) {
        updateNotificationDefaultSoundMuted(sanitized);
      } else {
        updateNotificationDefaultSoundMuted(
          DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED,
        );
      }
    }

    const popupPositionChange = changes[NOTIFICATION_POPUP_POSITION_STORAGE_KEY];
    if (popupPositionChange) {
      const sanitized = sanitizePopupPosition(popupPositionChange.newValue);
      if (sanitized) {
        updateNotificationPopupPosition(sanitized);
      } else {
        updateNotificationPopupPosition(DEFAULT_NOTIFICATION_POPUP_POSITION);
      }
    }

    const popupSizeChange = changes[NOTIFICATION_POPUP_SIZE_STORAGE_KEY];
    if (popupSizeChange) {
      const sanitized = sanitizePopupSize(popupSizeChange.newValue);
      if (sanitized) {
        updateNotificationPopupSize(sanitized);
      } else {
        updateNotificationPopupSize(DEFAULT_NOTIFICATION_POPUP_SIZE);
      }
    }

    const popupColorsChange = changes[NOTIFICATION_POPUP_COLORS_STORAGE_KEY];
    if (popupColorsChange) {
      const sanitized = sanitizePopupColors(popupColorsChange.newValue);
      if (sanitized) {
        updateNotificationPopupColors(sanitized);
      } else {
        updateNotificationPopupColors(DEFAULT_NOTIFICATION_POPUP_COLORS);
      }
    }
  });
}

/**
 * Load popup position, size and colour preferences from storage. Any
 * missing or invalid values fall back to defaults.
 */
async function loadPopupPreferences() {
  try {
    const [storedPosition, storedSize, storedColors] = await Promise.all([
      storageGet(NOTIFICATION_POPUP_POSITION_STORAGE_KEY),
      storageGet(NOTIFICATION_POPUP_SIZE_STORAGE_KEY),
      storageGet(NOTIFICATION_POPUP_COLORS_STORAGE_KEY),
    ]);
    const pos = sanitizePopupPosition(storedPosition);
    if (pos) {
      updateNotificationPopupPosition(pos);
    } else {
      updateNotificationPopupPosition(DEFAULT_NOTIFICATION_POPUP_POSITION);
    }
    const size = sanitizePopupSize(storedSize);
    if (size) {
      updateNotificationPopupSize(size);
    } else {
      updateNotificationPopupSize(DEFAULT_NOTIFICATION_POPUP_SIZE);
    }
    const colors = sanitizePopupColors(storedColors);
    if (colors) {
      updateNotificationPopupColors(colors);
    } else {
      updateNotificationPopupColors(DEFAULT_NOTIFICATION_POPUP_COLORS);
    }
  } catch (err) {
    console.error("Failed to load popup preferences", err);
    updateNotificationPopupPosition(DEFAULT_NOTIFICATION_POPUP_POSITION);
    updateNotificationPopupSize(DEFAULT_NOTIFICATION_POPUP_SIZE);
    updateNotificationPopupColors(DEFAULT_NOTIFICATION_POPUP_COLORS);
  }
}

if (notifications?.onClicked) {
  notifications.onClicked.addListener((notificationId) => {
    const url = notificationTaskUrls.get(notificationId);
    if (url) {
      openTaskInNewTab(url).catch((error) => {
        console.error("Failed to open task from notification", error);
      });
    }

    notificationTaskUrls.delete(notificationId);
    clearNotification(notificationId);
  });
}

if (notifications?.onClosed) {
  notifications.onClosed.addListener((notificationId) => {
    notificationTaskUrls.delete(notificationId);
  });
}

function sanitizeTaskName(value) {
  if (value === null || value === undefined) {
    return "";
  }

  let result = String(value).replace(/\s+/g, " ").trim();
  if (!result) {
    return "";
  }

  for (const pattern of IGNORED_NAME_PATTERNS) {
    result = result.replace(pattern, " ");
  }

  result = result.replace(/[·•|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!result) {
    return "";
  }

  if (/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(result)) {
    const [, secondSegment = ""] = result.split("/");
    const looksLikeFilePath = /\./.test(secondSegment);
    if (!looksLikeFilePath) {
      return "";
    }
  }

  return result;
}

function resolveTaskName(candidateName, taskId) {
  const sanitized = sanitizeTaskName(candidateName);
  if (sanitized) {
    return sanitized;
  }
  return taskId ? `Task ${taskId}` : "Unknown task";
}

function normalizeTaskId(taskId) {
  if (taskId === null || taskId === undefined) {
    return "";
  }
  const normalized = String(taskId).trim();
  return normalized;
}

async function readClosedTasks() {
  const raw = (await storageGet(CLOSED_TASKS_KEY)) ?? [];
  const set = new Set();
  const list = [];

  if (Array.isArray(raw)) {
    for (const value of raw) {
      const id = normalizeTaskId(value);
      if (id && !set.has(id)) {
        set.add(id);
        list.push(id);
      }
    }
  }

  return { set, list };
}

async function markTaskClosed(taskId) {
  const id = normalizeTaskId(taskId);
  if (!id) {
    return;
  }

  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const { set: closedSet, list } = await readClosedTasks();

  const nextHistory = Array.isArray(history)
    ? history.filter((entry) => normalizeTaskId(entry?.id) !== id)
    : [];

  const updates = [];
  if (Array.isArray(history) && nextHistory.length !== history.length) {
    updates.push(storageSet(HISTORY_KEY, nextHistory));
  }

  if (!closedSet.has(id)) {
    closedSet.add(id);
    updates.push(storageSet(CLOSED_TASKS_KEY, [...closedSet]));
  } else if (list.length !== closedSet.size) {
    updates.push(storageSet(CLOSED_TASKS_KEY, [...closedSet]));
  }

  if (updates.length) {
    await Promise.all(updates);
  }
}

console.log("codex-autorun background service worker loaded.");
runtime.onInstalled.addListener(() => {
  console.log("codex-autorun installed and ready.");
});

// Listen for messages from other extension contexts (options page, popup, etc.).
// We add support for a "test-notification" message which triggers a sample
// notification using the current preferences. The options page sends a
// list of statuses that should be tested; if none are provided we use
// whatever notifications are currently enabled in memory.
if (runtime?.onMessage) {
  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "test-notification") {
      return; // Not our message; ignore.
    }
    const statusesFromMsg = Array.isArray(message.statuses)
      ? message.statuses.filter((s) => typeof s === "string" && STATUS_VALUE_SET.has(s))
      : [];
    const statusesToTest = statusesFromMsg.length
      ? statusesFromMsg
      : Array.from(notificationEnabledStatuses);
    const testTask = { name: "Test notification" };
    Promise.all(
      statusesToTest.map((statusKey) => {
        return showStatusNotification(testTask, statusKey);
      }),
    )
      .then(() => {
        if (typeof sendResponse === "function") {
          sendResponse({ success: true });
        }
      })
      .catch((error) => {
        console.error("Failed to dispatch test notification", error);
        if (typeof sendResponse === "function") {
          sendResponse({ success: false, error: String(error?.message ?? error) });
        }
      });
    // Return true to keep the response channel open for asynchronous reply.
    return true;
  });
}

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
    console.error("Failed to get storage value", error);
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
    console.error("Failed to set storage value", error);
  }
  return new Promise((resolve) => {
    storage.local.set(payload, () => {
      if (runtime?.lastError) {
        console.error("Storage set error", runtime.lastError);
      }
      resolve();
    });
  });
}

async function appendHistory(task) {
  const id = normalizeTaskId(task?.id);
  if (!id) {
    return;
  }
  const { set: closedSet } = await readClosedTasks();
  if (closedSet.has(id)) {
    return;
  }
  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const exists = history.some((entry) => normalizeTaskId(entry?.id) === id);
  if (exists) {
    return;
  }
  const entry = {
    id,
    name: resolveTaskName(task.name, id),
    url: task.url ?? null,
    startedAt: task.startedAt ?? new Date().toISOString(),
    status: task.status ?? "working",
  };
  const nextHistory = [entry, ...history].slice(0, 200);
  await storageSet(HISTORY_KEY, nextHistory);
  console.log("Tracked codex task", entry);
}

const COMPLETED_STATUS_KEYS = new Set(["ready", "pr-created", "merged"]);

async function updateHistory(task) {
  const id = normalizeTaskId(task?.id);
  if (!id) {
    return;
  }
  const { set: closedSet } = await readClosedTasks();
  if (closedSet.has(id)) {
    return;
  }
  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const index = history.findIndex((entry) => normalizeTaskId(entry?.id) === id);

  if (index === -1) {
    const statusKey = String(task?.status ?? "")
      .trim()
      .toLowerCase();
    if (statusKey && COMPLETED_STATUS_KEYS.has(statusKey)) {
      return;
    }
    const sanitizedName = sanitizeTaskName(task?.name);
    const entry = {
      id,
      name: resolveTaskName(sanitizedName || task?.name, id),
      url: task?.url ?? null,
      startedAt: task?.startedAt ?? new Date().toISOString(),
      status: task?.status ?? "working",
      completedAt: task?.completedAt ?? null,
    };
    const nextHistory = [entry, ...history].slice(0, 200);
    await storageSet(HISTORY_KEY, nextHistory);
    console.log("Appended missing codex task entry", entry);
    return;
  }

  const existing = history[index];
  const updates = { ...task };
  for (const key of Object.keys(updates)) {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    const sanitizedUpdateName = sanitizeTaskName(updates.name);
    if (sanitizedUpdateName) {
      updates.name = sanitizedUpdateName;
    } else {
      delete updates.name;
    }
  }
  const updated = {
    ...existing,
    ...updates,
    id,
    status: updates.status ?? existing.status,
    completedAt: updates.completedAt ?? existing.completedAt ?? null,
  };
  updated.name = resolveTaskName(updated.name ?? existing.name, id);
  const nextHistory = [...history];
  nextHistory[index] = updated;
  await storageSet(HISTORY_KEY, nextHistory);
  console.log("Updated codex task", updated);

  const nextStatus = String(updated.status ?? "").toLowerCase();
  const previousStatus = String(existing.status ?? "").toLowerCase();
  const becameReady =
    nextStatus === "ready" &&
    previousStatus !== "ready" &&
    previousStatus !== "pr-created";

  const shouldNotify =
    nextStatus &&
    nextStatus !== previousStatus &&
    notificationEnabledStatuses.has(nextStatus);

  if (shouldNotify) {
    showStatusNotification(updated, nextStatus).catch((error) => {
      console.error("Failed to show status notification", error);
    });
  }

  if (becameReady) {
    autoHandleReadyTask(updated).catch((error) => {
      console.error("Failed to auto-handle ready Codex task", error);
    });
  }
}

async function getHistory() {
  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const { set: closedSet } = await readClosedTasks();

  if (!Array.isArray(history)) {
    return [];
  }

  let requiresUpdate = false;
  const normalizedHistory = [];

  for (const entry of history) {
    if (!entry || typeof entry !== "object") {
      requiresUpdate = true;
      continue;
    }

    let nextEntry = entry;
    const normalizedId = normalizeTaskId(entry.id);

    if (!normalizedId) {
      requiresUpdate = true;
      continue;
    }

    if (closedSet.has(normalizedId)) {
      requiresUpdate = true;
      continue;
    }

    if (normalizedId !== entry.id) {
      nextEntry = { ...nextEntry, id: normalizedId };
      requiresUpdate = true;
    }

    const resolvedName = resolveTaskName(nextEntry.name, normalizedId);
    if (resolvedName !== nextEntry.name) {
      nextEntry = { ...nextEntry, name: resolvedName };
      requiresUpdate = true;
    }

    normalizedHistory.push(nextEntry);
  }

  if (requiresUpdate || normalizedHistory.length !== history.length) {
    await storageSet(HISTORY_KEY, normalizedHistory);
  }

  return normalizedHistory;
}

function openTaskInNewTab(url) {
  if (!url) {
    return Promise.resolve();
  }
  if (!tabs?.create) {
    return Promise.reject(new Error("Tabs API is unavailable."));
  }

  try {
    const result = tabs.create({ url });
    if (result && typeof result.then === "function") {
      return result.then(() => {});
    }
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    try {
      tabs.create({ url }, () => {
        const error = runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function markTaskAsPrCreated(task) {
  const id = normalizeTaskId(task?.id);
  if (!id) {
    return;
  }

  const { set: closedSet } = await readClosedTasks();
  if (closedSet.has(id)) {
    return;
  }

  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const index = history.findIndex((entry) => normalizeTaskId(entry?.id) === id);
  if (index === -1) {
    return;
  }

  const existing = history[index];
  if (String(existing?.status ?? "").toLowerCase() === "pr-created") {
    return;
  }

  const completedAt =
    existing?.completedAt ?? task?.completedAt ?? new Date().toISOString();
  const updated = {
    ...existing,
    id,
    status: "pr-created",
    completedAt,
  };

  const nextHistory = [...history];
  nextHistory[index] = updated;
  await storageSet(HISTORY_KEY, nextHistory);
  console.log("Marked Codex task as PR created", updated);
}

async function autoHandleReadyTask(task) {
  if (!task?.id || !task?.url) {
    return;
  }

  if (autoProcessingTasks.has(task.id)) {
    return;
  }

  autoProcessingTasks.add(task.id);

  try {
    await openTaskInNewTab(task.url);
    await markTaskAsPrCreated({
      id: task.id,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to auto-open Codex task", error);
  } finally {
    autoProcessingTasks.delete(task.id);
  }
}

runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "ping") {
    console.log("Received ping from popup.");
    sendResponse?.({ type: "pong", timestamp: Date.now() });
    return false;
  }

  if (message.type === "square-detected") {
    appendHistory(message.task).then(
      () => sendResponse?.({ type: "ack" }),
      (error) => {
        console.error("Failed to append task history", error);
        sendResponse?.({ type: "error", message: String(error) });
      },
    );
    return true;
  }

  if (message.type === "square-status-updated") {
    updateHistory(message.task).then(
      () => sendResponse?.({ type: "ack" }),
      (error) => {
        console.error("Failed to update task history", error);
        sendResponse?.({ type: "error", message: String(error) });
      },
    );
    return true;
  }

  if (message.type === "get-history") {
    getHistory().then(
      (history) => sendResponse?.({ type: "history", history }),
      (error) => {
        console.error("Failed to load task history", error);
        sendResponse?.({ type: "error", message: String(error) });
      },
    );
    return true;
  }

  if (message.type === "close-history-task") {
    markTaskClosed(message.taskId).then(
      () => sendResponse?.({ type: "ack" }),
      (error) => {
        console.error("Failed to close task history entry", error);
        sendResponse?.({ type: "error", message: String(error) });
      },
    );
    return true;
  }

  if (message.type === "update-task-status") {
    updateHistory(message.task).then(
      () => sendResponse?.({ type: "ack" }),
      (error) => {
        console.error("Failed to update task status", error);
        sendResponse?.({ type: "error", message: String(error) });
      },
    );
    return true;
  }

  return false;
});

if (typeof module !== "undefined" && module?.exports) {
  module.exports = {
    appendHistory,
    updateHistory,
    getHistory,
    markTaskClosed,
    normalizeTaskId,
    sanitizeTaskName,
    resolveTaskName,
    storageGet,
    storageSet,
    HISTORY_KEY,
    CLOSED_TASKS_KEY,
    COMPLETED_STATUS_KEYS,
  };
}
