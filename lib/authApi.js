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

export async function lookupEmployeeSetup({ email, code }) {
  const baseUrl = getApiBaseUrl("Auth service");
  const res = await fetch(`${baseUrl}/auth/employee-setup-lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

  return readJsonResponse(res);
}

export async function syncEmployeeAuth({ idToken, employeeId }) {
  const baseUrl = getApiBaseUrl("Auth service");
  const res = await fetch(`${baseUrl}/auth/sync-employee-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, employeeId }),
  });

  return readJsonResponse(res);
}

export async function getRemoteAppConfig() {
  const baseUrl = getApiBaseUrl("App config service");
  const res = await fetch(`${baseUrl}/app-config`);
  return readJsonResponse(res);
}
