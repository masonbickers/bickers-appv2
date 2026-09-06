const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value) {
  return String(value || "").trim();
}

export function isValidTimesheetWeekStart(value) {
  const weekStart = clean(value);
  if (!ISO_DATE_RE.test(weekStart)) return false;

  const date = new Date(`${weekStart}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === weekStart;
}

export function getTimesheetReminderWeekStart(data = {}) {
  const direct = clean(data?.weekStart || data?.weekISO);
  if (isValidTimesheetWeekStart(direct)) return direct;

  const deepLink = clean(data?.deepLink);
  const match = deepLink.match(/(?:^|\/)week\/(\d{4}-\d{2}-\d{2})(?:[/?#]|$)/);
  return isValidTimesheetWeekStart(match?.[1]) ? match[1] : "";
}

export function isTimesheetReminder(data = {}) {
  const type = clean(data?.type).toLowerCase();
  return type === "timesheet-reminder" && !!getTimesheetReminderWeekStart(data);
}

export function getTimesheetReminderHref(data = {}) {
  const weekStart = getTimesheetReminderWeekStart(data);
  return weekStart ? `/(protected)/week/${weekStart}` : "";
}
