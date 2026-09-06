import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const timesheetSource = readFileSync(
  new URL("../app/(protected)/week/[id]/index.js", import.meta.url),
  "utf8"
);

test("employee timesheets show travel hours without booking allocation notes", () => {
  assert.equal(timesheetSource.match(/label="Travel"/g)?.length, 2);
  assert.match(timesheetSource, /Travel-day pay breakdown/);
  assert.match(timesheetSource, /Travel paid total/);
  assert.match(timesheetSource, /isTimeAllocationDayNote/);
  assert.match(
    timesheetSource,
    /value=\{isTimeAllocationDayNote\(value\) \? "" : value \|\| ""\}/
  );
  assert.match(
    timesheetSource,
    /filter\(\(note\) => note && !isTimeAllocationDayNote\(note\)\)/
  );
  assert.match(timesheetSource, /placeholder="Notes for this day"/);
});
