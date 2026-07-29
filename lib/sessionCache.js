export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

function safeScopePart(value, fallback) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 100);
  return clean || fallback;
}

export function buildCacheScope({ uid, companyId, employeeId, employeeCode } = {}) {
  return [
    safeScopePart(uid, "anonymous"),
    safeScopePart(companyId, "no-company"),
    safeScopePart(employeeId || employeeCode, "no-employee"),
  ].join(":");
}

export function normalizeCacheTtl(value, fallback = DEFAULT_CACHE_TTL_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isCacheRecordExpired(
  record,
  fallbackTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now()
) {
  if (!record?.updatedAt) return true;
  const ttlMs = normalizeCacheTtl(record.ttlMs, fallbackTtlMs);
  return now - Number(record.updatedAt || 0) > ttlMs;
}

export function createRequestDeduper() {
  const requests = new Map();

  return {
    run(key, fetcher) {
      if (requests.has(key)) return requests.get(key);
      const request = Promise.resolve()
        .then(fetcher)
        .finally(() => requests.delete(key));
      requests.set(key, request);
      return request;
    },
    clear() {
      requests.clear();
    },
    get size() {
      return requests.size;
    },
  };
}

export function cacheKeyMatchesPrefix(key, prefix) {
  return String(key || "").startsWith(String(prefix || ""));
}

export function upsertCollectionRow(rows, nextRow, identityKeys = ["id"]) {
  const currentRows = Array.isArray(rows) ? rows : [];
  const identities = new Set(
    identityKeys.map((key) => String(nextRow?.[key] || "").trim()).filter(Boolean)
  );
  const index = currentRows.findIndex((row) =>
    identityKeys.some((key) => {
      const value = String(row?.[key] || "").trim();
      return value && identities.has(value);
    })
  );
  if (index < 0) return [nextRow, ...currentRows];
  return currentRows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...nextRow } : row
  );
}

export function removeCollectionRow(rows, identity, identityKeys = ["id"]) {
  const target = String(identity || "").trim();
  if (!target) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    identityKeys.every((key) => String(row?.[key] || "").trim() !== target)
  );
}
