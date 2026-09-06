import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collapseInboxDuplicates } from "../lib/notificationInbox.js";
import { getBookingDayNote } from "../lib/bookingDayNotes.js";

const inboxSource = readFileSync(
  new URL("../app/(protected)/notifications.js", import.meta.url),
  "utf8"
);
const detailSource = readFileSync(
  new URL("../app/(protected)/notification/[id].js", import.meta.url),
  "utf8"
);

test("notification inbox collapses exact duplicate events", () => {
  const shared = {
    title: "New job assigned",
    body: "Job 8901 • Mon 17 Aug • Bovingdon",
    data: { bookingId: "booking-1", dateISO: "2026-08-17" },
  };
  const result = collapseInboxDuplicates([
    { ...shared, id: "new", createdAt: 2, read: true },
    { ...shared, id: "old", createdAt: 1, read: false },
    { ...shared, id: "updated", title: "Job updated", createdAt: 3 },
  ]);

  assert.deepEqual(result.map((item) => item.id), ["new", "updated"]);
  assert.equal(result[0].read, true);
});

test("notification inbox uses compact grouped cards and separate time metadata", () => {
  assert.match(inboxSource, /collapseInboxDuplicates\(items\)/);
  assert.match(inboxSource, /styles\.groupCard/);
  assert.match(inboxSource, /styles\.notificationTitleRow/);
  assert.match(inboxSource, /styles\.unreadLabel/);
  assert.doesNotMatch(inboxSource, /\{`  \$\{formatTime/);
});

test("notification inbox relies on one compact page gutter", () => {
  assert.match(inboxSource, /gutter="compact"/);
  assert.doesNotMatch(inboxSource, /filters:\s*\{[^}]*paddingHorizontal/);
  assert.doesNotMatch(inboxSource, /content:\s*\{[^}]*paddingHorizontal/);
});

test("notification detail separates message segments from useful metadata", () => {
  assert.match(detailSource, /function notificationBodySegments/);
  assert.match(detailSource, /styles\.summaryCard/);
  assert.match(detailSource, /styles\.detailCard/);
  assert.match(detailSource, /label="Received"/);
  assert.doesNotMatch(detailSource, /label="Category"/);
});

test("notification detail resolves and shows notes for the notified job day", () => {
  assert.equal(
    getBookingDayNote(
      { notesByDate: { "2026-08-20": "Use the north gate." } },
      "2026-08-20"
    ),
    "Use the north gate."
  );
  assert.equal(
    getBookingDayNote(
      {
        notesByDate: {
          "2026-08-20": "Other",
          "2026-08-20-other": "Call production on arrival.",
        },
      },
      "2026-08-20"
    ),
    "Call production on arrival."
  );
  assert.match(detailSource, /getDoc\(doc\(db, "bookings"/);
  assert.match(detailSource, />Day notes</);
});
