import { getApiBaseUrl } from "./api";

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
  const res = await fetch(`${baseUrl}/auth/sync-employee-auth`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });

  return readJsonResponse(res);
}

export async function warmAuthService() {
  const baseUrl = getApiBaseUrl("Auth service");
  const res = await fetch(`${baseUrl}/health`, {
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
