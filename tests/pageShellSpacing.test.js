import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageShellSource = readFileSync(
  new URL("../components/layout/PageShell.tsx", import.meta.url),
  "utf8"
);
const scheduleSource = readFileSync(
  new URL("../app/(protected)/screens/schedule.js", import.meta.url),
  "utf8"
);
const jobSource = readFileSync(
  new URL("../app/(protected)/job.js", import.meta.url),
  "utf8"
);
const serviceWorkSource = readFileSync(
  new URL("../app/(protected)/service/work.js", import.meta.url),
  "utf8"
);
const serviceIssuesSource = readFileSync(
  new URL("../app/(protected)/service/issues.jsx", import.meta.url),
  "utf8"
);

test("PageShell does not add implicit spacing between screen-owned sections", () => {
  assert.match(pageShellSource, /contentSpacing = "none"/);
  assert.match(pageShellSource, /contentSpacing === "compact"/);
  assert.match(pageShellSource, /gap: contentGap/);
  assert.doesNotMatch(pageShellSource, /gap: sectionGap/);
});

test("scrolling hero screens opt into compact spacing without legacy offsets", () => {
  assert.match(scheduleSource, /contentSpacing="compact"/);
  assert.doesNotMatch(scheduleSource, /heroCard:\s*\{[^}]*marginBottom:/);
  assert.match(jobSource, /contentSpacing="compact"/);
  assert.doesNotMatch(jobSource, /heroCard:\s*\{[^}]*marginBottom:/);
  assert.doesNotMatch(jobSource, /heroContent:\s*\{[^}]*minHeight:/);
});

test("workshop forms separate cards and section headings consistently", () => {
  assert.match(serviceWorkSource, /<PageShell[\s\S]*?contentSpacing="compact"/);
  assert.match(serviceWorkSource, /sectionDivider:\s*\{[\s\S]*?marginTop:\s*t\.spacing\.xs/);
});

test("service issue sections keep consistent outer and inner spacing", () => {
  assert.match(serviceIssuesSource, /<View style=\{styles\.contentStack\}>/);
  assert.match(serviceIssuesSource, /contentStack:\s*\{\s*gap:\s*t\.spacing\.md/);
  assert.match(serviceIssuesSource, /sectionBlock:\s*\{\s*gap:\s*t\.spacing\.sm/);
});
