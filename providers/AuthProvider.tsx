// providers/AuthProvider.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  type QueryConstraint,
  where,
} from "firebase/firestore";
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

async function loadEmployeeProfile(employeeId?: string) {
  const id = String(employeeId || "").trim();
  if (!id) return null;

  try {
    const snap = await getDoc(doc(db, "employees", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Record<string, any>;
  } catch {
    return null;
  }
}

async function queryOneEmployee(field: string, value?: string, companyId?: string) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return null;

  try {
    const constraints: QueryConstraint[] = [where(field, "==", cleanValue)];
    if (companyId) constraints.push(where("companyId", "==", companyId));
    constraints.push(limit(1));

    const snap = await getDocs(query(collection(db, "employees"), ...constraints));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Record<string, any>;
  } catch {
    return null;
  }
}

async function findEmployeeForPersistedUser(
  firebaseUser: User | null,
  userProfile: Record<string, any> | null
) {
  if (!firebaseUser || firebaseUser.isAnonymous) return null;

  const companyId = String(userProfile?.companyId || DEFAULT_COMPANY_ID).trim();
  const email = String(firebaseUser.email || userProfile?.email || "")
    .trim()
    .toLowerCase();
  const uid = String(firebaseUser.uid || "").trim();

  const lookups: [string, string][] = [
    ["authUid", uid],
    ["uid", uid],
    ["auth.uid", uid],
    ["email", email],
  ];

  for (const [field, value] of lookups) {
    const employee = await queryOneEmployee(field, value, companyId);
    if (employee) return employee;
  }

  if (email) {
    try {
      const snap = await getDocs(
        query(
          collection(db, "employees"),
          where("companyId", "==", companyId),
          where("emails", "array-contains", email),
          limit(1)
        )
      );
      if (!snap.empty) {
        return { id: snap.docs[0].id, ...snap.docs[0].data() } as Record<string, any>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function persistRecoveredSession(session: EmployeeSession) {
  await AsyncStorage.multiSet([
    ["sessionRole", session.role || ""],
    ["sessionIsService", session.isService ? "1" : "0"],
    ["sessionCompanyId", session.companyId || DEFAULT_COMPANY_ID],
    ["sessionUserAccess", session.appAccess?.user ? "1" : "0"],
    ["sessionServiceAccess", session.appAccess?.service ? "1" : "0"],
    ["displayName", session.displayName || ""],
    ["employeeId", session.employeeId || ""],
    ["employeeEmail", session.email || ""],
    ["employeeUserCode", session.userCode || ""],
    ["userCode", session.userCode || ""],
    ["timesheetYardStart", session.timesheetDefaults?.yardStart || ""],
    ["timesheetYardEnd", session.timesheetDefaults?.yardEnd || ""],
    ["timesheetOfficeStart", session.timesheetDefaults?.officeStart || ""],
    ["timesheetOfficeEnd", session.timesheetDefaults?.officeEnd || ""],
    ["timesheetWorkshopStart", session.timesheetDefaults?.workshopStart || ""],
    ["timesheetWorkshopEnd", session.timesheetDefaults?.workshopEnd || ""],
    ["timesheetDefaultType", session.timesheetDefaults?.defaultType || ""],
  ]);
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
      const storedEmployeeId = String(m.employeeId || "").trim();
      const profileEmployeeId = String(userProfile?.employeeId || "").trim();
      const employeeProfile =
        !storedEmployeeId && profileEmployeeId
          ? await loadEmployeeProfile(profileEmployeeId)
          : !storedEmployeeId
          ? await findEmployeeForPersistedUser(firebaseUser, userProfile)
          : null;
      const employeeSource = employeeProfile || {};
      const profileAccess =
        userProfile?.appAccess && typeof userProfile.appAccess === "object"
          ? userProfile.appAccess
          : employeeSource?.appAccess && typeof employeeSource.appAccess === "object"
          ? employeeSource.appAccess
          : null;
      const workspaceAccess = resolveWorkspaceAccess({
        sessionRole: userProfile?.role || employeeSource?.role || m.sessionRole,
        sessionIsService: m.sessionIsService,
        sessionUserAccess: profileAccess?.user ?? m.sessionUserAccess,
        sessionServiceAccess: profileAccess?.service ?? m.sessionServiceAccess,
        appAccess: profileAccess,
      });
      const role = toSecurityRole(
        userProfile?.role || employeeSource?.role || m.sessionRole
      );
      const companyId = String(
        userProfile?.companyId ||
          employeeSource?.companyId ||
          m.sessionCompanyId ||
          DEFAULT_COMPANY_ID
      ).trim();
      const employeeId =
        storedEmployeeId || profileEmployeeId || String(employeeSource?.id || "").trim();

      if (employeeId) {
        const yardStart =
          m.timesheetYardStart ||
          employeeSource?.timesheetDefaults?.yardStart ||
          employeeSource?.yardStartTime ||
          employeeSource?.yardStart ||
          "";
        const yardEnd =
          m.timesheetYardEnd ||
          employeeSource?.timesheetDefaults?.yardEnd ||
          employeeSource?.yardEndTime ||
          employeeSource?.yardEnd ||
          "";
        const officeStart =
          m.timesheetOfficeStart ||
          employeeSource?.timesheetDefaults?.officeStart ||
          employeeSource?.officeStartTime ||
          employeeSource?.officeStart ||
          "";
        const officeEnd =
          m.timesheetOfficeEnd ||
          employeeSource?.timesheetDefaults?.officeEnd ||
          employeeSource?.officeEndTime ||
          employeeSource?.officeEnd ||
          "";
        const workshopStart =
          m.timesheetWorkshopStart ||
          employeeSource?.timesheetDefaults?.workshopStart ||
          employeeSource?.workshopStartTime ||
          employeeSource?.workshopStart ||
          "";
        const workshopEnd =
          m.timesheetWorkshopEnd ||
          employeeSource?.timesheetDefaults?.workshopEnd ||
          employeeSource?.workshopEndTime ||
          employeeSource?.workshopEnd ||
          "";
        const rawDefaultType = String(
          m.timesheetDefaultType ||
            employeeSource?.timesheetDefaults?.defaultType ||
            employeeSource?.timesheetDefaultType ||
            ""
        )
          .trim()
          .toLowerCase();
        const defaultType =
          rawDefaultType === "office" || rawDefaultType === "workshop"
            ? rawDefaultType
            : "yard";

        const nextEmployee: EmployeeSession = {
          role,
          isService: workspaceAccess.service,
          appAccess: workspaceAccess,
          companyId,
          uid: firebaseUser?.uid || userProfile?.uid || "",
          isEnabled:
            userProfile?.isEnabled !== false &&
            employeeSource?.isEnabled !== false &&
            employeeSource?.disabled !== true &&
            employeeSource?.active !== false,
          displayName:
            m.displayName ||
            employeeSource?.name ||
            employeeSource?.displayName ||
            userProfile?.displayName ||
            "",
          employeeId,
          email: userProfile?.email || employeeSource?.email || m.employeeEmail || "",
          userCode: m.employeeUserCode || employeeSource?.userCode || "",
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
        };

        setEmployee(nextEmployee);
        if (!storedEmployeeId && employeeSource?.id) {
          persistRecoveredSession(nextEmployee).catch(() => {});
        }
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

  useEffect(() => {
    if (!authReady || user) return;

    let cancelled = false;

    const restoreAnonymousAuthForStoredSession = async () => {
      const employeeId = await AsyncStorage.getItem("employeeId");
      if (cancelled || !employeeId) return;
      await signInAnonymously(auth).catch(() => {});
    };

    restoreAnonymousAuthForStoredSession();

    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  const reloadSession = async () => {
    setSessionReady(false);
    await loadSession(user || auth.currentUser);
  };

  // Code/email login uses anonymous Firebase Auth plus the validated employee session.
  const isAuthed = useMemo(() => {
    const firebaseUserOK = !!user;
    const employeeOK = !!employee?.employeeId;
    const tenantOK = !!employee?.companyId;
    const enabledOK = employee?.isEnabled !== false;
    return firebaseUserOK && employeeOK && tenantOK && enabledOK;
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
