import { AppText as Text, AppPressable as TouchableOpacity, TextArea } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
// app/(protected)/service/service-form/vehicle-prep.jsx (or your actual path)
import { Feather } from "@expo/vector-icons";
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


import { db } from "../../../../firebaseConfig";
import { useServiceCacheActions } from "../../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../../lib/sync/firestoreQueue";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

const DEFAULT_CHECKS = [
  "Exterior walk-around (damage / dents)",
  "Tyres & tread depth checked",
  "Fluids (oil / screenwash / coolant)",
  "Lights & indicators working",
  "Number plates & tax disk visible",
  "Safety kit loaded (cones / triangles / hi-vis)",
  "In-vehicle documents (insurance / breakdown)",
  "Fuel level OK for job",
];

export default function VehiclePrepScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { upsertServiceRow, patchServiceRow } = useServiceCacheActions();
  const params = useLocalSearchParams();
  const allowLeaveRef = useRef(false);

  const [checks, setChecks] = useState(
    DEFAULT_CHECKS.map((label, idx) => ({
      id: `check-${idx}`,
      label,
      done: false,
    }))
  );

  const rawEquipment =
    params.equipment ||
    params.equipmentList ||
    params.equipmentNames ||
    "";

  const initialEquipmentChecks = (() => {
    if (!rawEquipment) return [];

    let items = [];

    if (Array.isArray(rawEquipment)) {
      items = rawEquipment;
    } else if (typeof rawEquipment === "string") {
      const trimmed = rawEquipment.trim();
      if (!trimmed) return [];

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) items = parsed;
        else items = trimmed.split(/[;,]/);
      } catch {
        items = trimmed.split(/[;,]/);
      }
    }

    const labels = items
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    return labels.map((label, idx) => ({
      id: `equip-${idx}`,
      label,
      done: false,
    }));
  })();

  const [equipmentChecks, setEquipmentChecks] = useState(
    initialEquipmentChecks
  );

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const vehicleId = Array.isArray(params.id) ? params.id[0] : params.id;
  const vehicleName = params.vehicleName || "";
  const registration = params.registration || "";
  const dateStr = params.date || "";

  const dateLabel = dateStr
    ? new Date(dateStr).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

  const toggleCheck = (id) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, done: !c.done } : c))
    );
  };

  const toggleEquipmentCheck = (id) => {
    setEquipmentChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, done: !c.done } : c))
    );
  };

  const allVehicleChecksDone = checks.every((c) => c.done);
  const allEquipmentDone =
    equipmentChecks.length === 0 || equipmentChecks.every((c) => c.done);

  const allDone = allVehicleChecksDone && allEquipmentDone;

  const equipmentSummary =
    equipmentChecks.length > 0
      ? equipmentChecks.map((e) => e.label).join(", ")
      : "";

  const hasUnsavedChanges = useMemo(
    () =>
      checks.some((check) => check.done) ||
      equipmentChecks.some((check) => check.done) ||
      !!notes.trim(),
    [checks, equipmentChecks, notes]
  );

  const confirmLeave = (onLeave) => {
    if (!hasUnsavedChanges || allowLeaveRef.current) {
      onLeave();
      return;
    }

    Alert.alert(
      "Leave vehicle prep?",
      "You have unsaved prep details. Leave without saving?",
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
        "Leave vehicle prep?",
        "You have unsaved prep details. Leave without saving?",
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

  const handleSave = async (markComplete = false) => {
    if (markComplete && !allDone) return;

    setSaving(true);
    try {
      const record = {
        vehicleId: vehicleId || null,
        vehicleName: String(vehicleName || ""),
        registration: String(registration || ""),
        prepDate: String(dateStr || ""),
        checks,
        equipmentChecks,
        notes: notes.trim(),
        completed: !!markComplete,
        completedAt: markComplete ? serverTimestamp() : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const prepRef = doc(collection(db, "vehiclePrepRecords"));
      const mutations = [
        {
          run: () => setDoc(prepRef, record),
          mutation: {
            operation: "set",
            docPath: `vehiclePrepRecords/${prepRef.id}`,
            data: record,
            options: { merge: false },
            entityType: "vehiclePrepRecord",
            entityId: prepRef.id,
          },
        },
      ];

      if (vehicleId && vehicleId !== "vehicle") {
        const summary = {
          prepDate: String(dateStr || ""),
          vehicleName: String(vehicleName || ""),
          registration: String(registration || ""),
          completed: !!markComplete,
          notes: notes.trim(),
          recordedAt: new Date(),
        };

        const vehicleUpdate = {
          lastVehiclePrep: summary,
          prepHistory: arrayUnion(summary),
        };
        mutations.push({
          run: () => updateDoc(doc(db, "vehicles", String(vehicleId)), vehicleUpdate),
          mutation: {
            operation: "update",
            docPath: `vehicles/${vehicleId}`,
            data: vehicleUpdate,
            entityType: "vehicle",
            entityId: String(vehicleId),
          },
        });
      }

      const { queued } = await runOrQueueFirestoreMutations(mutations);
      await upsertServiceRow("vehiclePrepRecords", { ...record, id: prepRef.id });
      if (vehicleId && vehicleId !== "vehicle" && mutations[1]?.mutation?.data) {
        await patchServiceRow("vehicles", vehicleId, mutations[1].mutation.data);
      }

      Alert.alert(
        queued ? "Saved offline" : markComplete ? "Vehicle prepped" : "Prep saved",
        queued
          ? "No internet right now. This vehicle prep will upload automatically when internet returns."
          : markComplete
          ? "The vehicle prep has been recorded."
          : "The vehicle prep notes have been saved.",
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
      console.error("Failed to save vehicle prep:", err);
      Alert.alert("Error", "Could not save this vehicle prep. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: "Vehicle prep",
      subtitle: "Tick off checks before this vehicle leaves the yard.",
      onBack: () => confirmLeave(() => router.back()),
    }}>
      {/* HEADER */}
      

      <>
        {/* SUMMARY */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Vehicle</Text>
          <Text style={styles.summaryMain}>
            {vehicleName || "Vehicle"}
            {registration ? ` · ${registration}` : ""}
          </Text>

          {dateLabel ? (
            <>
              <Text style={[styles.summaryLabel, { marginTop: t.spacing.xs }]}>
                Going out
              </Text>
              <Text style={styles.summaryDate}>{dateLabel}</Text>
            </>
          ) : null}

          {equipmentSummary ? (
            <>
              <Text style={[styles.summaryLabel, { marginTop: t.spacing.xs }]}>
                Equipment on job
              </Text>
              <Text style={styles.summaryEquipment}>{equipmentSummary}</Text>
            </>
          ) : null}
        </View>

        {/* VEHICLE CHECKS */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Prep checks</Text>
          <Text style={styles.sectionSubtitle}>
            Tap to mark complete / reopen.
          </Text>
        </View>

        <View style={styles.card}>
          {checks.map((c, idx) => (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.checkRow,
                idx === 0 && { borderTopWidth: 0 },
                c.done && { opacity: 0.7 },
              ]}
              activeOpacity={0.85}
              onPress={() => toggleCheck(c.id)}
            >
              <View style={styles.checkIconWrap}>
                {c.done ? (
                  <View style={styles.checkFilled}>
                    <Feather name="check" size={14} color={COLORS.textHigh} />
                  </View>
                ) : (
                  <View style={styles.checkEmpty} />
                )}
              </View>
              <Text
                style={[
                  styles.checkLabel,
                  c.done && {
                    textDecorationLine: "line-through",
                    color: COLORS.textMid,
                  },
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* EQUIPMENT */}
        {equipmentChecks.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Equipment load-out</Text>
              <Text style={styles.sectionSubtitle}>
                Make sure all job kit is on the vehicle.
              </Text>
            </View>

            <View style={styles.card}>
              {equipmentChecks.map((c, idx) => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.checkRow,
                    idx === 0 && { borderTopWidth: 0 },
                    c.done && { opacity: 0.7 },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => toggleEquipmentCheck(c.id)}
                >
                  <View style={styles.checkIconWrap}>
                    {c.done ? (
                      <View style={styles.checkFilled}>
                        <Feather
                          name="check"
                          size={14}
                          color={COLORS.textHigh}
                        />
                      </View>
                    ) : (
                      <View style={styles.checkEmpty} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.checkLabel,
                      c.done && {
                        textDecorationLine: "line-through",
                        color: COLORS.textMid,
                      },
                    ]}
                  >
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* NOTES */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.sectionSubtitle}>
            Damage, missing kit, or anything unusual.
          </Text>
        </View>

        <View style={styles.card}>
          <TextArea
            label="Notes"
            placeholder="e.g. Small scuff on rear bumper, photographed and logged."
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* ACTION BUTTONS */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { borderColor: COLORS.lightGray },
            ]}
            onPress={() => handleSave(false)}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryButtonText}>
              {saving ? "Saving…" : "Save & back"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor: allDone
                  ? COLORS.primaryAction
                  : COLORS.lightGray,
              },
            ]}
            onPress={() => handleSave(true)}
            disabled={!allDone || saving}
            activeOpacity={0.9}
          >
            {saving ? (
              <ActivityIndicator
                size="small"
                color={COLORS.textHigh}
                style={{ marginRight: t.spacing.xxs }}
              />
            ) : (
              <Feather
                name="check-circle"
                size={16}
                color={COLORS.textHigh}
                style={{ marginRight: t.spacing.xxs }}
              />
            )}
            <Text style={styles.primaryButtonText}>
              {saving ? "Saving…" : "Mark vehicle prepped"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
    paddingVertical: t.spacing.xxs,
  },
  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: t.typography.metadata.fontSize,
    marginTop: t.spacing.none,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
  },

  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
    color: COLORS.textLow,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summaryMain: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginTop: t.spacing.none,
  },
  summaryDate: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  summaryEquipment: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "500",
    color: COLORS.textMid,
    marginTop: t.spacing.none,
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
  sectionSubtitle: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    marginBottom: t.spacing.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: t.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  checkIconWrap: {
    paddingRight: t.spacing.xs,
    paddingTop: t.spacing.xxs,
  },
  checkEmpty: {
    width: 20,
    height: 20,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    borderColor: COLORS.textMid,
  },
  checkFilled: {
    width: 20,
    height: 20,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: t.typography.body.fontSize,
    color: COLORS.textHigh,
    fontWeight: "500",
  },

  notesInput: {
    minHeight: 100,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    backgroundColor: COLORS.inputBg,
    color: COLORS.textHigh,
    fontSize: t.typography.body.fontSize,
    textAlignVertical: "top",
  },

  buttonRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.xxs,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    paddingVertical: t.spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
  },
  primaryButton: {
    flex: 1.4,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
});
