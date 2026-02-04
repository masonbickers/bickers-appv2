//app/(protected)/service/mot-precheck/[id].jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    addDoc,
    collection,
    doc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

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

// 🔑 Local storage key for drafts
const MOT_PRECHECK_DRAFTS_KEY = "motPrecheckDrafts_v1";

export default function MotPrecheckScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const formId = Array.isArray(id) ? id[0] : id;

  const { colors } = useTheme();

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
        const q = query(collection(db, "vehicles"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setVehicles(list);
      } catch (err) {
        console.error("Failed to load vehicles for MOT pre-check:", err);
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
        const vehicleName =
          selectedVehicle?.name || selectedVehicle?.vehicleName || "";
        const registration =
          selectedVehicle?.registration || selectedVehicle?.reg || "";

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

      const record = {
        vehicleId: selectedVehicleId,
        vehicleName: v?.name || v?.vehicleName || "",
        registration: v?.registration || v?.reg || "",
        manufacturer: v?.manufacturer || "",
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

      await addDoc(collection(db, "motPreChecks"), record);

      const vehicleRef = doc(db, "vehicles", selectedVehicleId);
      const updatePayload = {
        motPrecheckStatus: precheckStatus.trim(),
        motPrecheckDate: precheckDateTime,
      };
      if (odoNumber && !Number.isNaN(odoNumber)) {
        updatePayload.mileage = odoNumber;
      }

      await updateDoc(vehicleRef, updatePayload);

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
        "MOT pre-check saved",
        "Pre-check recorded and vehicle updated.",
        [{ text: "OK", onPress: () => router.back() }]
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
              router.back();
            }
          },
        },
      ]
    );
  };

  /* ---------------- RENDER ---------------- */

  return (
    <SafeAreaView
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
            MOT Pre-check
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Quick safety check before sending vehicle for MOT.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* CONTEXT CARD */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderLeftColor: COLORS.primaryAction,
            },
          ]}
        >
          <Text
            style={[
              styles.infoTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            MOT readiness
          </Text>
          <Text
            style={[
              styles.infoSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Check lights, tyres, brakes and key safety items. Mark issues or
            N/A, then record whether the vehicle is ready for MOT.
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

        <View style={styles.card}>
          {vehicleCollapsed && selectedVehicle ? (
            <>
              <Text style={styles.fieldLabel}>Selected vehicle</Text>
              <View style={styles.selectedVehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicleName}>
                    {selectedVehicle.name ||
                      selectedVehicle.vehicleName ||
                      "Unnamed vehicle"}
                  </Text>
                  <Text style={styles.vehicleReg}>
                    {selectedVehicle.registration || selectedVehicle.reg || "—"}
                  </Text>
                </View>
              </View>
              <View style={styles.vehicleMetaRow}>
                <Text style={styles.vehicleMeta}>
                  Current mileage:{" "}
                  {typeof selectedVehicle.mileage === "number"
                    ? `${selectedVehicle.mileage.toLocaleString("en-GB")} mi`
                    : "—"}
                </Text>
                <Text style={styles.vehicleMeta}>
                  Last MOT pre-check: {selectedVehicle.motPrecheckDate || "—"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Search vehicle</Text>
              <View style={styles.searchBox}>
                <Icon
                  name="search"
                  size={16}
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
                              isActive && { color: COLORS.primaryAction },
                            ]}
                          >
                            {name}
                          </Text>
                          <Text style={styles.vehicleReg}>
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
                            size={18}
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

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Date (auto)</Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{precheckDate}</Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Time (auto)</Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{precheckTime}</Text>
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
            <Text style={styles.fieldLabel}>MOT readiness</Text>
            <TouchableOpacity
              style={styles.dropdownHeader}
              onPress={() => setStatusOpen((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownText}>{precheckStatus}</Text>
              <Icon
                name={statusOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={COLORS.textMid}
              />
            </TouchableOpacity>
            {statusOpen && (
              <View style={styles.dropdownList}>
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

        <View style={styles.card}>
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

        <View style={styles.card}>
          <FormField
            label="Technician signature (name)"
            placeholder="Type name as signature"
            value={signedBy}
            onChangeText={setSignedBy}
          />
          <View style={{ marginTop: 6 }}>
            <Text style={styles.signatureInfo}>
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
                style={{ marginRight: 6 }}
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
            style={{ marginRight: 6 }}
          />
          <Text style={styles.deleteText}>Delete pre-check draft</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
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
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textLow}
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

      <View style={styles.card}>
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
            checked && { color: COLORS.textHigh },
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 18,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: 15,
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
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldGroup: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
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
    paddingVertical: 8,
    fontSize: 14,
  },
  inputMultiline: {
    minHeight: 90,
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
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: 12,
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
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
  },
  checkRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 6,
  },
  checkIconWrap: {
    paddingRight: 8,
  },
  checkIconEmpty: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: COLORS.textMid,
  },
  checkIconFilled: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textLow,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingDot: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: COLORS.lightGray,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  ratingDotActive: {
    backgroundColor: "rgba(255,59,48,0.16)",
    borderColor: COLORS.primaryAction,
  },
  ratingText: {
    fontSize: 12,
    color: COLORS.textLow,
  },
  ratingTextActive: {
    color: COLORS.primaryAction,
    fontWeight: "700",
  },
  naPill: {
    marginLeft: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLORS.lightGray,
  },
  naPillActive: {
    backgroundColor: "rgba(142,142,147,0.2)",
    borderColor: COLORS.textMid,
  },
  naText: {
    fontSize: 12,
    color: COLORS.textLow,
  },
  naTextActive: {
    color: COLORS.textMid,
    fontWeight: "600",
  },
  dropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "space-between",
  },
  dropdownText: {
    color: COLORS.textHigh,
    fontSize: 14,
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
    paddingVertical: 8,
  },
  dropdownItemActive: {
    backgroundColor: "rgba(255,59,48,0.12)",
  },
  dropdownItemText: {
    fontSize: 14,
    color: COLORS.textHigh,
  },
  signatureInfo: {
    fontSize: 11,
    color: COLORS.textMid,
  },
  submitButton: {
    marginTop: 10,
    backgroundColor: COLORS.primaryAction,
    borderRadius: 10,
    paddingVertical: 14,
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
});
