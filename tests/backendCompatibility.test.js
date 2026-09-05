import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serverSource = readFileSync(
  new URL("../server/index.js", import.meta.url),
  "utf8"
);
const storageRules = readFileSync(
  new URL("../storage.rules", import.meta.url),
  "utf8"
);
const authProviderSource = readFileSync(
  new URL("../providers/AuthProvider.tsx", import.meta.url),
  "utf8"
);
const authApiSource = readFileSync(
  new URL("../lib/authApi.js", import.meta.url),
  "utf8"
);
const loginSource = readFileSync(
  new URL("../app/(auth)/login.jsx", import.meta.url),
  "utf8"
);

test("mixed-version rollout retains the legacy server API", () => {
  for (const route of [
    'app.get("/dvla/vehicle"',
    'app.post("/auth/phone/start"',
    'app.post("/auth/phone/check"',
  ]) {
    assert.match(serverSource, new RegExp(route.replace(/[()/]/g, "\\$&")));
  }
});

test("mixed-version server API keeps 5.0.4 as the pre-cutover default minimum", () => {
  assert.match(serverSource, /app\.get\("\/app-config"/);
  assert.match(serverSource, /app\.post\("\/auth\/employee-setup-lookup"/);
  assert.match(serverSource, /app\.post\("\/auth\/sync-employee-auth"/);
  assert.match(
    serverSource,
    /process\.env\.MIN_APP_VERSION \|\| "5\.0\.4"/
  );
  assert.match(serverSource, /legacyEmployeeSetupEnabled/);
});

test("legacy employee setup is controlled by the explicit rollout mode", () => {
  assert.match(serverSource, /LEGACY_EMPLOYEE_SETUP_MODE/);
  assert.match(serverSource, /LEGACY_EMPLOYEE_SETUP_ENABLED/);
  assert.match(
    serverSource,
    /employee-setup-lookup[\s\S]{0,220}!LEGACY_EMPLOYEE_SETUP_ENABLED[\s\S]{0,220}status\(410\)/
  );
  assert.match(
    serverSource,
    /sync-employee-auth[\s\S]*approvedIdToken = bearerToken\(req\)[\s\S]*!LEGACY_EMPLOYEE_SETUP_ENABLED/
  );
});

test("new mobile login requires an approved Firebase password identity", () => {
  assert.match(authProviderSource, /user\.isAnonymous !== true/);
  assert.match(authProviderSource, /mobileAccessStatus === "active"/);
  assert.doesNotMatch(authApiSource, /\/auth\/employee-setup-lookup/);
  assert.match(authApiSource, /Authorization: `Bearer \$\{idToken\}`/);
  assert.match(loginSource, /signInWithEmailAndPassword/);
  assert.doesNotMatch(loginSource, /signInAnonymously|createUserWithEmailAndPassword/);
  assert.doesNotMatch(loginSource, /Employee code/);
  assert.match(serverSource, /verifyIdToken\(idToken, true\)/);
  assert.match(serverSource, /sign_in_provider !== "password"/);
  assert.match(serverSource, /findEmployeeForApprovedUid\(decoded\.uid\)/);
  assert.match(serverSource, /mobileAccessStatus: "active"/);
});

test("mobile-only data routes reject revoked, invited, and obsolete sessions", () => {
  assert.match(serverSource, /verifyIdToken\(idToken, true\)/);
  assert.match(serverSource, /userData\.mobileAccessStatus !== "active"/);
  assert.match(serverSource, /decodedUser\.mobileAccessStatus !== "active"/);
  assert.match(serverSource, /employee\?\.mobileAccess\?\.status !== "active"/);
  assert.match(serverSource, /isAnonymous && !LEGACY_EMPLOYEE_SETUP_ENABLED/);
});

test("login inputs remain vertically centred", () => {
  assert.match(loginSource, /paddingVertical:\s*0/);
  assert.match(loginSource, /textAlignVertical:\s*"center"/);
});

test("Firebase writes used by auth migration remain merge operations", () => {
  const mergeWrites = serverSource.match(/\{ merge: true \}/g) || [];
  assert.ok(
    mergeWrites.length >= 2,
    "employee and user migration writes must preserve existing fields"
  );
});

test("storage access remains available for existing signed-in clients", () => {
  assert.match(storageRules, /function signedIn\(\)/);
  assert.match(storageRules, /match \/vehicle-checks\//);
  assert.match(storageRules, /match \/recces\//);
  assert.match(storageRules, /match \/serviceRecords\//);
  assert.match(storageRules, /match \/defectReports\//);
  assert.match(storageRules, /match \/equipmentInspections\//);
});
