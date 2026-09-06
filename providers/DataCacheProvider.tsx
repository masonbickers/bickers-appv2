import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import {
  buildCacheScope,
  cacheKeyMatchesPrefix,
  createRequestDeduper,
  DEFAULT_CACHE_TTL_MS,
  isCacheRecordExpired,
  normalizeCacheTtl,
} from "../lib/sessionCache";
import { useAuth } from "./AuthProvider";

const CACHE_PREFIX = "@bickers.dataCache.v2";
const LEGACY_SERVICE_CACHE_PREFIX = "@bickers.service.cache.v1.";
const CACHE_VERSION = 2;

export type CacheRecord<T = unknown> = {
  data: T;
  updatedAt: number;
  ttlMs: number;
};

type FetchOptions = { force?: boolean; ttlMs?: number };

type DataCacheContextValue = {
  peek: <T>(key: string) => CacheRecord<T> | null;
  read: <T>(key: string) => Promise<CacheRecord<T> | null>;
  write: <T>(key: string, data: T, ttlMs?: number) => Promise<void>;
  getOrFetch: <T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: FetchOptions
  ) => Promise<T>;
  mutate: <T>(
    key: string,
    updater: (current: T | null) => T | Promise<T>
  ) => Promise<T>;
  remove: (key: string) => Promise<void>;
  invalidate: (keyPrefix?: string) => Promise<void>;
  clear: () => Promise<void>;
  isExpired: <T>(record: CacheRecord<T> | null, ttlMs?: number) => boolean;
  refreshSignal: number;
  scope: string;
};

const DataCacheCtx = createContext<DataCacheContextValue>({
  peek: () => null,
  read: async () => null,
  write: async () => {},
  getOrFetch: async (_key, fetcher) => fetcher(),
  mutate: async (_key, updater) => updater(null),
  remove: async () => {},
  invalidate: async () => {},
  clear: async () => {},
  isExpired: () => true,
  refreshSignal: 0,
  scope: "anonymous:no-company:no-employee",
});

function toStorageKey(scopedKey: string) {
  return `${CACHE_PREFIX}.v${CACHE_VERSION}.${scopedKey}`;
}

function isTimestampLike(value: unknown) {
  return (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
}

function serializeForStorage(value: unknown): unknown {
  if (isTimestampLike(value)) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeForStorage);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeForStorage(child)])
    );
  }
  return value;
}

function parseStoredRecord<T>(raw: string | null): CacheRecord<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      !Object.prototype.hasOwnProperty.call(parsed || {}, "updatedAt") ||
      !Object.prototype.hasOwnProperty.call(parsed || {}, "data")
    ) {
      return null;
    }
    return {
      data: parsed.data as T,
      updatedAt: Number(parsed.updatedAt) || 0,
      ttlMs: normalizeCacheTtl(parsed.ttlMs),
    };
  } catch {
    return null;
  }
}

export { buildCacheScope, DEFAULT_CACHE_TTL_MS };

export function isStorageValueExpired(
  updatedAt: number,
  ttlMs: number | undefined,
  fallbackTtlMs: number = DEFAULT_CACHE_TTL_MS
) {
  return isCacheRecordExpired({ updatedAt, ttlMs }, fallbackTtlMs);
}

export function DataCacheProvider({ children }: { children: React.ReactNode }) {
  const { user, employee, isAuthed, loading: authLoading } = useAuth();
  const scope = useMemo(
    () =>
      buildCacheScope({
        uid: user?.uid,
        companyId: employee?.companyId,
        employeeId: employee?.employeeId,
        employeeCode: employee?.userCode,
      }),
    [employee?.companyId, employee?.employeeId, employee?.userCode, user?.uid]
  );
  const inMemory = useRef<Map<string, CacheRecord>>(new Map());
  const requestDeduper = useRef(createRequestDeduper());
  const previousScope = useRef(scope);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    AsyncStorage.getAllKeys()
      .then((keys) => keys.filter((key) => key.startsWith(LEGACY_SERVICE_CACHE_PREFIX)))
      .then((keys) => (keys.length ? AsyncStorage.multiRemove(keys) : undefined))
      .catch(() => {});
  }, []);

  const scopedKey = useCallback(
    (key: string) => `${scope}.${String(key || "default")}`,
    [scope]
  );

  const peek = useCallback(
    <T,>(key: string): CacheRecord<T> | null =>
      (inMemory.current.get(scopedKey(key)) as CacheRecord<T> | undefined) ?? null,
    [scopedKey]
  );

  const read = useCallback(
    async <T,>(key: string): Promise<CacheRecord<T> | null> => {
      const fullKey = scopedKey(key);
      const memory = inMemory.current.get(fullKey);
      if (memory) return memory as CacheRecord<T>;

      try {
        const record = parseStoredRecord<T>(
          await AsyncStorage.getItem(toStorageKey(fullKey))
        );
        if (record) inMemory.current.set(fullKey, record);
        return record;
      } catch {
        return null;
      }
    },
    [scopedKey]
  );

  const write = useCallback(
    async <T,>(key: string, data: T, ttlMs = DEFAULT_CACHE_TTL_MS) => {
      const fullKey = scopedKey(key);
      const record: CacheRecord<T> = {
        data,
        updatedAt: Date.now(),
        ttlMs: normalizeCacheTtl(ttlMs),
      };
      inMemory.current.set(fullKey, record);
      try {
        await AsyncStorage.setItem(
          toStorageKey(fullKey),
          JSON.stringify({ ...record, data: serializeForStorage(data) })
        );
      } catch {
        // Memory caching remains available if persistent storage is unavailable.
      }
    },
    [scopedKey]
  );

  const isExpired = useCallback(
    (record: CacheRecord | null, ttlMs = DEFAULT_CACHE_TTL_MS) =>
      isCacheRecordExpired(record, ttlMs),
    []
  );

  const getOrFetch = useCallback(
    async <T,>(key: string, fetcher: () => Promise<T>, options: FetchOptions = {}) => {
      const fullKey = scopedKey(key);
      if (!options.force) {
        const record = await read<T>(key);
        if (record && !isExpired(record, options.ttlMs)) return record.data;
      }

      return requestDeduper.current.run(fullKey, async () => {
        const data = await fetcher();
        await write(key, data, options.ttlMs);
        return data;
      }) as Promise<T>;
    },
    [isExpired, read, scopedKey, write]
  );

  const remove = useCallback(
    async (key: string) => {
      const fullKey = scopedKey(key);
      inMemory.current.delete(fullKey);
      try {
        await AsyncStorage.removeItem(toStorageKey(fullKey));
      } catch {}
      setRefreshSignal((value) => value + 1);
    },
    [scopedKey]
  );

  const mutate = useCallback(
    async <T,>(key: string, updater: (current: T | null) => T | Promise<T>) => {
      const current = await read<T>(key);
      const next = await updater(current?.data ?? null);
      await write(key, next, current?.ttlMs ?? DEFAULT_CACHE_TTL_MS);
      setRefreshSignal((value) => value + 1);
      return next;
    },
    [read, write]
  );

  const invalidate = useCallback(
    async (keyPrefix = "") => {
      const fullPrefix = keyPrefix ? scopedKey(keyPrefix) : `${scope}.`;
      const writes: Promise<unknown>[] = [];

      inMemory.current.forEach((record, key) => {
        if (!cacheKeyMatchesPrefix(key, fullPrefix)) return;
        const next = { ...record, updatedAt: 0 };
        inMemory.current.set(key, next);
        writes.push(
          AsyncStorage.setItem(
            toStorageKey(key),
            JSON.stringify({ ...next, data: serializeForStorage(next.data) })
          ).catch(() => {})
        );
      });

      try {
        const storagePrefix = toStorageKey(fullPrefix);
        const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
          cacheKeyMatchesPrefix(key, storagePrefix)
        );
        const stored = await AsyncStorage.multiGet(keys);
        stored.forEach(([key, raw]) => {
          const record = parseStoredRecord(raw);
          if (!record) return;
          const next = { ...record, updatedAt: 0 };
          writes.push(
            AsyncStorage.setItem(
              key,
              JSON.stringify({ ...next, data: serializeForStorage(next.data) })
            ).catch(() => {})
          );
        });
      } catch {}

      await Promise.all(writes);
      setRefreshSignal((value) => value + 1);
    },
    [scope, scopedKey]
  );

  const clearScope = useCallback(async (targetScope: string) => {
    const memoryPrefix = `${targetScope}.`;
    Array.from(inMemory.current.keys()).forEach((key) => {
      if (cacheKeyMatchesPrefix(key, memoryPrefix)) inMemory.current.delete(key);
    });
    try {
      const storagePrefix = toStorageKey(memoryPrefix);
      const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
        cacheKeyMatchesPrefix(key, storagePrefix)
      );
      if (keys.length) await AsyncStorage.multiRemove(keys);
    } catch {}
  }, []);

  const clear = useCallback(async () => {
    requestDeduper.current.clear();
    await clearScope(scope);
    setRefreshSignal((value) => value + 1);
  }, [clearScope, scope]);

  useEffect(() => {
    if (previousScope.current === scope) return;
    const oldScope = previousScope.current;
    previousScope.current = scope;
    requestDeduper.current.clear();
    clearScope(oldScope).catch(() => {});
  }, [clearScope, scope]);

  useEffect(() => {
    if (authLoading || isAuthed) return;
    clear().catch(() => {});
  }, [authLoading, clear, isAuthed]);

  useEffect(() => {
    if (!isAuthed) return undefined;
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefreshSignal((value) => value + 1);
    });
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        setRefreshSignal((value) => value + 1);
      }
    });
    return () => {
      appStateSub.remove();
      netSub();
    };
  }, [isAuthed]);

  const value = useMemo(
    () => ({
      peek,
      read,
      write,
      getOrFetch,
      mutate,
      remove,
      invalidate,
      clear,
      isExpired,
      refreshSignal,
      scope,
    }),
    [clear, getOrFetch, invalidate, isExpired, mutate, peek, read, refreshSignal, remove, scope, write]
  );

  return <DataCacheCtx.Provider value={value}>{children}</DataCacheCtx.Provider>;
}

export const useDataCache = () => useContext(DataCacheCtx);

export function useCachedResource<T>({
  key,
  fetcher,
  enabled = true,
  ttlMs = DEFAULT_CACHE_TTL_MS,
}: {
  key: string;
  fetcher: () => Promise<T>;
  enabled?: boolean;
  ttlMs?: number;
}) {
  const { peek, read, getOrFetch, isExpired, refreshSignal, scope } = useDataCache();
  const fetcherRef = useRef(fetcher);
  const requestIdRef = useRef(0);
  const resourceIdentity = `${scope}:${key}`;
  const initialCached = enabled && key ? peek<T>(key) : null;
  const [data, setData] = useState<T | null>(() => initialCached?.data ?? null);
  const [dataIdentity, setDataIdentity] = useState(() => initialCached ? resourceIdentity : "");
  const [isInitialLoading, setIsInitialLoading] = useState(() => enabled && !initialCached);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    () => initialCached?.updatedAt ?? null
  );
  fetcherRef.current = fetcher;

  const load = useCallback(
    async ({ force = false, showRefreshing = false } = {}) => {
      if (!enabled || !key) {
        setIsInitialLoading(false);
        return null;
      }
      const requestId = ++requestIdRef.current;
      const cached = await read<T>(key);
      if (requestId !== requestIdRef.current) return null;

      if (cached) {
        setData(cached.data);
        setDataIdentity(resourceIdentity);
        setLastUpdatedAt(cached.updatedAt || null);
        setIsInitialLoading(false);
      } else {
        setData(null);
        setDataIdentity(resourceIdentity);
        setIsInitialLoading(true);
      }

      if (!force && cached && !isExpired(cached, ttlMs)) return cached.data;
      if (cached) {
        const networkState = await NetInfo.fetch().catch(() => null);
        if (
          networkState?.isConnected === false ||
          networkState?.isInternetReachable === false
        ) {
          return cached.data;
        }
      }
      if (cached && showRefreshing) setIsRefreshing(true);
      setError(null);

      try {
        const next = await getOrFetch<T>(key, () => fetcherRef.current(), {
          force,
          ttlMs,
        });
        if (requestId === requestIdRef.current) {
          setData(next);
          setDataIdentity(resourceIdentity);
          setLastUpdatedAt(Date.now());
        }
        return next;
      } catch (nextError) {
        if (requestId === requestIdRef.current) setError(nextError);
        return cached?.data ?? null;
      } finally {
        if (requestId === requestIdRef.current) {
          setIsInitialLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [enabled, getOrFetch, isExpired, key, read, resourceIdentity, ttlMs]
  );

  useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load, refreshSignal]);

  const refresh = useCallback(
    () => load({ force: true, showRefreshing: true }),
    [load]
  );
  const revalidate = useCallback(() => load(), [load]);
  const hasCurrentIdentity = dataIdentity === resourceIdentity;

  return {
    data: hasCurrentIdentity ? data : null,
    isInitialLoading: enabled && !hasCurrentIdentity ? true : isInitialLoading,
    isRefreshing,
    error: hasCurrentIdentity ? error : null,
    lastUpdatedAt: hasCurrentIdentity ? lastUpdatedAt : null,
    refresh,
    revalidate,
  };
}
