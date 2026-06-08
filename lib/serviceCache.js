import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";

import { db } from "../firebaseConfig";

const CACHE_PREFIX = "@bickers.service.cache.v1";

function cacheKey(collectionName) {
  return `${CACHE_PREFIX}.${collectionName}`;
}

function isTimestampLike(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.toDate === "function"
  );
}

function makeSerializable(value) {
  if (isTimestampLike(value)) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(makeSerializable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nextValue]) => [
        key,
        makeSerializable(nextValue),
      ])
    );
  }
  return value;
}

export function snapshotToCachedRows(snapshot) {
  return snapshot.docs.map((entry) =>
    makeSerializable({
      id: entry.id,
      ...entry.data(),
    })
  );
}

export async function readServiceCollectionCache(collectionName) {
  const raw = await AsyncStorage.getItem(cacheKey(collectionName));
  if (!raw) return { rows: [], updatedAt: null };

  try {
    const parsed = JSON.parse(raw);
    return {
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
      updatedAt: parsed?.updatedAt || null,
    };
  } catch {
    return { rows: [], updatedAt: null };
  }
}

export async function writeServiceCollectionCache(collectionName, rows) {
  await AsyncStorage.setItem(
    cacheKey(collectionName),
    JSON.stringify({
      rows: Array.isArray(rows) ? rows : [],
      updatedAt: new Date().toISOString(),
    })
  );
}

export function subscribeServiceCollectionCache({
  collectionName,
  onRows,
  onError,
  orderByField,
  orderDirection = "asc",
}) {
  const ref = collection(db, collectionName);
  const source = orderByField
    ? query(ref, orderBy(orderByField, orderDirection))
    : ref;

  return onSnapshot(
    source,
    (snapshot) => {
      const rows = snapshotToCachedRows(snapshot);
      writeServiceCollectionCache(collectionName, rows).catch(() => {});
      onRows(rows, { fromCache: false });
    },
    onError
  );
}

export async function getServiceCollectionRows(
  collectionName,
  { orderByField, orderDirection = "asc" } = {}
) {
  const cached = await readServiceCollectionCache(collectionName);
  const ref = collection(db, collectionName);
  const source = orderByField
    ? query(ref, orderBy(orderByField, orderDirection))
    : ref;

  try {
    const snapshot = await getDocs(source);
    const rows = snapshotToCachedRows(snapshot);
    await writeServiceCollectionCache(collectionName, rows);
    return rows;
  } catch (err) {
    if (cached.rows.length > 0) return cached.rows;
    throw err;
  }
}

export function useCachedServiceCollection(
  collectionName,
  { label = collectionName, orderByField, orderDirection = "asc" } = {}
) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState(null);

  useEffect(() => {
    let active = true;
    let unsubscribe;

    const load = async () => {
      const cached = await readServiceCollectionCache(collectionName);
      if (!active) return;

      if (cached.rows.length > 0) {
        setRows(cached.rows);
        setCacheUpdatedAt(cached.updatedAt);
        setLoading(false);
      }

      unsubscribe = subscribeServiceCollectionCache({
        collectionName,
        orderByField,
        orderDirection,
        onRows: (freshRows) => {
          if (!active) return;
          setRows(freshRows);
          setCacheUpdatedAt(new Date().toISOString());
          setLoading(false);
        },
        onError: (err) => {
          console.error(`Failed to load ${label}:`, err);
          if (active) setLoading(false);
        },
      });
    };

    load().catch((err) => {
      console.error(`Failed to read cached ${label}:`, err);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [collectionName, label, orderByField, orderDirection]);

  return { rows, loading, cacheUpdatedAt };
}
