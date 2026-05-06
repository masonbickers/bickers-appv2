// app/_layout.jsx
import { Slot, usePathname, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Footer from "../components/app/footer";
import ServiceFooter from "../components/app/service-footer"; // 👈 NEW

import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { resolveWorkspaceAccess } from "../lib/access";
import {
  addNotificationListeners,
  cancelAllScheduledNotifications,
  NOTIFICATIONS_ENABLED,
  registerForPushNotificationsAsync,
  scheduleLocalNotification,
} from "../lib/notifications";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

// 👇 Theme imports
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";

const FOOTER_HEIGHT = 64;
SplashScreen.preventAutoHideAsync().catch(() => {});

/* -------------------- tiny helpers -------------------- */
function toDateSafe(val) {
  if (!val) return null;
  if (val?.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
}
function fmtDDMMYY(val) {
  const d = val instanceof Date ? val : toDateSafe(val);
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
function toISODate(val) {
  const d = val instanceof Date ? val : toDateSafe(val);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function firstISOFromNotifData(data) {
  const d = data || {};
  const direct =
    toISODate(d.dateISO) ||
    toISODate(d.isoDate) ||
    toISODate(d.date) ||
    toISODate(d.jobDate) ||
    toISODate(d.bookingDate);
  if (direct) return direct;

  const raw = d.bookingDates;
  if (Array.isArray(raw) && raw.length > 0) {
    const dates = raw.map(toDateSafe).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) return toISODate(dates[0]);
  }

  const s =
    toDateSafe(d.startDate) ||
    toDateSafe(d.from) ||
    toDateSafe(d.start) ||
    toDateSafe(d.date);
  return toISODate(s);
}
const normStr = (v) => String(v ?? "").trim();

/** shallow array compare after string-normalising */
function arrEq(a, b) {
  const A = Array.isArray(a) ? a.map(normStr) : [];
  const B = Array.isArray(b) ? b.map(normStr) : [];
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
  return true;
}

/** Extract the bits we consider “meaningful” for change detection */
function projection(job) {
  return {
    client: normStr(job?.client),
    location: normStr(job?.location),
    status: normStr(job?.status),
    callTime: normStr(job?.callTime ?? job?.calltime ?? job?.call_time),
    firstDate: normStr(Array.isArray(job?.bookingDates) && job.bookingDates[0]),
    dates: Array.isArray(job?.bookingDates) ? job.bookingDates.map(normStr) : [],
    vehicles: Array.isArray(job?.vehicles) ? job.vehicles.map(normStr) : [],
    dayNote:
      (job?.notesByDate && normStr(job.notesByDate[job?.bookingDates?.[0]])) ||
      normStr(job?.notes),
  };
}

/** Returns {changed: string[] , changedAny: boolean} */
function diffMeaningful(before, after) {
  const b = projection(before || {});
  const a = projection(after || {});
  const changed = [];

  if (a.client !== b.client) changed.push("Production");
  if (a.location !== b.location) changed.push("Location");
  if (!arrEq(a.dates, b.dates)) changed.push("Dates");
  if (!arrEq(a.vehicles, b.vehicles)) changed.push("Vehicles");
  if (a.status !== b.status) changed.push("Status");
  if (a.callTime !== b.callTime) changed.push("Call time");
  if (a.dayNote !== b.dayNote) changed.push("Day note");

  return { changed, changedAny: changed.length > 0 };
}

function ShellInner() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname(); // 👈 NEW

  // 👇 theme
  const { colors, colorScheme } = useTheme();

  const firstSeg = Array.isArray(segments) && segments.length ? String(segments[0]) : "";
  const inAuthGroup = firstSeg.startsWith("(auth)");
  const isWeekRoute = pathname?.startsWith("/week/");
  const isEditProfileRoute = pathname === "/edit-profile";
  const isSettingsRoute = pathname === "/settings";
  const isTimesheetRoute = pathname === "/timesheet";
  const isSpecSheetsRoute = pathname === "/spec-sheets";
  const isInsuranceRoute = pathname === "/insurance";
  const isWorkDiaryRoute = pathname === "/work-diary";
  const isWorkDiaryBoardRoute = pathname === "/work-diary-board";
  const isHolidayPageRoute = pathname === "/holidaypage";
  const isHolidayRequestRoute = pathname === "/holiday-request";
  const isServiceJobFormRoute = pathname?.startsWith("/service/service-form/");
  const isServiceRepairFormRoute = pathname === "/service/repair-form";
  const isServiceDefectDetailRoute = pathname?.startsWith("/service/defects/");
  const isServiceVehicleOverviewRoute =
    pathname?.startsWith("/service/vehicles/") &&
    pathname !== "/service/vehicles";
  const isServiceHistoryRoute =
    pathname === "/service/service-history" ||
    pathname?.startsWith("/service/service-history/");
  const isServiceActivityHistoryRoute = pathname === "/service/activity-history";
  const isServiceRecordRoute = pathname?.startsWith("/service/service-record/");
  const isServiceVehicleTimelineRoute = pathname?.startsWith("/service/vehicle-timeline/");
  const isServiceSettingsRoute = pathname === "/service/settings";
  const isInspectionFormRoute = pathname?.startsWith("/service/inspections/inspection-form/");
  const hideFooter =
    inAuthGroup ||
    isWeekRoute ||
    isEditProfileRoute ||
    isSettingsRoute ||
    isTimesheetRoute ||
    isSpecSheetsRoute ||
    isInsuranceRoute ||
    isWorkDiaryRoute ||
    isWorkDiaryBoardRoute ||
    isHolidayPageRoute ||
    isHolidayRequestRoute ||
    isServiceJobFormRoute ||
    isServiceRepairFormRoute ||
    isServiceDefectDetailRoute ||
    isServiceVehicleOverviewRoute ||
    isServiceHistoryRoute ||
    isServiceActivityHistoryRoute ||
    isServiceRecordRoute ||
    isServiceVehicleTimelineRoute ||
    isServiceSettingsRoute ||
    isInspectionFormRoute;

  const { user, loading: ctxLoading, isAuthed, employee } = useAuth() ?? {};
  const loading = typeof ctxLoading === "boolean" ? ctxLoading : user === undefined;
  const workspaceAccess = resolveWorkspaceAccess(employee);
  const isServiceOnlyUser = workspaceAccess.service && !workspaceAccess.user;
  const lastNotificationNavSig = useRef("");

  // 👇 any route starting with "/service" uses the Service footer
  // e.g. /service, /service/pages/..., /service/whatever
  const isServiceRoute = pathname?.startsWith("/service");
  const rootTopInset = isServiceRoute
    ? Platform.OS === "ios"
      ? Math.max(insets.top, 44)
      : insets.top
    : 0;

  // Hide splash when ready
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  // Auth gate
  useEffect(() => {
    if (loading) return;

    // Not logged in and not in (auth) group -> kick to login
    if (!isAuthed && !inAuthGroup) {
      router.replace("/(auth)/login");
      return;
    }

    // Logged in but still on an (auth) screen (e.g. /login)
    if (isAuthed && inAuthGroup) {
      if (isServiceOnlyUser) {
        router.replace("/(protected)/service/home");
      } else {
        // Default: everyone else -> normal homescreen
        router.replace("/(protected)/screens/homescreen");
      }
    }
  }, [loading, isAuthed, inAuthGroup, isServiceOnlyUser, router]);


  // Push registration + tap handling
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) {
      cancelAllScheduledNotifications();
      return;
    }

    let dispose;
    (async () => {
      if (isAuthed && user?.uid) {
        try {
          const token = await registerForPushNotificationsAsync();
          if (token) {
            await setDoc(
              doc(db, "users", String(user.uid)),
              { expoPushToken: token },
              { merge: true }
            );
          }
        } catch {}
      }
      dispose = addNotificationListeners({
        onReceive: () => {},
        onResponse: (resp) => {
          const data = resp?.notification?.request?.content?.data ?? {};
          if (data && typeof data.bookingId === "string" && data.bookingId) {
            const iso = firstISOFromNotifData(data) || toISODate(new Date());
            const sig = `job:${data.bookingId}:${iso}`;
            if (lastNotificationNavSig.current === sig) return;
            lastNotificationNavSig.current = sig;
            router.push({
              pathname: "/(protected)/screens/schedule",
              params: { date: iso },
            });
            return;
          }
          if (data && typeof data.holidayId === "string" && data.holidayId) {
            const sig = `holiday:${data.holidayId}`;
            if (lastNotificationNavSig.current === sig) return;
            lastNotificationNavSig.current = sig;
            router.push("/holidaypage");
            return;
          }
          if (data && typeof data.deepLink === "string" && data.deepLink) {
            router.push(String(data.deepLink));
          }
        },
      });
    })();
    return () => dispose?.();
  }, [isAuthed, user?.uid, router]);

  // ─────────────────────────────────────────────
  // JOB ASSIGNMENT + UPDATE NOTIFICATIONS
  // ─────────────────────────────────────────────
  const seededRef = useRef(false);
  const prevByIdRef = useRef({});
  const assignDedupeRef = useRef({});
  const updateDedupeRef = useRef({});

  const notify = useCallback((title, body, data) => {
    if (!NOTIFICATIONS_ENABLED) return;

    const safeTitle = String(title ?? "");

    let safeBody = "";
    if (body == null) {
      safeBody = "";
    } else if (typeof body === "string") {
      safeBody = body;
    } else {
      const maybeDateStr = fmtDDMMYY(body);
      safeBody = maybeDateStr ?? String(body);
    }

    scheduleLocalNotification({
      title: safeTitle,
      body: safeBody,
      data,
      seconds: 1,
      writeToInbox: false,
    });
  }, []);

  const commonBody = useCallback((booking) => {
    const dateStr =
      Array.isArray(booking?.bookingDates) && booking.bookingDates.length
        ? fmtDDMMYY(booking.bookingDates[0])
        : null;

    const vehicles =
      Array.isArray(booking?.vehicles) && booking.vehicles.length
        ? booking.vehicles.join(", ")
        : null;

    const parts = [
      booking?.jobNumber ? `Job ${booking.jobNumber}` : null,
      booking?.client || null,
      booking?.location || null,
      vehicles,
      dateStr,
    ].filter(Boolean);

    return parts.join(" • ");
  }, []);

  const maybeNotifyAssigned = useCallback((bookingId, booking) => {
    if (assignDedupeRef.current[bookingId]) return;
    assignDedupeRef.current[bookingId] = true;
    notify("New job assigned", commonBody(booking), { bookingId });
  }, [commonBody, notify]);

  const maybeNotifyUpdated = useCallback((bookingId, before, after) => {
    const { changed, changedAny } = diffMeaningful(before, after);
    if (!changedAny) return;

    const sig = JSON.stringify(projection(after));
    if (updateDedupeRef.current[bookingId] === sig) return;
    updateDedupeRef.current[bookingId] = sig;

    const body = `${commonBody(after)} • updated: ${changed.join(", ")}`;
    notify("Job updated", body, { bookingId });
  }, [commonBody, notify]);

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) return;
    if (!isAuthed || !employee?.userCode) return;

    const q = query(
      collection(db, "bookings"),
      where("employeeCodes", "array-contains", String(employee.userCode))
    );

    const unsub = onSnapshot(q, (snap) => {
      const changes = snap.docChanges();

      for (const chg of changes) {
        const id = chg.doc.id;
        const after = chg.doc.data() || {};
        const before = prevByIdRef.current[id] || {};

        if (!seededRef.current && chg.type === "added") {
          prevByIdRef.current[id] = after;
          continue;
        }

        if (chg.type === "added") {
          maybeNotifyAssigned(id, after);
          prevByIdRef.current[id] = after;
          continue;
        }

        if (chg.type === "modified") {
          const me = String(employee.userCode);
          const beforeCodes = new Set(before?.employeeCodes || []);
          const afterCodes = new Set(after?.employeeCodes || []);

          if (!beforeCodes.has(me) && afterCodes.has(me)) {
            maybeNotifyAssigned(id, after);
          } else if (beforeCodes.has(me) && afterCodes.has(me)) {
            maybeNotifyUpdated(id, before, after);
          }

          prevByIdRef.current[id] = after;
          continue;
        }

        if (chg.type === "removed") {
          delete prevByIdRef.current[id];
        }
      }

      seededRef.current = true;
    });

    return () => unsub();
  }, [isAuthed, employee?.userCode, maybeNotifyAssigned, maybeNotifyUpdated]);

  // ─────────────────────────────────────────────
  // LAYOUT
  // ─────────────────────────────────────────────

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: rootTopInset,
        // 👇 only reserve space for the footer itself; bottom inset handled in footer wrapper
        paddingBottom: hideFooter ? 0 : FOOTER_HEIGHT,
      }}
    >
      <StatusBar
        style={colorScheme === "dark" ? "light" : "dark"}
        backgroundColor={colors.background}
      />

      <Slot />

      {/* Footer + bottom safe area, both using the same colour (colors.surface) */}
      {!hideFooter && (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surface,
          }}
        >
          {isServiceRoute ? <ServiceFooter /> : <Footer />}
          {/* This is the iPhone home-indicator safe area strip */}
          <View
            style={{
              height: insets.bottom,
              backgroundColor: colors.surface,
            }}
          />
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <ThemeProvider>
          <ShellInner />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
