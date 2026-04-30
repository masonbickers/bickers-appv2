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

function getApiBaseUrl() {
  const raw = String(
    process.env.EXPO_PUBLIC_API_URL ||
      extra.EXPO_PUBLIC_API_URL ||
      extra.apiUrl ||
      ""
  ).trim();

  if (!raw) {
    throw new Error(
      "Vehicle lookup service is not configured. Set EXPO_PUBLIC_API_URL."
    );
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Vehicle lookup service URL is invalid.");
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

export async function fetchDvlaVehicle(vrm) {
  const apiUrl = getApiBaseUrl();
  const url = `${apiUrl}/dvla/vehicle?vrm=${encodeURIComponent(vrm)}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || data.details?.message || "Failed to fetch DVLA data"
    );
  }

  return data;
}
