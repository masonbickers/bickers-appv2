const pluraliseChanges = (count) => `${count} ${count === 1 ? "change" : "changes"} waiting`;

export function resolveSyncStatus({ isOnline, syncing, outboxCount = 0, lastError } = {}) {
  const pending = Math.max(0, Number(outboxCount) || 0);

  if (isOnline === false) {
    return {
      key: "offline",
      label: pending ? `Offline — ${pluraliseChanges(pending)}` : "Offline — no changes waiting",
      tone: "warning",
      icon: "wifi-off",
    };
  }
  if (syncing) {
    return { key: "syncing", label: "Syncing…", tone: "info", icon: "refresh-cw" };
  }
  if (lastError) {
    return {
      key: "error",
      label: pending ? `Sync needs attention — ${pluraliseChanges(pending)}` : "Sync needs attention",
      tone: "danger",
      icon: "alert-circle",
    };
  }
  if (pending) {
    return {
      key: "waiting",
      label: pluraliseChanges(pending),
      tone: "warning",
      icon: "cloud-off",
    };
  }
  if (isOnline === null || isOnline === undefined) {
    return { key: "checking", label: "Checking sync…", tone: "info", icon: "cloud" };
  }
  return { key: "synced", label: "All changes synced", tone: "success", icon: "check-circle" };
}
