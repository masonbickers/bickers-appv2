import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("approved mobile sign-in activates access without overwriting web account roles", async () => {
  const source = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function syncApprovedEmployeeAuth(");
  const end = source.indexOf("\nasync function syncLegacyEmployeeAuth(", start);
  assert.ok(start > 0 && end > start);
  for (const role of ["platformAdmin", "admin", "user"]) {
    const account = { role, employeeId: "employee-1", companyId: "company-1", isEnabled: true, mobileAccessStatus: "invited" };
    const employee = { id: "employee-1", role: "user", companyId: "company-1", email: "test@example.com", mobileAccess: { status: "invited", approvedEmail: "test@example.com" } };
    const writes = [];
    const context = vm.createContext({
      admin: { auth: () => ({ verifyIdToken: async () => ({ uid: "uid-1", email: employee.email, firebase: { sign_in_provider: "password" } }) }), firestore: { FieldValue: { serverTimestamp: () => "now" } } },
      db: { collection: name => ({ doc: id => ({ path: name + "/" + id, get: async () => ({ exists: true, data: () => account }) }) }), batch: () => ({ set: (ref, patch, options) => writes.push({ ref, patch, options }), commit: async () => {} }) },
      decodedTokenIsAnonymous: () => false,
      normaliseEmail: value => value.toLowerCase(),
      normaliseCode: value => value,
      findEmployeeForApprovedUid: async () => employee,
      mobileAccessIsApproved: status => ["invited", "active"].includes(status),
      employeeIsBlocked: () => false,
      employeeEmailMatches: (record, email) => record.email === email,
      employeeAuthError: (status, message) => Object.assign(new Error(message), { status }),
      buildSessionData: () => ({ role: "user", companyId: "company-1", appAccess: { user: true }, email: employee.email }),
    });
    const sync = vm.runInContext(source.slice(start, end) + "\nsyncApprovedEmployeeAuth", context);
    const result = await sync("verified-test-token");
    const write = writes.find(row => row.ref.path === "users/uid-1");
    assert.ok(write);
    assert.equal(write.options.merge, true);
    const saved = { ...account, ...write.patch };
    assert.equal(saved.role, role);
    assert.equal(saved.mobileAccessStatus, "active");
    assert.equal(result.sessionData.role, "user");
  }
});

