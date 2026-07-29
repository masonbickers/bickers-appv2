import assert from "node:assert/strict";
import test from "node:test";

import {
  compareAppVersions,
  isAppUpdateRequired,
} from "../lib/appVersion.js";

test("app versions compare numeric segments", () => {
  assert.equal(compareAppVersions("5.0.4", "5.0.4"), 0);
  assert.ok(compareAppVersions("5.0.3", "5.0.4") < 0);
  assert.ok(compareAppVersions("5.1.0", "5.0.99") > 0);
});

test("app versions tolerate missing and uneven segments", () => {
  assert.equal(compareAppVersions("5.0", "5.0.0"), 0);
  assert.ok(compareAppVersions(undefined, "1.0.0") < 0);
  assert.ok(compareAppVersions("5.0.4.1", "5.0.4") > 0);
});

test("update enforcement is disabled without a minimum version", () => {
  assert.equal(isAppUpdateRequired("5.0.4", ""), false);
  assert.equal(isAppUpdateRequired("5.0.4", null), false);
});

test("update enforcement blocks only versions below the minimum", () => {
  assert.equal(isAppUpdateRequired("5.0.3", "5.0.4"), true);
  assert.equal(isAppUpdateRequired("5.0.4", "5.0.4"), false);
  assert.equal(isAppUpdateRequired("5.0.5", "5.0.4"), false);
});
