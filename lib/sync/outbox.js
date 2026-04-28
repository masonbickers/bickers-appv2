import AsyncStorage from "@react-native-async-storage/async-storage";

const OUTBOX_KEY = "@bickers.sync.outbox.v1";
const BRIDGE_CHECKPOINT_KEY = "@bickers.sync.bridgeCheckpoint.v1";
const LAST_SYNC_AT_KEY = "@bickers.sync.lastSyncAt.v1";

const safeParse = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const serialise = (value) => JSON.parse(JSON.stringify(value));

const mutationId = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export async function listOutboxMutations() {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  const parsed = safeParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function replaceOutboxMutations(next) {
  const normalised = Array.isArray(next) ? next : [];
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(normalised));
}

export async function enqueueOutboxMutation(mutation) {
  const snapshot = serialise(mutation || {});
  const outbox = await listOutboxMutations();

  outbox.push({
    id: mutationId(),
    target: snapshot.target || "firestore",
    operation: snapshot.operation || "set",
    docPath: String(snapshot.docPath || "").trim(),
    data: snapshot.data ?? {},
    options: snapshot.options ?? {},
    entityType: snapshot.entityType || null,
    entityId: snapshot.entityId || null,
    meta: snapshot.meta ?? {},
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  });

  await replaceOutboxMutations(outbox);
  return outbox[outbox.length - 1];
}

export async function getOutboxCount() {
  const outbox = await listOutboxMutations();
  return outbox.length;
}

export async function clearOutbox() {
  await AsyncStorage.removeItem(OUTBOX_KEY);
}

export async function getBridgeCheckpoint() {
  return AsyncStorage.getItem(BRIDGE_CHECKPOINT_KEY);
}

export async function setBridgeCheckpoint(value) {
  if (!value) {
    await AsyncStorage.removeItem(BRIDGE_CHECKPOINT_KEY);
    return;
  }
  await AsyncStorage.setItem(BRIDGE_CHECKPOINT_KEY, String(value));
}

export async function getLastSyncAt() {
  return AsyncStorage.getItem(LAST_SYNC_AT_KEY);
}

export async function setLastSyncAt(value) {
  if (!value) {
    await AsyncStorage.removeItem(LAST_SYNC_AT_KEY);
    return;
  }
  await AsyncStorage.setItem(LAST_SYNC_AT_KEY, String(value));
}

