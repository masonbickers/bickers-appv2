import test from "node:test";
import assert from "node:assert/strict";
import { validateTransitionIdentity, createStagedPasswordTransition } from "../server/stagedPasswordTransition.js";

function fixture() {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const decoded = { uid: "u1", email: "test@example.com", auth_time: now / 1000 - 100, firebase: { sign_in_provider: "custom" } };
  const account = { uid: "u1", email: decoded.email, providerData: [] };
  const employee = { id: "e1", authUid: "u1", companyId: "c1", email: decoded.email, mobileAccess: { status: "invited", approvedEmail: decoded.email } };
  const user = { employeeId: "e1", companyId: "c1", mobileAccessStatus: "invited" };
  const enrolment = { uid: "u1", employeeId: "e1", companyId: "c1", email: decoded.email, status: "eligible", deadline: "2026-09-14T12:00:00Z", sessionCutoff: now / 1000 - 10 };
  return { decoded, account, employee, user, enrolment, now };
}

test("only approved, enrolled, previously signed-in custom sessions qualify", () => {
  assert.equal(validateTransitionIdentity(fixture()), "test@example.com");
  for (const change of [
    (f) => { f.enrolment = null; }, (f) => { f.account.disabled = true; },
    (f) => { f.user.isEnabled = false; }, (f) => { f.employee.mobileAccess.status = "pending"; },
    (f) => { f.employee.archived = true; }, (f) => { f.user.appDisabled = true; },
    (f) => { f.enrolment.deadline = "invalid"; }, (f) => { f.enrolment.deadline = "2026-09-01"; },
    (f) => { f.enrolment.status = "completed"; }, (f) => { f.enrolment.status = "retiring"; },
    (f) => { f.decoded.auth_time = f.now / 1000; }, (f) => { f.decoded.auth_time = 0; },
    (f) => { f.decoded.firebase.sign_in_provider = "anonymous"; },
  ]) { const f = fixture(); change(f); assert.throws(() => validateTransitionIdentity(f), { status: 403 }); }
});
test("changed email, uid, employee or company never inherit the old session", () => {
  for (const change of [
    (f) => { f.decoded.email = "other@example.com"; }, (f) => { f.employee.email = "other@example.com"; },
    (f) => { f.account.uid = "other"; }, (f) => { f.user.employeeId = "other"; },
    (f) => { f.enrolment.companyId = "other"; }, (f) => { f.employee.userId = "other"; },
    (f) => { f.user.authUid = "other"; },
  ]) { const f = fixture(); change(f); assert.throws(() => validateTransitionIdentity(f), { status: 409 }); }
});
test("secure password sign-in can recover after deadline or a partial retirement", () => {
  const f = fixture(); f.decoded.firebase.sign_in_provider = "password";
  f.enrolment.deadline = "2026-09-01"; f.enrolment.status = "retiring";
  assert.equal(validateTransitionIdentity(f), f.decoded.email);
});

function serviceFixture() {
  const f = fixture(); const events = [];
  let extraEmployee = null, linkedIds = ["u1"];
  const ref = { get: async () => ({ data: () => ({ ...f.enrolment }) }), update: async (data) => Object.assign(f.enrolment, data) };
  const db = {
    collection(name) { return {
      doc(id) {
        if (name === "mobilePasswordTransitions") return ref;
        return { get: async () => ({ exists: true, id, data: () => name === "users" ? f.user : f.employee }) };
      },
      get: async () => ({ docs: [{ id: "e1", data: () => f.employee }, ...(extraEmployee ? [{ id: "e2", data: () => extraEmployee }] : [])] }),
      where: () => ({ get: async () => ({ docs: linkedIds.map((id) => ({ id })) }) }),
    }; },
    async runTransaction(fn) { return fn({ get: (r) => r.get(), update: (r, data) => r.update(data) }); },
  };
  const service = createStagedPasswordTransition({ db, now: () => f.now,
    auth: { verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); if (token === "expired") throw new Error("revoked"); return f.decoded; },
      getUser: async () => f.account, revokeRefreshTokens: async (uid) => events.push(["revoke", uid]) },
    syncApprovedEmployeeAuth: async () => events.push(["sync"]), sendSetupEmail: async (email) => events.push(["email", email]),
  });
  return { f, service, events, duplicateEmail: () => { extraEmployee = { email: "TEST@example.com" }; }, duplicateUser: () => { linkedIds.push("other"); } };
}
test("status is read-only, missing/revoked tokens denied and duplicate identities rechecked", async () => {
  const s = serviceFixture();
  assert.equal((await s.service.status("token")).hasPassword, false);
  assert.deepEqual(s.events, []);
  await assert.rejects(s.service.status(""), { status: 401 });
  await assert.rejects(s.service.status("expired"), { status: 401 });
  s.duplicateEmail(); await assert.rejects(s.service.status("token"), { status: 409 });
  const t = serviceFixture(); t.duplicateUser(); await assert.rejects(t.service.status("token"), { status: 409 });
});
test("setup email is fixed to approved identity, throttled and does not reset credentials or revoke", async () => {
  const s = serviceFixture(); await s.service.sendEmail("token");
  assert.deepEqual(s.events, [["email", "test@example.com"]]);
  await assert.rejects(s.service.sendEmail("token"), { status: 429 });
});
test("completion requires fresh password proof; retires old mobile access without revoking shared web sessions", async () => {
  const s = serviceFixture(); await assert.rejects(s.service.complete("token"), { status: 403 });
  s.f.decoded.firebase.sign_in_provider = "password";
  s.f.decoded.auth_time = s.f.now / 1000 - 301;
  await assert.rejects(s.service.complete("token"), { status: 403 });
  s.f.decoded.auth_time = s.f.now / 1000;
  assert.deepEqual(await s.service.complete("token"), { completed: true, refreshSession: false });
  assert.deepEqual(s.events, [["sync"]]);
  assert.equal(s.f.enrolment.status, "completed");
  assert.equal((await s.service.complete("token")).refreshSession, false);
  assert.equal(s.events.filter(([action]) => action === "revoke").length, 0);
  s.f.decoded.firebase.sign_in_provider = "custom";
  await assert.rejects(s.service.status("token"), { status: 403 });
});

