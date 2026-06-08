import Constants from "expo-constants";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const extra =
  Constants.expoConfig?.extra ||
  Constants.manifest2?.extra ||
  Constants.manifest?.extra ||
  {};

const appEnv = String(
  process.env.EXPO_PUBLIC_APP_ENV || extra.appEnv || process.env.NODE_ENV || ""
).toLowerCase();

export function getApiBaseUrl(serviceName = "API") {
  const raw = String(
    process.env.EXPO_PUBLIC_API_URL ||
      extra.EXPO_PUBLIC_API_URL ||
      extra.apiUrl ||
      ""
  ).trim();

  if (!raw) {
    throw new Error(`${serviceName} is not configured. Set EXPO_PUBLIC_API_URL.`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${serviceName} URL is invalid.`);
  }

  const isProduction = appEnv === "production";
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error("Production API URL must use HTTPS.");
  }

  if (isProduction && LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Production API URL cannot point to localhost.");
  }

  return raw.replace(/\/+$/, "");
}
