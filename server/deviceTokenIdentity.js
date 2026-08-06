function clean(value) {
  return String(value || "").trim();
}

function normaliseCode(value) {
  const digits = clean(value).replace(/\D/g, "");
  return digits ? digits.padStart(4, "0") : "";
}

function normaliseEmail(value) {
  return clean(value).toLowerCase();
}

export function decodedTokenIsAnonymous(decoded = {}) {
  return decoded?.firebase?.sign_in_provider === "anonymous";
}

export function canonicalNotificationUid(decodedUid, employee = {}) {
  return clean(
    employee.authUid ||
      employee.uid ||
      employee.userId ||
      employee.auth?.uid ||
      decodedUid
  );
}

export function anonymousDeviceIdentityMatches(
  employee = {},
  { employeeId, employeeCode, email } = {}
) {
  const expectedEmployeeId = clean(employee.id || employee.employeeId);
  const requestedEmployeeId = clean(employeeId);
  const expectedCode = normaliseCode(
    employee.userCode ||
      employee.employeeCode ||
      employee.code ||
      employee.staffCode ||
      employee.timesheetCode
  );
  const requestedCode = normaliseCode(employeeCode);
  const requestedEmail = normaliseEmail(email);
  const employeeEmails = [employee.email, employee.contactEmail, employee.workEmail]
    .concat(Array.isArray(employee.emails) ? employee.emails : [])
    .map(normaliseEmail)
    .filter(Boolean);

  return (
    !!expectedEmployeeId &&
    expectedEmployeeId === requestedEmployeeId &&
    !!expectedCode &&
    expectedCode === requestedCode &&
    !!requestedEmail &&
    employeeEmails.includes(requestedEmail)
  );
}
