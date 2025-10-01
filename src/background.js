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
let notificationSoundSelections = { ...DEFAULT_NOTIFICATION_SOUND_SELECTIONS };
let notificationSoundEnabledStatuses = new Set(
  DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
);
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

function updateNotificationEnabledStatuses(statuses) {
  notificationEnabledStatuses = new Set(statuses);
}

function updateNotificationSoundSelections(selections) {
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

async function loadNotificationPreferences() {
  try {
    const [storedStatuses, storedSelections, storedSoundEnabled] =
      await Promise.all([
        storageGet(NOTIFICATION_STATUS_STORAGE_KEY),
        storageGet(NOTIFICATION_SOUND_SELECTION_STORAGE_KEY),
        storageGet(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY),
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

  } catch (error) {
    console.error("Failed to load notification preferences", error);
    updateNotificationEnabledStatuses(DEFAULT_NOTIFICATION_STATUSES);
    updateNotificationSoundSelections(null);
    updateNotificationSoundEnabledStatuses(
      DEFAULT_NOTIFICATION_SOUND_ENABLED_STATUSES,
    );
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

async function showStatusNotification(task, statusKey) {
  if (!notifications?.create) {
    return;
  }

  const statusLabel = formatStatusLabel(statusKey);
  const taskId = normalizeTaskId(task?.id);
  const taskName = resolveTaskName(task?.name, taskId);
  const iconUrl = runtime?.getURL
    ? runtime.getURL("src/icons/icon-128.png")
    : undefined;

  const message = taskName || (taskId ? `Task ${taskId}` : "Tracked task");
  const contextMessage = taskId
    ? `Task ${taskId} is now ${statusLabel}.`
    : `Status changed to ${statusLabel}.`;

  try {
    const notificationId = await createNotification({
      type: "basic",
      iconUrl,
      title: `${statusLabel} task`,
      message,
      contextMessage: task?.url ? `${contextMessage} Click to open.` : contextMessage,
    });

    if (notificationId && task?.url) {
      notificationTaskUrls.set(notificationId, task.url);
    }

    playBrowserNotificationSound(statusKey);
  } catch (error) {
    console.error("Failed to create notification", error);
  }
}

loadNotificationPreferences();

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

  });
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
