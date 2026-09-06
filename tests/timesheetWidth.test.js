import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/(protected)/week/[id]/index.js", import.meta.url),
  "utf8"
);

test("all timesheet sections align with the main form width", () => {
  assert.match(source, /<View style=\{styles\.actionRow\}>/);
  assert.match(source, /summaryBox:\s*\{\s*width: "100%"/);
  assert.match(source, /actionRow:\s*\{\s*width: "100%"/);
  assert.doesNotMatch(source, /summaryBox:\s*\{[^}]*marginHorizontal/);
  assert.doesNotMatch(source, /dayBlock:\s*\{[^}]*marginHorizontal/);
  assert.doesNotMatch(source, /creditBox:\s*\{[^}]*marginHorizontal/);
});
