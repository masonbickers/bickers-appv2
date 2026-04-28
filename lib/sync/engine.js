import NetInfo from "@react-native-community/netinfo";
import { deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { Platform } from "react-native";

import { db } from "../../firebaseConfig";
import { syncConfig } from "./config";
import { isTransientNetworkError } from "./errors";
import {
  getBridgeCheckpoint,
  getOutboxCount,
  listOutboxMutations,
  replaceOutboxMutations,
  setBridgeCheckpoint,
  setLastSyncAt,
} from "./outbox";

let syncInFlight = false;

const pathToRef = (docPath) => {
  const parts = String(docPath || "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length % 2 !== 0) {
    throw new Error(`Invalid Firestore docPath "${docPath}"`);
  }
  return doc(db, ...parts);
};

const withTimeout = async (url, init = {}, timeoutMs = syncConfig.syncTimeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

async function applyFirestoreMutation(mutation) {
  const ref = pathToRef(mutation.docPath);
  const op = String(mutation.operation || "set").toLowerCase();

  if (op === "set") {
    await setDoc(ref, mutation.data || {}, mutation.options || { merge: true });
    return;
  }
  if (op === "update") {
    await updateDoc(ref, mutation.data || {});
    return;
  }
  if (op === "delete") {
    await deleteDoc(ref);
    return;
  }

  throw new Error(`Unsupported outbox operation "${op}"`);
}

function normaliseRemoteChange(change) {
  if (!change || typeof change !== "object") return null;

  const type = String(change.type || "").toLowerCase().trim();
  if (type.startsWith("firestore.")) {
    return {
      target: "firestore",
      operation: type.replace("firestore.", ""),
      docPath: change.docPath || change.path || "",
      data: change.data || {},
      options: change.options || {},
    };
  }

  if (String(change.target || "").toLowerCase() === "firestore") {
    return {
      target: "firestore",
      operation: change.operation || "set",
      docPath: change.docPath || change.path || "",
      data: change.data || {},
      options: change.options || {},
    };
  }

  return null;
}

async function flushFirestoreOutbox() {
  const current = await listOutboxMutations();
  const next = [];
  const applied = [];
  let stoppedForNetwork = false;

  for (const item of current) {
    if (item?.target !== "firestore") {
      next.push(item);
      continue;
    }

    try {
      await applyFirestoreMutation(item);
      applied.push(item);
    } catch (error) {
      next.push({
        ...item,
        attempts: Number(item?.attempts || 0) + 1,
        lastError: String(error?.message || error),
      });

      if (isTransientNetworkError(error)) {
        stoppedForNetwork = true;
        next.push(...current.slice(current.indexOf(item) + 1));
        break;
      }
    }
  }

  await replaceOutboxMutations(next);

  return {
    applied,
    appliedCount: applied.length,
    stoppedForNetwork,
  };
}

async function pushAppliedMutationsToBridge(mutations, token) {
  if (!syncConfig.syncBridgeEnabled || !syncConfig.syncApiBaseUrl || mutations.length === 0) {
    return { pushed: 0, skipped: true };
  }

  const url = `${syncConfig.syncApiBaseUrl}/sync/mutations`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const payload = {
    device: {
      platform: Platform.OS,
      appEnv: syncConfig.env,
    },
    mutations: mutations.map((m) => ({
      id: m.id,
      entityType: m.entityType || null,
      entityId: m.entityId || null,
      operation: m.operation,
      docPath: m.docPath,
      data: m.data,
      meta: m.meta || {},
      createdAt: m.createdAt,
    })),
  };

  const res = await withTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Bridge push failed (${res.status})`);
  }

  return { pushed: mutations.length, skipped: false };
}

async function pullBridgeChanges(token) {
  if (!syncConfig.syncBridgeEnabled || !syncConfig.syncApiBaseUrl) {
    return { pulled: 0, applied: 0, skipped: true };
  }

  const checkpoint = (await getBridgeCheckpoint()) || "";
  const query = checkpoint ? `?since=${encodeURIComponent(checkpoint)}` : "";
  const url = `${syncConfig.syncApiBaseUrl}/sync/changes${query}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await withTimeout(url, { headers });
  if (res.status === 204) {
    return { pulled: 0, applied: 0, skipped: false };
  }
  if (!res.ok) {
    throw new Error(`Bridge pull failed (${res.status})`);
  }

  const body = await res.json();
  const changes = Array.isArray(body?.changes) ? body.changes : [];

  let applied = 0;
  for (const raw of changes) {
    const change = normaliseRemoteChange(raw);
    if (!change || change.target !== "firestore") continue;
    await applyFirestoreMutation(change);
    applied += 1;
  }

  if (body?.checkpoint) {
    await setBridgeCheckpoint(String(body.checkpoint));
  }

  return { pulled: changes.length, applied, skipped: false };
}

export async function runSyncCycle({ getAuthToken, onRemoteChangesApplied } = {}) {
  if (!syncConfig.syncEnabled) {
    return { ok: false, reason: "disabled" };
  }
  if (syncInFlight) {
    return { ok: false, reason: "in_flight" };
  }

  const net = await NetInfo.fetch();
  const online = !!net?.isConnected && net?.isInternetReachable !== false;
  if (!online) {
    return { ok: false, reason: "offline" };
  }

  syncInFlight = true;
  try {
    const flush = await flushFirestoreOutbox();
    const token = getAuthToken ? await getAuthToken() : null;

    try {
      await pushAppliedMutationsToBridge(flush.applied, token);
    } catch (e) {
      console.warn("[sync] bridge push skipped:", e?.message || e);
    }

    let pulled = { pulled: 0, applied: 0, skipped: true };
    try {
      pulled = await pullBridgeChanges(token);
    } catch (e) {
      if (!isTransientNetworkError(e)) {
        console.warn("[sync] bridge pull error:", e?.message || e);
      }
    }

    if (pulled.applied > 0 && typeof onRemoteChangesApplied === "function") {
      onRemoteChangesApplied(pulled.applied);
    }

    const lastSyncedAt = new Date().toISOString();
    await setLastSyncAt(lastSyncedAt);
    const outboxCount = await getOutboxCount();

    return {
      ok: true,
      reason: null,
      flushed: flush.appliedCount,
      pulled: pulled.pulled,
      remoteApplied: pulled.applied,
      outboxCount,
      lastSyncedAt,
    };
  } finally {
    syncInFlight = false;
  }
}

