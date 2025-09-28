const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome?.runtime;

const trackedTasks = new Map();
const MIN_SQUARE_SIZE = 6;
const MAX_SQUARE_SIZE = 24;

function isTransparentColor(color) {
  if (!color || color === "transparent") {
    return true;
  }
  const rgbaMatch = color.match(/rgba?\(([^)]+)\)/i);
  if (!rgbaMatch) {
    return false;
  }
  const parts = rgbaMatch[1].split(",").map((value) => value.trim());
  if (parts.length === 4) {
    const alpha = parseFloat(parts[3]);
    return Number.isFinite(alpha) ? alpha === 0 : false;
  }
  if (parts.length === 3) {
    return parts.every((value) => value === "0" || value === "0%" || value === "0.0");
  }
  return false;
}

function isSquareIndicator(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }
  if (rect.width < MIN_SQUARE_SIZE || rect.height < MIN_SQUARE_SIZE) {
    return false;
  }
  if (rect.width > MAX_SQUARE_SIZE || rect.height > MAX_SQUARE_SIZE) {
    return false;
  }
  const aspectDifference = Math.abs(rect.width - rect.height);
  if (aspectDifference > Math.max(2, Math.min(rect.width, rect.height) * 0.25)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  const hasBackground = style && !isTransparentColor(style.backgroundColor);
  const borderWidth = parseFloat(style?.borderWidth ?? "0");
  const hasBorder = Number.isFinite(borderWidth) && borderWidth > 0.2 && !isTransparentColor(style?.borderColor ?? "transparent");
  return hasBackground || hasBorder;
}

function findIndicatorElement(container) {
  if (!container) {
    return null;
  }
  const directMatch = container.querySelector(
    '[data-testid*="indicator" i], [data-testid*="status" i], [aria-label*="working" i], [title*="working" i]',
  );
  if (directMatch) {
    return directMatch;
  }
  const candidates = container.querySelectorAll("span, div, i, svg, button");
  for (const element of candidates) {
    if (isSquareIndicator(element)) {
      return element;
    }
  }
  return null;
}

function extractTaskId(href) {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href, window.location.origin);
    const match = url.pathname.match(/\/codex\/tasks\/([^/]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

function extractTaskName(container, link) {
  const candidate =
    container?.querySelector("h1, h2, h3, h4, [data-testid*='title' i], strong") ?? link;
  if (candidate?.textContent) {
    const text = candidate.textContent.replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }
  const fallback = link?.textContent ?? container?.textContent;
  return fallback ? fallback.replace(/\s+/g, " ").trim() : null;
}

function extractTaskUrl(link) {
  if (!link) {
    return null;
  }
  if (link.href) {
    return link.href;
  }
  const href = link.getAttribute("href");
  if (href) {
    try {
      return new URL(href, window.location.origin).toString();
    } catch (error) {
      return href;
    }
  }
  return null;
}

function notifyBackground(task) {
  if (!runtime?.sendMessage) {
    return;
  }
  try {
    const result = runtime.sendMessage({ type: "square-detected", task });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    console.warn("codex-autorun: failed to notify background", error);
  }
}

function notifyTaskReady(task) {
  if (!runtime?.sendMessage) {
    return;
  }
  try {
    const result = runtime.sendMessage({
      type: "square-status-updated",
      task,
    });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    console.warn("codex-autorun: failed to notify ready status", error);
  }
}

function scanForTasks() {
  const links = Array.from(document.querySelectorAll('a[href*="/codex/tasks/"]'));
  const seenIds = new Set();

  for (const link of links) {
    const taskId = extractTaskId(link.getAttribute("href") || link.href);
    if (!taskId || seenIds.has(taskId)) {
      continue;
    }
    seenIds.add(taskId);
    const container =
      link.closest('[data-testid*="task" i], article, li, section, div') ??
      link.parentElement ??
      link;
    const indicator = findIndicatorElement(container);
    if (indicator) {
      if (!trackedTasks.has(taskId)) {
        const name = extractTaskName(container, link) ?? `Task ${taskId}`;
        const url = extractTaskUrl(link);
        const startedAt = new Date().toISOString();
        const task = { name, url, startedAt, status: "working" };
        trackedTasks.set(taskId, task);
        notifyBackground({ id: taskId, ...task });
      }
    } else if (trackedTasks.has(taskId)) {
      const tracked = trackedTasks.get(taskId);
      trackedTasks.delete(taskId);
      notifyTaskReady({
        id: taskId,
        status: "ready",
        completedAt: new Date().toISOString(),
        name: tracked?.name,
        url: tracked?.url,
        startedAt: tracked?.startedAt,
      });
    }
  }

  for (const trackedId of Array.from(trackedTasks.keys())) {
    if (!seenIds.has(trackedId)) {
      const tracked = trackedTasks.get(trackedId);
      trackedTasks.delete(trackedId);
      notifyTaskReady({
        id: trackedId,
        status: "ready",
        completedAt: new Date().toISOString(),
        name: tracked?.name,
        url: tracked?.url,
        startedAt: tracked?.startedAt,
      });
    }
  }
}

if (!window.__codexSquareWatcherInitialized) {
  window.__codexSquareWatcherInitialized = true;
  scanForTasks();
  setInterval(scanForTasks, 3000);
}
