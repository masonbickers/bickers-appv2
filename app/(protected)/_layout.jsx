// app/(protected)/_layout.jsx
import { Stack } from "expo-router";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";

import { db } from "../../firebaseConfig";
import { useSyncManager } from "../../hooks/useSyncManager";
import { useAuth } from "../../providers/AuthProvider";

import {
  NOTIFICATIONS_ENABLED,
  scheduleLocalNotification,
} from "../../lib/notifications";
import {
  cancelMaintenanceReminder,
  DEFAULT_MAINTENANCE_REMINDER_TIME,
  getMaintenanceReminderTime,
  getMaintenanceRemindersEnabled,
  scheduleMaintenanceReminder,
} from "../../lib/maintenanceReminders";
import {
  cancelTimesheetReminders,
  getActiveTimesheetReminderWeekStart,
  isTimesheetComplete,
  scheduleTimesheetReminders,
} from "../../lib/timesheetReminders";

/* ------------------------------ helpers ------------------------------ */
function toDateSafe(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (val?.toDate && typeof val.toDate === "function") return val.toDate(); // Firestore Timestamp
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(val) {
  const d = val instanceof Date ? val : toDateSafe(val);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function firstISOFromBooking(booking) {
  // Prefer bookingDates array
  const raw = booking?.bookingDates;
  if (Array.isArray(raw) && raw.length > 0) {
    const dates = raw.map(toDateSafe).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) return toISODate(dates[0]);
  }

  // Fallback fields
  const s =
    toDateSafe(booking?.startDate) ||
    toDateSafe(booking?.from) ||
    toDateSafe(booking?.date);
  return toISODate(s);
}

function bookingHasCurrentOrFutureDate(booking, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const raw = booking?.bookingDates;
  if (Array.isArray(raw) && raw.length > 0) {
    const dates = raw.map(toDateSafe).filter(Boolean);
    if (dates.length > 0) {
      return dates.some((date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d >= today;
      });
    }
  }

  const end =
    toDateSafe(booking?.endDate) ||
    toDateSafe(booking?.to) ||
    toDateSafe(booking?.startDate) ||
    toDateSafe(booking?.from) ||
    toDateSafe(booking?.date);

  if (!end) return true;
  end.setHours(0, 0, 0, 0);
  return end >= today;
}

function formatDateShort(d) {
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export default function ProtectedLayout() {
  const { user, employee, isAuthed, loading, setJobsUpdatedAt } = useAuth();
  const [maintenanceRemindersEnabled, setMaintenanceRemindersEnabledState] =
    useState(false);
  const [maintenanceReminderTime, setMaintenanceReminderTimeState] =
    useState(DEFAULT_MAINTENANCE_REMINDER_TIME);

  useSyncManager({
    enabled: isAuthed && !loading,
    getAuthToken: async () => {
      if (!user || user.isAnonymous) return null;
      return user.getIdToken();
    },
    onRemoteChangesApplied: (applied) => {
      if (applied > 0) {
        setJobsUpdatedAt(Date.now());
      }
    },
  });

  const formatVehiclesForNotif = useCallback((booking) => {
    const raw = booking?.vehicles;

    if (!Array.isArray(raw) || raw.length === 0) return "";

    const readable = raw
      .map((v) => {
        // If already an object with name, prefer it
        if (v && typeof v === "object") {
          const name =
            v.name ||
            [v.manufacturer, v.model].filter(Boolean).join(" ") ||
            v.vehicleName ||
            "";
          const reg = v.registration || v.reg || v.plate || "";
          const out = reg ? `${name || "Vehicle"} · ${reg}` : name || reg || "";
          return String(out || "").trim();
        }

        // Otherwise treat as string id / reg / name without resolving globally.
        const key = String(v ?? "").trim();
        if (!key) return "";
        return key;
      })
      .filter(Boolean);

    if (readable.length === 0) return "";
    // Keep notifications short: show up to 2 vehicles then +N
    if (readable.length <= 2) return readable.join(", ");
    return `${readable.slice(0, 2).join(", ")} +${readable.length - 2}`;
  }, []);

  const formatJobDatesForNotif = useCallback((booking) => {
    // Prefer bookingDates array (string / Date / Firestore Timestamp)
    const raw = booking?.bookingDates;

    if (Array.isArray(raw) && raw.length > 0) {
      const dates = raw.map(toDateSafe).filter(Boolean).sort((a, b) => a - b);

      if (dates.length === 0) return "";

      const start = dates[0];
      const end = dates[dates.length - 1];

      if (start.toDateString() === end.toDateString()) {
        return formatDateShort(start);
      }
      return `${formatDateShort(start)} → ${formatDateShort(end)}`;
    }

    // Fallback fields some schemas use
    const s =
      toDateSafe(booking?.startDate) ||
      toDateSafe(booking?.from) ||
      toDateSafe(booking?.date);

    const e = toDateSafe(booking?.endDate) || toDateSafe(booking?.to) || null;

    if (s && e && s.toDateString() !== e.toDateString()) {
      return `${formatDateShort(s)} → ${formatDateShort(e)}`;
    }
    if (s) return formatDateShort(s);

    return "";
  }, []);

  // ============================================================
  // PROJECTOR (unchanged)
  // ============================================================
  const projectJob = useCallback((job) => {
    if (!job) return {};

    return {
      jobNumber: String(job.jobNumber || ""),
      client: String(job.client || ""),
      location: String(job.location || ""),
      status: String(job.status || ""),

      callTime: String(job.callTime || job.call_time || job.calltime || ""),

      vehicles: JSON.stringify(job.vehicles || []),
      equipment: JSON.stringify(job.equipment || []),
      employees: JSON.stringify(job.employees || []),

      employeesByDate: JSON.stringify(
        job.employeesByDate || job.employeeAssignmentsByDate || {}
      ),
      callTimes: JSON.stringify(job.callTimes || job.callTimesByDate || {}),
      notesByDate: JSON.stringify(job.notesByDate || {}),
      statusByDate: JSON.stringify(job.statusByDate || {}),

      recceForms: JSON.stringify(job.recceForms || {}),

      bookingDates: JSON.stringify(job.bookingDates || []),
    };
  }, []);

  const jobChanged = useCallback((before, after) => {
    return JSON.stringify(projectJob(before)) !== JSON.stringify(projectJob(after));
  }, [projectJob]);

  useEffect(() => {
    let alive = true;

    const refreshSetting = () => {
      Promise.all([
        getMaintenanceRemindersEnabled(),
        getMaintenanceReminderTime(),
      ])
        .then(([enabled, reminderTime]) => {
          if (!alive) return;
          setMaintenanceRemindersEnabledState(enabled);
          setMaintenanceReminderTimeState(reminderTime);
        })
        .catch((e) => {
          console.warn("[maintenance-reminders] setting load failed:", e);
        });
    };

    refreshSetting();

    const interval = setInterval(refreshSetting, 1500);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  // ============================================================
  // JOB NOTIFICATIONS
  // ============================================================
  const seededBookings = useRef(false);
  const prevBookingMap = useRef(new Map());
  const assignmentDedupe = useRef(new Set());
  const updateDedupe = useRef(new Map());

  // ---------- Notification Helpers ----------
  const notifyBookingAssigned = useCallback((docId, booking) => {
    if (!bookingHasCurrentOrFutureDate(booking)) return;

    const key = `${docId}:assigned`;
    if (assignmentDedupe.current.has(key)) return;
    assignmentDedupe.current.add(key);

    const vehiclesText = formatVehiclesForNotif(booking);
    const datesText = formatJobDatesForNotif(booking);

    // ✅ include the FIRST date ISO for schedule routing
    const dateISO = firstISOFromBooking(booking) || toISODate(new Date());

    scheduleLocalNotification({
      title: "New job assigned",
      body: [
        booking.jobNumber && `Job ${booking.jobNumber}`,
        datesText ? `${datesText}` : null,
        booking.client,
        booking.location,
        vehiclesText ? `Vehicles: ${vehiclesText}` : null,
      ]
        .filter(Boolean)
        .join(" • "),
      data: {
        bookingId: docId,
        bookingDates: booking?.bookingDates || null,
        dateISO, // ✅ NEW
      },
    });
  }, [formatJobDatesForNotif, formatVehiclesForNotif]);

  const notifyJobUpdated = useCallback((docId, booking) => {
    if (!bookingHasCurrentOrFutureDate(booking)) return;

    const vehiclesText = formatVehiclesForNotif(booking);
    const datesText = formatJobDatesForNotif(booking);

    const dateISO = firstISOFromBooking(booking) || toISODate(new Date());

    scheduleLocalNotification({
      title: "Job updated",
      body: [
        booking.jobNumber && `Job ${booking.jobNumber}`,
        datesText ? `${datesText}` : null,
        "Details changed",
        vehiclesText ? `Vehicles: ${vehiclesText}` : null,
      ]
        .filter(Boolean)
        .join(" • "),
      data: {
        bookingId: docId,
        bookingDates: booking?.bookingDates || null,
        dateISO, // ✅ NEW
      },
    });
  }, [formatJobDatesForNotif, formatVehiclesForNotif]);

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) return;
    if (loading || !isAuthed || !employee?.userCode) return;

    const me = employee.userCode;

    const q = query(
      collection(db, "bookings"),
      where("employeeCodes", "array-contains", me)
    );

    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((chg) => {
        const id = chg.doc.id;
        const after = chg.doc.data() || {};
        const before = prevBookingMap.current.get(id) || {};

        if (!seededBookings.current && chg.type === "added") {
          prevBookingMap.current.set(id, after);
          return;
        }

        if (chg.type === "added") {
          notifyBookingAssigned(id, after);
          prevBookingMap.current.set(id, after);
          return;
        }

        if (chg.type === "modified") {
          const beforeSet = new Set(before.employeeCodes || []);
          const afterSet = new Set(after.employeeCodes || []);

          const wasMine = beforeSet.has(me);
          const nowMine = afterSet.has(me);

          if (!wasMine && nowMine) {
            notifyBookingAssigned(id, after);
            prevBookingMap.current.set(id, after);
            return;
          }

          if (wasMine && nowMine && jobChanged(before, after)) {
            const sig = JSON.stringify(projectJob(after));
            if (updateDedupe.current.get(id) !== sig) {
              updateDedupe.current.set(id, sig);
              notifyJobUpdated(id, after);
            }
          }

          prevBookingMap.current.set(id, after);
          return;
        }

        if (chg.type === "removed") {
          const beforeData = prevBookingMap.current.get(id);
          if (beforeData?.employeeCodes?.includes(me)) {
            notifyJobDeleted(id, beforeData);
          }
          prevBookingMap.current.delete(id);
        }
      });

      seededBookings.current = true;
    });

    return () => unsub();
  }, [loading, isAuthed, employee?.userCode, jobChanged, notifyBookingAssigned, notifyJobUpdated, projectJob]);

  function notifyJobDeleted(docId, booking) {
    if (!bookingHasCurrentOrFutureDate(booking)) return;

    scheduleLocalNotification({
      title: "Job removed",
      body: booking.jobNumber
        ? `Job ${booking.jobNumber} was removed from your schedule`
        : "A job you were assigned to was removed",
      data: { bookingId: docId },
    });
  }

  // ============================================================
  // HOLIDAY NOTIFICATIONS (unchanged)
  // ============================================================
  const seededHolidays = useRef(false);
  const prevHolidayMap = useRef(new Map());
  const holidayDedupe = useRef(new Set());
  const timesheetReminderSigRef = useRef("");

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) return;
    if (loading || !isAuthed || !employee?.userCode) return;

    const qH = query(
      collection(db, "holidays"),
      where("employeeCode", "==", employee.userCode)
    );

    const unsub = onSnapshot(qH, (snap) => {
      snap.docChanges().forEach((chg) => {
        const id = chg.doc.id;
        const after = chg.doc.data() || {};
        const before = prevHolidayMap.current.get(id) || {};

        if (!seededHolidays.current && chg.type === "added") {
          prevHolidayMap.current.set(id, after);
          return;
        }

        if (chg.type === "added" && isApproved(after.status)) {
          notifyHolidayApproved(id, after);
          prevHolidayMap.current.set(id, after);
          return;
        }

        if (chg.type === "modified") {
          const was = isApproved(before.status);
          const now = isApproved(after.status);
          if (!was && now) notifyHolidayApproved(id, after);
          prevHolidayMap.current.set(id, after);
        }

        if (chg.type === "removed") {
          prevHolidayMap.current.delete(id);
        }
      });

      seededHolidays.current = true;
    });

    return () => unsub();
  }, [loading, isAuthed, employee?.userCode]);

  function isApproved(status) {
    const s = String(status || "").toLowerCase().trim();
    return s === "approved" || s.startsWith("approved");
  }

  function notifyHolidayApproved(docId, hol) {
    const key = `${docId}:approved`;
    if (holidayDedupe.current.has(key)) return;
    holidayDedupe.current.add(key);

    scheduleLocalNotification({
      title: "Holiday approved ✅",
      body: hol.startDate || "Your holiday request was approved",
      data: { holidayId: docId },
    });
  }

  // ============================================================
  // TIMESHEET REMINDERS
  // Sunday 18:00 and following Monday 08:00, cancelled once submitted.
  // ============================================================
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) return;
    if (loading || !isAuthed || !employee?.userCode) return;

    const employeeCode = String(employee.userCode);
    const weekStartISO = getActiveTimesheetReminderWeekStart(new Date());
    const ref = doc(db, "timesheets", `${employeeCode}_${weekStartISO}`);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const timesheet = snap.exists() ? snap.data() : null;

        const nextSig = JSON.stringify({
          exists: snap.exists(),
          submitted: timesheet?.submitted === true,
          approved: timesheet?.approved === true,
          status: String(timesheet?.status || ""),
          submittedAt: timesheet?.submittedAt || null,
          approvedAt: timesheet?.approvedAt || null,
        });
        if (timesheetReminderSigRef.current === nextSig) return;
        timesheetReminderSigRef.current = nextSig;

        if (isTimesheetComplete(timesheet)) {
          cancelTimesheetReminders(employeeCode, weekStartISO).catch((e) =>
            console.warn("[timesheet-reminders] cancel failed:", e)
          );
          return;
        }

        scheduleTimesheetReminders({ employeeCode, weekStartISO }).catch((e) =>
          console.warn("[timesheet-reminders] schedule failed:", e)
        );
      },
      (e) => {
        console.warn("[timesheet-reminders] listener failed:", e);
      }
    );

    return () => unsub();
  }, [loading, isAuthed, employee?.userCode]);

  // ============================================================
  // MAINTENANCE JOB REMINDERS
  // One local reminder the day before each booked maintenance job.
  // ============================================================
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) return;
    if (!maintenanceRemindersEnabled) return;
    if (loading || !isAuthed) return;

    const unsub = onSnapshot(
      collection(db, "maintenanceBookings"),
      (snap) => {
        snap.docChanges().forEach((chg) => {
          const id = chg.doc.id;

          if (chg.type === "removed") {
            cancelMaintenanceReminder(id).catch((e) =>
              console.warn("[maintenance-reminders] cancel failed:", e)
            );
            return;
          }

          scheduleMaintenanceReminder({
            bookingId: id,
            booking: { id, ...(chg.doc.data() || {}) },
            reminderTime: maintenanceReminderTime,
          }).catch((e) =>
            console.warn("[maintenance-reminders] schedule failed:", e)
          );
        });
      },
      (e) => {
        console.warn("[maintenance-reminders] listener failed:", e);
      }
    );

    return () => unsub();
  }, [loading, isAuthed, maintenanceRemindersEnabled, maintenanceReminderTime]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "none",
      }}
    />
  );
}
