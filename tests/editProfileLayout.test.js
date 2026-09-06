import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileSource = readFileSync(
  new URL("../app/(protected)/edit-profile.js", import.meta.url),
  "utf8"
);
const firestoreRules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8"
);

test("edit profile distinguishes locked account data from editable contact data", () => {
  assert.match(profileSource, /styles\.accountCard/);
  assert.match(profileSource, /Managed by your administrator/);
  assert.doesNotMatch(profileSource, /editable=\{false\}/);
  assert.match(profileSource, /textContentType:\s*"telephoneNumber"/);
  assert.match(profileSource, /Used by the crew directory and booking team/);
});

test("profile saves only when the contact number changes", () => {
  assert.match(profileSource, /const hasChanges = phone\.trim\(\) !== initialPhone\.trim\(\)/);
  assert.match(profileSource, /disabled=\{!hasChanges \|\| saving\}/);
  assert.match(profileSource, /phone: phone\.trim\(\) \|\| ""/);
  assert.match(profileSource, /mobile: phone\.trim\(\) \|\| ""/);
});

test("logout is separated and requires confirmation", () => {
  assert.match(profileSource, /const confirmLogout = \(\) =>/);
  assert.match(profileSource, /Alert\.alert\("Log out\?"/);
  assert.match(profileSource, /onPress=\{confirmLogout\}/);
});

test("employees can update only their own contact and avatar fields", () => {
  assert.match(firestoreRules, /function ownEmployeeProfileFieldsChanged\(\)/);
  assert.match(firestoreRules, /"phone",\s*"mobile",\s*"avatarUrl",\s*"photoURL"/);
  const employeeRules = firestoreRules.match(/match \/employees\/\{employeeId\} \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(employeeRules, /isOwnEmployeeDoc\(\)/);
  assert.match(employeeRules, /keepsOwnEmployeeIdentity\(\)/);
  assert.match(employeeRules, /ownEmployeeProfileFieldsChanged\(\)/);
});
