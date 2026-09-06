import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queueSource = readFileSync(
  new URL("../lib/sync/firestoreQueue.js", import.meta.url),
  "utf8"
);
const managerSource = readFileSync(
  new URL("../hooks/useSyncManager.js", import.meta.url),
  "utf8"
);
const outboxSource = readFileSync(
  new URL("../lib/sync/outbox.js", import.meta.url),
  "utf8"
);
const timesheetSource = readFileSync(
  new URL("../app/(protected)/week/[id]/index.js", import.meta.url),
  "utf8"
);

test("offline mutations are queued before attempting a Firestore write", () => {
  assert.match(queueSource, /NetInfo\.fetch\(\)/);
  assert.match(queueSource, /isDefinitelyOffline\(networkState\)/);
  assert.match(queueSource, /await queueMutation\(mutation\)/);
});

test("queued changes automatically sync when connectivity returns", () => {
  assert.match(managerSource, /NetInfo\.addEventListener/);
  assert.match(managerSource, /triggerSync\("reconnect"\)/);
});

test("sync status updates immediately when the local outbox changes", () => {
  assert.match(outboxSource, /export function subscribeOutbox/);
  assert.match(outboxSource, /notifyOutboxListeners\(\)/);
  assert.match(managerSource, /return subscribeOutbox\(refreshMeta\)/);
});

test("weekly times and notes use the offline-capable mutation path", () => {
  assert.match(timesheetSource, /runOrQueueFirestoreMutation/);
  assert.match(timesheetSource, /dayNotes:/);
  assert.match(timesheetSource, /notes:\s*String\(timesheet\.notes/);
  assert.match(timesheetSource, /Your timesheet changes will sync automatically/);
});
