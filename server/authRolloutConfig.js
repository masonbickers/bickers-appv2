const VALID_LEGACY_EMPLOYEE_SETUP_MODES = new Set(["enabled", "disabled"]);

export function resolveLegacyEmployeeSetupMode({
  nodeEnv = process.env.NODE_ENV,
  value = process.env.LEGACY_EMPLOYEE_SETUP_MODE,
} = {}) {
  const mode = String(value || "").trim().toLowerCase();
  if (VALID_LEGACY_EMPLOYEE_SETUP_MODES.has(mode)) return mode;

  if (String(nodeEnv || "").trim().toLowerCase() === "production") {
    throw new Error(
      "LEGACY_EMPLOYEE_SETUP_MODE must be explicitly set to enabled or disabled in production."
    );
  }

  return "enabled";
}

export function legacyEmployeeSetupIsEnabled(options) {
  return resolveLegacyEmployeeSetupMode(options) === "enabled";
}
