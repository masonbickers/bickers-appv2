import { Stack } from "expo-router";
import { useCallback } from "react";

import { useEmployeeNotifications } from "../../hooks/useEmployeeNotifications";
import { useSyncManager } from "../../hooks/useSyncManager";
import { useAuth } from "../../providers/AuthProvider";
import { useDataCache } from "../../providers/DataCacheProvider";

export default function ProtectedLayout() {
  const { user, isAuthed, loading, setJobsUpdatedAt } = useAuth();
  const { invalidate } = useDataCache();

  const getAuthToken = useCallback(async () => {
    if (!user || user.isAnonymous) return null;
    return user.getIdToken();
  }, [user]);

  const handleRemoteChangesApplied = useCallback(
    (applied) => {
      if (applied <= 0) return;
      setJobsUpdatedAt(Date.now());
      invalidate().catch(() => {});
    },
    [invalidate, setJobsUpdatedAt]
  );

  useSyncManager({
    enabled: isAuthed && !loading,
    getAuthToken,
    onRemoteChangesApplied: handleRemoteChangesApplied,
  });
  useEmployeeNotifications();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "none",
      }}
    />
  );
}
