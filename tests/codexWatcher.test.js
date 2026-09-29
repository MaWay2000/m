const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/codexWatcher.js", "utf8");
const initialization = source.indexOf(
  "if (!window.__codexSquareWatcherInitialized)",
);
assert.notEqual(initialization, -1, "watcher initialization marker must exist");

const userMessage = {
  nodeType: 1,
  tagName: "DIV",
  childNodes: [
    {
      nodeType: 3,
      textContent: "Write unit tests for the new feature",
      parentElement: null,
    },
  ],
  querySelector() {
    return null;
  },
};
userMessage.childNodes[0].parentElement = userMessage;

function runScenario({ pageText, activeControl = false, bodyStatus = "" }) {
  const messages = [];
  const body = {
    nodeType: 1,
    tagName: "BODY",
    textContent: pageText,
    querySelectorAll() {
      return [];
    },
    getAttribute(attribute) {
      return attribute === "data-status" ? bodyStatus : null;
    },
    dataset: bodyStatus ? { status: bodyStatus } : {},
  };
  const document = {
    body,
    title: "Write unit tests for new feature",
    querySelector(selector) {
      if (selector.includes("aria-busy") && activeControl) return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/codex/tasks/"]') return [];
      if (selector.includes("user-message")) return [userMessage];
      return [];
    },
  };
  const context = {
    browser: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve();
        },
      },
    },
    chrome: undefined,
    document,
    window: {
      location: {
        href: "https://chatgpt.com/codex/tasks/task_123",
        origin: "https://chatgpt.com",
      },
    },
    URL,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    console,
  };

  vm.runInNewContext(
    `${source.slice(0, initialization)}\nscanForTasks(); scanForTasks();`,
    context,
  );
  return messages;
}

const messages = runScenario({
  pageText:
    "Worked for 1m 5s Test received successfully. No code changes were requested.",
});

// Repeated polling must not produce duplicate history messages.
assert.equal(messages.length, 1);
assert.equal(messages[0].type, "square-detected");
assert.equal(messages[0].task.id, "task_123");
assert.equal(messages[0].task.status, "ready");
assert.equal(messages[0].task.name, "Write unit tests for the new feature");
assert.equal(
  messages[0].task.url,
  "https://chatgpt.com/codex/tasks/task_123",
);

assert.equal(
  runScenario({ pageText: "Preparing the workspace", activeControl: true })[0]
    .task.status,
  "working",
  "an active task control marks a conversation as working",
);
assert.equal(
  runScenario({
    pageText: "Working on your task",
    activeControl: true,
    bodyStatus: "Task ready to view",
  })[0].task.status,
  "ready",
  "an explicit page status takes priority over working signals",
);

console.log("codexWatcher current-page regression test passed");
