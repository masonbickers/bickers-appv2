import test from "node:test";
import assert from "node:assert/strict";

import {
  isBookingAssignedToEmployee,
  isBookingVisibleToEmployee,
  isCrewedBooking,
} from "../lib/bookingVisibility.js";

const employee = { name: "Alex Smith", userCode: "0042" };

test("shows a crewed booking to an assigned employee", () => {
  const booking = { isCrewed: true, employeeCodes: ["0042"] };
  assert.equal(isCrewedBooking(booking), true);
  assert.equal(isBookingVisibleToEmployee(booking, employee), true);
});

test("selection alone does not publish an uncrewed booking", () => {
  const booking = { isCrewed: false, employees: [{ name: "Alex Smith", userCode: "0042" }] };
  assert.equal(isBookingAssignedToEmployee(booking, employee), true);
  assert.equal(isBookingVisibleToEmployee(booking, employee), false);
});

test("hides legacy bookings with no isCrewed value", () => {
  assert.equal(isBookingVisibleToEmployee({ employeeCodes: ["0042"] }, employee), false);
});

test("hides a crewed booking from an unassigned employee", () => {
  assert.equal(
    isBookingVisibleToEmployee({ isCrewed: true, employeeCodes: ["0099"] }, employee),
    false
  );
});

test("matches embedded codes and legacy names", () => {
  assert.equal(
    isBookingVisibleToEmployee(
      { isCrewed: true, employees: [{ name: "Other", userCode: "0042" }] },
      employee
    ),
    true
  );
  assert.equal(
    isBookingVisibleToEmployee({ isCrewed: true, employees: ["Alex Smith"] }, employee),
    true
  );
});

test("matches date-specific assignment fields", () => {
  const booking = {
    isCrewed: true,
    employeeCodesByDate: { "2026-07-20": ["0042"] },
  };
  assert.equal(isBookingVisibleToEmployee(booking, employee), true);
});

test("resolves legacy assigned names through the employee directory", () => {
  const renamedEmployee = { name: "Alex Jones", userCode: "0042" };
  const booking = { isCrewed: true, employees: [{ name: "Alex Smith" }] };
  assert.equal(isBookingVisibleToEmployee(booking, renamedEmployee, [employee]), true);
});
