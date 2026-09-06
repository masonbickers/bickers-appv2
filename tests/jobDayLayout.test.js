import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const jobDaySource = readFileSync(
  new URL("../app/(protected)/job.js", import.meta.url),
  "utf8"
);

test("job day keeps the daily status and navigation compact", () => {
  assert.match(jobDaySource, /title="Job Day"[\s\S]*action=\{/);
  assert.match(jobDaySource, /styles\.yardStatusRow/);
  assert.doesNotMatch(jobDaySource, /title="Yard Based"/);
  assert.match(jobDaySource, /Back to today/);
});

test("vehicle preparation dates stay in the local calendar timezone", () => {
  assert.match(jobDaySource, /const dateKey = toISODate\(departureDay\)/);
  assert.doesNotMatch(jobDaySource, /day\.toISOString\(\)\.split/);
  assert.match(jobDaySource, /Confirmed upcoming departures\./);
});

test("vehicle preparation emphasises exceptions instead of successful checks", () => {
  assert.match(jobDaySource, /styles\.prepCount/);
  assert.match(jobDaySource, />Prep required</);
  assert.match(jobDaySource, /withAlpha\(colors\.warning, 0\.12\)/);
  assert.match(jobDaySource, />CHECK TAX \/ INS</);
  assert.doesNotMatch(jobDaySource, />Compliance OK</);
});

test("vehicle preparation separates immediate and later bookings", () => {
  assert.doesNotMatch(jobDaySource, /addDays\(today, 30\)/);
  assert.match(jobDaySource, /"Next 3 days"/);
  assert.match(jobDaySource, /"Upcoming after 3 days"/);
  assert.match(jobDaySource, /groups=\{prepSoonByDate\}/);
  assert.match(jobDaySource, /groups=\{prepLaterByDate\}/);
  assert.match(jobDaySource, /emptyMessage="No later confirmed departures\."/);
});
