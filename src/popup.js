import {
  addSettingsChangeListener,
  getSettings,
  normalizeSettings,
} from "./settings.js";

const refreshButton = document.getElementById("refresh");
const optionsButton = document.getElementById("open-options");
const historyList = document.getElementById("history");
const emptyState = document.getElementById("empty-state");
const errorOutput = document.getElementById("error");
const countBadge = document.getElementById("history-count");

const autoCreatePrTasks = new Set();
let autoCreatePrQueue = Promise.resolve();
const lastKnownTaskStatuses = new Map();
const COMPLETED_STATUS_KEYS = new Set(["ready", "merged"]);

let hasRenderedHistory = false;
let audioContext;
let userHasInteracted = false;
let currentSettings = normalizeSettings();

function applySettings(nextSettings) {
  currentSettings = normalizeSettings(nextSettings);
}

function shouldPlaySounds() {
  return currentSettings?.soundNotifications?.enabled !== false;
}

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!shouldPlaySounds()) {
    return null;
  }
  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioContextClass();
    } catch (error) {
      console.error("Failed to create audio context", error);
      audioContext = null;
      return null;
    }
  }
  if (audioContext?.state === "suspended" && userHasInteracted) {
    audioContext.resume().catch((error) => {
      console.error("Failed to resume audio context", error);
    });
  }
  return audioContext ?? null;
}

function playNotificationSound(kind = "default") {
  if (!shouldPlaySounds()) {
    return;
  }
  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;
  const pattern = [{ offset: 0 }];
  const envelopeDuration = 1;
  const frequencies = [440, 660];

  for (const tone of pattern) {
    const startTime = now + tone.offset;
    const gainNode = context.createGain();

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.linearRampToValueAtTime(0.5, startTime + 0.03);
    gainNode.gain.linearRampToValueAtTime(0.42, startTime + 0.15);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + envelopeDuration);

    gainNode.connect(context.destination);

    for (const frequency of frequencies) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startTime);
      oscillator.connect(gainNode);
      oscillator.start(startTime);
      oscillator.stop(startTime + envelopeDuration);
    }
  }
}

window.addEventListener(
  "pointerdown",
  () => {
    userHasInteracted = true;
    if (shouldPlaySounds()) {
      ensureAudioContext();
    }
  },
  { once: true, capture: true },
);

const MAX_AUTO_CREATE_PR_AGE_MS = 5 * 60 * 1000;

function sendMessage(message) {
  if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
    return browser.runtime.sendMessage(message);
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }
  return Promise.reject(new Error("Runtime messaging is unavailable."));
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatStatusLabel(status) {
  if (!status) {
    return "Working";
  }
  const normalized = String(status).trim();
  if (!normalized) {
    return "Working";
  }
  if (normalized.toLowerCase() === "pr-created") {
    return "PR created";
  }
  const words = normalized
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  return words.length ? words.join(" ") : "Working";
}

function openTaskInNewTab(url) {
  if (!url) {
    return Promise.resolve();
  }
  if (typeof browser !== "undefined" && browser?.tabs?.create) {
    return browser.tabs.create({ url }).then(() => {});
  }
  if (typeof chrome !== "undefined" && chrome?.tabs?.create) {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.create({ url }, () => {
          const error = chrome.runtime?.lastError;
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
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

async function handleCreatePr(button, task, options = {}) {
  if (!task?.id) {
    return false;
  }
  if (!options?.silent) {
    playNotificationSound("action");
  }
  errorOutput.textContent = "";
  button.disabled = true;
  let success = false;
  try {
    if (task?.url) {
      await openTaskInNewTab(task.url);
    }
    const response = await sendMessage({
      type: "update-task-status",
      task: {
        id: task.id,
        status: "pr-created",
        completedAt: new Date().toISOString(),
      },
    });
    if (response?.type === "error") {
      throw new Error(response.message ?? "Unable to update task status");
    }
    if (response && response.type !== "ack") {
      throw new Error("Unexpected response from background script");
    }
    success = true;
    await loadHistory();
  } catch (error) {
    console.error("Failed to create PR", error);
    errorOutput.textContent = `Unable to update task: ${error.message}`;
  } finally {
    button.disabled = false;
  }
  return success;
}

function isRecentTaskCompletion(task) {
  if (!task?.completedAt) {
    return false;
  }
  const completedTime = Date.parse(task.completedAt);
  if (!Number.isFinite(completedTime)) {
    return false;
  }
  const now = Date.now();
  if (Number.isNaN(now) || now < completedTime) {
    return false;
  }
  return now - completedTime <= MAX_AUTO_CREATE_PR_AGE_MS;
}

function queueAutoCreatePr(button, task) {
  if (!task?.id || autoCreatePrTasks.has(task.id)) {
    return;
  }

  autoCreatePrTasks.add(task.id);
  autoCreatePrQueue = autoCreatePrQueue
    .catch((error) => {
      console.error("Auto-create PR chain error", error);
    })
    .then(async () => {
      const success = await handleCreatePr(button, task, { silent: true });
      if (!success) {
        autoCreatePrTasks.delete(task.id);
      }
    });
}

async function handleCloseTask(button, taskId) {
  if (!taskId) {
    return;
  }

  errorOutput.textContent = "";
  button.disabled = true;

  try {
    const response = await sendMessage({
      type: "close-history-task",
      taskId,
    });

    if (response?.type === "error") {
      throw new Error(response.message ?? "Unable to close task");
    }

    if (response && response.type !== "ack") {
      throw new Error("Unexpected response from background script");
    }

    await loadHistory();
  } catch (error) {
    console.error("Failed to close task", error);
    errorOutput.textContent = `Unable to remove task: ${error.message}`;
    button.disabled = false;
  }
}

function renderHistory(history) {
  historyList.innerHTML = "";
  const tasks = Array.isArray(history) ? history : [];
  const nextStatuses = new Map();
  let shouldPlayCompletionSound = false;

  if (!tasks.length) {
    emptyState.hidden = false;
    countBadge.hidden = true;
    lastKnownTaskStatuses.clear();
    hasRenderedHistory = true;
    return;
  }

  emptyState.hidden = true;
  countBadge.hidden = false;
  countBadge.textContent = String(tasks.length);

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = "history-item";

    const content = document.createElement("div");
    content.className = "task-content";

    const header = document.createElement("div");
    header.className = "task-header";

    const title = document.createElement(task?.url ? "a" : "span");
    title.className = "task-name";
    title.textContent = task?.name ?? task?.id ?? "Unknown task";
    if (task?.url) {
      title.href = task.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    header.append(title);

    let closeButton = null;
    if (task?.id) {
      closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "task-close";
      closeButton.textContent = "✕";
      closeButton.title = "Remove from history";
      closeButton.setAttribute("aria-label", "Remove task from history");
      closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleCloseTask(closeButton, task.id);
      });
    }

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const idBadge = document.createElement("span");
    idBadge.className = "task-id";
    if (task?.id) {
      idBadge.textContent = task.id;
    } else {
      idBadge.textContent = "unknown";
    }

    const startedTime = document.createElement("time");
    startedTime.className = "task-started";
    if (task?.startedAt) {
      startedTime.dateTime = task.startedAt;
    }
    startedTime.textContent = formatTimestamp(task?.startedAt);

    const statusValueRaw = task?.status ? String(task.status) : "working";
    const statusKey = statusValueRaw.trim().toLowerCase();

    if (task?.id) {
      nextStatuses.set(task.id, statusKey);
      const previousStatus = lastKnownTaskStatuses.get(task.id);
      const wasPreviouslyCompleted =
        previousStatus !== undefined &&
        COMPLETED_STATUS_KEYS.has(previousStatus);

      if (
        hasRenderedHistory &&
        COMPLETED_STATUS_KEYS.has(statusKey) &&
        !wasPreviouslyCompleted
      ) {
        shouldPlayCompletionSound = true;
      }
    }

    if (closeButton) {
      header.append(closeButton);
    }
    content.append(header);

    meta.append(idBadge, startedTime);
    content.append(meta);
    item.append(content);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    let hasActions = false;

    const shouldAutoCreatePr =
      statusKey === "ready" &&
      task?.url &&
      isRecentTaskCompletion(task);

    if (statusKey === "ready" && task?.url) {
      const createPrButton = document.createElement("button");
      createPrButton.type = "button";
      createPrButton.className = "task-action create-pr";
      createPrButton.textContent = "Create PR";
      createPrButton.addEventListener("click", () => handleCreatePr(createPrButton, task));
      actions.append(createPrButton);
      hasActions = true;

      if (shouldAutoCreatePr) {
        queueMicrotask(() => {
          queueAutoCreatePr(createPrButton, task);
        });
      }
    }

    if (task?.url && statusKey !== "ready") {
      const viewTaskButton = document.createElement("button");
      viewTaskButton.type = "button";
      viewTaskButton.className = "task-action view-task";
      viewTaskButton.textContent = "Open task";
      viewTaskButton.addEventListener("click", () => {
        openTaskInNewTab(task.url).catch((error) => {
          console.error("Failed to open task", error);
          errorOutput.textContent = `Unable to open task: ${error.message}`;
        });
      });
      actions.append(viewTaskButton);
      hasActions = true;
    }

    if (hasActions) {
      item.append(actions);
    }

    historyList.append(item);
  }

  lastKnownTaskStatuses.clear();
  for (const [id, status] of nextStatuses) {
    lastKnownTaskStatuses.set(id, status);
  }

  if (shouldPlayCompletionSound) {
    playNotificationSound("completion");
  }

  hasRenderedHistory = true;
}

async function loadHistory() {
  errorOutput.textContent = "";
  try {
    const response = await sendMessage({ type: "get-history" });
    if (response?.type === "history") {
      renderHistory(response.history);
      return;
    }
    if (response?.type === "error") {
      throw new Error(response.message ?? "Unknown background error");
    }
    throw new Error("Unexpected response from background script.");
  } catch (error) {
    console.error("Failed to load history", error);
    emptyState.hidden = true;
    countBadge.hidden = true;
    historyList.innerHTML = "";
    errorOutput.textContent = `Unable to load history: ${error.message}`;
  }
}

refreshButton?.addEventListener("click", () => {
  refreshButton.disabled = true;
  loadHistory().finally(() => {
    refreshButton.disabled = false;
  });
});

optionsButton?.addEventListener("click", () => {
  try {
    if (typeof browser !== "undefined" && browser?.runtime?.openOptionsPage) {
      browser.runtime.openOptionsPage();
      return;
    }
    if (typeof chrome !== "undefined" && chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
  } catch (error) {
    console.error("Failed to open options page", error);
  }
  if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
    const url = browser.runtime.getURL("src/options.html");
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    const url = chrome.runtime.getURL("src/options.html");
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

window.addEventListener("DOMContentLoaded", () => {
  loadHistory();
  getSettings()
    .then(applySettings)
    .catch((error) => {
      console.error("Failed to load settings", error);
    });
});

addSettingsChangeListener((settings) => {
  applySettings(settings);
});
