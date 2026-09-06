import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/(protected)/week/[id]/index.js", import.meta.url),
  "utf8"
);

test("timesheet booking rows show production rather than production company", () => {
  assert.match(source, /function getProductionDisplayName\(job\)/);
  assert.match(
    source,
    /\{job\.jobNumber \|\| job\.id\} – \{getProductionDisplayName\(job\)\}/
  );
  assert.doesNotMatch(
    source,
    /\{job\.jobNumber \|\| job\.id\} – \{job\.client/
  );
});

test("timesheet day notes use the compact field height", () => {
  assert.match(source, /inputStyle=\{styles\.dayNotesInput\}/);
  assert.match(
    source,
    /dayNotesInput:\s*\{\s*height: t\.controls\.buttonHeight,\s*minHeight: t\.controls\.buttonHeight/
  );
});
