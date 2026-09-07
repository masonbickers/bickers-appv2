// Server-owned enrolment only: an old custom token is never approval evidence.
const clean = (value) => String(value || "").trim();
const email = (value) => clean(value).toLowerCase();
const approved = (status) => ["active", "invited"].includes(status);
const blocked = (record) => record.isEnabled === false || record.disabled === true ||
  record.active === false || record.archived === true || record.isArchived === true ||
  record.appDisabled === true || record.status === "disabled";
export function transitionError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function validateTransitionIdentity({ decoded, account, employee, user, enrolment, now }) {
  if (!decoded?.uid || !["custom", "password"].includes(decoded.firebase?.sign_in_provider)) {
    throw transitionError(403, "A supported existing employee session is required.");
  }
  if (!enrolment || !["eligible", "retiring", "completed"].includes(enrolment.status) ||
      !account || account.disabled || !employee || !user || blocked(employee) || blocked(user) ||
      !approved(employee.mobileAccess?.status) || !approved(user.mobileAccessStatus)) {
    throw transitionError(403, "Ask an administrator to check your Mobile app access.");
  }
  const approvedEmail = email(employee.mobileAccess?.approvedEmail);
  const aliases = [employee.authUid, employee.uid, employee.userId, employee.auth?.uid].filter(Boolean);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvedEmail) ||
      approvedEmail !== email(account.email) || approvedEmail !== email(decoded.email) ||
      approvedEmail !== email(enrolment.email) || approvedEmail !== email(employee.email) ||
      enrolment.uid !== decoded.uid || account.uid !== decoded.uid ||
      enrolment.employeeId !== employee.id || user.employeeId !== employee.id ||
      !employee.companyId || employee.companyId !== user.companyId || employee.companyId !== enrolment.companyId ||
      !aliases.length || aliases.some((uid) => uid !== decoded.uid) ||
      [user.uid, user.authUid].filter(Boolean).some((uid) => uid !== decoded.uid)) {
    throw transitionError(409, "Your employee identity needs an administrator's review.");
  }
  if (decoded.firebase.sign_in_provider === "custom") {
    if (enrolment.status !== "eligible" || !(Date.parse(enrolment.deadline) > now) ||
        !(Number(decoded.auth_time) > 0) || !(Number(enrolment.sessionCutoff) > 0) ||
        Number(decoded.auth_time) > Number(enrolment.sessionCutoff)) {
      throw transitionError(403, "This old session can no longer be used. Sign in with your work email and password.");
    }
  }
  return approvedEmail;
}

export function createStagedPasswordTransition({ db, auth, syncApprovedEmployeeAuth, sendSetupEmail, now = Date.now }) {
  async function context(token) {
    if (!token) throw transitionError(401, "Sign in to continue.");
    let decoded;
    try { decoded = await auth.verifyIdToken(token, true); }
    catch { throw transitionError(401, "Your session has expired. Sign in to continue."); }
    const ref = db.collection("mobilePasswordTransitions").doc(decoded.uid);
    const enrolment = (await ref.get()).data();
    if (!enrolment?.employeeId) throw transitionError(403, "Your account has not been enrolled. Ask an administrator to check Mobile app access.");
    const [account, employeeSnap, userSnap, employees, linkedUsers] = await Promise.all([
      auth.getUser(decoded.uid), db.collection("employees").doc(enrolment.employeeId).get(),
      db.collection("users").doc(decoded.uid).get(), db.collection("employees").get(),
      db.collection("users").where("employeeId", "==", enrolment.employeeId).get(),
    ]);
    const employee = employeeSnap.exists ? { ...employeeSnap.data(), id: employeeSnap.id } : null;
    const approvedEmail = validateTransitionIdentity({ decoded, account, employee,
      user: userSnap.data(), enrolment, now: now() });
    // Recheck conflicts, including case variants and aliases, after the migration audit.
    const conflicts = employees.docs.some((doc) => {
      if (doc.id === employee.id) return false;
      const other = doc.data();
      return [other.authUid, other.uid, other.userId, other.codeLoginUid, other.auth?.uid, other.auth?.codeLoginUid].includes(decoded.uid) ||
        (!blocked(other) && [other.email, other.workEmail, other.emailAddress, ...(other.emails || [])].some((value) => email(value) === approvedEmail));
    });
    if (conflicts || linkedUsers.docs.length !== 1 || linkedUsers.docs[0].id !== decoded.uid) {
      throw transitionError(409, "Conflicting employee records need an administrator's review.");
    }
    return { ref, decoded, enrolment, account, approvedEmail };
  }
  return {
    async status(token) {
      const c = await context(token);
      return { uid: c.decoded.uid, email: c.approvedEmail, deadline: c.enrolment.deadline,
        status: c.enrolment.status, hasPassword: c.account.providerData.some((p) => p.providerId === "password") };
    },
    async sendEmail(token) {
      const c = await context(token);
      if (c.enrolment.status !== "eligible") throw transitionError(409, "Continue with your password to finish setup.");
      // Persisted throttle works across instances. Never return an email action code.
      await db.runTransaction(async (tx) => {
        const latest = (await tx.get(c.ref)).data();
        if (latest?.status !== "eligible") throw transitionError(409, "Setup is already being completed.");
        if (now() - Number(latest.emailAttemptAt || 0) < 60000) throw transitionError(429, "Please wait a minute before requesting another email.");
        tx.update(c.ref, { emailAttemptAt: now() });
      });
      await sendSetupEmail(c.approvedEmail);
      return { sent: true };
    },
    async complete(token) {
      const c = await context(token);
      if (c.decoded.firebase.sign_in_provider !== "password" ||
          !(Number(c.decoded.auth_time) > 0) || now() / 1000 - c.decoded.auth_time > 300) {
        throw transitionError(403, "Confirm your password again to finish securing your account.");
      }
      await syncApprovedEmployeeAuth(token);
      if (c.enrolment.status === "completed") return { completed: true, refreshSession: false };
      // Retire this legacy MOBILE identity in the server-owned registry. Hardened
      // rules reject custom mobile tokens, but retain trusted web providers.
      // Do not call revokeRefreshTokens(uid): that would also eject web sessions
      // sharing this UID. Firebase itself invalidates sessions on password reset.
      await db.runTransaction(async (tx) => {
        const latest = (await tx.get(c.ref)).data();
        if (latest?.status === "completed") return;
        if (!latest || latest.uid !== c.decoded.uid || latest.email !== c.approvedEmail ||
            latest.employeeId !== c.enrolment.employeeId || latest.companyId !== c.enrolment.companyId) {
          throw transitionError(409, "Your enrolment changed. Ask an administrator to review your account.");
        }
        tx.update(c.ref, { status: "completed", completedAt: new Date(now()).toISOString() });
      });
      return { completed: true, refreshSession: false };
    },
  };
}
