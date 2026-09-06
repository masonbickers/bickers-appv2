import { createContext, useCallback, useContext } from "react";

import { useSyncManager } from "../hooks/useSyncManager";
import { useAuth } from "./AuthProvider";
import { useDataCache } from "./DataCacheProvider";

const SyncStatusContext = createContext(null);

export function SyncStatusProvider({ children }) {
  const { user, isAuthed, loading, setJobsUpdatedAt, workingTermsAccepted } = useAuth();
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

  const syncStatus = useSyncManager({
    enabled: isAuthed && workingTermsAccepted && !loading,
    getAuthToken,
    onRemoteChangesApplied: handleRemoteChangesApplied,
  });

  return (
    <SyncStatusContext.Provider value={syncStatus}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus() {
  const value = useContext(SyncStatusContext);
  if (!value) throw new Error("useSyncStatus must be used inside SyncStatusProvider");
  return value;
}
