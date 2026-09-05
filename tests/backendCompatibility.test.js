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
const firestoreRules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8"
);
const expensesSource = readFileSync(
  new URL("../app/(protected)/expenses.js", import.meta.url),
  "utf8"
);
const receiptsSource = readFileSync(
  new URL("../app/(protected)/receipts.js", import.meta.url),
  "utf8"
);
const footerSource = readFileSync(
  new URL("../components/app/footer.js", import.meta.url),
  "utf8"
);
const profileSource = readFileSync(
  new URL("../app/(protected)/me.js", import.meta.url),
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
const employeeNotificationsSource = readFileSync(
  new URL("../hooks/useEmployeeNotifications.js", import.meta.url),
  "utf8"
);
const logoutSources = [
  "../app/(protected)/screens/homescreen.js",
  "../app/(protected)/edit-profile.js",
  "../app/(protected)/service/settings.js",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

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
  assert.match(serverSource, /app\.post\("\/device-tokens"/);
  assert.match(serverSource, /app\.get\("\/employee-notifications"/);
  assert.match(serverSource, /collection\("deviceTokens"\)/);
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

test("employee notification listeners use the identity authorised by Firestore rules", () => {
  assert.match(
    employeeNotificationsSource,
    /collection\(db, "employeeNotifications"\)[\s\S]*where\("employeeId", "==", employeeId\)/
  );
  assert.doesNotMatch(
    employeeNotificationsSource,
    /collection\(db, "employeeNotifications"\)[\s\S]{0,160}where\("employeeCode"/
  );
  assert.match(
    firestoreRules,
    /match \/employeeNotifications\/\{notificationId\}[\s\S]*resource\.data\.employeeId/
  );
});

test("Firebase writes used by auth migration remain merge operations", () => {
  const mergeWrites = serverSource.match(/\{ merge: true \}/g) || [];
  assert.ok(
    mergeWrites.length >= 2,
    "employee and user migration writes must preserve existing fields"
  );
});

test("mobile login requires an admin-approved Firebase password account", () => {
  assert.match(authProviderSource, /user\.isAnonymous !== true/);
  assert.match(authProviderSource, /mobileAccessStatus === "active"/);
  assert.doesNotMatch(authApiSource, /\/auth\/employee-setup-lookup/);
  assert.match(authApiSource, /Authorization: `Bearer \$\{idToken\}`/);
  assert.doesNotMatch(loginSource, /signInAnonymously/);
  assert.doesNotMatch(loginSource, /collection\(db, "employees"\)/);
  assert.match(loginSource, /signInWithEmailAndPassword/);
  assert.doesNotMatch(loginSource, /createUserWithEmailAndPassword|signInWithCustomToken/);
  assert.doesNotMatch(loginSource, /Employee code/);
  assert.match(serverSource, /verifyIdToken\(idToken, true\)/);
  assert.match(serverSource, /sign_in_provider !== "password"/);
  assert.match(serverSource, /findEmployeeForApprovedUid\(decoded\.uid\)/);
  assert.match(serverSource, /mobileAccessStatus: "active"/);
  assert.doesNotMatch(authApiSource, /body:\s*JSON\.stringify\(\{\s*idToken/);
});

test("mobile-only data routes reject revoked, invited, and obsolete sessions", () => {
  assert.match(serverSource, /verifyIdToken\(idToken, true\)/);
  assert.match(serverSource, /userData\.mobileAccessStatus !== "active"/);
  assert.match(serverSource, /decodedUser\.mobileAccessStatus !== "active"/);
  assert.match(serverSource, /employee\?\.mobileAccess\?\.status !== "active"/);
  assert.match(serverSource, /isAnonymous && !LEGACY_EMPLOYEE_SETUP_ENABLED/);
});

test("work email input follows the keyboard caps state without rewriting letters", () => {
  assert.doesNotMatch(loginSource, /correctInvertedSimulatorCaps/);
  assert.doesNotMatch(loginSource, /Device\.isDevice/);
  assert.match(loginSource, /onChangeText=\{setEmployeeEmail\}/);
  assert.doesNotMatch(loginSource, /setEmployeeEmail\(String\(value \|\| ""\)\.toLowerCase\(\)\)/);
  assert.match(loginSource, /autoCapitalize:\s*"none"/);
  assert.match(loginSource, /autoCorrect:\s*false/);
});

test("logout cannot restore the employee session before Firebase signs out", () => {
  assert.match(authProviderSource, /loadSession\(auth\.currentUser\)/);
  assert.doesNotMatch(authProviderSource, /auth\.currentUser \|\| user/);
  for (const source of logoutSources) {
    const logoutBlock = source.slice(source.indexOf("const handleLogout"));
    assert.match(logoutBlock, /"employeeUserCode"/);
    assert.match(logoutBlock, /"userCode"/);
    assert.ok(logoutBlock.indexOf("signOut(auth)") < logoutBlock.indexOf("reloadSession()"));
  }
});

test("storage access remains available for existing signed-in clients", () => {
  assert.match(storageRules, /function isSignedIn\(\)/);
  assert.match(storageRules, /match \/vehicle-checks\//);
  assert.match(storageRules, /match \/recces\//);
  assert.match(storageRules, /match \/serviceRecords\//);
  assert.match(storageRules, /match \/defectReports\//);
  assert.match(storageRules, /match \/equipmentInspections\//);
  assert.match(storageRules, /match \/expenses\//);
  assert.match(storageRules, /match \/insurance\//);
  assert.match(storageRules, /folder == "spec sheets"/);
});

test("expenses use the signed-in Firebase client like recce forms", () => {
  assert.match(expensesSource, /query\(collection\(db, "expenses"\)/);
  assert.match(expensesSource, /const ownerUid = auth\.currentUser\?\.uid \|\| user\?\.uid/);
  assert.match(expensesSource, /where\("ownerUid", "==", ownerUid\)/);
  assert.match(expensesSource, /setDoc\(doc\(db, "expenses", id\)/);
  assert.match(expensesSource, /deleteDoc\(doc\(db, "expenses", expense\.id\)\)/);
  assert.doesNotMatch(expensesSource, /getApiBaseUrl|\/expenses\?\$\{/);
  assert.match(firestoreRules, /match \/expenses\/\{expenseId\}/);
  assert.match(firestoreRules, /request\.resource\.data\.ownerUid == request\.auth\.uid/);
  assert.match(firestoreRules, /resource\.data\.ownerUid == request\.auth\.uid/);
});

test("mobile receipts use the shared monthly VAT workflow", () => {
  assert.match(footerSource, /route: "\/job"/);
  assert.doesNotMatch(footerSource, /route: "\/receipts"/);
  assert.match(profileSource, /router\.push\("\/receipts"\)/);
  assert.match(receiptsSource, /collection\(db, "receiptGroups"\)/);
  assert.match(receiptsSource, /collection\(db, "receipts"\)/);
  assert.match(receiptsSource, /previousStatementMonthKey/);
  assert.match(receiptsSource, /companies\/\$\{companyId\}\/receipts\/\$\{user\.uid\}/);
  assert.match(receiptsSource, /getDownloadURL\(ref\(storage, storagePath\)\)/);
  assert.match(receiptsSource, /Receipt details/);
  assert.match(receiptsSource, /View receipt photo full screen/);
  assert.match(storageRules, /match \/companies\/\{companyId\}\/receipts\/\{uid\}/);
  assert.match(serverSource, /app\.post\("\/receipt-groups\/:groupId\/transition"/);
  assert.match(serverSource, /action === "reopen"/);
  assert.match(serverSource, /app\.post\("\/receipts\/:receiptId\/resubmit"/);
});
