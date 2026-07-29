import { isCrewedBooking } from "./bookingVisibility.js";

export function isApprovedHolidayStatus(status) {
  const value = String(status || "").toLowerCase().trim();
  return value === "approved" || value.startsWith("approved");
}

export function projectBookingForNotification(booking) {
  if (!booking) return {};
  return {
    jobNumber: String(booking.jobNumber || ""),
    client: String(booking.client || ""),
    location: String(booking.location || ""),
    status: String(booking.status || ""),
    isCrewed: booking.isCrewed === true,
    callTime: String(booking.callTime || booking.call_time || booking.calltime || ""),
    vehicles: booking.vehicles || [],
    equipment: booking.equipment || [],
    employees: booking.employees || [],
    employeeCodes: booking.employeeCodes || [],
    employeesByDate: booking.employeesByDate || booking.employeeAssignmentsByDate || {},
    callTimes: booking.callTimes || booking.callTimesByDate || {},
    notesByDate: booking.notesByDate || {},
    statusByDate: booking.statusByDate || {},
    recceForms: booking.recceForms || {},
    bookingDates: booking.bookingDates || [],
  };
}

export function bookingNotificationSignature(booking) {
  return JSON.stringify(projectBookingForNotification(booking));
}

export function classifyBookingNotificationTransition({
  type,
  before,
  after,
  employeeCode,
}) {
  const code = String(employeeCode || "").trim();
  const wasAssigned = Array.isArray(before?.employeeCodes)
    ? before.employeeCodes.includes(code)
    : false;
  const isAssigned = Array.isArray(after?.employeeCodes)
    ? after.employeeCodes.includes(code)
    : false;
  const wasVisible = wasAssigned && isCrewedBooking(before);
  const isVisible = isAssigned && isCrewedBooking(after);

  if (type === "added") return isVisible ? "assigned" : null;
  if (type === "removed") return wasVisible ? "removed" : null;
  if (type !== "modified") return null;
  if (!wasVisible && isVisible) return "assigned";
  if (wasVisible && !isVisible) return "removed";
  if (
    wasVisible &&
    isVisible &&
    bookingNotificationSignature(before) !== bookingNotificationSignature(after)
  ) {
    return "updated";
  }
  return null;
}

export function timesheetNotificationSignature(exists, timesheet) {
  return JSON.stringify({
    exists: exists === true,
    submitted: timesheet?.submitted === true,
    approved: timesheet?.approved === true,
    status: String(timesheet?.status || ""),
    submittedAt: timesheet?.submittedAt || null,
    approvedAt: timesheet?.approvedAt || null,
  });
}
