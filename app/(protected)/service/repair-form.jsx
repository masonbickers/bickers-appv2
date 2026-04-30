import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import { db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  inputBg: "#1F1F1F",
  primaryAction: "#ED1C25",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
}

function buildRepairHistoryItem({
  completedDate,
  repairRecordId,
  summary,
  reason,
  odometer,
  partsUsed,
  completedBy,
}) {
  return {
    type: "General repair",
    completedDate,
    repairRecordId,
    serviceRecordId: repairRecordId,
    notes: [summary, reason].filter(Boolean).join(" - "),
    odometer,
    partsUsed,
    completedBy,
    recordedAt: new Date().toISOString(),
  };
}

export default function RepairFormRoute() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const allowLeaveRef = useRef(false);

  const initialVehicleId = params.vehicleId || params.id || null;
  const initialVehicleName = params.vehicleName || params.name || "";
  const initialRegistration = params.registration || params.reg || "";

  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(
    initialVehicleId ? String(initialVehicleId) : null
  );
  const [vehicleCollapsed, setVehicleCollapsed] = useState(!!initialVehicleId);

  const [vehicleName, setVehicleName] = useState(String(initialVehicleName || ""));
  const [registration, setRegistration] = useState(
    String(initialRegistration || "")
  );
  const [repairDate, setRepairDate] = useState(todayISO());
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [mileage, setMileage] = useState("");
  const [completedBy, setCompletedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [userEdited, setUserEdited] = useState(false);

  useEffect(() => {
    const loadVehicles = async () => {
      try {
        setLoadingVehicles(true);
        const q = query(collection(db, "vehicles"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            name: data.name || data.vehicleName || "Unnamed vehicle",
            reg: data.registration || data.reg || "",
            manufacturer: data.manufacturer || "",
            model: data.model || "",
            mileage: data.mileage,
            lastService: data.lastService || "",
          };
        });
        setVehicles(list);
      } catch (err) {
        console.error("Failed to load vehicles for repair form:", err);
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
      const name = (v.name || "").toLowerCase();
      const reg = (v.reg || "").toLowerCase();
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

  const hasUnsavedChanges = userEdited;

  useEffect(() => {
    if (!selectedVehicle) return;
    setVehicleName(selectedVehicle.name || "");
    setRegistration(selectedVehicle.reg || "");
    setMileage((prev) => prev || (selectedVehicle.mileage ? String(selectedVehicle.mileage) : ""));
  }, [selectedVehicle]);

  const handleSelectVehicle = (id) => {
    setUserEdited(true);
    setSelectedVehicleId(id);
    setVehicleCollapsed(true);
  };

  const updateField = (setter) => (value) => {
    setUserEdited(true);
    setter(value);
  };

  const confirmLeave = (onLeave) => {
    if (!hasUnsavedChanges || allowLeaveRef.current) {
      onLeave();
      return;
    }

    Alert.alert(
      "Discard repair?",
      "You have unsaved repair details. Leave without saving?",
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
        "Discard repair?",
        "You have unsaved repair details. Leave without saving?",
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

  const handleSave = async () => {
    const repairSummary = summary.trim();
    const effectiveVehicleId =
      selectedVehicleId || (initialVehicleId && String(initialVehicleId)) || null;
    const odoNumber = mileage.trim() ? Number(mileage.trim()) : null;

    if (!effectiveVehicleId && !vehicleName.trim() && !registration.trim()) {
      Alert.alert(
        "Vehicle details",
        "Select a vehicle or enter at least a vehicle name or registration."
      );
      return;
    }

    if (!repairSummary) {
      Alert.alert(
        "Repair summary",
        "Add a short summary, for example replaced headlight due to damage."
      );
      return;
    }

    if (odoNumber !== null && Number.isNaN(odoNumber)) {
      Alert.alert("Mileage", "Mileage must be a number.");
      return;
    }

    try {
      setSaving(true);
      const v = selectedVehicle;
      const record = {
        vehicleId: effectiveVehicleId,
        vehicleName: vehicleName.trim(),
        registration: registration.trim(),
        manufacturer: v?.manufacturer || "",
        model: v?.model || "",
        serviceType: "General repair",
        recordType: "repair",
        serviceDate: repairDate,
        serviceDateOnly: repairDate,
        completedDate: repairDate,
        odometer: odoNumber,
        workSummary: repairSummary,
        repairSummary,
        repairReason: reason.trim(),
        partsUsed: partsUsed.trim(),
        extraNotes: notes.trim(),
        signedBy: completedBy.trim(),
        completedBy: completedBy.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const repairRecordRef = await addDoc(collection(db, "serviceRecords"), record);

      if (effectiveVehicleId) {
        const vehicleRef = doc(db, "vehicles", String(effectiveVehicleId));
        const repairHistoryItem = buildRepairHistoryItem({
          completedDate: repairDate,
          repairRecordId: repairRecordRef.id,
          summary: repairSummary,
          reason: reason.trim(),
          odometer: odoNumber,
          partsUsed: partsUsed.trim(),
          completedBy: completedBy.trim(),
        });
        const updatePayload = {
          lastRepair: {
            date: repairDate,
            summary: repairSummary,
            serviceRecordId: repairRecordRef.id,
          },
          repairHistory: arrayUnion(repairHistoryItem),
        };

        addPresent(updatePayload, "name", v?.name || vehicleName.trim());
        addPresent(updatePayload, "vehicleName", v?.name || vehicleName.trim());
        addPresent(updatePayload, "registration", v?.reg || registration.trim());
        addPresent(updatePayload, "reg", v?.reg || registration.trim());
        addPresent(updatePayload, "manufacturer", v?.manufacturer || "");
        addPresent(updatePayload, "model", v?.model || "");
        if (odoNumber !== null) {
          updatePayload.mileage = odoNumber;
        }

        await updateDoc(vehicleRef, updatePayload);
      }

      Alert.alert("Repair saved", "The general repair has been recorded.", [
        {
          text: "OK",
          onPress: () => {
            allowLeaveRef.current = true;
            router.back();
          },
        },
      ]);
    } catch (err) {
      console.error("Failed to save repair record:", err);
      Alert.alert("Error", "Could not save this repair. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const themedCard = {
    backgroundColor: colors.surfaceAlt || COLORS.card,
    borderColor: colors.border || COLORS.border,
  };
  const themedInput = {
    backgroundColor: colors.inputBackground || COLORS.inputBg,
    borderColor: colors.inputBorder || colors.border || COLORS.border,
    color: colors.text || COLORS.textHigh,
  };
  const themedLabel = { color: colors.textMuted || COLORS.textMid };

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => confirmLeave(() => router.back())}
          style={styles.backButton}
          activeOpacity={0.8}
        >
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text || COLORS.textHigh }]}>
            General repairs
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Record ad-hoc repairs and rectification work against a vehicle.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
              <Text style={[styles.sectionHint, { color: COLORS.primaryAction }]}>
                Change
              </Text>
            </TouchableOpacity>
          ) : loadingVehicles ? (
            <Text style={[styles.sectionHint, themedLabel]}>Loading fleet...</Text>
          ) : null}
        </View>

        <View style={[styles.card, themedCard]}>
          {vehicleCollapsed && selectedVehicle ? (
            <>
              <Text style={[styles.labelSmall, themedLabel]}>Selected vehicle</Text>
              <View style={styles.selectedVehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.vehicleName,
                      { color: colors.text || COLORS.textHigh },
                    ]}
                  >
                    {selectedVehicle.name || "Unnamed vehicle"}
                  </Text>
                  <Text style={[styles.vehicleReg, themedLabel]}>
                    {selectedVehicle.reg || "-"}
                  </Text>
                </View>
              </View>
              <View style={styles.vehicleMetaRow}>
                <Text style={[styles.vehicleMeta, themedLabel]}>
                  Current mileage:{" "}
                  {typeof selectedVehicle.mileage === "number"
                    ? `${selectedVehicle.mileage.toLocaleString("en-GB")} mi`
                    : "-"}
                </Text>
                <Text style={[styles.vehicleMeta, themedLabel]}>
                  Last service: {selectedVehicle.lastService || "-"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.label, themedLabel]}>Search vehicle</Text>
              <View style={[styles.searchBox, themedInput]}>
                <Icon
                  name="search"
                  size={16}
                  color={colors.textMuted || COLORS.textMid}
                  style={{ marginRight: 6 }}
                />
                <TextInput
                  style={[
                    styles.searchInput,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                  placeholder="Name, reg, manufacturer or model..."
                  placeholderTextColor={colors.textMuted || COLORS.textLow}
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
                  <Text style={[styles.emptyText, themedLabel]}>
                    No vehicles match this search.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={{ maxHeight: 180, marginTop: 8 }}
                  nestedScrollEnabled
                >
                  {filteredVehicles.map((v) => {
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
                            {v.name || "Unnamed vehicle"}
                          </Text>
                          <Text style={[styles.vehicleReg, themedLabel]}>
                            {v.reg || ""}
                            {v.manufacturer || v.model
                              ? ` - ${v.manufacturer || ""}${
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

          <Text style={[styles.label, themedLabel, { marginTop: 12 }]}>
            Vehicle name
          </Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="e.g. Amarok, Silverado..."
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={vehicleName}
            onChangeText={updateField(setVehicleName)}
          />

          <Text style={[styles.label, themedLabel]}>Registration</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="e.g. AB12 CDE"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={registration}
            onChangeText={updateField(setRegistration)}
          />
        </View>

        <View style={[styles.card, themedCard]}>
          <Text
            style={[
              styles.sectionTitleAlt,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Repair details
          </Text>

          <Text style={[styles.label, themedLabel]}>Date completed</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={repairDate}
            onChangeText={updateField(setRepairDate)}
          />

          <Text style={[styles.label, themedLabel]}>Repair summary</Text>
          <TextInput
            style={[styles.input, themedInput, styles.multiline]}
            placeholder="e.g. Replaced headlight due to damage"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={summary}
            onChangeText={updateField(setSummary)}
            multiline
          />

          <Text style={[styles.label, themedLabel]}>Reason / fault</Text>
          <TextInput
            style={[styles.input, themedInput, styles.multiline]}
            placeholder="Damage, failed bulb, customer request, wear and tear..."
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={reason}
            onChangeText={updateField(setReason)}
            multiline
          />

          <Text style={[styles.label, themedLabel]}>Parts used</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="e.g. N/S headlight unit, bulb, clips"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={partsUsed}
            onChangeText={updateField(setPartsUsed)}
          />

          <Text style={[styles.label, themedLabel]}>Mileage</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="Current mileage"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={mileage}
            onChangeText={updateField(setMileage)}
            keyboardType="numeric"
          />

          <Text style={[styles.label, themedLabel]}>Completed by</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="Technician name"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={completedBy}
            onChangeText={updateField(setCompletedBy)}
          />

          <Text style={[styles.label, themedLabel]}>Additional notes</Text>
          <TextInput
            style={[styles.input, themedInput, styles.multiline]}
            placeholder="Anything useful for future reference..."
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={notes}
            onChangeText={updateField(setNotes)}
            multiline
          />
        </View>

        <TouchableOpacity
          style={[
            styles.saveButton,
            {
              backgroundColor: saving ? colors.border || COLORS.border : COLORS.primaryAction,
            },
          ]}
          onPress={handleSave}
          activeOpacity={0.9}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator
              size="small"
              color={colors.text || COLORS.textHigh}
              style={{ marginRight: 8 }}
            />
          ) : (
            <Icon
              name="check-circle"
              size={18}
              color={colors.text || COLORS.textHigh}
              style={{ marginRight: 8 }}
            />
          )}
          <Text style={[styles.saveButtonText, { color: COLORS.textHigh }]}>
            {saving ? "Saving..." : "Save repair"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

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
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  content: {
    padding: 16,
    paddingBottom: 34,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    padding: 14,
    marginBottom: 14,
  },
  label: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMid,
  },
  labelSmall: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    color: COLORS.textMid,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
    color: COLORS.textHigh,
  },
  multiline: {
    minHeight: 86,
    textAlignVertical: "top",
  },
  searchBox: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 14,
  },
  centerRow: {
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  selectedVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  vehicleMetaRow: {
    marginTop: 8,
  },
  vehicleMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  vehicleRowActive: {
    backgroundColor: "rgba(237,28,37,0.08)",
  },
  vehicleName: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  sectionTitleAlt: {
    marginBottom: 12,
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  saveButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.primaryAction,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
});
