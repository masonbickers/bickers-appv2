// Resolve an existing signature, never copy, rewrite or manufacture one.
const CURRENT_VERSION = "1.1";
const TITLE = "Bickers Action Working Terms";
const EFFECTIVE_DATE = "19/08/2026";
const clean = (value) => String(value || "").trim();
const email = (value) => clean(value).toLowerCase();
const fail = (status, message) => Object.assign(new Error(message), { status });
const blocked = (data) => !data || data.isEnabled === false ||
  data.active === false || data.disabled === true || data.appDisabled === true ||
  data.archived === true || data.isArchived === true;

function validAcceptance(data, uid, employee) {
  return data?.accepted === true &&
    data.documentVersion === CURRENT_VERSION &&
    data.documentTitle === TITLE &&
    data.documentEffectiveDate === EFFECTIVE_DATE &&
    data.userId === uid &&
    data.employeeId === employee.id &&
    data.companyId === employee.companyId &&
    typeof data.fullName === "string" && data.fullName.trim().length >= 2 &&
    typeof data.signatureSvgPath === "string" && data.signatureSvgPath.startsWith("M ") &&
    data.signatureSvgPath.length >= 20 &&
    typeof data.acceptedAt?.toDate === "function" &&
    Number.isFinite(data.acceptedAt.toDate().getTime());
}

export function createWorkingTermsResolver({
  db, auth, findEmployeeForApprovedUid, employeeIsBlocked, employeeEmailMatches,
}) {
  return async function resolveWorkingTerms(idToken) {
    if (!idToken) throw fail(401, "Sign in to check your Working Terms.");
    const decoded = await auth.verifyIdToken(idToken, true);
    if (decoded.firebase?.sign_in_provider !== "password" || !decoded.uid) {
      throw fail(403, "An approved password account is required.");
    }
    const account = await db.collection("users").doc(decoded.uid).get();
    const user = account.exists ? account.data() : null;
    const employee = await findEmployeeForApprovedUid(decoded.uid);
    if (blocked(user) || user.mobileAccessStatus !== "active" ||
      !employee || blocked(employee) || employeeIsBlocked(employee) ||
      employee.mobileAccess?.status !== "active") {
      throw fail(403, "Mobile app access is not active.");
    }
    if (!clean(employee.companyId) || user.companyId !== employee.companyId ||
      user.employeeId !== employee.id || !email(decoded.email) ||
      email(employee.mobileAccess?.approvedEmail) !== email(decoded.email) ||
      !employeeEmailMatches(employee, email(decoded.email))) {
      throw fail(403, "The approved employee identity could not be verified.");
    }

    const acceptanceRef = (uid) => db.collection("workingTermsAcceptances")
      .doc(uid).collection("versions").doc(CURRENT_VERSION);
    const own = await acceptanceRef(decoded.uid).get();
    if (own.exists) {
      if (!validAcceptance(own.data(), decoded.uid, employee)) {
        throw fail(409, "Your Working Terms record needs an administrator to check it.");
      }
      return serialise(own.data(), own.ref.path);
    }

    // Only explicit, administrator-maintained identity relationships qualify.
    // Names, matching emails, and a client-supplied employee ID are never proof.
    const retired = await db.collection("users")
      .where("supersededByUid", "==", decoded.uid).limit(21).get();
    if (retired.docs.length > 20) throw fail(409, "Your login identity history needs an administrator to check it.");
    const candidates = new Map(retired.docs.map((doc) => [doc.id, doc.data()]));
    const legacyIds = new Set([employee.codeLoginUid, employee.auth?.codeLoginUid]
      .map(clean).filter((uid) => uid && uid !== decoded.uid && !uid.includes("/")));
    for (const uid of legacyIds) {
      if (!candidates.has(uid)) {
        const doc = await db.collection("users").doc(uid).get();
        if (doc.exists) candidates.set(uid, doc.data());
      }
    }
    const matches = [];
    for (const [uid, sourceUser] of candidates) {
      const retiredLink = sourceUser.supersededByUid === decoded.uid &&
        sourceUser.previousEmployeeId === employee.id &&
        sourceUser.isEnabled === false && sourceUser.mobileAccessStatus === "disabled" &&
        (!sourceUser.employeeId || sourceUser.employeeId === employee.id);
      const legacyLink = legacyIds.has(uid) && sourceUser.employeeId === employee.id &&
        (!sourceUser.supersededByUid || sourceUser.supersededByUid === decoded.uid);
      if (sourceUser.companyId !== employee.companyId || (!retiredLink && !legacyLink)) continue;
      // Reject a source identity still assigned to a different employee.
      for (const field of ["authUid", "uid", "userId", "auth.uid", "codeLoginUid", "auth.codeLoginUid"]) {
        const linked = await db.collection("employees").where(field, "==", uid).limit(2).get();
        if (linked.docs.some((doc) => doc.id !== employee.id)) {
          throw fail(409, "Your previous login identity needs an administrator to check it.");
        }
      }
      const record = await acceptanceRef(uid).get();
      if (!record.exists) continue;
      if (!validAcceptance(record.data(), uid, employee)) {
        throw fail(409, "Your previous Working Terms record needs an administrator to check it.");
      }
      matches.push({ data: record.data(), path: record.ref.path });
    }
    // Multiple records for the same verified employee/version remain intact.
    // Display the earliest acceptance, with a stable tie break.
    matches.sort((a, b) => a.data.acceptedAt.toDate() - b.data.acceptedAt.toDate() ||
      a.path.localeCompare(b.path));
    return matches.length ? serialise(matches[0].data, matches[0].path) : null;
  };
}

function serialise(data, sourcePath) {
  // Do not send the signature drawing or arbitrary Firestore fields to the client.
  return {
    accepted: true,
    documentVersion: data.documentVersion,
    documentTitle: data.documentTitle,
    documentEffectiveDate: data.documentEffectiveDate,
    userId: data.userId,
    employeeId: data.employeeId,
    companyId: data.companyId,
    fullName: data.fullName,
    acceptedAt: data.acceptedAt.toDate().toISOString(),
    sourcePath,
  };
}
