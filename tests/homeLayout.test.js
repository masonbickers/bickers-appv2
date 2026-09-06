import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(
  new URL("../app/(protected)/screens/homescreen.js", import.meta.url),
  "utf8"
);

test("home dashboard sections use one stack and inherit employee density", () => {
  assert.doesNotMatch(homeSource, /<PageShell\b[^>]*\bdensity=/);
  assert.match(homeSource, /<View style=\{styles\.dashboardBody\}>/);
  assert.match(homeSource, /dashboardBody:\s*\{\s*gap: t\.spacing\.xs/);
  assert.match(homeSource, /heroCard:\s*\{[^}]*paddingBottom: t\.spacing\.none/);
  assert.doesNotMatch(homeSource, /heroCard:\s*\{[^}]*marginBottom:/);
  assert.doesNotMatch(homeSource, /block:\s*\{[^}]*marginBottom:/);
  assert.doesNotMatch(homeSource, /groupSection:\s*\{[^}]*marginBottom:/);
});

test("home prioritises work and actions with compact status summaries", () => {
  assert.match(homeSource, /styles\.statusSummary/);
  assert.match(homeSource, /Updated \{lastUpdatedAt\.toLocaleTimeString/);
  assert.doesNotMatch(homeSource, />\s*Pull to refresh\s*</);
  assert.match(homeSource, /canSwitchToService=\{canSwitchToService\}/);
  assert.match(homeSource, /accessibilityLabel="Switch to Service workspace"/);
  assert.match(homeSource, /\{todayJobs\.length > 0 \? \(/);
  assert.match(homeSource, /dashboardBody:\s*\{[^}]*paddingBottom: t\.spacing\.xl/);
});

test("home starts planning on tomorrow and supports browsing both directions", () => {
  assert.match(homeSource, /const \[selectedDate, setSelectedDate\] = useState\(getTomorrow\)/);
  assert.doesNotMatch(homeSource, /disabled=\{isEarliestPlanningDay\}/);
  assert.doesNotMatch(homeSource, /toISODate\(nd\) < toISODate\(getTomorrow\(\)\)/);
  assert.match(homeSource, /const goPrevDay[\s\S]*nd\.setDate\(nd\.getDate\(\) - 1\);[\s\S]*return nd;/);
  assert.match(homeSource, /const quickActionColumns = Math\.min\(gridColumnCount, 2\)/);
  assert.match(homeSource, /upcoming: true/);
  assert.match(homeSource, /minHeight: t\.controls\.buttonHeightLg \+ t\.spacing\.lg/);
});

test("home separates primary quick actions from a compact secondary list", () => {
  assert.match(homeSource, /group: "Quick Actions"/);
  assert.match(homeSource, /group: "More"/);
  assert.match(homeSource, /if \(groupName === "More"\)/);
  assert.match(homeSource, /styles\.moreActionRow/);
  assert.doesNotMatch(homeSource, /label: "Settings"[\s\S]*group:/);
});

test("quick actions use compact left-aligned controls", () => {
  assert.match(homeSource, /shortLabel: "Maintenance"/);
  assert.match(homeSource, /shortLabel: "Contacts"/);
  assert.match(homeSource, /\{btn\.shortLabel \|\| btn\.label\}/);
  assert.match(homeSource, /shortDescription: "Call times"/);
  assert.match(homeSource, /shortDescription: "Fleet checks"/);
  assert.match(homeSource, /shortDescription: "Crew phonebook"/);
  assert.match(homeSource, /shortDescription: "Weekly hours"/);
  assert.match(homeSource, /\{btn\.shortDescription\}/);
  assert.match(homeSource, /styles\.buttonMeta/);
  assert.match(homeSource, /button:\s*\{[^}]*flexDirection: "row"/);
});
