const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome.runtime;
const storage =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : chrome.storage;

const HISTORY_KEY = "codexTaskHistory";

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
    name: task.name ?? `Task ${task.id}`,
    url: task.url ?? null,
    startedAt: task.startedAt ?? new Date().toISOString(),
    status: task.status ?? "working",
  };
  const nextHistory = [entry, ...history].slice(0, 200);
  await storageSet(HISTORY_KEY, nextHistory);
  console.log("Tracked codex task", entry);
}

async function getHistory() {
  return (await storageGet(HISTORY_KEY)) ?? [];
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

  return false;
});
