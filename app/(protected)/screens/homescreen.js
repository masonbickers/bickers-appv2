// app/(protected)/screens/homescreen.js

import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

import { signOut } from "firebase/auth";
import { auth, db, storage } from "../../../firebaseConfig";

import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

import BickersLogo from "../../../assets/images/bickers-action-logo.png";

import {
  Dimensions,
  Image,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

const MediaEnum = ImagePicker?.MediaType ?? ImagePicker?.MediaTypeOptions;
const IMAGES_ONLY = MediaEnum?.Images ?? undefined;

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

const screenWidth = Dimensions.get("window").width;
const buttonSpacing = 12;

/* ----------------------- shared helpers (match schedule) ----------------------- */

const safeStr = (v) => String(v ?? "").trim().toLowerCase();

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

// Display date in a tidy UK format (for UI)
const fmtUK = (d) =>
  (d instanceof Date ? d : toDateSafe(d))?.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) ?? "";

// bookingDates can be strings, timestamps, or Dates — normalise nicely for display
const bookingDatesText = (arr) => {
  const list = Array.isArray(arr) ? arr : [];
  const mapped = list
    .map((x) => {
      if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
      const iso = toISODate(x);
      return iso || null;
    })
    .filter(Boolean);

  // de-dupe while preserving order
  return Array.from(new Set(mapped)).join(", ");
};

function getEmployeesForDate(job, isoDate, allEmployees) {
  const byDate = job.employeesByDate || job.employeeAssignmentsByDate || null;

  const list = byDate?.[isoDate]
    ? byDate[isoDate]
    : Array.isArray(job.employees)
    ? job.employees
    : [];

  return list.map((e) => {
    if (typeof e === "string") {
      const name = e;
      const match = allEmployees.find((x) => safeStr(x.name) === safeStr(name));
      return {
        code: safeStr(match?.userCode),
        name,
        displayName: name,
      };
    }

    const name =
      e.name ||
      e.displayName ||
      [e.firstName, e.lastName].filter(Boolean).join(" ");

    const code =
      e.userCode ||
      e.employeeCode ||
      allEmployees.find((x) => safeStr(x.name) === safeStr(name))?.userCode;

    return {
      code: safeStr(code),
      name: safeStr(name),
      displayName: name,
    };
  });
}

/* ----------------------- HOLIDAY / BANK HOLIDAY HELPERS ----------------------- */

const isBankHolidayEntry = (h) => {
  const t = safeStr(h?.type || h?.holidayType || h?.category || h?.scope);
  const n = safeStr(h?.name || h?.holidayName || h?.title || h?.label);

  return (
    h?.isBankHoliday === true ||
    h?.bankHoliday === true ||
    h?.isPublicHoliday === true ||
    ["bank", "bankholiday", "bank holiday", "public", "public holiday"].includes(t) ||
    n.includes("bank holiday") ||
    n.includes("public holiday")
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

  const t = safeStr(h?.type || h?.holidayType || h?.category);
  const n = safeStr(h?.name || h?.holidayName || h?.title || h?.label);
  const bucket = `${t} ${n}`;

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

  const meCode = safeStr(employee.userCode);
  const meName = safeStr(employee.name || employee.displayName);
  if (!meCode && !meName) return null;

  const codeMatch =
    !!meCode && [h.employeeCode, h.userCode].map(safeStr).includes(meCode);

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

const dayStatusLabel = ({ jobsLen, holidayInfo, dateISO }) => {
  if (jobsLen > 0) return "On Set";

  if (holidayInfo?.kind === "personal") {
    return holidayInfo.pay === "Unpaid" ? "Holiday (Unpaid)" : "Holiday (Paid)";
  }

  if (holidayInfo?.kind === "bank") return "Bank Holiday";

  const d = new Date(dateISO);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return "Off";

  return "Yard";
};

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
  const { colors } = useTheme();

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);

  const [todayJobs, setTodayJobs] = useState([]);
  const [tomorrowJobs, setTomorrowJobs] = useState([]);

  const [todayHolidayInfo, setTodayHolidayInfo] = useState(null);
  const [tomorrowHolidayInfo, setTomorrowHolidayInfo] = useState(null);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [dayJobs, setDayJobs] = useState([]);
  const [dayHolidayInfo, setDayHolidayInfo] = useState(null);

  const [refreshing, setRefreshing] = useState(false);

  const [vehicleNameById, setVehicleNameById] = useState({});

  // Recce state
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

  const groups = useMemo(() => {
    return buttons.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});
  }, []);

  const handleLogout = async () => {
    try {
      await AsyncStorage.multiRemove([
        "sessionRole",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
      ]);
      await reloadSession();
      await signOut(auth).catch(() => {});
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

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

  const userInitials = (account.name || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const timeOfDay = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good Morning";
    if (h < 18) return "Good Afternoon";
    return "Good Evening";
  })();

  /* --------------------- LOAD VEHICLES MAP (id -> name) --------------------- */
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
    loadVehiclesMap();
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

  /* --------------------- LOAD WORK + HOLIDAY FOR A DAY --------------------- */
  const loadDayStatus = useCallback(
    async (date) => {
      if (!employee) return;
      const dateISO = toISODate(date);
      if (!dateISO) return;

      const meCode = safeStr(employee.userCode);
      const meName = safeStr(employee.name || employee.displayName);

      const [jobsSnap, holSnap, empSnap] = await Promise.all([
        getDocs(collection(db, "bookings")),
        getDocs(collection(db, "holidays")),
        getDocs(collection(db, "employees")),
      ]);

      const jobs = jobsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      const holidaysRaw = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const allEmployees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const dayJobsList = [];

      for (const job of jobs) {
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        if (!dates.length) continue;

        for (const d of dates) {
          const dStr = toISODate(d);
          if (!dStr || dStr !== dateISO) continue;

          const todaysEmps = getEmployeesForDate(job, dStr, allEmployees);

          const isMineToday =
            (!!meCode && todaysEmps.some((r) => r.code === meCode)) ||
            (!!meName && todaysEmps.some((r) => safeStr(r.name) === meName));

          if (!isMineToday) continue;

          dayJobsList.push({
            ...job,
            employees: todaysEmps.map((r) => r.displayName).filter(Boolean),
          });
          break;
        }
      }

      setDayJobs(dayJobsList);

      const info = pickHolidayInfoForDate(holidaysRaw, employee, dateISO);
      setDayHolidayInfo(dayJobsList.length === 0 ? info : null);
    },
    [employee]
  );

  useEffect(() => {
    loadDayStatus(selectedDate);
  }, [selectedDate, loadDayStatus]);

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

  /* ------------------ LOAD HEADER STRIP (TODAY / TOMORROW) ------------------ */
  const loadHeaderStatus = useCallback(async () => {
    if (!employee) return;

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const todayISO = toISODate(today);
    const tomorrowISO = toISODate(tomorrow);

    const meCode = safeStr(employee.userCode);
    const meName = safeStr(employee.name || employee.displayName);

    const [jobsSnap, holSnap, empSnap] = await Promise.all([
      getDocs(collection(db, "bookings")),
      getDocs(collection(db, "holidays")),
      getDocs(collection(db, "employees")),
    ]);

    const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const holidaysRaw = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allEmployees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const todaysJobsList = [];
    const tomorrowsJobsList = [];

    for (const job of jobs) {
      const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
      if (!dates.length) continue;

      for (const dt of dates) {
        const dStr = toISODate(dt);
        if (!dStr) continue;
        if (dStr !== todayISO && dStr !== tomorrowISO) continue;

        const empsOnDay = getEmployeesForDate(job, dStr, allEmployees);

        const isMineThatDay =
          (!!meCode && empsOnDay.some((r) => r.code === meCode)) ||
          (!!meName && empsOnDay.some((r) => safeStr(r.name) === meName));

        if (!isMineThatDay) continue;

        const jobWithEmps = {
          ...job,
          employees: empsOnDay.map((r) => r.displayName).filter(Boolean),
        };

        if (dStr === todayISO) todaysJobsList.push(jobWithEmps);
        if (dStr === tomorrowISO) tomorrowsJobsList.push(jobWithEmps);
      }
    }

    setTodayJobs(todaysJobsList);
    setTomorrowJobs(tomorrowsJobsList);

    const todayInfo = pickHolidayInfoForDate(holidaysRaw, employee, todayISO);
    const tomorrowInfo = pickHolidayInfoForDate(holidaysRaw, employee, tomorrowISO);

    setTodayHolidayInfo(todaysJobsList.length === 0 ? todayInfo : null);
    setTomorrowHolidayInfo(tomorrowsJobsList.length === 0 ? tomorrowInfo : null);
  }, [employee]);

  useEffect(() => {
    loadHeaderStatus();
  }, [loadHeaderStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadVehiclesMap(),
      loadHeaderStatus(),
      loadDayStatus(selectedDate),
    ]);
    setRefreshing(false);
  }, [loadVehiclesMap, loadHeaderStatus, loadDayStatus, selectedDate]);

  const todayISO = toISODate(new Date());
  const tomorrowISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }, []);

  /* --------------------- Recce helpers (unchanged behaviour) --------------------- */
  const ensureMediaPerms = async () => {
    if (Platform.OS === "web") return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") throw new Error("Permission to access photos is required.");
  };

  const ensureCameraPerms = async () => {
    if (Platform.OS === "web") return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") throw new Error("Permission to use camera is required.");
  };

  const recceDocKey = (bookingId, dateISO, userCode) =>
    `${bookingId}__${dateISO}__${userCode || "N/A"}`;

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
      const r = ref(storage, path);

      const resp = await fetch(fileUri);
      const blob = await resp.blob();

      await new Promise((res, rej) =>
        uploadBytesResumable(r, blob, { contentType: "image/jpeg" }).on(
          "state_changed",
          undefined,
          rej,
          res
        )
      );

      urls.push(await getDownloadURL(r));
    }
    return urls;
  };

  const pickPhotos = async () => {
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
  };

  const takePhoto = async () => {
    await ensureCameraPerms();
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: IMAGES_ONLY,
      quality: 1,
    });
    if (res.canceled) return;
    const a = res.assets?.[0];
    if (a) setReccePhotos((prev) => [...prev, { uri: a.uri }].slice(0, 8));
  };

  const openRecceFor = async (job, dateISO) => {
    setRecceJob(job);
    setRecceDateISO(dateISO);
    setRecceOpen(true);

    const creator = employee?.userCode || "N/A";
    const key = recceDocKey(job.id, dateISO, creator);
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
      const a = data?.answers || {};
      const existingUrls = Array.isArray(a.photos)
        ? a.photos
        : Array.isArray(data?.photos)
        ? data.photos
        : [];

      setRecceForm((prev) => ({
        ...prev,
        lead: a.lead || employee?.name || prev.lead || "",
        locationName: a.locationName || job?.location || "",
        address: a.address || "",
        parking: a.parking || "",
        access: a.access || "",
        hazards: a.hazards || "",
        power: a.power || "",
        measurements: a.measurements || "",
        recommendedKit: a.recommendedKit || "",
        notes: a.notes || "",
        createdAt: a.createdAt || data.createdAt || new Date().toISOString(),
        createdBy: a.createdBy || data.createdBy || creator,
      }));

      setReccePhotos(existingUrls.map((u) => ({ uri: u, remote: true })));
    } catch (e) {
      console.warn("openRecceFor error:", e);
    }
  };

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

  /* -------------------------- ✅ DE-DUPED JOB UI -------------------------- */

  const renderJobCard = useCallback(
    (job, dateISO) => {
      const dayNote = getDayNote(job, dateISO);
      const jobNote = getJobNote(job);
      const showRecce = isRecceDay(job, dateISO);
      const callTime = getCallTime(job, dateISO);

      return (
        <TouchableOpacity
          key={job.id}
          onPress={() => setSelectedJob(job)}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.jobCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.titleRow}>
              <Text style={[styles.jobTitle, { color: colors.text }]}>
                Job #{job.jobNumber || "N/A"}
              </Text>

              {callTime ? (
                <Text
                  style={[
                    styles.callTime,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                >
                  {callTime}
                </Text>
              ) : null}
            </View>

            {job.client ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>
                  Production:{" "}
                </Text>
                {job.client}
              </Text>
            ) : null}

            {job.location ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>
                  Location:{" "}
                </Text>
                {job.location}
              </Text>
            ) : null}

            {Array.isArray(job.bookingDates) && job.bookingDates.length > 0 ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>Dates: </Text>
                {bookingDatesText(job.bookingDates)}
              </Text>
            ) : null}

            {Array.isArray(job.employees) && job.employees.length > 0 ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>Crew: </Text>
                {job.employees.join(", ")}
              </Text>
            ) : null}

            {Array.isArray(job.vehicles) && job.vehicles.length > 0 ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>
                  Vehicles:{" "}
                </Text>
                {vehiclesText(job.vehicles)}
              </Text>
            ) : null}

            {Array.isArray(job.equipment) && job.equipment.length > 0 ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>
                  Equipment:{" "}
                </Text>
                {job.equipment.join(", ")}
              </Text>
            ) : null}

            {job.status ? (
              <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                <Text style={[styles.jobLabel, { color: colors.text }]}>Status: </Text>
                {job.status}
              </Text>
            ) : null}

            {(dayNote || jobNote) ? (
              <View style={{ marginTop: 4 }}>
                {dayNote ? (
                  <Text style={[styles.jobDetail, { color: colors.textMuted }]}>
                    <Text style={[styles.jobLabel, { color: colors.text }]}>
                      Day Note:{" "}
                    </Text>
                    {dayNote}
                  </Text>
                ) : null}

                {jobNote ? (
                  <Text
                    style={[
                      styles.jobDetail,
                      { color: colors.textMuted, marginTop: dayNote ? 2 : 0 },
                    ]}
                  >
                    <Text style={[styles.jobLabel, { color: colors.text }]}>
                      Job Note:{" "}
                    </Text>
                    {jobNote}
                  </Text>
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
                <Text style={[styles.recceBtnText, { color: "#fff" }]}>
                  Fill Recce Form
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      );
    },
    [colors, vehiclesText]
  );

  const renderStatusFallback = useCallback(
    (holidayInfo, dateObj) => {
      if (holidayInfo?.kind === "personal") {
        return (
          <Text style={[styles.statusText, { color: colors.text }]}>
            {holidayInfo.pay === "Unpaid" ? "Holiday (Unpaid)" : "Holiday (Paid)"}
          </Text>
        );
      }
      if (holidayInfo?.kind === "bank") {
        return (
          <Text style={[styles.statusText, { color: colors.text }]}>Bank Holiday</Text>
        );
      }
      if (dateObj && [0, 6].includes(dateObj.getDay())) {
        return <Text style={[styles.statusText, { color: colors.text }]}>Off</Text>;
      }
      return <Text style={[styles.statusText, { color: colors.text }]}>Yard Based</Text>;
    },
    [colors.text]
  );

  const todayLabel = dayStatusLabel({
    jobsLen: todayJobs.length,
    holidayInfo: todayHolidayInfo,
    dateISO: todayISO,
  });

  const tomorrowLabel = dayStatusLabel({
    jobsLen: tomorrowJobs.length,
    holidayInfo: tomorrowHolidayInfo,
    dateISO: tomorrowISO,
  });

  const selectedISO = useMemo(() => toISODate(selectedDate), [selectedDate]);

  /* ---------------------------------- UI ---------------------------------- */

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Image source={BickersLogo} style={styles.logo} resizeMode="contain" />
            <TouchableOpacity
              style={[
                styles.userIcon,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
              onPress={() => setShowAccountModal(true)}
            >
              <Text style={[styles.userInitials, { color: colors.text }]}>
                {userInitials}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Greeting + date */}
          <View
            style={[
              styles.greetingCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.greeting, { color: colors.textMuted }]}>
                {timeOfDay},
              </Text>
              <Text style={[styles.greetingName, { color: colors.text }]}>
                {account.name}
              </Text>
              <Text style={[styles.todayText, { color: colors.textMuted }]}>
                {fmtUK(new Date())}
              </Text>
            </View>
          </View>

          {/* Today / Tomorrow strip */}
          <View style={styles.stripRow}>
            <View
              style={[
                styles.stripCard,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.stripLabel, { color: colors.textMuted }]}>
                Today
              </Text>
              <Text style={[styles.stripValue, { color: colors.text }]}>
                {todayLabel}
              </Text>
            </View>

            <View
              style={[
                styles.stripCard,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.stripLabel, { color: colors.textMuted }]}>
                Tomorrow
              </Text>
              <Text style={[styles.stripValue, { color: colors.text }]}>
                {tomorrowLabel}
              </Text>
            </View>
          </View>

          {/* Today’s Work */}
          <View
            style={[
              styles.block,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.blockTitle, { color: colors.text }]}>Today’s Work</Text>

            {todayJobs.length > 0
              ? todayJobs.map((job) => renderJobCard(job, todayISO))
              : renderStatusFallback(todayHolidayInfo, new Date())}
          </View>

          {/* Day scroller */}
          <View
            style={[
              styles.block,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <View style={styles.dayHeader}>
              <TouchableOpacity onPress={goPrevDay}>
                <Icon name="arrow-left" size={18} color={colors.text} />
              </TouchableOpacity>

              <Text style={[styles.blockTitle, { color: colors.text }]}>
                {selectedDate.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "2-digit",
                  month: "short",
                })}
              </Text>

              <TouchableOpacity onPress={goNextDay}>
                <Icon name="arrow-right" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {dayJobs.length > 0
              ? dayJobs.map((job) => renderJobCard(job, selectedISO))
              : renderStatusFallback(dayHolidayInfo, selectedDate)}
          </View>

          {/* Buttons grid */}
          {Object.entries(groups).map(([groupName, groupItems]) => {
            const allowedWorkDiaryCodes = new Set([
              "2996",
              "9453",
              "3514",
              "1906",
              "6978",
              "9759",
            ]);

            const filteredItems = groupItems.filter((btn) => {
              if (btn.label !== "Work Diary") return true;
              return allowedWorkDiaryCodes.has(String(employee?.userCode || ""));
            });

            const colCount = filteredItems.length === 2 ? 2 : 3;
            const buttonSizeDynamic =
              (screenWidth - buttonSpacing * (colCount + 1)) / colCount;

            return (
              <View key={groupName} style={{ marginBottom: 18 }}>
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
                    styles.grid,
                    {
                      justifyContent:
                        colCount === 2 ? "space-around" : "space-between",
                    },
                  ]}
                >
                  {filteredItems.map((btn, index) => (
                    <TouchableOpacity
                      key={`${btn.label}-${index}`}
                      style={[
                        styles.button,
                        {
                          width: buttonSizeDynamic,
                          height: buttonSizeDynamic,
                          backgroundColor: colors.surfaceAlt,
                        },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (btn.label === "Schedule") router.push("screens/schedule");
                        else if (btn.label === "Work Diary") router.push("/work-diary");
                        else if (btn.label === "Employee Contacts") router.push("/contacts");
                        else if (btn.label === "Holidays") router.push("/holidaypage");
                        else if (btn.label === "Time Sheet") router.push("/timesheet");
                        else if (btn.label === "Vehicle Maintenance") router.push("/maintenance");
                        else if (btn.label === "Settings") router.push("/settings");
                        else if (btn.label === "Spec Sheets") router.push("/spec-sheets");
                        else if (btn.label === "Insurance & Compliance") router.push("/insurance");
                      }}
                    >
                      <Icon
                        name={btn.icon}
                        size={24}
                        color={colors.text}
                        style={{ marginBottom: 6 }}
                      />
                      <Text style={[styles.buttonText, { color: colors.text }]}>
                        {btn.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* Job Details Modal */}
        {selectedJob && (
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Job #{selectedJob.jobNumber || "N/A"}
              </Text>

              {selectedJob.client ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  🧑‍💼 Production: {selectedJob.client}
                </Text>
              ) : null}

              {selectedJob.location ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  📌 Location: {selectedJob.location}
                </Text>
              ) : null}

              {Array.isArray(selectedJob.bookingDates) && selectedJob.bookingDates.length > 0 ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  🗓️ Dates: {bookingDatesText(selectedJob.bookingDates)}
                </Text>
              ) : null}

              {Array.isArray(selectedJob.employees) && selectedJob.employees.length > 0 ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  👥 Crew: {selectedJob.employees.join(", ")}
                </Text>
              ) : null}

              {Array.isArray(selectedJob.vehicles) && selectedJob.vehicles.length > 0 ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  🚙 Vehicles: {vehiclesText(selectedJob.vehicles)}
                </Text>
              ) : null}

              {Array.isArray(selectedJob.equipment) && selectedJob.equipment.length > 0 ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  🛠️ Equipment: {selectedJob.equipment.join(", ")}
                </Text>
              ) : null}

              {selectedJob.notes ? (
                <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                  📄 Job Note: {String(selectedJob.notes)}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.accent, marginTop: 20 }]}
                onPress={() => setSelectedJob(null)}
              >
                <Text style={[styles.modalButtonText, { color: "#fff" }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Account Modal */}
        {showAccountModal && (
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>My Account</Text>

              <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                Name: {account.name}
              </Text>
              <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                Email: {account.email}
              </Text>
              <Text style={[styles.modalDetail, { color: colors.textMuted }]}>
                Code: {account.userCode}
              </Text>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.surfaceAlt }]}
                onPress={() => {
                  setShowAccountModal(false);
                  router.push("/edit-profile");
                }}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>
                  View Profile
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#f44336", marginTop: 10 }]}
                onPress={handleLogout}
              >
                <Text style={[styles.modalButtonText, { color: "#fff" }]}>Logout</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.surfaceAlt, marginTop: 10 }]}
                onPress={() => setShowAccountModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Recce Form Modal */}
        {recceOpen && (
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalContent,
                { maxHeight: "86%", backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Recce Form — {recceDateISO}
              </Text>

              <Text style={[styles.modalDetail, { marginBottom: 8, color: colors.textMuted }]}>
                Job #{recceJob?.jobNumber || "N/A"} {recceJob?.client ? `· ${recceJob.client}` : ""}
              </Text>

              <ScrollView style={{ maxHeight: 420 }}>
                <Label colors={colors}>Recce Lead</Label>
                <Input
                  colors={colors}
                  value={recceForm.lead}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, lead: t }))}
                  placeholder="Your name"
                />

                <Label colors={colors}>Location Name</Label>
                <Input
                  colors={colors}
                  value={recceForm.locationName}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, locationName: t }))}
                  placeholder="e.g., Richmond Park — Gate A"
                />

                <Label colors={colors}>Address</Label>
                <Input
                  colors={colors}
                  value={recceForm.address}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, address: t }))}
                  placeholder="Street, City, Postcode"
                />

                <Label colors={colors}>Parking</Label>
                <Input
                  colors={colors}
                  value={recceForm.parking}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, parking: t }))}
                  placeholder="Where can we park? Permits? Height limits?"
                  multiline
                />

                <Label colors={colors}>Access</Label>
                <Input
                  colors={colors}
                  value={recceForm.access}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, access: t }))}
                  placeholder="Route in/out, gate codes, load-in distance…"
                  multiline
                />

                <Label colors={colors}>Hazards</Label>
                <Input
                  colors={colors}
                  value={recceForm.hazards}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, hazards: t }))}
                  placeholder="Slopes, public areas, water, overheads…"
                  multiline
                />

                <Label colors={colors}>Power Availability</Label>
                <Input
                  colors={colors}
                  value={recceForm.power}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, power: t }))}
                  placeholder="Mains? Generator required? Distances?"
                />

                <Label colors={colors}>Measurements</Label>
                <Input
                  colors={colors}
                  value={recceForm.measurements}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, measurements: t }))}
                  placeholder="Clearances, widths, distances…"
                />

                <Label colors={colors}>Recommended Vehicle/Kit</Label>
                <Input
                  colors={colors}
                  value={recceForm.recommendedKit}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, recommendedKit: t }))}
                  placeholder="Vehicle type, rigging, radios, PPE…"
                />

                <Label colors={colors}>Photos</Label>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: colors.surfaceAlt, flex: 1 }]}
                    onPress={pickPhotos}
                  >
                    <Text style={[styles.modalButtonText, { color: colors.text }]}>
                      Add from Library
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: colors.surfaceAlt, flex: 1 }]}
                    onPress={takePhoto}
                  >
                    <Text style={[styles.modalButtonText, { color: colors.text }]}>
                      Take Photo
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  {reccePhotos.map((p, idx) => (
                    <View key={`${p.uri}-${idx}`} style={{ position: "relative" }}>
                      <Image source={{ uri: p.uri }} style={{ width: 84, height: 84, borderRadius: 8 }} />
                      <TouchableOpacity
                        onPress={() => setReccePhotos((prev) => prev.filter((_, i) => i !== idx))}
                        style={{
                          position: "absolute",
                          top: -8,
                          right: -8,
                          backgroundColor: "#C8102E",
                          borderRadius: 10,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "800" }}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {reccePhotos.length === 0 && (
                    <Text style={{ color: colors.textMuted }}>No photos yet.</Text>
                  )}
                </View>

                <Label colors={colors}>Notes</Label>
                <Input
                  colors={colors}
                  value={recceForm.notes}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, notes: t }))}
                  placeholder="Anything else"
                  multiline
                />
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.surfaceAlt, flex: 1 }]}
                  onPress={() => {
                    setRecceOpen(false);
                    setRecceJob(null);
                    setRecceDateISO(null);
                  }}
                >
                  <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    { backgroundColor: colors.accent, flex: 1, opacity: savingRecce ? 0.7 : 1 },
                  ]}
                  onPress={saveRecce}
                  disabled={savingRecce}
                >
                  <Text style={[styles.modalButtonText, { color: "#fff" }]}>
                    {savingRecce ? "Saving…" : "Save Recce"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* Small UI helpers */
const Label = ({ children, colors }) => (
  <Text
    style={{
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 10,
      marginBottom: 6,
    }}
  >
    {children}
  </Text>
);

const Input = ({ colors, ...props }) => (
  <TextInput
    {...props}
    style={[
      {
        color: colors.text,
        backgroundColor: colors.surfaceAlt,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: props.multiline ? 10 : 8,
        minHeight: props.multiline ? 68 : undefined,
        marginBottom: 8,
      },
      props.style,
    ]}
    placeholderTextColor={colors.textMuted}
  />
);

/* Styles */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  scrollContent: {
    paddingHorizontal: buttonSpacing,
    paddingTop: 16,
    paddingBottom: 20,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  logo: { width: 150, height: 50 },
  userIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  userInitials: { fontSize: 16, fontWeight: "bold" },

  greetingCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  greeting: { fontSize: 13, marginBottom: 2 },
  greetingName: { fontSize: 18, fontWeight: "800" },
  todayText: { fontSize: 12, marginTop: 2 },

  stripRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  stripCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  stripLabel: { fontWeight: "700", fontSize: 12 },
  stripValue: { fontWeight: "800", fontSize: 16, marginTop: 4 },

  block: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  statusText: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },

  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  jobCard: {
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  jobTitle: { fontSize: 16, fontWeight: "800" },
  callTime: {
    fontWeight: "800",
    fontSize: 14,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  jobDetail: { fontSize: 14, marginBottom: 2 },
  jobLabel: { fontWeight: "700" },

  recceBtn: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  recceBtnText: { fontWeight: "800", fontSize: 13 },

  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginRight: 10,
  },
  groupDividerLine: {
    height: 1,
    flex: 1,
    borderRadius: 1,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  button: {
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: buttonSpacing,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    padding: 10,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 4,
  },

  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    padding: 20,
    borderRadius: 12,
    width: "90%",
    maxHeight: "80%",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  modalDetail: {
    fontSize: 14,
    marginBottom: 6,
  },
  modalButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modalButtonText: {
    fontWeight: "800",
  },
});
