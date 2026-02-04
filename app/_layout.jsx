// app/_layout.jsx
import { Slot, usePathname, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Footer from "./components/footer";
import ServiceFooter from "./components/service-footer"; // 👈 NEW

import * as Notifications from "expo-notifications";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { addNotificationListeners, registerForPushNotificationsAsync } from "../lib/notifications";
import { AuthProvider, useAuth } from "./providers/AuthProvider";

// 👇 Theme imports
import { ThemeProvider, useTheme } from "./providers/ThemeProvider";

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
  const hideFooter = inAuthGroup;

  const { user, loading: ctxLoading, isAuthed, employee } = useAuth() ?? {};
  const loading = typeof ctxLoading === "boolean" ? ctxLoading : user === undefined;

  // 👇 any route starting with "/service" uses the Service footer
  // e.g. /service, /service/pages/..., /service/whatever
  const isServiceRoute = pathname?.startsWith("/service");

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
      const code = String(employee?.userCode ?? "").padStart(4, "0");
      console.log("AUTH GATE userCode =", code);

      // 🔥 Special rule: userCode 1234 -> Service home
      if (code === "1234") {
        router.replace("/(protected)/service/home");
      } else {
        // Default: everyone else -> normal homescreen
        router.replace("/(protected)/screens/homescreen");
      }
    }
  }, [loading, isAuthed, inAuthGroup, router, employee?.userCode]);


  // Push registration + tap handling
  useEffect(() => {
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
            router.push(`/bookings/${data.bookingId}`);
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

  useEffect(() => {
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
  }, [isAuthed, employee?.userCode]);

  function notify(title, body, data) {
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

    Notifications.scheduleNotificationAsync({
      content: {
        title: safeTitle,
        body: safeBody,
        data,
        sound: "default",
      },
      trigger: null,
    });
  }

  function commonBody(booking) {
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
  }

  function maybeNotifyAssigned(bookingId, booking) {
    if (assignDedupeRef.current[bookingId]) return;
    assignDedupeRef.current[bookingId] = true;
    notify("New job assigned", commonBody(booking), { bookingId });
  }

  function maybeNotifyUpdated(bookingId, before, after) {
    const { changed, changedAny } = diffMeaningful(before, after);
    if (!changedAny) return;

    const sig = JSON.stringify(projection(after));
    if (updateDedupeRef.current[bookingId] === sig) return;
    updateDedupeRef.current[bookingId] = sig;

    const body = `${commonBody(after)} • updated: ${changed.join(", ")}`;
    notify("Job updated", body, { bookingId });
  }

  // ─────────────────────────────────────────────
  // LAYOUT
  // ─────────────────────────────────────────────

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
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
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <ShellInner />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
