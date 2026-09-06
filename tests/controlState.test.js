import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSelectOptions,
  isDateSelectable,
  isISODate,
  normalizeSelectOptions,
  resolveInteractionState,
  runConfirmation,
} from "../lib/design/controlState.js";

test("interaction state follows error, focus, selected, default priority", () => {
  assert.equal(resolveInteractionState({ error: true, focused: true, selected: true }).visual, "error");
  assert.equal(resolveInteractionState({ focused: true, selected: true }).visual, "focused");
  assert.equal(resolveInteractionState({ selected: true }).visual, "selected");
  assert.equal(resolveInteractionState().visual, "default");
  assert.equal(resolveInteractionState({ loading: true }).inactive, true);
  assert.equal(resolveInteractionState({ disabled: true }).inactive, true);
  assert.ok(resolveInteractionState({ pressed: true }).opacity < 1);
});

test("select options normalise searchable metadata and preserve values", () => {
  const options = normalizeSelectOptions([
    { label: "  Van 12 ", value: 12, description: "Transit", keywords: ["AB12 CDE"] },
    { label: "", value: "missing" },
    null,
  ]);
  assert.equal(options.length, 1);
  assert.equal(options[0].label, "Van 12");
  assert.equal(options[0].value, 12);
  assert.deepEqual(filterSelectOptions(options, "ab12").map((option) => option.value), [12]);
  assert.deepEqual(filterSelectOptions(options, "transit").map((option) => option.value), [12]);
  assert.deepEqual(filterSelectOptions(options, "unknown"), []);
});

test("ISO date selection enforces valid local dates, limits, and exclusions", () => {
  assert.equal(isISODate("2026-02-28"), true);
  assert.equal(isISODate("2026-02-30"), false);
  assert.equal(isDateSelectable("2026-08-20", { minDate: "2026-08-01", maxDate: "2026-08-31" }), true);
  assert.equal(isDateSelectable("2026-07-31", { minDate: "2026-08-01" }), false);
  assert.equal(isDateSelectable("2026-09-01", { maxDate: "2026-08-31" }), false);
  assert.equal(isDateSelectable("2026-08-20", { disabledDates: ["2026-08-20"] }), false);
});

test("confirmation errors are returned and forwarded without rejecting the dialog", async () => {
  const expected = new Error("Could not delete record");
  let forwarded;
  const result = await runConfirmation(
    async () => {
      throw expected;
    },
    (error) => {
      forwarded = error;
    }
  );

  assert.equal(result.error, expected);
  assert.equal(result.message, expected.message);
  assert.equal(forwarded, expected);
  assert.deepEqual(await runConfirmation(async () => "done"), { error: null, message: "" });
});
