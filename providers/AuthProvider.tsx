// providers/AuthProvider.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { resolveWorkspaceAccess } from "../lib/access";
import { auth, db } from "../firebaseConfig";

const DEFAULT_COMPANY_ID = "bickers-action";

type EmployeeSession = {
  role?: string;
  isService?: boolean;
  appAccess?: {
    user: boolean;
    service: boolean;
  };
  companyId?: string;
  uid?: string;
  isEnabled?: boolean;
  displayName?: string;
  email?: string;
  employeeId?: string;
  userCode?: string; // needed for filtering all user data
  yardStartTime?: string;
  yardEndTime?: string;
  officeStartTime?: string;
  officeEndTime?: string;
  workshopStartTime?: string;
  workshopEndTime?: string;
  timesheetDefaultType?: "yard" | "office" | "workshop";
  timesheetDefaults?: {
    yardStart?: string;
    yardEnd?: string;
    officeStart?: string;
    officeEnd?: string;
    workshopStart?: string;
    workshopEnd?: string;
    defaultType?: "yard" | "office" | "workshop";
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

function toSecurityRole(value?: string) {
  const role = String(value || "").trim();
  if (["platformAdmin", "admin", "user"].includes(role)) return role;
  return "user";
}

async function loadUserProfile(firebaseUser: User | null) {
  if (!firebaseUser || firebaseUser.isAnonymous) return null;

  try {
    const snap = await getDoc(doc(db, "users", firebaseUser.uid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Record<string, any>;
  } catch {
    return null;
  }
}

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

  // Load stored employee session plus the Firestore user profile required by rules.
  const loadSession = useCallback(async (firebaseUser: User | null) => {
    try {
      const entries = await AsyncStorage.multiGet([
        "sessionRole",
        "sessionIsService",
        "sessionUserAccess",
        "sessionServiceAccess",
        "sessionCompanyId",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetWorkshopStart",
        "timesheetWorkshopEnd",
        "timesheetDefaultType",
      ]);

      const m = Object.fromEntries(entries);
      const userProfile = await loadUserProfile(firebaseUser);
      const requiresUserProfile = !!firebaseUser && !firebaseUser.isAnonymous;
      const profileAccess =
        userProfile?.appAccess && typeof userProfile.appAccess === "object"
          ? userProfile.appAccess
          : null;
      const workspaceAccess = resolveWorkspaceAccess({
        sessionRole: userProfile?.role || m.sessionRole,
        sessionIsService: m.sessionIsService,
        sessionUserAccess: profileAccess?.user ?? m.sessionUserAccess,
        sessionServiceAccess: profileAccess?.service ?? m.sessionServiceAccess,
        appAccess: profileAccess,
      });
      const role = toSecurityRole(userProfile?.role || m.sessionRole);
      const companyId = String(
        userProfile?.companyId ||
          (!requiresUserProfile ? m.sessionCompanyId || DEFAULT_COMPANY_ID : "")
      ).trim();

      if (m.employeeId) {
        const yardStart = m.timesheetYardStart || "";
        const yardEnd = m.timesheetYardEnd || "";
        const officeStart = m.timesheetOfficeStart || "";
        const officeEnd = m.timesheetOfficeEnd || "";
        const workshopStart = m.timesheetWorkshopStart || "";
        const workshopEnd = m.timesheetWorkshopEnd || "";
        const rawDefaultType = String(m.timesheetDefaultType || "").trim().toLowerCase();
        const defaultType =
          rawDefaultType === "office" || rawDefaultType === "workshop"
            ? rawDefaultType
            : "yard";

        setEmployee({
          role,
          isService: workspaceAccess.service,
          appAccess: workspaceAccess,
          companyId,
          uid: firebaseUser?.uid || userProfile?.uid || "",
          isEnabled: requiresUserProfile
            ? !!userProfile && userProfile.isEnabled !== false
            : false,
          displayName: m.displayName || "",
          employeeId: m.employeeId || "",
          email: userProfile?.email || m.employeeEmail || "",
          userCode: m.employeeUserCode || "",
          yardStartTime: yardStart,
          yardEndTime: yardEnd,
          officeStartTime: officeStart,
          officeEndTime: officeEnd,
          workshopStartTime: workshopStart,
          workshopEndTime: workshopEnd,
          timesheetDefaultType: defaultType,
          timesheetDefaults: {
            yardStart,
            yardEnd,
            officeStart,
            officeEnd,
            workshopStart,
            workshopEnd,
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
  }, []);

  useEffect(() => {
    if (!authReady) return;
    setSessionReady(false);
    loadSession(user);
  }, [authReady, loadSession, user]);

  const reloadSession = async () => {
    setSessionReady(false);
    await loadSession(user);
  };

  // Require Firebase Auth plus the employee session created after phone verification.
  const isAuthed = useMemo(() => {
    const realUser = !!user && !user.isAnonymous;
    const employeeOK = !!employee?.employeeId;
    const tenantOK = !!employee?.companyId;
    const enabledOK = employee?.isEnabled !== false;
    return realUser && employeeOK && tenantOK && enabledOK;
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
