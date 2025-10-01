const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome?.runtime;
const storageApi =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : typeof chrome !== "undefined" && chrome?.storage
      ? chrome.storage
      : null;
const refreshButton = document.getElementById("refresh");
const historyList = document.getElementById("history");
const emptyState = document.getElementById("empty-state");
const errorOutput = document.getElementById("error");
const countBadge = document.getElementById("history-count");
const openSettingsButton = document.getElementById("open-settings");

const autoCreatePrTasks = new Set();
let autoCreatePrQueue = Promise.resolve();
const lastKnownTaskStatuses = new Map();
const COMPLETED_STATUS_KEYS = new Set(["ready", "pr-created", "merged"]);

const SOUND_STATUSES = ["ready", "pr-created", "merged"];
const SOUND_STATUS_STORAGE_KEY = "codexSoundStatuses";
const SOUND_SELECTION_STORAGE_KEY = "codexSoundSelections";
const DEFAULT_SOUND_STATUSES = ["ready", "merged"];
const DEFAULT_SOUND_SELECTIONS = {
  ready: "1.mp3",
  "pr-created": "1.mp3",
  merged: "1.mp3",
};
const SOUND_STATUS_VALUES = new Set(SOUND_STATUSES);
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
let soundEnabledStatuses = new Set(DEFAULT_SOUND_STATUSES);
let soundSelectionsByStatus = { ...DEFAULT_SOUND_SELECTIONS };

let hasRenderedHistory = false;
let audioContext;
let userHasInteracted = false;
const audioBufferCache = new Map();

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

function sanitizeSoundStatuses(value) {
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
    if (!normalized || seen.has(normalized) || !SOUND_STATUS_VALUES.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    sanitized.push(normalized);
  }
  return sanitized;
}

function sanitizeSoundSelections(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const sanitized = {};
  for (const status of SOUND_STATUSES) {
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

function updateSoundEnabledStatuses(statuses) {
  soundEnabledStatuses = new Set(statuses);
}

function updateSoundSelections(selections) {
  soundSelectionsByStatus = { ...DEFAULT_SOUND_SELECTIONS, ...selections };
}

async function loadSoundPreferences() {
  try {
    const [storedStatuses, storedSelections] = await Promise.all([
      storageGet(SOUND_STATUS_STORAGE_KEY),
      storageGet(SOUND_SELECTION_STORAGE_KEY),
    ]);
    const sanitizedStatuses = sanitizeSoundStatuses(storedStatuses);
    const statuses =
      sanitizedStatuses !== null ? sanitizedStatuses : DEFAULT_SOUND_STATUSES;
    updateSoundEnabledStatuses(statuses);

    const sanitizedSelections = sanitizeSoundSelections(storedSelections);
    updateSoundSelections(sanitizedSelections ?? {});
  } catch (error) {
    console.error("Failed to load sound preferences", error);
    updateSoundEnabledStatuses(DEFAULT_SOUND_STATUSES);
    updateSoundSelections({});
  }
}

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
    const statusChange = changes[SOUND_STATUS_STORAGE_KEY];
    if (statusChange) {
      const sanitizedStatuses = sanitizeSoundStatuses(statusChange.newValue);
      if (sanitizedStatuses !== null) {
        updateSoundEnabledStatuses(sanitizedStatuses);
      } else {
        updateSoundEnabledStatuses(DEFAULT_SOUND_STATUSES);
      }
    }

    const selectionChange = changes[SOUND_SELECTION_STORAGE_KEY];
    if (selectionChange) {
      const sanitizedSelections = sanitizeSoundSelections(selectionChange.newValue);
      updateSoundSelections(sanitizedSelections ?? {});
    }
  });
}

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioContextClass();
      audioBufferCache.clear();
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

function decodeAudioBuffer(context, arrayBuffer) {
  if (!context) {
    return Promise.reject(new Error("Audio context unavailable"));
  }
  try {
    const result = context.decodeAudioData(arrayBuffer);
    if (result && typeof result.then === "function") {
      return result;
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    try {
      context.decodeAudioData(arrayBuffer, resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function getAudioBuffer(fileName, context) {
  if (!fileName || !context) {
    return null;
  }
  const cached = audioBufferCache.get(fileName);
  if (cached instanceof AudioBuffer) {
    return cached;
  }
  if (cached && typeof cached.then === "function") {
    try {
      const resolved = await cached;
      if (resolved instanceof AudioBuffer) {
        return resolved;
      }
    } catch (error) {
      audioBufferCache.delete(fileName);
      console.error("Cached sound failed to load", error);
    }
  }

  const loaderPromise = (async () => {
    const url = getSoundFileUrl(fileName);
    if (!url) {
      throw new Error("Unknown sound file");
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load sound (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return decodeAudioBuffer(context, buffer);
  })()
    .then((buffer) => {
      if (buffer instanceof AudioBuffer) {
        audioBufferCache.set(fileName, buffer);
        return buffer;
      }
      throw new Error("Invalid audio buffer");
    })
    .catch((error) => {
      audioBufferCache.delete(fileName);
      console.error("Failed to prepare notification sound", error);
      throw error;
    });

  audioBufferCache.set(fileName, loaderPromise);
  try {
    const resolved = await loaderPromise;
    return resolved instanceof AudioBuffer ? resolved : null;
  } catch (error) {
    return null;
  }
}

async function playStatusSound(statusKey) {
  const context = ensureAudioContext();
  if (!context) {
    return;
  }
  const fileName = soundSelectionsByStatus?.[statusKey];
  const normalized =
    typeof fileName === "string" && SOUND_FILE_VALUES.has(fileName)
      ? fileName
      : DEFAULT_SOUND_SELECTIONS[statusKey] ?? DEFAULT_SOUND_SELECTIONS.ready;
  const buffer = await getAudioBuffer(normalized, context);
  if (!buffer) {
    return;
  }
  try {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
  } catch (error) {
    console.error("Failed to play notification sound", error);
  }
}

function playNotificationSound(kind = "default") {
  if (SOUND_STATUS_VALUES.has(kind)) {
    void playStatusSound(kind);
    return;
  }
  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;

  const pattern =
    kind === "completion"
      ? [
          { offset: 0, frequency: 880 },
          { offset: 0.28, frequency: 1040 },
        ]
      : [{ offset: 0, frequency: 720 }];

  for (const tone of pattern) {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone.frequency, now + tone.offset);

    gainNode.gain.setValueAtTime(0.0001, now + tone.offset);
    gainNode.gain.exponentialRampToValueAtTime(0.18, now + tone.offset + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + tone.offset + 0.32);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(now + tone.offset);
    oscillator.stop(now + tone.offset + 0.36);
  }
}

window.addEventListener(
  "pointerdown",
  () => {
    userHasInteracted = true;
    ensureAudioContext();
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

function openOptionsPage() {
  if (typeof browser !== "undefined" && browser?.runtime?.openOptionsPage) {
    try {
      const result = browser.runtime.openOptionsPage();
      if (result && typeof result.then === "function") {
        return result;
      }
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.openOptionsPage) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.openOptionsPage(() => {
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
  const url = runtime?.getURL ? runtime.getURL("src/options.html") : null;
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  }
  return Promise.reject(new Error("Options page is unavailable."));
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
    return "PR ready to view";
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
  const statusesToPlay = new Set();

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
      const wasPreviouslySoundEligible =
        previousStatus !== undefined &&
        soundEnabledStatuses.has(previousStatus);

      if (
        hasRenderedHistory &&
        soundEnabledStatuses.has(statusKey) &&
        !wasPreviouslySoundEligible
      ) {
        statusesToPlay.add(statusKey);
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

  for (const statusKey of statusesToPlay) {
    playNotificationSound(statusKey);
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

function handleOpenSettingsClick(event) {
  event?.preventDefault();
  if (!openSettingsButton) {
    return;
  }
  openSettingsButton.disabled = true;
  openOptionsPage()
    .catch((error) => {
      console.error("Failed to open extension settings", error);
      if (errorOutput) {
        errorOutput.textContent = `Unable to open settings: ${error.message}`;
      }
    })
    .finally(() => {
      openSettingsButton.disabled = false;
    });
}

refreshButton?.addEventListener("click", () => {
  refreshButton.disabled = true;
  loadHistory().finally(() => {
    refreshButton.disabled = false;
  });
});

openSettingsButton?.addEventListener("click", handleOpenSettingsClick);

window.addEventListener("DOMContentLoaded", () => {
  loadSoundPreferences()
    .catch((error) => {
      console.error("Failed to prepare sound preferences", error);
    })
    .finally(() => {
      loadHistory();
    });
});
