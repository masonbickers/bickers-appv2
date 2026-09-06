import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseLinkedJobsForDay,
  displayJobNumber,
  expandLinkedHandoverJobs,
} from "../lib/linkedBookingDays.js";

const source = {
  id: "job-9304",
  jobNumber: "9304",
  bookingDates: ["2026-09-01", "2026-09-02"],
};

const target = {
  id: "job-9315",
  jobNumber: "9315",
  bookingDates: ["2026-09-02", "2026-09-03"],
  linkedContinuation: {
    fromBookingId: "job-9304",
    fromJobNumber: "9304",
    handoverDate: "2026-09-02",
  },
};

test("a linked handover appears as one app job day", () => {
  const result = collapseLinkedJobsForDay([source, target], "2026-09-02");

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "job-9315");
  assert.deepEqual(result[0].linkedHandoverJobs.map((job) => job.id), ["job-9304", "job-9315"]);
  assert.equal(displayJobNumber(result[0]), "9304 → 9315");
});

test("ordinary same-day jobs remain separate", () => {
  const unrelated = {
    id: "job-9400",
    jobNumber: "9400",
    bookingDates: ["2026-09-02"],
  };

  assert.deepEqual(
    collapseLinkedJobsForDay([source, unrelated], "2026-09-02"),
    [source, unrelated]
  );
});

test("a linked pair remains separate away from its handover date", () => {
  assert.deepEqual(
    collapseLinkedJobsForDay([source, target], "2026-09-01"),
    [source, target]
  );
});

test("a continuation is not collapsed when its source is not visible to the user", () => {
  assert.deepEqual(collapseLinkedJobsForDay([target], "2026-09-02"), [target]);
});

test("on-set takes precedence over travel on a linked handover day", () => {
  const travelJob = {
    ...source,
    notesByDate: { "2026-09-02": "Travel" },
  };
  const onSetJob = {
    ...target,
    notesByDate: { "2026-09-02": "On Set" },
  };

  const [result] = collapseLinkedJobsForDay([travelJob, onSetJob], "2026-09-02");

  assert.equal(result.id, "job-9315");
  assert.equal(result.notesByDate["2026-09-02"], "On Set");
  assert.equal(displayJobNumber(result), "9304 → 9315");
});

test("timesheet audit data can retain both underlying linked bookings", () => {
  const collapsed = collapseLinkedJobsForDay([source, target], "2026-09-02");

  assert.deepEqual(
    expandLinkedHandoverJobs(collapsed).map((job) => job.id),
    ["job-9304", "job-9315"]
  );
});
