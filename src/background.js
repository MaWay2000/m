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

// Storage key for the set of statuses on which automatic actions (such as
// opening a task or creating a pull request) should be performed. When a
// status is included in this list the extension will perform the
// associated auto-click behaviour. For example, enabling "ready" will
// cause the extension to automatically open the task and (if enabled) create
// a pull request when a task becomes ready. Enabling "pr-created" will
// perform any follow-up actions after a PR is created (such as scheduling
// the pr-ready notification). Enabling "pr-ready" will auto-click the
// "View PR" button when a pull request becomes ready to view. "merged" has
// no auto-click behaviour and is ignored.
const AUTO_CLICK_STATUS_STORAGE_KEY = "codexAutoClickStatuses";

// By default automatically handle tasks becoming ready, PRs being created and
// PRs becoming ready to view. Users can disable auto-click on a per-status
// basis in the settings.
const DEFAULT_AUTO_CLICK_STATUSES = ["ready", "pr-created", "pr-ready"];

// In-memory set of statuses for which auto-click behaviour is enabled.
let autoClickEnabledStatuses = new Set(DEFAULT_AUTO_CLICK_STATUSES);
// When no preference has been stored the extension will notify on these
// statuses by default. The options page exposes "Task ready to view",
// "PR created", "PR ready to view" and "Merged"; only ready,
// pr-created and pr-ready are enabled by default to match the UI. Users can
// disable any of these in the settings.
const DEFAULT_NOTIFICATION_STATUSES = ["ready", "pr-created", "pr-ready"];
const DEFAULT_NOTIFICATION_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  // Default sound for the PR ready status. Users can override this in
  // the settings page.
  "pr-ready": "1.mp3",
  merged: "1.mp3",
};
const DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES = [
  "ready",
  "pr-created",
  "pr-ready",
  "merged",
];
const DEFAULT_NOTIFICATION_DEFAULT_SOUND_MUTED = false;

// Storage key for whether the extension should close the Codex task tab
// after the pull request is ready to view. When true, the tab opened
// during auto-processing is closed automatically once the PR ready
// notification fires. When false, the task tab remains open.
const PR_READY_CLOSE_TAB_STORAGE_KEY = "codexPrReadyCloseTab";

// Whether closing the task tab on PR ready is enabled. Loaded from
// storage on startup and updated when the user changes the preference.
let prReadyCloseTabEnabled = false;

// Map from task ID to the tab ID of the tab opened when processing
// a ready task. Used to close the tab once the PR is ready to view.
const taskTabIds = new Map();

// Map of alarms scheduled for PR ready notifications. Keys are alarm names
// and values contain the task details required to update history and show
// notifications when the alarm fires. Using a map allows us to look up
// and clean up scheduled alarms efficiently when they trigger.
const prReadyAlarmTasks = new Map();

// Determine the alarms API. In Firefox and Chromium the API is exposed as
// browser.alarms or chrome.alarms respectively. If unavailable (e.g. in
// unsupported environments) the pr-ready fallback will continue to use
// setTimeout.
const alarmsApi =
  (typeof browser !== "undefined" && browser?.alarms) ||
  (typeof chrome !== "undefined" && chrome?.alarms);

// Listen for alarms signalling that a pull request is ready to view. When
// triggered, update the task’s history to 'pr-ready', persist the change
// and dispatch a notification. If the alarm name matches an entry in
// prReadyAlarmTasks the stored task details are used; otherwise the alarm
// is ignored. After handling the alarm the entry is removed to avoid
// memory leaks.
if (alarmsApi?.onAlarm && typeof alarmsApi.onAlarm.addListener === "function") {
  alarmsApi.onAlarm.addListener(async (alarm) => {
    if (!alarm || !alarm.name) {
      return;
    }
    const taskInfo = prReadyAlarmTasks.get(alarm.name);
    if (!taskInfo) {
      return;
    }
    prReadyAlarmTasks.delete(alarm.name);
    const { id, name, url } = taskInfo;
    try {
      const completedAt = new Date().toISOString();
      // Persist and notify about the PR ready status. Because the alarm
      // fires independently of the original event page, always call
      // updateHistory and markTaskAsPrReady here; updateHistory may
      // dispatch a notification if a status change is detected.
      await updateHistory({ id, status: "pr-ready", completedAt });
      await markTaskAsPrReady({ id, completedAt });
      // Explicitly notify if enabled to guarantee the user is alerted.
      if (notificationEnabledStatuses.has("pr-ready")) {
        const prReadyTask = { id, name, url, status: "pr-ready", completedAt };
        await showStatusNotification(prReadyTask, "pr-ready");
      }
      // Optionally close the Codex task tab associated with this task
      // when the pull request is ready to view. This depends on the
      // prReadyCloseTabEnabled preference being true. Closing the tab
      // helps keep the browser tidy once the PR has been opened.
      if (prReadyCloseTabEnabled) {
        closeTaskTab(id);
      }
    } catch (err) {
      console.error("Failed to handle PR ready alarm", err);
    }
  });
}

// Delay (in milliseconds) between automatically creating a PR and
// considering it "ready to view". Once this timeout expires the
// extension marks the task as pr-ready and triggers the associated
// notification (if enabled). This is a heuristic fallback; a future
// enhancement could monitor the created PR tab directly to detect
// readiness more precisely.
const PR_READY_DELAY_MS = 5000;

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
  page: "#ffffff",
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
const STATUS_VALUE_SET = new Set(["ready", "pr-created", "pr-ready", "merged"]);
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
  /completing the task/gi,
  /checking git status/gi,
  /maway2000\/m/gi,
];
const STATUS_LABELS = {
  ready: "Task ready to view",
  "pr-created": "PR ready to create",
  // Label for the new PR ready status. Displayed in notifications and
  // settings.
  "pr-ready": "PR ready to view (Open github)",
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
 * `background`, `page`, and `text` properties. Each value must be a valid CSS
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
  if (typeof value.page === "string" && hexRegex.test(value.page)) {
    result.page = value.page;
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

/**
 * Update the in-memory set of statuses that should trigger automatic
 * actions such as opening a task or creating a pull request. Called
 * whenever preferences are loaded from storage or when storage changes.
 *
 * @param {string[]} statuses
 */
function updateAutoClickEnabledStatuses(statuses) {
  const sanitized = Array.isArray(statuses)
    ? statuses.map((v) => String(v).trim().toLowerCase()).filter((v) => STATUS_VALUE_SET.has(v))
    : [];
  autoClickEnabledStatuses = new Set(sanitized);
}

/**
 * Load auto-click preferences from storage. If valid preferences exist the
 * in-memory set is updated; otherwise defaults are used. Should be called
 * during extension initialisation.
 */
async function loadAutoClickPreferences() {
  try {
    const stored = (await storageGet(AUTO_CLICK_STATUS_STORAGE_KEY)) ?? [];
    const sanitized = Array.isArray(stored)
      ? stored
          .map((v) => String(v).trim().toLowerCase())
          .filter((v) => STATUS_VALUE_SET.has(v))
      : [];
    if (sanitized.length) {
      updateAutoClickEnabledStatuses(sanitized);
    } else {
      updateAutoClickEnabledStatuses(DEFAULT_AUTO_CLICK_STATUSES);
    }
  } catch (err) {
    console.error("Failed to load auto-click preferences", err);
    updateAutoClickEnabledStatuses(DEFAULT_AUTO_CLICK_STATUSES);
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

  // Play the notification sound immediately. Playing the sound in the
  // background context avoids relying solely on the audio element in the
  // custom notification window, which can be subject to autoplay
  // restrictions or race conditions when multiple popups are opened in
  // quick succession. If the user has disabled sounds for this status or
  // selected an invalid file, playBrowserNotificationSound() will no‑op.
  try {
    playBrowserNotificationSound(statusKey);
  } catch (err) {
    // Ignore errors playing the sound; the popup will still open.
  }

  // Do not set an audio parameter on the notification URL. All sound
  // playback is now handled in the background script via
  // playBrowserNotificationSound(). Including an audio parameter would
  // result in duplicate sounds when the popup opens. Keep this empty to
  // suppress autoplay in the popup window.
  const audioParam = "";

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
  if (notificationPopupColors?.page) {
    params.set("page", notificationPopupColors.page);
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
loadAutoClickPreferences();
loadPopupPreferences();

// Load the preference that determines whether to close the task tab when a
// pull request becomes ready to view. This is invoked on startup to
// initialise prReadyCloseTabEnabled. Errors are logged but ignored.
async function loadPrReadyCloseTabPreference() {
  try {
    const data = await new Promise((resolve, reject) => {
      try {
        storage.local.get(PR_READY_CLOSE_TAB_STORAGE_KEY, (result) => {
          const runtimeError = runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
    const value = data?.[PR_READY_CLOSE_TAB_STORAGE_KEY];
    prReadyCloseTabEnabled = Boolean(value);
  } catch (err) {
    console.error("Failed to load PR ready close tab preference", err);
    prReadyCloseTabEnabled = false;
  }
}

// Invoke preference loader on startup.
loadPrReadyCloseTabPreference();

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

    const autoClickChange = changes[AUTO_CLICK_STATUS_STORAGE_KEY];
    if (autoClickChange) {
      const sanitized = sanitizeStatusList(autoClickChange.newValue);
      if (sanitized !== null) {
        updateAutoClickEnabledStatuses(sanitized);
      } else {
        updateAutoClickEnabledStatuses(DEFAULT_AUTO_CLICK_STATUSES);
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

    // Respond to changes in the preference controlling whether to close
    // the Codex task tab when a pull request becomes ready to view. This
    // ensures updates made in the options page take effect immediately.
    const closeTabChange = changes[PR_READY_CLOSE_TAB_STORAGE_KEY];
    if (closeTabChange) {
      prReadyCloseTabEnabled = Boolean(closeTabChange.newValue);
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

const COMPLETED_STATUS_KEYS = new Set(["ready", "pr-created", "pr-ready", "merged"]);

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

  // When a task transitions to pr-ready we no longer open the task page
  // automatically. The content script will detect the "View PR" link
  // within the existing page and click it after the configured delay.

  if (becameReady) {
    // Only auto-handle tasks that become ready when the user has
    // explicitly enabled auto-click for the "ready" status. When disabled
    // the task remains in the ready state and the user can open it
    // manually from the notification. See DEFAULT_AUTO_CLICK_STATUSES in
    // options.js for the default behaviour.
    if (autoClickEnabledStatuses.has("ready")) {
      autoHandleReadyTask(updated).catch((error) => {
        console.error("Failed to auto-handle ready Codex task", error);
      });
    }
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
  // Opens the given task URL in a browser tab. If a tab with the same URL
  // exists, it is activated and its ID is returned. Otherwise, a new tab
  // is created and its ID is returned. Rejects if the Tabs API is
  // unavailable. Returns a promise that resolves with the ID of the
  // activated or created tab, or null if the ID cannot be determined.
  if (!url) {
    return Promise.resolve(null);
  }
  if (!tabs) {
    return Promise.reject(new Error("Tabs API is unavailable."));
  }
  // Helper to create a new tab and return its ID.
  const createTab = () => {
    const createProps = { url, active: true };
    try {
      const result = tabs.create(createProps);
      if (result && typeof result.then === "function") {
        return result.then((tab) => {
          return tab && typeof tab.id === "number" ? tab.id : null;
        });
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      try {
        tabs.create(createProps, (tab) => {
          const error = runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(tab && typeof tab.id === "number" ? tab.id : null);
        });
      } catch (error) {
        reject(error);
      }
    });
  };
  // If query API is unavailable, create a new tab.
  if (!tabs.query) {
    return createTab();
  }
  return new Promise((resolve, reject) => {
    try {
      tabs.query({ url }, async (results) => {
        const error = runtime?.lastError;
        if (error) {
          // If querying failed, fall back to creating a new tab.
          createTab().then(resolve, reject);
          return;
        }
        if (Array.isArray(results) && results.length > 0) {
          const existingTab = results[0];
          if (existingTab && tabs.update) {
            try {
              await new Promise((res) => {
                tabs.update(existingTab.id, { active: true }, () => res());
              });
            } catch (err) {
              // Ignore update errors.
            }
            resolve(existingTab.id);
            return;
          }
        }
        // No existing tab found; create one.
        createTab().then(resolve, reject);
      });
    } catch (err) {
      // If querying throws, fall back to creating a new tab.
      createTab().then(resolve, reject);
    }
  });
}

// Close the tab associated with the given task ID if it exists. This
// helper looks up the stored tab ID for the task and invokes the Tabs
// API to remove it. If the tab cannot be closed (e.g. it has already
// been closed by the user) the error is silently ignored. After
// attempting removal the mapping is cleared.
function closeTaskTab(taskId) {
  if (!taskId || !tabs?.remove) {
    return;
  }
  const tabId = taskTabIds.get(taskId);
  if (!tabId && tabId !== 0) {
    return;
  }
  try {
    tabs.remove(tabId, () => {
      // Ignore errors from runtime.lastError; cleanup mapping anyway.
      taskTabIds.delete(taskId);
    });
  } catch (error) {
    // Ignore errors when closing the tab but remove the mapping.
    taskTabIds.delete(taskId);
  }
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

/**
 * Mark an existing history entry as having its pull request ready to view.
 * If the task is not found in history or is already marked as pr-ready
 * this function does nothing. After updating storage it logs the change.
 *
 * @param {Object} task An object containing at least an id. Optionally
 * includes a completedAt timestamp.
 */
async function markTaskAsPrReady(task) {
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
  if (String(existing?.status ?? "").toLowerCase() === "pr-ready") {
    return;
  }

  const completedAt =
    existing?.completedAt ?? task?.completedAt ?? new Date().toISOString();
  const updated = {
    ...existing,
    id,
    status: "pr-ready",
    completedAt,
  };

  const nextHistory = [...history];
  nextHistory[index] = updated;
  await storageSet(HISTORY_KEY, nextHistory);
  console.log("Marked Codex task as PR ready", updated);
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
    // Open the task page and record the tab ID so we can close it later
    const tabId = await openTaskInNewTab(task.url);
    if (tabId !== null && typeof tabId === "number") {
      taskTabIds.set(task.id, tabId);
    }
    // Mark the task as having had a pull request created. In the
    // original implementation this merely updated the task entry in
    // storage without triggering any additional side effects (such as
    // notifying the user). As a result users who enabled “PR created”
    // notifications never saw a popup when a task automatically
    // transitioned from "ready" to "pr-created" via the autorun feature.
    // After updating the stored history we explicitly update the in‑memory
    // history via updateHistory to ensure that the change is observed and
    // the corresponding notification is shown when appropriate. Without
    // this call updateHistory is never invoked for the status change
    // triggered here, so notificationEnabledStatuses.has("pr-created")
    // never gets a chance to fire a popup.
    // Update the task status to "pr-created" in history first. This ensures the
    // call to updateHistory sees a state change (from "ready" to
    // "pr-created") and therefore emits a notification if the user has
    // enabled notifications for this status. If we were to update the stored
    // history before calling updateHistory, the status would already be
    // "pr-created" and no notification would be triggered. See
    // https://github.com/codex-autorun/issues/ for details.
    // Perform follow-up actions (mark the task as PR created and schedule
    // the PR ready update) only when auto-click is enabled for the
    // "pr-created" status. If disabled, the extension simply opens the
    // task but leaves creating and viewing the pull request to the user.
    if (autoClickEnabledStatuses.has("pr-created")) {
      await updateHistory({
        id: task.id,
        status: "pr-created",
        completedAt: new Date().toISOString(),
      });
      // Persist the "pr-created" status in storage. This call updates the
      // underlying history without triggering another notification. Calling it
      // after updateHistory avoids suppressing the first notification.
      await markTaskAsPrCreated({
        id: task.id,
        completedAt: new Date().toISOString(),
      });

      // Schedule a notification for when the pull request should be ready
      // using the alarms API when available. Event pages can be suspended
      // before a setTimeout fires, causing pending timers to be discarded.
      // Alarms persist across suspension and wake the background context when
      // they trigger. If the alarms API is unavailable, fall back to a
      // setTimeout as a last resort.
      try {
        const completedAt = new Date().toISOString();
        if (alarmsApi && typeof alarmsApi.create === "function") {
          const alarmName = `pr-ready-${task.id}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;
          prReadyAlarmTasks.set(alarmName, {
            id: task.id,
            name: task.name,
            url: task.url,
          });
          alarmsApi.create(alarmName, { when: Date.now() + PR_READY_DELAY_MS });
        } else {
          // Fallback: use setTimeout when alarms API is not available.
        setTimeout(async () => {
          const completedAtTimeout = new Date().toISOString();
          await updateHistory({ id: task.id, status: "pr-ready", completedAt: completedAtTimeout });
          await markTaskAsPrReady({ id: task.id, completedAt: completedAtTimeout });
          if (notificationEnabledStatuses.has("pr-ready")) {
            const prReadyTask = {
              ...task,
              status: "pr-ready",
              completedAt: completedAtTimeout,
            };
            await showStatusNotification(prReadyTask, "pr-ready");
          }
          // Optionally close the Codex task tab if the user has enabled
          // closing on PR ready. The content script will still handle
          // clicking the "View PR" link within the existing page.
          if (prReadyCloseTabEnabled) {
            closeTaskTab(task.id);
          }
        }, PR_READY_DELAY_MS);
        }
      } catch (err) {
        console.error("Failed to schedule PR ready notification", err);
      }
    }
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

  // Handle a request from the GitHub merge automation script to close the
  // current tab. Only close the tab that sent the message to avoid
  // affecting other tabs. The tabs permission is declared in the
  // manifest. If sender.tab is undefined this will do nothing.
  if (message.type === "close-github-tab") {
    try {
      const tabId = sender?.tab?.id;
      if (tabId && typeof chrome !== "undefined" && chrome?.tabs?.remove) {
        chrome.tabs.remove(tabId);
      } else if (tabId && typeof browser !== "undefined" && browser?.tabs?.remove) {
        browser.tabs.remove(tabId);
      }
    } catch (error) {
      console.error("codex-autorun: failed to close GitHub tab", error);
    }
    // Respond with ack to avoid leaving the sender hanging
    sendResponse?.({ type: "ack" });
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
