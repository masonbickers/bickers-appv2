import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchWithServiceWakeRetry,
  isRetryableServiceStatus,
} from "../lib/serviceRetry.js";

test("only transient gateway failures are treated as service wake failures", () => {
  assert.equal(isRetryableServiceStatus(502), true);
  assert.equal(isRetryableServiceStatus(503), true);
  assert.equal(isRetryableServiceStatus(504), true);
  assert.equal(isRetryableServiceStatus(400), false);
  assert.equal(isRetryableServiceStatus(401), false);
  assert.equal(isRetryableServiceStatus(500), false);
});

test("service requests retry a cold start and return the successful response", async () => {
  const statuses = [503, 503, 200];
  const attempts = [];
  const response = await fetchWithServiceWakeRetry("https://example.test/health", {}, {
    fetchImpl: async () => {
      const status = statuses[attempts.length];
      attempts.push(status);
      return { ok: status === 200, status };
    },
    retryDelaysMs: [0, 1, 1],
    waitImpl: async () => {},
  });

  assert.equal(response.status, 200);
  assert.deepEqual(attempts, [503, 503, 200]);
});

test("validation and authentication responses are never retried", async () => {
  let attempts = 0;
  const response = await fetchWithServiceWakeRetry("https://example.test/login", {}, {
    fetchImpl: async () => {
      attempts += 1;
      return { ok: false, status: 403 };
    },
    retryDelaysMs: [0, 1, 1],
    waitImpl: async () => {},
  });

  assert.equal(response.status, 403);
  assert.equal(attempts, 1);
});

test("network interruptions retry without duplicating a successful response", async () => {
  let attempts = 0;
  const response = await fetchWithServiceWakeRetry("https://example.test/login", {}, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("Network request failed");
      return { ok: true, status: 200 };
    },
    retryDelaysMs: [0, 1, 1],
    waitImpl: async () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
});
