import { AppText as Text } from "../components/ui/AppPrimitives";
// app/_layout.jsx
import {
  Slot,
  usePathname,
  useRouter,
  useSegments } from "expo-router";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React,
  { useEffect,
  useRef,
  useState } from "react";
import {
  AppState,
  Keyboard,
  Platform,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import Footer from "../components/app/footer";
import ServiceFooter from "../components/app/service-footer"; // 👈 NEW
import RootSurface from "../components/layout/RootSurface";

import { getRemoteAppConfig, registerDeviceToken } from "../lib/authApi";
import { resolveAppChrome } from "../lib/appChrome";
import { isAppUpdateRequired } from "../lib/appVersion";
import { resolveWorkspaceAccess } from "../lib/access";
import {
  addNotificationListeners,
  cancelAllScheduledNotifications,
  consumeInitialNotificationResponseAsync,
  NOTIFICATIONS_ENABLED,
  reconcilePresentedNotificationsToInbox,
  registerForPushNotificationsAsync,
} from "../lib/notifications";
import {
  getTimesheetReminderHref,
  getTimesheetReminderWeekStart,
  isTimesheetReminder,
} from "../lib/timesheetNotification";
import { AuthProvider, useAuth } from "../providers/AuthProvider";
import { DataCacheProvider } from "../providers/DataCacheProvider";
import { NotificationPreferencesProvider } from "../providers/NotificationPreferencesProvider";
import { SyncStatusProvider } from "../providers/SyncStatusProvider";

// 👇 Theme imports
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";
import { designTokens as t } from "../lib/design/tokens";

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
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname(); // 👈 NEW

  // 👇 theme
  const { colors, colorScheme } = useTheme();

  const firstSeg = Array.isArray(segments) && segments.length ? String(segments[0]) : "";
  const inAuthGroup = firstSeg.startsWith("(auth)");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const appChrome = resolveAppChrome(pathname, { inAuthGroup, keyboardVisible });

  const {
    user,
    loading: ctxLoading,
    isAuthed,
    employee,
    workingTermsAccepted,
  } = useAuth() ?? {};
  const loading = typeof ctxLoading === "boolean" ? ctxLoading : user === undefined;
  const workspaceAccess = resolveWorkspaceAccess(employee);
  const isServiceOnlyUser = workspaceAccess.service && !workspaceAccess.user;
  const lastNotificationNavSig = useRef("");
  const lastPushRegistrationRef = useRef("");
  const [updateRequired, setUpdateRequired] = useState(null);
  const inWorkingTerms = pathname === "/working-terms";
  const visualTestRoute =
    process.env.EXPO_PUBLIC_VISUAL_TEST_MODE === "1" &&
    (pathname === "/design-system" || pathname === "/service/design-system");

  // 👇 any route starting with "/service" uses the Service footer
  // e.g. /service, /service/pages/..., /service/whatever
  const isServiceRoute = pathname?.startsWith("/service");
  const shellBackground = colors.background;
  const showFooter = appChrome.tabsVisible && !visualTestRoute;

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
    if (visualTestRoute) return;
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
        const versionBlocked = isAppUpdateRequired(currentVersion, minVersion);
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
  }, [visualTestRoute]);

  // Hide splash when ready
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  // Auth gate
  useEffect(() => {
    if (updateRequired) return;
    if (loading) return;
    if (visualTestRoute) return;

    // Not logged in and not in (auth) group -> kick to login
    if (!isAuthed && !inAuthGroup) {
      router.replace("/(auth)/login");
      return;
    }

    if (isAuthed && !workingTermsAccepted && !inWorkingTerms) {
      router.replace("/(protected)/working-terms");
      return;
    }

    // Logged in but still on an (auth) screen (e.g. /login)
    if (isAuthed && inAuthGroup) {
      if (!workingTermsAccepted) {
        router.replace("/(protected)/working-terms");
      } else if (isServiceOnlyUser) {
        router.replace("/(protected)/service/home");
      } else {
        // Default: everyone else -> normal homescreen
        router.replace("/(protected)/screens/homescreen");
      }
    }
  }, [
    loading,
    isAuthed,
    inAuthGroup,
    inWorkingTerms,
    isServiceOnlyUser,
    router,
    updateRequired,
    visualTestRoute,
    workingTermsAccepted,
  ]);


  // Push registration + tap handling
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED) {
      cancelAllScheduledNotifications();
      return;
    }

    const navigateFromNotificationResponse = (resp) => {
      if (!isAuthed || !workingTermsAccepted) return;

      const data = resp?.notification?.request?.content?.data ?? {};
      if (isTimesheetReminder(data)) {
        const weekStart = getTimesheetReminderWeekStart(data);
        const sig = `timesheet:${weekStart}`;
        if (lastNotificationNavSig.current === sig) return;
        lastNotificationNavSig.current = sig;
        router.push(getTimesheetReminderHref(data));
        return;
      }
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
        const deepLink = String(data.deepLink);
        const sig = `deep-link:${deepLink}`;
        if (lastNotificationNavSig.current === sig) return;
        lastNotificationNavSig.current = sig;
        router.push(deepLink);
      }
    };

    const dispose = addNotificationListeners({
      onReceive: () => {},
      onResponse: navigateFromNotificationResponse,
    });
    let cancelled = false;
    (async () => {
      if (isAuthed && workingTermsAccepted && user?.uid) {
        try {
          const initialResponse = await consumeInitialNotificationResponseAsync();
          if (cancelled) return;
          if (initialResponse) navigateFromNotificationResponse(initialResponse);

          await reconcilePresentedNotificationsToInbox();
          if (cancelled) return;

          const token = await registerForPushNotificationsAsync();
          if (cancelled) return;
          const registrationSignature = `${user.uid}:${token || ""}`;
          if (token && lastPushRegistrationRef.current !== registrationSignature) {
            const idToken = await user.getIdToken();
            await registerDeviceToken({
              idToken,
              token,
              platform: Platform.OS,
              appVersion: getCurrentAppVersion(),
              employeeId: employee?.employeeId,
              employeeCode: employee?.userCode,
              email: employee?.email || user.email,
            });
            lastPushRegistrationRef.current = registrationSignature;
          }
        } catch (error) {
          console.warn("[notifications] push registration failed:", error?.message || error);
        }
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [
    employee?.email,
    employee?.employeeId,
    employee?.userCode,
    isAuthed,
    router,
    user,
    workingTermsAccepted,
  ]);

  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || !isAuthed || !workingTermsAccepted) return;
    const reconcile = () => {
      reconcilePresentedNotificationsToInbox().catch((error) =>
        console.warn(
          "[notifications] foreground inbox reconciliation failed:",
          error?.message || error
        )
      );
    };
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") reconcile();
    });
    return () => subscription.remove();
  }, [isAuthed, workingTermsAccepted]);

  if (updateRequired) {
    SplashScreen.hideAsync().catch(() => {});
    return (
      <RootSurface>
        <View style={{ flex: 1, justifyContent: "center", padding: t.spacing.xl }}>
        <Text
          variant="titleSmall"
          layoutStyle={{ marginBottom: t.spacing.xs }}
        >
          Update required
        </Text>
        <Text variant="bodyLarge">
          {updateRequired.message}
        </Text>
        <Text
          variant="body"
          tone="secondary"
          layoutStyle={{ marginTop: t.spacing.xs }}
        >
          {updateRequired.detail}
        </Text>
        </View>
      </RootSurface>
    );
  }

  // ─────────────────────────────────────────────
  // LAYOUT
  // ─────────────────────────────────────────────

  return (
    <RootSurface>
      <StatusBar
        style={colorScheme === "dark" ? "light" : "dark"}
        backgroundColor={shellBackground}
      />

      <View testID={visualTestRoute ? "visual-test-shell" : undefined} style={{ flex: 1 }}>
        <Slot />
      </View>

      {/* Float the footer over the screen so its transparent surround reveals content. */}
      {showFooter && (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          {isServiceRoute ? <ServiceFooter /> : <Footer />}
        </View>
      )}
    </RootSurface>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <ThemeProvider>
          <DataCacheProvider>
            <SyncStatusProvider>
              <NotificationPreferencesProvider>
                <ShellInner />
              </NotificationPreferencesProvider>
            </SyncStatusProvider>
          </DataCacheProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
