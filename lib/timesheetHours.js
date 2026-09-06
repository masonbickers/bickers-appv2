const WEEKEND_DAYS = new Set(["Saturday", "Sunday"]);
const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const ON_SET_STANDARD_DAY_MINUTES = 10 * 60;
const ON_SET_EARLY_ARRIVAL_CAP_MINUTES = 60;
const ON_SET_EARLY_CALL_CUTOFF_MINUTES = 7 * 60;
const MAX_REASONABLE_PRECALL_WINDOW_MINUTES = 12 * 60;
const DEFAULT_YARD_START = "08:00";
const DEFAULT_YARD_END = "16:30";

function boolish(value) {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "y";
}

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function durationMinutes(startValue, endValue) {
  const start = timeToMinutes(startValue);
  const end = timeToMinutes(endValue);
  if (start == null || end == null) return 0;
  return end >= start ? end - start : end + 24 * 60 - start;
}

function parseHoursValue(value) {
  const hours = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

function hasValidPrecallSequence(entry) {
  if (!entry?.precallDuration || !entry?.callTime) return false;
  const precall = durationMinutes(entry.precallDuration, entry.callTime);
  if (precall > MAX_REASONABLE_PRECALL_WINDOW_MINUTES) return false;
  if (!entry.arriveTime) return true;
  return (
    durationMinutes(entry.arriveTime, entry.precallDuration) + precall ===
    durationMinutes(entry.arriveTime, entry.callTime)
  );
}

function onSetEarlyOvertimeMinutes(entry) {
  const call = timeToMinutes(entry?.callTime);
  if (call == null || !entry?.wrapTime || call >= ON_SET_EARLY_CALL_CUTOFF_MINUTES) return 0;
  return Math.min(
    durationMinutes(entry.callTime, entry.wrapTime),
    ON_SET_EARLY_CALL_CUTOFF_MINUTES - call
  );
}

function onSetOvertimeMinutes(entry) {
  const gross = durationMinutes(entry?.callTime, entry?.wrapTime);
  return Math.max(
    Math.max(0, gross - ON_SET_STANDARD_DAY_MINUTES),
    onSetEarlyOvertimeMinutes(entry)
  );
}

export function getLunchBreakDeductionMinutes(day, lunchSupplied, grossMinutes) {
  const gross = Math.max(0, Number(grossMinutes) || 0);
  if (WEEKEND_DAYS.has(day) || lunchSupplied || gross === 0) return 0;
  return Math.min(30, gross);
}

export function computeTimesheetDayBreakdown(entry, day = null) {
  const safeEntry = entry || {};
  const mode = String(safeEntry.mode || "off").trim().toLowerCase();
  const result = {
    mode,
    total: 0,
    yardWork: 0,
    yardTravel: 0,
    breakDeduction: 0,
    travelDay: 0,
    travelGuarantee: 0,
    workshop: 0,
    outboundTravel: 0,
    paidEarly: 0,
    precall: 0,
    onSetStandard: 0,
    onSetOvertime: 0,
    returnTravel: 0,
    returnWithinStandard: 0,
    returnAfterStandard: 0,
    additionalJobTravel: 0,
  };

  if (["off", "holiday", "bankholiday", "unpaid"].includes(mode)) return result;

  if (mode === "yard" && boolish(safeEntry.isTurnaround)) {
    result.mode = "turnaround";
    result.onSetStandard = ON_SET_STANDARD_DAY_MINUTES;
    result.total = ON_SET_STANDARD_DAY_MINUTES;
    return result;
  }

  if (mode === "yard") {
    const segments =
      Array.isArray(safeEntry.yardSegments) && safeEntry.yardSegments.length > 0
        ? safeEntry.yardSegments
        : [{
            start: safeEntry.leaveTime || DEFAULT_YARD_START,
            end: safeEntry.arriveBack || DEFAULT_YARD_END,
          }];
    result.yardWork = segments.reduce(
      (total, segment) => total + durationMinutes(segment?.start, segment?.end),
      0
    );
    result.yardTravel = boolish(safeEntry.yardTravelEnabled)
      ? durationMinutes(safeEntry.yardTravelLeaveTime, safeEntry.yardTravelArriveTime)
      : 0;
    const gross = result.yardWork + result.yardTravel;
    result.breakDeduction = getLunchBreakDeductionMinutes(
      day,
      boolish(safeEntry.lunchSup),
      gross
    );
    result.total = Math.max(0, gross - result.breakDeduction);
    return result;
  }

  if (mode === "travel") {
    result.travelDay = durationMinutes(safeEntry.leaveTime, safeEntry.arriveTime);
    if (safeEntry.leaveTime && safeEntry.arriveTime) {
      result.total = Math.max(ON_SET_STANDARD_DAY_MINUTES, result.travelDay);
      result.travelGuarantee = Math.max(0, result.total - result.travelDay);
    }
    return result;
  }

  if (mode === "workshop") {
    const segments = Array.isArray(safeEntry.yardSegments) ? safeEntry.yardSegments : [];
    if (segments.length > 0) {
      result.workshop = segments.reduce(
        (total, segment) => total + durationMinutes(segment?.start, segment?.end),
        0
      );
    } else {
      const rows = Array.isArray(safeEntry.workshopJobs) ? safeEntry.workshopJobs : [];
      result.workshop = rows.reduce(
        (total, row) => total + parseHoursValue(row?.hours) * 60,
        0
      );
    }
    result.total = result.workshop;
    return result;
  }

  if (mode === "onset") {
    result.outboundTravel = durationMinutes(safeEntry.leaveTime, safeEntry.arriveTime);
    const validPrecall = hasValidPrecallSequence(safeEntry);
    if (validPrecall) {
      result.precall = durationMinutes(safeEntry.precallDuration, safeEntry.callTime);
    }
    if (safeEntry.arriveTime && safeEntry.callTime) {
      const requiredStart = validPrecall ? safeEntry.precallDuration : safeEntry.callTime;
      const earlyArrival = durationMinutes(safeEntry.arriveTime, requiredStart);
      if (earlyArrival <= MAX_REASONABLE_PRECALL_WINDOW_MINUTES) {
        result.paidEarly = Math.min(earlyArrival, ON_SET_EARLY_ARRIVAL_CAP_MINUTES);
      }
    }

    const onSetGross = durationMinutes(safeEntry.callTime, safeEntry.wrapTime);
    result.onSetOvertime = onSetOvertimeMinutes(safeEntry);
    result.onSetStandard = Math.max(0, onSetGross - result.onSetOvertime);
    result.returnTravel = durationMinutes(safeEntry.wrapTime, safeEntry.arriveBack);
    result.additionalJobTravel = boolish(safeEntry.additionalTravelEnabled)
      ? durationMinutes(safeEntry.additionalTravelStartTime, safeEntry.additionalTravelEndTime)
      : 0;
    const remainingStandard = Math.max(0, ON_SET_STANDARD_DAY_MINUTES - onSetGross);
    result.returnWithinStandard = Math.min(result.returnTravel, remainingStandard);
    result.returnAfterStandard = Math.max(0, result.returnTravel - result.returnWithinStandard);
    result.total =
      result.outboundTravel +
      result.paidEarly +
      result.precall +
      onSetGross +
      result.returnTravel +
      result.additionalJobTravel;
  }

  return result;
}

export function computeTimesheetWeekHours(timesheet) {
  const days = timesheet?.days;
  if (days && typeof days === "object") {
    const totalMinutes = WEEK_DAYS.reduce((total, day) => {
      const fallback = { mode: WEEKEND_DAYS.has(day) ? "off" : "yard" };
      return total + computeTimesheetDayBreakdown(days[day] || fallback, day).total;
    }, 0);
    return Math.round((totalMinutes / 60) * 100) / 100;
  }

  const legacyHours = Number(timesheet?.totalHours);
  return Number.isFinite(legacyHours) && legacyHours > 0 ? legacyHours : 0;
}
