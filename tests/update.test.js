const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/background.js", "utf8");
const boundary = source.indexOf('const HISTORY_KEY = "codexTaskHistory";');
assert.notEqual(
  boundary,
  -1,
  "background update helpers must precede history setup",
);

const updateChecks = [];
const context = {
  browser: {
    runtime: {
      getManifest: () => ({ version: "1.2.0" }),
      onUpdateAvailable: { addListener: () => {} },
      reload: () => {},
      requestUpdateCheck: async () => {
        updateChecks.push(true);
        return { status: "update_available", version: "1.3.0" };
      },
    },
    storage: {},
    tabs: {},
    notifications: {},
  },
  chrome: undefined,
  fetch: async () => ({
    ok: true,
    json: async () => ({ version: "1.3.0" }),
  }),
  console,
};

vm.runInNewContext(
  `${source.slice(0, boundary)}\nthis.helpers = { compareVersions, getGitHubUpdate, requestBrowserUpdateCheck, installExtensionUpdate };`,
  context,
);

assert.equal(context.helpers.compareVersions("1.2.0", "1.1.46"), 1);
assert.equal(context.helpers.compareVersions("1.2", "1.2.0"), 0);
assert.equal(context.helpers.compareVersions("1.1.9", "1.2.0"), -1);

(async () => {
  const update = await context.helpers.getGitHubUpdate();
  assert.equal(update.available, true);
  assert.equal(update.latestVersion, "1.3.0");

  const result = await context.helpers.requestBrowserUpdateCheck();
  assert.equal(result.status, "update_available");
  assert.equal(updateChecks.length, 1);

  context.browser.runtime.requestUpdateCheck = undefined;
  const fallback = await context.helpers.installExtensionUpdate(update);
  assert.equal(fallback.type, "automatic-update-unavailable");
  assert.match(fallback.message, /signed\/store release/);
  console.log("extension update regression test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
