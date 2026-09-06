import { AppText as Text, AppPressable as TouchableOpacity, FormField as SharedFormField, TextArea } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
// app/(protected)/service/minor-service/[id].jsx
import { Feather } from "@expo/vector-icons"; // ✅ use Expo Feather
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams,
  useNavigation,
  useRouter } from "expo-router";
import {
  arrayUnion,
  collection,
  doc,
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


import { db, storage } from "../../../../firebaseConfig";
import { formatShortDate } from "../../../../lib/dateDisplay";
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
  "Interim / minor service",
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

/* ------------------------------------------------------------------ */
/*  CHECKLISTS – same structure as full service                       */
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
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return {
    date: `${yyyy}-${mm}-${dd}`, // YYYY-MM-DD
    time: `${hh}:${min}`, // HH:MM
  };
}

function computeNextServiceFromDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const next = new Date(d);
  // you can change this to 6 months later if you want minor services more often
  next.setFullYear(next.getFullYear() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = next.getFullYear();
  const mm = pad(next.getMonth() + 1);
  const dd = pad(next.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCheckStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "green" || value === "amber" || value === "red") return value;
  if (typeof status === "number") {
    if (status >= 4) return "green";
    if (status >= 2) return "amber";
    return "red";
  }
  return "";
}

function getCheckStatusOption(status) {
  return CHECK_STATUS_OPTIONS.find((option) => option.value === status) || null;
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
  if (!response.ok) {
    throw new Error("Could not read selected photo for upload.");
  }

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
  const uris = photoItems
    .map((p) => (typeof p === "string" ? p : p?.uri))
    .filter(Boolean);

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

  for (const [label, photoItems] of Object.entries(checkPhotosMap || {})) {
    if (!Array.isArray(photoItems) || photoItems.length === 0) continue;
    const safeLabel = sanitizeStorageSegment(label);
    const uploaded = await uploadPhotoList(photoItems, `${basePath}/${safeLabel}`);
    if (uploaded.length > 0) {
      uploadedMap[label] = uploaded;
    }
  }

  return uploadedMap;
}

// 🔑 multi-draft key for minor service forms
const MINOR_SERVICE_DRAFTS_KEY = "minorServiceFormDrafts_v1";

export default function MinorServiceFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams();
  const formId = Array.isArray(id) ? id[0] : id;
  const allowLeaveRef = useRef(false);

  const { colors } = useTheme();
  const readServiceCollection = useServiceCollectionReader();
  const { upsertServiceRow, patchServiceRow } = useServiceCacheActions();

  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // VEHICLE SEARCH + SELECTION
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehicleCollapsed, setVehicleCollapsed] = useState(false);

  // DATE/TIME
  const now = getNowParts();
  const [serviceDate] = useState(now.date); // read-only
  const [serviceTime] = useState(now.time); // read-only

  // SERVICE FIELDS
  const [odometer, setOdometer] = useState("");
  const [serviceType, setServiceType] = useState("Interim / minor service");
  const [serviceTypeOpen, setServiceTypeOpen] = useState(false);
  const [workSummary, setWorkSummary] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  // SIGNATURE
  const [signedBy, setSignedBy] = useState("");

  // CHECKLIST STATE
  const [checks, setChecks] = useState({});
  const [checkRatings, setCheckRatings] = useState({});
  const [checkNA, setCheckNA] = useState({});
  const [checkNotes, setCheckNotes] = useState({});
  const [checkPhotos, setCheckPhotos] = useState({});

  // PHOTOS
  const [photos, setPhotos] = useState([]); // [{ uri }]

  const allChecklistLabels = useMemo(
    () => [
      ...CHECK_ENGINE_FLUIDS,
      ...CHECK_SAFETY_CHASSIS,
      ...CHECK_ELECTRICAL_TEST,
    ],
    []
  );

  const nextServiceComputed = useMemo(
    () => computeNextServiceFromDate(serviceDate),
    [serviceDate]
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
        console.error("Failed to load vehicles for minor service:", err);
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

  const hasUnsavedChanges = useMemo(
    () =>
      !!selectedVehicleId ||
      !!vehicleSearch.trim() ||
      !!odometer.trim() ||
      serviceType !== "Interim / minor service" ||
      !!workSummary.trim() ||
      !!partsUsed.trim() ||
      !!extraNotes.trim() ||
      !!signedBy.trim() ||
      Object.keys(checks || {}).length > 0 ||
      Object.keys(checkRatings || {}).length > 0 ||
      Object.keys(checkNA || {}).length > 0 ||
      Object.keys(checkNotes || {}).length > 0 ||
      Object.values(checkPhotos || {}).some((items) => Array.isArray(items) && items.length > 0) ||
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
      serviceType,
      signedBy,
      vehicleSearch,
      workSummary,
    ]
  );

  const confirmLeave = (onLeave) => {
    if (!hasUnsavedChanges || allowLeaveRef.current) {
      onLeave();
      return;
    }

    Alert.alert(
      "Leave minor service?",
      "You have unsaved service details. Leave without saving?",
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
        "Leave minor service?",
        "You have unsaved service details. Leave without saving?",
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

  /* ---------------- LOAD DRAFT FOR THIS FORM ID ---------------- */

  useEffect(() => {
    const loadDraft = async () => {
      if (!formId) return;
      try {
        const raw = await AsyncStorage.getItem(MINOR_SERVICE_DRAFTS_KEY);
        if (!raw) return;

        const allDrafts = JSON.parse(raw) || {};
        const draft = allDrafts[formId];
        if (!draft) return;

        if (draft.selectedVehicleId) {
          setSelectedVehicleId(draft.selectedVehicleId);
          setVehicleCollapsed(true);
        }
        if (draft.vehicleSearch) setVehicleSearch(draft.vehicleSearch);
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
        if (draft.checkPhotoURIs) {
          const restored = {};
          Object.entries(draft.checkPhotoURIs).forEach(([label, uris]) => {
            if (Array.isArray(uris)) {
              restored[label] = uris.map((uri) => ({ uri }));
            }
          });
          setCheckPhotos(restored);
        }
        if (Array.isArray(draft.photoURIs)) {
          setPhotos(draft.photoURIs.map((uri) => ({ uri })));
        }
      } catch (err) {
        console.error("Failed to load minor service draft:", err);
      }
    };

    loadDraft();
  }, [formId]);

  /* ---------------- AUTO-SAVE DRAFT LOCALLY (MULTI) ---------------- */

  useEffect(() => {
    const saveDraft = async () => {
      if (!formId) return;

      try {
        const vehicleName = getVehicleName(selectedVehicle) || "";
        const registration = getVehicleRegistration(selectedVehicle) || "";

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
          Object.values(checkPhotos).some((items) => Array.isArray(items) && items.length > 0) ||
          photos.length > 0;

        const raw = await AsyncStorage.getItem(MINOR_SERVICE_DRAFTS_KEY);
        const allDrafts = raw ? JSON.parse(raw) || {} : {};

        if (!hasAnyContent) {
          if (allDrafts[formId]) {
            delete allDrafts[formId];
            if (Object.keys(allDrafts).length === 0) {
              await AsyncStorage.removeItem(MINOR_SERVICE_DRAFTS_KEY);
            } else {
              await AsyncStorage.setItem(
                MINOR_SERVICE_DRAFTS_KEY,
                JSON.stringify(allDrafts)
              );
            }
          }
          return;
        }

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
          checkPhotoURIs: Object.fromEntries(
            Object.entries(checkPhotos).map(([label, items]) => [
              label,
              Array.isArray(items) ? items.map((item) => item.uri).filter(Boolean) : [],
            ])
          ),
          photoURIs: photos.map((p) => p.uri),
        };

        allDrafts[formId] = draftToSave;
        await AsyncStorage.setItem(
          MINOR_SERVICE_DRAFTS_KEY,
          JSON.stringify(allDrafts)
        );
      } catch (err) {
        console.error("Failed to save minor service draft:", err);
      }
    };

    saveDraft();
  }, [
    formId,
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
    setChecks((prev) => {
      const nextChecked = !prev[label];
      if (nextChecked) {
        setCheckNA((prevNA) => ({ ...prevNA, [label]: false }));
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
        setCheckNotes((prevNotes) => {
          const { [label]: _omit, ...rest } = prevNotes;
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
    const status = normalizeCheckStatus(value) || "green";
    setCheckNA((prev) => ({ ...prev, [label]: false }));
    setCheckRatings((prev) => ({
      ...prev,
      [label]: status,
    }));
    setChecks((prev) => ({
      ...prev,
      [label]: true,
    }));
  };

  const updateNote = (label, value) => {
    setCheckNotes((prev) => ({
      ...prev,
      [label]: value,
    }));
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
      if (!status) {
        Alert.alert(
          "Checklist incomplete",
          `Please mark green, amber, red or N/A: "${label}".`
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

    return true;
  };

  /* ---------------- PHOTOS ---------------- */

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

  const handleAddCheckPhoto = async (label) => {
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

      setCheckPhotos((prev) => ({
        ...prev,
        [label]: [...(prev[label] || []), { uri: asset.uri }],
      }));
    } catch (err) {
      console.error("Failed to pick check image:", err);
      Alert.alert("Error", "Could not open photo library.");
    }
  };

  const handleRemoveCheckPhoto = (label, uri) => {
    setCheckPhotos((prev) => ({
      ...prev,
      [label]: (prev[label] || []).filter((p) => p.uri !== uri),
    }));
  };

  /* ---------------- SUBMIT ---------------- */

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      const v = selectedVehicle;
      const odoNumber = odometer ? Number(odometer) : null;
      const nextServiceDate = nextServiceComputed || null;
      const serviceDateTime = `${serviceDate} ${serviceTime}`;
      const serviceRecordRef = doc(collection(db, "serviceRecords"));
      const storageBasePath = `serviceRecords/${serviceRecordRef.id}`;

      let photoURLs = [];
      let checkPhotoURLs = {};
      try {
        photoURLs = await uploadPhotoList(
          photos,
          `${storageBasePath}/overall`
        );
        checkPhotoURLs = await uploadCheckPhotoMap(
          checkPhotos,
          `${storageBasePath}/checks`
        );
      } catch (uploadErr) {
        console.error("Failed to upload minor service photos:", uploadErr);
        Alert.alert(
          "Photo upload failed",
          "Could not upload the service photos. Please check your connection and try again."
        );
        return;
      }

      const recordVehicleName = getVehicleName(v) || "";
      const recordRegistration = getVehicleRegistration(v) || "";
      const record = {
        vehicleId: selectedVehicleId,
        vehicleName: recordVehicleName,
        registration: recordRegistration,
        manufacturer: getVehicleManufacturer(v) || "",
        model: v?.model || "",
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
        checkPhotoURIs: Object.fromEntries(
          Object.entries(checkPhotos).map(([label, items]) => [
            label,
            Array.isArray(items) ? items.map((item) => item.uri).filter(Boolean) : [],
          ])
        ),
        checkPhotoURLs,
        photoURIs: [],
        photoURLs,
        signedBy: signedBy.trim(),
        createdAt: serverTimestamp(),
      };

      const vehicleRef = doc(db, "vehicles", selectedVehicleId);
      const historyNotes = [workSummary.trim(), extraNotes.trim()]
        .filter(Boolean)
        .join(" ");
      const updatePayload = {
        ...buildVehicleIdentityMirrorUpdate({
          ...v,
          name: recordVehicleName,
          registration: recordRegistration,
          manufacturer: getVehicleManufacturer(v) || "",
        }),
        ...buildVehicleServiceDateMirrorUpdate({
          lastService: serviceDate,
          nextService: nextServiceDate,
        }),
        serviceHistory: arrayUnion(
          buildVehicleServiceHistoryItem({
            completedDate: serviceDate,
            serviceRecordId: serviceRecordRef.id,
            notes: historyNotes,
            odometer: odoNumber,
            partsUsed: partsUsed.trim(),
          })
        ),
      };
      if (odoNumber && !Number.isNaN(odoNumber)) {
        Object.assign(updatePayload, buildVehicleOdometerMirrorUpdate(odoNumber));
      }

      const { queued } = await runOrQueueFirestoreMutations([
        {
          run: () => setDoc(serviceRecordRef, record),
          mutation: {
            operation: "set",
            docPath: `serviceRecords/${serviceRecordRef.id}`,
            data: record,
            options: { merge: false },
            entityType: "serviceRecord",
            entityId: serviceRecordRef.id,
          },
        },
        {
          run: () => updateDoc(vehicleRef, updatePayload),
          mutation: {
            operation: "update",
            docPath: `vehicles/${selectedVehicleId}`,
            data: updatePayload,
            entityType: "vehicle",
            entityId: selectedVehicleId,
          },
        },
      ]);
      await Promise.all([
        upsertServiceRow("serviceRecords", { ...record, id: serviceRecordRef.id }),
        patchServiceRow("vehicles", selectedVehicleId, updatePayload),
      ]);

      // clear just this draft
      try {
        const raw = await AsyncStorage.getItem(MINOR_SERVICE_DRAFTS_KEY);
        if (raw) {
          const allDrafts = JSON.parse(raw) || {};
          if (allDrafts[formId]) {
            delete allDrafts[formId];
            if (Object.keys(allDrafts).length === 0) {
              await AsyncStorage.removeItem(MINOR_SERVICE_DRAFTS_KEY);
            } else {
              await AsyncStorage.setItem(
                MINOR_SERVICE_DRAFTS_KEY,
                JSON.stringify(allDrafts)
              );
            }
          }
        }
      } catch (e) {
        console.error("Failed to remove minor service draft after submit:", e);
      }

      Alert.alert(
        queued ? "Saved offline" : "Minor service saved",
        queued
          ? "No internet right now. This service will upload automatically when internet returns."
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
      console.error("Failed to save minor service record:", err);
      Alert.alert("Error", "Could not save service record. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- RENDER ---------------- */

  return (
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: "Minor Service Form",
      subtitle: "Interim / minor service checklist, parts and notes.",
      onBack: () => confirmLeave(() => router.back()),
    }}>
      {/* HEADER */}
      

      <>
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
              <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
                Selected vehicle
              </Text>
              <View style={styles.selectedVehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.vehicleName, { color: colors.text || COLORS.textHigh }]}>
                    {getVehicleName(selectedVehicle) || "Unnamed vehicle"}
                  </Text>
                  <Text style={[styles.vehicleReg, { color: colors.textMuted || COLORS.textMid }]}>
                    {getVehicleRegistration(selectedVehicle) || "—"}
                  </Text>
                </View>
              </View>
              <View style={styles.vehicleMetaRow}>
                <Text style={[styles.vehicleMeta, { color: colors.textMuted || COLORS.textMid }]}>
                  Current mileage:{" "}
                  {typeof getVehicleMileage(selectedVehicle) === "number"
                    ? `${getVehicleMileage(selectedVehicle).toLocaleString("en-GB")} mi`
                    : "—"}
                </Text>
                <Text style={[styles.vehicleMeta, { color: colors.textMuted || COLORS.textMid }]}>
                  Last service: {formatShortDate(getVehicleLastService(selectedVehicle)) || getVehicleLastService(selectedVehicle) || "—"}
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
                              { color: colors.text || COLORS.textHigh },
                              isActive && { color: COLORS.primaryAction },
                            ]}
                          >
                            {name}
                          </Text>
                          <Text style={[styles.vehicleReg, { color: colors.textMuted || COLORS.textMid }]}>
                            {reg}
                            {manufacturer || v.model
                              ? ` · ${manufacturer || ""}${
                                  manufacturer && v.model ? " " : ""
                                }${v.model || ""}`
                              : ""}
                          </Text>
                        </View>
                        {isActive && (
                          <Feather
                            name="check-circle"
                            size={18}
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
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
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
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
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
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
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
              <Feather
                name={serviceTypeOpen ? "chevron-up" : "chevron-down"}
                size={16}
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
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
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
          addCheckPhoto={handleAddCheckPhoto}
          removeCheckPhoto={handleRemoveCheckPhoto}
        />

        <ChecklistSection
          title="Safety & chassis"
          hint="Mark green, amber, red or N/A. Notes required for amber/red."
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
          addCheckPhoto={handleAddCheckPhoto}
          removeCheckPhoto={handleRemoveCheckPhoto}
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
          addCheckPhoto={handleAddCheckPhoto}
          removeCheckPhoto={handleRemoveCheckPhoto}
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

        {/* PHOTOS / ATTACHMENTS */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Photos / attachments
          </Text>
          <Text
            style={[
              styles.sectionHint,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Tyre wear, pad condition, damage, etc.
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
              style={[
                styles.photoButton,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
              onPress={handleAddPhotoFromLibrary}
              activeOpacity={0.85}
            >
              <Feather
                name="image"
                size={16}
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
                    <Feather name="x" size={12} color={COLORS.textHigh} />
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
              <Feather
                name="save"
                size={16}
                color={COLORS.textHigh}
                style={{ marginRight: t.spacing.xxs }}
              />
              <Text style={styles.submitText}>
                Save minor service & update vehicle
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </>
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
  addCheckPhoto,
  removeCheckPhoto,
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
            onPressPhoto={() => addCheckPhoto(item)}
            onRemovePhoto={(uri) => removeCheckPhoto(item, uri)}
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
                selectedStatusOption && {
                  backgroundColor: selectedStatusOption.color,
                },
              ]}
            >
              <Feather name="check" size={18} color={COLORS.textHigh} />
            </View>
          ) : (
            <View
              style={[
                styles.checkIconEmpty,
                { borderColor: colors.textMuted || COLORS.textMid },
                na && { opacity: 0.4 },
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
          <Feather name="image" size={16} color={colors.textMuted || COLORS.textMid} />
          {photos.length > 0 && (
            <View style={styles.photoBadge}>
              <Text style={styles.photoBadgeText}>{photos.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <TextArea
        label="Check notes"
        error={noteMissing ? "Notes are required for this status." : undefined}
        placeholder={
          requiresNote
            ? "Notes required for amber/red..."
            : "Notes for this check..."
        }
        value={note}
        onChangeText={onChangeNote}
      />

      {photos.length > 0 && (
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
                <Feather name="x" size={12} color={COLORS.textHigh} />
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
    marginBottom: t.spacing.xs,
  },
  fieldLabel: {
    fontSize: t.typography.metadata.fontSize,
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
    fontSize: t.typography.body.fontSize,
  },
  inputMultiline: {
    minHeight: 90,
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
    paddingVertical: t.spacing.xxs,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: t.typography.body.fontSize,
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
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: t.typography.metadata.fontSize,
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
    width: 26,
    height: 26,
    borderRadius: t.radius.pill,
    borderWidth: 2,
    borderColor: COLORS.textMid,
  },
  checkIconFilled: {
    width: 26,
    height: 26,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: t.typography.bodySmall.fontSize,
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
    minHeight: 30,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
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
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  naPillActive: {
    backgroundColor: staticColors.rgba_1tlzw3k,
    borderColor: COLORS.textMid,
  },
  naText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
  },
  naTextActive: {
    color: COLORS.textMid,
    fontWeight: "600",
  },
  photoIconButton: {
    marginLeft: t.spacing.none,
    width: 30,
    height: 30,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 15,
    height: 15,
    borderRadius: t.radius.sm,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xxs,
  },
  photoBadgeText: {
    color: staticColors.hex_ffffff_5c2ocm,
    fontSize: t.typography.micro.fontSize,
    fontWeight: "800",
  },
  checkNoteInput: {
    marginTop: t.spacing.xxs,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
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
    fontSize: t.typography.body.fontSize,
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
    fontSize: t.typography.body.fontSize,
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
    paddingVertical: t.spacing.sm,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  submitText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: t.typography.bodyLarge.fontSize,
  },
});
