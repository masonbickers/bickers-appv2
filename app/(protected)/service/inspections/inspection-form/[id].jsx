// app/(protected)/service/inspections/inspection-form/[id].jsx
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
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

import { db, storage } from "../../../../../firebaseConfig";
import { useTheme } from "../../../../../providers/ThemeProvider";

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

const CHECK_STATUS_OPTIONS = [
  { value: "green", label: "Green", color: "#22C55E" },
  { value: "amber", label: "Amber", color: "#F59E0B" },
  { value: "red",   label: "Red",   color: "#EF4444" },
];

const NOTE_REQUIRED_STATUSES = new Set(["amber", "red"]);

const OVERALL_RESULT_OPTIONS = [
  { value: "pass", label: "Pass",    color: "#22C55E" },
  { value: "fail", label: "Fail",    color: "#EF4444" },
];

/* ------------------------------------------------------------------ */
/*  CHECKLIST ITEMS                                                     */
/* ------------------------------------------------------------------ */

const CHECK_STRUCTURAL = [
  "Frame / chassis integrity – no cracks or deformation",
  "Roll cage / protection structure secure and intact",
  "Bodywork / panels – no sharp edges or loose sections",
  "All mounting points secure – no wear or fatigue cracks",
  "Labels, markings and serial numbers legible",
];

const CHECK_SAFETY = [
  "Harness / restraints – no fraying, cuts or damage",
  "Harness buckles and adjusters fully functional",
  "Fire suppression system charged and accessible",
  "Kill switch / cut-off operational and clearly marked",
  "Safety padding in place and securely fitted",
  "Safety cage / net intact (if fitted)",
];

const CHECK_MECHANICAL = [
  "Engine starts and idles correctly",
  "Throttle response smooth – no sticking or hesitation",
  "Brakes functional – adequate pedal / lever feel",
  "Steering responsive – no excessive play",
  "Transmission / gearbox shifts correctly",
  "Suspension – no unusual noise or binding",
  "All fasteners and mounting points checked and secure",
];

const CHECK_ELECTRICAL_FLUIDS = [
  "Battery charged and terminals secure",
  "Wiring – no exposed, frayed or damaged cables",
  "All switches and controls functional",
  "Engine oil level correct – no leaks",
  "Coolant level correct – no leaks",
  "Fuel sufficient for planned activity",
  "No fluid leaks visible",
];

const CHECK_TYRES = [
  "Tyre pressures correct for activity",
  "Tyre condition – no cuts, bulges or excessive wear",
  "Wheel nuts / bolts torqued and secure",
  "Wheel bearings – no play or noise",
  "Drive shafts / axles – no damage or leaks",
];

const CHECK_LIGHTS_COMMS = [
  "All lights operational (if fitted)",
  "Horn operational",
  "Radio / intercom functional (if fitted)",
  "Camera mounts and wiring secure (if fitted)",
  "Dashboard warning lights confirmed clear",
];

const CHECKLIST_SECTIONS = [
  { title: "Structural condition", source: "structural", items: CHECK_STRUCTURAL },
  { title: "Safety systems", source: "safety", items: CHECK_SAFETY },
  { title: "Mechanical systems", source: "mechanical", items: CHECK_MECHANICAL },
  { title: "Electrical & fluids", source: "electricalFluids", items: CHECK_ELECTRICAL_FLUIDS },
  { title: "Tyres & running gear", source: "tyresRunningGear", items: CHECK_TYRES },
  { title: "Lights & communications", source: "lightsComms", items: CHECK_LIGHTS_COMMS },
];

const ALL_CHECKLIST_ITEMS = CHECKLIST_SECTIONS.flatMap((section) => section.items);

/* ------------------------------------------------------------------ */
/*  HELPERS                                                             */
/* ------------------------------------------------------------------ */

function pad(n) {
  return String(n).padStart(2, "0");
}

function getNowParts() {
  const d = new Date();
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    dateISO: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function normalizeCheckStatus(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "green" || s === "amber" || s === "red") return s;
  return "";
}

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildEquipmentOptions(records) {
  return records
    .map((record) => {
      const name = String(record?.name || record?.label || "").trim();
      const serial = String(record?.serialNumber || "").trim();
      const asset = String(record?.asset || "").trim();
      if (!name) return null;

      return {
        key: record.id,
        equipmentDocId: record.id,
        name,
        equipmentId: serial || asset,
        serialNumber: serial,
        asset,
        type: record?.category || "",
        category: record?.category || "",
        status: record?.status || "",
        location: record?.location || "",
        lastInspection: record?.lastInspection || "",
        inspectionFrequency: record?.inspectionFrequency || "",
        nextInspection: record?.nextInspection || "",
        notes: record?.notes || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      normaliseKey(a.name).localeCompare(normaliseKey(b.name))
    );
}

function findChecklistSource(label) {
  const section = CHECKLIST_SECTIONS.find((item) => item.items.includes(label));
  return section?.source || "inspection";
}

function buildInspectionReportItems({ checkRatings = {}, checkNotes = {}, targetStatus }) {
  return ALL_CHECKLIST_ITEMS
    .filter((label) => normalizeCheckStatus(checkRatings[label]) === targetStatus)
    .map((label) => ({
      key: `check:${label}`,
      source: findChecklistSource(label),
      title:
        targetStatus === "red"
          ? `${label} red`
          : `${label} monitor`,
      value: targetStatus === "red" ? "Red" : "Amber",
      unit: "",
      details: checkNotes[label]
        ? `${label}: ${checkNotes[label]}`
        : `${label} was marked ${targetStatus} on the equipment inspection.`,
    }));
}

function buildEquipmentInspectionHistoryItem({
  inspectionRecordId,
  inspectionDate,
  inspectionDateISO,
  inspectionTime,
  overallResult,
  signedBy,
  defectCount,
  monitorCount,
  findings,
  recommendations,
}) {
  return {
    type: "Equipment inspection",
    inspectionRecordId,
    completedDate: inspectionDateISO || inspectionDate || "",
    inspectionDate: inspectionDate || "",
    inspectionTime: inspectionTime || "",
    overallResult: overallResult || "",
    signedBy: signedBy || "",
    defectCount,
    monitorCount,
    summary:
      findings ||
      recommendations ||
      `${overallResult === "fail" ? "Failed" : "Passed"} equipment inspection`,
  };
}

function isDownloadUrl(uri) {
  return typeof uri === "string" && /^https?:\/\//i.test(uri);
}

async function compressAndUpload(uri, path) {
  if (isDownloadUrl(uri)) return uri;
  try {
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1400 } }],
      { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG }
    );
    const response = await fetch(manip.uri);
    const blob = await response.blob();
    const storageRef = ref(storage, path);
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, blob, {
        contentType: "image/jpeg",
      });
      task.on("state_changed", undefined, reject, resolve);
    });
    return getDownloadURL(storageRef);
  } catch {
    return uri;
  }
}

async function uploadPhotoList(photos, basePath) {
  const results = [];
  for (const [i, p] of photos.entries()) {
    const uri = typeof p === "string" ? p : p?.uri;
    if (!uri) continue;
    results.push(await compressAndUpload(uri, `${basePath}/${Date.now()}-${i}.jpg`));
  }
  return results;
}

async function uploadCheckPhotoMap(checkPhotos, basePath) {
  const out = {};
  for (const [label, photos] of Object.entries(checkPhotos)) {
    if (!Array.isArray(photos) || photos.length === 0) continue;
    const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
    out[label] = await uploadPhotoList(photos, `${basePath}/${safeLabel}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                      */
/* ------------------------------------------------------------------ */

export default function InspectionFormScreen() {
  const params = useLocalSearchParams();
  const { id } = params;
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();

  const formId = Array.isArray(id) ? id[0] : id;
  const preselectEquipmentDocId = Array.isArray(params.equipmentDocId)
    ? params.equipmentDocId[0]
    : params.equipmentDocId;
  const isNew = String(formId || "").startsWith("new-");
  const docId = isNew
    ? `insp-${String(formId).replace("new-", "")}`
    : String(formId);

  const allowLeaveRef = useRef(false);
  const now = getNowParts();

  /* ---- equipment details ---- */
  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentId, setEquipmentId]     = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [equipmentDocId, setEquipmentDocId] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [asset, setAsset] = useState("");
  const [equipmentStatus, setEquipmentStatus] = useState("");
  const [lastInspection, setLastInspection] = useState("");
  const [inspectionFrequency, setInspectionFrequency] = useState("");
  const [nextInspection, setNextInspection] = useState("");
  const [location, setLocation]           = useState("");
  const [hoursOrOdo, setHoursOrOdo]       = useState("");
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [selectedEquipmentKey, setSelectedEquipmentKey] = useState(null);
  const [equipmentCollapsed, setEquipmentCollapsed] = useState(false);
  const [originalEquipmentDocId, setOriginalEquipmentDocId] = useState("");

  /* ---- inspection meta ---- */
  const [inspectionDate, setInspectionDate] = useState(now.date);
  const [inspectionDateISO, setInspectionDateISO] = useState(now.dateISO);
  const [inspectionTime, setInspectionTime] = useState(now.time);
  const [inspectedBy, setInspectedBy]     = useState("");
  const [overallResult, setOverallResult] = useState("");

  /* ---- checklist state (shared across all sections) ---- */
  const [checkRatings, setCheckRatings] = useState({});
  const [checkNA,      setCheckNA]      = useState({});
  const [checkNotes,   setCheckNotes]   = useState({});
  const [checkPhotos,  setCheckPhotos]  = useState({});

  /* ---- notes / sign-off ---- */
  const [findings,      setFindings]      = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [extraNotes,    setExtraNotes]    = useState("");
  const [signedBy,      setSignedBy]      = useState("");

  /* ---- general photos ---- */
  const [photos, setPhotos] = useState([]);

  /* ---- ui state ---- */
  const [loadingRecord, setLoadingRecord] = useState(!isNew);
  const [submitting,    setSubmitting]    = useState(false);
  const [dirty,         setDirty]         = useState(false);

  /* ---- photo picker modal ---- */
  const [photoModalLabel, setPhotoModalLabel] = useState(null);

  const defectReport = useMemo(
    () =>
      buildInspectionReportItems({
        checkRatings,
        checkNotes,
        targetStatus: "red",
      }),
    [checkNotes, checkRatings]
  );

  const monitorReport = useMemo(
    () =>
      buildInspectionReportItems({
        checkRatings,
        checkNotes,
        targetStatus: "amber",
      }),
    [checkNotes, checkRatings]
  );

  const filteredEquipment = useMemo(() => {
    if (!equipmentSearch.trim()) return equipmentOptions;
    const queryText = normaliseKey(equipmentSearch);
    return equipmentOptions.filter((item) =>
      [
        item.name,
        item.serialNumber,
        item.asset,
        item.notes,
        item.status,
        item.category,
        item.location,
      ]
        .map(normaliseKey)
        .some((value) => value.includes(queryText))
    );
  }, [equipmentOptions, equipmentSearch]);

  const selectedEquipment = useMemo(
    () => equipmentOptions.find((item) => item.key === selectedEquipmentKey) || null,
    [equipmentOptions, selectedEquipmentKey]
  );

  useEffect(() => {
    const loadEquipmentOptions = async () => {
      try {
        setLoadingEquipment(true);
        const snap = await getDocs(collection(db, "equipment"));
        setEquipmentOptions(
          buildEquipmentOptions(
            snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }))
          )
        );
      } catch (err) {
        console.error("Failed to load equipment options:", err);
      } finally {
        setLoadingEquipment(false);
      }
    };

    loadEquipmentOptions();
  }, []);

  useEffect(() => {
    if (!isNew || !preselectEquipmentDocId || equipmentOptions.length === 0) return;
    if (selectedEquipmentKey === preselectEquipmentDocId) return;
    const match = equipmentOptions.find((item) => item.equipmentDocId === preselectEquipmentDocId);
    if (!match) return;
    setSelectedEquipmentKey(match.key);
    setEquipmentDocId(match.equipmentDocId || "");
    setEquipmentName(match.name || "");
    setEquipmentId(match.equipmentId || "");
    setSerialNumber(match.serialNumber || "");
    setAsset(match.asset || "");
    setEquipmentType(match.category || match.type || "");
    setEquipmentStatus(match.status || "");
    setLocation((prev) => prev || match.location || "");
    setLastInspection(match.lastInspection || "");
    setInspectionFrequency(match.inspectionFrequency || "");
    setNextInspection(match.nextInspection || "");
    setEquipmentCollapsed(true);
    setDirty(true);
  }, [equipmentOptions, isNew, preselectEquipmentDocId, selectedEquipmentKey]);

  /* ---------------------------------------------------------------- */
  /*  Load existing record                                             */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const loadedNow = getNowParts();
        const snap = await getDoc(doc(db, "equipmentInspections", docId));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        setEquipmentName(d.equipmentName || "");
        setEquipmentId(d.equipmentId || "");
        setEquipmentType(d.equipmentType || d.category || "");
        setEquipmentDocId(d.equipmentDocId || "");
        setSerialNumber(d.serialNumber || d.equipmentId || "");
        setAsset(d.asset || "");
        setEquipmentStatus(d.equipmentStatus || d.status || "");
        setLastInspection(d.lastInspection || "");
        setInspectionFrequency(d.inspectionFrequency || "");
        setNextInspection(d.nextInspection || "");
        setSelectedEquipmentKey(d.equipmentDocId || null);
        setOriginalEquipmentDocId(d.equipmentDocId || "");
        setEquipmentCollapsed(!!(d.equipmentName || d.equipmentId));
        setLocation(d.location || "");
        setHoursOrOdo(d.hoursOrOdo || "");
        setInspectionDate(d.inspectionDate || loadedNow.date);
        setInspectionDateISO(d.inspectionDateISO || d.completedDate || loadedNow.dateISO);
        setInspectionTime(d.inspectionTime || loadedNow.time);
        setInspectedBy(d.inspectedBy || "");
        setOverallResult(d.overallResult || "");
        setCheckRatings(d.checkRatings || {});
        setCheckNA(d.checkNA || {});
        setCheckNotes(d.checkNotes || {});
        setCheckPhotos(
          Object.fromEntries(
            Object.entries(d.checkPhotos || {}).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.map((uri) => ({ uri, uploaded: true })) : [],
            ])
          )
        );
        setFindings(d.findings || "");
        setRecommendations(d.recommendations || "");
        setExtraNotes(d.extraNotes || "");
        setSignedBy(d.signedBy || "");
        setPhotos(
          (d.photoUrls || []).map((uri) => ({ uri, uploaded: true }))
        );
      } catch (e) {
        console.error("Failed to load inspection:", e);
      } finally {
        setLoadingRecord(false);
      }
    })();
  }, [docId, isNew]);

  /* ---------------------------------------------------------------- */
  /*  Dirty / leave guard                                              */
  /* ---------------------------------------------------------------- */
  function confirmLeave(action) {
    if (!dirty) { action(); return; }
    Alert.alert("Unsaved changes", "Discard changes and leave?", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: action },
    ]);
  }

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e) => {
      if (allowLeaveRef.current || !dirty) return;
      e.preventDefault();
      Alert.alert("Unsaved changes", "Discard changes and leave?", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive",
          onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsub;
  }, [navigation, dirty]);

  /* ---------------------------------------------------------------- */
  /*  Checklist handlers                                               */
  /* ---------------------------------------------------------------- */
  function updateRating(item, value) {
    if (checkNA[item]) return;
    setCheckRatings((p) => ({ ...p, [item]: value }));
    setDirty(true);
  }

  function updateNote(item, text) {
    setCheckNotes((p) => ({ ...p, [item]: text }));
    setDirty(true);
  }

  function markNA(item) {
    if (checkNA[item]) return;
    setCheckNA((p) => ({ ...p, [item]: true }));
    setCheckRatings((p) => {
      const { [item]: _omit, ...rest } = p;
      return rest;
    });
    setCheckNotes((p) => {
      const { [item]: _omit, ...rest } = p;
      return rest;
    });
    setDirty(true);
  }

  function handleSelectEquipment(item) {
    setSelectedEquipmentKey(item.key);
    setEquipmentDocId(item.equipmentDocId || "");
    setEquipmentName(item.name || "");
    setEquipmentId(item.equipmentId || "");
    setSerialNumber(item.serialNumber || "");
    setAsset(item.asset || "");
    setEquipmentType(item.category || item.type || "");
    setEquipmentStatus(item.status || "");
    setLocation((prev) => prev || item.location || "");
    setLastInspection(item.lastInspection || "");
    setInspectionFrequency(item.inspectionFrequency || "");
    setNextInspection(item.nextInspection || "");
    setEquipmentCollapsed(true);
    setDirty(true);
  }

  /* ---------------------------------------------------------------- */
  /*  Photo handlers                                                   */
  /* ---------------------------------------------------------------- */
  async function pickImage(source) {
    const fn = source === "camera"
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    const result = await fn({ mediaTypes: "images", quality: 0.85 });
    if (result.canceled) return null;
    return result.assets[0].uri;
  }

  // Per-check photos
  function openPhotoPickerForLabel(label) {
    setPhotoModalLabel(label);
  }

  async function handleCheckPhotoSource(source) {
    const label = photoModalLabel;
    setPhotoModalLabel(null);
    const uri = await pickImage(source);
    if (!uri || !label) return;
    setCheckPhotos((p) => ({
      ...p,
      [label]: [...(p[label] || []), { uri, uploaded: false }],
    }));
    setDirty(true);
  }

  function handleRemoveCheckPhoto(label, uri) {
    setCheckPhotos((p) => ({
      ...p,
      [label]: (p[label] || []).filter((ph) => ph.uri !== uri),
    }));
    setDirty(true);
  }

  // Overall photos
  async function handleTakePhoto() {
    const uri = await pickImage("camera");
    if (!uri) return;
    setPhotos((p) => [...p, { uri, uploaded: false }]);
    setDirty(true);
  }

  async function handleAddPhotoFromLibrary() {
    const uri = await pickImage("library");
    if (!uri) return;
    setPhotos((p) => [...p, { uri, uploaded: false }]);
    setDirty(true);
  }

  function handleRemovePhoto(uri) {
    setPhotos((p) => p.filter((ph) => ph.uri !== uri));
    setDirty(true);
  }

  /* ---------------------------------------------------------------- */
  /*  Submit                                                           */
  /* ---------------------------------------------------------------- */
  async function handleSubmit() {
    if (!equipmentName.trim()) {
      Alert.alert("Required", "Equipment name is required."); return;
    }
    if (!equipmentType.trim()) {
      Alert.alert("Required", "Equipment category is required."); return;
    }
    for (const label of ALL_CHECKLIST_ITEMS) {
      if (checkNA[label]) continue;
      const status = normalizeCheckStatus(checkRatings[label]);
      if (!status) {
        Alert.alert(
          "Checklist incomplete",
          `Please mark green, amber, red or N/A: "${label}".`
        );
        return;
      }
      if (NOTE_REQUIRED_STATUSES.has(status) && !String(checkNotes[label] || "").trim()) {
        Alert.alert(
          "Notes required",
          `Please add notes for the ${status} check: "${label}".`
        );
        return;
      }
    }
    if (!overallResult) {
      Alert.alert("Required", "Please choose pass or fail for the overall result."); return;
    }
    if (!signedBy.trim()) {
      Alert.alert("Required", "Inspector signature (name) is required."); return;
    }

    setSubmitting(true);
    try {
      const basePath = `equipmentInspections/${docId}`;

      const uploadedCheckPhotos = await uploadCheckPhotoMap(checkPhotos, `${basePath}/checks`);
      const uploadedPhotoUrls   = await uploadPhotoList(photos, `${basePath}/photos`);
      const matchingEquipment = equipmentOptions.find(
        (item) => normaliseKey(item.name) === normaliseKey(equipmentName)
      );
      let targetEquipmentDocId = equipmentDocId || matchingEquipment?.equipmentDocId || "";

      if (!targetEquipmentDocId) {
        const newEquipmentRef = doc(collection(db, "equipment"));
        targetEquipmentDocId = newEquipmentRef.id;
        await setDoc(newEquipmentRef, {
          name: equipmentName.trim(),
          category: equipmentType.trim(),
          status: equipmentStatus.trim() || "Available",
          serialNumber: serialNumber.trim(),
          asset: asset.trim(),
          location: location.trim(),
          lastInspection: inspectionDateISO || "",
          inspectionFrequency: inspectionFrequency.trim(),
          nextInspection: nextInspection.trim(),
          notes: extraNotes.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const payload = {
        equipmentDocId:  targetEquipmentDocId || null,
        equipmentName:   equipmentName.trim(),
        equipmentId:     serialNumber.trim() || asset.trim() || equipmentId.trim(),
        serialNumber:    serialNumber.trim(),
        asset:           asset.trim(),
        equipmentType:   equipmentType.trim(),
        category:        equipmentType.trim(),
        equipmentStatus: equipmentStatus.trim(),
        status:          equipmentStatus.trim(),
        location:        location.trim(),
        hoursOrOdo:      hoursOrOdo.trim(),
        lastInspection:  lastInspection.trim(),
        inspectionFrequency: inspectionFrequency.trim(),
        nextInspection:  nextInspection.trim(),
        inspectionDate,
        inspectionDateISO,
        inspectionTime,
        inspectedBy:     inspectedBy.trim(),
        overallResult,
        checkRatings,
        checkNA,
        checkNotes,
        checkPhotos:     uploadedCheckPhotos,
        defectReport,
        monitorReport,
        findings:        findings.trim(),
        recommendations: recommendations.trim(),
        extraNotes:      extraNotes.trim(),
        signedBy:        signedBy.trim(),
        photoUrls:       uploadedPhotoUrls,
        updatedAt:       serverTimestamp(),
      };

      if (isNew) {
        payload.createdAt = serverTimestamp();
        await setDoc(doc(db, "equipmentInspections", docId), payload);
      } else {
        await updateDoc(doc(db, "equipmentInspections", docId), payload);
      }

      const historyItem = buildEquipmentInspectionHistoryItem({
        inspectionRecordId: docId,
        inspectionDate,
        inspectionDateISO,
        inspectionTime,
        overallResult,
        signedBy: signedBy.trim(),
        defectCount: defectReport.length,
        monitorCount: monitorReport.length,
        findings: findings.trim(),
        recommendations: recommendations.trim(),
      });

      const removeInspectionFromEquipment = async (targetEquipmentDocId) => {
        if (!targetEquipmentDocId) return;
        const equipmentRef = doc(db, "equipment", targetEquipmentDocId);
        const equipmentSnap = await getDoc(equipmentRef);
        if (!equipmentSnap.exists()) return;
        const equipmentData = equipmentSnap.data() || {};
        const currentHistory = Array.isArray(equipmentData.inspectionHistory)
          ? equipmentData.inspectionHistory
          : [];
        await updateDoc(equipmentRef, {
          inspectionHistory: currentHistory.filter(
            (item) => item?.inspectionRecordId !== docId
          ),
          updatedAt: serverTimestamp(),
        });
      };

      const saveInspectionToEquipment = async (targetEquipmentDocId) => {
        if (!targetEquipmentDocId) return;
        const equipmentRef = doc(db, "equipment", targetEquipmentDocId);
        const equipmentSnap = await getDoc(equipmentRef);
        if (!equipmentSnap.exists()) return;
        const equipmentData = equipmentSnap.data() || {};
        const currentHistory = Array.isArray(equipmentData.inspectionHistory)
          ? equipmentData.inspectionHistory
          : [];
        const equipmentUpdate = {
          inspectionHistory: [
            historyItem,
            ...currentHistory.filter((item) => item?.inspectionRecordId !== docId),
          ],
          updatedAt: serverTimestamp(),
        };
        if (inspectionDateISO) equipmentUpdate.lastInspection = inspectionDateISO;
        if (inspectionFrequency.trim()) {
          equipmentUpdate.inspectionFrequency = inspectionFrequency.trim();
        }
        if (nextInspection.trim()) equipmentUpdate.nextInspection = nextInspection.trim();
        await updateDoc(equipmentRef, equipmentUpdate);
      };

      if (originalEquipmentDocId && originalEquipmentDocId !== targetEquipmentDocId) {
        await removeInspectionFromEquipment(originalEquipmentDocId);
      }
      await saveInspectionToEquipment(targetEquipmentDocId);

      allowLeaveRef.current = true;
      setDirty(false);
      Alert.alert(
        "Saved",
        isNew ? "Inspection created." : "Inspection updated.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (e) {
      console.error("Failed to save inspection:", e);
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  RENDER                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.container, { backgroundColor: colors.background || COLORS.background }]}
    >
      {/* HEADER */}
      <View style={[styles.header, { borderBottomColor: colors.border || COLORS.border }]}>
        <TouchableOpacity
          onPress={() => confirmLeave(() => router.back())}
          style={styles.backButton}
        >
          <Icon name="chevron-left" size={22} color={colors.text || COLORS.textHigh} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}>
            {isNew ? "Equipment Inspection" : "Edit Inspection"}
          </Text>
          <Text style={[styles.pageSubtitle, { color: colors.textMuted || COLORS.textMid }]}>
            {isNew
              ? "Pre-use condition check. Mark every item and sign off."
              : "Update inspection findings and sign off."}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loadingRecord && (
          <View style={styles.centerRow}>
            <ActivityIndicator size="small" color={COLORS.primaryAction} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}

        {/* CONTEXT CARD */}
        <View style={[styles.infoCard, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          <Text style={[styles.infoTitle, { color: colors.text || COLORS.textHigh }]}>
            Equipment inspection checklist
          </Text>
          <Text style={[styles.infoSubtitle, { color: colors.textMuted || COLORS.textMid }]}>
            Mark every item green, amber, red or N/A. Amber and red checks
            require notes. Sign off at the bottom to complete.
          </Text>
        </View>

        {/* EQUIPMENT DETAILS */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Equipment
          </Text>
        </View>
        <View style={[styles.card, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          {equipmentCollapsed && (selectedEquipment || equipmentName) ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
                Selected equipment
              </Text>
              <View style={styles.selectedEquipmentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.selectedEquipmentName, { color: colors.text || COLORS.textHigh }]}>
                    {equipmentName || selectedEquipment?.name || "Unnamed equipment"}
                  </Text>
                  <Text style={[styles.selectedEquipmentMeta, { color: colors.textMuted || COLORS.textMid }]}>
                    {[
                      serialNumber || selectedEquipment?.serialNumber,
                      asset || selectedEquipment?.asset,
                      equipmentType || selectedEquipment?.category,
                      equipmentStatus || selectedEquipment?.status,
                      location || selectedEquipment?.location,
                    ].filter(Boolean).join(" · ") || "-"}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setEquipmentCollapsed(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.changeText}>Change</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
                Search equipment
              </Text>
              <View style={styles.searchBox}>
                <Icon name="search" size={16} color={COLORS.textLow} style={{ marginRight: 7 }} />
                <TextInput
                  style={[styles.searchInput, { color: colors.text || COLORS.textHigh }]}
                  placeholder="Name, serial, asset, category or location..."
                  placeholderTextColor={COLORS.textLow}
                  value={equipmentSearch}
                  onChangeText={setEquipmentSearch}
                />
              </View>

              {loadingEquipment ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator size="small" color={COLORS.primaryAction} />
                  <Text style={styles.loadingText}>Loading equipment...</Text>
                </View>
              ) : filteredEquipment.length === 0 ? (
                <Text style={[styles.selectorEmptyText, { color: colors.textMuted || COLORS.textMid }]}>
                  No previous equipment found. Enter details below.
                </Text>
              ) : (
                <ScrollView style={styles.selectorList} nestedScrollEnabled>
                  {filteredEquipment.map((item) => {
                    const active = item.key === selectedEquipmentKey;
                    return (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.equipmentOptionRow, active && styles.equipmentOptionActive]}
                        onPress={() => handleSelectEquipment(item)}
                        activeOpacity={0.85}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.equipmentOptionName,
                              { color: active ? COLORS.primaryAction : colors.text || COLORS.textHigh },
                            ]}
                          >
                            {item.name || "Unnamed equipment"}
                          </Text>
                          <Text style={[styles.equipmentOptionMeta, { color: colors.textMuted || COLORS.textMid }]}>
                            {[
                              item.serialNumber || item.asset,
                              item.category,
                              item.status,
                              item.location,
                            ].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        {active ? <Icon name="check-circle" size={17} color={COLORS.primaryAction} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}

          <FormField
            label="Equipment name *"
            placeholder="e.g. Ramp car, Stunt bike #3, Hero rig"
            value={equipmentName}
            onChangeText={(v) => { setEquipmentName(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Serial number"
            placeholder="Optional serial number"
            value={serialNumber}
            onChangeText={(v) => { setSerialNumber(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Asset number / internal ref"
            placeholder="Optional asset reference"
            value={asset}
            onChangeText={(v) => { setAsset(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Category *"
            placeholder="e.g. Towing, Rigging, Safety, Workshop"
            value={equipmentType}
            onChangeText={(v) => { setEquipmentType(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Status"
            placeholder="e.g. Available, Out of Service, Repair"
            value={equipmentStatus}
            onChangeText={(v) => { setEquipmentStatus(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Location"
            placeholder="e.g. Workshop, Store, Truck 1"
            value={location}
            onChangeText={(v) => { setLocation(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Last inspection"
            placeholder="YYYY-MM-DD"
            value={lastInspection}
            onChangeText={(v) => { setLastInspection(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Inspection frequency"
            placeholder="Weeks, e.g. 12"
            value={inspectionFrequency}
            onChangeText={(v) => { setInspectionFrequency(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Next inspection"
            placeholder="YYYY-MM-DD"
            value={nextInspection}
            onChangeText={(v) => { setNextInspection(v); setDirty(true); }}
            colors={colors}
          />
          <FormField
            label="Hours / odometer"
            placeholder="e.g. 1240 hrs or 24500 mi"
            value={hoursOrOdo}
            onChangeText={(v) => { setHoursOrOdo(v); setDirty(true); }}
            colors={colors}
          />
        </View>

        {/* INSPECTION DETAILS */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Inspection details
          </Text>
        </View>
        <View style={[styles.card, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
              Inspection date (auto)
            </Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{inspectionDate}</Text>
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
              Inspection time (auto)
            </Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{inspectionTime}</Text>
            </View>
          </View>
          <FormField
            label="Inspected by"
            placeholder="Inspector full name"
            value={inspectedBy}
            onChangeText={(v) => { setInspectedBy(v); setDirty(true); }}
            colors={colors}
          />
        </View>

        {/* CHECKLISTS */}
        <ChecklistSection
          title="Structural condition"
          hint="Mark green, amber or red. Notes required for amber / red."
          items={CHECK_STRUCTURAL}
          checkRatings={checkRatings}
          checkNA={checkNA}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          updateRating={updateRating}
          markNA={markNA}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
          colors={colors}
        />
        <ChecklistSection
          title="Safety systems"
          hint="Restraints, fire suppression, kill switch and padding."
          items={CHECK_SAFETY}
          checkRatings={checkRatings}
          checkNA={checkNA}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          updateRating={updateRating}
          markNA={markNA}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
          colors={colors}
        />
        <ChecklistSection
          title="Mechanical systems"
          hint="Engine, brakes, steering, transmission and suspension."
          items={CHECK_MECHANICAL}
          checkRatings={checkRatings}
          checkNA={checkNA}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          updateRating={updateRating}
          markNA={markNA}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
          colors={colors}
        />
        <ChecklistSection
          title="Electrical & fluids"
          hint="Battery, wiring, oil, coolant, fuel and leaks."
          items={CHECK_ELECTRICAL_FLUIDS}
          checkRatings={checkRatings}
          checkNA={checkNA}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          updateRating={updateRating}
          markNA={markNA}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
          colors={colors}
        />
        <ChecklistSection
          title="Tyres & running gear"
          hint="Pressures, condition, wheel nuts, bearings and axles."
          items={CHECK_TYRES}
          checkRatings={checkRatings}
          checkNA={checkNA}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          updateRating={updateRating}
          markNA={markNA}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
          colors={colors}
        />
        <ChecklistSection
          title="Lights & communications"
          hint="Lights, horn, radio, camera mounts and warnings."
          items={CHECK_LIGHTS_COMMS}
          checkRatings={checkRatings}
          checkNA={checkNA}
          checkNotes={checkNotes}
          checkPhotos={checkPhotos}
          updateRating={updateRating}
          markNA={markNA}
          updateNote={updateNote}
          openPhotoPickerForLabel={openPhotoPickerForLabel}
          removePhotoForLabel={handleRemoveCheckPhoto}
          colors={colors}
        />

        <InspectionReportSection
          title="Defect report"
          items={defectReport}
          badge="R"
          badgeColor="#EF4444"
          emptyText="No red equipment defects recorded."
          colors={colors}
        />

        <InspectionReportSection
          title="Monitor report"
          items={monitorReport}
          badge="M"
          badgeColor="#F59E0B"
          emptyText="No amber equipment advisories recorded."
          colors={colors}
        />

        {/* FINDINGS & NOTES */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Findings & notes
          </Text>
        </View>
        <View style={[styles.card, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          <FormField
            label="Findings"
            placeholder="Describe any faults, defects or concerns found during inspection."
            value={findings}
            onChangeText={(v) => { setFindings(v); setDirty(true); }}
            multiline
            colors={colors}
          />
          <FormField
            label="Recommendations"
            placeholder="Remedial actions required before use, monitoring notes, etc."
            value={recommendations}
            onChangeText={(v) => { setRecommendations(v); setDirty(true); }}
            multiline
            colors={colors}
          />
          <FormField
            label="Extra notes (optional)"
            placeholder="Any additional context for future inspections."
            value={extraNotes}
            onChangeText={(v) => { setExtraNotes(v); setDirty(true); }}
            multiline
            colors={colors}
          />
        </View>

        {/* OVERALL RESULT */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Overall result
          </Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted || COLORS.textMid }]}>
            Required to complete inspection.
          </Text>
        </View>
        <View style={[styles.card, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          <View style={styles.resultRow}>
            {OVERALL_RESULT_OPTIONS.map((opt) => {
              const active = overallResult === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.resultButton,
                    active
                      ? { backgroundColor: opt.color, borderColor: opt.color }
                      : { borderColor: colors.border || COLORS.border },
                  ]}
                  onPress={() => { setOverallResult(opt.value); setDirty(true); }}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.resultButtonText,
                    { color: active ? "#FFFFFF" : colors.textMuted || COLORS.textMid },
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* SIGN-OFF */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Sign-off
          </Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted || COLORS.textMid }]}>
            Required to complete inspection.
          </Text>
        </View>
        <View style={[styles.card, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          <FormField
            label="Inspector signature (name) *"
            placeholder="Type name as signature"
            value={signedBy}
            onChangeText={(v) => { setSignedBy(v); setDirty(true); }}
            colors={colors}
          />
          <View style={{ marginTop: 4 }}>
            <Text style={styles.signatureInfo}>
              By entering your name you confirm all checks above have been
              carried out to the best of your ability.
            </Text>
          </View>
        </View>

        {/* PHOTOS */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Photos / attachments
          </Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted || COLORS.textMid }]}>
            General photos not tied to a single check.
          </Text>
        </View>
        <View style={[styles.card, {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        }]}>
          <View style={styles.photoButtonsRow}>
            <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto} activeOpacity={0.85}>
              <Icon name="camera" size={18} color={COLORS.textHigh} style={{ marginRight: 6 }} />
              <Text style={styles.photoAddText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoButton} onPress={handleAddPhotoFromLibrary} activeOpacity={0.85}>
              <Icon name="image" size={18} color={COLORS.textHigh} style={{ marginRight: 6 }} />
              <Text style={styles.photoAddText}>Add from library</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
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
              <Icon name="save" size={18} color={COLORS.textHigh} style={{ marginRight: 6 }} />
              <Text style={styles.submitText}>
                {isNew ? "Save inspection" : "Save changes"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* PER-CHECK PHOTO PICKER MODAL */}
      <Modal
        visible={!!photoModalLabel}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoModalLabel(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPhotoModalLabel(null)}
        >
          <View style={[styles.modalSheet, { backgroundColor: colors.surfaceAlt || COLORS.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text || COLORS.textHigh }]}>
              Add photo
            </Text>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => handleCheckPhotoSource("camera")}
            >
              <Icon name="camera" size={20} color={COLORS.primaryAction} style={{ marginRight: 12 }} />
              <Text style={[styles.modalOptionText, { color: colors.text || COLORS.textHigh }]}>
                Take photo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => handleCheckPhotoSource("library")}
            >
              <Icon name="image" size={20} color={COLORS.primaryAction} style={{ marginRight: 12 }} />
              <Text style={[styles.modalOptionText, { color: colors.text || COLORS.textHigh }]}>
                Choose from library
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalOption, { marginTop: 4 }]}
              onPress={() => setPhotoModalLabel(null)}
            >
              <Text style={[styles.modalCancelText, { color: colors.textMuted || COLORS.textMid }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/*  CHECKLIST COMPONENTS                                               */
/* ------------------------------------------------------------------ */

function ChecklistSection({
  title, hint, items,
  checkRatings, checkNA, checkNotes, checkPhotos,
  updateRating, markNA, updateNote,
  openPhotoPickerForLabel, removePhotoForLabel,
  colors,
}) {
  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
          {title}
        </Text>
        <Text style={[styles.sectionHint, { color: colors.textMuted || COLORS.textMid }]}>
          {hint}
        </Text>
      </View>
      <View style={[styles.card, {
        backgroundColor: colors.surfaceAlt || COLORS.card,
        borderColor: colors.border || COLORS.border,
      }]}>
        {items.map((item) => (
          <ChecklistRow
            key={item}
            label={item}
            rating={normalizeCheckStatus(checkRatings[item])}
            na={!!checkNA[item]}
            note={checkNotes[item] || ""}
            photos={checkPhotos[item] || []}
            onChangeRating={(val) => updateRating(item, val)}
            onMarkNA={() => markNA(item)}
            onChangeNote={(text) => updateNote(item, text)}
            onPressPhoto={() => openPhotoPickerForLabel(item)}
            onRemovePhoto={(uri) => removePhotoForLabel(item, uri)}
            colors={colors}
          />
        ))}
      </View>
    </>
  );
}

function ChecklistRow({
  label, rating, na, note, photos,
  onChangeRating, onMarkNA, onChangeNote, onPressPhoto, onRemovePhoto,
  colors,
}) {
  const needsNote = !na && NOTE_REQUIRED_STATUSES.has(rating);
  const isComplete = !!rating || na;

  return (
    <View style={styles.checkRowWrapper}>
      <View style={styles.checkRowLeft}>
        <View style={styles.checkIconWrap}>
          {isComplete ? (
            <View style={styles.checkIconFilled}>
              <Icon name="check" size={18} color={COLORS.textHigh} />
            </View>
          ) : (
            <View style={styles.checkIconEmpty} />
          )}
        </View>
        <Text style={[styles.checkLabel, { color: colors.text || COLORS.textHigh }]}>
          {label}
        </Text>
      </View>

      <View style={styles.ratingRow}>
        {CHECK_STATUS_OPTIONS.map((opt) => {
          const active = rating === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onChangeRating(opt.value)}
              disabled={na}
              style={[
                styles.conditionPill,
                na && { opacity: 0.35 },
                active
                  ? { backgroundColor: opt.color, borderColor: opt.color }
                  : { borderColor: COLORS.lightGray },
              ]}
              activeOpacity={0.75}
            >
              <Text style={[
                styles.conditionText,
                active && styles.conditionTextActive,
                !active && { color: COLORS.textLow },
              ]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          onPress={onMarkNA}
          disabled={na}
          style={[
            styles.naPill,
            na && styles.naPillActive,
          ]}
          activeOpacity={0.75}
        >
          <Text style={[styles.naText, na && styles.naTextActive]}>N/A</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onPressPhoto}
          style={styles.photoIconButton}
          activeOpacity={0.75}
        >
          <Icon name="camera" size={16} color={COLORS.textMid} />
          {photos.length > 0 && (
            <View style={styles.photoBadge}>
              <Text style={styles.photoBadgeText}>{photos.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Note input */}
      {needsNote && (
        <TextInput
          style={[
            styles.checkNoteInput,
            styles.checkNoteInputRequired,
            { borderColor: CHECK_STATUS_OPTIONS.find((opt) => opt.value === rating)?.color },
          ]}
          placeholder={`Note required for ${rating}`}
          placeholderTextColor={COLORS.textLow}
          value={note}
          onChangeText={onChangeNote}
          multiline
        />
      )}

      {/* Check photos */}
      {photos.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
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

function InspectionReportSection({ title, items, badge, badgeColor, colors }) {
  if (!items.length) return null;

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
          {title}
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
          <View key={item.key} style={styles.reportRow}>
            <View style={[styles.reportBadge, { backgroundColor: badgeColor }]}>
              <Text style={styles.reportBadgeText}>{badge}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.reportTitle, { color: colors.text || COLORS.textHigh }]}>
                {item.title}
              </Text>
              <Text style={[styles.reportDetails, { color: colors.textMuted || COLORS.textMid }]}>
                {item.details}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function FormField({ label, placeholder, value, onChangeText, multiline, colors }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: colors.text || COLORS.textHigh, backgroundColor: COLORS.inputBg },
        ]}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textLow}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        returnKeyType={multiline ? "default" : "done"}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  STYLES                                                              */
/* ------------------------------------------------------------------ */

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

  scrollContent: { padding: 16, paddingTop: 8 },
  centerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  loadingText: { color: COLORS.textMid, marginLeft: 8, fontSize: 13 },

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
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMid,
    flexShrink: 1,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldGroup:    { marginBottom: 12 },
  fieldLabel:    { fontSize: 13, fontWeight: "600", color: COLORS.textMid, marginBottom: 4 },
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
  readonlyField: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  readonlyText: { color: COLORS.textMid, fontSize: 14 },
  selectedEquipmentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  selectedEquipmentName: {
    fontSize: 15,
    fontWeight: "800",
  },
  selectedEquipmentMeta: {
    marginTop: 2,
    fontSize: 12,
  },
  changeText: {
    color: COLORS.primaryAction,
    fontSize: 12,
    fontWeight: "800",
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
  selectorList: {
    maxHeight: 180,
    marginBottom: 12,
  },
  selectorEmptyText: {
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  equipmentOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  equipmentOptionActive: {
    backgroundColor: "rgba(237,28,37,0.08)",
  },
  equipmentOptionName: {
    fontSize: 14,
    fontWeight: "800",
  },
  equipmentOptionMeta: {
    marginTop: 2,
    fontSize: 12,
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
  photoBadge: {
    position: "absolute", top: -5, right: -5,
    minWidth: 15, height: 15, borderRadius: 8,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3,
  },
  photoBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
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
  reportRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  reportBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  reportBadgeText: {
    color: COLORS.textHigh,
    fontSize: 12,
    fontWeight: "900",
  },
  reportTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  reportDetails: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },

  resultRow: { flexDirection: "row", gap: 10 },
  resultButton: {
    flex: 1, borderWidth: 2, borderRadius: 8,
    paddingVertical: 14, alignItems: "center",
  },
  resultButtonText: { fontSize: 16, fontWeight: "700" },

  signatureInfo: {
    fontSize: 11,
    color: COLORS.textMid,
  },

  photoButtonsRow: { flexDirection: "row", gap: 8 },
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
  photoAddText: { color: COLORS.textHigh, fontSize: 14, fontWeight: "600" },
  photoThumbWrapper: { marginRight: 10, position: "relative" },
  photoThumb: { width: 70, height: 70, borderRadius: 8 },
  photoRemoveBadge: {
    position: "absolute", top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center",
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
  submitText: { color: COLORS.textHigh, fontSize: 15, fontWeight: "700" },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, paddingBottom: Platform.OS === "ios" ? 36 : 20,
  },
  modalTitle: { fontSize: 15, fontWeight: "700", marginBottom: 16 },
  modalOption: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  modalOptionText: { fontSize: 15 },
  modalCancelText: { fontSize: 14, textAlign: "center", flex: 1 },
});
