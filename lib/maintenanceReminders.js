import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  cancelScheduledNotification,
  scheduleLocalNotification,
} from "./notifications";

export const MAINTENANCE_REMINDERS_SETTING_KEY =
  "@bickers_maintenance_job_reminders_enabled_v1";
export const MAINTENANCE_REMINDERS_TIME_KEY =
  "@bickers_maintenance_job_reminders_time_v1";
export const DEFAULT_MAINTENANCE_REMINDER_TIME = "09:00";

const STORAGE_KEY = "@bickers_maintenance_job_reminders_v1";

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

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 9, 0, 0, 0);
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(date) {
  const d = date instanceof Date ? date : toJsDate(date);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function applyTime(date, timeValue) {
  const value = String(timeValue || "").trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  const next = new Date(date);
  if (match) {
    next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  } else {
    next.setHours(9, 0, 0, 0);
  }
  return next;
}

function getMaintenanceDate(booking) {
  const date =
    toJsDate(
      booking?.appointmentDateISO ||
        booking?.startDateISO ||
        booking?.bookingDate ||
        booking?.date ||
        booking?.startDate
    ) || null;

  if (!date) return null;

  return applyTime(
    date,
    booking?.appointmentTime || booking?.startTime || booking?.time || booking?.serviceTime
  );
}

function normaliseReminderTime(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return DEFAULT_MAINTENANCE_REMINDER_TIME;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_MAINTENANCE_REMINDER_TIME;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getReminderDate(bookingDate, reminderTime) {
  const reminder = new Date(bookingDate);
  reminder.setDate(reminder.getDate() - 1);
  const [hour, minute] = normaliseReminderTime(reminderTime).split(":").map(Number);
  reminder.setHours(hour, minute, 0, 0);
  return reminder;
}

function isOpenMaintenanceBooking(booking) {
  const status = String(booking?.status || "Booked").trim().toLowerCase();
  if (!status) return true;
  return ![
    "cancelled",
    "canceled",
    "complete",
    "completed",
    "done",
    "resolved",
    "closed",
  ].includes(status);
}

function formatDate(date) {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatVehicle(booking) {
  return (
    booking?.vehicleLabel ||
    booking?.vehicleName ||
    booking?.name ||
    [booking?.manufacturer, booking?.model].filter(Boolean).join(" ") ||
    booking?.vehicleId ||
    "Vehicle"
  );
}

function reminderKey(bookingId) {
  return String(bookingId || "").trim();
}

function bookingSignature(booking, bookingDate, reminderDate) {
  return JSON.stringify({
    status: booking?.status || "",
    vehicleId: booking?.vehicleId || "",
    vehicleLabel: booking?.vehicleLabel || booking?.vehicleName || "",
    jobType: booking?.jobType || booking?.maintenanceType || booking?.serviceType || "",
    dateISO: toISODate(bookingDate),
    reminderAt: reminderDate.toISOString(),
  });
}

export async function getMaintenanceRemindersEnabled() {
  return AsyncStorage.getItem(MAINTENANCE_REMINDERS_SETTING_KEY).then(
    (value) => value === "true"
  );
}

export async function setMaintenanceRemindersEnabled(enabled) {
  await AsyncStorage.setItem(
    MAINTENANCE_REMINDERS_SETTING_KEY,
    enabled ? "true" : "false"
  );
}

export async function getMaintenanceReminderTime() {
  return AsyncStorage.getItem(MAINTENANCE_REMINDERS_TIME_KEY).then(
    normaliseReminderTime
  );
}

export async function setMaintenanceReminderTime(time) {
  await AsyncStorage.setItem(
    MAINTENANCE_REMINDERS_TIME_KEY,
    normaliseReminderTime(time)
  );
}

export async function cancelMaintenanceReminder(bookingId) {
  const key = reminderKey(bookingId);
  if (!key) return;

  const map = await getStoredMap();
  const entry = map[key];
  if (entry?.notificationId) {
    await cancelScheduledNotification(entry.notificationId);
  }

  if (map[key]) {
    delete map[key];
    await setStoredMap(map);
  }
}

export async function cancelAllMaintenanceReminders() {
  const map = await getStoredMap();
  const entries = Object.values(map);
  await Promise.all(
    entries
      .map((entry) => entry?.notificationId)
      .filter(Boolean)
      .map((id) => cancelScheduledNotification(id))
  );
  await setStoredMap({});
}

export async function scheduleMaintenanceReminder({
  bookingId,
  booking,
  reminderTime = DEFAULT_MAINTENANCE_REMINDER_TIME,
  now = new Date(),
}) {
  const key = reminderKey(bookingId);
  if (!key || !isOpenMaintenanceBooking(booking)) {
    await cancelMaintenanceReminder(key);
    return null;
  }

  const bookingDate = getMaintenanceDate(booking);
  if (!bookingDate) {
    await cancelMaintenanceReminder(key);
    return null;
  }

  const reminderDate = getReminderDate(bookingDate, reminderTime);
  if (reminderDate.getTime() <= now.getTime() + 30_000) {
    await cancelMaintenanceReminder(key);
    return null;
  }

  const sig = bookingSignature(booking, bookingDate, reminderDate);
  const map = await getStoredMap();
  if (map[key]?.signature === sig && map[key]?.notificationId) {
    return map[key].notificationId;
  }

  if (map[key]?.notificationId) {
    await cancelScheduledNotification(map[key].notificationId);
  }

  const jobType =
    booking?.jobType ||
    booking?.maintenanceType ||
    booking?.serviceType ||
    "Maintenance job";
  const vehicle = formatVehicle(booking);

  const notificationId = await scheduleLocalNotification({
    title: "Maintenance job tomorrow",
    body: `${jobType} booked for ${vehicle} on ${formatDate(bookingDate)}.`,
    date: reminderDate,
    data: {
      type: "maintenance-job-reminder",
      maintenanceBookingId: key,
      dateISO: toISODate(bookingDate),
      deepLink: "/(protected)/service/book-work",
    },
    writeToInbox: false,
  });

  if (notificationId) {
    map[key] = {
      notificationId,
      signature: sig,
      bookingDateISO: toISODate(bookingDate),
      reminderAt: reminderDate.toISOString(),
      scheduledAt: new Date().toISOString(),
    };
  } else {
    delete map[key];
  }

  await setStoredMap(map);
  return notificationId;
}
