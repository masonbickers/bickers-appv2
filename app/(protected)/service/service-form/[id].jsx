// app/(protected)/service/service-form/[id].jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db, storage } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  recceAction: "#ED1C25",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

const SERVICE_TYPE_OPTIONS = [
  "Full service",
  "Interim service",
  "Oil & filter change",
  "Inspection only",
  "Other",
];

const CHECK_STATUS_OPTIONS = [
  { value: "green", label: "Green", color: "#22C55E" },
  { value: "amber", label: "Amber", color: "#F59E0B" },
  { value: "red", label: "Red", color: "#EF4444" },
];

const NOTE_REQUIRED_STATUSES = new Set(["amber", "red"]);

const DEFECT_ACTION_OPTIONS = [
  { value: "repaired", label: "Repaired" },
  { value: "replaced", label: "Replaced" },
  { value: "not_repaired", label: "Not repaired" },
];

const WHEEL_POSITIONS = [
  { key: "frontLeft", label: "Front left", shortLabel: "FL" },
  { key: "frontRight", label: "Front right", shortLabel: "FR" },
  { key: "rearLeft", label: "Rear left", shortLabel: "RL" },
  { key: "rearRight", label: "Rear right", shortLabel: "RR" },
];

const EMPTY_WHEEL_INSPECTION = WHEEL_POSITIONS.reduce((acc, wheel) => {
  acc[wheel.key] = { tread: "", pressure: "", brakeWear: "", note: "" };
  return acc;
}, {});

/* ------------------------------------------------------------------ */
/*  FULL SERVICE CHECKLIST                                            */
/* ------------------------------------------------------------------ */

const CHECK_ENGINE_FLUIDS = [
  "Engine oil & filter replaced",
  "Air filter checked / replaced",
  "Coolant level & condition checked",
  "Brake fluid level & condition checked",
  "Fuel filter checked / replaced (if applicable)",
  "Cabin / pollen filter checked / replaced",
  "Power steering / PAS fluid checked (if fitted)",
  "Washer fluid topped up",
];

const CHECK_SAFETY_CHASSIS = [
  "Brake system checked for leaks / damage",
  "Tyres checked for visible damage / sidewall condition",
  "Wheel bearings checked for play / noise",
  "Steering joints & rack inspected",
  "Suspension arms, bushes & shocks inspected",
];

const CHECK_ELECTRICAL_TEST = [
  "All exterior lights & indicators checked",
  "Brake lights & reverse lights checked",
  "Horn, wipers & washers checked",
  "Battery condition / terminals checked",
  "Road test completed",
  "Dashboard warning lights confirmed off after service",
];

/* ---------------- DATE HELPERS ---------------- */

function getNowParts() {
  const d = new Date();
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return {
    date: formatDateForDisplay(d), // DD/MM/YYYY
    time: `${hh}:${min}`, // HH:MM
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDateForDisplay(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
  }

  const str = String(value).trim();
  if (!str) return "";

  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${pad(dd)}/${pad(mm)}/${yyyy}`;
  }

  const ukMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ukMatch) {
    const [, dd, mm, yyyy] = ukMatch;
    return `${pad(dd)}/${pad(mm)}/${yyyy}`;
  }

  return str;
}

function parseDisplayDate(dateStr) {
  if (!dateStr) return null;

  const str = String(dateStr).trim();
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const ukMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ukMatch) {
    const [, dd, mm, yyyy] = ukMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeNextServiceFromDate(dateStr) {
  if (!dateStr) return "";
  const d = parseDisplayDate(dateStr);
  if (!d) return "";
  if (Number.isNaN(d.getTime())) return "";
  const next = new Date(d);
  next.setFullYear(next.getFullYear() + 1);
  return formatDateForDisplay(next);
}

function splitServiceDateTime(record) {
  if (record?.serviceDateOnly) {
    return {
      date: formatDateForDisplay(record.serviceDateOnly),
      time: record.serviceTime || "00:00",
    };
  }

  const serviceDate = typeof record?.serviceDate === "string" ? record.serviceDate : "";
  const [datePart, timePart] = serviceDate.split(" ");
  return {
    date: formatDateForDisplay(datePart) || "",
    time: timePart || record?.serviceTime || "00:00",
  };
}

function normalizeCheckStatus(value) {
  if (typeof value === "string") {
    const status = value.trim().toLowerCase();
    if (status === "green" || status === "amber" || status === "red") return status;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 4) return "green";
    if (value >= 2) return "amber";
    return "red";
  }

  return "";
}

function getCheckStatusOption(value) {
  const status = normalizeCheckStatus(value);
  return CHECK_STATUS_OPTIONS.find((option) => option.value === status) || null;
}

function normalizeWheelInspection(value) {
  return WHEEL_POSITIONS.reduce((acc, wheel) => {
    const source = value?.[wheel.key] || {};
    acc[wheel.key] = {
      tread: source.tread !== undefined && source.tread !== null ? String(source.tread) : "",
      pressure:
        source.pressure !== undefined && source.pressure !== null ? String(source.pressure) : "",
      brakeWear:
        source.brakeWear !== undefined && source.brakeWear !== null
          ? String(source.brakeWear)
          : "",
      note: source.note !== undefined && source.note !== null ? String(source.note) : "",
    };
    return acc;
  }, {});
}

function hasWheelInspectionData(value) {
  return WHEEL_POSITIONS.some((wheel) => {
    const item = value?.[wheel.key] || {};
    return ["tread", "pressure", "brakeWear", "note"].some((field) =>
      String(item[field] || "").trim()
    );
  });
}

function parseMetricNumber(value) {
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTreadStatus(value) {
  const tread = parseMetricNumber(value);
  if (tread === null) return "";
  if (tread >= 4) return "green";
  if (tread >= 2) return "amber";
  return "red";
}

function getBrakeWearStatus(value) {
  const wear = parseMetricNumber(value);
  if (wear === null) return "";
  if (wear < 60) return "green";
  if (wear < 80) return "amber";
  return "red";
}

function buildRedWheelDefects(wheelInspection) {
  const data = normalizeWheelInspection(wheelInspection);
  return WHEEL_POSITIONS.flatMap((wheel) => {
    const item = data[wheel.key] || {};
    const treadValue = String(item.tread || "").trim();
    const brakeWearValue = String(item.brakeWear || "").trim();
    const defects = [];

    if (treadValue && getTreadStatus(treadValue) === "red") {
      defects.push({
        key: `${wheel.key}:tread`,
        wheelKey: wheel.key,
        wheelLabel: wheel.label,
        metric: "tread",
        title: `${wheel.label} tyre tread red`,
        value: treadValue,
        unit: "mm",
        description: `${wheel.label} tyre tread is ${treadValue}mm.`,
      });
    }

    if (brakeWearValue && getBrakeWearStatus(brakeWearValue) === "red") {
      defects.push({
        key: `${wheel.key}:brakeWear`,
        wheelKey: wheel.key,
        wheelLabel: wheel.label,
        metric: "brakeWear",
        title: `${wheel.label} brake wear red`,
        value: brakeWearValue,
        unit: "%",
        description: `${wheel.label} brake wear is ${brakeWearValue}%.`,
      });
    }

    return defects;
  });
}

function buildRedChecklistDefects(checkRatings = {}, checkNotes = {}) {
  return Object.entries(checkRatings)
    .filter(([, value]) => normalizeCheckStatus(value) === "red")
    .map(([label]) => ({
      key: `check:${label}`,
      metric: "checklist",
      title: `${label} red`,
      value: "Red",
      unit: "",
      description: checkNotes[label]
        ? `${label}: ${checkNotes[label]}`
        : `${label} was marked red on the service checklist.`,
    }));
}

function buildAmberWheelMonitorItems(wheelInspection) {
  const data = normalizeWheelInspection(wheelInspection);
  return WHEEL_POSITIONS.flatMap((wheel) => {
    const item = data[wheel.key] || {};
    const monitorItems = [];

    if (getTreadStatus(item.tread) === "amber") {
      monitorItems.push({
        key: `${wheel.key}:tread`,
        source: "wheel",
        title: `${wheel.label} tyre tread monitor`,
        value: item.tread,
        unit: "mm",
        details: `${wheel.label} tyre tread is ${item.tread}mm.`,
      });
    }

    if (getBrakeWearStatus(item.brakeWear) === "amber") {
      monitorItems.push({
        key: `${wheel.key}:brakeWear`,
        source: "wheel",
        title: `${wheel.label} brake wear monitor`,
        value: item.brakeWear,
        unit: "%",
        details: `${wheel.label} brake wear is ${item.brakeWear}%.`,
      });
    }

    return monitorItems;
  });
}

function buildAmberChecklistMonitorItems(checkRatings = {}, checkNotes = {}) {
  return Object.entries(checkRatings)
    .filter(([, value]) => normalizeCheckStatus(value) === "amber")
    .map(([label]) => ({
      key: `check:${label}`,
      source: "checklist",
      title: `${label} monitor`,
      value: "Amber",
      unit: "",
      details: checkNotes[label]
        ? `${label}: ${checkNotes[label]}`
        : `${label} was marked amber on the service checklist.`,
    }));
}

function buildServiceDefectActions(redDefects, currentActions = {}) {
  return redDefects.reduce((acc, defect) => {
    const existing = currentActions?.[defect.key] || {};
    acc[defect.key] = {
      ...defect,
      action: existing.action || "",
      note: existing.note || "",
      defectReportId: existing.defectReportId || "",
    };
    return acc;
  }, {});
}

function buildVehicleServiceHistoryItem({
  completedDate,
  serviceRecordId,
  serviceFormNumber,
  notes,
  odometer,
  partsUsed,
}) {
  return {
    completedDate,
    bookingId: null,
    serviceRecordId,
    serviceFormNumber,
    provider: "",
    bookingRef: "",
    notes,
    recordedAt: new Date(),
    location: "",
    odometer,
    partsUsed,
  };
}

function isDownloadUrl(uri) {
  return typeof uri === "string" && /^https?:\/\//i.test(uri);
}

function sanitizeStorageSegment(value) {
  return String(value || "item")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

async function ensureUploadableImageUri(uri) {
  if (!uri || isDownloadUrl(uri)) return uri;

  try {
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manip?.uri || uri;
  } catch {
    return uri;
  }
}

async function uploadImageUri(uri, path) {
  if (isDownloadUrl(uri)) return uri;

  const uploadableUri = await ensureUploadableImageUri(uri);
  const response = await fetch(uploadableUri);
  const blob = await response.blob();
  const storageRef = ref(storage, path);

  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: blob.type || "image/jpeg",
    });
    task.on("state_changed", undefined, reject, resolve);
  });

  return getDownloadURL(storageRef);
}

async function uploadPhotoList(photoItems, basePath) {
  const uris = photoItems.map((p) => (typeof p === "string" ? p : p?.uri)).filter(Boolean);

  const uploaded = [];
  for (const [index, uri] of uris.entries()) {
    if (isDownloadUrl(uri)) {
      uploaded.push(uri);
      continue;
    }

    const filename = `${Date.now()}-${index}.jpg`;
    uploaded.push(await uploadImageUri(uri, `${basePath}/${filename}`));
  }

  return uploaded;
}

async function uploadCheckPhotoMap(checkPhotosMap, basePath) {
  const uploadedMap = {};

  for (const [label, photoItems] of Object.entries(checkPhotosMap)) {
    if (!Array.isArray(photoItems) || photoItems.length === 0) continue;
    const safeLabel = sanitizeStorageSegment(label);
    const uploaded = await uploadPhotoList(photoItems, `${basePath}/${safeLabel}`);
    if (uploaded.length > 0) {
      uploadedMap[label] = uploaded;
    }
  }

  return uploadedMap;
}

function addPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
}

function parseServiceFormNumber(value) {
  const parsed = Number(String(value || "").replace(/\D/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatServiceFormNumber(value) {
  const parsed = parseServiceFormNumber(value);
  return parsed ? String(parsed).padStart(3, "0") : "";
}

async function getNextServiceFormNumberValue(currentRecordId = null) {
  const snap = await getDocs(collection(db, "serviceRecords"));
  let max = 0;

  snap.docs.forEach((entry) => {
    if (currentRecordId && entry.id === String(currentRecordId)) return;
    const data = entry.data() || {};
    const parsed =
      parseServiceFormNumber(data.serviceFormNumberValue) ||
      parseServiceFormNumber(data.serviceFormNumber);
    if (parsed && parsed > max) max = parsed;
  });

  return max + 1;
}

// 🔑 MUST match book-work.jsx
const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";

export default function ServiceFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { id, recordId } = useLocalSearchParams();
  const formId = Array.isArray(id) ? id[0] : id; // ensure string
  const editRecordId = Array.isArray(recordId) ? recordId[0] : recordId;
  const isEditingRecord = !!editRecordId;
  const allowLeaveRef = useRef(false);

  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // 🔎 VEHICLE SEARCH + SELECTION
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehicleCollapsed, setVehicleCollapsed] = useState(false);

  // INITIAL DATE/TIME (AUTO, NON-EDITABLE)
  const now = getNowParts();
  const [serviceDate, setServiceDate] = useState(now.date); // read-only
  const [serviceTime, setServiceTime] = useState(now.time); // read-only

  // SERVICE FIELDS
  const [odometer, setOdometer] = useState("");
  const [serviceType, setServiceType] = useState("Full service");
  const [serviceTypeOpen, setServiceTypeOpen] = useState(false);
  const [workSummary, setWorkSummary] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  // SIGNATURE
  const [signedBy, setSignedBy] = useState("");

  // CHECKLIST STATE
  const [checks, setChecks] = useState({}); // { label: true }
  const [checkRatings, setCheckRatings] = useState({}); // { label: "green" | "amber" | "red" }
  const [checkNA, setCheckNA] = useState({}); // { label: true if N/A }
  const [checkNotes, setCheckNotes] = useState({}); // { label: "note text" }
  const [checkPhotos, setCheckPhotos] = useState({}); // { label: [{ uri }] }
  const [wheelInspection, setWheelInspection] = useState(() =>
    normalizeWheelInspection(EMPTY_WHEEL_INSPECTION)
  );
  const [serviceDefectActions, setServiceDefectActions] = useState({});

  // GLOBAL PHOTOS
  const [photos, setPhotos] = useState([]); // [{ uri }]

  // Picker for per-check photos
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);
  const [photoPickerLabel, setPhotoPickerLabel] = useState(null);

  const allChecklistLabels = useMemo(
    () => [
      ...CHECK_ENGINE_FLUIDS,
      ...CHECK_SAFETY_CHASSIS,
      ...CHECK_ELECTRICAL_TEST,
    ],
    []
  );

  /* ---------------- LOAD VEHICLES ---------------- */

  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const q = query(collection(db, "vehicles"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setVehicles(list);
      } catch (err) {
        console.error("Failed to load vehicles for service form:", err);
        Alert.alert("Error", "Could not load vehicles.");
      } finally {
        setLoadingVehicles(false);
      }
    };
    loadVehicles();
  }, []);

  const filteredVehicles = useMemo(() => {
    if (!vehicleSearch.trim()) return vehicles;
    const q = vehicleSearch.toLowerCase();
    return vehicles.filter((v) => {
      const name = (v.name || v.vehicleName || "").toLowerCase();
      const reg = (v.registration || v.reg || "").toLowerCase();
      const manufacturer = (v.manufacturer || "").toLowerCase();
      const model = (v.model || "").toLowerCase();
      return (
        name.includes(q) ||
        reg.includes(q) ||
        manufacturer.includes(q) ||
        model.includes(q)
      );
    });
  }, [vehicles, vehicleSearch]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) || null,
    [vehicles, selectedVehicleId]
  );

  const redWheelDefects = useMemo(
    () => buildRedWheelDefects(wheelInspection),
    [wheelInspection]
  );

  const redChecklistDefects = useMemo(
    () => buildRedChecklistDefects(checkRatings, checkNotes),
    [checkNotes, checkRatings]
  );

  const redServiceDefects = useMemo(
    () => [...redWheelDefects, ...redChecklistDefects],
    [redChecklistDefects, redWheelDefects]
  );

  const monitorReport = useMemo(
    () => [
      ...buildAmberWheelMonitorItems(wheelInspection),
      ...buildAmberChecklistMonitorItems(checkRatings, checkNotes),
    ],
    [checkNotes, checkRatings, wheelInspection]
  );

  const activeServiceDefectActions = useMemo(
    () => buildServiceDefectActions(redServiceDefects, serviceDefectActions),
    [redServiceDefects, serviceDefectActions]
  );

  const hasUnsavedChanges = useMemo(
    () =>
      !!selectedVehicleId ||
      !!vehicleSearch.trim() ||
      !!odometer.trim() ||
      serviceType !== "Full service" ||
      !!workSummary.trim() ||
      !!partsUsed.trim() ||
      !!extraNotes.trim() ||
      !!signedBy.trim() ||
      Object.keys(checks || {}).length > 0 ||
      Object.keys(checkRatings || {}).length > 0 ||
      Object.keys(checkNA || {}).length > 0 ||
      Object.values(checkNotes || {}).some((value) => String(value || "").trim()) ||
      Object.values(checkPhotos || {}).some(
        (items) => Array.isArray(items) && items.length > 0
      ) ||
      hasWheelInspectionData(wheelInspection) ||
      Object.values(serviceDefectActions || {}).some((item) => item?.action || item?.note) ||
      photos.length > 0,
    [
      checkNA,
      checkNotes,
      checkPhotos,
      checkRatings,
      checks,
      extraNotes,
      odometer,
      partsUsed,
      photos.length,
      selectedVehicleId,
      serviceDefectActions,
      serviceType,
      signedBy,
      vehicleSearch,
      wheelInspection,
      workSummary,
    ]
  );

  const confirmLeave = (onLeave) => {
    if (!hasUnsavedChanges || allowLeaveRef.current) {
      onLeave();
      return;
    }

    Alert.alert(
      "Leave service form?",
      "Your progress has been saved as a draft. You can continue it from Workshop Forms.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            allowLeaveRef.current = true;
            onLeave();
          },
        },
      ]
    );
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!hasUnsavedChanges || allowLeaveRef.current) return;

      event.preventDefault();
      Alert.alert(
        "Leave service form?",
        "Your progress has been saved as a draft. You can continue it from Workshop Forms.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              allowLeaveRef.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [hasUnsavedChanges, navigation]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges || allowLeaveRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const nextServiceComputed = useMemo(
    () => computeNextServiceFromDate(serviceDate),
    [serviceDate]
  );

  /* ---------------- LOAD DRAFT FOR THIS FORM ID ---------------- */

  useEffect(() => {
    const loadDraft = async () => {
      if (isEditingRecord) return;
      if (!formId) return;
      try {
        const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
        if (!raw) return;

        const allDrafts = JSON.parse(raw) || {};
        const draft = allDrafts[formId];
        if (!draft) return;

        if (draft.selectedVehicleId) {
          setSelectedVehicleId(draft.selectedVehicleId);
          setVehicleCollapsed(true);
        }
        if (draft.vehicleSearch) setVehicleSearch(draft.vehicleSearch);
        if (draft.serviceDate) setServiceDate(formatDateForDisplay(draft.serviceDate));
        if (draft.serviceTime) setServiceTime(draft.serviceTime);
        if (draft.odometer) setOdometer(String(draft.odometer));
        if (draft.serviceType) setServiceType(draft.serviceType);
        if (draft.workSummary) setWorkSummary(draft.workSummary);
        if (draft.partsUsed) setPartsUsed(draft.partsUsed);
        if (draft.extraNotes) setExtraNotes(draft.extraNotes);
        if (draft.signedBy) setSignedBy(draft.signedBy);
        if (draft.checks) setChecks(draft.checks);
        if (draft.checkRatings) setCheckRatings(draft.checkRatings);
        if (draft.checkNA) setCheckNA(draft.checkNA);
        if (draft.checkNotes) setCheckNotes(draft.checkNotes);
        setWheelInspection(normalizeWheelInspection(draft.wheelInspection));
        setServiceDefectActions(draft.serviceDefectActions || {});

        if (draft.checkPhotoURIs && typeof draft.checkPhotoURIs === "object") {
          const built = {};
          Object.entries(draft.checkPhotoURIs).forEach(([label, uris]) => {
            if (Array.isArray(uris)) {
              built[label] = uris.map((uri) => ({ uri }));
            }
          });
          setCheckPhotos(built);
        }

        if (Array.isArray(draft.photoURIs)) {
          setPhotos(draft.photoURIs.map((uri) => ({ uri })));
        }
      } catch (err) {
        console.error("Failed to load service draft:", err);
      }
    };

    loadDraft();
  }, [formId, isEditingRecord]);

  /* ---------------- LOAD EXISTING RECORD FOR EDIT ---------------- */

  useEffect(() => {
    const loadRecordForEdit = async () => {
      if (!editRecordId) return;

      setLoadingRecord(true);
      try {
        const ref = doc(db, "serviceRecords", String(editRecordId));
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          Alert.alert("Not found", "Could not find this service record.");
          router.back();
          return;
        }

        const record = snap.data();
        setEditingRecord({ id: snap.id, ...record });
        const { date, time } = splitServiceDateTime(record);

        setSelectedVehicleId(record.vehicleId || null);
        setVehicleCollapsed(!!record.vehicleId);
        setVehicleSearch(record.vehicleName || record.registration || "");
        if (date) setServiceDate(date);
        if (time) setServiceTime(time);
        if (record.odometer !== undefined && record.odometer !== null) {
          setOdometer(String(record.odometer));
        }
        if (record.serviceType) setServiceType(record.serviceType);
        setWorkSummary(record.workSummary || "");
        setPartsUsed(record.partsUsed || "");
        setExtraNotes(record.extraNotes || "");
        setSignedBy(record.signedBy || "");
        setChecks(record.checks || {});
        setCheckRatings(record.checkRatings || {});
        setCheckNA(record.checkNA || {});
        setCheckNotes(record.checkNotes || {});
        setWheelInspection(normalizeWheelInspection(record.wheelInspection));
        setServiceDefectActions(record.serviceDefectActions || {});

        const builtCheckPhotos = {};
        Object.entries(record.checkPhotoURIs || record.checkPhotoURLs || {}).forEach(
          ([label, uris]) => {
            if (Array.isArray(uris)) {
              builtCheckPhotos[label] = uris.map((uri) => ({ uri }));
            }
          }
        );
        setCheckPhotos(builtCheckPhotos);

        const existingPhotos = record.photoURIs || record.photoURLs || [];
        if (Array.isArray(existingPhotos)) {
          setPhotos(existingPhotos.map((uri) => ({ uri })));
        }
      } catch (err) {
        console.error("Failed to load service record for edit:", err);
        Alert.alert("Error", "Could not load this service record for editing.");
      } finally {
        setLoadingRecord(false);
      }
    };

    loadRecordForEdit();
  }, [editRecordId, router]);

  /* ---------------- AUTO-SAVE DRAFT LOCALLY (MULTI) ---------------- */

  useEffect(() => {
    const saveDraft = async () => {
      if (isEditingRecord) return;
      if (!formId) return;

      try {
        const vehicleName =
          selectedVehicle?.name || selectedVehicle?.vehicleName || "";
        const registration =
          selectedVehicle?.registration || selectedVehicle?.reg || "";

        const hasCheckPhotos = Object.values(checkPhotos).some(
          (arr) => Array.isArray(arr) && arr.length > 0
        );

        const hasAnyContent =
          selectedVehicleId ||
          odometer ||
          workSummary ||
          partsUsed ||
          extraNotes ||
          signedBy ||
          Object.keys(checks).length > 0 ||
          Object.keys(checkRatings).length > 0 ||
          Object.keys(checkNA).length > 0 ||
          Object.keys(checkNotes).length > 0 ||
          hasWheelInspectionData(wheelInspection) ||
          Object.keys(serviceDefectActions).length > 0 ||
          photos.length > 0 ||
          hasCheckPhotos;

        const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
        const allDrafts = raw ? JSON.parse(raw) || {} : {};

        if (!hasAnyContent) {
          // remove this draft if empty
          if (allDrafts[formId]) {
            delete allDrafts[formId];
            if (Object.keys(allDrafts).length === 0) {
              await AsyncStorage.removeItem(SERVICE_DRAFTS_KEY);
            } else {
              await AsyncStorage.setItem(
                SERVICE_DRAFTS_KEY,
                JSON.stringify(allDrafts)
              );
            }
          }
          return;
        }

        const checkPhotoURIs = {};
        Object.entries(checkPhotos).forEach(([label, arr]) => {
          if (Array.isArray(arr) && arr.length > 0) {
            checkPhotoURIs[label] = arr.map((p) => p.uri);
          }
        });

        const draftToSave = {
          selectedVehicleId,
          vehicleName,
          registration,
          vehicleSearch,
          odometer,
          serviceType,
          serviceDate,
          serviceTime,
          workSummary,
          partsUsed,
          extraNotes,
          signedBy,
          checks,
          checkRatings,
          checkNA,
          checkNotes,
          wheelInspection,
          serviceDefectActions: activeServiceDefectActions,
          monitorReport,
          checkPhotoURIs,
          photoURIs: photos.map((p) => p.uri),
        };

        allDrafts[formId] = draftToSave;
        await AsyncStorage.setItem(
          SERVICE_DRAFTS_KEY,
          JSON.stringify(allDrafts)
        );
      } catch (err) {
        console.error("Failed to save service draft:", err);
      }
    };

    saveDraft();
  }, [
    formId,
    isEditingRecord,
    selectedVehicleId,
    selectedVehicle,
    vehicleSearch,
    odometer,
    serviceType,
    serviceDate,
    serviceTime,
    serviceDefectActions,
    monitorReport,
    workSummary,
    partsUsed,
    extraNotes,
    signedBy,
    checks,
    checkRatings,
    checkNA,
    checkNotes,
    wheelInspection,
    activeServiceDefectActions,
    checkPhotos,
    photos,
  ]);

  /* ---------------- HELPERS ---------------- */

  const toggleCheck = (label) => {
    setCheckNA((prev) => ({ ...prev, [label]: false }));
    setChecks((prev) => {
      const nextChecked = !prev[label];
      if (nextChecked) {
        setCheckRatings((prevRatings) => ({
          ...prevRatings,
          [label]: normalizeCheckStatus(prevRatings[label]) || "green",
        }));
      } else {
        setCheckRatings((prevRatings) => {
          const { [label]: _omit, ...rest } = prevRatings;
          return rest;
        });
      }

      return {
        ...prev,
        [label]: nextChecked,
      };
    });
  };

  const toggleNA = (label) => {
    setCheckNA((prev) => {
      const newVal = !prev[label];

      if (newVal) {
        setChecks((prevChecks) => ({
          ...prevChecks,
          [label]: false,
        }));
        setCheckRatings((prevRatings) => {
          const { [label]: _omit, ...rest } = prevRatings;
          return rest;
        });
      }

      return {
        ...prev,
        [label]: newVal,
      };
    });
  };

  const updateRating = (label, value) => {
    setCheckNA((prev) => ({ ...prev, [label]: false }));
    setCheckRatings((prev) => ({
      ...prev,
      [label]: normalizeCheckStatus(value) || "green",
    }));
    setChecks((prev) => ({
      ...prev,
      [label]: true,
    }));
  };

  const updateNote = (label, text) => {
    setCheckNotes((prev) => ({
      ...prev,
      [label]: text,
    }));
  };

  const updateWheelInspection = (wheelKey, field, value) => {
    setWheelInspection((prev) => ({
      ...normalizeWheelInspection(prev),
      [wheelKey]: {
        ...normalizeWheelInspection(prev)[wheelKey],
        [field]: value,
      },
    }));
  };

  const updateServiceDefectAction = (defectKey, action) => {
    setServiceDefectActions((prev) => ({
      ...prev,
      [defectKey]: {
        ...(activeServiceDefectActions[defectKey] || {}),
        action,
      },
    }));
  };

  const openPhotoPickerForLabel = (label) => {
    setPhotoPickerLabel(label);
    setPhotoPickerVisible(true);
  };

  const handleRemoveCheckPhoto = (label, uri) => {
    setCheckPhotos((prev) => {
      const existing = prev[label] || [];
      const nextArr = existing.filter((p) => p.uri !== uri);
      const next = { ...prev, [label]: nextArr };
      if (nextArr.length === 0) {
        delete next[label];
      }
      return next;
    });
  };

  const handleSelectVehicle = (id) => {
    setSelectedVehicleId(id);
    setVehicleCollapsed(true);
  };

  const validate = () => {
    if (!selectedVehicleId) {
      Alert.alert("Select vehicle", "Please choose a vehicle for this service.");
      return false;
    }
    if (!serviceDate.trim()) {
      Alert.alert("Service date", "Service date is missing.");
      return false;
    }
    if (!odometer.trim()) {
      Alert.alert("Odometer", "Please enter the vehicle mileage.");
      return false;
    }
    if (!signedBy.trim()) {
      Alert.alert(
        "Signature",
        "Please enter the technician name/signature before saving."
      );
      return false;
    }

    for (const label of allChecklistLabels) {
      if (checkNA[label]) continue;
      const status = normalizeCheckStatus(checkRatings[label]);
      const completed = checks[label] || !!status;
      if (!completed) {
        Alert.alert(
          "Checklist incomplete",
          `Please complete or mark N/A: "${label}".`
        );
        return false;
      }

      if (NOTE_REQUIRED_STATUSES.has(status) && !String(checkNotes[label] || "").trim()) {
        Alert.alert(
          "Notes required",
          `Please add notes for the ${status} check: "${label}".`
        );
        return false;
      }
    }

    for (const defect of redServiceDefects) {
      const action = activeServiceDefectActions[defect.key]?.action || "";
      if (!action) {
        Alert.alert(
          "Defect action required",
          `Please mark "${defect.title}" as repaired, replaced or not repaired.`
        );
        return false;
      }
    }

    return true;
  };

  /* ---------------- GLOBAL PHOTOS ---------------- */

  const handleAddPhotoFromLibrary = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to attach images."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setPhotos((prev) => [...prev, { uri: asset.uri }]);
    } catch (err) {
      console.error("Failed to pick image:", err);
      Alert.alert("Error", "Could not open photo library.");
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } =
        await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your camera to take photos."
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setPhotos((prev) => [...prev, { uri: asset.uri }]);
    } catch (err) {
      console.error("Failed to take photo:", err);
      Alert.alert("Error", "Could not open camera.");
    }
  };

  const handleRemovePhoto = (uri) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
  };

  /* ---------------- PER-CHECK PHOTO HANDLERS ---------------- */

  const handleTakeCheckPhoto = async () => {
    if (!photoPickerLabel) return;
    try {
      const { status } =
        await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your camera to take photos."
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setCheckPhotos((prev) => {
        const existing = prev[photoPickerLabel] || [];
        return {
          ...prev,
          [photoPickerLabel]: [...existing, { uri: asset.uri }],
        };
      });
    } catch (err) {
      console.error("Failed to take photo for check:", err);
      Alert.alert("Error", "Could not open camera.");
    } finally {
      setPhotoPickerVisible(false);
      setPhotoPickerLabel(null);
    }
  };

  const handleAddCheckPhotoFromLibrary = async () => {
    if (!photoPickerLabel) return;
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to attach images."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setCheckPhotos((prev) => {
        const existing = prev[photoPickerLabel] || [];
        return {
          ...prev,
          [photoPickerLabel]: [...existing, { uri: asset.uri }],
        };
      });
    } catch (err) {
      console.error("Failed to pick image for check:", err);
      Alert.alert("Error", "Could not open photo library.");
    } finally {
      setPhotoPickerVisible(false);
      setPhotoPickerLabel(null);
    }
  };

  /* ---------------- DELETE DRAFT BUTTON ---------------- */

  const handleDeleteDraft = () => {
    Alert.alert(
      "Delete service form?",
      "This will delete this draft and cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (!formId) {
                allowLeaveRef.current = true;
                router.back();
                return;
              }
              const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
              if (raw) {
                const allDrafts = JSON.parse(raw) || {};
                if (allDrafts[formId]) {
                  delete allDrafts[formId];
                  if (Object.keys(allDrafts).length === 0) {
                    await AsyncStorage.removeItem(SERVICE_DRAFTS_KEY);
                  } else {
                    await AsyncStorage.setItem(
                      SERVICE_DRAFTS_KEY,
                      JSON.stringify(allDrafts)
                    );
                  }
                }
              }
            } catch (err) {
              console.error("Failed to delete service draft:", err);
              Alert.alert(
                "Error",
                "Could not delete draft. Please try again."
              );
            } finally {
              allowLeaveRef.current = true;
              router.back();
            }
          },
        },
      ]
    );
  };

  /* ---------------- SUBMIT ---------------- */

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const v = selectedVehicle;
      const odoNumber = odometer ? Number(odometer) : null;
      const nextServiceDate = nextServiceComputed || null;
      const serviceDateTime = `${serviceDate} ${serviceTime}`;
      const recordVehicleName =
        v?.name || v?.vehicleName || editingRecord?.vehicleName || "";
      const recordRegistration =
        v?.registration || v?.reg || editingRecord?.registration || "";

      const serviceRecordRef = isEditingRecord
        ? doc(db, "serviceRecords", String(editRecordId))
        : doc(collection(db, "serviceRecords"));
      const storageBasePath = `serviceRecords/${serviceRecordRef.id}`;
      const existingServiceFormNumberValue =
        parseServiceFormNumber(editingRecord?.serviceFormNumberValue) ||
        parseServiceFormNumber(editingRecord?.serviceFormNumber);
      const serviceFormNumberValue =
        existingServiceFormNumberValue ||
        (await getNextServiceFormNumberValue(isEditingRecord ? editRecordId : null));
      const serviceFormNumber = formatServiceFormNumber(serviceFormNumberValue);

      const photoURLs = await uploadPhotoList(
        photos,
        `${storageBasePath}/overall`
      );
      const checkPhotoURLs = await uploadCheckPhotoMap(
        checkPhotos,
        `${storageBasePath}/checks`
      );

      const serviceDefectActionsForRecord = { ...activeServiceDefectActions };
      const embeddedOpenDefects = [];
      for (const action of Object.values(serviceDefectActionsForRecord)) {
        if (action.action !== "not_repaired" || action.defectReportId) continue;

        const defectRef = doc(collection(db, "defectReports"));
        const description = `${action.title}. ${action.description} Marked not repaired on service form.`;
        const payload = {
          vehicleId: selectedVehicleId,
          vehicleName: recordVehicleName,
          registration: recordRegistration,
          location: "Service form",
          description,
          severity: "Immediate",
          priority: "high",
          offRoad: false,
          reportedBy: signedBy.trim(),
          notes: action.note || "",
          status: "open",
          source: "serviceForm",
          sourceRecordId: serviceRecordRef.id,
          sourceDefectKey: action.key,
          photoURIs: [],
          photoURLs: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        await setDoc(defectRef, payload);
        serviceDefectActionsForRecord[action.key] = {
          ...action,
          defectReportId: defectRef.id,
        };
        embeddedOpenDefects.push({
          description,
          severity: "Immediate",
          priority: "high",
          offRoad: false,
          reportedBy: signedBy.trim() || null,
          notes: action.note || null,
          status: "open",
          location: "Service form",
          source: "serviceForm",
          sourceRecordId: serviceRecordRef.id,
          sourceDefectKey: action.key,
          defectReportId: defectRef.id,
          photoURIs: [],
          photoURLs: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const record = {
        vehicleId: selectedVehicleId,
        vehicleName: recordVehicleName,
        registration: recordRegistration,
        manufacturer: v?.manufacturer || editingRecord?.manufacturer || "",
        model: v?.model || editingRecord?.model || "",
        serviceFormNumber,
        serviceFormNumberValue,
        serviceDate: serviceDateTime,
        serviceDateOnly: serviceDate,
        serviceTime: serviceTime,
        serviceType: serviceType.trim(),
        odometer: odoNumber,
        workSummary: workSummary.trim(),
        partsUsed: partsUsed.trim(),
        nextServiceDate,
        nextService: nextServiceDate,
        extraNotes: extraNotes.trim(),
        checks,
        checkRatings,
        checkNA,
        checkNotes,
        wheelInspection,
        monitorReport,
        serviceDefectActions: serviceDefectActionsForRecord,
        checkPhotoURIs: checkPhotoURLs,
        checkPhotoURLs,
        photoURIs: photoURLs,
        photoURLs,
        signedBy: signedBy.trim(),
        ...(isEditingRecord
          ? { updatedAt: serverTimestamp() }
          : { createdAt: serverTimestamp() }),
      };

      if (isEditingRecord) {
        await updateDoc(serviceRecordRef, record);
      } else {
        await setDoc(serviceRecordRef, record);
      }

      const vehicleRef = doc(db, "vehicles", selectedVehicleId);
      const historyNotes = [workSummary.trim(), extraNotes.trim()]
        .filter(Boolean)
        .join(" ");
      const updatePayload = {
        lastService: serviceDate,
      };
      if (!isEditingRecord) {
        updatePayload.serviceHistory = arrayUnion(
          buildVehicleServiceHistoryItem({
            completedDate: serviceDate,
            serviceRecordId: serviceRecordRef.id,
            serviceFormNumber,
            notes: historyNotes,
            odometer: odoNumber,
            partsUsed: partsUsed.trim(),
          })
        );
      }
      if (embeddedOpenDefects.length > 0) {
        updatePayload.defects = arrayUnion(...embeddedOpenDefects);
      }
      const canonicalName = recordVehicleName;
      const canonicalReg = recordRegistration;
      addPresent(updatePayload, "name", canonicalName);
      addPresent(updatePayload, "vehicleName", canonicalName);
      addPresent(updatePayload, "registration", canonicalReg);
      addPresent(updatePayload, "reg", canonicalReg);
      addPresent(updatePayload, "manufacturer", v?.manufacturer || "");
      addPresent(updatePayload, "model", v?.model || "");
      addPresent(updatePayload, "category", v?.category || "");
      if (nextServiceDate) {
        updatePayload.nextService = nextServiceDate;
      }
      if (odoNumber && !Number.isNaN(odoNumber)) {
        updatePayload.mileage = odoNumber;
      }

      await updateDoc(vehicleRef, updatePayload);

      // 🔥 clear just this draft now it’s finished
      try {
        const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
        if (raw) {
          const allDrafts = JSON.parse(raw) || {};
          if (allDrafts[formId]) {
            delete allDrafts[formId];
            if (Object.keys(allDrafts).length === 0) {
              await AsyncStorage.removeItem(SERVICE_DRAFTS_KEY);
            } else {
              await AsyncStorage.setItem(
                SERVICE_DRAFTS_KEY,
                JSON.stringify(allDrafts)
              );
            }
          }
        }
      } catch (e) {
        console.error("Failed to remove draft after submit:", e);
      }

      Alert.alert(
        isEditingRecord ? "Service updated" : "Service saved",
        isEditingRecord
          ? "Service record updated."
          : "Service record saved and vehicle updated.",
        [
          {
            text: "OK",
            onPress: () => {
              allowLeaveRef.current = true;
              router.back();
            },
          },
        ]
      );
    } catch (err) {
      console.error("Failed to save service record:", err);
      Alert.alert("Error", "Could not save service record. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- RENDER ---------------- */

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => confirmLeave(() => router.back())}
          style={styles.backButton}
        >
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.pageTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            {isEditingRecord ? "Edit Service Record" : "Service Job Form"}
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            {isEditingRecord
              ? "Update missed details, check status, notes and photos."
              : "Record full service, check status and photos."}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loadingRecord && (
          <View style={styles.centerRow}>
            <ActivityIndicator size="small" color={COLORS.primaryAction} />
            <Text style={styles.emptyText}>Loading service record…</Text>
          </View>
        )}

        {/* CONTEXT CARD */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderLeftColor: COLORS.primaryAction,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <Text
            style={[
              styles.infoTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Full service checklist
          </Text>
          <Text
            style={[
              styles.infoSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Mark every item green, amber, red or N/A. Amber and red checks
            require notes. Date/time taken automatically; next service set 12
            months ahead.
          </Text>
        </View>

        {/* VEHICLE SECTION */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Vehicle
          </Text>
          {vehicleCollapsed && selectedVehicle ? (
            <TouchableOpacity
              onPress={() => setVehicleCollapsed(false)}
              activeOpacity={0.8}
            >
              <Text
                style={[styles.sectionHint, { color: COLORS.primaryAction }]}
              >
                Change
              </Text>
            </TouchableOpacity>
          ) : loadingVehicles ? (
            <Text
              style={[
                styles.sectionHint,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Loading fleet…
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          {vehicleCollapsed && selectedVehicle ? (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Selected vehicle
              </Text>
              <View style={styles.selectedVehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.vehicleName,
                      { color: colors.text || COLORS.textHigh },
                    ]}
                  >
                    {selectedVehicle.name ||
                      selectedVehicle.vehicleName ||
                      "Unnamed vehicle"}
                  </Text>
                  <Text
                    style={[
                      styles.vehicleReg,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {selectedVehicle.registration || selectedVehicle.reg || "—"}
                  </Text>
                </View>
              </View>
              <View style={styles.vehicleMetaRow}>
                <Text
                  style={[
                    styles.vehicleMeta,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  Current mileage:{" "}
                  {typeof selectedVehicle.mileage === "number"
                    ? `${selectedVehicle.mileage.toLocaleString("en-GB")} mi`
                    : "—"}
                </Text>
                <Text
                  style={[
                    styles.vehicleMeta,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  Last service: {formatDateForDisplay(selectedVehicle.lastService) || "—"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Search vehicle
              </Text>
              <View style={styles.searchBox}>
                <Icon
                  name="search"
                  size={18}
                  color={COLORS.textMid}
                  style={{ marginRight: 6 }}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Name, reg, manufacturer or model…"
                  placeholderTextColor={COLORS.textLow}
                  value={vehicleSearch}
                  onChangeText={setVehicleSearch}
                />
              </View>

              {loadingVehicles ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator size="small" color={COLORS.primaryAction} />
                </View>
              ) : filteredVehicles.length === 0 ? (
                <View style={styles.centerRow}>
                  <Text style={styles.emptyText}>
                    No vehicles match this search.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={{ maxHeight: 180, marginTop: 8 }}
                  nestedScrollEnabled
                >
                  {filteredVehicles.map((v) => {
                    const name = v.name || v.vehicleName || "Unnamed vehicle";
                    const reg = v.registration || v.reg || "";
                    const isActive = v.id === selectedVehicleId;

                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[
                          styles.vehicleRow,
                          isActive && styles.vehicleRowActive,
                        ]}
                        onPress={() => handleSelectVehicle(v.id)}
                        activeOpacity={0.85}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.vehicleName,
                              {
                                color: isActive
                                  ? COLORS.primaryAction
                                  : colors.text || COLORS.textHigh,
                              },
                            ]}
                          >
                            {name}
                          </Text>
                          <Text
                            style={[
                              styles.vehicleReg,
                              { color: colors.textMuted || COLORS.textMid },
                            ]}
                          >
                            {reg}
                            {v.manufacturer || v.model
                              ? ` · ${v.manufacturer || ""}${
                                  v.manufacturer && v.model ? " " : ""
                                }${v.model || ""}`
                              : ""}
                          </Text>
                        </View>
                        {isActive && (
                          <Icon
                            name="check-circle"
                            size={20}
                            color={COLORS.primaryAction}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}
        </View>

        {/* SERVICE DETAILS */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service details
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <View style={styles.fieldGroup}>
            <Text
              style={[
                styles.fieldLabel,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Service date (auto)
            </Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{serviceDate}</Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text
              style={[
                styles.fieldLabel,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Service time (auto)
            </Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{serviceTime}</Text>
            </View>
          </View>

          <FormField
            label="Odometer (mi)"
            placeholder="e.g. 65230"
            keyboardType="numeric"
            value={odometer}
            onChangeText={setOdometer}
          />

          <View style={styles.fieldGroup}>
            <Text
              style={[
                styles.fieldLabel,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Service type
            </Text>
            <TouchableOpacity
              style={styles.dropdownHeader}
              onPress={() => setServiceTypeOpen((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownText}>{serviceType}</Text>
              <Icon
                name={serviceTypeOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={COLORS.textMid}
              />
            </TouchableOpacity>
            {serviceTypeOpen && (
              <View style={styles.dropdownList}>
                {SERVICE_TYPE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.dropdownItem,
                      opt === serviceType && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      setServiceType(opt);
                      setServiceTypeOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        opt === serviceType && {
                          color: COLORS.primaryAction,
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={styles.fieldGroup}>
            <Text
              style={[
                styles.fieldLabel,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Next service due (auto)
            </Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>
                {nextServiceComputed ||
                  "Calculated from service date (+12 months)"}
              </Text>
            </View>
          </View>
        </View>

        <WheelFootprintSection
          wheelInspection={wheelInspection}
          updateWheelInspection={updateWheelInspection}
        />

        {/* CHECKLISTS */}
        <ChecklistSection
          title="Engine & fluids"
          hint="Mark green, amber, red or N/A. Notes required for amber/red."
          items={CHECK_ENGINE_FLUIDS}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
        />

        <ChecklistSection
          title="Safety & chassis"
          hint="Condition/security checks. Wheel measurements are recorded in the footprint."
          items={CHECK_SAFETY_CHASSIS}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
        />

        <ChecklistSection
          title="Electrical & test drive"
          hint="Mark green, amber, red or N/A. Notes required for amber/red."
          items={CHECK_ELECTRICAL_TEST}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
        />

        {/* WORKSHOP NOTES */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Workshop notes
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <FormField
            label="Work carried out"
            placeholder="Describe work done, faults found, road test notes, etc."
            value={workSummary}
            onChangeText={setWorkSummary}
            multiline
          />
          <FormField
            label="Parts used"
            placeholder="Part numbers, quantities, suppliers."
            value={partsUsed}
            onChangeText={setPartsUsed}
            multiline
          />
          <FormField
            label="Extra notes (optional)"
            placeholder="Anything else useful for future jobs."
            value={extraNotes}
            onChangeText={setExtraNotes}
            multiline
          />
        </View>

        {/* SIGN-OFF */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Sign-off
          </Text>
          <Text
            style={[
              styles.sectionHint,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Required to complete service.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <FormField
            label="Technician signature (name)"
            placeholder="Type name as signature"
            value={signedBy}
            onChangeText={setSignedBy}
          />
          <View style={{ marginTop: 6 }}>
            <Text style={styles.signatureInfo}>
              By entering your name you confirm the checks above have been
              carried out to the best of your ability.
            </Text>
          </View>
        </View>

        {/* PHOTOS / ATTACHMENTS (OVERALL) */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Photos / attachments (overall)
          </Text>
          <Text
            style={[
              styles.sectionHint,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            General photos not tied to a single check.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <View style={styles.photoButtonsRow}>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={handleTakePhoto}
              activeOpacity={0.85}
            >
              <Icon
                name="camera"
                size={18}
                color={COLORS.textHigh}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.photoAddText}>Take photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoButton}
              onPress={handleAddPhotoFromLibrary}
              activeOpacity={0.85}
            >
              <Icon
                name="image"
                size={18}
                color={COLORS.textHigh}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.photoAddText}>Add from library</Text>
            </TouchableOpacity>
          </View>

          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 10 }}
            >
              {photos.map((p) => (
                <View key={p.uri} style={styles.photoThumbWrapper}>
                  <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                  <TouchableOpacity
                    style={styles.photoRemoveBadge}
                    onPress={() => handleRemovePhoto(p.uri)}
                    activeOpacity={0.7}
                  >
                    <Icon name="x" size={12} color={COLORS.textHigh} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        <MonitorReportSection monitorItems={monitorReport} />

        <RedDefectReportSection
          redDefects={redServiceDefects}
          actions={activeServiceDefectActions}
          updateAction={updateServiceDefectAction}
        />

        {/* SUBMIT */}
        <TouchableOpacity
          style={[styles.submitButton, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.9}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={COLORS.textHigh} />
          ) : (
            <>
              <Icon
                name="save"
                size={18}
                color={COLORS.textHigh}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.submitText}>
                {isEditingRecord ? "Save changes" : "Save service & update vehicle"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* DELETE BUTTON */}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteDraft}
          activeOpacity={0.9}
        >
          <Icon
            name="trash-2"
            size={18}
            color={COLORS.textHigh}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.deleteText}>Delete service form</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* PER-CHECK PHOTO PICKER MODAL */}
      <Modal
        visible={photoPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPhotoPickerVisible(false);
          setPhotoPickerLabel(null);
        }}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => {
            setPhotoPickerVisible(false);
            setPhotoPickerLabel(null);
          }}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add photo for check</Text>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={handleTakeCheckPhoto}
            >
              <Icon
                name="camera"
                size={18}
                color={COLORS.textHigh}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.modalOptionText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={handleAddCheckPhotoFromLibrary}
            >
              <Icon
                name="image"
                size={18}
                color={COLORS.textHigh}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.modalOptionText}>Add from library</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalOption, { borderTopWidth: 0, marginTop: 4 }]}
              onPress={() => {
                setPhotoPickerVisible(false);
                setPhotoPickerLabel(null);
              }}
            >
              <Text style={[styles.modalOptionText, { color: COLORS.textMid }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------------- SMALL COMPONENTS ---------------- */

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = "default",
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.fieldGroup}>
      <Text
        style={[
          styles.fieldLabel,
          { color: colors.textMuted || COLORS.textMid },
        ]}
      >
        {label}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBackground || COLORS.inputBg,
            borderColor: colors.inputBorder || COLORS.lightGray,
            color: colors.text || COLORS.textHigh,
          },
          multiline && styles.inputMultiline,
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted || COLORS.textLow}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function WheelFootprintSection({ wheelInspection, updateWheelInspection }) {
  const { colors } = useTheme();
  const wheelData = normalizeWheelInspection(wheelInspection);
  const renderWheelCard = (wheel) => {
    const item = wheelData[wheel.key] || {};

    return (
      <View
        key={wheel.key}
        style={[
          styles.wheelCard,
          {
            backgroundColor: colors.surface || COLORS.background,
            borderColor: colors.border || COLORS.border,
          },
        ]}
      >
        <View style={styles.wheelCardHeader}>
          <View style={styles.wheelBadge}>
            <Text style={styles.wheelBadgeText}>{wheel.shortLabel}</Text>
          </View>
          <Text style={[styles.wheelTitle, { color: colors.text || COLORS.textHigh }]}>
            {wheel.label}
          </Text>
        </View>

        <WheelMetricInput
          label="Tread"
          suffix="mm"
          value={item.tread}
          status={getTreadStatus(item.tread)}
          onChangeText={(text) => updateWheelInspection(wheel.key, "tread", text)}
        />
        <WheelMetricInput
          label="Pressure"
          suffix="psi"
          value={item.pressure}
          onChangeText={(text) => updateWheelInspection(wheel.key, "pressure", text)}
        />
        <WheelMetricInput
          label="Brake wear"
          suffix="%"
          value={item.brakeWear}
          status={getBrakeWearStatus(item.brakeWear)}
          onChangeText={(text) => updateWheelInspection(wheel.key, "brakeWear", text)}
        />
        <TextInput
          style={[
            styles.wheelNoteInput,
            {
              backgroundColor: colors.inputBackground || COLORS.inputBg,
              borderColor: colors.inputBorder || COLORS.lightGray,
              color: colors.text || COLORS.textHigh,
            },
          ]}
          value={item.note}
          onChangeText={(text) => updateWheelInspection(wheel.key, "note", text)}
          placeholder="Wheel note..."
          placeholderTextColor={colors.textMuted || COLORS.textLow}
          multiline
        />
      </View>
    );
  };

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          Tyres & brakes footprint
        </Text>
        <Text
          style={[
            styles.sectionHint,
            { color: colors.textMuted || COLORS.textMid },
          ]}
        >
          Record tread depth, tyre pressure and brake wear at each wheel.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceAlt || COLORS.card,
            borderColor: colors.border || COLORS.border,
          },
        ]}
      >
        <View style={styles.vehicleFootprint}>
          <View style={styles.wheelColumn}>
            {renderWheelCard(WHEEL_POSITIONS[0])}
            {renderWheelCard(WHEEL_POSITIONS[2])}
          </View>

          <View style={styles.vehicleBody}>
            <Text style={styles.vehicleBodyText}>FRONT</Text>
            <View style={styles.vehicleBodyLine} />
            <Text style={styles.vehicleBodyText}>REAR</Text>
          </View>

          <View style={styles.wheelColumn}>
            {renderWheelCard(WHEEL_POSITIONS[1])}
            {renderWheelCard(WHEEL_POSITIONS[3])}
          </View>
        </View>
      </View>
    </>
  );
}

function WheelMetricInput({ label, suffix, value, status, onChangeText }) {
  const { colors } = useTheme();
  const statusOption = getCheckStatusOption(status);

  return (
    <View style={styles.wheelMetricRow}>
      <View style={styles.wheelMetricHeader}>
        <Text style={[styles.wheelMetricLabel, { color: colors.textMuted || COLORS.textLow }]}>
          {label}
        </Text>
        {statusOption ? (
          <View style={[styles.wheelStatusDot, { backgroundColor: statusOption.color }]} />
        ) : null}
      </View>
      <View
        style={[
          styles.wheelMetricInputWrap,
          {
            backgroundColor: colors.inputBackground || COLORS.inputBg,
            borderColor: statusOption?.color || colors.inputBorder || COLORS.lightGray,
          },
        ]}
      >
        <TextInput
          style={[styles.wheelMetricInput, { color: colors.text || COLORS.textHigh }]}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="--"
          placeholderTextColor={colors.textMuted || COLORS.textLow}
        />
        <Text style={[styles.wheelMetricSuffix, { color: colors.textMuted || COLORS.textLow }]}>
          {suffix}
        </Text>
      </View>
    </View>
  );
}

function MonitorReportSection({ monitorItems }) {
  const { colors } = useTheme();
  if (!monitorItems.length) return null;

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          Monitor report
        </Text>
        <Text
          style={[
            styles.sectionHint,
            { color: colors.textMuted || COLORS.textMid },
          ]}
        >
          Amber checklist, tyre or brake items to monitor.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceAlt || COLORS.card,
            borderColor: "#F59E0B",
          },
        ]}
      >
        {monitorItems.map((item) => (
          <View key={item.key} style={styles.monitorReportRow}>
            <View style={styles.monitorReportBadge}>
              <Text style={styles.monitorReportBadgeText}>M</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.monitorReportTitle, { color: colors.text || COLORS.textHigh }]}>
                {item.title}
              </Text>
              <Text
                style={[
                  styles.monitorReportDetails,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                {item.details}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function RedDefectReportSection({ redDefects, actions, updateAction }) {
  const { colors } = useTheme();
  if (!redDefects.length) return null;
  const hasWheelDefects = redDefects.some((item) => item.metric === "tread" || item.metric === "brakeWear");

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          Defect report
        </Text>
        <Text
          style={[
            styles.sectionHint,
            { color: colors.textMuted || COLORS.textMid },
          ]}
        >
          {hasWheelDefects
            ? "Red checklist, tyre or brake items must be marked before saving."
            : "Red checklist items must be marked before saving."}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceAlt || COLORS.card,
            borderColor: COLORS.primaryAction,
          },
        ]}
      >
        {redDefects.map((defect) => {
          const selectedAction = actions?.[defect.key]?.action || "";

          return (
            <View key={defect.key} style={styles.redDefectRow}>
              <View style={styles.redDefectHeader}>
                <View style={styles.redDefectIcon}>
                  <Icon name="alert-triangle" size={15} color={COLORS.textHigh} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.redDefectTitle, { color: colors.text || COLORS.textHigh }]}>
                    {defect.title}
                  </Text>
                  <Text
                    style={[
                      styles.redDefectMeta,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {defect.value}
                    {defect.unit} recorded
                  </Text>
                </View>
              </View>

              <View style={styles.defectActionRow}>
                {DEFECT_ACTION_OPTIONS.map((option) => {
                  const active = selectedAction === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.defectActionPill,
                        {
                          borderColor: active ? COLORS.primaryAction : COLORS.lightGray,
                          backgroundColor: active
                            ? "rgba(237,28,37,0.16)"
                            : "transparent",
                        },
                      ]}
                      onPress={() => updateAction(defect.key, option.value)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.defectActionText,
                          {
                            color: active
                              ? COLORS.primaryAction
                              : colors.textMuted || COLORS.textLow,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

function ChecklistSection({
  title,
  hint,
  items,
  checks,
  checkNA,
  checkRatings,
  checkNotes,
  checkPhotos,
  toggleCheck,
  toggleNA,
  updateRating,
  updateNote,
  openPhotoPickerForLabel,
  removePhotoForLabel,
}) {
  const { colors } = useTheme();

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.sectionHint,
            { color: colors.textMuted || COLORS.textMid },
          ]}
        >
          {hint}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceAlt || COLORS.card,
            borderColor: colors.border || COLORS.border,
          },
        ]}
      >
        {items.map((item) => (
          <ChecklistRow
            key={item}
            label={item}
            checked={!!checks[item]}
            na={!!checkNA[item]}
            rating={normalizeCheckStatus(checkRatings[item])}
            note={checkNotes[item] || ""}
            photos={checkPhotos[item] || []}
            onToggle={() => toggleCheck(item)}
            onToggleNA={() => toggleNA(item)}
            onChangeRating={(val) => updateRating(item, val)}
            onChangeNote={(text) => updateNote(item, text)}
            onPressPhoto={() => openPhotoPickerForLabel(item)}
            onRemovePhoto={(uri) => removePhotoForLabel(item, uri)}
          />
        ))}
      </View>
    </>
  );
}

function ChecklistRow({
  label,
  checked,
  na,
  onToggle,
  onToggleNA,
  rating,
  onChangeRating,
  note,
  onChangeNote,
  photos,
  onPressPhoto,
  onRemovePhoto,
}) {
  const { colors } = useTheme();
  const selectedStatus = normalizeCheckStatus(rating);
  const selectedStatusOption = getCheckStatusOption(selectedStatus);
  const requiresNote = NOTE_REQUIRED_STATUSES.has(selectedStatus);
  const noteMissing = requiresNote && !String(note || "").trim();

  return (
    <View style={styles.checkRowWrapper}>
      {/* Left: tick + label */}
      <TouchableOpacity
        style={styles.checkRowLeft}
        onPress={onToggle}
        activeOpacity={0.8}
      >
        <View style={styles.checkIconWrap}>
          {checked ? (
            <View
              style={[
                styles.checkIconFilled,
                selectedStatusOption && { backgroundColor: selectedStatusOption.color },
              ]}
            >
              <Icon name="check" size={18} color={COLORS.textHigh} />
            </View>
          ) : (
            <View
              style={[
                styles.checkIconEmpty,
                na && { borderColor: COLORS.textLow, opacity: 0.4 },
              ]}
            />
          )}
        </View>
        <Text
          style={[
            styles.checkLabel,
            { color: colors.textMuted || COLORS.textLow },
            checked && { color: colors.text || COLORS.textHigh },
            na && { opacity: 0.5 },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>

      {/* Right: condition + N/A + photo icon */}
      <View style={styles.ratingRow}>
        {CHECK_STATUS_OPTIONS.map((option) => {
          const isActive = selectedStatus === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.conditionPill,
                { borderColor: option.color },
                isActive && {
                  backgroundColor: option.color,
                  borderColor: option.color,
                },
                na && { opacity: 0.6 },
              ]}
              onPress={() => onChangeRating(option.value)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.conditionText,
                  { color: option.color },
                  isActive && styles.conditionTextActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.naPill, na && styles.naPillActive]}
          onPress={onToggleNA}
          activeOpacity={0.7}
        >
          <Text style={[styles.naText, na && styles.naTextActive]}>N/A</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.photoIconButton}
          onPress={onPressPhoto}
          activeOpacity={0.7}
        >
          <Icon name="camera" size={16} color={COLORS.textMid} />
        </TouchableOpacity>
      </View>

      {/* Notes for this check */}
      <TextInput
        style={[
          styles.checkNoteInput,
          noteMissing && styles.checkNoteInputRequired,
          {
            backgroundColor: colors.inputBackground || COLORS.inputBg,
            borderColor: noteMissing
              ? selectedStatusOption?.color || COLORS.primaryAction
              : colors.inputBorder || COLORS.lightGray,
            color: colors.text || COLORS.textHigh,
          },
        ]}
        placeholder={requiresNote ? "Notes required for amber/red..." : "Notes for this check..."}
        placeholderTextColor={colors.textMuted || COLORS.textLow}
        value={note}
        onChangeText={onChangeNote}
        multiline
      />

      {/* Photos for this check */}
      {photos && photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 6 }}
        >
          {photos.map((p) => (
            <View key={p.uri} style={styles.photoThumbWrapper}>
              <Image source={{ uri: p.uri }} style={styles.photoThumb} />
              <TouchableOpacity
                style={styles.photoRemoveBadge}
                onPress={() => onRemovePhoto(p.uri)}
                activeOpacity={0.7}
              >
                <Icon name="x" size={12} color={COLORS.textHigh} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 8,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 14,
    color: COLORS.textMid,
  },
  sectionHeaderRow: {
    marginTop: 4,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMid,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textMid,
    marginBottom: 4,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    color: COLORS.textHigh,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: 15,
  },
  centerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  vehicleRowActive: {
    backgroundColor: "rgba(255,59,48,0.12)",
  },
  vehicleName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  vehicleMetaRow: {
    marginTop: 8,
  },
  vehicleMeta: {
    fontSize: 12,
    color: COLORS.textMid,
  },
  selectedVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  readonlyField: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  readonlyText: {
    fontSize: 14,
    color: COLORS.textMid,
  },
  vehicleFootprint: {
    flexDirection: "row",
    gap: 14,
    alignItems: "stretch",
    justifyContent: "space-between",
  },
  wheelColumn: {
    flex: 1,
    gap: 14,
    minWidth: 0,
  },
  vehicleBody: {
    width: 74,
    minHeight: 520,
    alignSelf: "center",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    ...Platform.select({
      ios: { display: "none" },
      android: { display: "none" },
    }),
  },
  vehicleBodyText: {
    color: COLORS.textLow,
    fontSize: 10,
    fontWeight: "800",
  },
  vehicleBodyLine: {
    width: 1,
    flex: 1,
    marginVertical: 12,
    backgroundColor: COLORS.border,
  },
  wheelCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    ...Platform.select({
      ios: { minWidth: "100%" },
      android: { minWidth: "100%" },
    }),
  },
  wheelCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  wheelBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelBadgeText: {
    color: COLORS.textHigh,
    fontSize: 11,
    fontWeight: "900",
  },
  wheelTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  wheelMetricRow: {
    marginTop: 7,
  },
  wheelMetricHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  wheelMetricLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  wheelStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  wheelMetricInputWrap: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  wheelMetricInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    paddingVertical: 6,
    minWidth: 0,
  },
  wheelMetricSuffix: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: "700",
  },
  wheelNoteInput: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontSize: 13,
    textAlignVertical: "top",
  },
  redDefectRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  redDefectHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  redDefectIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  redDefectTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  redDefectMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  defectActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  defectActionPill: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  defectActionText: {
    fontSize: 12,
    fontWeight: "800",
  },
  monitorReportRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  monitorReportBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F59E0B",
    alignItems: "center",
    justifyContent: "center",
  },
  monitorReportBadgeText: {
    color: COLORS.textHigh,
    fontSize: 12,
    fontWeight: "900",
  },
  monitorReportTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  monitorReportDetails: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  checkRowWrapper: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  checkRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 6,
    marginBottom: 6,
  },
  checkIconWrap: {
    paddingRight: 8,
  },
  checkIconEmpty: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2.5,
    borderColor: COLORS.textMid,
  },
  checkIconFilled: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textLow,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  conditionPill: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  conditionText: {
    fontSize: 12,
    fontWeight: "800",
  },
  conditionTextActive: {
    color: COLORS.textHigh,
  },
  naPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: COLORS.lightGray,
  },
  naPillActive: {
    backgroundColor: "rgba(142,142,147,0.2)",
    borderColor: COLORS.textMid,
  },
  naText: {
    fontSize: 13,
    color: COLORS.textLow,
  },
  naTextActive: {
    color: COLORS.textMid,
    fontWeight: "600",
  },
  photoIconButton: {
    marginLeft: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: COLORS.lightGray,
    alignItems: "center",
    justifyContent: "center",
  },
  checkNoteInput: {
    marginTop: 4,
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.textHigh,
    textAlignVertical: "top",
    minHeight: 48,
  },
  checkNoteInputRequired: {
    borderWidth: 2,
  },
  dropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "space-between",
  },
  dropdownText: {
    color: COLORS.textHigh,
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
  dropdownList: {
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    backgroundColor: COLORS.inputBg,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  dropdownItemActive: {
    backgroundColor: "rgba(255,59,48,0.12)",
  },
  dropdownItemText: {
    fontSize: 15,
    color: COLORS.textHigh,
  },
  photoButtonsRow: {
    flexDirection: "row",
    gap: 8,
  },
  photoButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingVertical: 10,
    backgroundColor: COLORS.inputBg,
  },
  photoAddText: {
    color: COLORS.textHigh,
    fontWeight: "600",
    fontSize: 14,
  },
  photoThumbWrapper: {
    marginRight: 10,
  },
  photoThumb: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },
  photoRemoveBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  signatureInfo: {
    fontSize: 11,
    color: COLORS.textMid,
  },
  submitButton: {
    marginTop: 10,
    backgroundColor: COLORS.primaryAction,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  submitText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: 15,
  },
  deleteButton: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
    backgroundColor: "rgba(255,59,48,0.08)",
  },
  deleteText: {
    color: COLORS.textHigh,
    fontWeight: "600",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#111111",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 10,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  modalOptionText: {
    fontSize: 14,
    color: COLORS.textHigh,
  },
});
