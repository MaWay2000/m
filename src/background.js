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
  if (!task?.id) {
    return;
  }
  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const exists = history.some((entry) => entry.id === task.id);
  if (exists) {
    return;
  }
  const entry = {
    id: task.id,
    name: resolveTaskName(task.name, task.id),
    url: task.url ?? null,
    startedAt: task.startedAt ?? new Date().toISOString(),
    status: task.status ?? "working",
  };
  const nextHistory = [entry, ...history].slice(0, 200);
  await storageSet(HISTORY_KEY, nextHistory);
  console.log("Tracked codex task", entry);
}

async function updateHistory(task) {
  if (!task?.id) {
    return;
  }
  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const index = history.findIndex((entry) => entry.id === task.id);

  if (index === -1) {
    const sanitizedName = sanitizeTaskName(task?.name);
    const entry = {
      id: task.id,
      name: resolveTaskName(sanitizedName || task?.name, task.id),
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
    status: updates.status ?? existing.status,
    completedAt: updates.completedAt ?? existing.completedAt ?? null,
  };
  updated.name = resolveTaskName(updated.name ?? existing.name, task.id);
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
  let requiresUpdate = false;
  const normalizedHistory = history.map((entry) => {
    if (!entry?.id) {
      return entry;
    }
    const resolvedName = resolveTaskName(entry.name, entry.id);
    if (resolvedName !== entry.name) {
      requiresUpdate = true;
      return { ...entry, name: resolvedName };
    }
    return entry;
  });

  if (requiresUpdate) {
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
  if (!task?.id) {
    return;
  }

  const history = (await storageGet(HISTORY_KEY)) ?? [];
  const index = history.findIndex((entry) => entry.id === task.id);
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

  if (message.type === "smart-check-task") {
    performSmartCheck(message.task).then(
      (result) => sendResponse?.({ type: "smart-check-result", result }),
      (error) => {
        console.error("Failed to run smart task check", error);
        sendResponse?.({ type: "error", message: String(error) });
      },
    );
    return true;
  }

  return false;
});

function queryTabs(queryInfo) {
  if (!tabs?.query) {
    return Promise.resolve([]);
  }

  try {
    const result = tabs.query(queryInfo);
    if (result && typeof result.then === "function") {
      return result.catch((error) => {
        console.error("Failed to query tabs", error);
        return [];
      });
    }
  } catch (error) {
    console.error("Failed to query tabs", error);
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    try {
      tabs.query(queryInfo, (tabResults) => {
        if (runtime?.lastError) {
          console.error("Tabs query error", runtime.lastError);
          resolve([]);
          return;
        }
        resolve(Array.isArray(tabResults) ? tabResults : []);
      });
    } catch (error) {
      console.error("Failed to query tabs", error);
      resolve([]);
    }
  });
}

function sendMessageToTab(tabId, message) {
  if (!tabs?.sendMessage) {
    return Promise.reject(new Error("Tabs messaging is unavailable."));
  }

  try {
    const result = tabs.sendMessage(tabId, message);
    if (result && typeof result.then === "function") {
      return result;
    }
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    try {
      tabs.sendMessage(tabId, message, (response) => {
        const error = runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function performSmartCheck(task) {
  const taskId = task?.id;
  if (!taskId) {
    throw new Error("Task ID is required for smart check.");
  }

  const candidateTabs = await queryTabs({
    url: ["https://chatgpt.com/*", "https://debuggpt.tools/*"],
  });

  if (!candidateTabs.length) {
    throw new Error("Open the Codex task in a browser tab to run a smart check.");
  }

  const normalizedTaskId = String(taskId).trim();
  let lastError = null;

  for (const tab of candidateTabs) {
    if (!tab?.id) {
      continue;
    }

    const tabUrl = tab.url ?? "";
    if (tabUrl && !tabUrl.includes(normalizedTaskId)) {
      // Skip unrelated tabs when a task URL hint is present.
      if (task?.url && !tabUrl.startsWith(task.url)) {
        continue;
      }
    }

    try {
      const response = await sendMessageToTab(tab.id, {
        type: "codex-autorun:check-task-status",
        taskId: normalizedTaskId,
        url: task?.url ?? null,
      });

      if (!response || typeof response !== "object") {
        continue;
      }

      if (response.found === false) {
        if (response?.name) {
          await updateHistory({ id: normalizedTaskId, name: response.name });
        }
        lastError = new Error(
          "Unable to locate this task on the open Codex tab. Refresh the tab and try again.",
        );
        continue;
      }

      const updates = { id: normalizedTaskId };
      if (response?.status) {
        updates.status = response.status;
      }
      if (response?.name) {
        updates.name = response.name;
      }
      if (response?.url) {
        updates.url = response.url;
      }
      if (response?.completedAt) {
        updates.completedAt = response.completedAt;
      }

      await updateHistory(updates);

      return {
        tabId: tab.id,
        status: updates.status ?? null,
        name: updates.name ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error("Smart check could not verify the task. Ensure the task page is open and try again.")
  );
}
