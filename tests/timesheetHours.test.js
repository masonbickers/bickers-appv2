import assert from "node:assert/strict";
import test from "node:test";

import {
  computeTimesheetDayBreakdown,
  computeTimesheetWeekHours,
  getLunchBreakDeductionMinutes,
} from "../lib/timesheetHours.js";

test("lunch is deducted from weekday yard hours", () => {
  assert.equal(getLunchBreakDeductionMinutes("Monday", false, 8 * 60), 30);
  assert.equal(getLunchBreakDeductionMinutes("Friday", false, 15), 15);
});

test("lunch is not deducted from Saturday or Sunday yard hours", () => {
  assert.equal(getLunchBreakDeductionMinutes("Saturday", false, 8 * 60), 0);
  assert.equal(getLunchBreakDeductionMinutes("Sunday", false, 8 * 60), 0);
});

test("lunch is not deducted when supplied or no hours were worked", () => {
  assert.equal(getLunchBreakDeductionMinutes("Tuesday", true, 8 * 60), 0);
  assert.equal(getLunchBreakDeductionMinutes("Tuesday", false, 0), 0);
});

test("yard hours support multiple blocks, travel and overnight work", () => {
  const weekday = computeTimesheetDayBreakdown(
    {
      mode: "yard",
      yardSegments: [
        { start: "08:00", end: "12:00" },
        { start: "13:00", end: "16:00" },
      ],
      yardTravelEnabled: true,
      yardTravelLeaveTime: "16:00",
      yardTravelArriveTime: "17:00",
    },
    "Monday"
  );
  assert.equal(weekday.yardWork, 7 * 60);
  assert.equal(weekday.yardTravel, 60);
  assert.equal(weekday.breakDeduction, 30);
  assert.equal(weekday.total, 7.5 * 60);

  const overnight = computeTimesheetDayBreakdown(
    { mode: "yard", yardSegments: [{ start: "22:00", end: "02:00" }] },
    "Saturday"
  );
  assert.equal(overnight.total, 4 * 60);
});

test("travel and turnaround days receive the ten-hour payroll value", () => {
  assert.equal(
    computeTimesheetDayBreakdown(
      { mode: "travel", leaveTime: "08:00", arriveTime: "14:00" },
      "Tuesday"
    ).total,
    10 * 60
  );
  assert.equal(
    computeTimesheetDayBreakdown({ mode: "yard", isTurnaround: true }, "Wednesday").total,
    10 * 60
  );
});

test("on-set total includes outbound, pre-call, set and return time", () => {
  const result = computeTimesheetDayBreakdown(
    {
      mode: "onset",
      leaveTime: "06:00",
      arriveTime: "07:00",
      precallDuration: "07:30",
      callTime: "08:00",
      wrapTime: "18:00",
      arriveBack: "19:00",
    },
    "Thursday"
  );
  assert.equal(result.outboundTravel, 60);
  assert.equal(result.paidEarly, 30);
  assert.equal(result.precall, 30);
  assert.equal(result.onSetStandard, 10 * 60);
  assert.equal(result.returnTravel, 60);
  assert.equal(result.total, 13 * 60);
});

test("on-set day can add travel to another job", () => {
  const result = computeTimesheetDayBreakdown(
    {
      mode: "onset",
      leaveTime: "05:30",
      arriveTime: "08:00",
      callTime: "09:00",
      wrapTime: "13:30",
      arriveBack: "17:00",
      additionalTravelEnabled: true,
      additionalTravelStartTime: "17:00",
      additionalTravelEndTime: "20:45",
      additionalTravelJob: "Sunken Garden",
    },
    "Monday"
  );

  assert.equal(result.additionalJobTravel, 3 * 60 + 45);
  assert.equal(result.total, 15 * 60 + 15);
});

test("disabled travel to another job does not affect the on-set total", () => {
  const result = computeTimesheetDayBreakdown({
    mode: "onset",
    callTime: "09:00",
    wrapTime: "19:00",
    additionalTravelEnabled: false,
    additionalTravelStartTime: "19:00",
    additionalTravelEndTime: "22:00",
  });

  assert.equal(result.additionalJobTravel, 0);
  assert.equal(result.total, 10 * 60);
});

test("weekly total uses live day data instead of a stale stored total", () => {
  const offWeek = Object.fromEntries(
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
      (day) => [day, { mode: "off" }]
    )
  );
  const timesheet = {
    totalHours: 99,
    days: {
      ...offWeek,
      Monday: { mode: "yard", yardSegments: [{ start: "08:00", end: "16:30" }] },
      Saturday: { mode: "yard", yardSegments: [{ start: "08:00", end: "16:30" }] },
    },
  };
  assert.equal(computeTimesheetWeekHours(timesheet), 16.5);
});
