// lib/notifications.js
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// ✅ NEW: write notifications into your in-app inbox (AsyncStorage)
import { addToInbox } from "./notificationInbox";

/* -------------------------------------------------------------------------- */
/*                            GLOBAL NOTIF HANDLER                             */
/*  iOS: controls what happens when app is FOREGROUND                          */
/* -------------------------------------------------------------------------- */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // ✅ SDK 53+ prefers these:
    shouldShowBanner: true,
    shouldShowList: true,
    // If you want sound while app is open, set true:
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/* -------------------------------------------------------------------------- */
/*                               SMALL HELPERS                                 */
/* -------------------------------------------------------------------------- */

function normaliseToString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;

  // Firestore Timestamp-style
  if (value && typeof value.toDate === "function") {
    try {
      return value.toDate().toLocaleString();
    } catch {
      /* ignore */
    }
  }

  if (value instanceof Date) {
    try {
      return value.toLocaleString();
    } catch {
      /* ignore */
    }
  }

  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* -------------------------------------------------------------------------- */
/*                             ANDROID CHANNEL SETUP                           */
/* -------------------------------------------------------------------------- */

let _channelReady = false;

async function ensureAndroidChannel(channelId = "default") {
  if (Platform.OS !== "android") return;
  if (_channelReady) return;

  try {
    // IMPORTANT: channel must be configured BEFORE scheduling notifications.
    await Notifications.setNotificationChannelAsync(channelId, {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FFD60A",
      sound: "default",
      // These two help “heads-up” behaviour on many devices:
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility?.PUBLIC ?? undefined,
    });

    _channelReady = true;
  } catch (e) {
    console.warn("setNotificationChannelAsync error:", e);
  }
}

/* -------------------------------------------------------------------------- */
/*                           EXPO PUSH TOKEN HELPERS                           */
/* -------------------------------------------------------------------------- */

export async function requestNotificationPermission() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return { status: finalStatus, granted: finalStatus === "granted" };
}

export async function getExpoPushTokenSafe() {
  if (!Device.isDevice) return null;

  let projectId;

  try {
    projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId ||
      null;
  } catch {
    projectId = null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData?.data ?? null;
  } catch (e) {
    console.warn("getExpoPushTokenAsync error:", e?.message ?? e);
    return null;
  }
}

export async function registerForPushNotificationsAsync() {
  await ensureAndroidChannel("default");
  const { granted } = await requestNotificationPermission();
  if (!granted) return null;

  const token = await getExpoPushTokenSafe();
  return token || null;
}

/* -------------------------------------------------------------------------- */
/*                          LOCAL NOTIFICATION SCHEDULER                       */
/* -------------------------------------------------------------------------- */

export async function scheduleLocalNotification({
  title,
  body,
  data = {},
  seconds,
  date,
  channelId = "default",
  // ✅ optional: allow callers to skip inbox writes (rare)
  writeToInbox = true,
}) {
  await ensureAndroidChannel(channelId);

  const safeTitle = normaliseToString(title, "Notification");
  const safeBody = normaliseToString(body, "");

  // ✅ Always write to in-app inbox so /notifications shows everything
  if (writeToInbox) {
    try {
      await addToInbox({
        title: safeTitle,
        body: safeBody,
        data: data || {},
        createdAt: Date.now(),
        read: false,
      });
    } catch (e) {
      console.warn("addToInbox error:", e);
    }
  }

  // ✅ Build a trigger that is VALID for SDK 53+
  let trigger;

  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    trigger = {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.floor(seconds)),
      repeats: false,
      ...(Platform.OS === "android" ? { channelId } : {}),
    };
  } else {
    const jsDate = toJsDate(date);
    if (jsDate) {
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: jsDate,
        ...(Platform.OS === "android" ? { channelId } : {}),
      };
    } else {
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
        ...(Platform.OS === "android" ? { channelId } : {}),
      };
    }
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: safeTitle,
      body: safeBody,
      data: data || {},
      // iOS needs this for sound; Android uses channel sound:
      sound: "default",
      // Extra Android hints:
      ...(Platform.OS === "android"
        ? {
            priority: Notifications.AndroidNotificationPriority.MAX,
          }
        : {}),
    },
    trigger,
  });
}

/* -------------------------------------------------------------------------- */
/*                                LISTENERS                                   */
/* -------------------------------------------------------------------------- */

export function addNotificationListeners({ onReceive, onResponse } = {}) {
  const subs = [];

  subs.push(
    Notifications.addNotificationReceivedListener(async (notification) => {
      // ✅ when a notification arrives (foreground), store it too
      try {
        const content = notification?.request?.content || {};
        const t = normaliseToString(content.title, "Notification");
        const b = normaliseToString(content.body, "");

        if (t || b) {
          await addToInbox({
            title: t,
            body: b,
            data: content.data || {},
            createdAt: Date.now(),
            read: false,
          });
        }
      } catch (e) {
        console.warn("inbox save (onReceive) error:", e);
      }

      try {
        onReceive?.(notification);
      } catch (e) {
        console.warn("onReceive error:", e);
      }
    })
  );

  subs.push(
    Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        onResponse?.(response);
      } catch (e) {
        console.warn("onResponse error:", e);
      }
    })
  );

  return () => {
    subs.forEach((s) => {
      try {
        s?.remove?.();
      } catch {
        /* ignore */
      }
    });
  };
}

/* -------------------------------------------------------------------------- */
/*                                   UTILS                                    */
/* -------------------------------------------------------------------------- */

export async function cancelAllScheduledNotifications() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn("cancelAllScheduledNotificationsAsync error:", e);
  }
}

export async function getAllScheduled() {
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn("getAllScheduledNotificationsAsync error:", e);
    return [];
  }
}

export async function debugLogScheduled() {
  const all = await getAllScheduled();
  console.log(
    "[notifications] scheduled:",
    all.map((n) => ({
      id: n.identifier,
      title: n.content?.title,
      body: n.content?.body,
      trigger: n.trigger,
    }))
  );
  return all;
}

export async function setBadgeAsync(count = 0) {
  if (Platform.OS !== "ios") return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (e) {
    console.warn("setBadgeCountAsync error:", e);
  }
}

/* -------------------------------------------------------------------------- */
/*                               PUSH VIA EXPO API                             */
/* -------------------------------------------------------------------------- */

export async function sendExpoPush({ to, title, body, data = {} }) {
  const safeTitle = normaliseToString(title, "Notification");
  const safeBody = normaliseToString(body, "");

  const payload = {
    to,
    sound: "default",
    title: safeTitle,
    body: safeBody,
    data: data || {},
    // Android:
    priority: "high",
  };

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    console.warn("sendExpoPush error:", e);
    return null;
  }
}
