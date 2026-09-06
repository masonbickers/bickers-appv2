import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const holidaySource = readFileSync(
  new URL("../app/(protected)/holidaypage.js", import.meta.url),
  "utf8"
);

test("holiday page presents leave as a compact mobile table", () => {
  assert.match(holidaySource, /function HolidayTableSection/);
  assert.match(holidaySource, /title="Requests"/);
  assert.match(holidaySource, /title="Upcoming confirmed"/);
  assert.match(holidaySource, /title="Past holidays"/);
  assert.match(holidaySource, /styles\.holidayTableRow/);
  assert.match(holidaySource, />Date</);
  assert.match(holidaySource, />Days</);
  assert.match(holidaySource, />Type</);
  assert.match(holidaySource, /\{onCancel \? "Action" : "Left"\}/);
  assert.doesNotMatch(holidaySource, /styles\.holidayItem/);
});

test("negative allowance is explained as overbooked leave", () => {
  assert.match(holidaySource, /const isOverbooked = allowanceBalance < 0/);
  assert.match(holidaySource, /Overbooked:/);
  assert.match(holidaySource, /Paid leave exceeds allowance by/);
  assert.match(holidaySource, /Review upcoming bookings or contact the office/);
});

test("holiday summary remains compact on phone widths", () => {
  assert.match(holidaySource, /label="Paid used"/);
  assert.match(holidaySource, /label="Paid booked"/);
  assert.match(holidaySource, /label="Unpaid"/);
  assert.match(holidaySource, /statsGrid:\s*\{\s*flexDirection: "row"/);
});
