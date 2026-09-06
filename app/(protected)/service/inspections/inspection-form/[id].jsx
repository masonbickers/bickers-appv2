import { AppButton, AppModal, AppText as Text, AppPressable as TouchableOpacity, FormField as SharedFormField, TextArea } from "../../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../../lib/design/semantics";
// app/(protected)/service/inspections/inspection-form/[id].jsx
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams,
  useNavigation,
  useRouter } from "expo-router";
import {
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

import { db, storage } from "../../../../../firebaseConfig";
import {
  buildEquipmentCoreUpdate,
  getEquipmentCategory,
  getEquipmentLastInspection,
  getEquipmentName,
  getEquipmentNextInspection,
  getEquipmentStatus,
} from "../../../../../lib/fleetSchema";
import { useServiceCacheActions, useServiceCollectionReader } from "../../../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../../../lib/sync/firestoreQueue";
import { useTheme } from "../../../../../providers/ThemeProvider";
import { staticColors } from "../../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../../lib/design/tokens";
import PageShell from "../../../../../components/layout/PageShell";

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

const CHECK_STATUS_OPTIONS = [
  { value: "green", label: "Green", color: staticColors.hex_22c55e_740if4 },
  { value: "amber", label: "Amber", color: staticColors.hex_f59e0b_4zbh7f },
  { value: "red",   label: "Red",   color: staticColors.hex_ef4444_4oizhh },
];

const NOTE_REQUIRED_STATUSES = new Set(["amber", "red"]);

const OVERALL_RESULT_OPTIONS = [
  { value: "pass", label: "Pass",    color: staticColors.hex_22c55e_740if4 },
  { value: "fail", label: "Fail",    color: staticColors.hex_ef4444_4oizhh },
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
      const name = String(getEquipmentName(record)).trim();
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
        type: getEquipmentCategory(record) || "",
        category: getEquipmentCategory(record) || "",
        status: getEquipmentStatus(record) || "",
        location: record?.location || "",
        lastInspection: getEquipmentLastInspection(record) || "",
        inspectionFrequency: record?.inspectionFrequency || "",
        nextInspection: getEquipmentNextInspection(record) || "",
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
  const readServiceCollection = useServiceCollectionReader();
  const { upsertServiceRow, patchServiceRow } = useServiceCacheActions();

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
        const rows = await readServiceCollection("equipment");
        setEquipmentOptions(
          buildEquipmentOptions(rows)
        );
      } catch (err) {
        console.error("Failed to load equipment options:", err);
      } finally {
        setLoadingEquipment(false);
      }
    };

    loadEquipmentOptions();
  }, [readServiceCollection]);

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
  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.85 });
    if (result.canceled) return null;
    return result.assets[0].uri;
  }

  // Per-check photos
  function openPhotoPickerForLabel(label) {
    setPhotoModalLabel(label);
  }

  async function handleCheckPhotoSource() {
    const label = photoModalLabel;
    setPhotoModalLabel(null);
    const uri = await pickImage();
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
  async function handleAddPhotoFromLibrary() {
    const uri = await pickImage();
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
          ...buildEquipmentCoreUpdate({
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
          }),
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
      }
      const inspectionRef = doc(db, "equipmentInspections", docId);
      const firestoreMutations = [
        {
          run: () =>
            isNew
              ? setDoc(inspectionRef, payload)
              : updateDoc(inspectionRef, payload),
          mutation: {
            operation: isNew ? "set" : "update",
            docPath: `equipmentInspections/${docId}`,
            data: payload,
            options: isNew ? { merge: false } : undefined,
            entityType: "equipmentInspection",
            entityId: docId,
          },
        },
      ];

      const queueSaveInspectionToEquipment = (targetEquipmentDocId) => {
        if (!targetEquipmentDocId) return;
        const equipmentUpdate = {
          ...buildEquipmentCoreUpdate({
            name: equipmentName.trim(),
            category: equipmentType.trim(),
            status: equipmentStatus.trim(),
            serialNumber: serialNumber.trim(),
            asset: asset.trim(),
            location: location.trim(),
            lastInspection: inspectionDateISO || lastInspection.trim(),
            inspectionFrequency: inspectionFrequency.trim(),
            nextInspection: nextInspection.trim(),
          }),
          updatedAt: serverTimestamp(),
        };
        firestoreMutations.push({
          run: () => updateDoc(doc(db, "equipment", targetEquipmentDocId), equipmentUpdate),
          mutation: {
            operation: "update",
            docPath: `equipment/${targetEquipmentDocId}`,
            data: equipmentUpdate,
            entityType: "equipment",
            entityId: targetEquipmentDocId,
          },
        });
      };

      queueSaveInspectionToEquipment(targetEquipmentDocId);

      const { queued } = await runOrQueueFirestoreMutations(firestoreMutations);
      await upsertServiceRow("equipmentInspections", { ...payload, id: docId });
      if (targetEquipmentDocId && firestoreMutations[1]?.mutation?.data) {
        await patchServiceRow(
          "equipment",
          targetEquipmentDocId,
          firestoreMutations[1].mutation.data
        );
      }

      allowLeaveRef.current = true;
      setDirty(false);
      Alert.alert(
        queued ? "Saved offline" : "Saved",
        queued
          ? "No internet right now. This inspection will upload automatically when internet returns."
          : isNew
          ? "Inspection created."
          : "Inspection updated.",
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
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: isNew ? "Equipment Inspection" : "Edit Inspection",
      subtitle: isNew
        ? "Pre-use condition check. Mark every item and sign off."
        : "Update inspection findings and sign off.",
      onBack: () => confirmLeave(() => router.back()),
    }}>
      {/* HEADER */}
      

      <>
        {loadingRecord && (
          <View style={styles.centerRow}>
            <ActivityIndicator size="small" color={COLORS.primaryAction} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}

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
              <SharedFormField
                  label="Search equipment"
                  placeholder="Name, serial, asset, category or location..."
                  value={equipmentSearch}
                  onChangeText={setEquipmentSearch}
                />

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
                <View style={styles.selectorList} nestedScrollEnabled>
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
                </View>
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
              <Text style={[styles.readonlyText, { color: colors.text || COLORS.textHigh }]}>{inspectionDate}</Text>
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
              Inspection time (auto)
            </Text>
            <View style={styles.readonlyField}>
              <Text style={[styles.readonlyText, { color: colors.text || COLORS.textHigh }]}>{inspectionTime}</Text>
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
          badgeColor={staticColors.hex_ef4444_4oizhh}
          emptyText="No red equipment defects recorded."
          colors={colors}
        />

        <InspectionReportSection
          title="Monitor report"
          items={monitorReport}
          badge="M"
          badgeColor={staticColors.hex_f59e0b_4zbh7f}
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
                    { color: active ? staticColors.hex_ffffff_5c2ocm : colors.textMuted || COLORS.textMid },
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
          <View style={{ marginTop: t.spacing.xxs }}>
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
            <TouchableOpacity style={styles.photoButton} onPress={handleAddPhotoFromLibrary} activeOpacity={0.85}>
              <Icon name="image" size={18} color={colors.text || COLORS.textHigh} style={{ marginRight: t.spacing.xxs }} />
              <Text style={[styles.photoAddText, { color: colors.text || COLORS.textHigh }]}>Add from library</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: t.spacing.xs }}>
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
              <Icon name="save" size={18} color={COLORS.textHigh} style={{ marginRight: t.spacing.xxs }} />
              <Text style={styles.submitText}>
                {isNew ? "Save inspection" : "Save changes"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 20 }} />
      </>

      {/* PER-CHECK PHOTO PICKER MODAL */}
      <AppModal
        visible={!!photoModalLabel}
        title="Add photo"
        onRequestClose={() => setPhotoModalLabel(null)}
        presentation="adaptive"
        actions={<AppButton label="Cancel" variant="secondary" onPress={() => setPhotoModalLabel(null)} />}
      >
        <AppButton label="Choose from library" icon="image" variant="secondary" onPress={handleCheckPhotoSource} />
      </AppModal>
    </PageShell>
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
    <View style={[styles.checkRowWrapper, { borderBottomColor: colors.border || COLORS.border }]}>
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
                  : { borderColor: colors.border || COLORS.border },
              ]}
              activeOpacity={0.75}
            >
              <Text style={[
                styles.conditionText,
                active && styles.conditionTextActive,
                !active && { color: colors.textMuted || COLORS.textLow },
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
            { borderColor: colors.border || COLORS.border },
            na && styles.naPillActive,
          ]}
          activeOpacity={0.75}
        >
          <Text style={[styles.naText, na && styles.naTextActive]}>N/A</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onPressPhoto}
          style={[styles.photoIconButton, { borderColor: colors.border || COLORS.border }]}
          activeOpacity={0.75}
        >
          <Icon name="image" size={16} color={colors.textMuted || COLORS.textMid} />
          {photos.length > 0 && (
            <View style={styles.photoBadge}>
              <Text style={styles.photoBadgeText}>{photos.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Note input */}
      {needsNote && (
        <TextArea
          label="Inspection note"
          error={`Note required for ${rating}`}
          placeholder={`Note required for ${rating}`}
          value={note}
          onChangeText={onChangeNote}
        />
      )}

      {/* Check photos */}
      {photos.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: t.spacing.xxs }}>
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
      {multiline ? (
        <TextArea label={label} placeholder={placeholder} value={value} onChangeText={onChangeText} />
      ) : (
        <SharedFormField label={label} placeholder={placeholder} value={value} onChangeText={onChangeText} />
      )}
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
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

  scrollContent: { padding: t.spacing.md, paddingTop: t.spacing.xs, paddingBottom: 110 },
  centerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xs,
  },
  loadingText: { color: COLORS.textMid, marginLeft: t.spacing.xs, fontSize: t.typography.bodySmall.fontSize },

  sectionHeaderRow: {
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: t.spacing.xs,
  },
  sectionTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    flexShrink: 1,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldGroup:    { marginBottom: t.spacing.sm },
  fieldLabel:    { fontSize: t.typography.bodySmall.fontSize, fontWeight: "600", color: COLORS.textMid, marginBottom: t.spacing.xxs },
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
  readonlyField: {
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  readonlyText: { color: COLORS.textHigh, fontSize: t.typography.body.fontSize },
  selectedEquipmentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.sm,
  },
  selectedEquipmentName: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },
  selectedEquipmentMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
  },
  changeText: {
    color: COLORS.primaryAction,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
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
  selectorList: {
    maxHeight: 180,
    marginBottom: t.spacing.sm,
  },
  selectorEmptyText: {
    marginBottom: t.spacing.sm,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
  },
  equipmentOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  equipmentOptionActive: {
    backgroundColor: staticColors.rgba_qyx95c,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
  },
  equipmentOptionName: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
  },
  equipmentOptionMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
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
    borderColor: COLORS.border,
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
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBadge: {
    position: "absolute", top: -5, right: -5,
    minWidth: 15, height: 15, borderRadius: t.radius.sm,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: t.spacing.xxs,
  },
  photoBadgeText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.micro.fontSize, fontWeight: "800" },
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
  reportRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reportBadge: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  reportBadgeText: {
    color: COLORS.textHigh,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
  },
  reportTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
  },
  reportDetails: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    lineHeight: t.typography.metadata.lineHeight,
  },

  resultRow: { flexDirection: "row", gap: t.spacing.xs },
  resultButton: {
    flex: 1, borderWidth: 2, borderRadius: t.radius.sm,
    paddingVertical: t.spacing.sm, alignItems: "center",
  },
  resultButtonText: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700" },

  signatureInfo: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textMid,
  },

  photoButtonsRow: { flexDirection: "row", gap: t.spacing.xs },
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
  photoAddText: { color: COLORS.textHigh, fontSize: t.typography.body.fontSize, fontWeight: "600" },
  photoThumbWrapper: { marginRight: t.spacing.xs, position: "relative" },
  photoThumb: { width: 70, height: 70, borderRadius: t.radius.sm },
  photoRemoveBadge: {
    position: "absolute", top: -4, right: -4,
    width: 18, height: 18, borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_18a7ub6,
    alignItems: "center", justifyContent: "center",
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
  submitText: { color: COLORS.textHigh, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700" },

  modalOverlay: {
    flex: 1, backgroundColor: staticColors.rgba_11xlyme,
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: t.spacing.lg, paddingBottom: Platform.OS === "ios" ? 36 : 20,
  },
  modalTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700", marginBottom: t.spacing.md },
  modalOption: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: t.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  modalOptionText: { fontSize: t.typography.bodyLarge.fontSize },
  modalCancelText: { fontSize: t.typography.body.fontSize, textAlign: "center", flex: 1 },
});
