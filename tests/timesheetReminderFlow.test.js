import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getTimesheetReminderHref,
  getTimesheetReminderWeekStart,
  isTimesheetReminder,
  isValidTimesheetWeekStart,
} from "../lib/timesheetNotification.js";
import {
  anonymousDeviceIdentityMatches,
  canonicalNotificationUid,
  decodedTokenIsAnonymous,
} from "../server/deviceTokenIdentity.js";

const layoutSource = readFileSync(new URL("../app/_layout.jsx", import.meta.url), "utf8");
const notificationDetailSource = readFileSync(
  new URL("../app/(protected)/notification/[id].js", import.meta.url),
  "utf8"
);
const serverSource = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
const notificationSource = readFileSync(
  new URL("../lib/notifications.js", import.meta.url),
  "utf8"
);
const employeeNotificationsSource = readFileSync(
  new URL("../hooks/useEmployeeNotifications.js", import.meta.url),
  "utf8"
);
const remoteNotificationsSource = readFileSync(
  new URL("../lib/remoteNotifications.js", import.meta.url),
  "utf8"
);

test("timesheet reminder payloads resolve to the protected week route", () => {
  const data = {
    type: "timesheet-reminder",
    weekStart: "2026-07-27",
    deepLink: "/(protected)/week/2026-07-27",
  };

  assert.equal(isTimesheetReminder(data), true);
  assert.equal(getTimesheetReminderWeekStart(data), "2026-07-27");
  assert.equal(getTimesheetReminderHref(data), "/(protected)/week/2026-07-27");
});

test("timesheet reminder routing rejects invalid or unrelated payloads", () => {
  assert.equal(isValidTimesheetWeekStart("2026-02-29"), false);
  assert.equal(
    isTimesheetReminder({ type: "other", weekStart: "2026-07-27" }),
    false
  );
  assert.equal(
    getTimesheetReminderWeekStart({
      type: "timesheet-reminder",
      deepLink: "/(protected)/week/2026-07-27",
    }),
    "2026-07-27"
  );
});

test("legacy anonymous sessions must match the complete employee identity", () => {
  const employee = {
    id: "employee-1",
    userCode: "0042",
    email: "person@example.com",
  };
  const identity = {
    employeeId: "employee-1",
    employeeCode: "42",
    email: "PERSON@example.com",
  };

  assert.equal(anonymousDeviceIdentityMatches(employee, identity), true);
  assert.equal(
    anonymousDeviceIdentityMatches(employee, { ...identity, employeeCode: "0043" }),
    false
  );
  assert.equal(
    decodedTokenIsAnonymous({ firebase: { sign_in_provider: "anonymous" } }),
    true
  );
});

test("password-linked employee UID remains canonical for legacy app sessions", () => {
  assert.equal(
    canonicalNotificationUid("anonymous-uid", { authUid: "password-user-uid" }),
    "password-user-uid"
  );
  assert.equal(canonicalNotificationUid("anonymous-uid", {}), "anonymous-uid");
});

test("app wiring consumes cold-start responses and keeps inbox reminders actionable", () => {
  assert.match(layoutSource, /consumeInitialNotificationResponseAsync/);
  assert.match(layoutSource, /reconcilePresentedNotificationsToInbox/);
  assert.match(notificationDetailSource, /getTimesheetReminderHref/);
  assert.match(notificationDetailSource, /Open timesheet/);
});

test("web notifications use a durable inbox identity", () => {
  assert.match(notificationSource, /content\.data\?\.notificationId/);
  assert.match(notificationSource, /`web:\$\{content\.data\.notificationId\}`/);
  assert.match(employeeNotificationsSource, /syncRemoteNotificationsToInbox/);
  assert.match(employeeNotificationsSource, /setInterval\(sync, 15_000\)/);
  assert.match(serverSource, /app\.get\("\/employee-notifications"/);
  assert.match(remoteNotificationsSource, /includes\("is not configured"\)/);
});

test("new registration preserves legacy rollout tokens", () => {
  assert.doesNotMatch(
    serverSource,
    /expoPushToken:\s*admin\.firestore\.FieldValue\.delete\(\)/
  );
  assert.match(serverSource, /canonicalNotificationUid/);
  assert.match(serverSource, /anonymousDeviceIdentityMatches/);
  assert.match(serverSource, /migratedFromLegacy: true/);
});
