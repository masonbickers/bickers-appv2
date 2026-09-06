import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildVehiclePrepRecordId,
  findVehiclePrepRecord,
  isVehiclePrepComplete,
} from "../lib/vehiclePrep.js";

const prepScreenSource = readFileSync(
  new URL("../app/(protected)/vehicle-prep/[id].jsx", import.meta.url),
  "utf8"
);
const jobDaySource = readFileSync(
  new URL("../app/(protected)/job.js", import.meta.url),
  "utf8"
);
const firestoreRules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8"
);

test("one deterministic preparation record is used per booking and vehicle", () => {
  const id = buildVehiclePrepRecordId("job/123", "vehicle/456");
  assert.equal(id, "job_job%2F123__vehicle_vehicle%2F456");
  assert.equal(buildVehiclePrepRecordId("job/123", "vehicle/456"), id);
  assert.notEqual(buildVehiclePrepRecordId("job/124", "vehicle/456"), id);
});

test("completion lookup supports deterministic and legacy preparation records", () => {
  const current = {
    id: buildVehiclePrepRecordId("booking-1", "vehicle-1"),
    bookingId: "booking-1",
    vehicleId: "vehicle-1",
    completed: true,
  };
  const legacy = {
    id: "legacy-record",
    prepDate: "2026-08-21",
    vehicleId: "vehicle-2",
    completed: true,
  };

  assert.equal(
    findVehiclePrepRecord([current], {
      bookingId: "booking-1",
      vehicleId: "vehicle-1",
    }),
    current
  );
  assert.equal(
    isVehiclePrepComplete([legacy], {
      bookingId: "booking-2",
      vehicleId: "vehicle-2",
      date: "2026-08-21",
    }),
    true
  );
});

test("employee prep saves and optimistically updates the collection watched by Job Day", () => {
  assert.match(prepScreenSource, /doc\(db, "vehiclePrepRecords", prepRecordId\)/);
  assert.match(prepScreenSource, /setDoc\(prepRef, record, \{ merge: true \}\)/);
  assert.match(prepScreenSource, /prepRecordsResource\.upsertRow/);
  assert.match(jobDaySource, /useCompanyCollection\("vehiclePrepRecords"\)/);
  assert.match(jobDaySource, /prepRecord=\{findVehiclePrepRecord\(records, item\)\}/);
  assert.match(jobDaySource, /bookingId: item\.bookingId/);
  assert.match(jobDaySource, /prepDone \? "Review" : "Prep"/);
});

test("preparation records include a human-readable audit identity", () => {
  assert.match(prepScreenSource, /completedByUid:/);
  assert.match(prepScreenSource, /completedByEmployeeId:/);
  assert.match(prepScreenSource, /completedByName:/);
  assert.match(prepScreenSource, /completedByCode:/);
  assert.match(jobDaySource, /Prepped by \$\{prepRecord\.completedByName\}/);
});

test("Job Day requests one prep at the booking departure rather than once per booking day", () => {
  assert.match(jobDaySource, /function getBookingDepartureDay/);
  assert.match(jobDaySource, /const departureDay = getBookingDepartureDay\(b\)/);
  assert.doesNotMatch(jobDaySource, /days\.forEach\(\(day\)/);
});

test("both user and service workspaces can maintain shared prep records", () => {
  const rules = firestoreRules.match(/match \/vehiclePrepRecords\/\{docId\} \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(rules, /allow read: if canReadAnyWorkspaceTenantDoc\(\)/);
  assert.match(rules, /canCreateServiceTenantDoc\(\)/);
  assert.match(rules, /canCreateUserTenantDoc\(\) && validUserVehiclePrepRecord\(\)/);
  assert.match(rules, /canUpdateServiceTenantDoc\(\)/);
  assert.match(rules, /userVehiclePrepIdentityUnchanged\(\)/);
  assert.match(firestoreRules, /completedByUid == request\.auth\.uid/);
});
