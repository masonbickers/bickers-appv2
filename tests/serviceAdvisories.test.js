import assert from "node:assert/strict";
import test from "node:test";

import {
  countOpenMonitorItems,
  isOpenAdvisoryItem,
  resolveMonitorReportItem,
} from "../lib/serviceAdvisories.js";

test("closed advisory aliases are not counted as open", () => {
  assert.equal(isOpenAdvisoryItem({ status: "Resolved" }), false);
  assert.equal(isOpenAdvisoryItem({ resolutionStatus: "fixed" }), false);
  assert.equal(isOpenAdvisoryItem({ maintenance: { status: "completed" } }), false);
  assert.equal(isOpenAdvisoryItem({ status: "monitor" }), true);
});

test("open monitor counts span records and ignore malformed values", () => {
  const records = [
    { monitorReport: [{ status: "open" }, { status: "resolved" }] },
    { monitorReport: [{ resolutionStatus: "watch" }, null] },
    { monitorReport: "not-an-array" },
  ];

  assert.equal(countOpenMonitorItems(records), 2);
  assert.equal(countOpenMonitorItems(null), 0);
});

test("resolving an advisory records a complete audit trail", () => {
  const original = [
    { key: "brakes", status: "open", maintenance: { note: "Inspect" } },
    { key: "tyres", status: "open" },
  ];
  const result = resolveMonitorReportItem(original, {
    itemKey: "brakes",
    nowISO: "2026-07-29T12:00:00.000Z",
    resolvedBy: "EMP-1",
  });

  assert.equal(result.changed, true);
  assert.equal(result.nextItems[0].status, "resolved");
  assert.equal(result.nextItems[0].resolutionStatus, "fixed");
  assert.equal(result.nextItems[0].resolvedBy, "EMP-1");
  assert.equal(result.nextItems[0].maintenance.status, "resolved");
  assert.equal(result.nextItems[0].maintenance.note, "Inspect");
  assert.equal(original[0].status, "open");
  assert.equal(result.nextItems[1], original[1]);
});

test("missing advisory targets leave the report unchanged", () => {
  const original = [{ key: "brakes", status: "open" }];
  const result = resolveMonitorReportItem(original, {
    itemKey: "missing",
    itemIndex: 5,
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.nextItems, original);
});
