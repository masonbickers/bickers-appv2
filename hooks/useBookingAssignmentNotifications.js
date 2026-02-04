// hooks/useBookingAssignmentNotifications.js
import { useRouter } from "expo-router";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { db } from "../../firebaseConfig";
import {
  addNotificationListeners,
  registerForPushNotificationsAsync,
  scheduleLocalNotification,
} from "../../lib/notifications";

/* ------------------------------ helpers ------------------------------ */

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp

  if (typeof value === "string") {
    // allow YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Date(y, m - 1, d, 12, 0, 0, 0);
    }
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtShortDate(value) {
  const d = toJsDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function buildVehicleLabel(v) {
  // Prefer explicit booking objects:
  // { id, name, registration } etc.
  if (v && typeof v === "object") {
    const name =
      v.name ||
      [v.manufacturer, v.model].filter(Boolean).join(" ") ||
      "";
    const reg = v.registration || v.reg || v.plate || "";
    return [name, reg].filter(Boolean).join(" · ") || "Vehicle";
  }
  // If just a string, we’ll map it via lookup later
  return safeStr(v);
}

/* -------------------------------------------------------------------- */

export function useBookingAssignmentNotifications(employee) {
  const router = useRouter();

  const seeded = useRef(false);
  const prevMap = useRef(new Map());
  const dedupe = useRef(new Set());

  // ✅ Vehicles lookup map: id -> "Name · REG"
  const vehiclesLookupRef = useRef(new Map());

  useEffect(() => {
    const code = employee?.userCode;
    if (!code) return;

    // reset when employee changes
    seeded.current = false;
    prevMap.current = new Map();
    dedupe.current = new Set();

    let unsub = null;
    let removeNotifListeners = () => {};

    (async () => {
      // Load push + listeners
      await registerForPushNotificationsAsync();

      removeNotifListeners = addNotificationListeners({
        onResponse: (resp) => {
          const id = resp?.notification?.request?.content?.data?.bookingId;
          if (id) {
            setTimeout(() => {
              router.push(`/(protected)/bookings/${id}`);
            }, 50);
          }
        },
      });

      // ✅ Build vehicle lookup ONCE (fast local mapping for notifs)
      try {
        const vehiclesSnap = await getDocs(collection(db, "vehicles"));
        const map = new Map();
        vehiclesSnap.docs.forEach((d) => {
          const v = { id: d.id, ...d.data() };
          const name =
            v.name ||
            [v.manufacturer, v.model].filter(Boolean).join(" ") ||
            "Vehicle";
          const reg = v.registration || v.reg || v.plate || "";
          const label = [name, reg].filter(Boolean).join(" · ");

          // map by id
          map.set(String(d.id), label);

          // also map by registration (common if bookings store reg strings)
          if (reg) map.set(String(reg).trim().toUpperCase(), label);

          // also map by plain name (least reliable but helpful)
          if (name) map.set(String(name).trim().toLowerCase(), label);
        });
        vehiclesLookupRef.current = map;
      } catch (e) {
        console.warn("Failed to load vehicles for notification mapping:", e);
        vehiclesLookupRef.current = new Map();
      }

      // Listen to my bookings
      const q = query(
        collection(db, "bookings"),
        where("employeeCodes", "array-contains", code)
      );

      unsub = onSnapshot(q, (snap) => {
        snap.docChanges().forEach((chg) => {
          const docId = chg.doc.id;
          const after = chg.doc.data() || {};
          const before = prevMap.current.get(docId) || {};
          const me = code;

          // Initial seed: don't spam notifications for existing docs
          if (!seeded.current && chg.type === "added") {
            prevMap.current.set(docId, after);
            return;
          }

          if (chg.type === "added") {
            notifyOnce(docId, me, after);
            prevMap.current.set(docId, after);
            return;
          }

          if (chg.type === "modified") {
            const wasIn = new Set(before.employeeCodes || []).has(me);
            const nowIn = new Set(after.employeeCodes || []).has(me);
            if (!wasIn && nowIn) notifyOnce(docId, me, after);
            prevMap.current.set(docId, after);
            return;
          }

          if (chg.type === "removed") {
            prevMap.current.delete(docId);
          }
        });

        seeded.current = true;
      });
    })();

    return () => {
      unsub?.();
      removeNotifListeners?.();
    };
  }, [employee?.userCode]);

  function formatVehiclesForNotification(booking) {
    const list = Array.isArray(booking?.vehicles) ? booking.vehicles : [];
    if (!list.length) return null;

    const map = vehiclesLookupRef.current || new Map();

    const labels = list
      .map((v) => {
        // if booking stored full object, build label directly
        if (v && typeof v === "object") return buildVehicleLabel(v);

        // otherwise interpret string as id/reg/name and map it
        const raw = safeStr(v);
        if (!raw) return null;

        const byId = map.get(raw);
        if (byId) return byId;

        const byReg = map.get(raw.trim().toUpperCase());
        if (byReg) return byReg;

        const byName = map.get(raw.trim().toLowerCase());
        if (byName) return byName;

        // fallback
        return raw;
      })
      .filter(Boolean);

    // Avoid a massive notification body
    if (!labels.length) return null;
    if (labels.length <= 2) return labels.join(", ");
    return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
  }

  function notifyOnce(docId, me, b) {
    const key = `${docId}:${me}`;
    if (dedupe.current.has(key)) return;
    dedupe.current.add(key);

    const firstDate = Array.isArray(b.bookingDates) ? b.bookingDates[0] : null;
    const niceDate = fmtShortDate(firstDate);

    const vehiclesPretty = formatVehiclesForNotification(b);

    const bodyParts = [
      b.jobNumber ? `Job #${b.jobNumber}` : "Job",
      b.client || null,
      niceDate || null,
      vehiclesPretty ? `Vehicles: ${vehiclesPretty}` : null,
    ].filter(Boolean);

    scheduleLocalNotification({
      title: "New job assigned",
      body: bodyParts.join(" • "),
      data: { bookingId: docId },
      seconds: 1, // reliable trigger
    });
  }
}
