import { AppText as Text, AppPressable as TouchableOpacity, TextArea } from "../../../components/ui/AppPrimitives";
// app/(protected)/service/vehicle-prep.jsx
import {
  useLocalSearchParams,
  useRouter } from "expo-router";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";
import { db } from "../../../firebaseConfig";
import { useCompanyCollection } from "../../../hooks/useOperationalData";
import { runOrQueueFirestoreMutation } from "../../../lib/sync/firestoreQueue";
import {
  buildVehiclePrepRecordId,
  findVehiclePrepRecord,
} from "../../../lib/vehiclePrep";
import { useAuth } from "../../../providers/AuthProvider";

/* ---------- SAME COLOUR MAP AS SERVICE-LIST.JSX ---------- */

const COLORS = {
  background: staticColors.hex_0d0d0d_af235e,
  card: staticColors.hex_1a1a1a_8nhjiu,
  border: staticColors.hex_333333_8y2gva,
  textHigh: staticColors.hex_ffffff_5c2ocm,
  textMid: staticColors.hex_e0e0e0_5lga4z,
  textLow: staticColors.hex_888888_dds7pi,
  primaryAction: staticColors.hex_ed1c25_4py4qa,
  inputBg: staticColors.hex_1a1a1a_8nhjiu,
  chipBg: staticColors.hex_1f1f1f_8imrm9,
  chipBorder: staticColors.hex_3a3a3a_9vb0wk,
};

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
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const { user, employee } = useAuth();
  const prepRecordsResource = useCompanyCollection("vehiclePrepRecords");

  /* ---------- CHECKLIST STATE ---------- */

  const [checks, setChecks] = useState(
    DEFAULT_CHECKS.map((label, idx) => ({ id: `check-${idx}`, label, done: false }))
  );

  /* ---------- EQUIPMENT PARSING ---------- */

  const rawEquipment =
    params.equipment || params.equipmentList || params.equipmentNames || "";

  const initialEquipmentChecks = (() => {
    if (!rawEquipment) return [];

    let items = [];

    if (Array.isArray(rawEquipment)) items = rawEquipment;
    else if (typeof rawEquipment === "string") {
      const trimmed = rawEquipment.trim();
      if (!trimmed) return [];

      try {
        const parsed = JSON.parse(trimmed);
        items = Array.isArray(parsed) ? parsed : trimmed.split(/[;,]/);
      } catch {
        items = trimmed.split(/[;,]/);
      }
    }

    return items
      .map((x, idx) => ({
        id: `equip-${idx}`,
        label: String(x || "").trim(),
        done: false,
      }))
      .filter((x) => x.label);
  })();

  const [equipmentChecks, setEquipmentChecks] = useState(initialEquipmentChecks);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [hydratedRecordId, setHydratedRecordId] = useState("");

  /* ---------- PARAMS ---------- */

  const paramValue = (value) => String(Array.isArray(value) ? value[0] || "" : value || "");
  const vehicleId = paramValue(params.vehicleId || params.id);
  const bookingId = paramValue(params.bookingId);
  const vehicleName = paramValue(params.vehicleName);
  const registration = paramValue(params.registration);
  const dateStr = paramValue(params.date);
  const prepRecordId = useMemo(
    () => buildVehiclePrepRecordId(bookingId, vehicleId),
    [bookingId, vehicleId]
  );
  const existingRecord = useMemo(
    () =>
      findVehiclePrepRecord(prepRecordsResource.data, {
        bookingId,
        vehicleId,
        date: dateStr,
      }),
    [bookingId, dateStr, prepRecordsResource.data, vehicleId]
  );

  const dateLabel = dateStr
    ? new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

  /* ---------- LOGIC ---------- */

  const toggleCheck = (id) =>
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, done: !c.done } : c)));

  const toggleEquipmentCheck = (id) =>
    setEquipmentChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, done: !c.done } : c))
    );

  const allVehicleChecksDone = checks.every((c) => c.done);
  const allEquipmentDone =
    equipmentChecks.length === 0 || equipmentChecks.every((c) => c.done);

  const allDone = allVehicleChecksDone && allEquipmentDone;

  useEffect(() => {
    if (!existingRecord || hydratedRecordId === existingRecord.id) return;

    const savedChecks = Array.isArray(existingRecord.checks) ? existingRecord.checks : [];
    setChecks(
      DEFAULT_CHECKS.map((label, idx) => {
        const id = `check-${idx}`;
        const saved = savedChecks.find((check) => check?.id === id || check?.label === label);
        return { id, label, done: saved?.done === true };
      })
    );
    if (Array.isArray(existingRecord.equipmentChecks)) {
      setEquipmentChecks(existingRecord.equipmentChecks);
    }
    setNotes(String(existingRecord.notes || ""));
    setHydratedRecordId(existingRecord.id);
  }, [existingRecord, hydratedRecordId]);

  const handleSave = async (markComplete) => {
    if (saving || (markComplete && !allDone)) return;

    setSaving(true);
    try {
      const completed = markComplete || (existingRecord?.completed === true && allDone);
      const record = {
        companyId: String(employee?.companyId || "bickers-action"),
        bookingId,
        vehicleId,
        vehicleName,
        registration,
        prepDate: dateStr,
        checks,
        equipmentChecks,
        notes: notes.trim(),
        completed,
        completedAt: completed
          ? existingRecord?.completedAt || serverTimestamp()
          : null,
        completedByUid: completed
          ? existingRecord?.completedByUid || user?.uid || null
          : null,
        completedByEmployeeId: completed
          ? existingRecord?.completedByEmployeeId || employee?.employeeId || null
          : null,
        completedByName: completed
          ? existingRecord?.completedByName || employee?.displayName || employee?.name || ""
          : null,
        completedByCode: completed
          ? existingRecord?.completedByCode || employee?.userCode || null
          : null,
        createdAt: existingRecord?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const prepRef = doc(db, "vehiclePrepRecords", prepRecordId);
      const { queued } = await runOrQueueFirestoreMutation({
        run: () => setDoc(prepRef, record, { merge: true }),
        mutation: {
          operation: "set",
          docPath: `vehiclePrepRecords/${prepRecordId}`,
          data: record,
          options: { merge: true },
          entityType: "vehiclePrepRecord",
          entityId: prepRecordId,
        },
      });

      await prepRecordsResource.upsertRow({
        ...record,
        id: prepRecordId,
        completedAt: completed ? existingRecord?.completedAt || new Date() : null,
        updatedAt: new Date(),
      });

      Alert.alert(
        queued ? "Saved offline" : markComplete ? "Vehicle prepped" : "Prep saved",
        queued
          ? "This preparation will sync automatically when the connection returns."
          : markComplete
          ? "This vehicle is now marked as prepped for the job."
          : "Your progress has been saved.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (error) {
      console.error("Failed to save vehicle preparation:", error);
      Alert.alert("Couldn’t save preparation", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: "Vehicle prep",
      subtitle: "Tick off checks before this vehicle leaves the yard.",
      onBack: router.back,
    }}>
      {/* HEADER */}
      

      <>
        {/* SUMMARY CARD */}
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <Text
            style={[styles.summaryLabel, { color: colors.textLow || COLORS.textLow }]}
          >
            Vehicle
          </Text>

          <Text
            style={[styles.summaryMain, { color: colors.text || COLORS.textHigh }]}
          >
            {vehicleName}
            {registration ? ` · ${registration}` : ""}
          </Text>

          {!!dateLabel && (
            <>
              <Text
                style={[
                  styles.summaryLabel,
                  { marginTop: t.spacing.xs, color: colors.textLow || COLORS.textLow },
                ]}
              >
                Going out
              </Text>
              <Text
                style={[styles.summaryDate, { color: colors.textMuted || COLORS.textMid }]}
              >
                {dateLabel}
              </Text>
            </>
          )}

          {existingRecord?.completed ? (
            <View
              style={[
                styles.completionMeta,
                {
                  backgroundColor: colors.successSoft,
                  borderColor: colors.success,
                },
              ]}
            >
              <Icon name="check-circle" size={16} color={colors.success} />
              <View style={styles.completionMetaCopy}>
                <Text style={[styles.completionMetaTitle, { color: colors.success }]}>Prepped</Text>
                <Text style={[styles.completionMetaText, { color: colors.textMuted }]}>
                  {existingRecord.completedByName
                    ? `Completed by ${existingRecord.completedByName}${
                        existingRecord.completedByCode
                          ? ` · ${existingRecord.completedByCode}`
                          : ""
                      }`
                    : "Completion recorded"}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* SECTION HEADER */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Prep checks
          </Text>
          <Text
            style={[styles.sectionSubtitle, { color: colors.textMuted || COLORS.textMid }]}
          >
            Tap to mark complete / reopen.
          </Text>
        </View>

        {/* CHECKLIST CARD */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          {checks.map((c, idx) => (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.checkRow,
                {
                  borderTopColor: colors.border || COLORS.border,
                  borderTopWidth: idx === 0 ? 0 : 1,
                },
                c.done && { opacity: 0.5 },
              ]}
              onPress={() => toggleCheck(c.id)}
              activeOpacity={0.8}
            >
              <View style={styles.checkIconWrap}>
                {c.done ? (
                  <View
                    style={[
                      styles.checkFilled,
                      { backgroundColor: colors.accent || COLORS.primaryAction },
                    ]}
                  >
                    <Icon name="check" size={14} color={staticColors.hex_fff_yhjmu8} />
                  </View>
                ) : (
                  <View
                    style={[
                      styles.checkEmpty,
                      { borderColor: colors.textMuted || COLORS.textMid },
                    ]}
                  />
                )}
              </View>

              <Text
                style={[
                  styles.checkLabel,
                  { color: colors.text || COLORS.textHigh },
                  c.done && { color: colors.textMuted || COLORS.textMid, textDecorationLine: "line-through" },
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* EQUIPMENT SECTION */}
        {equipmentChecks.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Equipment load-out
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Confirm all job kit is loaded.
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
              {equipmentChecks.map((c, idx) => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.checkRow,
                    {
                      borderTopColor: colors.border || COLORS.border,
                      borderTopWidth: idx === 0 ? 0 : 1,
                    },
                    c.done && { opacity: 0.5 },
                  ]}
                  onPress={() => toggleEquipmentCheck(c.id)}
                >
                  <View style={styles.checkIconWrap}>
                    {c.done ? (
                      <View
                        style={[
                          styles.checkFilled,
                          { backgroundColor: colors.accent || COLORS.primaryAction },
                        ]}
                      >
                        <Icon name="check" size={14} color={staticColors.hex_fff_yhjmu8} />
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.checkEmpty,
                          { borderColor: colors.textMuted || COLORS.textMid },
                        ]}
                      />
                    )}
                  </View>

                  <Text
                    style={[
                      styles.checkLabel,
                      { color: colors.text || COLORS.textHigh },
                      c.done && { color: colors.textMuted || COLORS.textMid, textDecorationLine: "line-through" },
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
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            Notes
          </Text>
          <Text
            style={[styles.sectionSubtitle, { color: colors.textMuted || COLORS.textMid }]}
          >
            Damage, missing kit, or anything unusual.
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
          <TextArea
            label="Notes"
            placeholder="e.g. Small scuff on rear bumper."
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* ACTION BUTTONS */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { borderColor: colors.border || COLORS.border },
            ]}
            onPress={() => handleSave(false)}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Save & back
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor: allDone
                  ? colors.accent || COLORS.primaryAction
                  : colors.border || COLORS.border,
              },
            ]}
            onPress={() => handleSave(true)}
            disabled={!allDone || saving}
          >
            <Icon name="check-circle" size={16} color={staticColors.hex_fff_yhjmu8} style={{ marginRight: t.spacing.xxs }} />
            <Text style={[styles.primaryButtonText, { color: staticColors.hex_fff_yhjmu8 }]}>
              {saving ? "Saving…" : existingRecord?.completed ? "Update preparation" : "Mark vehicle prepped"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </>
    </PageShell>
  );
}

/* ---------- STYLES MATCH SERVICE-LIST EXACTLY ---------- */

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
  },

  backButton: {
    paddingRight: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
  },

  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: t.typography.metadata.fontSize,
    marginTop: t.spacing.none,
  },

  scrollContent: {
    padding: t.spacing.md,
  },

  /* SUMMARY */
  summaryCard: {
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.md,
    borderWidth: 1,
  },
  summaryLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summaryMain: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    marginTop: t.spacing.none,
  },
  summaryDate: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
    marginTop: t.spacing.none,
  },
  completionMeta: {
    marginTop: t.spacing.sm,
    padding: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  completionMetaCopy: { flex: 1, minWidth: 0 },
  completionMetaTitle: {
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "900",
  },
  completionMetaText: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "600",
  },

  /* SECTION TITLES */
  sectionHeaderRow: {
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
  },
  sectionSubtitle: {
    fontSize: t.typography.metadata.fontSize,
  },

  /* CARDS */
  card: {
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    marginBottom: t.spacing.md,
    borderWidth: 1,
  },

  /* CHECKLIST */
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: t.spacing.xs,
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
  },
  checkFilled: {
    width: 20,
    height: 20,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: t.typography.body.fontSize,
    fontWeight: "500",
  },

  /* NOTES */
  notesInput: {
    minHeight: 100,
    padding: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    fontSize: t.typography.body.fontSize,
    textAlignVertical: "top",
  },

  /* BUTTONS */
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
  },
  secondaryButtonText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
  },
  primaryButton: {
    flex: 1.4,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
  },
});
