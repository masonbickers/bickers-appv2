const SERVICE_KEYWORDS = new Set([
  "service",
  "service_admin",
  "service_manager",
  "service_lead",
  "workshop",
  "workshop_manager",
  "mechanic",
  "technician",
  "fleet_service",
]);

const USER_KEYWORDS = new Set([
  "employee",
  "manager",
  "office",
  "operations",
  "user",
]);

const DUAL_ACCESS_KEYWORDS = new Set([
  "hybrid",
  "dual",
  "both",
  "all",
  "both_sides",
  "all_access",
]);

const TRUTHY_STRINGS = new Set(["1", "true", "yes", "on"]);
const FALSY_STRINGS = new Set(["0", "false", "no", "off"]);

function toToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isTruthy(value) {
  if (value === true) return true;
  const token = toToken(value);
  return TRUTHY_STRINGS.has(token);
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const token = toToken(value);
  if (TRUTHY_STRINGS.has(token)) return true;
  if (FALSY_STRINGS.has(token)) return false;
  return null;
}

function isServiceLikeValue(value) {
  const token = toToken(value);
  if (!token) return false;
  const parts = token.split("_").filter(Boolean);
  if (SERVICE_KEYWORDS.has(token)) return true;
  if (parts.includes("service")) return true;
  if (token.startsWith("service_") || token.endsWith("_service")) return true;
  return false;
}

function isUserLikeValue(value) {
  const token = toToken(value);
  if (!token) return false;
  const parts = token.split("_").filter(Boolean);
  if (USER_KEYWORDS.has(token)) return true;
  if (parts.includes("user") || parts.includes("employee")) return true;
  return false;
}

function isDualLikeValue(value) {
  const token = toToken(value);
  if (!token) return false;
  return DUAL_ACCESS_KEYWORDS.has(token);
}

function collectValues(subject, keys) {
  const out = [];
  for (const key of keys) {
    const raw = subject?.[key];
    if (Array.isArray(raw)) {
      out.push(...raw);
    } else if (raw !== undefined && raw !== null) {
      out.push(raw);
    }
  }
  return out;
}

export function resolveWorkspaceAccess(subject = {}) {
  const appAccess =
    subject?.appAccess && typeof subject.appAccess === "object"
      ? subject.appAccess
      : null;

  const explicitUser = [
    appAccess?.user,
    subject?.sessionUserAccess,
    subject?.hasUserAccess,
    subject?.userAccess,
    subject?.user,
    subject?.canUseUserApp,
    subject?.canAccessUser,
  ]
    .map(parseBoolean)
    .find((v) => v !== null);

  const explicitService = [
    appAccess?.service,
    subject?.sessionServiceAccess,
    subject?.isService,
    subject?.service,
    subject?.sessionIsService,
    subject?.serviceAccess,
    subject?.canUseServiceApp,
    subject?.canAccessService,
    subject?.isServiceUser,
    subject?.serviceUser,
  ]
    .map(parseBoolean)
    .find((v) => v !== null);

  const flags = [
    subject?.isService,
    subject?.sessionIsService,
    subject?.sessionServiceAccess,
    appAccess?.service,
  ];
  const hasServiceFlag = flags.some(isTruthy);

  const values = collectValues(subject, [
    "role",
    "sessionRole",
    "userRole",
    "jobRole",
    "position",
    "department",
    "team",
    "division",
    "roles",
    "permissions",
    "access",
    "modules",
    "apps",
    "appRoles",
    "workspaces",
    "workspaceAccess",
    "departments",
    "teams",
  ]);

  const hasServiceRole = values.some(isServiceLikeValue);
  const hasUserRole = values.some(isUserLikeValue);
  const hasDualRole = values.some(isDualLikeValue);

  const service =
    explicitService !== undefined
      ? explicitService
      : hasDualRole || hasServiceRole || hasServiceFlag;

  let user;
  if (explicitUser !== undefined) {
    user = explicitUser;
  } else if (hasDualRole) {
    user = true;
  } else if (hasUserRole) {
    user = true;
  } else if (hasServiceRole && !hasUserRole) {
    user = false;
  } else {
    // Backward-compatible default for existing users with no explicit appAccess.
    user = true;
  }

  return {
    user: !!user,
    service: !!service,
  };
}

export function inferServiceAccess(subject = {}) {
  return resolveWorkspaceAccess(subject).service;
}

export function inferUserAccess(subject = {}) {
  return resolveWorkspaceAccess(subject).user;
}

export function inferDualAccess(subject = {}) {
  const access = resolveWorkspaceAccess(subject);
  return access.user && access.service;
}

export function normaliseSessionRole(subject = {}) {
  const explicitRole = String(
    subject?.role || subject?.sessionRole || subject?.userRole || ""
  )
    .trim()
    .toLowerCase();

  if (explicitRole) return explicitRole;
  const access = resolveWorkspaceAccess(subject);
  if (access.user && access.service) return "hybrid";
  if (access.service) return "service";
  return "employee";
}
