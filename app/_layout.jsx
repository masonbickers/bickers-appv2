// app/_layout.jsx
import { Slot, usePathname, useRouter, useSegments } from "expo-router";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Footer from "../components/app/footer";
import ServiceFooter from "../components/app/service-footer"; // 👈 NEW

import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getRemoteAppConfig } from "../lib/authApi";
import { resolveWorkspaceAccess } from "../lib/access";
import {
  addNotificationListeners,
  cancelAllScheduledNotifications,
  NOTIFICATIONS_ENABLED,
  registerForPushNotificationsAsync,
} from "../lib/notifications";
import { AuthProvider, useAuth } from "../providers/AuthProvider";
import { DataCacheProvider } from "../providers/DataCacheProvider";
import { NotificationPreferencesProvider } from "../providers/NotificationPreferencesProvider";

// 👇 Theme imports
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";

const FOOTER_BAR_HEIGHT = 64;
SplashScreen.preventAutoHideAsync().catch(() => {});

/* -------------------- tiny helpers -------------------- */
function toDateSafe(val) {
  if (!val) return null;
  if (val?.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
}
function toISODate(val) {
  const d = val instanceof Date ? val : toDateSafe(val);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function compareVersions(a = "0.0.0", b = "0.0.0") {
  const left = String(a).split(".").map((part) => Number(part) || 0);
  const right = String(b).split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}
function getCurrentAppVersion() {
  return (
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    Constants.manifest2?.extra?.expoClient?.version ||
    Constants.manifest?.version ||
    "0.0.0"
  );
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
  const lastPushRegistrationRef = useRef("");
  const [updateRequired, setUpdateRequired] = useState(null);

  // 👇 any route starting with "/service" uses the Service footer
  // e.g. /service, /service/pages/..., /service/whatever
  const isServiceRoute = pathname?.startsWith("/service");
  const rootTopInset = isServiceRoute
    ? Platform.OS === "ios"
      ? Math.max(insets.top, 44)
      : insets.top
    : 0;
  const shellBackground =
    isServiceRoute && colorScheme === "light" ? "#FFFFFF" : colors.background;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const showFooter = !hideFooter && !keyboardVisible;

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkAppCompatibility = async () => {
      try {
        const config = await getRemoteAppConfig();
        if (cancelled) return;

        const minVersion = String(config?.minAppVersion || "").trim();
        const currentVersion = getCurrentAppVersion();
        const androidSdk =
          Platform.OS === "android" ? Number(Platform.Version || 0) : null;
        const minAndroidSdk = Number(config?.minAndroidSdk || 0);
        const versionBlocked =
          !!minVersion && compareVersions(currentVersion, minVersion) < 0;
        const androidBlocked =
          Platform.OS === "android" &&
          minAndroidSdk > 0 &&
          androidSdk > 0 &&
          androidSdk < minAndroidSdk;

        if (versionBlocked || androidBlocked) {
          setUpdateRequired({
            message:
              config?.updateMessage ||
              "Please update Bickers to continue signing in.",
            detail: androidBlocked
              ? "This Android version is no longer supported."
              : `Installed version ${currentVersion} is no longer supported.`,
          });
        }
      } catch {}
    };

    checkAppCompatibility();

    return () => {
      cancelled = true;
    };
  }, []);

  // Hide splash when ready
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  // Auth gate
  useEffect(() => {
    if (updateRequired) return;
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
  }, [loading, isAuthed, inAuthGroup, isServiceOnlyUser, router, updateRequired]);


  // Push registration + tap handling
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) {
      cancelAllScheduledNotifications();
      return;
    }

    const dispose = addNotificationListeners({
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
    let cancelled = false;
    (async () => {
      if (isAuthed && user?.uid) {
        try {
          const token = await registerForPushNotificationsAsync();
          if (cancelled) return;
          const registrationSignature = `${user.uid}:${token || ""}`;
          if (token && lastPushRegistrationRef.current !== registrationSignature) {
            await setDoc(
              doc(db, "users", String(user.uid)),
              { expoPushToken: token },
              { merge: true }
            );
            lastPushRegistrationRef.current = registrationSignature;
          }
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [isAuthed, user?.uid, router]);

  if (updateRequired) {
    SplashScreen.hideAsync().catch(() => {});
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 28,
          backgroundColor: colors.background,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 22,
            fontWeight: "700",
            marginBottom: 10,
          }}
        >
          Update required
        </Text>
        <Text style={{ color: colors.text, fontSize: 16, lineHeight: 22 }}>
          {updateRequired.message}
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 14,
            lineHeight: 20,
            marginTop: 10,
          }}
        >
          {updateRequired.detail}
        </Text>
      </View>
    );
  }

  // ─────────────────────────────────────────────
  // LAYOUT
  // ─────────────────────────────────────────────

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: shellBackground,
        paddingTop: rootTopInset,
        paddingBottom: showFooter ? FOOTER_BAR_HEIGHT + insets.bottom : 0,
      }}
    >
      <StatusBar
        style={colorScheme === "dark" ? "light" : "dark"}
        backgroundColor={shellBackground}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={rootTopInset}
      >
        <Slot />
      </KeyboardAvoidingView>

      {/* Footer + bottom safe area, both using the same colour (colors.surface) */}
      {showFooter && (
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
          <DataCacheProvider>
            <NotificationPreferencesProvider>
              <ShellInner />
            </NotificationPreferencesProvider>
          </DataCacheProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
