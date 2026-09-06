import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { syncConfig } from "../lib/sync/config";
import { runSyncCycle } from "../lib/sync/engine";
import {
  getLastSyncAt,
  listOutboxMutations,
  subscribeOutbox,
} from "../lib/sync/outbox";

export function useSyncManager({ enabled, getAuthToken, onRemoteChangesApplied }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAtState] = useState(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [outboxItems, setOutboxItems] = useState([]);
  const [isOnline, setIsOnline] = useState(null);
  const [lastError, setLastError] = useState(null);

  const runningRef = useRef(false);

  const refreshMeta = useCallback(async () => {
    const [items, last] = await Promise.all([listOutboxMutations(), getLastSyncAt()]);
    setOutboxItems(items);
    setOutboxCount(items.length);
    setLastSyncedAtState(last || null);
  }, []);

  useEffect(() => {
    refreshMeta();
    return subscribeOutbox(refreshMeta);
  }, [refreshMeta]);

  const triggerSync = useCallback(
    async (reason = "manual") => {
      if (!enabled || runningRef.current) return;

      runningRef.current = true;
      setSyncing(true);
      setLastError(null);

      try {
        const result = await runSyncCycle({
          getAuthToken,
          onRemoteChangesApplied,
        });

        if (!result.ok && !["offline", "in_flight", "disabled"].includes(result.reason)) {
          setLastError(`Sync skipped (${result.reason || "unknown"})`);
        }
      } catch (e) {
        setLastError(String(e?.message || e));
      } finally {
        setSyncing(false);
        runningRef.current = false;
        await refreshMeta();
      }

      return reason;
    },
    [enabled, getAuthToken, onRemoteChangesApplied, refreshMeta]
  );

  useEffect(() => {
    if (!enabled) {
      setSyncing(false);
      return;
    }

    triggerSync("startup");

    NetInfo.fetch()
      .then((state) => {
        setIsOnline(!!state?.isConnected && state?.isInternetReachable !== false);
      })
      .catch(() => setIsOnline(null));

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        triggerSync("foreground");
      }
    });

    const netSub = NetInfo.addEventListener((state) => {
      const online = !!state?.isConnected && state?.isInternetReachable !== false;
      setIsOnline(online);
      if (online) {
        triggerSync("reconnect");
      }
    });

    const timer = setInterval(() => {
      triggerSync("interval");
    }, syncConfig.syncIntervalMs);

    return () => {
      clearInterval(timer);
      appStateSub.remove();
      netSub();
    };
  }, [enabled, refreshMeta, triggerSync]);

  return {
    syncing,
    isOnline,
    outboxCount,
    outboxItems,
    lastSyncedAt,
    lastError,
    triggerSync,
  };
}
