import { getApiBaseUrl } from "./api";
import { fetchWithServiceWakeRetry } from "./serviceRetry";

async function readJsonResponse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(body?.error || "Auth service request failed.");
  }

  return body;
}

export async function syncEmployeeAuth({ idToken }) {
  const baseUrl = getApiBaseUrl("Auth service");
  const res = await fetchWithServiceWakeRetry(`${baseUrl}/auth/sync-employee-auth`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });

  return readJsonResponse(res);
}

export async function warmAuthService() {
  const baseUrl = getApiBaseUrl("Auth service");
  const res = await fetchWithServiceWakeRetry(`${baseUrl}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return res.ok;
}

export async function getRemoteAppConfig() {
  const baseUrl = getApiBaseUrl("App config service");
  const res = await fetch(`${baseUrl}/app-config`);
  return readJsonResponse(res);
}

export async function registerDeviceToken({
  idToken,
  token,
  platform,
  appVersion,
  employeeId,
  employeeCode,
  email,
}) {
  const baseUrl = getApiBaseUrl("Notification service");
  const res = await fetch(`${baseUrl}/device-tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token,
      platform,
      appVersion,
      employeeId,
      employeeCode,
      email,
    }),
  });

  return readJsonResponse(res);
}

export async function getEmployeeNotifications({
  idToken,
  employeeId,
  employeeCode,
  email,
}) {
  const baseUrl = getApiBaseUrl("Notification service");
  const params = new URLSearchParams({
    employeeId: String(employeeId || ""),
    employeeCode: String(employeeCode || ""),
    email: String(email || ""),
  });
  const res = await fetch(`${baseUrl}/employee-notifications?${params.toString()}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return readJsonResponse(res);
}
