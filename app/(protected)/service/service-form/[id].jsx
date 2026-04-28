// app/(protected)/service/service-form/[id].jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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
import { useTheme } from "../../../providers/ThemeProvider";

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
  "Front brake pads & discs inspected",
  "Rear brake pads & discs / drums inspected",
  "Tyre tread depth & wear pattern checked",
  "Tyre pressures set to spec (incl. spare)",
  "Steering joints & rack inspected",
  "Suspension arms, bushes & shocks inspected",
  "Brake hoses & lines inspected for leaks / corrosion",
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

function buildVehicleServiceHistoryItem({
  completedDate,
  serviceRecordId,
  notes,
  odometer,
  partsUsed,
}) {
  return {
    completedDate,
    bookingId: null,
    serviceRecordId,
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

// 🔑 MUST match book-work.jsx
const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";

export default function ServiceFormScreen() {
  const router = useRouter();
  const { id, recordId } = useLocalSearchParams();
  const formId = Array.isArray(id) ? id[0] : id; // ensure string
  const editRecordId = Array.isArray(recordId) ? recordId[0] : recordId;
  const isEditingRecord = !!editRecordId;

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
  const [checkRatings, setCheckRatings] = useState({}); // { label: 0–5 }
  const [checkNA, setCheckNA] = useState({}); // { label: true if N/A }
  const [checkNotes, setCheckNotes] = useState({}); // { label: "note text" }
  const [checkPhotos, setCheckPhotos] = useState({}); // { label: [{ uri }] }

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
    workSummary,
    partsUsed,
    extraNotes,
    signedBy,
    checks,
    checkRatings,
    checkNA,
    checkNotes,
    checkPhotos,
    photos,
  ]);

  /* ---------------- HELPERS ---------------- */

  const toggleCheck = (label) => {
    setChecks((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
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
      [label]: value,
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
      const completed =
        checks[label] || typeof checkRatings[label] === "number";
      if (!completed) {
        Alert.alert(
          "Checklist incomplete",
          `Please complete or mark N/A: "${label}".`
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

      const photoURLs = await uploadPhotoList(
        photos,
        `${storageBasePath}/overall`
      );
      const checkPhotoURLs = await uploadCheckPhotoMap(
        checkPhotos,
        `${storageBasePath}/checks`
      );

      const record = {
        vehicleId: selectedVehicleId,
        vehicleName: recordVehicleName,
        registration: recordRegistration,
        manufacturer: v?.manufacturer || editingRecord?.manufacturer || "",
        model: v?.model || editingRecord?.model || "",
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
            notes: historyNotes,
            odometer: odoNumber,
            partsUsed: partsUsed.trim(),
          })
        );
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
            onPress: () => router.back(),
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
        <TouchableOpacity onPress={router.back} style={styles.backButton}>
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
              ? "Update missed details, condition scores, notes and photos."
              : "Record full service, 0–5 condition scores and photos."}
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
            0–5 scale on every item (5 = good, 0 = issue). Date/time taken
            automatically; next service set 12 months ahead.
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

        {/* CHECKLISTS */}
        <ChecklistSection
          title="Engine & fluids"
          hint="Tick, 0–5, add notes & photos for each line."
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
          hint="Use 0–5 for pad / tyre wear. Add quick photos per item."
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
          hint="0–5 condition, N/A if not fitted. Photo icon on each row."
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
            rating={
              typeof checkRatings[item] === "number" ? checkRatings[item] : null
            }
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
  const disabled = na;

  return (
    <View style={styles.checkRowWrapper}>
      {/* Left: tick + label */}
      <TouchableOpacity
        style={styles.checkRowLeft}
        onPress={disabled ? undefined : onToggle}
        activeOpacity={disabled ? 1 : 0.8}
      >
        <View style={styles.checkIconWrap}>
          {checked ? (
            <View style={styles.checkIconFilled}>
              <Icon name="check" size={18} color={COLORS.textHigh} />
            </View>
          ) : (
            <View
              style={[
                styles.checkIconEmpty,
                disabled && { borderColor: COLORS.textLow, opacity: 0.4 },
              ]}
            />
          )}
        </View>
        <Text
          style={[
            styles.checkLabel,
            { color: colors.textMuted || COLORS.textLow },
            checked && { color: colors.text || COLORS.textHigh },
            disabled && { opacity: 0.5 },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>

      {/* Right: rating 0–5 + N/A + photo icon */}
      <View style={styles.ratingRow}>
        {[0, 1, 2, 3, 4, 5].map((n) => {
          const isActive = rating === n;
          return (
            <TouchableOpacity
              key={n}
              style={[
                styles.ratingDot,
                isActive && styles.ratingDotActive,
                disabled && { opacity: 0.25 },
              ]}
              onPress={disabled ? undefined : () => onChangeRating(n)}
              activeOpacity={disabled ? 1 : 0.7}
            >
              <Text
                style={[
                  styles.ratingText,
                  { color: colors.textMuted || COLORS.textLow },
                  isActive && styles.ratingTextActive,
                ]}
              >
                {n}
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
          {
            backgroundColor: colors.inputBackground || COLORS.inputBg,
            borderColor: colors.inputBorder || COLORS.lightGray,
            color: colors.text || COLORS.textHigh,
          },
        ]}
        placeholder="Notes for this check…"
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
  ratingDot: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.lightGray,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  ratingDotActive: {
    backgroundColor: "rgba(255,59,48,0.16)",
    borderColor: COLORS.primaryAction,
  },
  ratingText: {
    fontSize: 13,
    color: COLORS.textLow,
  },
  ratingTextActive: {
    color: COLORS.primaryAction,
    fontWeight: "700",
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
