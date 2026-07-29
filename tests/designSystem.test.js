import assert from "node:assert/strict";
import test from "node:test";

import { getResponsiveLayout } from "../lib/design/responsive.js";
import {
  createActionLock,
  getStatusColors,
  normalizeStatusTone,
} from "../lib/design/semantics.js";

test("responsive layout uses phone, tablet, and wide gutters", () => {
  assert.equal(getResponsiveLayout(390).columns, 1);
  assert.equal(getResponsiveLayout(390).pageGutter, 16);
  assert.equal(getResponsiveLayout(800).columns, 2);
  assert.equal(getResponsiveLayout(800).pageGutter, 24);
  assert.equal(getResponsiveLayout(1400).pageGutter, 32);
});

test("operational status aliases map to stable semantic tones", () => {
  assert.equal(normalizeStatusTone("1st Pencil"), "firstPencil");
  assert.equal(normalizeStatusTone("Approved"), "approved");
  assert.equal(normalizeStatusTone("unknown-value"), "neutral");
});

test("status colours retain labels across light and dark schemes", () => {
  const light = getStatusColors("maintenance", "light");
  const dark = getStatusColors("maintenance", "dark");
  assert.equal(light.tone, "maintenance");
  assert.equal(dark.tone, "maintenance");
  assert.notEqual(light.background, dark.background);
  assert.ok(light.foreground && light.border && dark.foreground && dark.border);
});

test("action lock prevents simultaneous submissions and unlocks afterwards", async () => {
  const run = createActionLock();
  let calls = 0;
  let release;
  const pending = run(
    () =>
      new Promise((resolve) => {
        calls += 1;
        release = resolve;
      })
  );
  assert.equal(await run(async () => { calls += 1; }), false);
  assert.equal(calls, 1);
  release();
  assert.equal(await pending, true);
  assert.equal(await run(async () => { calls += 1; }), true);
  assert.equal(calls, 2);
});
