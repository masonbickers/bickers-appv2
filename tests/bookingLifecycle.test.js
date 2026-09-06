import assert from "node:assert/strict";
import test from "node:test";

import {
  getBookingLifecycle,
  getBookingLifecycleLabel,
  shouldShowDiaryBooking,
} from "../lib/bookingLifecycle.js";

test("active booking statuses and missing legacy statuses remain visible", () => {
  for (const status of [undefined, "Booked", "Confirmed", "Completed", "1st Pencil", "Maintenance"]) {
    const booking = { status };
    assert.equal(getBookingLifecycle(booking), "active");
    assert.equal(shouldShowDiaryBooking(booking), true);
  }
});

test("inactive aliases and flags are hidden by default", () => {
  const records = [
    { status: "Cancelled" },
    { status: "canceled" },
    { status: "Postponed" },
    { status: "Lost" },
    { status: "DNH" },
    { status: "Archived" },
    { inactive: true },
    { isInactive: "true" },
    { archived: 1 },
    { isArchived: "yes" },
    { archivedAt: { seconds: 1 } },
  ];

  for (const booking of records) {
    assert.equal(getBookingLifecycle(booking), "inactive");
    assert.equal(shouldShowDiaryBooking(booking), false);
    assert.equal(shouldShowDiaryBooking(booking, true), true);
  }
});

test("soft-delete markers take precedence over inactive markers", () => {
  const records = [
    { isDeleted: true, inactive: true },
    { deleted: "true", status: "Cancelled" },
    { deletedAt: { seconds: 1 }, archived: true },
    { status: "Deleted", isInactive: true },
  ];

  for (const booking of records) {
    assert.equal(getBookingLifecycle(booking), "deleted");
    assert.equal(getBookingLifecycleLabel(booking), "Deleted");
    assert.equal(shouldShowDiaryBooking(booking), false);
    assert.equal(shouldShowDiaryBooking(booking, true), true);
  }
});

test("inactive labels preserve meaningful lifecycle statuses", () => {
  assert.equal(getBookingLifecycleLabel({ status: "Cancelled" }), "Cancelled");
  assert.equal(getBookingLifecycleLabel({ status: "Postponed" }), "Postponed");
  assert.equal(getBookingLifecycleLabel({ status: "DNH" }), "DNH");
  assert.equal(getBookingLifecycleLabel({ archived: true }), "Archived");
  assert.equal(getBookingLifecycleLabel({ inactive: true }), "Inactive");
});
