export function getErrorCode(error) {
  return String(error?.code || "").trim().toLowerCase();
}

export function isTransientNetworkError(error) {
  const code = getErrorCode(error);
  if (!code) {
    const msg = String(error?.message || "").toLowerCase();
    return (
      msg.includes("network") ||
      msg.includes("offline") ||
      msg.includes("timeout") ||
      msg.includes("unavailable") ||
      msg.includes("failed to fetch")
    );
  }

  return (
    code.includes("unavailable") ||
    code.includes("network") ||
    code.includes("timeout") ||
    code.includes("deadline-exceeded") ||
    code.includes("resource-exhausted")
  );
}

