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

test("mixed-version rollout retains the legacy server API", () => {
  for (const route of [
    'app.get("/dvla/vehicle"',
    'app.post("/auth/phone/start"',
    'app.post("/auth/phone/check"',
  ]) {
    assert.match(serverSource, new RegExp(route.replace(/[()/]/g, "\\$&")));
  }
});

test("5.0.5 server API is additive and keeps 5.0.4 as the default minimum", () => {
  assert.match(serverSource, /app\.get\("\/app-config"/);
  assert.match(serverSource, /app\.post\("\/auth\/employee-setup-lookup"/);
  assert.match(serverSource, /app\.post\("\/auth\/sync-employee-auth"/);
  assert.match(
    serverSource,
    /process\.env\.MIN_APP_VERSION \|\| "5\.0\.4"/
  );
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
