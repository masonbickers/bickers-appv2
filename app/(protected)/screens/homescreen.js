// app/(protected)/screens/homescreen.js

import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

import { signOut } from "firebase/auth";
import { auth, db, storage } from "../../../firebaseConfig";
import { resolveWorkspaceAccess } from "../../../lib/access";
import { createDashboardCardStyles } from "../../../lib/design/dashboard";
import { designTokens as t } from "../../../lib/design/tokens";

import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";


import {
  ActivityIndicator,
  Image,
  InteractionManager,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Icon from "react-native-vector-icons/Feather";

const IMAGES_ONLY = ImagePicker.MediaTypeOptions.Images;

const buttons = [
  { label: "Schedule", icon: "calendar", group: "Operations" },
  { label: "Work Diary", icon: "clipboard", group: "Operations" },
  { label: "Vehicle Maintenance", icon: "settings", group: "Operations" },
  { label: "Employee Contacts", icon: "users", group: "HR" },
  { label: "Holidays", icon: "briefcase", group: "HR" },
  { label: "Time Sheet", icon: "clock", group: "HR" },
  { label: "Spec Sheets", icon: "file-text", group: "Other" },
  { label: "Insurance & Compliance", icon: "shield", group: "Other" },
  { label: "Settings", icon: "settings", group: "Other" },
];

const pagePadding = 14;
const gridGap = 10;

const ALLOWED_WORK_DIARY_CODES = new Set([
  "2996",
  "9453",
  "3514",
  "1906",
  "6978",
  "9759",
]);

const ACTION_DESCRIPTIONS = {
  Schedule: "Call times & assignments",
  "Work Diary": "Upcoming production diary",
  "Vehicle Maintenance": "Fleet checks and issues",
  "Employee Contacts": "Crew phonebook",
  Holidays: "Leave and bank holidays",
  "Time Sheet": "Weekly hours & approval",
  "Spec Sheets": "Technical references",
  "Insurance & Compliance": "Policies and certificates",
  Settings: "Profile and app controls",
};

const ACTION_ROUTES = {
  Schedule: "screens/schedule",
  "Work Diary": "/work-diary",
  "Employee Contacts": "/contacts",
  Holidays: "/holidaypage",
  "Time Sheet": "/timesheet",
  "Vehicle Maintenance": "/maintenance",
  Settings: "/settings",
  "Spec Sheets": "/spec-sheets",
  "Insurance & Compliance": "/insurance",
};

const HOME_LOGO = require("../../../assets/images/bickers-action-logo.png");

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `rgba(255,255,255,${safeAlpha})`;
  }

  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);

  return `rgba(${r},${g},${b},${safeAlpha})`;
}

function actionTintForLabel(label, colors) {
  if (label === "Schedule") return "#4F7DD9";
  if (label === "Work Diary") return "#2C95B8";
  if (label === "Vehicle Maintenance") return "#C56A33";
  if (label === "Employee Contacts") return "#2A8B86";
  if (label === "Holidays") return "#3B9A58";
  if (label === "Time Sheet") return "#B1892D";
  if (label === "Spec Sheets") return "#7577D8";
  if (label === "Insurance & Compliance") return "#667085";
  if (label === "Settings") return "#C94B58";
  return colors.accent;
}

/* ----------------------- shared helpers ----------------------- */

const safeStr = (v) => String(v ?? "").trim().toLowerCase();

const canonicalEmployeeCode = (value) => {
  if (value === null || value === undefined) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (digits) return digits.padStart(4, "0");

  return safeStr(raw);
};

const codesEqual = (a, b) => {
  const aa = canonicalEmployeeCode(a);
  const bb = canonicalEmployeeCode(b);

  return !!aa && !!bb && aa === bb;
};

const resolveEmployeeByCode = (allEmployees, codeValue) => {
  const code = canonicalEmployeeCode(codeValue);
  if (!code) return null;

  return (allEmployees || []).find((x) => codesEqual(x?.userCode, code)) || null;
};

const toDateSafe = (v) => {
  if (!v) return null;
  if (v?.toDate && typeof v.toDate === "function") return v.toDate();

  const d = new Date(v);

  return Number.isNaN(d.getTime()) ? null : d;
};

const toISODate = (d) => {
  const date = d instanceof Date ? d : toDateSafe(d);
  if (!date) return null;

  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");

  return `${y}-${m}-${dd}`;
};

const fmtUK = (d) =>
  (d instanceof Date ? d : toDateSafe(d))?.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) ?? "";

const bookingDatesText = (arr) => {
  const list = Array.isArray(arr) ? arr : [];

  const mapped = list
    .map((x) => {
      if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;

      const iso = toISODate(x);
      return iso || null;
    })
    .filter(Boolean);

  return Array.from(new Set(mapped)).join(", ");
};

function getEmployeesForDate(job, isoDate, allEmployees) {
  const byDate = job.employeesByDate || job.employeeAssignmentsByDate || null;
  const byCodeDate =
    job.employeeCodesByDate || job.assignedEmployeeCodesByDate || null;

  const baseList = byDate?.[isoDate]
    ? byDate[isoDate]
    : Array.isArray(job.employees)
    ? job.employees
    : [];

  const codeList = byCodeDate?.[isoDate]
    ? byCodeDate[isoDate]
    : Array.isArray(job.employeeCodes)
    ? job.employeeCodes
    : [];

  const list = [
    ...(Array.isArray(baseList) ? baseList : []),
    ...(Array.isArray(codeList)
      ? codeList.map((code) => ({ userCode: code }))
      : []),
  ];

  const mapped = list.map((e) => {
    if (typeof e === "string") {
      const value = String(e || "").trim();

      const matchByName = allEmployees.find(
        (x) => safeStr(x.name) === safeStr(value)
      );

      if (matchByName) {
        return {
          code: canonicalEmployeeCode(matchByName.userCode),
          name: safeStr(matchByName.name || matchByName.displayName || value),
          displayName: matchByName.name || matchByName.displayName || value,
        };
      }

      const matchByCode = resolveEmployeeByCode(allEmployees, value);

      if (matchByCode) {
        return {
          code: canonicalEmployeeCode(matchByCode.userCode),
          name: safeStr(matchByCode.name || matchByCode.displayName || value),
          displayName:
            matchByCode.name || matchByCode.displayName || `Code ${value}`,
        };
      }

      return {
        code: canonicalEmployeeCode(value),
        name: safeStr(value),
        displayName: value,
      };
    }

    const name =
      e.name ||
      e.displayName ||
      [e.firstName, e.lastName].filter(Boolean).join(" ");

    const rawCode =
      e.userCode ||
      e.employeeCode ||
      e.code ||
      resolveEmployeeByCode(
        allEmployees,
        e.userCode || e.employeeCode || e.code
      )?.userCode ||
      allEmployees.find((x) => safeStr(x.name) === safeStr(name))?.userCode;

    return {
      code: canonicalEmployeeCode(rawCode),
      name: safeStr(name),
      displayName: name,
    };
  });

  const deduped = [];
  const seen = new Set();

  for (const item of mapped) {
    if (!item) continue;

    const key = `${item.code}::${safeStr(item.displayName || item.name)}`;

    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

/* ----------------------- holiday helpers ----------------------- */

const isBankHolidayEntry = (h) => {
  const type = safeStr(h?.type || h?.holidayType || h?.category || h?.scope);
  const name = safeStr(h?.name || h?.holidayName || h?.title || h?.label);

  return (
    h?.isBankHoliday === true ||
    h?.bankHoliday === true ||
    h?.isPublicHoliday === true ||
    ["bank", "bankholiday", "bank holiday", "public", "public holiday"].includes(
      type
    ) ||
    name.includes("bank holiday") ||
    name.includes("public holiday")
  );
};

const isTruthy = (v) =>
  v === true ||
  v === 1 ||
  String(v ?? "").trim().toLowerCase() === "true" ||
  String(v ?? "").trim().toLowerCase() === "yes";

function getHolidayPayStatus(h) {
  if (isTruthy(h?.paid) || isTruthy(h?.isPaid)) return "Paid";

  const paidStatus = safeStr(h?.paidStatus || h?.payStatus || h?.payType);

  if (paidStatus === "paid") return "Paid";
  if (paidStatus === "unpaid") return "Unpaid";

  const type = safeStr(h?.type || h?.holidayType || h?.category);
  const name = safeStr(h?.name || h?.holidayName || h?.title || h?.label);
  const bucket = `${type} ${name}`;

  if (bucket.includes("unpaid")) return "Unpaid";
  if (bucket.includes("paid")) return "Paid";

  return "Paid";
}

function getHolidayInfoForDate(h, employee, targetISO) {
  if (isBankHolidayEntry(h)) {
    const start = toDateSafe(h.startDate || h.from || h.date);
    const end = toDateSafe(h.endDate || h.to || start);

    if (!start) return null;

    const sISO = toISODate(start);
    const eISO = toISODate(end || start);

    if (!sISO || !eISO) return null;

    if (sISO <= targetISO && eISO >= targetISO) {
      return {
        kind: "bank",
        label: (h?.name || h?.title || h?.holidayName || "Bank Holiday").toString(),
      };
    }

    return null;
  }

  if (!employee) return null;

  const statusStr = safeStr(h.status);
  if (statusStr !== "approved") return null;

  const meCode = canonicalEmployeeCode(employee.userCode);
  const meName = safeStr(employee.name || employee.displayName);

  if (!meCode && !meName) return null;

  const codeMatch =
    !!meCode && [h.employeeCode, h.userCode].some((code) => codesEqual(code, meCode));

  const nameMatch =
    !!meName && [h.employee, h.name].map(safeStr).includes(meName);

  if (!codeMatch && !nameMatch) return null;

  const start = toDateSafe(h.startDate || h.from);
  const end = toDateSafe(h.endDate || h.to || start);

  if (!start) return null;

  const sISO = toISODate(start);
  const eISO = toISODate(end || start);

  if (!sISO || !eISO) return null;

  if (!(sISO <= targetISO && eISO >= targetISO)) return null;

  return {
    kind: "personal",
    pay: getHolidayPayStatus(h),
    label: h?.reason || h?.holidayReason || h?.notes || "",
  };
}

function pickHolidayInfoForDate(holidaysRaw, employee, targetISO) {
  let bank = null;
  let personal = null;

  for (const h of holidaysRaw || []) {
    const info = getHolidayInfoForDate(h, employee, targetISO);

    if (!info) continue;

    if (info.kind === "personal") personal = info;
    if (info.kind === "bank") bank = info;
  }

  return personal || bank || null;
}

const getCallTime = (job, dateISO) => {
  const byDate =
    job.callTimes?.[dateISO] ||
    job.callTimeByDate?.[dateISO] ||
    job.call_times?.[dateISO];

  const single = job.callTime || job.calltime || job.call_time;

  const fromNotes =
    job.notesByDate?.[`${dateISO}-callTime`] || job.notesByDate?.[dateISO]?.callTime;

  return byDate || single || fromNotes || null;
};

const getDayNote = (job, dateISO) => {
  const nb = job?.notesByDate || {};
  const raw = nb?.[dateISO];

  if (!raw) return null;

  if (raw === "Other") {
    const other = nb?.[`${dateISO}-other`];

    if (typeof other === "string" && other.trim()) return other.trim();

    return "Other";
  }

  if (typeof raw === "string" && raw.trim()) return raw.trim();

  return null;
};

const getJobNote = (job) => {
  if (typeof job?.notes === "string" && job.notes.trim()) return job.notes.trim();

  return null;
};

const isRecceDay = (job, dateISO) =>
  /\b(recce\s*day)\b/i.test(getDayNote(job, dateISO) || "");

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const { user, employee, reloadSession } = useAuth();
  const { colors } = useTheme();

  const dashboardCards = useMemo(() => createDashboardCardStyles(colors), [colors]);

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);

  const [todayJobs, setTodayJobs] = useState([]);
  const [todayHolidayInfo, setTodayHolidayInfo] = useState(null);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });

  const [dayJobs, setDayJobs] = useState([]);
  const [dayHolidayInfo, setDayHolidayInfo] = useState(null);

  const [refreshing, setRefreshing] = useState(false);

  const [vehicleNameById, setVehicleNameById] = useState({});
  const planningDataRef = useRef({ jobs: [], holidaysRaw: [], allEmployees: [] });
  const planningRequestIdRef = useRef(0);
  const [planningVersion, setPlanningVersion] = useState(0);

  const [recceOpen, setRecceOpen] = useState(false);
  const [recceJob, setRecceJob] = useState(null);
  const [recceDateISO, setRecceDateISO] = useState(null);
  const [savingRecce, setSavingRecce] = useState(false);
  const [reccePhotos, setReccePhotos] = useState([]);
  const [recceDocId, setRecceDocId] = useState(null);

  const [recceForm, setRecceForm] = useState({
    lead: "",
    locationName: "",
    address: "",
    parking: "",
    access: "",
    hazards: "",
    power: "",
    measurements: "",
    recommendedKit: "",
    notes: "",
    createdAt: null,
    createdBy: null,
  });

  const planningDates = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date();

    tomorrow.setDate(today.getDate() + 1);

    return Array.from(
      new Set(
        [toISODate(today), toISODate(tomorrow), toISODate(selectedDate)].filter(Boolean)
      )
    );
  }, [selectedDate]);

  const groups = useMemo(() => {
    return buttons.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});
  }, []);

  const firebaseUser = user ?? auth.currentUser;
  const isAnon = !!firebaseUser?.isAnonymous;

  const account = employee
    ? {
        name: employee.name || employee.displayName || "Employee",
        email: employee.email || "No email",
        userCode: employee.userCode || "N/A",
      }
    : firebaseUser && !isAnon
    ? {
        name: firebaseUser.displayName || "Manager",
        email: firebaseUser.email || "No email",
        userCode: "N/A",
      }
    : { name: "Unknown User", email: "No email", userCode: "N/A" };

  const workspaceAccess = useMemo(() => resolveWorkspaceAccess(employee), [employee]);
  const canSwitchToService = workspaceAccess.user && workspaceAccess.service;

  const openServiceWorkspace = useCallback(() => {
    if (!canSwitchToService) return;
    router.push("/service/home");
  }, [canSwitchToService, router]);

  const userInitials = (account.name || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const timeOfDay = useMemo(() => {
    const h = new Date().getHours();

    if (h < 12) return "Good Morning";
    if (h < 18) return "Good Afternoon";

    return "Good Evening";
  }, []);

  const todayISO = toISODate(new Date());

  const selectedISO = useMemo(() => toISODate(selectedDate), [selectedDate]);

  const gridWidth = Math.max(width - pagePadding * 2, 320);

  const handleLogout = async () => {
    try {
      await AsyncStorage.multiRemove([
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

      await reloadSession();
      await signOut(auth).catch(() => {});
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const loadVehiclesMap = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "vehicles"));
      const map = {};

      snap.docs.forEach((d) => {
        const data = d.data() || {};
        const name =
          data.name ||
          data.vehicleName ||
          data.displayName ||
          data.title ||
          data.label ||
          data.nickname ||
          null;

        map[d.id] = name || d.id;
      });

      setVehicleNameById(map);
    } catch (e) {
      console.warn("loadVehiclesMap error:", e);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadVehiclesMap();
    });

    return () => task.cancel?.();
  }, [loadVehiclesMap]);

  const vehicleDisplayList = useCallback(
    (vehicles) => {
      const list = Array.isArray(vehicles) ? vehicles : [];
      const out = [];

      for (const v of list) {
        if (!v) continue;

        if (typeof v === "string") {
          out.push(vehicleNameById[v] || v);
          continue;
        }

        if (typeof v === "object") {
          const maybeId =
            v.id || v.vehicleId || v.vehicleID || v.docId || v.refId || v.value;

          const maybeName =
            v.name || v.vehicleName || v.displayName || v.title || v.label;

          if (maybeName) out.push(maybeName);
          else if (maybeId) out.push(vehicleNameById[maybeId] || String(maybeId));

          continue;
        }

        out.push(String(v));
      }

      return Array.from(new Set(out)).filter(Boolean);
    },
    [vehicleNameById]
  );

  const vehiclesText = useCallback(
    (vehicles) => vehicleDisplayList(vehicles).join(", "),
    [vehicleDisplayList]
  );

  const loadPlanningData = useCallback(async () => {
    if (!employee) return null;

    const requestId = ++planningRequestIdRef.current;

    try {
      const bookingsPromise =
        planningDates.length > 0
          ? getDocs(
              query(
                collection(db, "bookings"),
                where("bookingDates", "array-contains-any", planningDates)
              )
            )
          : Promise.resolve({ docs: [] });

      const [jobsSnap, holSnap, empSnap] = await Promise.all([
        bookingsPromise,
        getDocs(collection(db, "holidays")),
        getDocs(collection(db, "employees")),
      ]);

      if (requestId !== planningRequestIdRef.current) return null;

      const next = {
        jobs: jobsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })),
        holidaysRaw: holSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        allEmployees: empSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };

      planningDataRef.current = next;
      setPlanningVersion((prev) => prev + 1);

      return next;
    } catch (e) {
      console.warn("loadPlanningData error:", e);
      return null;
    }
  }, [employee, planningDates]);

  useEffect(() => {
    if (!employee) return undefined;

    const task = InteractionManager.runAfterInteractions(() => {
      loadPlanningData();
    });

    return () => task.cancel?.();
  }, [employee, loadPlanningData]);

  const buildJobsForDate = useCallback(
    (dateISO, source = planningDataRef.current) => {
      if (!employee || !dateISO) return [];

      const meCode = canonicalEmployeeCode(employee.userCode);
      const meName = safeStr(employee.name || employee.displayName);

      const jobs = Array.isArray(source?.jobs) ? source.jobs : [];
      const allEmployees = Array.isArray(source?.allEmployees)
        ? source.allEmployees
        : [];

      const dayJobsList = [];

      for (const job of jobs) {
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        if (!dates.length) continue;

        for (const d of dates) {
          const dStr = toISODate(d);

          if (!dStr || dStr !== dateISO) continue;

          const todaysEmps = getEmployeesForDate(job, dStr, allEmployees);

          const isMineToday =
            (!!meCode && todaysEmps.some((r) => codesEqual(r.code, meCode))) ||
            (!!meName && todaysEmps.some((r) => safeStr(r.name) === meName));

          if (!isMineToday) continue;

          dayJobsList.push({
            ...job,
            employees: todaysEmps.map((r) => r.displayName).filter(Boolean),
          });

          break;
        }
      }

      return dayJobsList;
    },
    [employee]
  );

  const holidayForDate = useCallback(
    (dateISO, source = planningDataRef.current) => {
      if (!dateISO) return null;

      const holidaysRaw = Array.isArray(source?.holidaysRaw)
        ? source.holidaysRaw
        : [];

      return pickHolidayInfoForDate(holidaysRaw, employee, dateISO);
    },
    [employee]
  );

  const loadDayStatus = useCallback(
    (date, source = planningDataRef.current) => {
      if (!employee) {
        setDayJobs([]);
        setDayHolidayInfo(null);
        return;
      }

      const dateISO = toISODate(date);

      if (!dateISO) {
        setDayJobs([]);
        setDayHolidayInfo(null);
        return;
      }

      const dayJobsList = buildJobsForDate(dateISO, source);

      setDayJobs(dayJobsList);

      const info = holidayForDate(dateISO, source);

      setDayHolidayInfo(dayJobsList.length === 0 ? info : null);
    },
    [employee, buildJobsForDate, holidayForDate]
  );

  useEffect(() => {
    loadDayStatus(selectedDate);
  }, [selectedDate, loadDayStatus, planningVersion]);

  const loadHeaderStatus = useCallback(
    (source = planningDataRef.current) => {
      if (!employee) {
        setTodayJobs([]);
        setTodayHolidayInfo(null);
        return;
      }

      const today = new Date();

      const todayDateISO = toISODate(today);

      const todaysJobsList = buildJobsForDate(todayDateISO, source);

      setTodayJobs(todaysJobsList);

      const todayInfo = holidayForDate(todayDateISO, source);

      setTodayHolidayInfo(todaysJobsList.length === 0 ? todayInfo : null);
    },
    [employee, buildJobsForDate, holidayForDate]
  );

  useEffect(() => {
    loadHeaderStatus();
  }, [loadHeaderStatus, planningVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    try {
      const [, planningData] = await Promise.all([
        loadVehiclesMap(),
        loadPlanningData(),
      ]);

      if (planningData) {
        loadHeaderStatus(planningData);
        loadDayStatus(selectedDate, planningData);
      } else {
        loadHeaderStatus();
        loadDayStatus(selectedDate);
      }
    } finally {
      setRefreshing(false);
    }
  }, [
    loadVehiclesMap,
    loadPlanningData,
    loadHeaderStatus,
    loadDayStatus,
    selectedDate,
  ]);

  const goPrevDay = useCallback(() => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() - 1);
      return nd;
    });
  }, []);

  const goNextDay = useCallback(() => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + 1);
      return nd;
    });
  }, []);

  /* --------------------- recce helpers --------------------- */

  const ensureMediaPerms = async () => {
    if (Platform.OS === "web") return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      throw new Error("Permission to access photos is required.");
    }
  };

  const ensureCameraPerms = async () => {
    if (Platform.OS === "web") return;

    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== "granted") {
      throw new Error("Permission to use camera is required.");
    }
  };

  const ensureFileUri = async (uri) => {
    if (!uri) return null;

    try {
      const manip = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      return manip?.uri || null;
    } catch {
      return uri;
    }
  };

  const uploadReccePhotos = async (bookingId, dateISO, items) => {
    const urls = [];
    const uid = auth.currentUser?.uid || "public";

    for (let i = 0; i < items.length; i++) {
      const fileUri = await ensureFileUri(items[i].uri);

      if (!fileUri) continue;

      const filename = `${Date.now()}_${i}.jpg`;
      const path = `recce-photos/${uid}/${bookingId}/${dateISO}/${filename}`;
      const storageRef = ref(storage, path);

      const resp = await fetch(fileUri);
      const blob = await resp.blob();

      await new Promise((resolve, reject) =>
        uploadBytesResumable(storageRef, blob, {
          contentType: "image/jpeg",
        }).on("state_changed", undefined, reject, resolve)
      );

      urls.push(await getDownloadURL(storageRef));
    }

    return urls;
  };

  const pickPhotos = async () => {
    try {
      await ensureMediaPerms();

      const res = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        selectionLimit: 8,
        mediaTypes: IMAGES_ONLY,
        quality: 1,
      });

      if (res.canceled) return;

      const assets = res.assets ?? [];

      setReccePhotos((prev) =>
        [...prev, ...assets.map((a) => ({ uri: a.uri }))].slice(0, 8)
      );
    } catch (e) {
      console.warn("pickPhotos error:", e);
    }
  };

  const takePhoto = async () => {
    try {
      await ensureCameraPerms();

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: IMAGES_ONLY,
        quality: 1,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];

      if (asset) {
        setReccePhotos((prev) => [...prev, { uri: asset.uri }].slice(0, 8));
      }
    } catch (e) {
      console.warn("takePhoto error:", e);
    }
  };

  const openRecceFor = useCallback(
    async (job, dateISO) => {
      setRecceJob(job);
      setRecceDateISO(dateISO);
      setRecceOpen(true);

      const creator = employee?.userCode || "N/A";
      const key = `${job.id}__${dateISO}__${creator || "N/A"}`;

      setRecceDocId(key);

      try {
        const snap = await getDoc(doc(db, "recces", key));

        if (!snap.exists()) {
          setRecceForm((prev) => ({
            ...prev,
            lead: employee?.name || prev.lead || "",
            locationName: job?.location || "",
            createdAt: new Date().toISOString(),
            createdBy: creator,
          }));

          setReccePhotos([]);
          return;
        }

        const data = snap.data();
        const answers = data?.answers || {};

        const existingUrls = Array.isArray(answers.photos)
          ? answers.photos
          : Array.isArray(data?.photos)
          ? data.photos
          : [];

        setRecceForm((prev) => ({
          ...prev,
          lead: answers.lead || employee?.name || prev.lead || "",
          locationName: answers.locationName || job?.location || "",
          address: answers.address || "",
          parking: answers.parking || "",
          access: answers.access || "",
          hazards: answers.hazards || "",
          power: answers.power || "",
          measurements: answers.measurements || "",
          recommendedKit: answers.recommendedKit || "",
          notes: answers.notes || "",
          createdAt: answers.createdAt || data.createdAt || new Date().toISOString(),
          createdBy: answers.createdBy || data.createdBy || creator,
        }));

        setReccePhotos(existingUrls.map((u) => ({ uri: u, remote: true })));
      } catch (e) {
        console.warn("openRecceFor error:", e);
      }
    },
    [employee?.name, employee?.userCode]
  );

  const saveRecce = async () => {
    if (!recceJob || !recceDateISO) return;

    try {
      setSavingRecce(true);

      const keepUrls = reccePhotos
        .filter((p) => p?.remote || (p?.uri || "").startsWith("http"))
        .map((p) => p.uri);

      const newLocals = reccePhotos.filter(
        (p) => !p?.remote && !(p?.uri || "").startsWith("http")
      );

      const uploaded = await uploadReccePhotos(recceJob.id, recceDateISO, newLocals);
      const finalPhotos = [...keepUrls, ...uploaded];

      const payload = {
        ...recceForm,
        photos: finalPhotos,
        createdAt: recceForm.createdAt || new Date().toISOString(),
        createdBy: employee?.userCode || "N/A",
        dateISO: recceDateISO,
      };

      await setDoc(
        doc(db, "bookings", recceJob.id),
        { recceForms: { [recceDateISO]: payload } },
        { merge: true }
      );

      const key =
        recceDocId ||
        `${recceJob.id}__${recceDateISO}__${employee?.userCode || "N/A"}`;

      await setDoc(
        doc(db, "recces", key),
        {
          bookingId: recceJob.id,
          jobNumber: recceJob.jobNumber || null,
          client: recceJob.client || null,
          dateISO: recceDateISO,
          status: "submitted",
          answers: payload,
          notes: payload.notes || "",
          photos: finalPhotos,
          createdAt: recceForm.createdAt ? recceForm.createdAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: employee?.userCode || "N/A",
          lead: payload.lead || "",
          locationName: payload.locationName || "",
        },
        { merge: true }
      );

      setRecceOpen(false);
      setRecceJob(null);
      setRecceDateISO(null);
      setReccePhotos([]);
    } catch (e) {
      console.error("Error saving recce form:", e);
    } finally {
      setSavingRecce(false);
    }
  };

  const renderStatusFallback = useCallback(
    (holidayInfo, dateObj) => {
      let label = "Yard Based";
      let icon = "home";

      if (holidayInfo?.kind === "personal") {
        label = holidayInfo.pay === "Unpaid" ? "Holiday (Unpaid)" : "Holiday (Paid)";
        icon = holidayInfo.pay === "Unpaid" ? "alert-triangle" : "sun";
      } else if (holidayInfo?.kind === "bank") {
        label = "Bank Holiday";
        icon = "briefcase";
      } else if (dateObj && [0, 6].includes(dateObj.getDay())) {
        label = "Off";
        icon = "moon";
      }

      return (
        <View
          style={[
            styles.emptyState,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.emptyIcon,
              {
                backgroundColor: withAlpha(colors.accent, 0.12),
                borderColor: withAlpha(colors.accent, 0.35),
              },
            ]}
          >
            <Icon name={icon} size={18} color={colors.accent} />
          </View>

          <Text style={[styles.statusText, { color: colors.text }]}>{label}</Text>

          <Text style={[styles.emptySubText, { color: colors.textMuted }]}>
            No assigned job details for this date.
          </Text>
        </View>
      );
    },
    [colors]
  );

  const renderJobCard = useCallback(
    (job, dateISO) => {
      const dayNote = getDayNote(job, dateISO);
      const jobNote = getJobNote(job);
      const showRecce = isRecceDay(job, dateISO);
      const callTime = getCallTime(job, dateISO);
      const statusText = String(job.status || "");
      const statusLower = statusText.toLowerCase();

      let statusTone = "#2563EB";

      if (statusLower.includes("cancel") || statusLower.includes("postpon")) {
        statusTone = "#6B7280";
      } else if (statusLower.includes("first pencil")) {
        statusTone = "#D97706";
      } else if (statusLower.includes("second pencil")) {
        statusTone = "#DC2626";
      } else if (
        statusLower.includes("confirmed") ||
        statusLower.includes("active")
      ) {
        statusTone = "#3B9A58";
      }

      return (
        <TouchableOpacity
          key={job.id}
          onPress={() => setSelectedJob(job)}
          activeOpacity={0.86}
        >
          <View
            style={[
              styles.jobCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.jobAccent, { backgroundColor: statusTone }]} />

            <View style={styles.jobContent}>
              <View style={styles.titleRow}>
                <Text
                  style={[styles.jobTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  Job #{job.jobNumber || "N/A"}
                </Text>

                {callTime ? (
                  <View
                    style={[
                      styles.callTimePill,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Icon name="clock" size={12} color={colors.textMuted} />
                    <Text style={[styles.callTime, { color: colors.text }]}>
                      {callTime}
                    </Text>
                  </View>
                ) : null}
              </View>

              {job.client ? (
                <DetailLine
                  label="Production"
                  value={job.client}
                  colors={colors}
                />
              ) : null}

              {job.location ? (
                <DetailLine
                  label="Location"
                  value={job.location}
                  colors={colors}
                />
              ) : null}

              {Array.isArray(job.bookingDates) && job.bookingDates.length > 0 ? (
                <DetailLine
                  label="Dates"
                  value={bookingDatesText(job.bookingDates)}
                  colors={colors}
                />
              ) : null}

              {Array.isArray(job.employees) && job.employees.length > 0 ? (
                <DetailLine
                  label="Crew"
                  value={job.employees.join(", ")}
                  colors={colors}
                />
              ) : null}

              {Array.isArray(job.vehicles) && job.vehicles.length > 0 ? (
                <DetailLine
                  label="Vehicles"
                  value={vehiclesText(job.vehicles)}
                  colors={colors}
                />
              ) : null}

              {Array.isArray(job.equipment) && job.equipment.length > 0 ? (
                <DetailLine
                  label="Equipment"
                  value={job.equipment.join(", ")}
                  colors={colors}
                />
              ) : null}

              <View style={styles.jobFooterRow}>
                {statusText ? (
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: withAlpha(statusTone, 0.12),
                        borderColor: withAlpha(statusTone, 0.4),
                      },
                    ]}
                  >
                    <Text style={[styles.statusBadgeText, { color: statusTone }]}>
                      {statusText}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.jobOpenHint}>
                  <Text style={[styles.jobOpenText, { color: colors.textMuted }]}>
                    Details
                  </Text>
                  <Icon name="chevron-right" size={14} color={colors.textMuted} />
                </View>
              </View>

              {(dayNote || jobNote) ? (
                <View
                  style={[
                    styles.notesBox,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {dayNote ? (
                    <DetailLine label="Day Note" value={dayNote} colors={colors} />
                  ) : null}

                  {jobNote ? (
                    <DetailLine label="Job Note" value={jobNote} colors={colors} />
                  ) : null}
                </View>
              ) : null}

              {showRecce ? (
                <TouchableOpacity
                  style={[styles.recceBtn, { backgroundColor: colors.accent }]}
                  onPress={() => openRecceFor(job, dateISO)}
                  activeOpacity={0.9}
                >
                  <Icon name="file-text" size={14} color="#fff" />
                  <Text style={styles.recceBtnText}>Fill Recce Form</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [colors, openRecceFor, vehiclesText]
  );

  const renderActionGroup = ([groupName, groupItems]) => {
    const filteredItems = groupItems.filter((btn) => {
      if (btn.label !== "Work Diary") return true;

      return ALLOWED_WORK_DIARY_CODES.has(String(employee?.userCode || ""));
    });

    if (!filteredItems.length) return null;

    const colCount = width < 390 ? 2 : filteredItems.length === 2 ? 2 : 3;
    const totalGap = gridGap * (colCount - 1);
    const buttonWidth = (gridWidth - totalGap) / colCount;

    return (
      <View key={groupName} style={styles.groupSection}>
        <View style={styles.groupHeader}>
          <Text style={[styles.groupTitle, { color: colors.text }]}>
            {groupName}
          </Text>

          <View
            style={[
              styles.groupDividerLine,
              {
                backgroundColor: colors.border,
                opacity: 0.7,
              },
            ]}
          />
        </View>

        <View style={styles.grid}>
          {filteredItems.map((btn, index) => {
            const actionTint = actionTintForLabel(btn.label, colors);
            const actionDescription =
              ACTION_DESCRIPTIONS[btn.label] || "Open section";

            return (
              <TouchableOpacity
                key={`${btn.label}-${index}`}
                style={[
                  styles.button,
                  {
                    width: buttonWidth,
                    ...dashboardCards.quickActionCard,
                    borderColor: withAlpha(actionTint, 0.2),
                  },
                ]}
                activeOpacity={0.86}
                onPress={() => {
                  const route = ACTION_ROUTES[btn.label];
                  if (route) router.push(route);
                }}
              >
                <View
                  style={[
                    styles.buttonIconWrap,
                    {
                      backgroundColor: withAlpha(actionTint, 0.08),
                      borderColor: withAlpha(actionTint, 0.24),
                    },
                  ]}
                >
                  <Icon name={btn.icon} size={20} color={actionTint} />
                </View>

                <View style={styles.buttonTextWrap}>
                  <Text
                    style={[styles.buttonText, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {btn.label}
                  </Text>

                  <Text
                    style={[styles.buttonMeta, { color: colors.textMuted }]}
                    numberOfLines={2}
                  >
                    {actionDescription}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <View
          style={[
            styles.heroCard,
            dashboardCards.heroCard,
          ]}
        >
          <View style={styles.headerRow}>
            <View style={styles.heroIntro}>
              <Image
                source={HOME_LOGO}
                style={styles.heroLogo}
                resizeMode="contain"
              />

              <Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>
                {timeOfDay}
              </Text>

              <Text style={[styles.heroTitle, { color: colors.text }]}>
                {account.name}
              </Text>

              <Text style={[styles.heroSubtitle, { color: colors.textMuted }]}>
                {fmtUK(new Date())}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.userIcon,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => setShowAccountModal(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.userInitials, { color: colors.text }]}>
                {userInitials}
              </Text>

              <View
                style={[
                  styles.userPresence,
                  {
                    backgroundColor: colors.success,
                    borderColor: colors.background,
                  },
                ]}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.heroMetaRow}>
            <View
              style={[
                styles.heroMetaChip,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Icon name="hash" size={12} color={colors.textMuted} />
              <Text style={[styles.heroMetaText, { color: colors.text }]}>
                Code {account.userCode}
              </Text>
            </View>

            <View
              style={[
                styles.heroMetaChip,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Icon name="refresh-cw" size={12} color={colors.textMuted} />
              <Text style={[styles.heroMetaText, { color: colors.text }]}>
                Pull to refresh
              </Text>
            </View>

            {canSwitchToService ? (
              <TouchableOpacity
                activeOpacity={0.86}
                onPress={openServiceWorkspace}
                style={[
                  styles.heroWorkspaceChip,
                  {
                    backgroundColor: withAlpha(colors.accent, 0.14),
                    borderColor: withAlpha(colors.accent, 0.42),
                  },
                ]}
              >
                <Icon name="repeat" size={12} color={colors.accent} />

                <Text style={[styles.heroWorkspaceText, { color: colors.accent }]}>
                  Switch to Service
                </Text>

                <Icon name="arrow-up-right" size={12} color={colors.accent} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View
          style={[
            styles.block,
            styles.flatSectionBlock,
            {
              backgroundColor: "transparent",
              borderColor: "transparent",
            },
          ]}
        >
          <View style={styles.blockHeadRow}>
            <View style={styles.blockTitleWrap}>
              <Text style={[styles.blockTitle, { color: colors.text }]}>
                Today&apos;s Work
              </Text>

              <Text style={[styles.blockSubTitle, { color: colors.textMuted }]}>
                Assigned jobs and notes
              </Text>
            </View>

            <View
              style={[
                styles.countPill,
                {
                  backgroundColor: withAlpha(colors.accent, 0.15),
                  borderColor: withAlpha(colors.accent, 0.45),
                },
              ]}
            >
              <Text style={[styles.countPillText, { color: colors.accent }]}>
                {todayJobs.length}
              </Text>
            </View>
          </View>

          {todayJobs.length > 0
            ? todayJobs.map((job) => renderJobCard(job, todayISO))
            : renderStatusFallback(todayHolidayInfo, new Date())}
        </View>

        <View
          style={[
            styles.block,
            styles.flatSectionBlock,
            {
              backgroundColor: "transparent",
              borderColor: "transparent",
            },
          ]}
        >
          <View style={styles.blockHeadRow}>
            <View style={styles.blockTitleWrap}>
              <Text style={[styles.blockTitle, { color: colors.text }]}>
                Plan Ahead
              </Text>

              <Text style={[styles.blockSubTitle, { color: colors.textMuted }]}>
                {selectedDate.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "2-digit",
                  month: "short",
                })}
              </Text>
            </View>

            <View style={styles.dayHeader}>
              <TouchableOpacity
                style={[
                  styles.dayNavBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={goPrevDay}
                activeOpacity={0.85}
              >
                <Icon name="arrow-left" size={16} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.dayNavBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={goNextDay}
                activeOpacity={0.85}
              >
                <Icon name="arrow-right" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {dayJobs.length > 0
            ? dayJobs.map((job) => renderJobCard(job, selectedISO))
            : renderStatusFallback(dayHolidayInfo, selectedDate)}
        </View>

        {Object.entries(groups).map(renderActionGroup)}

        <View style={{ height: 14 }} />
      </ScrollView>

      <JobDetailsModal
        visible={!!selectedJob}
        job={selectedJob}
        colors={colors}
        onClose={() => setSelectedJob(null)}
        vehiclesText={vehiclesText}
      />

      <AccountModal
        visible={showAccountModal}
        account={account}
        colors={colors}
        onClose={() => setShowAccountModal(false)}
        onLogout={handleLogout}
        onViewProfile={() => {
          setShowAccountModal(false);
          router.push("/edit-profile");
        }}
      />

      <RecceModal
        visible={recceOpen}
        colors={colors}
        recceDateISO={recceDateISO}
        recceJob={recceJob}
        recceForm={recceForm}
        setRecceForm={setRecceForm}
        reccePhotos={reccePhotos}
        setReccePhotos={setReccePhotos}
        savingRecce={savingRecce}
        onPickPhotos={pickPhotos}
        onTakePhoto={takePhoto}
        onCancel={() => {
          setRecceOpen(false);
          setRecceJob(null);
          setRecceDateISO(null);
        }}
        onSave={saveRecce}
      />
    </SafeAreaView>
  );
}

/* ----------------------------- Components ----------------------------- */

const DetailLine = ({ label, value, colors }) => {
  if (!value) return null;

  return (
    <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
      <Text style={[styles.jobLabel, { color: colors.text }]}>{label}: </Text>
      {value}
    </Text>
  );
};

const BaseModal = ({ visible, children, colors, onClose }) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onClose}
  >
    <View style={styles.modalBackdrop}>
      <View
        style={[
          styles.modalContent,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        {children}
      </View>
    </View>
  </Modal>
);

const JobDetailsModal = ({ visible, job, colors, onClose, vehiclesText }) => {
  if (!job) return null;

  return (
    <BaseModal visible={visible} colors={colors} onClose={onClose}>
      <View style={styles.modalHandle} />

      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Job #{job.jobNumber || "N/A"}
      </Text>

      <View
        style={[
          styles.modalInfoBox,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
          },
        ]}
      >
        {job.client ? (
          <ModalDetail icon="briefcase" label="Production" value={job.client} colors={colors} />
        ) : null}

        {job.location ? (
          <ModalDetail icon="map-pin" label="Location" value={job.location} colors={colors} />
        ) : null}

        {Array.isArray(job.bookingDates) && job.bookingDates.length > 0 ? (
          <ModalDetail
            icon="calendar"
            label="Dates"
            value={bookingDatesText(job.bookingDates)}
            colors={colors}
          />
        ) : null}

        {Array.isArray(job.employees) && job.employees.length > 0 ? (
          <ModalDetail
            icon="users"
            label="Crew"
            value={job.employees.join(", ")}
            colors={colors}
          />
        ) : null}

        {Array.isArray(job.vehicles) && job.vehicles.length > 0 ? (
          <ModalDetail
            icon="truck"
            label="Vehicles"
            value={vehiclesText(job.vehicles)}
            colors={colors}
          />
        ) : null}

        {Array.isArray(job.equipment) && job.equipment.length > 0 ? (
          <ModalDetail
            icon="tool"
            label="Equipment"
            value={job.equipment.join(", ")}
            colors={colors}
          />
        ) : null}

        {job.notes ? (
          <ModalDetail
            icon="file-text"
            label="Job Note"
            value={String(job.notes)}
            colors={colors}
          />
        ) : null}
      </View>

      <TouchableOpacity
        style={[
          styles.modalPrimaryButton,
          {
            backgroundColor: colors.accent,
          },
        ]}
        onPress={onClose}
        activeOpacity={0.9}
      >
        <Text style={styles.modalPrimaryButtonText}>Close</Text>
      </TouchableOpacity>
    </BaseModal>
  );
};

const AccountModal = ({
  visible,
  account,
  colors,
  onClose,
  onLogout,
  onViewProfile,
}) => (
  <BaseModal visible={visible} colors={colors} onClose={onClose}>
    <View style={styles.modalHandle} />

    <Text style={[styles.modalTitle, { color: colors.text }]}>My Account</Text>

    <View style={styles.accountHero}>
      <View
        style={[
          styles.accountAvatar,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.accountAvatarText, { color: colors.text }]}>
          {(account.name || "U")
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2)}
        </Text>
      </View>

      <Text style={[styles.accountHeroName, { color: colors.text }]}>
        {account.name}
      </Text>

      <Text style={[styles.accountHeroMeta, { color: colors.textMuted }]}>
        Code {account.userCode}
      </Text>
    </View>

    <View
      style={[
        styles.modalInfoBox,
        {
          backgroundColor: "transparent",
          borderColor: "transparent",
        },
      ]}
    >
      <ModalDetail icon="mail" label="Email" value={account.email} colors={colors} />
      <ModalDetail icon="hash" label="Code" value={account.userCode} colors={colors} />
    </View>

    <TouchableOpacity
      style={[
        styles.modalSecondaryButton,
        {
          backgroundColor: "transparent",
          borderColor: "transparent",
        },
      ]}
      onPress={onViewProfile}
      activeOpacity={0.9}
    >
      <Icon name="edit-3" size={15} color={colors.text} />
      <Text style={[styles.modalSecondaryButtonText, { color: colors.text }]}>
        View Profile
      </Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.modalPrimaryButton, { backgroundColor: "#C8102E" }]}
      onPress={onLogout}
      activeOpacity={0.9}
    >
      <Icon name="log-out" size={15} color="#fff" />
      <Text style={styles.modalPrimaryButtonText}>Logout</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[
        styles.modalSecondaryButton,
        {
          backgroundColor: "transparent",
          borderColor: "transparent",
        },
      ]}
      onPress={onClose}
      activeOpacity={0.9}
    >
      <Text style={[styles.modalSecondaryButtonText, { color: colors.text }]}>
        Close
      </Text>
    </TouchableOpacity>
  </BaseModal>
);

const RecceModal = ({
  visible,
  colors,
  recceDateISO,
  recceJob,
  recceForm,
  setRecceForm,
  reccePhotos,
  setReccePhotos,
  savingRecce,
  onPickPhotos,
  onTakePhoto,
  onCancel,
  onSave,
}) => (
  <Modal
    visible={visible}
    transparent
    animationType="slide"
    onRequestClose={onCancel}
  >
    <View style={styles.modalBackdrop}>
      <View
        style={[
          styles.recceModalContent,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.modalHandle} />

        <Text style={[styles.modalTitle, { color: colors.text }]}>
          Recce Form
        </Text>

        <Text
          style={[
            styles.modalSubtitle,
            {
              color: colors.textMuted,
            },
          ]}
        >
          {recceDateISO} · Job #{recceJob?.jobNumber || "N/A"}
          {recceJob?.client ? ` · ${recceJob.client}` : ""}
        </Text>

        <ScrollView
          style={styles.recceScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Label colors={colors}>Recce Lead</Label>
          <Input
            colors={colors}
            value={recceForm.lead}
            onChangeText={(text) => setRecceForm((f) => ({ ...f, lead: text }))}
            placeholder="Your name"
          />

          <Label colors={colors}>Location Name</Label>
          <Input
            colors={colors}
            value={recceForm.locationName}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, locationName: text }))
            }
            placeholder="e.g. Richmond Park — Gate A"
          />

          <Label colors={colors}>Address</Label>
          <Input
            colors={colors}
            value={recceForm.address}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, address: text }))
            }
            placeholder="Street, City, Postcode"
          />

          <Label colors={colors}>Parking</Label>
          <Input
            colors={colors}
            value={recceForm.parking}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, parking: text }))
            }
            placeholder="Where can we park? Permits? Height limits?"
            multiline
          />

          <Label colors={colors}>Access</Label>
          <Input
            colors={colors}
            value={recceForm.access}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, access: text }))
            }
            placeholder="Route in/out, gate codes, load-in distance…"
            multiline
          />

          <Label colors={colors}>Hazards</Label>
          <Input
            colors={colors}
            value={recceForm.hazards}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, hazards: text }))
            }
            placeholder="Slopes, public areas, water, overheads…"
            multiline
          />

          <Label colors={colors}>Power Availability</Label>
          <Input
            colors={colors}
            value={recceForm.power}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, power: text }))
            }
            placeholder="Mains? Generator required? Distances?"
          />

          <Label colors={colors}>Measurements</Label>
          <Input
            colors={colors}
            value={recceForm.measurements}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, measurements: text }))
            }
            placeholder="Clearances, widths, distances…"
          />

          <Label colors={colors}>Recommended Vehicle/Kit</Label>
          <Input
            colors={colors}
            value={recceForm.recommendedKit}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, recommendedKit: text }))
            }
            placeholder="Vehicle type, rigging, radios, PPE…"
          />

          <Label colors={colors}>Photos</Label>

          <View style={styles.photoButtonRow}>
            <TouchableOpacity
              style={[
                styles.photoButton,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              onPress={onPickPhotos}
              activeOpacity={0.9}
            >
              <Icon name="image" size={15} color={colors.text} />
              <Text style={[styles.photoButtonText, { color: colors.text }]}>
                Library
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.photoButton,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              onPress={onTakePhoto}
              activeOpacity={0.9}
            >
              <Icon name="camera" size={15} color={colors.text} />
              <Text style={[styles.photoButtonText, { color: colors.text }]}>
                Camera
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.photoGrid}>
            {reccePhotos.map((p, idx) => (
              <View key={`${p.uri}-${idx}`} style={styles.photoWrap}>
                <Image source={{ uri: p.uri }} style={styles.photoThumb} />

                <TouchableOpacity
                  onPress={() =>
                    setReccePhotos((prev) => prev.filter((_, i) => i !== idx))
                  }
                  style={styles.photoRemove}
                >
                  <Text style={styles.photoRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}

            {reccePhotos.length === 0 ? (
              <Text style={[styles.emptyPhotosText, { color: colors.textMuted }]}>
                No photos yet.
              </Text>
            ) : null}
          </View>

          <Label colors={colors}>Notes</Label>
          <Input
            colors={colors}
            value={recceForm.notes}
            onChangeText={(text) =>
              setRecceForm((f) => ({ ...f, notes: text }))
            }
            placeholder="Anything else"
            multiline
          />

          <View style={{ height: 10 }} />
        </ScrollView>

        <View style={styles.recceActionRow}>
          <TouchableOpacity
            style={[
              styles.modalSecondaryButton,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
                flex: 1,
              },
            ]}
            onPress={onCancel}
            activeOpacity={0.9}
            disabled={savingRecce}
          >
            <Text style={[styles.modalSecondaryButtonText, { color: colors.text }]}>
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modalPrimaryButton,
              {
                backgroundColor: colors.accent,
                flex: 1,
                opacity: savingRecce ? 0.72 : 1,
              },
            ]}
            onPress={onSave}
            activeOpacity={0.9}
            disabled={savingRecce}
          >
            {savingRecce ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="save" size={15} color="#fff" />
            )}

            <Text style={styles.modalPrimaryButtonText}>
              {savingRecce ? "Saving…" : "Save Recce"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

const ModalDetail = ({ icon, label, value, colors }) => {
  if (!value) return null;

  return (
    <View style={styles.modalDetailRow}>
      <Icon name={icon} size={15} color={colors.textMuted} />

      <View style={styles.modalDetailTextWrap}>
        <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>
          {label}
        </Text>

        <Text style={[styles.modalDetailValue, { color: colors.text }]}>
          {value}
        </Text>
      </View>
    </View>
  );
};

const Label = ({ children, colors }) => (
  <Text
    style={[
      styles.inputLabel,
      {
        color: colors.textMuted,
      },
    ]}
  >
    {children}
  </Text>
);

const Input = ({ colors, style, ...props }) => (
  <TextInput
    {...props}
    style={[
      styles.input,
      {
        color: colors.text,
        backgroundColor: colors.surfaceAlt,
        borderColor: colors.border,
        minHeight: props.multiline ? 76 : 46,
        textAlignVertical: props.multiline ? "top" : "center",
      },
      style,
    ]}
    placeholderTextColor={colors.textMuted}
  />
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: pagePadding,
    paddingTop: 8,
    paddingBottom: 14,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 2,
    paddingHorizontal: 0,
    gap: 12,
  },

  heroIntro: {
    flex: 1,
    paddingTop: 1,
  },

  heroLogo: {
    width: 150,
    height: 44,
    marginBottom: 8,
    marginLeft: -10,
    alignSelf: "flex-start",
  },

  userIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },

  userInitials: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  heroEyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },

  heroTitle: {
    ...t.typography.pageTitle,
    marginTop: 3,
    letterSpacing: 0.2,
  },

  heroSubtitle: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },

  userPresence: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 999,
    right: 2,
    bottom: 2,
    borderWidth: 2,
  },

  heroCard: {
    position: "relative",
    borderRadius: t.radius.xl,
    marginBottom: 8,
    overflow: "hidden",
    paddingHorizontal: 0,
    paddingVertical: t.spacing.md,
  },

  heroMetaRow: {
    marginTop: 6,
    flexDirection: "row",
    gap: 7,
    flexWrap: "wrap",
  },

  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 26,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
  },

  heroMetaText: {
    fontSize: 11,
    fontWeight: "700",
  },

  heroWorkspaceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 26,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
  },

  heroWorkspaceText: {
    fontSize: 11,
    fontWeight: "800",
  },

  block: {
    padding: 11,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
  },

  flatSectionBlock: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderWidth: 0,
  },

  blockHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 10,
  },

  blockTitleWrap: {
    flex: 1,
  },

  blockTitle: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  blockSubTitle: {
    fontSize: 12,
    marginTop: 1,
    fontWeight: "600",
  },

  countPill: {
    minWidth: 34,
    minHeight: 26,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
    borderWidth: 1,
  },

  countPillText: {
    fontWeight: "900",
    fontSize: 12,
  },

  emptyState: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
    alignItems: "center",
  },

  emptyIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 6,
  },

  statusText: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },

  emptySubText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 3,
  },

  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  dayNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },

  jobCard: {
    flexDirection: "row",
    padding: 10,
    borderRadius: 14,
    marginTop: 7,
    overflow: "hidden",
    borderWidth: 1,
  },

  jobAccent: {
    width: 4,
    borderRadius: 999,
    marginRight: 9,
  },

  jobContent: {
    flex: 1,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
    gap: 8,
  },

  jobTitle: {
    fontSize: 15,
    fontWeight: "900",
    flex: 1,
  },

  callTimePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },

  callTime: {
    fontWeight: "900",
    fontSize: 12,
  },

  jobDetail: {
    fontSize: 13,
    lineHeight: 17,
    marginBottom: 1,
  },

  jobLabel: {
    fontWeight: "800",
  },

  jobFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 5,
    gap: 10,
  },

  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },

  statusBadgeText: {
    fontSize: 11,
    fontWeight: "900",
  },

  jobOpenHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },

  jobOpenText: {
    fontSize: 11,
    fontWeight: "800",
  },

  notesBox: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },

  recceBtn: {
    marginTop: 7,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 10,
    alignSelf: "flex-start",
  },

  recceBtnText: {
    fontWeight: "900",
    fontSize: 13,
    color: "#fff",
  },

  groupSection: {
    marginBottom: 10,
    borderRadius: 16,
  },

  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7,
  },

  groupTitle: {
    fontSize: 16,
    fontWeight: "900",
    marginRight: 9,
  },

  groupDividerLine: {
    height: 1,
    flex: 1,
    borderRadius: 1,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: gridGap,
  },

  button: {
    minHeight: 112,
    borderRadius: 16,
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 11,
    borderWidth: 1,
  },

  buttonIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    alignSelf: "center",
  },

  buttonTextWrap: {
    marginTop: 6,
    flex: 1,
    alignItems: "center",
  },

  buttonText: {
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
    textAlign: "center",
  },

  buttonMeta: {
    fontSize: 11,
    lineHeight: 13,
    marginTop: 3,
    fontWeight: "600",
    textAlign: "center",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },

  modalContent: {
    padding: 16,
    borderRadius: 20,
    width: "92%",
    maxHeight: "82%",
    borderWidth: 1,
  },

  recceModalContent: {
    padding: 16,
    borderRadius: 20,
    width: "94%",
    maxHeight: "88%",
    borderWidth: 1,
  },

  modalHandle: {
    width: 42,
    height: 4,
    borderRadius: 99,
    backgroundColor: "rgba(148,163,184,0.45)",
    alignSelf: "center",
    marginBottom: 10,
  },

  modalTitle: {
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
    textAlign: "center",
  },

  modalSubtitle: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },

  modalInfoBox: {
    borderRadius: 14,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 2,
    marginTop: 5,
    marginBottom: 10,
  },

  modalDetailRow: {
    flexDirection: "row",
    gap: 9,
    paddingVertical: 5,
  },

  modalDetailTextWrap: {
    flex: 1,
  },

  modalDetailLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.35,
    marginBottom: 1,
  },

  modalDetailValue: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },

  accountAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 8,
  },

  accountAvatarText: {
    fontSize: 24,
    fontWeight: "900",
  },

  accountHero: {
    alignItems: "center",
    marginTop: 2,
    marginBottom: 2,
  },

  accountHeroName: {
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 2,
    textAlign: "center",
  },

  accountHeroMeta: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },

  modalPrimaryButton: {
    minHeight: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 7,
    paddingHorizontal: 13,
  },

  modalPrimaryButtonText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },

  modalSecondaryButton: {
    minHeight: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 7,
    paddingHorizontal: 13,
    borderWidth: 0,
  },

  modalSecondaryButtonText: {
    fontWeight: "900",
    fontSize: 14,
  },

  recceScroll: {
    maxHeight: 470,
  },

  inputLabel: {
    fontSize: 12,
    fontWeight: "900",
    marginTop: 7,
    marginBottom: 4,
    letterSpacing: 0.25,
  },

  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 5,
    fontSize: 14,
    fontWeight: "600",
  },

  photoButtonRow: {
    flexDirection: "row",
    gap: 9,
    marginBottom: 7,
  },

  photoButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  photoButtonText: {
    fontWeight: "900",
    fontSize: 13,
  },

  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 5,
  },

  photoWrap: {
    position: "relative",
  },

  photoThumb: {
    width: 82,
    height: 82,
    borderRadius: 12,
  },

  photoRemove: {
    position: "absolute",
    top: -7,
    right: -7,
    backgroundColor: "#C8102E",
    borderRadius: 999,
    minWidth: 22,
    minHeight: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },

  photoRemoveText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
    lineHeight: 18,
  },

  emptyPhotosText: {
    fontSize: 13,
    fontWeight: "700",
    paddingVertical: 4,
  },

  recceActionRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 8,
  },
});
