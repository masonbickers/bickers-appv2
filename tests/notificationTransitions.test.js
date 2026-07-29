import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingNotificationSignature,
  classifyBookingNotificationTransition,
  isApprovedHolidayStatus,
  timesheetNotificationSignature,
} from "../lib/notificationTransitions.js";

const crewed = { employeeCodes: ["EMP-1"], isCrewed: true, jobNumber: "100" };

test("initially added visible booking is classified as assigned", () => {
  assert.equal(
    classifyBookingNotificationTransition({
      type: "added",
      before: null,
      after: crewed,
      employeeCode: "EMP-1",
    }),
    "assigned"
  );
});

test("uncrewed and unassigned bookings do not produce an assignment", () => {
  assert.equal(
    classifyBookingNotificationTransition({
      type: "added",
      before: null,
      after: { ...crewed, isCrewed: false },
      employeeCode: "EMP-1",
    }),
    null
  );
  assert.equal(
    classifyBookingNotificationTransition({
      type: "added",
      before: null,
      after: crewed,
      employeeCode: "EMP-2",
    }),
    null
  );
});

test("crewing, updating, uncrewing, and removal classify once by transition", () => {
  assert.equal(
    classifyBookingNotificationTransition({
      type: "modified",
      before: { ...crewed, isCrewed: false },
      after: crewed,
      employeeCode: "EMP-1",
    }),
    "assigned"
  );
  assert.equal(
    classifyBookingNotificationTransition({
      type: "modified",
      before: crewed,
      after: { ...crewed, location: "London" },
      employeeCode: "EMP-1",
    }),
    "updated"
  );
  assert.equal(
    classifyBookingNotificationTransition({
      type: "modified",
      before: crewed,
      after: { ...crewed, isCrewed: false },
      employeeCode: "EMP-1",
    }),
    "removed"
  );
  assert.equal(
    classifyBookingNotificationTransition({
      type: "removed",
      before: crewed,
      after: null,
      employeeCode: "EMP-1",
    }),
    "removed"
  );
});

test("unchanged notification projection has a stable signature", () => {
  assert.equal(bookingNotificationSignature(crewed), bookingNotificationSignature({ ...crewed }));
});

test("holiday approval recognises legacy approved labels", () => {
  assert.equal(isApprovedHolidayStatus("Approved - paid"), true);
  assert.equal(isApprovedHolidayStatus("pending"), false);
});

test("timesheet notification signature changes only for reminder state", () => {
  const first = timesheetNotificationSignature(true, { submitted: false, notes: "one" });
  const same = timesheetNotificationSignature(true, { submitted: false, notes: "two" });
  const submitted = timesheetNotificationSignature(true, { submitted: true });
  assert.equal(first, same);
  assert.notEqual(first, submitted);
});
