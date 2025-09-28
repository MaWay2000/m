const refreshButton = document.getElementById("refresh");
const historyList = document.getElementById("history");
const emptyState = document.getElementById("empty-state");
const errorOutput = document.getElementById("error");
const countBadge = document.getElementById("history-count");

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

function renderHistory(history) {
  historyList.innerHTML = "";
  const tasks = Array.isArray(history) ? history : [];

  if (!tasks.length) {
    emptyState.hidden = false;
    countBadge.hidden = true;
    return;
  }

  emptyState.hidden = true;
  countBadge.hidden = false;
  countBadge.textContent = String(tasks.length);

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = "history-item";

    const title = document.createElement(task?.url ? "a" : "span");
    title.className = "task-name";
    title.textContent = task?.name ?? task?.id ?? "Unknown task";
    if (task?.url) {
      title.href = task.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
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

    const status = document.createElement("span");
    status.className = "task-status";
    const statusLabel = task?.status ? String(task.status) : "working";
    status.textContent = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);

    meta.append(idBadge, startedTime, status);
    item.append(title, meta);
    historyList.append(item);
  }
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

window.addEventListener("DOMContentLoaded", () => {
  loadHistory();
});
