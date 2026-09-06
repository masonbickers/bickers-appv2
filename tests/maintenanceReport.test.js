import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const maintenanceSource = readFileSync(
  new URL("../app/(protected)/maintenance.js", import.meta.url),
  "utf8"
);

test("maintenance reports use company-scoped asset resources", () => {
  assert.match(maintenanceSource, /const vehiclesResource = useVehicles\(\)/);
  assert.match(maintenanceSource, /const equipmentResource = useEquipment\(\)/);
  assert.match(maintenanceSource, /await addDoc\(collection\(db, "vehicleIssues"\), \{\s*companyId,/);
});

test("fleet vehicles remain available as maintenance report targets", () => {
  assert.match(maintenanceSource, /const reportableVehicles = normalizedVehicles/);
  assert.doesNotMatch(maintenanceSource, /filter\(.*fleet vehicles/i);
});

test("vehicle options and reports include the number plate", () => {
  assert.match(maintenanceSource, /getVehicleDisplayLabel\(asset, vehicles\)/);
  assert.match(maintenanceSource, /registration: getVehicleRegistration\(asset\)/);
  assert.match(maintenanceSource, /\{selectedRegistration\}/);
});

test("equipment can be selected and identified in maintenance reports", () => {
  assert.match(maintenanceSource, /\{ label: "Equipment", value: "equipment" \}/);
  assert.match(maintenanceSource, /equipmentDocId: asset\.id/);
  assert.match(maintenanceSource, /equipmentName: getEquipmentName\(asset\)/);
  assert.match(maintenanceSource, /serialNumber: String\(asset\.serialNumber/);
});

test("maintenance is the shared component-library pilot", () => {
  for (const primitive of ["Banner", "PageSection", "FormStep", "SelectField", "StateView", "TextArea", "AppButton"]) {
    assert.match(maintenanceSource, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(maintenanceSource, /function Select\b|<TextInput\b|<Picker\b|density="compact"/);
  assert.match(maintenanceSource, /testID="category-select"/);
  assert.match(maintenanceSource, /testID="vehicle-select"/);
});
