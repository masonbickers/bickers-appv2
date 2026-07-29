const CLOSED_ADVISORY_STATUSES = new Set([
  "resolved",
  "fixed",
  "closed",
  "complete",
  "completed",
  "dismissed",
]);

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isOpenAdvisoryItem(item) {
  if (!item || typeof item !== "object") return false;

  const statuses = [
    item?.status,
    item?.resolutionStatus,
    item?.maintenance?.status,
  ].map(normaliseKey);

  return !statuses.some((status) => CLOSED_ADVISORY_STATUSES.has(status));
}

export function countOpenMonitorItems(records) {
  return safeArray(records).reduce((sum, record) => {
    const items = safeArray(record?.monitorReport).filter(isOpenAdvisoryItem);
    return sum + items.length;
  }, 0);
}

export function resolveMonitorReportItem(
  monitorReport,
  { itemKey, itemIndex, nowISO, resolvedBy } = {}
) {
  const items = safeArray(monitorReport);
  const key = itemKey ? String(itemKey) : "";
  const index = Number.isInteger(itemIndex) ? itemIndex : null;
  let changed = false;

  const nextItems = items.map((item, currentIndex) => {
    const keyMatches = key && String(item?.key || "") === key;
    const indexMatches = index !== null && currentIndex === index;

    if (!keyMatches && !indexMatches) return item;

    changed = true;
    return {
      ...item,
      status: "resolved",
      resolutionStatus: "fixed",
      resolvedAt: nowISO,
      fixedAt: nowISO,
      resolvedBy: resolvedBy || null,
      maintenance: {
        ...(item?.maintenance || {}),
        status: "resolved",
        completedAt: nowISO,
      },
    };
  });

  return { nextItems, changed };
}
