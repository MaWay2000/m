import test from "node:test";
import assert from "node:assert";

import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.js";

test("toolbar icon visibility defaults to enabled", () => {
  const normalized = normalizeSettings();
  assert.strictEqual(
    normalized.toolbarIcon.visible,
    true,
    "Toolbar icon should be visible by default",
  );
  assert.strictEqual(
    DEFAULT_SETTINGS.toolbarIcon.visible,
    true,
    "Default settings should enable the toolbar icon",
  );
});

test("toolbar icon visibility respects stored preference", () => {
  const normalized = normalizeSettings({
    toolbarIcon: { visible: false },
  });
  assert.strictEqual(
    normalized.toolbarIcon.visible,
    false,
    "Toolbar icon preference should honor stored visibility",
  );
});

test("toolbar icon legacy flat flag is supported", () => {
  const normalized = normalizeSettings({ showToolbarIcon: false });
  assert.strictEqual(
    normalized.toolbarIcon.visible,
    false,
    "Legacy toolbar visibility flag should be respected",
  );
});
