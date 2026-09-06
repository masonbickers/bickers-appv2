import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const expensesSource = readFileSync(
  new URL("../app/(protected)/expenses.js", import.meta.url),
  "utf8"
);

test("expense errors distinguish account access from connectivity", () => {
  assert.match(expensesSource, /code\.includes\("permission-denied"\)/);
  assert.match(expensesSource, /Expense access needs enabling/);
  assert.match(expensesSource, /code\.includes\("unavailable"\)/);
  assert.match(expensesSource, /You appear to be offline/);
});

test("empty and error states retain useful claim guidance", () => {
  assert.match(expensesSource, /function ExpenseGuide/);
  assert.match(expensesSource, /Before you submit/);
  assert.match(expensesSource, /Photograph or attach the receipt/);
  assert.match(expensesSource, /Link the cost to a job when relevant/);
  assert.match(expensesSource, /Personal costs are submitted for approval/);
  assert.match(expensesSource, /hasInitialLoadError/);
  assert.match(expensesSource, /isEmpty/);
});

test("expense content uses the compact shared page rhythm", () => {
  assert.match(expensesSource, /contentSpacing="compact"/);
  assert.match(expensesSource, /PERSONAL CLAIMS/);
});
