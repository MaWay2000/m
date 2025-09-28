import test from "node:test";
import assert from "node:assert";

const store = {};
const setCalls = [];

global.chrome = {
  runtime: {
    lastError: null,
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
  },
  storage: {
    local: {
      get(key, callback) {
        const value = Object.prototype.hasOwnProperty.call(store, key)
          ? store[key]
          : undefined;
        if (typeof callback === "function") {
          setImmediate(() => callback({ [key]: value }));
          return;
        }
        return Promise.resolve({ [key]: value });
      },
      set(payload, callback) {
        setCalls.push(payload);
        Object.assign(store, payload);
        if (typeof callback === "function") {
          setImmediate(() => callback());
          return;
        }
        return Promise.resolve();
      },
    },
  },
};

global.browser = undefined;

global.tabs = undefined;

global.console = console;

const backgroundModule = await import("../src/background.js");
const background = backgroundModule.default ?? backgroundModule;

const { updateHistory, HISTORY_KEY, CLOSED_TASKS_KEY } = background;

test("ready status update for unknown task does not create history entry", async () => {
  store[HISTORY_KEY] = [
    { id: "1", name: "Task 1", status: "working" },
    { id: "2", name: "Task 2", status: "working" },
    { id: "3", name: "Task 3", status: "working" },
  ];
  store[CLOSED_TASKS_KEY] = [];
  setCalls.length = 0;

  await updateHistory({ id: "999", status: "ready" });

  assert.strictEqual(
    setCalls.length,
    0,
    "No storage writes should occur for completed updates of unknown tasks",
  );
  assert.deepStrictEqual(
    store[HISTORY_KEY],
    [
      { id: "1", name: "Task 1", status: "working" },
      { id: "2", name: "Task 2", status: "working" },
      { id: "3", name: "Task 3", status: "working" },
    ],
    "Existing history should remain unchanged",
  );
});
