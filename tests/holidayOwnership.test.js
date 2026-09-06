import assert from "node:assert/strict";
import test from "node:test";

import { employeeMatchesHoliday } from "../lib/holidayOwnership.js";

const masonRecord = {
  id: "mason-employee-doc",
  employeeId: "mason-employee-id",
  userCode: "4569",
  name: "Mason 2Bickers",
  email: "mason@bickers.co.uk",
};

const masonSession = {
  employeeId: "mason-employee-id",
  userCode: "4569",
  displayName: "Mason 2Bickers",
  email: "mason@bickers.co.uk",
};

const masonUser = {
  uid: "mason-auth-id",
  displayName: "Mason 2Bickers",
  email: "mason@bickers.co.uk",
};

test("matches a holiday using employee ownership fields", () => {
  assert.equal(
    employeeMatchesHoliday(
      { employeeCode: 4569, employee: "Mason 2Bickers" },
      masonRecord,
      masonSession,
      masonUser
    ),
    true
  );
});

test("does not treat the administrator who created leave as its owner", () => {
  const brianNovemberHoliday = {
    employeeCode: "0099",
    employee: "Brian Naunton",
    employeeEmail: "brian@example.com",
    createdByCode: "4569",
    createdByName: "Mason 2Bickers",
    createdByEmail: "mason@bickers.co.uk",
    startDate: "2026-11-14",
    endDate: "2026-11-22",
  };

  assert.equal(
    employeeMatchesHoliday(
      brianNovemberHoliday,
      masonRecord,
      masonSession,
      masonUser
    ),
    false
  );
});

test("does not treat request or driver audit fields as holiday ownership", () => {
  assert.equal(
    employeeMatchesHoliday(
      {
        employee: "Brian Naunton",
        requestedByName: "Mason 2Bickers",
        requestedByCode: "4569",
        driverCode: "4569",
      },
      masonRecord,
      masonSession,
      masonUser
    ),
    false
  );
});

test("an authoritative employee ID mismatch cannot fall through to a name match", () => {
  assert.equal(
    employeeMatchesHoliday(
      {
        employeeId: "another-employee-id",
        employee: "Mason 2Bickers",
      },
      masonRecord,
      masonSession,
      masonUser
    ),
    false
  );
});
