import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  cancelScheduledNotification,
  scheduleLocalNotification,
} from "./notifications";

const STORAGE_KEY = "@bickers_timesheet_reminders_v1";

function parseStoredMap(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function getStoredMap() {
  return parseStoredMap(await AsyncStorage.getItem(STORAGE_KEY));
}

async function setStoredMap(map) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map || {}));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function atTime(date, hour, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekStart(weekStartISO) {
  const d = new Date(`${weekStartISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekStartISO;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function reminderKey(employeeCode, weekStartISO) {
  return `${String(employeeCode || "").trim()}_${String(weekStartISO || "").trim()}`;
}

export function getActiveTimesheetReminderWeekStart(now = new Date()) {
  const monday = getMonday(now);

  // Monday before 08:00 is the follow-up window for the week that just ended.
  if (now.getDay() === 1) {
    const mondayCutoff = atTime(monday, 8);
    if (now < mondayCutoff) {
      return toISODate(addDays(monday, -7));
    }
  }

  return toISODate(monday);
}

export function isTimesheetComplete(timesheet) {
  if (!timesheet) return false;
  const status = String(timesheet.status || "").trim().toLowerCase();
  return (
    timesheet.submitted === true ||
    timesheet.approved === true ||
    status === "submitted" ||
    status === "approved" ||
    status.startsWith("approved")
  );
}

export async function cancelTimesheetReminders(employeeCode, weekStartISO) {
  const key = reminderKey(employeeCode, weekStartISO);
  if (!key.trim()) return;

  const map = await getStoredMap();
  const entry = map[key];
  const ids = Array.isArray(entry?.notificationIds) ? entry.notificationIds : [];

  await Promise.all(ids.map((id) => cancelScheduledNotification(id)));

  if (map[key]) {
    delete map[key];
    await setStoredMap(map);
  }
}

export async function scheduleTimesheetReminders({ employeeCode, weekStartISO, now = new Date() }) {
  if (!employeeCode || !weekStartISO) return [];

  await cancelTimesheetReminders(employeeCode, weekStartISO);

  const weekStart = new Date(`${weekStartISO}T00:00:00`);
  if (Number.isNaN(weekStart.getTime())) return [];

  const reminders = [
    { name: "sunday", date: atTime(addDays(weekStart, 6), 18) },
    { name: "monday", date: atTime(addDays(weekStart, 7), 8) },
    { name: "monday-midday", date: atTime(addDays(weekStart, 7), 12) },
  ].filter((reminder) => reminder.date.getTime() > now.getTime() + 30_000);

  const notificationIds = [];
  for (const reminder of reminders) {
    const id = await scheduleLocalNotification({
      title: "Timesheet reminder",
      body: `Please complete your timesheet for week commencing ${formatWeekStart(weekStartISO)}.`,
      date: reminder.date,
      data: {
        type: "timesheet-reminder",
        reminder: reminder.name,
        employeeCode: String(employeeCode),
        weekStart: weekStartISO,
        deepLink: `/(protected)/week/${weekStartISO}`,
      },
      writeToInbox: false,
    });

    if (id) notificationIds.push(id);
  }

  const key = reminderKey(employeeCode, weekStartISO);
  const map = await getStoredMap();
  if (notificationIds.length > 0) {
    map[key] = {
      employeeCode: String(employeeCode),
      weekStartISO,
      notificationIds,
      scheduledAt: new Date().toISOString(),
    };
  } else {
    delete map[key];
  }
  await setStoredMap(map);

  return notificationIds;
}
