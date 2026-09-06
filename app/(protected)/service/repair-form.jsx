import { AppButton, AppText as Text, AppPressable as TouchableOpacity, DateField, FormField, TextArea } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
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

import { db } from "../../../firebaseConfig";
import { formatShortDate } from "../../../lib/dateDisplay";
import {
  buildVehicleIdentityMirrorUpdate,
  buildVehicleOdometerMirrorUpdate,
  getVehicleLastService,
  getVehicleManufacturer,
  getVehicleMileage,
  getVehicleName,
  getVehicleRegistration,
} from "../../../lib/fleetSchema";
import { useServiceCacheActions, useServiceCollectionReader } from "../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../lib/sync/firestoreQueue";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
  const readServiceCollection = useServiceCollectionReader();
  const { upsertServiceRow, patchServiceRow } = useServiceCacheActions();
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
        const rows = await readServiceCollection("vehicles", {
          orderByField: "name",
        });
        const list = rows.map((data) => {
          return {
            id: data.id,
            name: getVehicleName(data) || "Unnamed vehicle",
            reg: getVehicleRegistration(data) || "",
            manufacturer: getVehicleManufacturer(data) || "",
            model: data.model || "",
            mileage: getVehicleMileage(data),
            lastService: getVehicleLastService(data) || "",
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
  }, [readServiceCollection]);

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

      const repairRecordRef = doc(collection(db, "serviceRecords"));
      const mutations = [
        {
          run: () => setDoc(repairRecordRef, record),
          mutation: {
            operation: "set",
            docPath: `serviceRecords/${repairRecordRef.id}`,
            data: record,
            options: { merge: false },
            entityType: "serviceRecord",
            entityId: repairRecordRef.id,
          },
        },
      ];

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
          ...buildVehicleIdentityMirrorUpdate({
            ...v,
            name: v?.name || vehicleName.trim(),
            registration: v?.reg || registration.trim(),
            manufacturer: getVehicleManufacturer(v) || "",
          }),
          lastRepair: {
            date: repairDate,
            summary: repairSummary,
            serviceRecordId: repairRecordRef.id,
          },
          repairHistory: arrayUnion(repairHistoryItem),
        };

        if (odoNumber !== null) {
          Object.assign(updatePayload, buildVehicleOdometerMirrorUpdate(odoNumber));
        }
        mutations.push({
          run: () => updateDoc(vehicleRef, updatePayload),
          mutation: {
            operation: "update",
            docPath: `vehicles/${effectiveVehicleId}`,
            data: updatePayload,
            entityType: "vehicle",
            entityId: String(effectiveVehicleId),
          },
        });
      }

      const { queued } = await runOrQueueFirestoreMutations(mutations);
      await upsertServiceRow("serviceRecords", { ...record, id: repairRecordRef.id });
      if (effectiveVehicleId) {
        await patchServiceRow("vehicles", effectiveVehicleId, mutations[1]?.mutation?.data || {});
      }

      Alert.alert(
        queued ? "Saved offline" : "Repair saved",
        queued
          ? "No internet right now. This repair will upload automatically when internet returns."
          : "The general repair has been recorded.",
        [
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
  const themedLabel = { color: colors.textMuted || COLORS.textMid };

  return (
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: "General repairs",
      subtitle: "Record ad-hoc repairs and rectification work against a vehicle.",
      onBack: () => confirmLeave(() => router.back()),
    }}>
      

      <>
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
                  Last service: {formatShortDate(selectedVehicle.lastService) || selectedVehicle.lastService || "-"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <FormField
                label="Search vehicle"
                placeholder="Name, reg, manufacturer or model..."
                value={vehicleSearch}
                onChangeText={setVehicleSearch}
              />

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
                <View
                  style={{ maxHeight: 150, marginTop: t.spacing.xs }}
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
                </View>
              )}
            </>
          )}

          <FormField
            label="Vehicle name"
            style={{ marginTop: t.spacing.sm }}
            placeholder="e.g. Amarok, Silverado..."
            value={vehicleName}
            onChangeText={updateField(setVehicleName)}
          />

          <FormField
            label="Registration"
            placeholder="e.g. AB12 CDE"
            value={registration}
            onChangeText={updateField(setRegistration)}
          />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Repair details
          </Text>
        </View>

        <View style={[styles.card, themedCard]}>

          <DateField
            label="Date completed"
            placeholder="YYYY-MM-DD"
            value={repairDate}
            onChange={updateField(setRepairDate)}
          />

          <TextArea
            label="Repair summary"
            placeholder="e.g. Replaced headlight due to damage"
            value={summary}
            onChangeText={updateField(setSummary)}
          />

          <TextArea
            label="Reason / fault"
            placeholder="Damage, failed bulb, customer request, wear and tear..."
            value={reason}
            onChangeText={updateField(setReason)}
          />

          <FormField
            label="Parts used"
            placeholder="e.g. N/S headlight unit, bulb, clips"
            value={partsUsed}
            onChangeText={updateField(setPartsUsed)}
          />

          <FormField
            label="Mileage"
            placeholder="Current mileage"
            value={mileage}
            onChangeText={updateField(setMileage)}
            inputProps={{ keyboardType: "numeric" }}
          />

          <FormField
            label="Completed by"
            placeholder="Technician name"
            value={completedBy}
            onChangeText={updateField(setCompletedBy)}
          />

          <TextArea
            label="Additional notes"
            placeholder="Anything useful for future reference..."
            value={notes}
            onChangeText={updateField(setNotes)}
          />
        </View>

        <AppButton
          label="Save repair"
          icon="check-circle"
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          fullWidth
        />
      </>
    </PageShell>
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  title: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  subtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  content: {
    padding: t.spacing.md,
    paddingBottom: 110,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xs,
  },
  sectionTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: t.radius.md,
    backgroundColor: COLORS.card,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  label: {
    marginBottom: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
    color: COLORS.textMid,
  },
  labelSmall: {
    marginBottom: t.spacing.xxs,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    textTransform: "uppercase",
    color: COLORS.textMid,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: t.radius.sm,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    marginBottom: t.spacing.sm,
    fontSize: t.typography.body.fontSize,
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
    borderRadius: t.radius.sm,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    paddingHorizontal: t.spacing.xs,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: t.typography.body.fontSize,
  },
  centerRow: {
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  selectedVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  vehicleMetaRow: {
    marginTop: t.spacing.xs,
  },
  vehicleMeta: {
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  vehicleRowActive: {
    backgroundColor: staticColors.rgba_qyx95c,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
  },
  vehicleName: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  sectionTitleAlt: {
    marginBottom: t.spacing.sm,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  saveButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    backgroundColor: COLORS.primaryAction,
  },
  saveButtonText: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
});
