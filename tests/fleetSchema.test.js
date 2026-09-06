import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVehicleIdentityMirrorUpdate,
  buildVehicleMotDateMirrorUpdate,
  buildVehicleOdometerMirrorUpdate,
  getBookingVehicleReferences,
  getVehicleDisplayLabel,
  getVehicleDisplayList,
  getVehicleDisplayName,
  getVehicleName,
  getVehicleRegistration,
  isVehicleActiveForMaintenance,
  isVehicleMotApplicable,
  isVehicleServiceApplicable,
  resolveNotificationVehicleBody,
} from "../lib/fleetSchema.js";

test("legacy vehicle identity fields resolve consistently", () => {
  assert.equal(getVehicleName({ vehicleName: "Unit 12" }), "Unit 12");
  assert.equal(getVehicleRegistration({ plate: "AB12 CDE" }), "AB12 CDE");
});

test("maintenance applicability accepts legacy boolean flags", () => {
  assert.equal(isVehicleMotApplicable({ motNotApplicable: "yes" }), false);
  assert.equal(isVehicleMotApplicable({ motApplicable: "no" }), false);
  assert.equal(isVehicleMotApplicable({}), true);
  assert.equal(isVehicleServiceApplicable({ serviceApplicable: 0 }), false);
  assert.equal(isVehicleServiceApplicable({}), true);
});

test("inactive fleet statuses are excluded from maintenance", () => {
  assert.equal(isVehicleActiveForMaintenance({ fleetStatus: "SORN" }), false);
  assert.equal(isVehicleActiveForMaintenance({ retired: true }), false);
  assert.equal(isVehicleActiveForMaintenance({ active: false }), false);
  assert.equal(isVehicleActiveForMaintenance({ operationalStatus: "In service" }), true);
});

test("identity mirror updates keep legacy fields in sync", () => {
  assert.deepEqual(
    buildVehicleIdentityMirrorUpdate({
      vehicleName: "Unit 12",
      reg: "AB12 CDE",
      make: "Ford",
      fleetStatus: "In service",
    }),
    {
      name: "Unit 12",
      vehicleName: "Unit 12",
      registration: "AB12 CDE",
      reg: "AB12 CDE",
      registrationNumber: "AB12 CDE",
      manufacturer: "Ford",
      make: "Ford",
      operationalStatus: "In service",
      fleetStatus: "In service",
      vehicleStatus: "In service",
    }
  );
});

test("odometer and MOT mirrors write all supported aliases", () => {
  assert.deepEqual(buildVehicleOdometerMirrorUpdate(12345), {
    odometer: 12345,
    mileage: 12345,
    serviceOdometer: 12345,
  });
  assert.deepEqual(
    buildVehicleMotDateMirrorUpdate({
      lastMot: "2026-01-01",
      nextMot: "2027-01-01",
    }),
    {
      lastMOT: "2026-01-01",
      lastMot: "2026-01-01",
      lastMotDate: "2026-01-01",
      nextMOT: "2027-01-01",
      nextMot: "2027-01-01",
      nextMotDate: "2027-01-01",
      motDueDate: "2027-01-01",
    }
  );
});

test("vehicle display resolves booking ids to vehicle names", () => {
  const vehicles = [
    {
      id: "firestore-vehicle-id",
      name: "Camera Tracking Van",
      registration: "AB12 CDE",
    },
  ];

  assert.equal(
    getVehicleDisplayName("firestore-vehicle-id", vehicles),
    "Camera Tracking Van"
  );
  assert.equal(
    getVehicleDisplayLabel({ vehicleId: "firestore-vehicle-id" }, vehicles),
    "Camera Tracking Van · AB12 CDE"
  );
  assert.equal(
    getVehicleDisplayName(
      { id: "service-record-id", vehicleId: "firestore-vehicle-id" },
      vehicles
    ),
    "Camera Tracking Van"
  );
});

test("vehicle display never exposes an unresolved id", () => {
  assert.equal(getVehicleDisplayName("unresolved-firestore-id", []), "Unknown vehicle");
  assert.deepEqual(getVehicleDisplayList(["unresolved-firestore-id"], []), [
    "Unknown vehicle",
  ]);
});

test("vehicle display supports embedded and legacy booking references", () => {
  const booking = {
    vehicles: [],
    vehicleIds: [{ id: "van-1", vehicleName: "Rigging Van", reg: "XY99 ZZZ" }],
  };
  assert.deepEqual(getBookingVehicleReferences(booking), booking.vehicleIds);
  assert.deepEqual(getVehicleDisplayList(booking.vehicleIds), [
    "Rigging Van · XY99 ZZZ",
  ]);
});

test("stored notification bodies replace vehicle ids with current names", () => {
  const body =
    "Job 9213 • Mon 10 Aug • Client • Brighton • Vehicles: I6MObWIlfW1UgNRTP1BI";
  assert.equal(
    resolveNotificationVehicleBody(body, [
      {
        id: "I6MObWIlfW1UgNRTP1BI",
        name: "Camera Tracking Van",
        registration: "AB12 CDE",
      },
    ]),
    "Job 9213 • Mon 10 Aug • Client • Brighton • Vehicles: Camera Tracking Van · AB12 CDE"
  );
  assert.equal(
    resolveNotificationVehicleBody(body, []),
    "Job 9213 • Mon 10 Aug • Client • Brighton • Vehicles: Vehicle"
  );
  assert.equal(
    resolveNotificationVehicleBody(
      "Job 9213 • Vehicles: Low Loader 01 · AY65 LNO",
      []
    ),
    "Job 9213 • Vehicles: Low Loader 01 · AY65 LNO"
  );
});
