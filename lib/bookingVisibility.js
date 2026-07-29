const clean = (value) => String(value ?? "").trim().toLowerCase();

const values = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

const codesFor = (employee = {}) =>
  [employee.userCode, employee.employeeCode, employee.code]
    .map(clean)
    .filter(Boolean);

const namesFor = (employee = {}) =>
  [employee.name, employee.fullName, employee.displayName]
    .map(clean)
    .filter(Boolean);

const flattenAssignmentMap = (map) => {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  return Object.values(map).flatMap(values);
};

function assignedPeople(booking = {}) {
  return [
    ...values(booking.employees),
    ...values(booking.employeeCodes),
    ...flattenAssignmentMap(booking.employeesByDate),
    ...flattenAssignmentMap(booking.employeeAssignmentsByDate),
    ...flattenAssignmentMap(booking.employeeCodesByDate),
    ...flattenAssignmentMap(booking.assignedEmployeeCodesByDate),
  ];
}

export function isCrewedBooking(booking = {}) {
  return booking.isCrewed === true;
}

export function isBookingAssignedToEmployee(booking = {}, employee = {}, employeeDirectory = []) {
  const employeeCodes = new Set(codesFor(employee));
  const employeeNames = new Set(namesFor(employee));

  for (const assigned of assignedPeople(booking)) {
    if (assigned && typeof assigned === "object") {
      if (codesFor(assigned).some((code) => employeeCodes.has(code))) return true;
      if (namesFor(assigned).some((name) => employeeNames.has(name))) return true;

      const assignedNames = namesFor(assigned);
      const directoryMatch = employeeDirectory.find((candidate) =>
        namesFor(candidate).some((name) => assignedNames.includes(name))
      );
      if (directoryMatch && codesFor(directoryMatch).some((code) => employeeCodes.has(code))) {
        return true;
      }
      continue;
    }

    const token = clean(assigned);
    if (employeeCodes.has(token) || employeeNames.has(token)) return true;

    const directoryMatch = employeeDirectory.find((candidate) =>
      namesFor(candidate).includes(token)
    );
    if (directoryMatch && codesFor(directoryMatch).some((code) => employeeCodes.has(code))) {
      return true;
    }
  }

  return false;
}

export function isBookingVisibleToEmployee(booking = {}, employee = {}, employeeDirectory = []) {
  return (
    isCrewedBooking(booking) &&
    isBookingAssignedToEmployee(booking, employee, employeeDirectory)
  );
}
