function identityPart(value, fallback) {
  const normalized = String(value || "").trim();
  return encodeURIComponent(normalized || fallback);
}

export function buildVehiclePrepRecordId(bookingId, vehicleId) {
  return `job_${identityPart(bookingId, "unknown-job")}__vehicle_${identityPart(
    vehicleId,
    "unknown-vehicle"
  )}`;
}

export function findVehiclePrepRecord(records, { bookingId, vehicleId, date } = {}) {
  const expectedId = buildVehiclePrepRecordId(bookingId, vehicleId);
  const bookingKey = String(bookingId || "").trim();
  const vehicleKey = String(vehicleId || "").trim();
  const dateKey = String(date || "").trim();

  return (
    (records || []).find((record) => record?.id === expectedId) ||
    (records || []).find(
      (record) =>
        bookingKey &&
        vehicleKey &&
        String(record?.bookingId || "").trim() === bookingKey &&
        String(record?.vehicleId || "").trim() === vehicleKey
    ) ||
    (records || []).find(
      (record) =>
        !record?.bookingId &&
        dateKey &&
        vehicleKey &&
        String(record?.prepDate || record?.date || "").trim() === dateKey &&
        String(record?.vehicleId || "").trim() === vehicleKey
    ) ||
    null
  );
}

export function isVehiclePrepComplete(records, identity) {
  return findVehiclePrepRecord(records, identity)?.completed === true;
}
