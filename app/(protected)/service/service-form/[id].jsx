import { AppButton, AppModal, AppText as Text, AppPressable as TouchableOpacity, FormField as SharedFormField, TextArea } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
// app/(protected)/service/service-form/[id].jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useLocalSearchParams,
  useNavigation,
  useRouter } from "expo-router";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  } from "firebase/firestore";
import { getDownloadURL,
  ref,
  uploadBytesResumable } from "firebase/storage";
import { useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { db, storage } from "../../../../firebaseConfig";
import {
  buildVehicleIdentityMirrorUpdate,
  buildVehicleOdometerMirrorUpdate,
  buildVehicleServiceDateMirrorUpdate,
  getVehicleLastService,
  getVehicleManufacturer,
  getVehicleMileage,
  getVehicleName,
  getVehicleRegistration,
} from "../../../../lib/fleetSchema";
import { useServiceCacheActions, useServiceCollectionReader } from "../../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../../lib/sync/firestoreQueue";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

const SERVICE_TYPE_OPTIONS = [
  "Full service",
  "Interim service",
  "Oil & filter change",
  "Inspection only",
  "Other",
];

const CHECK_STATUS_OPTIONS = [
  { value: "green", label: "Green", color: staticColors.hex_22c55e_740if4 },
  { value: "amber", label: "Amber", color: staticColors.hex_f59e0b_4zbh7f },
  { value: "red", label: "Red", color: staticColors.hex_ef4444_4oizhh },
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
  "Auxiliary belt & pulleys checked",
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

function parseServiceFormNumber(value) {
  const parsed = Number(String(value || "").replace(/\D/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatServiceFormNumber(value) {
  const parsed = parseServiceFormNumber(value);
  return parsed ? String(parsed).padStart(3, "0") : "";
}

async function getNextServiceFormNumberValue(readServiceCollection, currentRecordId = null) {
  const rows = await readServiceCollection("serviceRecords", { force: true });
  let max = 0;

  rows.forEach((data) => {
    if (currentRecordId && data.id === String(currentRecordId)) return;
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
  const readServiceCollection = useServiceCollectionReader();
  const { upsertServiceRow, patchServiceRow } = useServiceCacheActions();

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
        const list = await readServiceCollection("vehicles", {
          orderByField: "name",
        });
        setVehicles(list);
      } catch (err) {
        console.error("Failed to load vehicles for service form:", err);
        Alert.alert("Error", "Could not load vehicles.");
      } finally {
        setLoadingVehicles(false);
      }
    };
    loadVehicles();
  }, [readServiceCollection]);

  const filteredVehicles = useMemo(() => {
    if (!vehicleSearch.trim()) return vehicles;
    const q = vehicleSearch.toLowerCase();
    return vehicles.filter((v) => {
      const name = String(getVehicleName(v)).toLowerCase();
      const reg = String(getVehicleRegistration(v)).toLowerCase();
      const manufacturer = String(getVehicleManufacturer(v)).toLowerCase();
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
        const vehicleName = getVehicleName(selectedVehicle) || "";
        const registration = getVehicleRegistration(selectedVehicle) || "";

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

  const handleRemovePhoto = (uri) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
  };

  /* ---------------- PER-CHECK PHOTO HANDLERS ---------------- */

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
        getVehicleName(v) || editingRecord?.vehicleName || "";
      const recordRegistration =
        getVehicleRegistration(v) || editingRecord?.registration || "";

      const serviceRecordRef = isEditingRecord
        ? doc(db, "serviceRecords", String(editRecordId))
        : doc(collection(db, "serviceRecords"));
      const storageBasePath = `serviceRecords/${serviceRecordRef.id}`;
      const existingServiceFormNumberValue =
        parseServiceFormNumber(editingRecord?.serviceFormNumberValue) ||
        parseServiceFormNumber(editingRecord?.serviceFormNumber);
      const serviceFormNumberValue =
        existingServiceFormNumberValue ||
        (await getNextServiceFormNumberValue(
          readServiceCollection,
          isEditingRecord ? editRecordId : null
        ));
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
      const firestoreMutations = [];
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

        firestoreMutations.push({
          run: () => setDoc(defectRef, payload),
          mutation: {
            operation: "set",
            docPath: `defectReports/${defectRef.id}`,
            data: payload,
            options: { merge: false },
            entityType: "defectReport",
            entityId: defectRef.id,
          },
        });
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
        manufacturer: getVehicleManufacturer(v) || editingRecord?.manufacturer || "",
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

      firestoreMutations.push({
        run: () =>
          isEditingRecord
            ? updateDoc(serviceRecordRef, record)
            : setDoc(serviceRecordRef, record),
        mutation: {
          operation: isEditingRecord ? "update" : "set",
          docPath: `serviceRecords/${serviceRecordRef.id}`,
          data: record,
          options: isEditingRecord ? undefined : { merge: false },
          entityType: "serviceRecord",
          entityId: serviceRecordRef.id,
        },
      });

      const vehicleRef = doc(db, "vehicles", selectedVehicleId);
      const historyNotes = [workSummary.trim(), extraNotes.trim()]
        .filter(Boolean)
        .join(" ");
      const canonicalName = recordVehicleName;
      const canonicalReg = recordRegistration;
      const updatePayload = {
        ...buildVehicleIdentityMirrorUpdate({
          ...v,
          name: canonicalName,
          registration: canonicalReg,
          manufacturer: getVehicleManufacturer(v) || "",
        }),
        ...buildVehicleServiceDateMirrorUpdate({
          lastService: serviceDate,
          nextService: nextServiceDate,
        }),
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
      if (odoNumber && !Number.isNaN(odoNumber)) {
        Object.assign(updatePayload, buildVehicleOdometerMirrorUpdate(odoNumber));
      }

      firestoreMutations.push({
        run: () => updateDoc(vehicleRef, updatePayload),
        mutation: {
          operation: "update",
          docPath: `vehicles/${selectedVehicleId}`,
          data: updatePayload,
          entityType: "vehicle",
          entityId: selectedVehicleId,
        },
      });

      const { queued } = await runOrQueueFirestoreMutations(firestoreMutations);
      await Promise.all([
        upsertServiceRow("serviceRecords", { ...record, id: serviceRecordRef.id }),
        patchServiceRow("vehicles", selectedVehicleId, updatePayload),
      ]);

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
        queued
          ? "Saved offline"
          : isEditingRecord
          ? "Service updated"
          : "Service saved",
        queued
          ? "No internet right now. This service will upload automatically when internet returns."
          : isEditingRecord
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
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: isEditingRecord ? "Edit Service Record" : "Service Job Form",
      subtitle: isEditingRecord
        ? "Update missed details, check status, notes and photos."
        : "Record full service, check status and photos.",
      onBack: () => confirmLeave(() => router.back()),
    }}>
      {/* HEADER */}
      

      <>
        {loadingRecord && (
          <View style={styles.centerRow}>
            <ActivityIndicator size="small" color={COLORS.primaryAction} />
            <Text style={styles.emptyText}>Loading service record…</Text>
          </View>
        )}

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

        <View style={styles.flatSectionContent}>
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
                    {getVehicleName(selectedVehicle) || "Unnamed vehicle"}
                  </Text>
                  <Text
                    style={[
                      styles.vehicleReg,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {getVehicleRegistration(selectedVehicle) || "—"}
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
                  {typeof getVehicleMileage(selectedVehicle) === "number"
                    ? `${getVehicleMileage(selectedVehicle).toLocaleString("en-GB")} mi`
                    : "—"}
                </Text>
                <Text
                  style={[
                    styles.vehicleMeta,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  Last service: {formatDateForDisplay(getVehicleLastService(selectedVehicle)) || "—"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <SharedFormField
                  label="Search vehicle"
                  placeholder="Name, reg, manufacturer or model…"
                  value={vehicleSearch}
                  onChangeText={setVehicleSearch}
                />

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
                <View
                  style={{ maxHeight: 180, marginTop: t.spacing.xs }}
                  nestedScrollEnabled
                >
                  {filteredVehicles.map((v) => {
                    const name = getVehicleName(v) || "Unnamed vehicle";
                    const reg = getVehicleRegistration(v);
                    const manufacturer = getVehicleManufacturer(v);
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
                            {manufacturer || v.model
                              ? ` · ${manufacturer || ""}${
                                  manufacturer && v.model ? " " : ""
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
                </View>
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

        <View style={styles.flatSectionContent}>
          <View style={styles.fieldGroup}>
            <Text
              style={[
                styles.fieldLabel,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Service date (auto)
            </Text>
            <View
              style={[
                styles.readonlyField,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={[styles.readonlyText, { color: colors.text || COLORS.textHigh }]}>
                {serviceDate}
              </Text>
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
            <View
              style={[
                styles.readonlyField,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={[styles.readonlyText, { color: colors.text || COLORS.textHigh }]}>
                {serviceTime}
              </Text>
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
              style={[
                styles.dropdownHeader,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
              onPress={() => setServiceTypeOpen((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text style={[styles.dropdownText, { color: colors.text || COLORS.textHigh }]}>
                {serviceType}
              </Text>
              <Icon
                name={serviceTypeOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.textMuted || COLORS.textMid}
              />
            </TouchableOpacity>
            {serviceTypeOpen && (
              <View
                style={[
                  styles.dropdownList,
                  {
                    backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
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
                        { color: colors.text || COLORS.textHigh },
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
            <View
              style={[
                styles.readonlyField,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={[styles.readonlyText, { color: colors.text || COLORS.textHigh }]}>
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
          <View style={{ marginTop: t.spacing.xxs }}>
            <Text style={[styles.signatureInfo, { color: colors.textMuted || COLORS.textMid }]}>
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
              onPress={handleAddPhotoFromLibrary}
              activeOpacity={0.85}
            >
              <Icon
                name="image"
                size={18}
                color={COLORS.textHigh}
                style={{ marginRight: t.spacing.xxs }}
              />
              <Text style={styles.photoAddText}>Add from library</Text>
            </TouchableOpacity>
          </View>

          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: t.spacing.xs }}
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
                style={{ marginRight: t.spacing.xxs }}
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
            style={{ marginRight: t.spacing.xxs }}
          />
          <Text style={styles.deleteText}>Delete service form</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </>

      {/* PER-CHECK PHOTO PICKER MODAL */}
      <AppModal
        visible={photoPickerVisible}
        title="Add photo for check"
        onRequestClose={() => {
          setPhotoPickerVisible(false);
          setPhotoPickerLabel(null);
        }}
        presentation="adaptive"
        actions={
          <AppButton
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setPhotoPickerVisible(false);
              setPhotoPickerLabel(null);
            }}
          />
        }
      >
        <AppButton label="Add from library" icon="image" variant="secondary" onPress={handleAddCheckPhotoFromLibrary} />
      </AppModal>
    </PageShell>
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
  return (
    <View style={styles.fieldGroup}>
      {multiline ? (
        <TextArea label={label} placeholder={placeholder} value={value} onChangeText={onChangeText} />
      ) : (
        <SharedFormField
          label={label}
          placeholder={placeholder}
          value={value}
          onChangeText={onChangeText}
          inputProps={{ keyboardType }}
        />
      )}
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
        <TextArea
          label={`${wheel.label} wheel note`}
          value={item.note}
          onChangeText={(text) => updateWheelInspection(wheel.key, "note", text)}
          placeholder="Wheel note..."
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
  const statusOption = getCheckStatusOption(status);

  return (
    <View style={styles.wheelMetricRow}>
        <SharedFormField
          label={label}
          hint={statusOption ? `${suffix} · ${statusOption.label}` : suffix}
          value={value}
          onChangeText={onChangeText}
          placeholder="--"
          inputProps={{ keyboardType: "decimal-pad" }}
        />
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
            borderColor: staticColors.hex_f59e0b_4zbh7f,
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
                            ? staticColors.rgba_qyx9wf
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
          <Icon name="image" size={16} color={COLORS.textMid} />
        </TouchableOpacity>
      </View>

      {/* Notes for this check */}
      <TextArea
        label="Check notes"
        error={noteMissing ? "Notes are required for this status." : undefined}
        placeholder={requiresNote ? "Notes required for amber/red..." : "Notes for this check..."}
        value={note}
        onChangeText={onChangeNote}
      />

      {/* Photos for this check */}
      {photos && photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: t.spacing.xxs }}
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: t.spacing.xs,
    paddingBottom: 110,
  },
  sectionHeaderRow: {
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  flatSectionContent: {
    marginBottom: t.spacing.xs,
  },
  fieldGroup: {
    marginBottom: t.spacing.sm,
  },
  fieldLabel: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
    marginBottom: t.spacing.xxs,
  },
  input: {
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textHigh,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: t.typography.bodyLarge.fontSize,
  },
  centerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xs,
  },
  emptyText: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  vehicleRowActive: {
    backgroundColor: staticColors.rgba_mxgb69,
  },
  vehicleName: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  vehicleMetaRow: {
    marginTop: t.spacing.xs,
  },
  vehicleMeta: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  selectedVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xxs,
  },
  readonlyField: {
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  readonlyText: {
    fontSize: t.typography.body.fontSize,
    color: COLORS.textHigh,
  },
  vehicleFootprint: {
    flexDirection: "row",
    gap: t.spacing.sm,
    alignItems: "stretch",
    justifyContent: "space-between",
  },
  wheelColumn: {
    flex: 1,
    gap: t.spacing.sm,
    minWidth: 0,
  },
  vehicleBody: {
    width: 74,
    minHeight: 520,
    alignSelf: "center",
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    backgroundColor: staticColors.rgba_5ns8wh,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: t.spacing.md,
    ...Platform.select({
      ios: { display: "none" },
      android: { display: "none" },
    }),
  },
  vehicleBodyText: {
    color: COLORS.textLow,
    fontSize: t.typography.micro.fontSize,
    fontWeight: "800",
  },
  vehicleBodyLine: {
    width: 1,
    flex: 1,
    marginVertical: t.spacing.sm,
    backgroundColor: COLORS.border,
  },
  wheelCard: {
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.xs,
    ...Platform.select({
      ios: { minWidth: "100%" },
      android: { minWidth: "100%" },
    }),
  },
  wheelCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  wheelBadge: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelBadgeText: {
    color: COLORS.textHigh,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },
  wheelTitle: {
    flex: 1,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  wheelMetricRow: {
    marginTop: t.spacing.xs,
  },
  wheelMetricHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xxs,
  },
  wheelMetricLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  wheelStatusDot: {
    width: 9,
    height: 9,
    borderRadius: t.radius.sm,
  },
  wheelMetricInputWrap: {
    minHeight: 34,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
  },
  wheelMetricInput: {
    flex: 1,
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
    paddingVertical: t.spacing.xxs,
    minWidth: 0,
  },
  wheelMetricSuffix: {
    marginLeft: t.spacing.xxs,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  wheelNoteInput: {
    marginTop: t.spacing.xs,
    minHeight: 48,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
    textAlignVertical: "top",
  },
  redDefectRow: {
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: staticColors.rgba_5ns92s,
  },
  redDefectHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  redDefectIcon: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  redDefectTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
  },
  redDefectMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  defectActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  defectActionPill: {
    minHeight: 34,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: t.spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  defectActionText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  monitorReportRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: staticColors.rgba_5ns92s,
  },
  monitorReportBadge: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_f59e0b_4zbh7f,
    alignItems: "center",
    justifyContent: "center",
  },
  monitorReportBadgeText: {
    color: COLORS.textHigh,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
  },
  monitorReportTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
  },
  monitorReportDetails: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    lineHeight: t.typography.metadata.lineHeight,
  },
  checkRowWrapper: {
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  checkRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
  },
  checkIconWrap: {
    paddingRight: t.spacing.xs,
  },
  checkIconEmpty: {
    width: 30,
    height: 30,
    borderRadius: t.radius.pill,
    borderWidth: 2.5,
    borderColor: COLORS.textMid,
  },
  checkIconFilled: {
    width: 30,
    height: 30,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: t.typography.body.fontSize,
    color: COLORS.textLow,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
  },
  conditionPill: {
    minHeight: 32,
    borderRadius: t.radius.pill,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  conditionText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  conditionTextActive: {
    color: COLORS.textHigh,
  },
  naPill: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 2,
    borderColor: COLORS.lightGray,
  },
  naPillActive: {
    backgroundColor: staticColors.rgba_1tlzw3k,
    borderColor: COLORS.textMid,
  },
  naText: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textLow,
  },
  naTextActive: {
    color: COLORS.textMid,
    fontWeight: "600",
  },
  photoIconButton: {
    marginLeft: t.spacing.xxs,
    width: 30,
    height: 30,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    borderColor: COLORS.lightGray,
    alignItems: "center",
    justifyContent: "center",
  },
  checkNoteInput: {
    marginTop: t.spacing.xxs,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
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
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    justifyContent: "space-between",
  },
  dropdownText: {
    color: COLORS.textHigh,
    fontSize: t.typography.bodyLarge.fontSize,
    flex: 1,
    marginRight: t.spacing.xs,
  },
  dropdownList: {
    marginTop: t.spacing.xxs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  dropdownItemActive: {
    backgroundColor: staticColors.rgba_mxgb69,
  },
  dropdownItemText: {
    fontSize: t.typography.bodyLarge.fontSize,
    color: COLORS.textHigh,
  },
  photoButtonsRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
  },
  photoButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: t.spacing.xs,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
  },
  photoAddText: {
    color: COLORS.textHigh,
    fontWeight: "600",
    fontSize: t.typography.body.fontSize,
  },
  photoThumbWrapper: {
    marginRight: t.spacing.xs,
  },
  photoThumb: {
    width: 70,
    height: 70,
    borderRadius: t.radius.sm,
  },
  photoRemoveBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_18a7ub6,
    alignItems: "center",
    justifyContent: "center",
  },
  signatureInfo: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textMid,
  },
  submitButton: {
    marginTop: t.spacing.xs,
    backgroundColor: COLORS.primaryAction,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.md,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  submitText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: t.typography.bodyLarge.fontSize,
  },
  deleteButton: {
    marginTop: t.spacing.xs,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.sm,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
    backgroundColor: staticColors.rgba_mxga8q,
  },
  deleteText: {
    color: COLORS.textHigh,
    fontWeight: "600",
    fontSize: t.typography.body.fontSize,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: staticColors.rgba_11xlylh,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: staticColors.hex_111111_a7aqp2,
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.xl,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  modalTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.xs,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  modalOptionText: {
    fontSize: t.typography.body.fontSize,
    color: COLORS.textHigh,
  },
});
