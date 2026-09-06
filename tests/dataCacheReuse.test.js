import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const providerSource = readFileSync(
  new URL("../providers/DataCacheProvider.tsx", import.meta.url),
  "utf8"
);

test("reopened pages synchronously reuse loaded data and refresh silently", () => {
  assert.match(providerSource, /const peek = useCallback/);
  assert.match(providerSource, /const initialCached = enabled && key \? peek<T>\(key\) : null/);
  assert.match(providerSource, /initialCached\?\.data \?\? null/);
  assert.match(providerSource, /cached && showRefreshing/);
  assert.match(providerSource, /force: true, showRefreshing: true/);
});

test("offline startup preserves authenticated cached pages", () => {
  assert.match(providerSource, /loading: authLoading/);
  assert.match(providerSource, /if \(authLoading \|\| isAuthed\) return/);
  assert.match(providerSource, /networkState\?\.isConnected === false/);
  assert.match(providerSource, /return cached\.data/);
});
