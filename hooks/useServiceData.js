import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { db } from "../firebaseConfig";
import {
  acquireLiveResource,
  publishLiveResource,
} from "../lib/serviceLiveRegistry";
import { removeCollectionRow, upsertCollectionRow } from "../lib/sessionCache";
import { useAuth } from "../providers/AuthProvider";
import { useDataCache } from "../providers/DataCacheProvider";

const EMPTY_ROWS = Object.freeze([]);

function serialise(value) {
  if (value?.toDate && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    (typeof value._methodName === "string" || value.constructor?.name === "FieldValue")
  ) {
    const method = String(value._methodName || "").toLowerCase();
    return method.includes("servertimestamp") ? new Date().toISOString() : undefined;
  }
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, next]) => [key, serialise(next)])
        .filter(([, next]) => next !== undefined)
    );
  }
  return value;
}

function belongsToCompany(row, companyId) {
  const rowCompany = String(row?.companyId || "").trim();
  return !companyId || !rowCompany || rowCompany === String(companyId).trim();
}

function snapshotRows(snapshot, companyId) {
  return snapshot.docs
    .map((document) => serialise({ id: document.id, ...document.data() }))
    .filter((row) => belongsToCompany(row, companyId));
}

function sortRows(rows, field, direction) {
  if (!field) return rows;
  const multiplier = direction === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = left?.[field];
    const b = right?.[field];
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * multiplier;
  });
}

export function serviceCollectionCacheKey(collectionName) {
  return `service:collection:${collectionName}:company`;
}

export function useServiceCollection(
  collectionName,
  { orderByField, orderDirection = "asc", enabled: enabledOption } = {}
) {
  const { employee, isAuthed, loading } = useAuth();
  const {
    scope,
    read,
    write,
    getOrFetch,
    mutate,
    refreshSignal,
  } = useDataCache();
  const companyId = String(employee?.companyId || "").trim();
  const enabled = enabledOption ?? (!loading && isAuthed && !!collectionName);
  const cacheKey = serviceCollectionCacheKey(collectionName);
  const liveKey = `${scope}.${cacheKey}`;
  const [rows, setRows] = useState(null);
  const [identity, setIdentity] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const rowsRef = useRef(null);
  const mountedRef = useRef(false);
  const refreshSignalRef = useRef(refreshSignal);

  useEffect(() => {
    if (!enabled) {
      rowsRef.current = null;
      setRows(null);
      setIdentity(liveKey);
      setIsInitialLoading(false);
      setIsLive(false);
      return undefined;
    }

    let active = true;
    let receivedLiveValue = false;
    mountedRef.current = true;
    setIdentity(liveKey);
    setIsInitialLoading(true);
    setError(null);

    const release = acquireLiveResource({
      key: liveKey,
      start: (emit, emitError) =>
        onSnapshot(
          collection(db, collectionName),
          async (snapshot) => {
            const next = snapshotRows(snapshot, companyId);
            await write(cacheKey, next);
            emit(next, { updatedAt: Date.now(), source: "snapshot" });
          },
          emitError
        ),
      onValue: (next, meta = {}) => {
        if (!active) return;
        receivedLiveValue = true;
        rowsRef.current = Array.isArray(next) ? next : EMPTY_ROWS;
        setRows(rowsRef.current);
        setLastUpdatedAt(meta.updatedAt || Date.now());
        setError(null);
        setIsInitialLoading(false);
        setIsLive(true);
      },
      onError: (nextError) => {
        if (!active) return;
        setError(nextError);
        setIsInitialLoading(false);
        setIsLive(false);
      },
    });
    setIsLive(true);

    read(cacheKey).then((cached) => {
      if (!active || receivedLiveValue || !cached) return;
      const next = Array.isArray(cached.data) ? cached.data : EMPTY_ROWS;
      rowsRef.current = next;
      setRows(next);
      setLastUpdatedAt(cached.updatedAt || null);
      setIsInitialLoading(false);
    });

    return () => {
      active = false;
      mountedRef.current = false;
      release();
    };
  }, [cacheKey, collectionName, companyId, enabled, liveKey, read, write]);

  const refresh = useCallback(async () => {
    if (!enabled) return rowsRef.current || EMPTY_ROWS;
    setIsRefreshing(true);
    setError(null);
    try {
      const next = await getOrFetch(
        cacheKey,
        async () => snapshotRows(await getDocs(collection(db, collectionName)), companyId),
        { force: true }
      );
      publishLiveResource(liveKey, next, {
        updatedAt: Date.now(),
        source: "refresh",
      });
      return next;
    } catch (nextError) {
      if (mountedRef.current) setError(nextError);
      return rowsRef.current || EMPTY_ROWS;
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [cacheKey, collectionName, companyId, enabled, getOrFetch, liveKey]);

  const revalidate = useCallback(async () => {
    if (!enabled || isLive) return rowsRef.current || EMPTY_ROWS;
    return refresh();
  }, [enabled, isLive, refresh]);

  useEffect(() => {
    if (refreshSignalRef.current === refreshSignal) return;
    refreshSignalRef.current = refreshSignal;
    revalidate().catch(() => {});
  }, [refreshSignal, revalidate]);

  const upsertRow = useCallback(
    async (row) => {
      const next = await mutate(cacheKey, (current) =>
        upsertCollectionRow(current, serialise(row))
      );
      publishLiveResource(liveKey, next, {
        updatedAt: Date.now(),
        source: "mutation",
      });
      return next;
    },
    [cacheKey, liveKey, mutate]
  );

  const removeRow = useCallback(
    async (id) => {
      const next = await mutate(cacheKey, (current) => removeCollectionRow(current, id));
      publishLiveResource(liveKey, next, {
        updatedAt: Date.now(),
        source: "mutation",
      });
      return next;
    },
    [cacheKey, liveKey, mutate]
  );

  const currentRows = identity === liveKey && Array.isArray(rows) ? rows : EMPTY_ROWS;
  const data = useMemo(
    () => sortRows(currentRows, orderByField, orderDirection),
    [currentRows, orderByField, orderDirection]
  );

  return {
    data,
    rows: data,
    isInitialLoading: enabled && identity !== liveKey ? true : isInitialLoading,
    loading: enabled && identity !== liveKey ? true : isInitialLoading,
    isRefreshing,
    isLive,
    error: identity === liveKey ? error : null,
    lastUpdatedAt: identity === liveKey ? lastUpdatedAt : null,
    cacheUpdatedAt:
      identity === liveKey && lastUpdatedAt
        ? new Date(lastUpdatedAt).toISOString()
        : null,
    refresh,
    revalidate,
    upsertRow,
    removeRow,
  };
}

export function useServiceCollectionReader() {
  const { employee } = useAuth();
  const { getOrFetch } = useDataCache();
  const companyId = String(employee?.companyId || "").trim();

  return useCallback(
    async (
      collectionName,
      { orderByField, orderDirection = "asc", force = false } = {}
    ) => {
      const rows = await getOrFetch(
        serviceCollectionCacheKey(collectionName),
        async () => snapshotRows(await getDocs(collection(db, collectionName)), companyId),
        { force }
      );
      return sortRows(Array.isArray(rows) ? rows : EMPTY_ROWS, orderByField, orderDirection);
    },
    [companyId, getOrFetch]
  );
}

export function useServiceCacheActions() {
  const { scope, mutate, invalidate } = useDataCache();

  const update = useCallback(
    async (collectionName, updater) => {
      const cacheKey = serviceCollectionCacheKey(collectionName);
      const liveKey = `${scope}.${cacheKey}`;
      const next = await mutate(cacheKey, updater);
      publishLiveResource(liveKey, next, {
        updatedAt: Date.now(),
        source: "mutation",
      });
      return next;
    },
    [mutate, scope]
  );

  const upsertServiceRow = useCallback(
    (collectionName, row) =>
      update(collectionName, (current) =>
        upsertCollectionRow(current, serialise(row))
      ),
    [update]
  );

  const patchServiceRow = useCallback(
    (collectionName, id, patch) =>
      update(collectionName, (current) => {
        const rows = Array.isArray(current) ? current : [];
        const existing = rows.find((row) => String(row?.id) === String(id)) || {};
        return upsertCollectionRow(rows, {
          ...existing,
          ...serialise(patch),
          id: String(id),
        });
      }),
    [update]
  );

  const removeServiceRow = useCallback(
    (collectionName, id) =>
      update(collectionName, (current) => removeCollectionRow(current, id)),
    [update]
  );

  const invalidateServiceCollections = useCallback(
    (collectionNames = []) =>
      Promise.all(
        collectionNames.map((collectionName) =>
          invalidate(serviceCollectionCacheKey(collectionName))
        )
      ),
    [invalidate]
  );

  return {
    upsertServiceRow,
    patchServiceRow,
    removeServiceRow,
    invalidateServiceCollections,
  };
}
