const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome?.runtime;

const trackedTasks = new Map();
const knownTaskNames = new Map();
const pendingNameRefreshes = new Map();
const MIN_SQUARE_SIZE = 6;
const MAX_SQUARE_SIZE = 24;
const AUTO_CLICK_MAX_ATTEMPTS = 120;
const AUTO_CLICK_INTERVAL_MS = 500;
const NAME_REFRESH_INTERVAL_MS = 60 * 1000;
const MAX_NAME_REFRESH_ATTEMPTS = 30;
const MAX_NAME_REFRESH_MISSES = 30;
const WORKING_TASK_MISSING_GRACE_MS = 15 * 60 * 1000;

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

function parseCssColor(color) {
  if (!color || typeof color !== "string") {
    return null;
  }

  const trimmed = color.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        return null;
      }
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        return null;
      }
      return { r, g, b, a: 1 };
    }
    return null;
  }

  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (!rgbMatch) {
    return null;
  }

  const parts = rgbMatch[1]
    .split(/[\s,\/]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const parseChannel = (value) => {
    if (value.endsWith("%")) {
      const percent = parseFloat(value.slice(0, -1));
      if (!Number.isFinite(percent)) {
        return null;
      }
      return Math.max(0, Math.min(100, percent)) * 2.55;
    }
    const number = parseFloat(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return Math.max(0, Math.min(255, number));
  };

  const r = parseChannel(parts[0]);
  const g = parseChannel(parts[1]);
  const b = parseChannel(parts[2]);

  if (r == null || g == null || b == null) {
    return null;
  }

  let a = 1;
  if (parts.length >= 4) {
    const alpha = parseFloat(parts[3]);
    if (Number.isFinite(alpha)) {
      a = Math.max(0, Math.min(1, alpha));
    }
  }

  return { r, g, b, a };
}

function isDarkColor(color) {
  const parsed = parseCssColor(color);
  if (!parsed || parsed.a === 0) {
    return false;
  }

  const { r, g, b } = parsed;
  if (![r, g, b].every((channel) => Number.isFinite(channel))) {
    return false;
  }

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 110;
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
  const hasDarkBackground = hasBackground && isDarkColor(style.backgroundColor);
  const hasDarkBorder = hasBorder && isDarkColor(style.borderColor);
  return hasDarkBackground || hasDarkBorder;
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

const IGNORED_TEXT_PATTERNS = [
  /\bworking on your task\b/i,
  /\bjust now\b/i,
  /\bcommitting changes?\b/i,
  /\b(?:seconds?|minutes?|hours?|days?)\s+ago\b/i,
  // Ignore generic or procedural phrases that are not meaningful task names.
  /\bcompleting the task\b/i,
];

const IGNORED_TEXT_SYMBOLS = ["·", "|", "•"];

const PREFERRED_TASK_TEXT_SELECTORS = [
  "[data-testid*='task-text' i]",
  "[data-testid*='task-summary' i]",
  "[data-testid*='task-title' i]",
  "[data-testid*='task-name' i]",
  "[data-testid*='prompt' i]",
  "article p",
  "p[data-testid]",
];

const CONVERSATION_TASK_SELECTORS = [
  "[data-message-author-role='user']",
  "[data-testid*='user-message' i]",
  "[data-testid*='task-prompt' i]",
  "[data-testid*='prompt-message' i]",
  "main [data-message-author-role='user']",
];

const MAX_TRACKED_NAME_ENTRIES = 400;
const MAX_TASK_NAME_LENGTH = 500;

function rememberTaskName(taskId, name) {
  if (!taskId || !name) {
    return;
  }
  const normalizedName = normalizeTaskText(name);
  if (!normalizedName) {
    return;
  }
  const limitedName =
    normalizedName.length > MAX_TASK_NAME_LENGTH
      ? `${normalizedName.slice(0, MAX_TASK_NAME_LENGTH - 1).trim()}…`
      : normalizedName;
  knownTaskNames.set(taskId, limitedName);
  if (knownTaskNames.size > MAX_TRACKED_NAME_ENTRIES) {
    const excess = knownTaskNames.size - MAX_TRACKED_NAME_ENTRIES;
    const keys = Array.from(knownTaskNames.keys());
    for (let index = 0; index < excess; index += 1) {
      knownTaskNames.delete(keys[index]);
    }
  }
}

function shouldScheduleNameRefresh(name, taskId) {
  const normalized = normalizeTaskText(name);
  if (!normalized) {
    return true;
  }

  const lower = normalized.toLowerCase();
  if (taskId && normalized === `Task ${taskId}`) {
    return true;
  }
  if (lower === "unknown task") {
    return true;
  }
  if (/\bworking on your task\b/i.test(lower)) {
    return true;
  }
  if (/\bcommitting changes?\b/i.test(lower)) {
    return true;
  }
  if (/\bjust now\b/i.test(lower)) {
    return true;
  }
  if (/\b(?:seconds?|minutes?|hours?|days?)\s+ago\b/i.test(lower)) {
    return true;
  }
  if (/^[0-9:]+$/.test(normalized) && normalized.length <= 5) {
    return true;
  }
  if (normalized.length <= 3) {
    return true;
  }

  return false;
}

function scheduleNameRefresh(taskId, details = {}) {
  if (!taskId) {
    return;
  }

  const existing = pendingNameRefreshes.get(taskId) ?? {};
  const now = Date.now();
  const nextRefresh = now + NAME_REFRESH_INTERVAL_MS;

  pendingNameRefreshes.set(taskId, {
    attempts: existing.attempts ?? 0,
    nextCheckAt: nextRefresh,
    url: details.url ?? existing.url ?? null,
    startedAt: details.startedAt ?? existing.startedAt ?? null,
    completedAt: details.completedAt ?? existing.completedAt ?? null,
    lastKnownName: details.name ?? existing.lastKnownName ?? null,
    missingCount: 0,
  });
}

function normalizeTextContent(value) {
  if (!value) {
    return "";
  }
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTaskText(value) {
  const normalized = normalizeTextContent(value);
  if (!normalized) {
    return "";
  }

  const removeIgnoredText = (input) => {
    let result = input;
    for (const pattern of IGNORED_TEXT_PATTERNS) {
      result = result.replace(pattern, " ");
    }
    return result.replace(/\s+/g, " ").trim();
  };

  const segments = normalized
    .split(/[·•|]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return removeIgnoredText(normalized);
  }

  const cleanedSegments = [];

  for (const segment of segments) {
    const cleaned = removeIgnoredText(segment);
    if (!cleaned) {
      continue;
    }
    const lower = cleaned.toLowerCase();
    if (IGNORED_TEXT_PATTERNS.some((pattern) => pattern.test(lower))) {
      continue;
    }
    cleanedSegments.push(cleaned);
  }

  if (!cleanedSegments.length) {
    return removeIgnoredText(normalized);
  }

  return cleanedSegments.join(" · ");
}

function looksLikeIdeaTag(text) {
  const normalized = normalizeTaskText(text);
  if (!normalized) {
    return false;
  }
  const words = normalized.split(/\s+/);
  if (words.length !== 2) {
    return false;
  }
  if (normalized.length < 8 || normalized.length > 40) {
    return false;
  }
  if (!words.every((word) => /^[A-Za-z][A-Za-z0-9+/&-]*$/.test(word))) {
    return false;
  }
  const uppercaseWordCount = words.filter((word) => /^[A-Z]/.test(word)).length;
  if (!uppercaseWordCount) {
    return false;
  }
  const hasDistinctiveWord = words.some(
    (word) => word.length >= 5 || /^[A-Z]{2,}$/.test(word),
  );
  return hasDistinctiveWord;
}

function isMeaningfulTaskText(text) {
  const normalized = normalizeTaskText(text);
  if (!normalized) {
    return false;
  }
  if (normalized.length < 6) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (IGNORED_TEXT_PATTERNS.some((pattern) => pattern.test(lower))) {
    return false;
  }
  if (IGNORED_TEXT_SYMBOLS.some((symbol) => normalized.includes(symbol))) {
    const sanitized = normalized.replace(/[·|•]/g, " ").replace(/\s+/g, " ").trim();
    if (!sanitized || sanitized.split(" ").length < 3) {
      return false;
    }
  }
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount < 3 && normalized.length < 20 && !looksLikeIdeaTag(normalized)) {
    return false;
  }
  return true;
}

const IGNORED_TAGS_FOR_TASK_TEXT = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "SVG",
  "BUTTON",
  "AUDIO",
  "VIDEO",
]);

function collectTaskTextCandidates(root, results = []) {
  if (!root) {
    return results;
  }

  if (root.nodeType === Node.TEXT_NODE) {
    const text = normalizeTaskText(root.textContent);
    if (text) {
      results.push({ text, element: root.parentElement });
    }
    return results;
  }

  if (root.nodeType !== Node.ELEMENT_NODE) {
    return results;
  }

  const element = root;
  if (IGNORED_TAGS_FOR_TASK_TEXT.has(element.tagName)) {
    return results;
  }

  for (const child of element.childNodes) {
    collectTaskTextCandidates(child, results);
  }

  return results;
}

function scoreTaskText(text, element) {
  let score = text.length;
  const wordCount = text.split(/\s+/).length;
  score += wordCount * 2;

  if (/[.?!]$/.test(text)) {
    score += 5;
  }

  if (/^[A-Z0-9\s.,!?'-]+$/.test(text) && /[A-Z]/.test(text) && !/[a-z]/.test(text)) {
    score -= 10;
  }

  if (/\bworking on your task\b/i.test(text)) {
    score -= 100;
  }

  if (/\bjust now\b/i.test(text)) {
    score -= 60;
  }

  if (text.includes("·") || text.includes("•") || text.includes("|")) {
    score -= 15;
  }

  const tagName = element?.tagName ?? "";
  if (tagName === "P" || tagName === "DIV") {
    score += 8;
  } else if (tagName && tagName.startsWith("H")) {
    score += 4;
  }

  if (element?.closest?.("[data-testid*='task-text' i]")) {
    score += 10;
  }

  return score;
}

function extractTaskName(container, link) {
  if (!container) {
    const fallback = normalizeTaskText(link?.textContent);
    return fallback || null;
  }

  let preferredCandidate = null;
  for (const selector of PREFERRED_TASK_TEXT_SELECTORS) {
    const preferred = container.querySelector(selector);
    const text = normalizeTaskText(preferred?.textContent);
    if (isMeaningfulTaskText(text)) {
      preferredCandidate = { text, element: preferred };
      break;
    }
  }

  const textCandidates = collectTaskTextCandidates(container);
  if (preferredCandidate) {
    textCandidates.unshift(preferredCandidate);
  }

  let bestMainCandidate = null;
  let bestMainScore = -Infinity;
  let bestTagCandidate = null;
  let bestTagScore = -Infinity;
  const seen = new Set();

  for (const candidate of textCandidates) {
    if (!candidate?.text) {
      continue;
    }
    if (seen.has(candidate.text)) {
      continue;
    }
    seen.add(candidate.text);

    const text = candidate.text;
    const isTag = looksLikeIdeaTag(text);
    if (!isTag && !isMeaningfulTaskText(text)) {
      continue;
    }

    const score = scoreTaskText(text, candidate.element);

    if (isTag && score > bestTagScore) {
      bestTagScore = score;
      bestTagCandidate = text;
    }

    if (score > bestMainScore) {
      bestMainScore = score;
      bestMainCandidate = text;
    }
  }

  if (bestMainCandidate) {
    if (
      bestTagCandidate &&
      bestTagCandidate !== bestMainCandidate &&
      !bestMainCandidate.toLowerCase().includes(bestTagCandidate.toLowerCase())
    ) {
      return `${bestMainCandidate} · ${bestTagCandidate}`;
    }
    return bestMainCandidate;
  }

  const fallbackCandidate =
    container.querySelector("h1, h2, h3, h4, [data-testid*='title' i], [role='heading'], strong") ??
    link;
  const fallbackText = normalizeTaskText(
    fallbackCandidate?.textContent ?? link?.textContent ?? container?.textContent,
  );

  if (fallbackText) {
    if (
      bestTagCandidate &&
      bestTagCandidate !== fallbackText &&
      !fallbackText.toLowerCase().includes(bestTagCandidate.toLowerCase())
    ) {
      return `${fallbackText} · ${bestTagCandidate}`;
    }
    return fallbackText;
  }

  return bestTagCandidate || null;
}

function extractConversationTaskName() {
  const collected = new Set();

  for (const selector of CONVERSATION_TASK_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (!element || collected.has(element)) {
        continue;
      }
      collected.add(element);
      const text = extractTaskName(element, null);
      if (!isMeaningfulTaskText(text)) {
        continue;
      }
      if (/\bwhat should we code next\b/i.test(text)) {
        continue;
      }
      return text;
    }
  }

  return null;
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

function notifyTaskUpdate(task) {
  if (!runtime?.sendMessage) {
    return;
  }
  try {
    const payload = { ...task };
    const result = runtime.sendMessage({
      type: "square-status-updated",
      task: payload,
    });
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    console.warn("codex-autorun: failed to update task info", error);
  }
}

function updateCurrentTaskNameFromConversation() {
  const currentTaskId = extractTaskId(window.location.href);
  if (!currentTaskId) {
    return;
  }

  const conversationName = extractConversationTaskName();
  if (!conversationName) {
    return;
  }

  const normalizedName = normalizeTaskText(conversationName);
  if (!normalizedName) {
    return;
  }

  let limitedName = normalizedName;
  if (limitedName.length > MAX_TASK_NAME_LENGTH) {
    limitedName = `${limitedName.slice(0, MAX_TASK_NAME_LENGTH - 1).trim()}…`;
  }

  const previousName = knownTaskNames.get(currentTaskId);
  if (previousName && previousName === limitedName) {
    return;
  }

  rememberTaskName(currentTaskId, limitedName);

  const tracked = trackedTasks.get(currentTaskId);
  if (tracked) {
    tracked.name = limitedName;
  }

  const updatePayload = { id: currentTaskId, name: limitedName };
  if (tracked?.url) {
    updatePayload.url = tracked.url;
  }
  if (tracked?.startedAt) {
    updatePayload.startedAt = tracked.startedAt;
  }
  if (tracked?.status) {
    updatePayload.status = tracked.status;
  }

  notifyTaskUpdate(updatePayload);
}

function scanForTasks() {
  const now = Date.now();
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
      pendingNameRefreshes.delete(taskId);
      if (!trackedTasks.has(taskId)) {
        const name = extractTaskName(container, link) ?? `Task ${taskId}`;
        rememberTaskName(taskId, name);
        const storedName = knownTaskNames.get(taskId) ?? name;
        const url = extractTaskUrl(link);
        const startedAt = new Date().toISOString();
        const task = {
          name: storedName,
          url,
          startedAt,
          status: "working",
          lastSeenAt: now,
          missingSince: null,
        };
        trackedTasks.set(taskId, task);
        notifyBackground({ id: taskId, ...task });
      } else {
        const tracked = trackedTasks.get(taskId);
        if (tracked) {
          tracked.lastSeenAt = now;
          tracked.missingSince = null;
        }
        let updated = false;

        const extractedName = extractTaskName(container, link);
        if (extractedName) {
          rememberTaskName(taskId, extractedName);
          const storedName = knownTaskNames.get(taskId) ?? extractedName;
          if (storedName && storedName !== tracked?.name) {
            if (tracked) {
              tracked.name = storedName;
            }
            updated = true;
          }
        }

        const url = extractTaskUrl(link);
        if (url && tracked && url !== tracked.url) {
          tracked.url = url;
          updated = true;
        }

        if (updated && tracked) {
          const updatePayload = {
            id: taskId,
            status: tracked.status ?? "working",
          };
          if (tracked.name) {
            updatePayload.name = tracked.name;
          }
          if (tracked.url) {
            updatePayload.url = tracked.url;
          }
          if (tracked.startedAt) {
            updatePayload.startedAt = tracked.startedAt;
          }
          notifyTaskUpdate(updatePayload);
          if (!shouldScheduleNameRefresh(updatePayload.name, taskId)) {
            pendingNameRefreshes.delete(taskId);
          }
        }
      }
    } else if (trackedTasks.has(taskId)) {
      const tracked = trackedTasks.get(taskId);
      trackedTasks.delete(taskId);
      if (tracked?.name) {
        rememberTaskName(taskId, tracked.name);
      }
      const completedAt = new Date().toISOString();
      const readyPayload = {
        id: taskId,
        status: "ready",
        completedAt,
        name: tracked?.name,
        url: tracked?.url,
        startedAt: tracked?.startedAt,
      };
      notifyTaskReady(readyPayload);
      const knownName = knownTaskNames.get(taskId) ?? tracked?.name ?? null;
      if (shouldScheduleNameRefresh(knownName, taskId)) {
        scheduleNameRefresh(taskId, {
          name: knownName,
          url: readyPayload.url ?? extractTaskUrl(link),
          startedAt: readyPayload.startedAt,
          completedAt,
        });
      } else {
        pendingNameRefreshes.delete(taskId);
      }
    }

    let pendingRefresh = pendingNameRefreshes.get(taskId);

    if (!indicator && !trackedTasks.has(taskId) && !pendingRefresh) {
      const knownName = knownTaskNames.get(taskId);
      if (shouldScheduleNameRefresh(knownName, taskId)) {
        scheduleNameRefresh(taskId, {
          name: knownName,
          url: extractTaskUrl(link),
        });
        pendingRefresh = pendingNameRefreshes.get(taskId);
      }
    }

    if (pendingRefresh && now >= pendingRefresh.nextCheckAt) {
      const extractedName = extractTaskName(container, link);
      const candidates = [
        extractedName,
        knownTaskNames.get(taskId),
        pendingRefresh.lastKnownName,
      ];
      let resolvedName = null;

      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        if (!shouldScheduleNameRefresh(candidate, taskId)) {
          resolvedName = candidate;
          break;
        }
      }

      if (resolvedName) {
        rememberTaskName(taskId, resolvedName);
        const storedName = knownTaskNames.get(taskId);
        const updatePayload = {
          id: taskId,
          status: "ready",
        };
        if (storedName) {
          updatePayload.name = storedName;
        }
        const url = extractTaskUrl(link) ?? pendingRefresh.url;
        if (url) {
          updatePayload.url = url;
        }
        if (pendingRefresh.startedAt) {
          updatePayload.startedAt = pendingRefresh.startedAt;
        }
        if (pendingRefresh.completedAt) {
          updatePayload.completedAt = pendingRefresh.completedAt;
        }
        pendingNameRefreshes.delete(taskId);
        notifyTaskUpdate(updatePayload);
      } else {
        pendingRefresh.attempts = (pendingRefresh.attempts ?? 0) + 1;
        pendingRefresh.nextCheckAt = now + NAME_REFRESH_INTERVAL_MS;
        pendingRefresh.lastKnownName = extractedName ?? pendingRefresh.lastKnownName ?? null;
        const url = extractTaskUrl(link);
        if (url) {
          pendingRefresh.url = url;
        }
        pendingRefresh.missingCount = 0;
        if (pendingRefresh.attempts >= MAX_NAME_REFRESH_ATTEMPTS) {
          pendingNameRefreshes.delete(taskId);
        } else {
          pendingNameRefreshes.set(taskId, pendingRefresh);
        }
      }
    }
  }

  for (const trackedId of Array.from(trackedTasks.keys())) {
    if (seenIds.has(trackedId)) {
      continue;
    }

    const tracked = trackedTasks.get(trackedId);
    if (!tracked) {
      trackedTasks.delete(trackedId);
      continue;
    }

    if (tracked.status === "working") {
      const missingSince = tracked.missingSince ?? now;
      tracked.missingSince = missingSince;
      if (now - missingSince < WORKING_TASK_MISSING_GRACE_MS) {
        trackedTasks.set(trackedId, tracked);
        continue;
      }
    }

    trackedTasks.delete(trackedId);
    if (tracked?.name) {
      rememberTaskName(trackedId, tracked.name);
    }
    const completedAt = new Date().toISOString();
    const readyPayload = {
      id: trackedId,
      status: "ready",
      completedAt,
      name: tracked?.name,
      url: tracked?.url,
      startedAt: tracked?.startedAt,
    };
    notifyTaskReady(readyPayload);
    const knownName = knownTaskNames.get(trackedId) ?? tracked?.name ?? null;
    if (shouldScheduleNameRefresh(knownName, trackedId)) {
      scheduleNameRefresh(trackedId, {
        name: knownName,
        url: readyPayload.url,
        startedAt: readyPayload.startedAt,
        completedAt,
      });
    } else {
      pendingNameRefreshes.delete(trackedId);
    }
  }

  for (const [pendingId, refresh] of Array.from(pendingNameRefreshes.entries())) {
    if (seenIds.has(pendingId)) {
      refresh.missingCount = 0;
      continue;
    }
    const nextMissingCount = (refresh.missingCount ?? 0) + 1;
    if (nextMissingCount >= MAX_NAME_REFRESH_MISSES) {
      pendingNameRefreshes.delete(pendingId);
    } else {
      refresh.missingCount = nextMissingCount;
      pendingNameRefreshes.set(pendingId, refresh);
    }
  }

  updateCurrentTaskNameFromConversation();
}

function elementTextMatches(element, text) {
  if (!element || !text) {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.replace(/\s+/g, " ").trim().toLowerCase().includes(normalized)) {
    return true;
  }
  const title = element.getAttribute("title");
  if (title && title.replace(/\s+/g, " ").trim().toLowerCase().includes(normalized)) {
    return true;
  }
  const textContent = element.textContent;
  if (textContent && textContent.replace(/\s+/g, " ").trim().toLowerCase().includes(normalized)) {
    return true;
  }
  return false;
}

function isElementDisabled(element) {
  if (!element) {
    return true;
  }
  if (element.matches?.("button, [role='button']")) {
    if (element.disabled) {
      return true;
    }
    const ariaDisabled = element.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled.toLowerCase() === "true") {
      return true;
    }
  }
  return false;
}

function isElementVisible(element) {
  if (!element) {
    return false;
  }
  if (!(element instanceof Element)) {
    return false;
  }
  if (element instanceof HTMLElement && element.hidden) {
    return false;
  }
  if (element.closest?.('[aria-hidden="true"]')) {
    return false;
  }
  const style = window.getComputedStyle?.(element);
  if (style) {
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const opacity = parseFloat(style.opacity ?? "1");
    if (Number.isFinite(opacity) && opacity === 0) {
      return false;
    }
  }
  const rect = element.getBoundingClientRect?.();
  if (!rect) {
    return true;
  }
  return rect.width > 0 && rect.height > 0;
}

function findCreatePrButtonInRoot(root) {
  if (!root?.querySelectorAll) {
    return null;
  }

  const explicitSelectors = [
    "[data-testid*='create-pr' i]",
    "[id*='create-pr' i]",
    "button.create-pr",
    "button[data-variant*='create-pr' i]",
  ];

  for (const selector of explicitSelectors) {
    const candidate = root.querySelector(selector);
    if (candidate && isElementVisible(candidate)) {
      return candidate;
    }
  }

  const candidates = root.querySelectorAll("button, a, [role='button']");
  for (const candidate of candidates) {
    if (isElementVisible(candidate) && elementTextMatches(candidate, "create pr")) {
      return candidate;
    }
  }
  return null;
}

function findCreatePrButton() {
  const visitedRoots = new Set();

  const initial = findCreatePrButtonInRoot(document);
  if (initial) {
    return initial;
  }
  visitedRoots.add(document);

  const queue = [document];

  while (queue.length) {
    const root = queue.shift();
    if (!root?.querySelectorAll) {
      continue;
    }
    const elements = root.querySelectorAll("*");
    for (const element of elements) {
      const shadowRoot = element?.shadowRoot;
      if (shadowRoot && !visitedRoots.has(shadowRoot)) {
        visitedRoots.add(shadowRoot);
        const match = findCreatePrButtonInRoot(shadowRoot);
        if (match) {
          return match;
        }
        queue.push(shadowRoot);
      }
    }
  }

  return null;
}

function setupCreatePrAutoClick() {
  if (window.__codexCreatePrAutoclickInitialized) {
    return;
  }
  window.__codexCreatePrAutoclickInitialized = true;

  // Consult the user's auto-click preferences before wiring up the
  // auto-click logic. If the status "pr-created" is not enabled the
  // extension will not attempt to click the Create PR button.
  const storage =
    (typeof browser !== "undefined" && browser?.storage) ||
    (typeof chrome !== "undefined" && chrome?.storage);
  const AUTO_CLICK_STATUS_STORAGE_KEY = "codexAutoClickStatuses";
  const DEFAULT_AUTO_CLICK_STATUSES = ["ready", "pr-created", "pr-ready"];
  const applyAutoClick = (enabled) => {
    if (!enabled) {
      return; // Do nothing if auto-click is disabled for pr-created
    }
    let attempts = 0;
    let clicked = false;
    let intervalId = null;
    let observer;
    const cleanup = () => {
      if (observer) {
        observer.disconnect();
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const attemptClick = () => {
      if (clicked) {
        return;
      }
      attempts += 1;
      const button = findCreatePrButton();
      if (!button) {
        if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
          cleanup();
        }
        return;
      }
      if (isElementDisabled(button)) {
        if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
          cleanup();
        }
        return;
      }
      try {
        button.click();
        console.log("codex-autorun: auto-clicked Create PR button.");
        clicked = true;
        cleanup();
      } catch (error) {
        console.warn("codex-autorun: failed to auto-click Create PR", error);
        if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
          cleanup();
        }
      }
    };
    observer = new MutationObserver(() => {
      attemptClick();
    });
    intervalId = window.setInterval(() => {
      attemptClick();
      if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
        cleanup();
      }
    }, AUTO_CLICK_INTERVAL_MS);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attemptClick, {
        once: true,
      });
    }
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    attemptClick();
  };
  if (!storage?.local) {
    // If storage is unavailable assume defaults.
    applyAutoClick(DEFAULT_AUTO_CLICK_STATUSES.includes("pr-created"));
    return;
  }
  try {
    const result = storage.local.get(AUTO_CLICK_STATUS_STORAGE_KEY, (data) => {
      const runtimeError =
        typeof chrome !== "undefined" && chrome?.runtime?.lastError
          ? chrome.runtime.lastError
          : null;
      if (runtimeError) {
        console.error("codex-autorun: storage retrieval error", runtimeError);
        applyAutoClick(DEFAULT_AUTO_CLICK_STATUSES.includes("pr-created"));
        return;
      }
      const stored = data?.[AUTO_CLICK_STATUS_STORAGE_KEY];
      let enabled;
      if (Array.isArray(stored)) {
        const normalized = stored.map((s) => String(s).trim().toLowerCase());
        enabled = normalized.includes("pr-created");
      } else {
        enabled = DEFAULT_AUTO_CLICK_STATUSES.includes("pr-created");
      }
      applyAutoClick(enabled);
    });
    // Note: result may be a Promise in some runtimes; ignore it.
  } catch (error) {
    console.error("codex-autorun: unable to read auto-click preferences", error);
    applyAutoClick(DEFAULT_AUTO_CLICK_STATUSES.includes("pr-created"));
  }
}

if (!window.__codexSquareWatcherInitialized) {
  window.__codexSquareWatcherInitialized = true;
  scanForTasks();
  setInterval(scanForTasks, 3000);
}

setupCreatePrAutoClick();

// Automatically click the "View PR" button when a pull request is ready
// and the user has enabled auto-click for the "pr-ready" status. This
// function mirrors setupCreatePrAutoClick() but targets the button or
// link that opens the created pull request.
function setupViewPrAutoClick() {
  if (window.__codexViewPrAutoclickInitialized) {
    return;
  }
  window.__codexViewPrAutoclickInitialized = true;

  const storage =
    (typeof browser !== "undefined" && browser?.storage) ||
    (typeof chrome !== "undefined" && chrome?.storage);
  const AUTO_CLICK_STATUS_STORAGE_KEY = "codexAutoClickStatuses";
  const DEFAULT_AUTO_CLICK_STATUSES = ["ready", "pr-created", "pr-ready"];

  // Storage key and default for the delay before auto-clicking the
  // "View PR" button. This mirrors the key defined in the options
  // script. When the delay is zero the button is clicked
  // immediately when found. Values above 60 seconds are clamped to 60
  // seconds. The delay is read once on initialisation and cached for
  // the lifetime of the page.
  const PR_READY_AUTO_CLICK_DELAY_KEY = "codexPrReadyAutoClickDelayMs";
  const DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS = 3000;
  let prReadyAutoClickDelayMs = DEFAULT_PR_READY_AUTO_CLICK_DELAY_MS;

  // Load the delay from storage. If unavailable or invalid, fall back to
  // the default. This runs asynchronously but does not block auto-click
  // registration. Once retrieved the value is stored in
  // prReadyAutoClickDelayMs for later use.
  if (storage?.local) {
    try {
      storage.local.get(PR_READY_AUTO_CLICK_DELAY_KEY, (data) => {
        const runtimeError =
          typeof chrome !== "undefined" && chrome?.runtime?.lastError
            ? chrome.runtime.lastError
            : null;
        if (runtimeError) {
          console.error(
            "codex-autorun: storage retrieval error for pr-ready delay",
            runtimeError,
          );
          return;
        }
        const raw = data?.[PR_READY_AUTO_CLICK_DELAY_KEY];
        const value = Number(raw);
        if (Number.isFinite(value)) {
          const clamped = Math.max(0, Math.min(60000, Math.round(value)));
          prReadyAutoClickDelayMs = clamped;
        }
      });
    } catch (error) {
      console.error("codex-autorun: unable to read pr-ready delay", error);
    }
  }

  /**
   * Find the "View PR" button or link on the page. Matches elements
   * containing the text "View PR" case‑insensitively. Returns null if
   * none found.
   */
  function findViewPrButton() {
    const candidates = document.querySelectorAll("a, button");
    for (const el of candidates) {
      if (!el || typeof el.textContent !== "string") {
        continue;
      }
      const text = el.textContent.trim().toLowerCase();
      if (text.includes("view pr")) {
        return el;
      }
    }
    return null;
  }

  const applyAutoClick = (enabled) => {
    if (!enabled) {
      return; // Do nothing if auto-click is disabled for pr-ready
    }
    let attempts = 0;
    let clicked = false;
    let intervalId = null;
    let observer;
    let clickTimeoutId = null;
    const cleanup = () => {
      if (observer) {
        observer.disconnect();
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (clickTimeoutId !== null) {
        clearTimeout(clickTimeoutId);
        clickTimeoutId = null;
      }
    };
    const attemptClick = () => {
      if (clicked) {
        return;
      }
      attempts += 1;
      const button = findViewPrButton();
      if (!button) {
        if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
          cleanup();
        }
        return;
      }
      if (typeof button.click !== "function") {
        if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
          cleanup();
        }
        return;
      }
      // Schedule the click after the configured delay. Only schedule one
      // timeout and avoid re-scheduling if it is already pending. If the
      // button disappears before the delay expires a later attempt will
      // schedule a new timeout when the button reappears.
      if (clickTimeoutId === null) {
        clickTimeoutId = window.setTimeout(() => {
          if (clicked) {
            return;
          }
          try {
            button.click();
            console.log(
              `codex-autorun: auto-clicked View PR button after ${prReadyAutoClickDelayMs} ms`,
            );
            clicked = true;
            cleanup();
          } catch (error) {
            console.warn(
              "codex-autorun: failed to auto-click View PR after delay",
              error,
            );
            // If the click fails we still mark the attempt as completed
            // and stop trying. The user can click manually.
            clicked = true;
            cleanup();
          }
        }, prReadyAutoClickDelayMs);
      }
    };
    observer = new MutationObserver(() => {
      attemptClick();
    });
    intervalId = window.setInterval(() => {
      attemptClick();
      if (attempts >= AUTO_CLICK_MAX_ATTEMPTS) {
        cleanup();
      }
    }, AUTO_CLICK_INTERVAL_MS);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attemptClick, {
        once: true,
      });
    }
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    attemptClick();
  };
  if (!storage?.local) {
    // If storage is unavailable assume defaults (auto-click disabled for pr-ready)
    applyAutoClick(DEFAULT_AUTO_CLICK_STATUSES.includes("pr-ready"));
    return;
  }
  try {
    storage.local.get(AUTO_CLICK_STATUS_STORAGE_KEY, (data) => {
      const runtimeError =
        typeof chrome !== "undefined" && chrome?.runtime?.lastError
          ? chrome.runtime.lastError
          : null;
      if (runtimeError) {
        console.error("codex-autorun: storage retrieval error", runtimeError);
        applyAutoClick(DEFAULT_AUTO_CLICK_STATUSES.includes("pr-ready"));
        return;
      }
      const stored = data?.[AUTO_CLICK_STATUS_STORAGE_KEY];
      let enabled;
      if (Array.isArray(stored)) {
        const normalized = stored.map((s) => String(s).trim().toLowerCase());
        enabled = normalized.includes("pr-ready");
      } else {
        enabled = DEFAULT_AUTO_CLICK_STATUSES.includes("pr-ready");
      }
      applyAutoClick(enabled);
    });
  } catch (error) {
    console.error("codex-autorun: unable to read auto-click preferences", error);
    applyAutoClick(DEFAULT_AUTO_CLICK_STATUSES.includes("pr-ready"));
  }
}

setupViewPrAutoClick();

function checkTaskStatus(taskId, hintedUrl) {
  if (!taskId) {
    return { found: false };
  }

  const normalizedTaskId = String(taskId).trim();
  const links = Array.from(document.querySelectorAll('a[href*="/codex/tasks/"]'));

  for (const link of links) {
    const href = link.getAttribute("href") || link.href;
    const extractedId = extractTaskId(href);
    if (!extractedId || extractedId !== normalizedTaskId) {
      continue;
    }

    if (hintedUrl) {
      try {
        const normalizedUrl = new URL(hintedUrl, window.location.origin).toString();
        const candidateUrl = extractTaskUrl(link);
        if (candidateUrl && candidateUrl !== normalizedUrl) {
          continue;
        }
      } catch (error) {
        // Ignore invalid URL hints and continue with detection.
      }
    }

    const container =
      link.closest('[data-testid*="task" i], article, li, section, div') ??
      link.parentElement ??
      link;
    const indicator = findIndicatorElement(container);
    const status = indicator ? "working" : "ready";
    const name = extractTaskName(container, link);
    if (name) {
      rememberTaskName(normalizedTaskId, name);
    }
    const storedName = knownTaskNames.get(normalizedTaskId) ?? name ?? null;
    const url = extractTaskUrl(link);

    const payload = {
      found: true,
      status,
      name: storedName,
      url,
    };

    if (status === "ready") {
      payload.completedAt = new Date().toISOString();
    }

    return payload;
  }

  const tracked = trackedTasks.get(normalizedTaskId);
  if (tracked) {
    return {
      found: true,
      status: tracked.status ?? "working",
      name: tracked.name ?? knownTaskNames.get(normalizedTaskId) ?? null,
      url: tracked.url ?? null,
    };
  }

  const storedName = knownTaskNames.get(normalizedTaskId) ?? null;
  return { found: false, name: storedName };
}

