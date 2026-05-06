// app/providers/AuthProvider.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  normaliseSessionRole,
  resolveWorkspaceAccess,
} from "../../lib/access";
import { auth } from "../../firebaseConfig";

type EmployeeSession = {
  role?: string;
  isService?: boolean;
  appAccess?: {
    user: boolean;
    service: boolean;
  };
  displayName?: string;
  email?: string;
  employeeId?: string;
  userCode?: string; // needed for filtering all user data
  yardStartTime?: string;
  yardEndTime?: string;
  officeStartTime?: string;
  officeEndTime?: string;
  timesheetDefaultType?: "yard" | "office";
  timesheetDefaults?: {
    yardStart?: string;
    yardEnd?: string;
    officeStart?: string;
    officeEnd?: string;
    defaultType?: "yard" | "office";
  };
};

type Ctx = {
  user: User | null;
  loading: boolean;
  isAuthed: boolean;
  employee: EmployeeSession | null;
  reloadSession: () => Promise<void>;

  // 🔥 NEW — used for LIVE REFRESH across ALL screens
  jobsUpdatedAt: number;
  setJobsUpdatedAt: React.Dispatch<React.SetStateAction<number>>;
};

const AuthCtx = createContext<Ctx>({
  user: null,
  loading: true,
  isAuthed: false,
  employee: null,
  reloadSession: async () => {},

  // defaults for new state
  jobsUpdatedAt: Date.now(),
  setJobsUpdatedAt: () => {},
});

export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [employee, setEmployee] = useState<EmployeeSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  // 🔥 NEW — Whenever this value changes, all pages listening will update
  const [jobsUpdatedAt, setJobsUpdatedAt] = useState(Date.now());

  // Firebase auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // Load stored session (for employee logins)
  const loadSession = async () => {
    try {
      const entries = await AsyncStorage.multiGet([
        "sessionRole",
        "sessionIsService",
        "sessionUserAccess",
        "sessionServiceAccess",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetDefaultType",
      ]);

      const m = Object.fromEntries(entries);
      const workspaceAccess = resolveWorkspaceAccess({
        sessionRole: m.sessionRole,
        sessionIsService: m.sessionIsService,
        sessionUserAccess: m.sessionUserAccess,
        sessionServiceAccess: m.sessionServiceAccess,
      });
      const role = normaliseSessionRole({
        sessionRole: m.sessionRole,
        appAccess: workspaceAccess,
      });

      if (m.employeeId) {
        const yardStart = m.timesheetYardStart || "";
        const yardEnd = m.timesheetYardEnd || "";
        const officeStart = m.timesheetOfficeStart || "";
        const officeEnd = m.timesheetOfficeEnd || "";
        const defaultType =
          String(m.timesheetDefaultType || "").trim().toLowerCase() === "office"
            ? "office"
            : "yard";

        setEmployee({
          role,
          isService: workspaceAccess.service,
          appAccess: workspaceAccess,
          displayName: m.displayName || "",
          employeeId: m.employeeId || "",
          email: m.employeeEmail || "",
          userCode: m.employeeUserCode || "",
          yardStartTime: yardStart,
          yardEndTime: yardEnd,
          officeStartTime: officeStart,
          officeEndTime: officeEnd,
          timesheetDefaultType: defaultType,
          timesheetDefaults: {
            yardStart,
            yardEnd,
            officeStart,
            officeEnd,
            defaultType,
          },
        });
      } else {
        setEmployee(null);
      }
    } catch {
      setEmployee(null);
    } finally {
      setSessionReady(true);
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  const reloadSession = async () => {
    setSessionReady(false);
    await loadSession();
  };

  // Real Firebase user OR employee session
  const isAuthed = useMemo(() => {
    const realUser = !!user && !user.isAnonymous;
    const employeeOK = !!employee?.employeeId;
    return realUser || employeeOK;
  }, [user, employee]);

  const loading = !(authReady && sessionReady);

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        isAuthed,
        employee,
        reloadSession,

        // NEW live update state
        jobsUpdatedAt,
        setJobsUpdatedAt,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

// Expo Router treats every file inside app/ as a route.
// Keep a noop default export here so this provider module is not warned as invalid.
export default function AuthProviderRouteShim() {
  return null;
}
