import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { useEffect } from "react";

import { db } from "../firebaseConfig";
import {
  cancelMaintenanceReminder,
  scheduleMaintenanceReminder,
} from "../lib/maintenanceReminders";
import {
  bookingNotificationSignature,
  classifyBookingNotificationTransition,
  isApprovedHolidayStatus,
  timesheetNotificationSignature,
} from "../lib/notificationTransitions";
import {
  cancelPastScheduledNotifications,
  NOTIFICATIONS_ENABLED,
  scheduleLocalNotification,
} from "../lib/notifications";
import {
  cancelTimesheetReminders,
  getActiveTimesheetReminderWeekStart,
  isTimesheetComplete,
  scheduleTimesheetReminders,
} from "../lib/timesheetReminders";
import { useAuth } from "../providers/AuthProvider";
import { useDataCache } from "../providers/DataCacheProvider";
import { useNotificationPreferences } from "../providers/NotificationPreferencesProvider";

function toDateSafe(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISODate(value) {
  const date = value instanceof Date ? value : toDateSafe(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function firstISOFromBooking(booking) {
  if (Array.isArray(booking?.bookingDates) && booking.bookingDates.length > 0) {
    const dates = booking.bookingDates.map(toDateSafe).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) return toISODate(dates[0]);
  }
  return toISODate(
    toDateSafe(booking?.startDate) ||
      toDateSafe(booking?.from) ||
      toDateSafe(booking?.date)
  );
}

function hasCurrentOrFutureDate(record, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (Array.isArray(record?.bookingDates) && record.bookingDates.length > 0) {
    const dates = record.bookingDates.map(toDateSafe).filter(Boolean);
    if (dates.length) {
      return dates.some((value) => {
        const date = new Date(value);
        date.setHours(0, 0, 0, 0);
        return date >= today;
      });
    }
  }
  const end =
    toDateSafe(record?.endDate) ||
    toDateSafe(record?.to) ||
    toDateSafe(record?.startDate) ||
    toDateSafe(record?.from) ||
    toDateSafe(record?.date);
  if (!end) return true;
  end.setHours(0, 0, 0, 0);
  return end >= today;
}

function formatDateShort(date) {
  return date?.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatBookingDates(booking) {
  const dates = Array.isArray(booking?.bookingDates)
    ? booking.bookingDates.map(toDateSafe).filter(Boolean).sort((a, b) => a - b)
    : [];
  if (dates.length) {
    if (dates[0].toDateString() === dates[dates.length - 1].toDateString()) {
      return formatDateShort(dates[0]);
    }
    return `${formatDateShort(dates[0])} → ${formatDateShort(dates[dates.length - 1])}`;
  }
  const start = toDateSafe(booking?.startDate) || toDateSafe(booking?.from) || toDateSafe(booking?.date);
  const end = toDateSafe(booking?.endDate) || toDateSafe(booking?.to);
  if (start && end && start.toDateString() !== end.toDateString()) {
    return `${formatDateShort(start)} → ${formatDateShort(end)}`;
  }
  return start ? formatDateShort(start) : "";
}

function formatVehicles(booking) {
  const vehicles = Array.isArray(booking?.vehicles) ? booking.vehicles : [];
  const labels = vehicles
    .map((vehicle) => {
      if (vehicle && typeof vehicle === "object") {
        const name =
          vehicle.name ||
          [vehicle.manufacturer, vehicle.model].filter(Boolean).join(" ") ||
          vehicle.vehicleName ||
          "";
        const registration = vehicle.registration || vehicle.reg || vehicle.plate || "";
        return registration ? `${name || "Vehicle"} · ${registration}` : name;
      }
      return String(vehicle || "").trim();
    })
    .filter(Boolean);
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function scheduleNotification(payload) {
  scheduleLocalNotification(payload).catch((error) =>
    console.warn("[notifications] local schedule failed:", error)
  );
}

function notifyBooking(action, id, booking) {
  if (!hasCurrentOrFutureDate(booking)) return;
  const dateISO = firstISOFromBooking(booking) || toISODate(new Date());
  const commonData = { bookingId: id, bookingDates: booking?.bookingDates || null, dateISO };
  if (action === "removed") {
    scheduleNotification({
      title: "Job removed",
      body: booking.jobNumber
        ? `Job ${booking.jobNumber} was removed from your schedule`
        : "A job you were assigned to was removed",
      data: commonData,
    });
    return;
  }
  const dates = formatBookingDates(booking);
  const vehicles = formatVehicles(booking);
  scheduleNotification({
    title: action === "assigned" ? "New job assigned" : "Job updated",
    body: [
      booking.jobNumber && `Job ${booking.jobNumber}`,
      dates,
      action === "updated" ? "Details changed" : booking.client,
      action === "assigned" ? booking.location : null,
      vehicles && `Vehicles: ${vehicles}`,
    ]
      .filter(Boolean)
      .join(" • "),
    data: commonData,
  });
}

export function useEmployeeNotifications() {
  const { user, employee, isAuthed, loading } = useAuth();
  const { invalidate } = useDataCache();
  const {
    maintenanceRemindersEnabled,
    maintenanceReminderTime,
    isLoading: preferencesLoading,
  } = useNotificationPreferences();
  const employeeCode = String(employee?.userCode || "").trim();
  const identity = `${user?.uid || ""}:${employee?.companyId || ""}:${employeeCode}`;

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || loading || !isAuthed) return;
    cancelPastScheduledNotifications().catch((error) =>
      console.warn("[notifications] stale cleanup failed:", error)
    );
  }, [identity, isAuthed, loading]);

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || loading || !isAuthed || !employeeCode) return;
    let seeded = false;
    const previous = new Map();
    const lastEvent = new Map();
    const bookingsQuery = query(
      collection(db, "bookings"),
      where("employeeCodes", "array-contains", employeeCode)
    );
    return onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const changes = snapshot.docChanges();
        for (const change of changes) {
          const id = change.doc.id;
          const after = change.type === "removed" ? null : change.doc.data() || {};
          const before = previous.get(id) || null;
          if (!seeded) {
            if (after) previous.set(id, after);
            continue;
          }
          const action = classifyBookingNotificationTransition({
            type: change.type,
            before,
            after,
            employeeCode,
          });
          if (action) {
            const source = action === "removed" ? before : after;
            const signature = `${action}:${bookingNotificationSignature(source)}`;
            if (lastEvent.get(id) !== signature) {
              lastEvent.set(id, signature);
              notifyBooking(action, id, source || {});
            }
          }
          if (after) previous.set(id, after);
          else previous.delete(id);
        }
        if (seeded && changes.length) invalidate("collection:bookings").catch(() => {});
        seeded = true;
      },
      (error) => console.warn("[booking-notifications] listener failed:", error)
    );
  }, [employeeCode, identity, invalidate, isAuthed, loading]);

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || loading || !isAuthed || !employeeCode) return;
    let seeded = false;
    const previous = new Map();
    const notified = new Set();
    const holidaysQuery = query(
      collection(db, "holidays"),
      where("employeeCode", "==", employeeCode)
    );
    return onSnapshot(
      holidaysQuery,
      (snapshot) => {
        const changes = snapshot.docChanges();
        for (const change of changes) {
          const id = change.doc.id;
          const after = change.type === "removed" ? null : change.doc.data() || {};
          const before = previous.get(id) || null;
          if (!seeded) {
            if (after) previous.set(id, after);
            continue;
          }
          if (
            after &&
            isApprovedHolidayStatus(after.status) &&
            !isApprovedHolidayStatus(before?.status) &&
            !notified.has(id) &&
            hasCurrentOrFutureDate(after)
          ) {
            notified.add(id);
            scheduleNotification({
              title: "Holiday approved ✅",
              body: after.startDate || "Your holiday request was approved",
              data: {
                holidayId: id,
                startDate: after.startDate || after.from || after.date || null,
                endDate: after.endDate || after.to || after.startDate || after.from || after.date || null,
              },
            });
          }
          if (!after || !isApprovedHolidayStatus(after.status)) notified.delete(id);
          if (after) previous.set(id, after);
          else previous.delete(id);
        }
        if (seeded && changes.length) invalidate("collection:holidays").catch(() => {});
        seeded = true;
      },
      (error) => console.warn("[holiday-notifications] listener failed:", error)
    );
  }, [employeeCode, identity, invalidate, isAuthed, loading]);

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || loading || !isAuthed || !employeeCode) return;
    const weekStartISO = getActiveTimesheetReminderWeekStart(new Date());
    let lastSignature = "";
    const unsubscribe = onSnapshot(
      doc(db, "timesheets", `${employeeCode}_${weekStartISO}`),
      (snapshot) => {
        const timesheet = snapshot.exists() ? snapshot.data() : null;
        const signature = timesheetNotificationSignature(snapshot.exists(), timesheet);
        if (lastSignature === signature) return;
        lastSignature = signature;
        const operation = isTimesheetComplete(timesheet)
          ? cancelTimesheetReminders(employeeCode, weekStartISO)
          : scheduleTimesheetReminders({ employeeCode, weekStartISO });
        operation.catch((error) =>
          console.warn("[timesheet-reminders] update failed:", error)
        );
      },
      (error) => console.warn("[timesheet-reminders] listener failed:", error)
    );
    return () => {
      unsubscribe();
      cancelTimesheetReminders(employeeCode, weekStartISO).catch((error) =>
        console.warn("[timesheet-reminders] logout cancellation failed:", error)
      );
    };
  }, [employeeCode, identity, isAuthed, loading]);

  useEffect(() => {
    if (
      !NOTIFICATIONS_ENABLED ||
      preferencesLoading ||
      !maintenanceRemindersEnabled ||
      loading ||
      !isAuthed
    ) {
      return;
    }
    return onSnapshot(
      collection(db, "maintenanceBookings"),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          const operation =
            change.type === "removed"
              ? cancelMaintenanceReminder(id)
              : scheduleMaintenanceReminder({
                  bookingId: id,
                  booking: { id, ...(change.doc.data() || {}) },
                  reminderTime: maintenanceReminderTime,
                });
          operation.catch((error) =>
            console.warn("[maintenance-reminders] update failed:", error)
          );
        });
      },
      (error) => console.warn("[maintenance-reminders] listener failed:", error)
    );
  }, [
    identity,
    isAuthed,
    loading,
    maintenanceReminderTime,
    maintenanceRemindersEnabled,
    preferencesLoading,
  ]);
}
