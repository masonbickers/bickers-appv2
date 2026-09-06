import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const meSource = readFileSync(
  new URL("../app/(protected)/me.js", import.meta.url),
  "utf8"
);

test("profile dashboard keeps identity and actions compact", () => {
  assert.match(meSource, /styles\.profileIdentityRow/);
  assert.match(meSource, /\{account\.name\}/);
  assert.match(meSource, />Edit<\/Text>/);
  assert.match(meSource, /name="settings" size=\{16\} color=\{colors\.text\}/);
  assert.match(meSource, /profileEditText, \{ color: colors\.text \}/);
  assert.doesNotMatch(meSource, />My Profile<\/Text>/);
});

test("availability form expands only when requested", () => {
  assert.match(meSource, /const \[noteComposerOpen, setNoteComposerOpen\] = useState\(false\)/);
  assert.match(meSource, /\{noteComposerOpen \? <View/);
  assert.match(meSource, /Tell the office when you cannot be booked/);
});

test("personal summaries use compact direct actions", () => {
  assert.match(meSource, /style=\{styles\.summaryLink\}/);
  assert.match(meSource, /style=\{styles\.actionGrid\}/);
  assert.match(meSource, /name="file-text"/);
  assert.doesNotMatch(meSource, /name="receipt"/);
  assert.match(meSource, /styles\.holidayProgressFill/);
  assert.match(meSource, />Allowance<\/Text>/);
  assert.doesNotMatch(meSource, /Allowance \(\{currentYear\}\)/);
  assert.match(meSource, /statRow:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?minWidth:\s*0,/);
  assert.match(meSource, /styles\.summaryChevron/);
  assert.doesNotMatch(meSource, /\{timesheetStats\.pending\} pending/);
  assert.match(meSource, /calculateRemainingHolidayAllowance\(totalAllowance, used, booked\)/);
  assert.match(meSource, />Booked<\/Text>/);
  assert.match(meSource, /fmtHalf\(holidayBookedDays\)/);
});
