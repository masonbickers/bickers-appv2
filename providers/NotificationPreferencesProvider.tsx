import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import {
  cancelAllMaintenanceReminders,
  DEFAULT_MAINTENANCE_REMINDER_TIME,
  getMaintenanceReminderTime,
  getMaintenanceRemindersEnabled,
  setMaintenanceReminderTime as persistMaintenanceReminderTime,
  setMaintenanceRemindersEnabled as persistMaintenanceRemindersEnabled,
} from "../lib/maintenanceReminders";
import { useAuth } from "./AuthProvider";

type NotificationPreferencesContextValue = {
  maintenanceRemindersEnabled: boolean;
  maintenanceReminderTime: string;
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  setMaintenanceRemindersEnabled: (enabled: boolean) => Promise<void>;
  setMaintenanceReminderTime: (time: string) => Promise<void>;
};

const NotificationPreferencesCtx =
  createContext<NotificationPreferencesContextValue | null>(null);

function toError(value: unknown) {
  return value instanceof Error ? value : new Error("Could not update notification settings.");
}

export function NotificationPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isAuthed, loading: authLoading } = useAuth();
  const [maintenanceRemindersEnabled, setEnabledState] = useState(false);
  const [maintenanceReminderTime, setTimeState] = useState(
    DEFAULT_MAINTENANCE_REMINDER_TIME
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const lastKnownEnabledRef = useRef<boolean | null>(null);
  const savingRef = useRef(false);
  const activeUidRef = useRef("");
  activeUidRef.current = isAuthed ? String(user?.uid || "") : "";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const requestedUid = activeUidRef.current;

    const request = Promise.all([
      getMaintenanceRemindersEnabled(),
      getMaintenanceReminderTime(),
    ])
      .then(async ([enabled, reminderTime]) => {
        if (!mountedRef.current || activeUidRef.current !== requestedUid) return;
        setEnabledState(enabled);
        setTimeState(reminderTime);
        setError(null);
        if (!enabled && lastKnownEnabledRef.current !== false) {
          cancelAllMaintenanceReminders().catch((reason) => {
            lastKnownEnabledRef.current = null;
            console.warn("[maintenance-reminders] stale cancellation failed:", reason);
          });
        }
        lastKnownEnabledRef.current = enabled;
      })
      .catch((reason) => {
        if (mountedRef.current) setError(toError(reason));
        throw reason;
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false);
        refreshPromiseRef.current = null;
      });

    refreshPromiseRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthed || !user?.uid) {
      setEnabledState(false);
      setTimeState(DEFAULT_MAINTENANCE_REMINDER_TIME);
      setError(null);
      setIsLoading(false);
      lastKnownEnabledRef.current = null;
      cancelAllMaintenanceReminders().catch((reason) => {
        console.warn("[maintenance-reminders] logout cancellation failed:", reason);
      });
      return;
    }

    setIsLoading(true);
    refresh().catch(() => {});
  }, [authLoading, isAuthed, refresh, user?.uid]);

  useEffect(() => {
    if (!isAuthed) return undefined;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [isAuthed, refresh]);

  const updateEnabled = useCallback(
    async (enabled: boolean) => {
      if (savingRef.current) return;
      const previous = maintenanceRemindersEnabled;
      savingRef.current = true;
      setIsSaving(true);
      setEnabledState(enabled);
      setError(null);
      try {
        try {
          await persistMaintenanceRemindersEnabled(enabled);
          lastKnownEnabledRef.current = enabled;
        } catch (reason) {
          if (mountedRef.current) {
            setEnabledState(previous);
            setError(toError(reason));
          }
          throw reason;
        }

        try {
          if (!enabled) await cancelAllMaintenanceReminders();
        } catch (reason) {
          lastKnownEnabledRef.current = null;
          if (mountedRef.current) setError(toError(reason));
          throw reason;
        }
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [maintenanceRemindersEnabled]
  );

  const updateTime = useCallback(
    async (time: string) => {
      if (savingRef.current || time === maintenanceReminderTime) return;
      const previous = maintenanceReminderTime;
      savingRef.current = true;
      setIsSaving(true);
      setTimeState(time);
      setError(null);
      try {
        await persistMaintenanceReminderTime(time);
        const persisted = await getMaintenanceReminderTime();
        if (mountedRef.current) setTimeState(persisted);
      } catch (reason) {
        if (mountedRef.current) {
          setTimeState(previous);
          setError(toError(reason));
        }
        throw reason;
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [maintenanceReminderTime]
  );

  const value = useMemo(
    () => ({
      maintenanceRemindersEnabled,
      maintenanceReminderTime,
      isLoading,
      isSaving,
      error,
      refresh,
      setMaintenanceRemindersEnabled: updateEnabled,
      setMaintenanceReminderTime: updateTime,
    }),
    [
      error,
      isLoading,
      isSaving,
      maintenanceReminderTime,
      maintenanceRemindersEnabled,
      refresh,
      updateEnabled,
      updateTime,
    ]
  );

  return (
    <NotificationPreferencesCtx.Provider value={value}>
      {children}
    </NotificationPreferencesCtx.Provider>
  );
}

export function useNotificationPreferences() {
  const context = useContext(NotificationPreferencesCtx);
  if (!context) {
    throw new Error(
      "useNotificationPreferences must be used inside NotificationPreferencesProvider"
    );
  }
  return context;
}
