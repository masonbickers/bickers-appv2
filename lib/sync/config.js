import Constants from "expo-constants";

const boolish = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
};

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const extra =
  Constants?.expoConfig?.extra ||
  Constants?.manifest2?.extra ||
  Constants?.manifest?.extra ||
  {};

const env = process.env.EXPO_PUBLIC_APP_ENV || extra.appEnv || process.env.NODE_ENV || "development";
const syncEnabled = boolish(process.env.EXPO_PUBLIC_SYNC_ENABLED ?? extra.syncEnabled, true);
const syncApiBaseUrl =
  process.env.EXPO_PUBLIC_SYNC_API_URL ||
  extra.syncApiBaseUrl ||
  extra.SYNC_API_URL ||
  "";
const syncBridgeEnabled = boolish(
  process.env.EXPO_PUBLIC_SYNC_BRIDGE_ENABLED ?? extra.syncBridgeEnabled,
  !!syncApiBaseUrl
);
const syncIntervalMs = toNumber(process.env.EXPO_PUBLIC_SYNC_INTERVAL_MS ?? extra.syncIntervalMs, 120000);
const syncTimeoutMs = toNumber(process.env.EXPO_PUBLIC_SYNC_TIMEOUT_MS ?? extra.syncTimeoutMs, 10000);

export const syncConfig = {
  env: String(env),
  syncEnabled,
  syncApiBaseUrl: String(syncApiBaseUrl || "").replace(/\/+$/, ""),
  syncBridgeEnabled,
  syncIntervalMs,
  syncTimeoutMs,
};

