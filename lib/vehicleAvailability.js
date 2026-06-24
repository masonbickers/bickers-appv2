const DEFAULT_WARNING_WINDOW_DAYS = 30;

const CLOSED_STATUSES = new Set([
  "resolved",
  "fixed",
  "closed",
  "complete",
  "completed",
  "cancelled",
  "canceled",
  "dismissed",
]);

const ACTIVE_BLOCKING_STATUSES = new Set([
  "inactive",
  "retired",
  "sold",
  "off fleet",
  "off-fleet",
  "decommissioned",
  "not in use",
  "not used",
]);

const OFF_ROAD_STATUSES = new Set([
  "off road",
  "off-road",
  "offroad",
  "off the road",
  "v o r",
  "vor",
  "vehicle off road",
]);

const TAX_BLOCKING_STATUSES = new Set([
  "sorn",
  "untaxed",
  "no tax",
  "not taxed",
  "tax expired",
  "expired",
]);

const INSURANCE_BLOCKING_STATUSES = new Set([
  "uninsured",
  "not insured",
  "no insurance",
  "insurance expired",
  "expired",
]);

function normaliseKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  const key = normaliseKey(value);
  return ["true", "yes", "y", "1", "on"].includes(key);
}

function isFalseyFlag(value) {
  if (value === false) return true;
  if (typeof value === "number") return value === 0;
  const key = normaliseKey(value);
  return ["false", "no", "n", "0", "off"].includes(key);
}

function firstPresent(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return "";
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function parseAvailabilityDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const uk = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (uk) {
    const [, dd, mm, yyyy] = uk.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getVehicleAvailabilityIdentity(vehicle = {}) {
  const registration = firstPresent(
    vehicle.registration,
    vehicle.reg,
    vehicle.registrationNumber
  );
  return {
    id: firstPresent(vehicle.id, vehicle.vehicleId, vehicle.vehicleDocId, vehicle.docId),
    name: firstPresent(vehicle.name, vehicle.vehicleName, vehicle.label, vehicle.title),
    registration,
    registrationKey: normaliseKey(registration).replace(/\s+/g, ""),
  };
}

export function getVehicleAvailabilityDates(vehicle = {}) {
  return {
    motExpiry: firstPresent(
      vehicle.nextMOT,
      vehicle.nextMot,
      vehicle.nextMotDate,
      vehicle.motDueDate,
      vehicle.motExpiryDate
    ),
    insuranceExpiry: firstPresent(
      vehicle.insuredUntil,
      vehicle.insuranceExpiry,
      vehicle.insuranceExpiryDate,
      vehicle.insuranceUntil
    ),
    nextService: firstPresent(
      vehicle.nextService,
      vehicle.nextServiceDate,
      vehicle.serviceDueDate
    ),
  };
}

function getOperationalStatus(vehicle = {}) {
  return firstPresent(
    vehicle.operationalStatus,
    vehicle.fleetStatus,
    vehicle.vehicleStatus
  );
}

function dateStatus(dateValue, now, warningWindowDays) {
  const date = parseAvailabilityDate(dateValue);
  if (!date) return { date: null, days: null, expired: false, dueSoon: false };

  const today = startOfDay(now);
  const target = startOfDay(date);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);

  return {
    date,
    days,
    expired: days < 0,
    dueSoon: days >= 0 && days <= warningWindowDays,
  };
}

function appendUnique(target, reason) {
  if (reason && !target.includes(reason)) target.push(reason);
}

function getRecordVehicleRefs(record = {}) {
  const reg = firstPresent(record.registration, record.reg, record.registrationNumber);
  return {
    id: firstPresent(record.vehicleId, record.vehicleDocId, record.id),
    name: firstPresent(record.vehicleName, record.vehicle, record.name),
    registration: reg,
    registrationKey: normaliseKey(reg).replace(/\s+/g, ""),
  };
}

function vehicleRefsMatch(vehicle, record) {
  const vehicleIdentity = getVehicleAvailabilityIdentity(vehicle);
  const recordRefs = getRecordVehicleRefs(record);

  if (vehicleIdentity.id && recordRefs.id && String(vehicleIdentity.id) === String(recordRefs.id)) {
    return true;
  }
  if (
    vehicleIdentity.registrationKey &&
    recordRefs.registrationKey &&
    vehicleIdentity.registrationKey === recordRefs.registrationKey
  ) {
    return true;
  }

  const vehicleName = normaliseKey(vehicleIdentity.name);
  const recordName = normaliseKey(recordRefs.name);
  return !!vehicleName && !!recordName && vehicleName === recordName;
}

function isOpenRecord(record = {}) {
  const status = normaliseKey(
    firstPresent(record.status, record.maintenance?.status, record.resolutionStatus)
  );
  return !CLOSED_STATUSES.has(status);
}

function getDefectSeverity(defect = {}) {
  const severity = normaliseKey(defect.severity);
  const priority = normaliseKey(defect.priority);
  const category = normaliseKey(defect.category || defect.review?.category);

  if (
    isTruthyFlag(defect.critical) ||
    isTruthyFlag(defect.offRoad) ||
    ["critical", "high", "immediate", "safety critical", "red"].includes(severity) ||
    ["critical", "high", "immediate", "red"].includes(priority) ||
    ["critical", "immediate", "red"].includes(category)
  ) {
    return "critical";
  }

  if (
    ["medium", "moderate", "amber", "general"].includes(severity) ||
    ["medium", "moderate", "amber"].includes(priority) ||
    ["general", "amber"].includes(category)
  ) {
    return "medium";
  }

  return "low";
}

function bookingVehicleMatches(vehicle, booking = {}) {
  if (vehicleRefsMatch(vehicle, booking)) return true;

  const list = [
    booking.vehicle,
    booking.vehicles,
    booking.selectedVehicles,
    booking.vehiclesSelected,
  ].flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));

  return list.some((entry) => {
    if (typeof entry === "string" || typeof entry === "number") {
      return vehicleRefsMatch(vehicle, {
        vehicleId: entry,
        vehicleName: entry,
        registration: entry,
      });
    }
    return vehicleRefsMatch(vehicle, entry);
  });
}

function getDateRangeFromRecord(record = {}) {
  const dateValues = [
    ...(Array.isArray(record.bookingDates) ? record.bookingDates : []),
    ...(Array.isArray(record.dates) ? record.dates : []),
  ];

  if (dateValues.length > 0) {
    const parsed = dateValues.map(parseAvailabilityDate).filter(Boolean).map(startOfDay);
    if (parsed.length === 0) return null;
    parsed.sort((a, b) => a.getTime() - b.getTime());
    return { start: parsed[0], end: parsed[parsed.length - 1] };
  }

  const start = parseAvailabilityDate(
    firstPresent(
      record.startDateISO,
      record.appointmentDateISO,
      record.startDate,
      record.date,
      record.serviceDateOnly,
      record.serviceDate
    )
  );
  const end = parseAvailabilityDate(
    firstPresent(
      record.endDateISO,
      record.endDate,
      record.startDateISO,
      record.appointmentDateISO,
      record.startDate,
      record.date,
      record.serviceDateOnly,
      record.serviceDate
    )
  );

  if (!start) return null;
  return { start: startOfDay(start), end: startOfDay(end || start) };
}

export function normaliseSelectedBookingDates(input) {
  const rawDates = Array.isArray(input)
    ? input
    : input?.selectedDates ||
      input?.bookingDates ||
      input?.dates ||
      [input?.startDateISO || input?.startDate || input?.date]
        .filter(Boolean);

  const parsed = rawDates.map(parseAvailabilityDate).filter(Boolean).map(startOfDay);
  if (parsed.length === 0 && input?.endDate) {
    const endOnly = parseAvailabilityDate(input.endDate);
    if (endOnly) parsed.push(startOfDay(endOnly));
  }

  if (parsed.length === 0) return [];

  parsed.sort((a, b) => a.getTime() - b.getTime());
  const start = parsed[0];
  const end =
    parseAvailabilityDate(input?.endDateISO || input?.endDate) ||
    parsed[parsed.length - 1];

  const dates = [];
  for (let d = startOfDay(start); d <= startOfDay(end); d = addDays(d, 1)) {
    dates.push(startOfDay(d));
  }
  return dates;
}

function dateRangeOverlapsSelected(range, selectedDates) {
  if (!range || selectedDates.length === 0) return false;
  return selectedDates.some((date) => date >= range.start && date <= range.end);
}

function isBlockingBookingStatus(status) {
  const key = normaliseKey(status || "confirmed");
  if (!key) return true;
  return ![
    "cancelled",
    "canceled",
    "complete",
    "completed",
    "rejected",
    "declined",
    "draft",
  ].includes(key);
}

function countOverlappingRecords(vehicle, records, selectedDates, currentBookingId) {
  if (!Array.isArray(records) || selectedDates.length === 0) return 0;

  return records.filter((record) => {
    if (!record) return false;
    if (currentBookingId && String(record.id) === String(currentBookingId)) return false;
    if (!isBlockingBookingStatus(record.status)) return false;
    if (!bookingVehicleMatches(vehicle, record)) return false;
    return dateRangeOverlapsSelected(getDateRangeFromRecord(record), selectedDates);
  }).length;
}

export function getVehicleAvailability(vehicle = {}, options = {}) {
  const {
    defectReports = [],
    maintenanceBookings = [],
    bookings = [],
    selectedDates = [],
    currentBookingId = null,
    warningWindowDays = DEFAULT_WARNING_WINDOW_DAYS,
    now = new Date(),
  } = options;

  const blockingReasons = [];
  const warningReasons = [];
  const dates = getVehicleAvailabilityDates(vehicle);
  const selectedBookingDates = normaliseSelectedBookingDates(selectedDates);

  const activeStatus = normaliseKey(getOperationalStatus(vehicle));
  if (isFalseyFlag(vehicle.active) || isFalseyFlag(vehicle.isActive)) {
    appendUnique(blockingReasons, "Vehicle inactive");
  }
  if (isTruthyFlag(vehicle.inactive) || ACTIVE_BLOCKING_STATUSES.has(activeStatus)) {
    appendUnique(blockingReasons, "Vehicle inactive");
  }

  if (
    isTruthyFlag(vehicle.offRoad) ||
    isTruthyFlag(vehicle.isOffRoad) ||
    OFF_ROAD_STATUSES.has(activeStatus) ||
    OFF_ROAD_STATUSES.has(normaliseKey(vehicle.offRoadStatus))
  ) {
    appendUnique(blockingReasons, "Vehicle off road");
  }

  const mot = dateStatus(dates.motExpiry, now, warningWindowDays);
  if (mot.expired) appendUnique(blockingReasons, "MOT expired");
  else if (mot.dueSoon) appendUnique(warningReasons, "MOT due within 30 days");

  const taxStatus = normaliseKey(vehicle.taxStatus);
  if (TAX_BLOCKING_STATUSES.has(taxStatus)) {
    appendUnique(blockingReasons, "Tax not valid");
  }

  const insuranceStatus = normaliseKey(vehicle.insuranceStatus);
  if (INSURANCE_BLOCKING_STATUSES.has(insuranceStatus)) {
    appendUnique(blockingReasons, "Insurance not valid");
  }

  const insurance = dateStatus(dates.insuranceExpiry, now, warningWindowDays);
  if (insurance.expired) appendUnique(blockingReasons, "Insurance expired");
  else if (insurance.dueSoon) appendUnique(warningReasons, "Insurance due within 30 days");

  const service = dateStatus(dates.nextService, now, warningWindowDays);
  if (service.expired || service.dueSoon) appendUnique(warningReasons, "Service due soon");

  defectReports
    .filter((defect) => isOpenRecord(defect) && vehicleRefsMatch(vehicle, defect))
    .forEach((defect) => {
      const severity = getDefectSeverity(defect);
      if (severity === "critical") appendUnique(blockingReasons, "Open critical defect");
      if (severity === "medium") appendUnique(warningReasons, "Open medium defect");
    });

  const maintenanceOverlapCount = countOverlappingRecords(
    vehicle,
    maintenanceBookings,
    selectedBookingDates,
    currentBookingId
  );
  if (maintenanceOverlapCount > 0) {
    appendUnique(blockingReasons, "Maintenance booking overlaps selected dates");
  }

  const bookingOverlapCount = countOverlappingRecords(
    vehicle,
    bookings,
    selectedBookingDates,
    currentBookingId
  );
  if (bookingOverlapCount > 0) {
    appendUnique(blockingReasons, "Existing booking overlaps selected dates");
  }

  const available = blockingReasons.length === 0;
  const severity = !available ? "red" : warningReasons.length > 0 ? "amber" : "green";
  const statusLabel = !available
    ? "Unavailable"
    : warningReasons.length > 0
    ? "Available with warnings"
    : "Available";

  return {
    available,
    severity,
    reasons: [...blockingReasons, ...warningReasons],
    blockingReasons,
    warningReasons,
    statusLabel,
  };
}

export default getVehicleAvailability;
