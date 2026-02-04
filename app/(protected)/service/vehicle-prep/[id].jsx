// app/(protected)/service/service-form/vehicle-prep.jsx (or your actual path)
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

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
  const { colors } = useTheme();
  const params = useLocalSearchParams();

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
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={20} color={COLORS.textHigh} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.pageTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Vehicle prep
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Tick off checks before this vehicle leaves the yard.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* SUMMARY */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Vehicle</Text>
          <Text style={styles.summaryMain}>
            {vehicleName || "Vehicle"}
            {registration ? ` · ${registration}` : ""}
          </Text>

          {dateLabel ? (
            <>
              <Text style={[styles.summaryLabel, { marginTop: 8 }]}>
                Going out
              </Text>
              <Text style={styles.summaryDate}>{dateLabel}</Text>
            </>
          ) : null}

          {equipmentSummary ? (
            <>
              <Text style={[styles.summaryLabel, { marginTop: 8 }]}>
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
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="e.g. Small scuff on rear bumper, photographed and logged."
            placeholderTextColor={COLORS.textLow}
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
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryButtonText}>Save & back</Text>
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
            onPress={() => router.back()}
            disabled={!allDone}
            activeOpacity={0.9}
          >
            <Feather
              name="check-circle"
              size={16}
              color={COLORS.textHigh}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.primaryButtonText}>
              Mark vehicle prepped
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
    paddingVertical: 4,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 2,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
  },

  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textLow,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summaryMain: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginTop: 2,
  },
  summaryDate: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textMid,
    marginTop: 2,
  },
  summaryEquipment: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textMid,
    marginTop: 2,
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
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textMid,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  checkIconWrap: {
    paddingRight: 10,
    paddingTop: 4,
  },
  checkEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.textMid,
  },
  checkFilled: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textHigh,
    fontWeight: "500",
  },

  notesInput: {
    minHeight: 100,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    backgroundColor: COLORS.inputBg,
    color: COLORS.textHigh,
    fontSize: 14,
    textAlignVertical: "top",
  },

  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textMid,
  },
  primaryButton: {
    flex: 1.4,
    borderRadius: 999,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
});
