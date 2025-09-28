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

const autoProcessingTasks = new Set();

const HISTORY_KEY = "codexTaskHistory";
const CLOSED_TASKS_KEY = "codexClosedTaskIds";

const IGNORED_NAME_PATTERNS = [
  /working on your task/gi,
  /just now/gi,
];

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
    return "";
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
