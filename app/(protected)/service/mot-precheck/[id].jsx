import { AppText as Text, AppPressable as TouchableOpacity, FormField as SharedFormField, TextArea } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
//app/(protected)/service/mot-precheck/[id].jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams,
  useNavigation,
  useRouter } from "expo-router";
import {
    collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  } from "firebase/firestore";
import { useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
    ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { formatShortDate } from "../../../../lib/dateDisplay";
import {
  buildVehicleIdentityMirrorUpdate,
  buildVehicleOdometerMirrorUpdate,
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

const PRECHECK_STATUS_OPTIONS = [
  "Ready for MOT",
  "Requires work before MOT",
  "Do not drive – unsafe",
];

/* ---------------- MOT PRE-CHECK CHECKLIST ---------------- */

const CHECK_LIGHTS = [
  "Headlights (dip & main) working",
  "Side lights / DRLs working",
  "Rear lights & number plate light working",
  "Indicators / hazards working",
  "Brake lights & reverse lights working",
  "Fog lights working (if fitted)",
];

const CHECK_VISIBILITY = [
  "Windscreen free from major damage",
  "Wipers clear screen effectively",
  "Screenwash level & operation OK",
  "Mirrors secure and not cracked",
];

const CHECK_TYRES_BRAKES = [
  "Tyre tread above legal limit on all corners",
  "Tyre sidewalls free from cuts / bulges",
  "Wheel nuts present and secure",
  "Footbrake feels normal on road test",
  "Handbrake / parking brake holds vehicle",
];

const CHECK_SAFETY_INTERIOR = [
  "Seat belts latch & retract correctly",
  "Seats secure and adjust/lock correctly",
  "Horn working",
  "Warning lights checked & no critical faults",
  "Airbag / safety system lights OK",
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
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`,
  };
}

function addPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
}

// 🔑 Local storage key for drafts
const MOT_PRECHECK_DRAFTS_KEY = "motPrecheckDrafts_v1";

export default function MotPrecheckScreen() {
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

  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehicleCollapsed, setVehicleCollapsed] = useState(false);

  const now = getNowParts();
  const [precheckDate] = useState(now.date);
  const [precheckTime] = useState(now.time);

  const [odometer, setOdometer] = useState("");
  const [precheckStatus, setPrecheckStatus] = useState("Ready for MOT");
  const [statusOpen, setStatusOpen] = useState(false);

  const [summary, setSummary] = useState("");
  const [faultsFound, setFaultsFound] = useState("");
  const [workRecommended, setWorkRecommended] = useState("");

  const [signedBy, setSignedBy] = useState("");

  const [checks, setChecks] = useState({});
  const [checkRatings, setCheckRatings] = useState({});
  const [checkNA, setCheckNA] = useState({});

  const allChecklistLabels = useMemo(
    () => [
      ...CHECK_LIGHTS,
      ...CHECK_VISIBILITY,
      ...CHECK_TYRES_BRAKES,
      ...CHECK_SAFETY_INTERIOR,
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
        console.error("Failed to load vehicles for MOT pre-check:", err);
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
      precheckStatus !== "Ready for MOT" ||
      !!summary.trim() ||
      !!faultsFound.trim() ||
      !!workRecommended.trim() ||
      !!signedBy.trim() ||
      Object.keys(checks || {}).length > 0 ||
      Object.keys(checkRatings || {}).length > 0 ||
      Object.keys(checkNA || {}).length > 0,
    [
      checkNA,
      checkRatings,
      checks,
      faultsFound,
      odometer,
      precheckStatus,
      selectedVehicleId,
      signedBy,
      summary,
      vehicleSearch,
      workRecommended,
    ]
  );

  const confirmLeave = (onLeave) => {
    if (!hasUnsavedChanges || allowLeaveRef.current) {
      onLeave();
      return;
    }

    Alert.alert(
      "Leave MOT pre-check?",
      "You have unsaved pre-check details. Leave without saving?",
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
        "Leave MOT pre-check?",
        "You have unsaved pre-check details. Leave without saving?",
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

  /* ---------------- LOAD DRAFT ---------------- */

  useEffect(() => {
    const loadDraft = async () => {
      if (!formId) return;
      try {
        const raw = await AsyncStorage.getItem(MOT_PRECHECK_DRAFTS_KEY);
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
        if (draft.precheckStatus) setPrecheckStatus(draft.precheckStatus);
        if (draft.summary) setSummary(draft.summary);
        if (draft.faultsFound) setFaultsFound(draft.faultsFound);
        if (draft.workRecommended) setWorkRecommended(draft.workRecommended);
        if (draft.signedBy) setSignedBy(draft.signedBy);
        if (draft.checks) setChecks(draft.checks);
        if (draft.checkRatings) setCheckRatings(draft.checkRatings);
        if (draft.checkNA) setCheckNA(draft.checkNA);
      } catch (err) {
        console.error("Failed to load MOT pre-check draft:", err);
      }
    };

    loadDraft();
  }, [formId]);

  /* ---------------- AUTO-SAVE DRAFT ---------------- */

  useEffect(() => {
    const saveDraft = async () => {
      if (!formId) return;

      try {
        const vehicleName = getVehicleName(selectedVehicle) || "";
        const registration = getVehicleRegistration(selectedVehicle) || "";

        const hasAnyContent =
          selectedVehicleId ||
          odometer ||
          summary ||
          faultsFound ||
          workRecommended ||
          signedBy ||
          Object.keys(checks).length > 0 ||
          Object.keys(checkRatings).length > 0 ||
          Object.keys(checkNA).length > 0;

        const raw = await AsyncStorage.getItem(MOT_PRECHECK_DRAFTS_KEY);
        const allDrafts = raw ? JSON.parse(raw) || {} : {};

        if (!hasAnyContent) {
          if (allDrafts[formId]) {
            delete allDrafts[formId];
            if (Object.keys(allDrafts).length === 0) {
              await AsyncStorage.removeItem(MOT_PRECHECK_DRAFTS_KEY);
            } else {
              await AsyncStorage.setItem(
                MOT_PRECHECK_DRAFTS_KEY,
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
          precheckStatus,
          precheckDate,
          precheckTime,
          summary,
          faultsFound,
          workRecommended,
          signedBy,
          checks,
          checkRatings,
          checkNA,
        };

        allDrafts[formId] = draftToSave;
        await AsyncStorage.setItem(
          MOT_PRECHECK_DRAFTS_KEY,
          JSON.stringify(allDrafts)
        );
      } catch (err) {
        console.error("Failed to save MOT pre-check draft:", err);
      }
    };

    saveDraft();
  }, [
    formId,
    selectedVehicle,
    selectedVehicleId,
    vehicleSearch,
    odometer,
    precheckStatus,
    precheckDate,
    precheckTime,
    summary,
    faultsFound,
    workRecommended,
    signedBy,
    checks,
    checkRatings,
    checkNA,
  ]);

  /* ---------------- HELPERS ---------------- */

  const handleSelectVehicle = (id) => {
    setSelectedVehicleId(id);
    setVehicleCollapsed(true);
  };

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

  const validate = () => {
    if (!selectedVehicleId) {
      Alert.alert("Select vehicle", "Please choose a vehicle for this check.");
      return false;
    }
    if (!precheckDate.trim()) {
      Alert.alert("Date", "Pre-check date is missing.");
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

  /* ---------------- SUBMIT ---------------- */

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const v = selectedVehicle;
      const odoNumber = odometer ? Number(odometer) : null;
      const precheckDateTime = `${precheckDate} ${precheckTime}`;
      const recordVehicleName = getVehicleName(v) || "";
      const recordRegistration = getVehicleRegistration(v) || "";

      const record = {
        vehicleId: selectedVehicleId,
        vehicleName: recordVehicleName,
        registration: recordRegistration,
        manufacturer: getVehicleManufacturer(v) || "",
        model: v?.model || "",
        precheckDateTime,
        precheckDateOnly: precheckDate,
        precheckTime,
        odometer: odoNumber,
        status: precheckStatus.trim(),
        summary: summary.trim(),
        faultsFound: faultsFound.trim(),
        workRecommended: workRecommended.trim(),
        checks,
        checkRatings,
        checkNA,
        signedBy: signedBy.trim(),
        createdAt: serverTimestamp(),
      };

      const motRef = doc(collection(db, "motPreChecks"));

      const vehicleRef = doc(db, "vehicles", selectedVehicleId);
      const updatePayload = {
        motPrecheckStatus: precheckStatus.trim(),
        motPrecheckDate: precheckDateTime,
        preChecks: {
          checks,
          checkRatings,
          checkNA,
        },
      };
      addPresent(updatePayload, "preChecksSummary", summary.trim());
      addPresent(
        updatePayload,
        "preChecksNotes",
        [faultsFound.trim(), workRecommended.trim()].filter(Boolean).join(" ")
      );
      Object.assign(
        updatePayload,
        buildVehicleIdentityMirrorUpdate({
          ...v,
          name: recordVehicleName,
          registration: recordRegistration,
          manufacturer: getVehicleManufacturer(v) || "",
        })
      );
      if (odoNumber && !Number.isNaN(odoNumber)) {
        Object.assign(updatePayload, buildVehicleOdometerMirrorUpdate(odoNumber));
      }

      const { queued } = await runOrQueueFirestoreMutations([
        {
          run: () => setDoc(motRef, record),
          mutation: {
            operation: "set",
            docPath: `motPreChecks/${motRef.id}`,
            data: record,
            options: { merge: false },
            entityType: "motPreCheck",
            entityId: motRef.id,
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
        upsertServiceRow("motPreChecks", { ...record, id: motRef.id }),
        patchServiceRow("vehicles", selectedVehicleId, updatePayload),
      ]);

      // Clear this draft
      try {
        const raw = await AsyncStorage.getItem(MOT_PRECHECK_DRAFTS_KEY);
        if (raw) {
          const allDrafts = JSON.parse(raw) || {};
          if (allDrafts[formId]) {
            delete allDrafts[formId];
            if (Object.keys(allDrafts).length === 0) {
              await AsyncStorage.removeItem(MOT_PRECHECK_DRAFTS_KEY);
            } else {
              await AsyncStorage.setItem(
                MOT_PRECHECK_DRAFTS_KEY,
                JSON.stringify(allDrafts)
              );
            }
          }
        }
      } catch (e) {
        console.error("Failed to remove MOT pre-check draft after submit:", e);
      }

      Alert.alert(
        queued ? "Saved offline" : "MOT pre-check saved",
        queued
          ? "No internet right now. This MOT pre-check will upload automatically when internet returns."
          : "Pre-check recorded and vehicle updated.",
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
      console.error("Failed to save MOT pre-check:", err);
      Alert.alert("Error", "Could not save MOT pre-check. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- DELETE DRAFT ---------------- */

  const handleDeleteDraft = () => {
    Alert.alert(
      "Delete MOT pre-check?",
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
              const raw = await AsyncStorage.getItem(MOT_PRECHECK_DRAFTS_KEY);
              if (raw) {
                const allDrafts = JSON.parse(raw) || {};
                if (allDrafts[formId]) {
                  delete allDrafts[formId];
                  if (Object.keys(allDrafts).length === 0) {
                    await AsyncStorage.removeItem(MOT_PRECHECK_DRAFTS_KEY);
                  } else {
                    await AsyncStorage.setItem(
                      MOT_PRECHECK_DRAFTS_KEY,
                      JSON.stringify(allDrafts)
                    );
                  }
                }
              }
            } catch (err) {
              console.error("Failed to delete MOT pre-check draft:", err);
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

  /* ---------------- RENDER ---------------- */

  return (
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: "MOT Pre-check",
      subtitle: "Quick safety check before sending vehicle for MOT.",
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
                  Last MOT pre-check: {formatShortDate(selectedVehicle.motPrecheckDate) || selectedVehicle.motPrecheckDate || "—"}
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
                          <Icon
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

        {/* PRE-CHECK DETAILS */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Pre-check details
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
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
              Date (auto)
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
                {precheckDate}
              </Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textMid }]}>
              Time (auto)
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
                {precheckTime}
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
              MOT readiness
            </Text>
            <TouchableOpacity
              style={[
                styles.dropdownHeader,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
              onPress={() => setStatusOpen((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text style={[styles.dropdownText, { color: colors.text || COLORS.textHigh }]}>
                {precheckStatus}
              </Text>
              <Icon
                name={statusOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textMuted || COLORS.textMid}
              />
            </TouchableOpacity>
            {statusOpen && (
              <View
                style={[
                  styles.dropdownList,
                  {
                    backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                {PRECHECK_STATUS_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.dropdownItem,
                      opt === precheckStatus && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      setPrecheckStatus(opt);
                      setStatusOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
	                    <Text
	                      style={[
	                        styles.dropdownItemText,
	                        { color: colors.text || COLORS.textHigh },
	                        opt === precheckStatus && {
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
        </View>

        {/* CHECKLISTS */}
        <ChecklistSection
          title="Lights & signalling"
          hint="Tick / 0–5 (5 = good, 0 = issue) or mark N/A."
          items={CHECK_LIGHTS}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
        />

        <ChecklistSection
          title="Visibility"
          hint="Windscreen, wipers, washers, mirrors."
          items={CHECK_VISIBILITY}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
        />

        <ChecklistSection
          title="Tyres & brakes"
          hint="Legal tread, condition and basic brake feel."
          items={CHECK_TYRES_BRAKES}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
        />

        <ChecklistSection
          title="Interior & safety"
          hint="Seat belts, horn, warning lights."
          items={CHECK_SAFETY_INTERIOR}
          checks={checks}
          checkNA={checkNA}
          checkRatings={checkRatings}
          toggleCheck={toggleCheck}
          toggleNA={toggleNA}
          updateRating={updateRating}
        />

        {/* NOTES */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Notes
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
            label="Summary"
            placeholder="General summary of vehicle condition."
            value={summary}
            onChangeText={setSummary}
            multiline
          />
          <FormField
            label="Faults found"
            placeholder="List any faults likely to cause MOT failure."
            value={faultsFound}
            onChangeText={setFaultsFound}
            multiline
          />
          <FormField
            label="Work recommended"
            placeholder="Repairs or work required before MOT."
            value={workRecommended}
            onChangeText={setWorkRecommended}
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
            Required before vehicle goes for MOT.
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
              By entering your name you confirm this pre-check has been carried
              out to the best of your ability.
            </Text>
          </View>
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
                name="check-circle"
                size={16}
                color={COLORS.textHigh}
                style={{ marginRight: t.spacing.xxs }}
              />
              <Text style={styles.submitText}>
                Save MOT pre-check & update vehicle
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* DELETE DRAFT */}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteDraft}
          activeOpacity={0.9}
        >
          <Icon
            name="trash-2"
            size={16}
            color={COLORS.textHigh}
            style={{ marginRight: t.spacing.xxs }}
          />
          <Text style={styles.deleteText}>Delete pre-check draft</Text>
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
  toggleCheck,
  toggleNA,
  updateRating,
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
            onToggle={() => toggleCheck(item)}
            onToggleNA={() => toggleNA(item)}
            onChangeRating={(val) => updateRating(item, val)}
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
                {
                  borderColor: colors.textMuted || COLORS.textMid,
                },
                disabled && { opacity: 0.4 },
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

      {/* Right: rating 0–5 + N/A */}
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
      </View>
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
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
  },
  checkRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: t.spacing.xxs,
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
    gap: t.spacing.xxs,
  },
  ratingDot: {
    minWidth: 26,
    height: 26,
    borderRadius: t.radius.lg,
    borderWidth: 1.5,
    borderColor: COLORS.lightGray,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xxs,
  },
  ratingDotActive: {
    backgroundColor: staticColors.rgba_mxgb9x,
    borderColor: COLORS.primaryAction,
  },
  ratingText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
  },
  ratingTextActive: {
    color: COLORS.primaryAction,
    fontWeight: "700",
  },
  naPill: {
    marginLeft: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    borderColor: COLORS.lightGray,
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
});
