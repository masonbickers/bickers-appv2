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

function normaliseVehicleKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function looksLikeVehicleDocumentId(value) {
  const text = String(value || "").trim();
  return (
    /^[A-Za-z0-9_-]{18,28}$/.test(text) &&
    /[A-Za-z]/.test(text) &&
    /\d/.test(text)
  );
}

export function getVehicleReferenceId(vehicle = {}) {
  if (!vehicle || typeof vehicle !== "object") return String(vehicle ?? "").trim();
  return String(
    firstPresent(
      vehicle.vehicleId,
      vehicle.vehicleID,
      vehicle.vehicleDocId,
      vehicle.id,
      vehicle.docId,
      vehicle.firebaseId,
      vehicle.refId,
      vehicle.value
    ) || ""
  ).trim();
}

export function findVehicleRecord(vehicleRef, vehicles = []) {
  const directory = Array.isArray(vehicles) ? vehicles : [];
  if (!vehicleRef || directory.length === 0) return null;

  const referenceId = getVehicleReferenceId(vehicleRef);
  const referenceRecord = asRecord(vehicleRef);
  const referenceName = normaliseVehicleKey(getVehicleName(referenceRecord));
  const referenceRegistration = normaliseVehicleKey(
    getVehicleRegistration(referenceRecord)
  );
  const primitiveKey =
    typeof vehicleRef === "string" || typeof vehicleRef === "number"
      ? normaliseVehicleKey(vehicleRef)
      : "";

  return (
    directory.find(
      (vehicle) =>
        referenceId &&
        normaliseVehicleKey(getVehicleReferenceId(vehicle)) ===
          normaliseVehicleKey(referenceId)
    ) ||
    directory.find(
      (vehicle) =>
        referenceRegistration &&
        normaliseVehicleKey(getVehicleRegistration(vehicle)) ===
          referenceRegistration
    ) ||
    directory.find(
      (vehicle) =>
        referenceName && normaliseVehicleKey(getVehicleName(vehicle)) === referenceName
    ) ||
    directory.find((vehicle) => {
      if (!primitiveKey) return false;
      return [
        getVehicleReferenceId(vehicle),
        getVehicleName(vehicle),
        getVehicleRegistration(vehicle),
      ]
        .map(normaliseVehicleKey)
        .includes(primitiveKey);
    }) ||
    null
  );
}

export function getVehicleDisplayName(
  vehicleRef,
  vehicles = [],
  fallback = "Unknown vehicle"
) {
  const matched = findVehicleRecord(vehicleRef, vehicles);
  const source = matched || asRecord(vehicleRef);
  const explicitName = String(getVehicleName(source) || "").trim();
  if (explicitName) return explicitName;

  const descriptiveName = [getVehicleManufacturer(source), source.model]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  return descriptiveName || fallback;
}

export function getVehicleDisplayLabel(vehicleRef, vehicles = [], options = {}) {
  const fallback = options.fallback || "Unknown vehicle";
  const matched = findVehicleRecord(vehicleRef, vehicles);
  const source = matched || asRecord(vehicleRef);
  const name = getVehicleDisplayName(vehicleRef, vehicles, fallback);
  const registration = String(getVehicleRegistration(source) || "").trim();
  return options.includeRegistration === false || !registration
    ? name
    : `${name} · ${registration}`;
}

export function getVehicleDisplayList(vehicleRefs, vehicles = [], options = {}) {
  const refs = Array.isArray(vehicleRefs)
    ? vehicleRefs
    : vehicleRefs == null || vehicleRefs === ""
    ? []
    : [vehicleRefs];
  return Array.from(
    new Set(refs.map((ref) => getVehicleDisplayLabel(ref, vehicles, options)).filter(Boolean))
  );
}

export function resolveNotificationVehicleBody(body, vehicles = []) {
  const text = String(body || "");
  if (!text.includes("Vehicles:")) return text;

  return text
    .split(" • ")
    .map((part) => {
      if (!part.startsWith("Vehicles:")) return part;
      const references = part
        .slice("Vehicles:".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!references.length) return part;

      const labels = references.map((reference) => {
        const matched = findVehicleRecord(reference, vehicles);
        if (matched) return getVehicleDisplayLabel(matched, vehicles);
        return looksLikeVehicleDocumentId(reference) ? "Vehicle" : reference;
      });
      return `Vehicles: ${Array.from(new Set(labels)).join(", ")}`;
    })
    .join(" • ");
}

export function getBookingVehicleReferences(booking = {}) {
  const candidates = [
    booking.vehicles,
    booking.vehicleIds,
    booking.vehicleIDs,
    booking.selectedVehicles,
    booking.vehiclesSelected,
    booking.vehicle,
  ];
  for (const refs of candidates) {
    if (Array.isArray(refs) && refs.length > 0) return refs;
    if (!Array.isArray(refs) && refs !== undefined && refs !== null && refs !== "") {
      return [refs];
    }
  }
  return [];
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
