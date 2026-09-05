import assert from "node:assert/strict";
import test from "node:test";

import {
  legacyEmployeeSetupIsEnabled,
  resolveLegacyEmployeeSetupMode,
} from "../server/authRolloutConfig.js";

test("production requires an explicit valid legacy setup mode", () => {
  assert.throws(
    () => resolveLegacyEmployeeSetupMode({ nodeEnv: "production", value: "" }),
    /must be explicitly set/
  );
  assert.throws(
    () => resolveLegacyEmployeeSetupMode({ nodeEnv: "production", value: "maybe" }),
    /must be explicitly set/
  );
});

test("production accepts enabled and disabled modes", () => {
  assert.equal(
    resolveLegacyEmployeeSetupMode({ nodeEnv: "production", value: "enabled" }),
    "enabled"
  );
  assert.equal(
    resolveLegacyEmployeeSetupMode({ nodeEnv: "production", value: "disabled" }),
    "disabled"
  );
  assert.equal(
    legacyEmployeeSetupIsEnabled({ nodeEnv: "production", value: "enabled" }),
    true
  );
  assert.equal(
    legacyEmployeeSetupIsEnabled({ nodeEnv: "production", value: "disabled" }),
    false
  );
});

test("local development defaults to compatibility enabled", () => {
  assert.equal(
    resolveLegacyEmployeeSetupMode({ nodeEnv: "development", value: "" }),
    "enabled"
  );
});
