import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("../app/(protected)/settings.js", import.meta.url),
  "utf8"
);

test("completed setup tasks and item-count badges do not clutter settings", () => {
  assert.match(settingsSource, /const incompleteSetupItems = accountSetupItems\.filter/);
  assert.match(settingsSource, /incompleteSetupItems\.length > 0/);
  assert.doesNotMatch(settingsSource, /sectionCountPill/);
  assert.doesNotMatch(settingsSource, /Account Setup/);
});

test("notification controls use real device permission and saved preferences", () => {
  assert.match(settingsSource, /group: "Notifications"/);
  assert.match(settingsSource, /type: "notification-permission"/);
  assert.match(settingsSource, /maintenanceReminderEnabled && securityStatus\.notificationsGranted/);
  assert.doesNotMatch(settingsSource, /notificationsEnabled/);
  assert.doesNotMatch(settingsSource, /type: "toggle"/);
});

test("appearance is a dedicated compact settings group", () => {
  assert.match(settingsSource, /group: "Appearance"/);
  assert.match(settingsSource, /label: "Theme"/);
  assert.match(settingsSource, /styles\.controlItemRow/);
});
