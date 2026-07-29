import assert from "node:assert/strict";
import test from "node:test";

import { ASYNC_STATES, resolveAsyncState } from "../lib/asyncState.js";

test("shows initial loading only when there is no usable content", () => {
  const resources = [{ isInitialLoading: true, isRefreshing: false, error: null }];
  assert.equal(resolveAsyncState(resources), ASYNC_STATES.INITIAL_LOADING);
  assert.equal(
    resolveAsyncState(resources, { hasContent: true }),
    ASYNC_STATES.READY
  );
});

test("first-load error takes precedence over loading for mixed resources", () => {
  const resources = [
    { isInitialLoading: true, error: null },
    { isInitialLoading: false, error: new Error("offline") },
  ];
  assert.equal(resolveAsyncState(resources), ASYNC_STATES.INITIAL_ERROR);
});

test("cached data turns errors into non-blocking refresh errors", () => {
  assert.equal(
    resolveAsyncState([{ error: new Error("offline") }], { hasContent: true }),
    ASYNC_STATES.REFRESH_ERROR
  );
});

test("cached data remains ready during initial hydration and refreshes silently", () => {
  assert.equal(
    resolveAsyncState([{ isInitialLoading: true }], { hasContent: true }),
    ASYNC_STATES.READY
  );
  assert.equal(
    resolveAsyncState([{ isRefreshing: true }], { hasContent: true }),
    ASYNC_STATES.REFRESHING
  );
});

test("refresh error takes precedence over a simultaneous refresh", () => {
  assert.equal(
    resolveAsyncState(
      [{ isRefreshing: true }, { error: new Error("failed") }],
      { hasContent: true }
    ),
    ASYNC_STATES.REFRESH_ERROR
  );
});

test("successful empty and populated results are ready", () => {
  assert.equal(resolveAsyncState([{ data: [], error: null }]), ASYNC_STATES.READY);
  assert.equal(
    resolveAsyncState([{ data: [{ id: "1" }], error: null }], { hasContent: true }),
    ASYNC_STATES.READY
  );
});
