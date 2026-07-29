import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCacheScope,
  cacheKeyMatchesPrefix,
  createRequestDeduper,
  DEFAULT_CACHE_TTL_MS,
  isCacheRecordExpired,
  removeCollectionRow,
  upsertCollectionRow,
} from "../lib/sessionCache.js";

test("cache scopes isolate user, company, and employee identities", () => {
  const first = buildCacheScope({
    uid: "user-1",
    companyId: "company-a",
    employeeId: "employee-1",
  });
  const second = buildCacheScope({
    uid: "user-1",
    companyId: "company-b",
    employeeId: "employee-1",
  });
  const third = buildCacheScope({
    uid: "user-2",
    companyId: "company-a",
    employeeId: "employee-1",
  });

  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.equal(first, "user-1:company-a:employee-1");
});

test("cache records expire after the five minute default", () => {
  const now = 1_000_000;
  assert.equal(
    isCacheRecordExpired(
      { updatedAt: now - DEFAULT_CACHE_TTL_MS + 1, ttlMs: DEFAULT_CACHE_TTL_MS },
      DEFAULT_CACHE_TTL_MS,
      now
    ),
    false
  );
  assert.equal(
    isCacheRecordExpired(
      { updatedAt: now - DEFAULT_CACHE_TTL_MS - 1, ttlMs: DEFAULT_CACHE_TTL_MS },
      DEFAULT_CACHE_TTL_MS,
      now
    ),
    true
  );
  assert.equal(isCacheRecordExpired(null, DEFAULT_CACHE_TTL_MS, now), true);
});

test("concurrent requests for one scoped key share one fetch", async () => {
  const deduper = createRequestDeduper();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const fetcher = async () => {
    calls += 1;
    await pending;
    return { ok: true };
  };

  const first = deduper.run("scope.collection:bookings", fetcher);
  const second = deduper.run("scope.collection:bookings", fetcher);
  assert.equal(first, second);
  assert.equal(calls, 0);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(left, { ok: true });
  assert.deepEqual(right, { ok: true });
  assert.equal(deduper.size, 0);
});

test("forced refresh keys can still be deduplicated by scoped resource key", async () => {
  const deduper = createRequestDeduper();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls;
  };

  const [first, second] = await Promise.all([
    deduper.run("scope.timesheets:employee:1234", fetcher),
    deduper.run("scope.timesheets:employee:1234", fetcher),
  ]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(calls, 1);
});

test("prefix invalidation matches only related resource keys", () => {
  assert.equal(
    cacheKeyMatchesPrefix(
      "user:company:employee.collection:bookings:week:2026-07-13",
      "user:company:employee.collection:bookings"
    ),
    true
  );
  assert.equal(
    cacheKeyMatchesPrefix(
      "user:company:employee.collection:vehicles",
      "user:company:employee.collection:bookings"
    ),
    false
  );
});

test("optimistic timesheet upserts replace the matching week", () => {
  const rows = [
    { id: "1234_2026-07-06", weekStart: "2026-07-06", submitted: false },
  ];
  const next = upsertCollectionRow(
    rows,
    { id: "1234_2026-07-06", weekStart: "2026-07-06", submitted: true },
    ["id", "weekStart", "weekISO"]
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].submitted, true);
  assert.equal(rows[0].submitted, false);
});

test("optimistic timesheet removal accepts legacy week keys", () => {
  const rows = [
    { id: "one", weekISO: "2026-07-06" },
    { id: "two", weekStart: "2026-07-13" },
  ];
  const next = removeCollectionRow(
    rows,
    "2026-07-06",
    ["id", "weekStart", "weekISO"]
  );
  assert.deepEqual(next, [{ id: "two", weekStart: "2026-07-13" }]);
});
