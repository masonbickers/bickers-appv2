import Constants from "expo-constants";

const API_URL =
  Constants.expoConfig?.extra?.API_URL ||
  Constants.manifest?.extra?.API_URL; // fallback for older Expo

export async function fetchDvlaVehicle(vrm) {
  if (!API_URL) {
    throw new Error("API_URL not set in app.json");
  }

  const url = `${API_URL}/dvla/vehicle?vrm=${encodeURIComponent(vrm)}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || data.details?.message || "Failed to fetch DVLA data"
    );
  }

  return data;
}
