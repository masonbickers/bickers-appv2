import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareAppVersions,
  isAppUpdateRequired,
} from "../lib/appVersion.js";

const appConfig = JSON.parse(
  readFileSync(new URL("../app.json", import.meta.url), "utf8")
).expo;
const easConfig = JSON.parse(
  readFileSync(new URL("../eas.json", import.meta.url), "utf8")
);

test("release candidate uses a new app runtime", () => {
  assert.equal(appConfig.version, "5.0.5");
  assert.deepEqual(appConfig.runtimeVersion, { policy: "appVersion" });
});

test("minimum version keeps the previous release available during rollout", () => {
  const minimum = appConfig.extra.minSupportedAppVersion;
  assert.ok(compareAppVersions(minimum, appConfig.version) < 0);
  assert.equal(isAppUpdateRequired("5.0.4", minimum), false);
  assert.equal(isAppUpdateRequired("5.0.3", minimum), true);
});

test("Android SDK policy is consistent", () => {
  const nativeMinimum =
    appConfig.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties"
    )?.[1]?.android?.minSdkVersion;

  assert.equal(nativeMinimum, 24);
  assert.equal(appConfig.extra.minAndroidSdk, 24);
});

test("camera and audio remain blocked rather than requested", () => {
  const blocked = new Set(appConfig.android.blockedPermissions);
  const requested = new Set(appConfig.android.permissions);

  for (const permission of [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
  ]) {
    assert.equal(blocked.has(permission), true);
    assert.equal(requested.has(permission), false);
  }
});

test("production builds use remote auto-increment and production variables", () => {
  assert.equal(easConfig.cli.appVersionSource, "remote");
  assert.equal(easConfig.build.production.autoIncrement, true);
  assert.equal(easConfig.build.production.environment, "production");
  assert.equal(
    easConfig.build.production.env.EXPO_PUBLIC_APP_ENV,
    "production"
  );
});

test("internal candidates are production-equivalent and directly installable", () => {
  assert.equal(easConfig.build.internal.distribution, "internal");
  assert.equal(easConfig.build.internal.environment, "production");
  assert.equal(easConfig.build.internal.autoIncrement, true);
  assert.equal(
    easConfig.build.internal.env.EXPO_PUBLIC_APP_ENV,
    "production"
  );
  assert.equal(easConfig.build.internal.android.buildType, "apk");
});
