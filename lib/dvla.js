import { getApiBaseUrl } from "./api";

export async function fetchDvlaVehicle(vrm) {
  const apiUrl = getApiBaseUrl("Vehicle lookup service");
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
