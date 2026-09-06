import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const diarySource = readFileSync(
  new URL("../app/(protected)/work-diary.js", import.meta.url),
  "utf8"
);
const boardSource = readFileSync(
  new URL("../app/(protected)/work-diary-board.js", import.meta.url),
  "utf8"
);

test("work diary filters lifecycle records before downstream projections", () => {
  assert.match(diarySource, /allBookings\.filter\(\(booking\) => shouldShowDiaryBooking\(booking, includeInactive\)\)/);
  assert.match(diarySource, /filteredBookings\.filter\(\(booking\) =>/);
  assert.match(diarySource, /filteredBookings\s*\.map/);
  assert.match(diarySource, /filteredBookings\.forEach\(\(b\) =>/);
});

test("work diary and board preserve an explicit inactive route state", () => {
  assert.match(diarySource, /params: includeInactive \? \{ includeInactive: "1" \} : \{\}/);
  assert.match(boardSource, /String\(params\.includeInactive \|\| ""\) === "1"/);
  assert.match(boardSource, /shouldShowDiaryBooking\(job, includeInactive\)/);
});

test("work diary uses the compact shared header and no manual footer spacer", () => {
  assert.match(diarySource, /variant: "compact"/);
  assert.match(diarySource, /title: "Work Diary"/);
  assert.doesNotMatch(diarySource, /<View style=\{\{ height: 40 \}\}/);
});

test("work diary detail modal uses vector icons and covers operational booking details", () => {
  for (const label of [
    "Dates",
    "Call times",
    "Location",
    "Crew",
    "Crew changes",
    "Vehicles",
    "Vehicle changes",
    "Production",
    "Client",
    "Shoot type",
    "Booking contact",
    "Reference / PO",
    "Equipment",
    "Operational notes",
  ]) {
    assert.match(diarySource, new RegExp(`label="${label}"`));
  }
  for (const section of ["Overview", "Schedule", "Resources", "Contact", "Notes"]) {
    assert.match(diarySource, new RegExp(`title="${section}"`));
  }
  assert.match(diarySource, /selectedJob\.bookingType/);
  assert.match(diarySource, /closeLabel="Close job details"/);
  assert.doesNotMatch(diarySource, /🗓|⚡|📍|👥|🚗|📝/u);
});

test("work diary cards show date-specific crew and vehicle names", () => {
  assert.match(diarySource, /const crewNames = crewForDate\(job, dateStr\)/);
  assert.match(diarySource, /const vehicleNames = vehiclesForDate\(job, dateStr\)/);
  assert.match(diarySource, /crewNames\.join\(", "\)/);
  assert.match(diarySource, /vehicleNames\.join\(", "\)/);
  assert.doesNotMatch(diarySource, /crew member" : "crew members/);
});
