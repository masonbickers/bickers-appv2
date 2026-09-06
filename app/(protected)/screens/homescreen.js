import { AppButton, AppModal, AppText as Text, AppPressable as TouchableOpacity, FormField, TextArea } from "../../../components/ui/AppPrimitives";
// app/(protected)/screens/homescreen.js

import {
  useRouter } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import {
  doc,
  serverTimestamp,
  setDoc,
  } from "firebase/firestore";
import { getDownloadURL,
  ref,
  uploadBytesResumable } from "firebase/storage";

import { signOut } from "firebase/auth";
import { auth,
  db,
  storage } from "../../../firebaseConfig";
import { useBookings,
  useHolidays,
  useVehicles } from "../../../hooks/useOperationalData";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import { resolveWorkspaceAccess } from "../../../lib/access";
import { isCrewedBooking } from "../../../lib/bookingVisibility";
import {
  collapseLinkedJobsForDay,
  displayJobNumber,
} from "../../../lib/linkedBookingDays";
import { createDashboardCardStyles } from "../../../lib/design/dashboard";
import { getDashboardGridColumns } from "../../../lib/design/dashboardLayout";
import { getStatusColors } from "../../../lib/design/semantics";
import { designTokens as t } from "../../../lib/design/tokens";
import {
  getBookingVehicleReferences,
  getVehicleDisplayList,
  } from "../../../lib/fleetSchema";
import {
  getInbox,
  subscribeToInbox,
  } from "../../../lib/notificationInbox";

import { useAuth } from "../../../providers/AuthProvider";
import { useDataCache } from "../../../providers/DataCacheProvider";
import { useTheme } from "../../../providers/ThemeProvider";
import PageShell from "../../../components/layout/PageShell";

import {
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";
import { staticColors } from "../../../lib/design/staticColors";
import { withAlpha } from "../../../lib/design/color";

const IMAGES_ONLY = ImagePicker.MediaTypeOptions.Images;

const buttons = [
  { label: "Schedule", shortDescription: "Call times", icon: "calendar", group: "Quick Actions" },
  { label: "Vehicle Maintenance", shortLabel: "Maintenance", shortDescription: "Fleet checks", icon: "settings", group: "Quick Actions" },
  { label: "Employee Contacts", shortLabel: "Contacts", shortDescription: "Crew phonebook", icon: "users", group: "Quick Actions" },
  { label: "Time Sheet", shortDescription: "Weekly hours", icon: "clock", group: "Quick Actions" },
  { label: "Holidays", icon: "briefcase", group: "More" },
  { label: "Work Diary", icon: "clipboard", group: "More" },
  { label: "Spec Sheets", icon: "file-text", group: "More" },
  { label: "Insurance & Compliance", icon: "shield", group: "More" },
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

function actionTintForLabel(label, colors) {
  if (label === "Schedule") return staticColors.hex_4f7dd9_7y5i3e;
  if (label === "Work Diary") return staticColors.hex_2c95b8_6ski01;
  if (label === "Vehicle Maintenance") return staticColors.hex_c56a33_6rjvd3;
  if (label === "Employee Contacts") return staticColors.hex_2a8b86_6r8csh;
  if (label === "Holidays") return staticColors.hex_3b9a58_9w528y;
  if (label === "Time Sheet") return staticColors.hex_b1892d_7hs7ia;
  if (label === "Spec Sheets") return staticColors.hex_7577d8_6e9zug;
  if (label === "Insurance & Compliance") return staticColors.hex_667085_4l8fsc;
  if (label === "Settings") return staticColors.hex_c94b58_6zw5s7;
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

const getTomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
};

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

  const { user, employee, reloadSession } = useAuth();
  const { invalidate } = useDataCache();
  const { colors, colorScheme } = useTheme();
  const responsive = useResponsiveLayout();
  const bookingsResource = useBookings();
  const holidaysResource = useHolidays();
  const vehiclesResource = useVehicles();

  const dashboardCards = useMemo(() => createDashboardCardStyles(colors), [colors]);

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);

  const [todayJobs, setTodayJobs] = useState([]);
  const [todayHolidayInfo, setTodayHolidayInfo] = useState(null);

  const [selectedDate, setSelectedDate] = useState(getTomorrow);

  const [dayJobs, setDayJobs] = useState([]);
  const [dayHolidayInfo, setDayHolidayInfo] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date());

  const planningDataRef = useRef({ jobs: [], holidaysRaw: [], allEmployees: [] });
  const [planningVersion, setPlanningVersion] = useState(0);

  const [recceOpen, setRecceOpen] = useState(false);
  const [recceJob, setRecceJob] = useState(null);
  const [recceDateISO, setRecceDateISO] = useState(null);
  const [savingRecce, setSavingRecce] = useState(false);
  const [reccePhotos, setReccePhotos] = useState([]);
  const recceDocId = null;

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

  const loadAccountNotifications = useCallback(async () => {
    try {
      const inbox = await getInbox();
      setNotificationItems(inbox);
    } catch (error) {
      console.warn("[home] notification inbox load failed:", error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getInbox()
      .then((inbox) => {
        if (active) setNotificationItems(inbox);
      })
      .catch((error) =>
        console.warn("[home] notification inbox load failed:", error)
      );
    const unsubscribe = subscribeToInbox((inbox) => {
      if (active) setNotificationItems(inbox);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const notificationSummary = useMemo(() => {
    const unread = notificationItems.filter((item) => item?.read !== true).length;
    return {
      total: notificationItems.length,
      unread,
      latest: notificationItems[0] || null,
    };
  }, [notificationItems]);

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
  const companyId = employee?.companyId || "";

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

  const gridColumnCount = getDashboardGridColumns(
    responsive.width,
    responsive.fontScale
  );

  const handleLogout = async () => {
    try {
      await AsyncStorage.multiRemove([
        "sessionRole",
        "sessionIsService",
        "sessionUserAccess",
        "sessionServiceAccess",
        "sessionCompanyId",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "userCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetWorkshopStart",
        "timesheetWorkshopEnd",
        "timesheetDefaultType",
      ]);

      global.employee = null;
      await signOut(auth);
      await reloadSession();
      router.replace("/(auth)/login");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const vehicleDisplayList = useCallback(
    (vehicles) => getVehicleDisplayList(vehicles, vehiclesResource.data),
    [vehiclesResource.data]
  );

  const vehiclesText = useCallback(
    (vehicles) => vehicleDisplayList(vehicles).join(", "),
    [vehicleDisplayList]
  );

  const loadPlanningData = useCallback(() => {
    if (!employee || !companyId) return null;
    const next = {
      jobs: bookingsResource.data.filter(isCrewedBooking).filter((job) => {
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        return dates.some((date) => planningDates.includes(toISODate(date)));
      }),
      holidaysRaw: holidaysResource.data,
      allEmployees: bookingsResource.employees,
    };
    planningDataRef.current = next;
    setPlanningVersion((prev) => prev + 1);
    return next;
  }, [
    bookingsResource.data,
    bookingsResource.employees,
    companyId,
    employee,
    holidaysResource.data,
    planningDates,
  ]);

  useEffect(() => {
    if (!employee) return;
    loadPlanningData();
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

      return collapseLinkedJobsForDay(dayJobsList, dateISO);
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
      await Promise.all([
        bookingsResource.refresh(),
        holidaysResource.refresh(),
        vehiclesResource.refresh(),
      ]);
      setLastUpdatedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }, [
    bookingsResource,
    holidaysResource,
    vehiclesResource,
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

  const openRecceFor = useCallback(
    (job, recceDayISO) => {
      router.push({
        pathname: "/recce-form",
        params: {
          jobId: job.id,
          dateISO: recceDayISO,
          jobNumber: job.jobNumber || "N/A",
          locationName: job.location || "",
        },
      });
    },
    [router]
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
      await invalidate("collection:bookings");

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
    (holidayInfo, dateObj, { upcoming = false } = {}) => {
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
          accessibilityRole="summary"
          style={[
            styles.statusSummary,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.statusSummaryIcon,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Icon name={icon} size={18} color={colors.textMuted} />
          </View>
          <View style={styles.statusSummaryCopy}>
            <Text style={[styles.statusSummaryTitle, { color: colors.text }]}>
              {label}
            </Text>
            <Text style={[styles.statusSummaryText, { color: colors.textMuted }]}>
              {upcoming
                ? "No job assigned."
                : "No assigned job details for today."}
            </Text>
          </View>
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

      const semanticStatus = statusLower.includes("cancel") || statusLower.includes("postpon")
        ? "neutral"
        : statusLower.includes("first pencil")
        ? "first pencil"
        : statusLower.includes("second pencil")
        ? "second pencil"
        : statusText;
      const statusTone = getStatusColors(semanticStatus, colorScheme).border;

      return (
        <TouchableOpacity
          key={job.id}
          onPress={() => setSelectedJob(job)}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={`Open job ${displayJobNumber(job)}${job.client ? ` for ${job.client}` : ""}`}
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
                  Job #{displayJobNumber(job)}
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

              {getBookingVehicleReferences(job).length > 0 ? (
                <DetailLine
                  label="Vehicles"
                  value={vehiclesText(getBookingVehicleReferences(job))}
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
                  accessibilityRole="button"
                  accessibilityLabel={`Fill recce form for job ${job.jobNumber || ""}`.trim()}
                >
                  <Icon name="file-text" size={14} color={staticColors.hex_fff_yhjmu8} />
                  <Text style={styles.recceBtnText}>Fill Recce Form</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [colorScheme, colors, openRecceFor, vehiclesText]
  );

  const renderActionGroup = ([groupName, groupItems]) => {
    const filteredItems = groupItems.filter((btn) => {
      if (btn.label !== "Work Diary") return true;

      return ALLOWED_WORK_DIARY_CODES.has(String(employee?.userCode || ""));
    });

    if (!filteredItems.length) return null;

    if (groupName === "More") {
      return (
        <View key={groupName} style={styles.groupSection}>
          <View style={styles.groupHeader}>
            <Text style={[styles.groupTitle, { color: colors.text }]}>
              {groupName}
            </Text>
            <View
              style={[
                styles.groupDividerLine,
                { backgroundColor: colors.border, opacity: 0.7 },
              ]}
            />
          </View>

          <View
            style={[
              styles.moreList,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {filteredItems.map((btn, index) => {
              const actionTint = actionTintForLabel(btn.label, colors);
              const actionDescription =
                ACTION_DESCRIPTIONS[btn.label] || "Open section";
              return (
                <TouchableOpacity
                  key={btn.label}
                  style={[
                    styles.moreActionRow,
                    index < filteredItems.length - 1 && {
                      borderBottomColor: colors.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                  activeOpacity={0.86}
                  onPress={() => {
                    const route = ACTION_ROUTES[btn.label];
                    if (route) router.push(route);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={btn.label}
                  accessibilityHint={actionDescription}
                >
                  <View
                    style={[
                      styles.moreActionIcon,
                      {
                        backgroundColor: withAlpha(actionTint, 0.08),
                        borderColor: withAlpha(actionTint, 0.24),
                      },
                    ]}
                  >
                    <Icon name={btn.icon} size={18} color={actionTint} />
                  </View>
                  <View style={styles.moreActionCopy}>
                    <Text style={[styles.moreActionTitle, { color: colors.text }]}>
                      {btn.label}
                    </Text>
                    <Text
                      style={[styles.moreActionMeta, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {actionDescription}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    const quickActionColumns = Math.min(gridColumnCount, 2);
    const colCount = Math.min(quickActionColumns, filteredItems.length);
    const rows = [];

    for (let i = 0; i < filteredItems.length; i += colCount) {
      rows.push(filteredItems.slice(i, i + colCount));
    }

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
          {rows.map((row, rowIndex) => (
            <View
              key={`${groupName}-row-${rowIndex}`}
              style={[
                styles.gridRow,
                rowIndex === rows.length - 1 && styles.gridRowLast,
              ]}
            >
              {row.map((btn, index) => {
                const actionTint = actionTintForLabel(btn.label, colors);
                const actionDescription =
                  ACTION_DESCRIPTIONS[btn.label] || "Open section";
                const isLastVisibleColumn = index === row.length - 1;

                return (
                  <TouchableOpacity
                    key={`${btn.label}-${index}`}
                    style={[
                      styles.button,
                      !isLastVisibleColumn && styles.gridItemSpacing,
                      {
                        ...dashboardCards.quickActionCard,
                        borderColor: withAlpha(actionTint, 0.14),
                      },
                    ]}
                    activeOpacity={0.86}
                    onPress={() => {
                      const route = ACTION_ROUTES[btn.label];
                      if (route) router.push(route);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={btn.label}
                    accessibilityHint={actionDescription}
                  >
                    <View
                      style={[
                        styles.buttonIconWrap,
                        {
                          backgroundColor: withAlpha(actionTint, 0.06),
                          borderColor: withAlpha(actionTint, 0.18),
                        },
                      ]}
                    >
                      <Icon name={btn.icon} size={20} color={actionTint} />
                    </View>

                    <View style={styles.buttonTextWrap}>
                      <Text style={[styles.buttonText, { color: colors.text }]}>
                        {btn.shortLabel || btn.label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.buttonMeta, { color: colors.textMuted }]}
                      >
                        {btn.shortDescription}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <>
      <PageShell
        contentSpacing="compact"
        refresh={{ refreshing, onRefresh }}
        state={{
          resources: [bookingsResource, holidaysResource, vehiclesResource],
          hasContent:
            bookingsResource.data.length > 0 || holidaysResource.data.length > 0,
          onRetry: onRefresh,
          loadingLabel: "Loading your dashboard…",
        }}
        scrollProps={{ showsVerticalScrollIndicator: false }}
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

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={[
                  styles.notificationButton,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => router.push("/notifications")}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={
                  notificationSummary.unread > 0
                    ? `Open notifications, ${notificationSummary.unread} unread`
                    : "Open notifications"
                }
              >
                <Icon name="bell" size={19} color={colors.text} />
                {notificationSummary.unread > 0 ? (
                  <View
                    style={[
                      styles.userNotificationBadge,
                      {
                        backgroundColor: colors.accent,
                        borderColor: colors.background,
                      },
                    ]}
                  >
                    <Text style={styles.userNotificationBadgeText}>
                      {notificationSummary.unread > 99 ? "99+" : notificationSummary.unread}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.userIcon,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  loadAccountNotifications();
                  setShowAccountModal(true);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Open my account"
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

            <View style={styles.heroUpdateStatus}>
              <Icon name="refresh-cw" size={12} color={colors.textMuted} />
              <Text style={[styles.heroUpdateText, { color: colors.textMuted }]}>
                Updated {lastUpdatedAt.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.dashboardBody}>
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

            {todayJobs.length > 0 ? (
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
            ) : null}
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
                accessibilityRole="button"
                accessibilityLabel="Previous planning day"
                hitSlop={4}
              >
                <Icon
                  name="arrow-left"
                  size={16}
                  color={colors.text}
                />
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
                accessibilityRole="button"
                accessibilityLabel="Next planning day"
                hitSlop={4}
              >
                <Icon name="arrow-right" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {dayJobs.length > 0
            ? dayJobs.map((job) => renderJobCard(job, selectedISO))
            : renderStatusFallback(dayHolidayInfo, selectedDate, {
                upcoming: true,
              })}
        </View>
        {Object.entries(groups).map(renderActionGroup)}
        </View>
      </PageShell>

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
        notificationSummary={notificationSummary}
        canSwitchToService={canSwitchToService}
        onClose={() => setShowAccountModal(false)}
        onLogout={handleLogout}
        onSwitchToService={() => {
          setShowAccountModal(false);
          openServiceWorkspace();
        }}
        onViewProfile={() => {
          setShowAccountModal(false);
          router.push("/edit-profile");
        }}
        onViewNotifications={() => {
          setShowAccountModal(false);
          router.push("/notifications");
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
        onCancel={() => {
          setRecceOpen(false);
          setRecceJob(null);
          setRecceDateISO(null);
        }}
        onSave={saveRecce}
      />
    </>
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

const BaseModal = ({ visible, children, onClose, contentStyle }) => (
  <AppModal
    visible={visible}
    onRequestClose={onClose}
    style={contentStyle}
  >
    {children}
  </AppModal>
);

const JobDetailsModal = ({ visible, job, colors, onClose, vehiclesText }) => {
  if (!job) return null;

  return (
    <BaseModal visible={visible} colors={colors} onClose={onClose}>
      <View style={styles.modalHandle} />

      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Job #{displayJobNumber(job)}
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

        {getBookingVehicleReferences(job).length > 0 ? (
          <ModalDetail
            icon="truck"
            label="Vehicles"
            value={vehiclesText(getBookingVehicleReferences(job))}
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
        accessibilityRole="button"
        accessibilityLabel="Close job details"
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
  notificationSummary,
  canSwitchToService,
  onClose,
  onLogout,
  onSwitchToService,
  onViewProfile,
  onViewNotifications,
}) => (
  <BaseModal
    visible={visible}
    colors={colors}
    onClose={onClose}
    contentStyle={styles.accountModalContent}
  >
    <View style={styles.modalHandle} />

    <Text style={[styles.modalTitle, { color: colors.text }]}>My Account</Text>
    <Text style={[styles.accountModalSubtitle, { color: colors.textMuted }]}>
      Profile, alerts and account controls
    </Text>

    <View
      style={[
        styles.accountSummaryCard,
        {
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.accountAvatar,
          {
            backgroundColor: colors.surface,
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

      <View style={styles.accountSummaryTextWrap}>
        <Text
          style={[styles.accountHeroName, { color: colors.text }]}
        >
          {account.name}
        </Text>

        <Text style={[styles.accountHeroMeta, { color: colors.textMuted }]}>
          Code {account.userCode}
        </Text>
      </View>
    </View>

    <View style={styles.accountRows}>
      <AccountSettingRow
        icon="mail"
        label="Email"
        value={account.email}
        colors={colors}
      />
    </View>

    {notificationSummary?.total > 0 ? (
      <TouchableOpacity
        style={[
          styles.accountNotificationCard,
          {
            borderBottomColor: colors.border,
          },
        ]}
        onPress={onViewNotifications}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={`Open notifications, ${notificationSummary.unread} unread`}
      >
        <View
          style={[
            styles.accountNotificationIcon,
            {
              backgroundColor:
                notificationSummary.unread > 0
                  ? withAlpha(colors.accent, 0.18)
                  : colors.surface,
              borderColor:
                notificationSummary.unread > 0
                  ? withAlpha(colors.accent, 0.42)
                  : colors.border,
            },
          ]}
        >
          <Icon
            name="bell"
            size={17}
            color={notificationSummary.unread > 0 ? colors.accent : colors.textMuted}
          />
        </View>

        <View style={styles.accountNotificationTextWrap}>
          <View style={styles.accountNotificationHeadingRow}>
            <Text
              style={[
                styles.accountNotificationEyebrow,
                {
                  color:
                    notificationSummary.unread > 0
                      ? colors.accent
                      : colors.textMuted,
                },
              ]}
            >
              {notificationSummary.unread > 0
                ? `${notificationSummary.unread} unread alert${
                    notificationSummary.unread === 1 ? "" : "s"
                  }`
                : "Latest notification"}
            </Text>
          </View>
          <Text
            style={[styles.accountNotificationTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {notificationSummary.latest?.title || "Notification"}
          </Text>
          {notificationSummary.latest?.body ? (
            <Text
              style={[styles.accountNotificationBody, { color: colors.textMuted }]}
              numberOfLines={2}
            >
              {notificationSummary.latest.body}
            </Text>
          ) : null}
        </View>

        <Icon name="chevron-right" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ) : null}

    {canSwitchToService ? (
      <TouchableOpacity
        style={[
          styles.accountActionRow,
          {
            borderBottomColor: colors.border,
          },
        ]}
        onPress={onSwitchToService}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Switch to Service workspace"
      >
        <View style={styles.accountActionLeft}>
          <View
            style={[
              styles.accountIconWrap,
              {
                backgroundColor: withAlpha(colors.accent, 0.12),
                borderColor: withAlpha(colors.accent, 0.35),
              },
            ]}
          >
            <Icon name="repeat" size={16} color={colors.accent} />
          </View>
          <Text style={[styles.accountActionText, { color: colors.text }]}>
            Switch to Service
          </Text>
        </View>
        <Icon name="arrow-up-right" size={20} color={colors.accent} />
      </TouchableOpacity>
    ) : null}

    <TouchableOpacity
      style={[
        styles.accountActionRow,
        {
          borderBottomColor: colors.border,
        },
      ]}
      onPress={onViewProfile}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel="View profile"
    >
      <View style={styles.accountActionLeft}>
        <View
          style={[
            styles.accountIconWrap,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="edit-3" size={16} color={colors.textMuted} />
        </View>
        <Text style={[styles.accountActionText, { color: colors.text }]}>
          View Profile
        </Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>

    <View style={styles.accountFooterActions}>
      <TouchableOpacity
        style={[
          styles.accountLogoutButton,
          {
            backgroundColor: colors.dangerSoft,
            borderColor: withAlpha(colors.danger, 0.46),
          },
        ]}
        onPress={onLogout}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Log out"
      >
        <Icon name="log-out" size={16} color={colors.danger} />
        <Text style={[styles.accountLogoutText, { color: colors.danger }]}>Logout</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.accountCloseButton,
          {
            backgroundColor: colors.text,
            borderColor: colors.text,
          },
        ]}
        onPress={onClose}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Close account"
      >
        <Text style={[styles.accountCloseText, { color: colors.background }]}>Done</Text>
      </TouchableOpacity>
    </View>
  </BaseModal>
);

const AccountSettingRow = ({ icon, label, value, colors }) => (
  <View
    style={[
      styles.accountSettingRow,
      {
        borderBottomColor: colors.border,
      },
    ]}
  >
    <View
      style={[
        styles.accountIconWrap,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Icon name={icon} size={16} color={colors.textMuted} />
    </View>
    <View style={styles.accountSettingTextWrap}>
      <Text style={[styles.accountSettingLabel, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[styles.accountSettingValue, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.84}
      >
        {value || "Not set"}
      </Text>
    </View>
  </View>
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
  onCancel,
  onSave,
}) => (
  <AppModal
    visible={visible}
    title="Recce Form"
    onRequestClose={onCancel}
    scrollable
    busy={savingRecce}
    actions={
      <>
        <AppButton label="Cancel" variant="secondary" onPress={onCancel} disabled={savingRecce} />
        <AppButton label={savingRecce ? "Saving…" : "Save Recce"} icon="save" onPress={onSave} loading={savingRecce} />
      </>
    }
  >
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

        <View style={styles.recceScrollContent}>
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
        </View>
  </AppModal>
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

const Input = ({ colors: _colors, style, multiline = false, value, onChangeText, placeholder, ...inputProps }) =>
  multiline ? (
    <TextArea
      label=""
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      inputStyle={style}
      inputProps={inputProps}
    />
  ) : (
    <FormField
      label=""
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      inputStyle={style}
      inputProps={inputProps}
    />
  );

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: pagePadding,
    paddingTop: t.spacing.xs,
    paddingBottom: 200,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: t.spacing.none,
    paddingHorizontal: t.spacing.none,
    gap: t.spacing.sm,
  },

  heroIntro: {
    flex: 1,
    paddingTop: t.spacing.none,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    marginRight: t.spacing.xxs,
  },

  heroLogo: {
    width: 132,
    height: 38,
    marginBottom: t.spacing.xxs,
    marginLeft: -10,
    alignSelf: "flex-start",
  },

  userIcon: {
    width: 44,
    height: 44,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },

  notificationButton: {
    width: 44,
    height: 44,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },

  userInitials: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  heroEyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },

  heroTitle: {
    ...t.typography.pageTitle,
    marginTop: t.spacing.xxs,
    letterSpacing: 0.2,
  },

  heroSubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "600",
  },

  userPresence: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: t.radius.pill,
    right: 2,
    bottom: 2,
    borderWidth: 2,
  },

  userNotificationBadge: {
    position: "absolute",
    minWidth: 20,
    height: 20,
    borderRadius: t.radius.md,
    right: -6,
    top: -6,
    borderWidth: 2,
    paddingHorizontal: t.spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
  },

  userNotificationBadgeText: {
    color: staticColors.hex_fff_yhjmu8,
    fontSize: t.typography.micro.fontSize,
    lineHeight: t.typography.micro.lineHeight,
    fontWeight: "900",
  },

  heroCard: {
    position: "relative",
    borderRadius: t.radius.xl,
    overflow: "hidden",
    paddingHorizontal: t.spacing.none,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.none,
  },

  dashboardBody: {
    gap: t.spacing.xs,
    paddingBottom: t.spacing.xl,
  },

  heroMetaRow: {
    marginTop: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    flexWrap: "wrap",
  },

  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: 26,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderWidth: 1,
  },

  heroMetaText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },

  heroUpdateStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: t.controls.chipMinHeight,
  },

  heroUpdateText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
  },

  block: {
    padding: t.spacing.sm,
    borderRadius: t.radius.xl,
    borderWidth: 1,
  },

  flatSectionBlock: {
    paddingHorizontal: t.spacing.none,
    paddingTop: t.spacing.none,
    paddingBottom: t.spacing.none,
    borderWidth: 0,
  },

  blockHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xxs,
    gap: t.spacing.xs,
  },

  blockTitleWrap: {
    flex: 1,
  },

  blockTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  blockSubTitle: {
    fontSize: t.typography.metadata.fontSize,
    marginTop: t.spacing.none,
    fontWeight: "600",
  },

  countPill: {
    minWidth: 34,
    minHeight: 26,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    borderWidth: 1,
  },

  countPillText: {
    fontWeight: "900",
    fontSize: t.typography.metadata.fontSize,
  },

  statusSummary: {
    minHeight: t.controls.buttonHeightLg,
    marginTop: t.spacing.xxs,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },

  statusSummaryIcon: {
    width: 36,
    height: 36,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  statusSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },

  statusSummaryTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    lineHeight: t.typography.bodyLarge.lineHeight,
    fontWeight: "900",
  },

  statusSummaryText: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "600",
  },

  emptyState: {
    marginTop: t.spacing.xxs,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    padding: t.spacing.sm,
    alignItems: "center",
  },

  emptyIcon: {
    width: 34,
    height: 34,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: t.spacing.xxs,
  },

  statusText: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
    textAlign: "center",
  },

  emptySubText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    textAlign: "center",
    marginTop: t.spacing.xxs,
  },

  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },

  dayNavBtn: {
    width: 32,
    height: 32,
    borderRadius: t.radius.md,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },

  jobCard: {
    flexDirection: "row",
    padding: t.spacing.xs,
    borderRadius: t.radius.lg,
    marginTop: t.spacing.xs,
    overflow: "hidden",
    borderWidth: 1,
  },

  jobAccent: {
    width: 4,
    borderRadius: t.radius.pill,
    marginRight: t.spacing.xs,
  },

  jobContent: {
    flex: 1,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xxs,
    gap: t.spacing.xs,
  },

  jobTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
    flex: 1,
  },

  callTimePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },

  callTime: {
    fontWeight: "900",
    fontSize: t.typography.metadata.fontSize,
  },

  jobDetail: {
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    marginBottom: t.spacing.none,
  },

  jobLabel: {
    fontWeight: "800",
  },

  jobFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: t.spacing.xxs,
    gap: t.spacing.xs,
  },

  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderWidth: 1,
  },

  statusBadgeText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },

  jobOpenHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.none,
  },

  jobOpenText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },

  notesBox: {
    marginTop: t.spacing.xxs,
    borderRadius: t.radius.md,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },

  recceBtn: {
    marginTop: t.spacing.xs,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    alignSelf: "flex-start",
  },

  recceBtnText: {
    fontWeight: "900",
    fontSize: t.typography.bodySmall.fontSize,
    color: staticColors.hex_fff_yhjmu8,
  },

  groupSection: {
    borderRadius: t.radius.xl,
  },

  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.xs,
  },

  groupTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
    marginRight: t.spacing.xs,
  },

  groupDividerLine: {
    height: 1,
    flex: 1,
    borderRadius: t.radius.sm,
  },

  moreList: {
    borderWidth: 1,
    borderRadius: t.radius.xl,
    overflow: "hidden",
  },

  moreActionRow: {
    minHeight: t.controls.buttonHeightLg + t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },

  moreActionIcon: {
    width: 36,
    height: 36,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  moreActionCopy: {
    flex: 1,
    minWidth: 0,
  },

  moreActionTitle: {
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
    fontWeight: "900",
  },

  moreActionMeta: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "600",
  },

  grid: {
    width: "100%",
  },

  gridRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginBottom: gridGap,
  },

  gridRowLast: {
    marginBottom: t.spacing.none,
  },

  gridItemSpacing: {
    marginRight: gridGap,
  },

  button: {
    flex: 1,
    minWidth: 0,
    minHeight: t.controls.buttonHeightLg + t.spacing.lg,
    borderRadius: t.radius.xl,
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: t.spacing.xs,
    padding: t.spacing.sm,
    borderWidth: 1,
  },

  buttonIconWrap: {
    width: 34,
    height: 34,
    borderRadius: t.radius.md,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    flexShrink: 0,
  },

  buttonTextWrap: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
  },

  buttonText: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
    lineHeight: t.typography.bodySmall.lineHeight,
    textAlign: "left",
  },

  buttonMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "600",
    textAlign: "left",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: staticColors.rgba_18a7u5b,
    justifyContent: "center",
    alignItems: "center",
    padding: t.spacing.md,
  },

  modalContent: {
    padding: t.spacing.md,
    borderRadius: t.radius.xl,
    width: "92%",
    maxHeight: "82%",
    borderWidth: 1,
  },

  accountModalContent: {
    padding: t.spacing.sm,
    borderRadius: t.radius.xl,
    width: "92%",
  },

  accountModalSubtitle: {
    marginTop: -1,
    marginBottom: t.spacing.xs,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "700",
    textAlign: "center",
  },

  recceModalContent: {
    padding: t.spacing.md,
    borderRadius: t.radius.xl,
    width: "94%",
    maxHeight: "88%",
    borderWidth: 1,
  },

  modalHandle: {
    width: 42,
    height: 4,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_r89e45,
    alignSelf: "center",
    marginBottom: t.spacing.xs,
  },

  modalTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "900",
    marginBottom: t.spacing.xxs,
    textAlign: "center",
  },

  modalSubtitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: t.spacing.xs,
  },

  modalInfoBox: {
    borderRadius: t.radius.lg,
    borderWidth: 0,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.none,
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xs,
  },

  modalDetailRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },

  modalDetailTextWrap: {
    flex: 1,
  },

  modalDetailLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.35,
    marginBottom: t.spacing.none,
  },

  modalDetailValue: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    lineHeight: t.typography.body.lineHeight,
  },

  accountAvatar: {
    width: 56,
    height: 56,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  accountAvatarText: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "900",
  },

  accountSummaryCard: {
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.none,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },

  accountSummaryTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  accountHeroName: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "900",
    marginBottom: t.spacing.xxs,
  },

  accountHeroMeta: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },

  accountRows: {
    marginBottom: t.spacing.none,
  },

  accountSettingRow: {
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.sm,
    marginBottom: t.spacing.none,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: t.spacing.xs,
  },

  accountIconWrap: {
    width: 34,
    height: 34,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  accountSettingTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  accountSettingLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.35,
    marginBottom: t.spacing.none,
  },

  accountSettingValue: {
    fontSize: t.typography.bodyLarge.fontSize,
    lineHeight: t.typography.bodyLarge.lineHeight,
    fontWeight: "800",
  },

  accountActionRow: {
    minHeight: 58,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.sm,
    marginTop: t.spacing.none,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },

  accountActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: t.spacing.xs,
  },

  accountActionText: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
  },

  accountNotificationCard: {
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.sm,
    marginBottom: t.spacing.none,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },

  accountNotificationIcon: {
    width: 38,
    height: 38,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  accountNotificationTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  accountNotificationHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.none,
  },

  accountNotificationEyebrow: {
    fontSize: t.typography.micro.fontSize,
    lineHeight: t.typography.micro.lineHeight,
    fontWeight: "900",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },

  accountNotificationTitle: {
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
    fontWeight: "900",
  },

  accountNotificationBody: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "600",
  },

  accountFooterActions: {
    marginTop: t.spacing.none,
    flexDirection: "row",
    gap: t.spacing.xs,
  },

  accountLogoutButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: t.spacing.xs,
    borderWidth: 1,
    paddingHorizontal: t.spacing.sm,
  },

  accountLogoutText: {
    fontWeight: "900",
    fontSize: t.typography.body.fontSize,
  },

  accountCloseButton: {
    flex: 1.15,
    minHeight: 46,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.sm,
    borderWidth: 1,
  },

  accountCloseText: {
    fontWeight: "900",
    fontSize: t.typography.body.fontSize,
  },

  modalPrimaryButton: {
    minHeight: 42,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },

  modalPrimaryButtonText: {
    color: staticColors.hex_fff_yhjmu8,
    fontWeight: "900",
    fontSize: t.typography.body.fontSize,
  },

  modalSecondaryButton: {
    minHeight: 42,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderWidth: 0,
  },

  modalSecondaryButtonText: {
    fontWeight: "900",
    fontSize: t.typography.body.fontSize,
  },

  recceScroll: {
    maxHeight: 470,
  },

  recceScrollContent: {
    paddingBottom: t.spacing.xl,
  },

  inputLabel: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.xxs,
    letterSpacing: 0.25,
  },

  input: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    marginBottom: t.spacing.xxs,
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
  },

  photoButtonRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },

  photoButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: t.spacing.xs,
  },

  photoButtonText: {
    fontWeight: "900",
    fontSize: t.typography.bodySmall.fontSize,
  },

  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xxs,
  },

  photoWrap: {
    position: "relative",
  },

  photoThumb: {
    width: 82,
    height: 82,
    borderRadius: t.radius.md,
  },

  photoRemove: {
    position: "absolute",
    top: -7,
    right: -7,
    backgroundColor: staticColors.hex_c8102e_6za5cb,
    borderRadius: t.radius.pill,
    minWidth: 22,
    minHeight: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xxs,
  },

  photoRemoveText: {
    color: staticColors.hex_fff_yhjmu8,
    fontWeight: "900",
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
  },

  emptyPhotosText: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
    paddingVertical: t.spacing.xxs,
  },

  recceActionRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
});
