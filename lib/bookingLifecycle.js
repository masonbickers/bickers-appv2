const DELETED_STATUSES = new Set(["deleted"]);
const INACTIVE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "inactive",
  "postponed",
  "lost",
  "dnh",
  "archived",
]);

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

export function getBookingLifecycle(booking = {}) {
  const status = normalizeStatus(booking.status);
  const deleted =
    isTruthyFlag(booking.isDeleted) ||
    isTruthyFlag(booking.deleted) ||
    Boolean(booking.deletedAt) ||
    DELETED_STATUSES.has(status);

  if (deleted) return "deleted";

  const inactive =
    isTruthyFlag(booking.inactive) ||
    isTruthyFlag(booking.isInactive) ||
    isTruthyFlag(booking.archived) ||
    isTruthyFlag(booking.isArchived) ||
    Boolean(booking.archivedAt) ||
    INACTIVE_STATUSES.has(status);

  return inactive ? "inactive" : "active";
}

export function shouldShowDiaryBooking(booking, includeInactive = false) {
  return includeInactive || getBookingLifecycle(booking) === "active";
}

export function getBookingLifecycleLabel(booking = {}) {
  const lifecycle = getBookingLifecycle(booking);
  if (lifecycle === "deleted") return "Deleted";

  const status = normalizeStatus(booking.status);
  if (status === "cancelled" || status === "canceled") return "Cancelled";
  if (status === "postponed") return "Postponed";
  if (status === "lost") return "Lost";
  if (status === "dnh") return "DNH";
  if (
    status === "archived" ||
    booking.archivedAt ||
    isTruthyFlag(booking.archived) ||
    isTruthyFlag(booking.isArchived)
  ) {
    return "Archived";
  }
  if (lifecycle === "inactive") return "Inactive";
  return "Active";
}
