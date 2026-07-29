export function firstPresent(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return "";
}

function addPresent(target, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  target[key] = value;
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalised = value.trim().toLowerCase();
  return ["true", "yes", "y", "1", "on", "not applicable", "n/a", "na"].includes(
    normalised
  );
}

function isFalseyFlag(value) {
  if (value === false) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value !== "string") return false;
  const normalised = value.trim().toLowerCase();
  return ["false", "no", "n", "0", "off"].includes(normalised);
}

export function isVehicleMotApplicable(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (isTruthyFlag(vehicle.motNotApplicable)) return false;
  if (isFalseyFlag(vehicle.motApplicable)) return false;
  return true;
}

export function isVehicleServiceApplicable(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (isTruthyFlag(vehicle.serviceNotApplicable)) return false;
  if (isFalseyFlag(vehicle.serviceApplicable)) return false;
  return true;
}

export function getVehicleName(vehicle = {}) {
  vehicle = asRecord(vehicle);
  return firstPresent(vehicle.name, vehicle.vehicleName, vehicle.label, vehicle.title);
}

export function getVehicleRegistration(vehicle = {}) {
  vehicle = asRecord(vehicle);
  return firstPresent(
    vehicle.registration,
    vehicle.reg,
    vehicle.registrationNumber,
    vehicle.plate,
    vehicle.license
  );
}

export function getVehicleManufacturer(vehicle = {}) {
  vehicle = asRecord(vehicle);
  return firstPresent(vehicle.manufacturer, vehicle.make);
}

export function getVehicleMileage(vehicle = {}) {
  vehicle = asRecord(vehicle);
  return firstPresent(vehicle.mileage, vehicle.odometer, vehicle.serviceOdometer);
}

export function getVehicleOperationalStatus(vehicle = {}) {
  vehicle = asRecord(vehicle);
  return firstPresent(
    vehicle.operationalStatus,
    vehicle.fleetStatus,
    vehicle.vehicleStatus
  );
}

export function isVehicleActiveForMaintenance(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (isFalseyFlag(vehicle.active) || isFalseyFlag(vehicle.isActive)) return false;
  if (isTruthyFlag(vehicle.inactive) || isTruthyFlag(vehicle.retired)) return false;

  const status = String(getVehicleOperationalStatus(vehicle) || "")
    .trim()
    .toLowerCase();
  if (!status) return true;

  return ![
    "inactive",
    "retired",
    "sold",
    "sorn",
    "off fleet",
    "off-fleet",
    "decommissioned",
    "not in use",
    "not used",
  ].includes(status);
}

export function getVehicleLastMot(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (!isVehicleMotApplicable(vehicle)) return "";
  return firstPresent(vehicle.lastMOT, vehicle.lastMot, vehicle.lastMotDate);
}

export function getVehicleNextMot(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (!isVehicleMotApplicable(vehicle)) return "";
  return firstPresent(
    vehicle.nextMOT,
    vehicle.nextMot,
    vehicle.nextMotDate,
    vehicle.motDueDate,
    vehicle.motExpiryDate
  );
}

export function getVehicleLastService(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (!isVehicleServiceApplicable(vehicle)) return "";
  return firstPresent(vehicle.lastService, vehicle.lastServiceDate);
}

export function getVehicleNextService(vehicle = {}) {
  vehicle = asRecord(vehicle);
  if (!isVehicleServiceApplicable(vehicle)) return "";
  return firstPresent(
    vehicle.nextService,
    vehicle.nextServiceDate,
    vehicle.serviceDueDate,
    vehicle.nextSvc
  );
}

export function getVehicleInsuranceExpiry(vehicle = {}) {
  vehicle = asRecord(vehicle);
  return firstPresent(
    vehicle.insuredUntil,
    vehicle.insuranceExpiry,
    vehicle.insuranceExpiryDate,
    vehicle.insuranceUntil
  );
}

export function buildVehicleIdentityMirrorUpdate(vehicle = {}) {
  vehicle = asRecord(vehicle);
  const update = {};
  const name = getVehicleName(vehicle);
  const registration = getVehicleRegistration(vehicle);
  const manufacturer = getVehicleManufacturer(vehicle);
  const operationalStatus = getVehicleOperationalStatus(vehicle);

  addPresent(update, "name", name);
  addPresent(update, "vehicleName", name);
  addPresent(update, "registration", registration);
  addPresent(update, "reg", registration);
  addPresent(update, "registrationNumber", registration);
  addPresent(update, "manufacturer", manufacturer);
  addPresent(update, "make", manufacturer);
  addPresent(update, "model", vehicle.model);
  addPresent(update, "category", vehicle.category);
  addPresent(update, "operationalStatus", operationalStatus);
  addPresent(update, "fleetStatus", operationalStatus);
  addPresent(update, "vehicleStatus", operationalStatus);

  return update;
}

export function buildVehicleOdometerMirrorUpdate(odometer) {
  const update = {};
  if (odometer === undefined || odometer === null || odometer === "") return update;
  if (typeof odometer === "number" && Number.isNaN(odometer)) return update;
  update.odometer = odometer;
  update.mileage = odometer;
  update.serviceOdometer = odometer;
  return update;
}

export function buildVehicleServiceDateMirrorUpdate(dates = {}) {
  const { lastService, nextService } = asRecord(dates);
  const update = {};
  addPresent(update, "lastService", lastService);
  addPresent(update, "lastServiceDate", lastService);
  addPresent(update, "nextService", nextService);
  addPresent(update, "nextServiceDate", nextService);
  addPresent(update, "serviceDueDate", nextService);
  return update;
}

export function buildVehicleMotDateMirrorUpdate(dates = {}) {
  const { lastMot, nextMot } = asRecord(dates);
  const update = {};
  addPresent(update, "lastMOT", lastMot);
  addPresent(update, "lastMot", lastMot);
  addPresent(update, "lastMotDate", lastMot);
  addPresent(update, "nextMOT", nextMot);
  addPresent(update, "nextMot", nextMot);
  addPresent(update, "nextMotDate", nextMot);
  addPresent(update, "motDueDate", nextMot);
  return update;
}

export function getEquipmentName(equipment = {}) {
  equipment = asRecord(equipment);
  return firstPresent(equipment.name, equipment.equipmentName, equipment.label);
}

export function getEquipmentCategory(equipment = {}) {
  equipment = asRecord(equipment);
  return firstPresent(equipment.category, equipment.equipmentType, equipment.type);
}

export function getEquipmentStatus(equipment = {}) {
  equipment = asRecord(equipment);
  return firstPresent(equipment.status, equipment.equipmentStatus);
}

export function getEquipmentLastInspection(equipment = {}) {
  equipment = asRecord(equipment);
  return firstPresent(equipment.lastInspection, equipment.lastInspectionDate);
}

export function getEquipmentNextInspection(equipment = {}) {
  equipment = asRecord(equipment);
  return firstPresent(
    equipment.nextInspection,
    equipment.inspectionDueDate,
    equipment.nextInspectionDate
  );
}

export function buildEquipmentCoreUpdate(equipment = {}) {
  equipment = asRecord(equipment);
  const update = {};
  addPresent(update, "name", getEquipmentName(equipment));
  addPresent(update, "category", getEquipmentCategory(equipment));
  addPresent(update, "status", getEquipmentStatus(equipment));
  addPresent(update, "serialNumber", equipment.serialNumber);
  addPresent(update, "asset", equipment.asset);
  addPresent(update, "location", equipment.location);
  addPresent(update, "lastInspection", getEquipmentLastInspection(equipment));
  addPresent(update, "inspectionFrequency", equipment.inspectionFrequency);
  addPresent(update, "nextInspection", getEquipmentNextInspection(equipment));
  addPresent(update, "notes", equipment.notes);
  return update;
}
