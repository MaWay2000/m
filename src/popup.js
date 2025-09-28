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

async function handleCreatePr(button, task) {
  if (!task?.id) {
    return;
  }
  errorOutput.textContent = "";
  button.disabled = true;
  try {
    if (task?.url) {
      await openTaskInNewTab(task.url);
    }
    await sendMessage({
      type: "update-task-status",
      task: {
        id: task.id,
        status: "pr-created",
        completedAt: new Date().toISOString(),
      },
    });
    await loadHistory();
  } catch (error) {
    console.error("Failed to create PR", error);
    errorOutput.textContent = `Unable to update task: ${error.message}`;
  } finally {
    button.disabled = false;
  }
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

    const content = document.createElement("div");
    content.className = "task-content";

    const title = document.createElement(task?.url ? "a" : "span");
    title.className = "task-name";
    title.textContent = task?.name ?? task?.id ?? "Unknown task";
    if (task?.url) {
      title.href = task.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    content.append(title);

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
    const statusValueRaw = task?.status ? String(task.status) : "working";
    const statusKey = statusValueRaw.toLowerCase();
    status.textContent = formatStatusLabel(statusValueRaw);
    status.classList.add(
      `task-status--${statusKey.replace(/[^a-z0-9]+/g, "-")}`,
    );

    meta.append(idBadge, startedTime, status);
    content.append(meta);
    item.append(content);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    let hasActions = false;

    if (statusKey === "ready" && task?.url) {
      const createPrButton = document.createElement("button");
      createPrButton.type = "button";
      createPrButton.className = "task-action create-pr";
      createPrButton.textContent = "Create PR";
      createPrButton.addEventListener("click", () => handleCreatePr(createPrButton, task));
      actions.append(createPrButton);
      hasActions = true;
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
