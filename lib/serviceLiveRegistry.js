const liveEntries = new Map();

function notify(entry, type, value, meta) {
  entry.subscribers.forEach((subscriber) => {
    const handler = type === "value" ? subscriber.onValue : subscriber.onError;
    if (typeof handler === "function") handler(value, meta);
  });
}

export function acquireLiveResource({ key, start, onValue, onError }) {
  let entry = liveEntries.get(key);
  if (!entry) {
    entry = { key, subscribers: new Set(), unsubscribe: null };
    liveEntries.set(key, entry);
    try {
      entry.unsubscribe = start(
        (value, meta) => notify(entry, "value", value, meta),
        (error) => notify(entry, "error", error)
      );
    } catch (error) {
      queueMicrotask(() => notify(entry, "error", error));
    }
  }

  const subscriber = { onValue, onError };
  entry.subscribers.add(subscriber);

  return () => {
    const current = liveEntries.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size > 0) return;
    if (typeof current.unsubscribe === "function") current.unsubscribe();
    liveEntries.delete(key);
  };
}

export function publishLiveResource(key, value, meta = {}) {
  const entry = liveEntries.get(key);
  if (entry) notify(entry, "value", value, meta);
}

export function clearLiveResourcePrefix(prefix = "") {
  Array.from(liveEntries.entries()).forEach(([key, entry]) => {
    if (prefix && !key.startsWith(prefix)) return;
    if (typeof entry.unsubscribe === "function") entry.unsubscribe();
    liveEntries.delete(key);
  });
}

export function getLiveRegistryStats() {
  return Array.from(liveEntries.values()).map((entry) => ({
    key: entry.key,
    subscribers: entry.subscribers.size,
  }));
}

