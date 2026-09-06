const normalise = (value) => String(value ?? "").trim().toLowerCase();

const normaliseCode = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits ? digits.padStart(4, "0") : normalise(raw);
};

const values = (items, normaliser = normalise) =>
  items.map(normaliser).filter(Boolean);

const intersects = (left, right) =>
  left.some((value) => right.includes(value));

/**
 * Match a leave record to the employee the leave belongs to.
 *
 * Audit/actor fields such as createdBy* and requestedBy* are deliberately
 * excluded. An administrator can create leave for somebody else, so those
 * fields identify who performed the action rather than who is taking leave.
 * More authoritative identifiers also take precedence over legacy display
 * fields so an ID mismatch cannot be overridden by a coincidental name/code.
 */
export function employeeMatchesHoliday(
  holiday,
  employeeRecord,
  sessionEmployee,
  user
) {
  const employeeIds = values([
    employeeRecord?.id,
    employeeRecord?.employeeId,
    employeeRecord?.uid,
    employeeRecord?.authUid,
    sessionEmployee?.employeeId,
    sessionEmployee?.id,
    sessionEmployee?.uid,
    sessionEmployee?.authUid,
    user?.uid,
  ]);

  const holidayIds = values([
    holiday?.employeeId,
    holiday?.employeeDocId,
    holiday?.staffId,
    holiday?.userId,
    holiday?.uid,
    holiday?.authUid,
    holiday?.employeeUid,
  ]);

  if (holidayIds.length > 0) return intersects(holidayIds, employeeIds);

  const employeeCodes = values(
    [
      employeeRecord?.userCode,
      employeeRecord?.employeeCode,
      employeeRecord?.code,
      sessionEmployee?.userCode,
      sessionEmployee?.employeeCode,
      sessionEmployee?.code,
    ],
    normaliseCode
  );

  const holidayCodes = values(
    [
      holiday?.employeeCode,
      holiday?.userCode,
      holiday?.staffCode,
      holiday?.code,
    ],
    normaliseCode
  );

  if (holidayCodes.length > 0) return intersects(holidayCodes, employeeCodes);

  const employeeNames = values([
    employeeRecord?.name,
    employeeRecord?.displayName,
    sessionEmployee?.name,
    sessionEmployee?.displayName,
    sessionEmployee?.fullName,
    user?.displayName,
  ]);

  const holidayNames = values([
    holiday?.employee,
    holiday?.employeeName,
    holiday?.staffName,
    holiday?.name,
    holiday?.displayName,
  ]);

  if (holidayNames.length > 0) return intersects(holidayNames, employeeNames);

  const employeeEmails = values([
    employeeRecord?.email,
    sessionEmployee?.email,
    user?.email,
  ]);

  const holidayEmails = values([
    holiday?.employeeEmail,
    holiday?.userEmail,
    holiday?.email,
  ]);

  return holidayEmails.length > 0 && intersects(holidayEmails, employeeEmails);
}
