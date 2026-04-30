// app/(protected)/_layout.jsx
import { Stack } from "expo-router";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";

import { db } from "../../firebaseConfig";
import { useSyncManager } from "../../hooks/useSyncManager";
import { useAuth } from "../../providers/AuthProvider";

import {
  NOTIFICATIONS_ENABLED,
  scheduleLocalNotification,
} from "../../lib/notifications";

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

  // ============================================================
  // VEHICLE LOOKUP (id -> "Name · REG")
  // ============================================================
  const [vehicleMap, setVehicleMap] = useState({});

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) {
      setVehicleMap({});
      return;
    }
    if (loading || !isAuthed) {
      setVehicleMap({});
      return;
    }

    let alive = true;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "vehicles"));
        const map = {};
        snap.docs.forEach((d) => {
          const v = d.data() || {};
          const name =
            v.name ||
            [v.manufacturer, v.model].filter(Boolean).join(" ") ||
            v.vehicleName ||
            "Vehicle";
          const reg = v.registration || v.reg || v.plate || "";
          map[d.id] = reg ? `${name} · ${reg}` : name;
        });

        if (alive) setVehicleMap(map);
      } catch (e) {
        console.warn("[vehicles] failed to load vehicles for notifications:", e);
        if (alive) setVehicleMap({});
      }
    })();

    return () => {
      alive = false;
    };
  }, [loading, isAuthed]);

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

        // Otherwise treat as string id / reg / name
        const key = String(v ?? "").trim();
        if (!key) return "";

        // 1) Exact Firestore doc id match
        if (vehicleMap[key]) return vehicleMap[key];

        // 2) If bookings store reg/name instead of doc id, just show it
        return key;
      })
      .filter(Boolean);

    if (readable.length === 0) return "";
    // Keep notifications short: show up to 2 vehicles then +N
    if (readable.length <= 2) return readable.join(", ");
    return `${readable.slice(0, 2).join(", ")} +${readable.length - 2}`;
  }, [vehicleMap]);

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

  // ============================================================
  // JOB NOTIFICATIONS
  // ============================================================
  const seededBookings = useRef(false);
  const prevBookingMap = useRef(new Map());
  const assignmentDedupe = useRef(new Set());
  const updateDedupe = useRef(new Map());

  // ---------- Notification Helpers ----------
  const notifyBookingAssigned = useCallback((docId, booking) => {
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

    console.log("📡 Booking listener ACTIVE for:", me);

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

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "none",
      }}
    />
  );
}
