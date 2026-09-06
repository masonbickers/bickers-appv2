import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scheduleSource = readFileSync(
  new URL("../app/(protected)/screens/schedule.js", import.meta.url),
  "utf8"
);

test("schedule keeps the calendar legend inside the calendar card", () => {
  const calendarCard = scheduleSource.slice(
    scheduleSource.indexOf("<Calendar"),
    scheduleSource.indexOf("<AgendaList")
  );

  assert.match(calendarCard, /<Calendar[\s\S]*styles\.legendRow/);
  assert.match(scheduleSource, /legendRow:\s*\{[\s\S]*borderTopWidth:/);
});

test("schedule uses a compact prompt before a date is selected", () => {
  assert.match(scheduleSource, /styles\.dateHint/);
  assert.match(scheduleSource, /Tap a date to view jobs or leave details\./);
  assert.doesNotMatch(scheduleSource, /title="Pick a date"/);
});

test("schedule clearly distinguishes today from the selected date", () => {
  assert.match(scheduleSource, /isToday && !isSelected/);
  assert.match(scheduleSource, /isSelected && \{\s*backgroundColor: colors\.accent/);
  assert.match(scheduleSource, /isSelected\s*\? colors\.textOnAccent/);
});

test("schedule calendar and inactive view control remain compact and legible", () => {
  assert.match(scheduleSource, /calendarDay:\s*\{\s*width: 40,\s*height: 42/);
  assert.match(scheduleSource, /withAlpha\(colors\.text, 0\.72\)/);
});
