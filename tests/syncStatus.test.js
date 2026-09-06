import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveSyncStatus } from "../lib/sync/status.js";

test("sync status clearly distinguishes offline, syncing, waiting, and synced states", () => {
  assert.equal(
    resolveSyncStatus({ isOnline: false, outboxCount: 3 }).label,
    "Offline — 3 changes waiting"
  );
  assert.equal(
    resolveSyncStatus({ isOnline: true, syncing: true, outboxCount: 3 }).label,
    "Syncing…"
  );
  assert.equal(
    resolveSyncStatus({ isOnline: true, outboxCount: 1 }).label,
    "1 change waiting"
  );
  assert.equal(
    resolveSyncStatus({ isOnline: true, outboxCount: 0 }).label,
    "All changes synced"
  );
});

test("unknown connectivity is not reported as successfully synced", () => {
  assert.equal(resolveSyncStatus({ isOnline: null }).label, "Checking sync…");
});

test("the passive synced control collapses without hiding actionable states", () => {
  const source = readFileSync(
    new URL("../components/app/SyncStatusControl.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /isCompact = status\.key === "synced"/);
  assert.match(source, /isCompact && styles\.compactChip/);
  assert.match(source, /!isCompact \? \(/);
});
