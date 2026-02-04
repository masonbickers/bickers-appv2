// app/(protected)/service/vehicle-prep.jsx
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
import Icon from "react-native-vector-icons/Feather";
import { useTheme } from "../../providers/ThemeProvider";

/* ---------- SAME COLOUR MAP AS SERVICE-LIST.JSX ---------- */

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30",
  inputBg: "#1A1A1A",
  chipBg: "#1F1F1F",
  chipBorder: "#3A3A3A",
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

  /* ---------- PARAMS ---------- */

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
          activeOpacity={0.7}
        >
          <Icon
            name="chevron-left"
            size={20}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text
            style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}
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
                  { marginTop: 8, color: colors.textLow || COLORS.textLow },
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
                    <Icon name="check" size={14} color={"#fff"} />
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
                        <Icon name="check" size={14} color={"#fff"} />
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
          <TextInput
            style={[
              styles.notesInput,
              {
                backgroundColor: colors.inputBackground || COLORS.inputBg,
                borderColor: colors.inputBorder || COLORS.border,
                color: colors.text || COLORS.textHigh,
              },
            ]}
            multiline
            placeholder="e.g. Small scuff on rear bumper."
            placeholderTextColor={colors.textLow || COLORS.textLow}
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
            onPress={() => router.back()}
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
            onPress={() => router.back()}
            disabled={!allDone}
          >
            <Icon name="check-circle" size={16} color={"#fff"} style={{ marginRight: 6 }} />
            <Text style={[styles.primaryButtonText, { color: "#fff" }]}>
              Mark vehicle prepped
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- STYLES MATCH SERVICE-LIST EXACTLY ---------- */

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },

  backButton: {
    paddingRight: 12,
    paddingVertical: 6,
  },

  pageTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },

  scrollContent: {
    padding: 16,
  },

  /* SUMMARY */
  summaryCard: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summaryMain: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 2,
  },
  summaryDate: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },

  /* SECTION TITLES */
  sectionHeaderRow: {
    marginTop: 8,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  sectionSubtitle: {
    fontSize: 12,
  },

  /* CARDS */
  card: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
    borderWidth: 1,
  },

  /* CHECKLIST */
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
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
  },
  checkFilled: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },

  /* NOTES */
  notesInput: {
    minHeight: 100,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    textAlignVertical: "top",
  },

  /* BUTTONS */
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
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  primaryButton: {
    flex: 1.4,
    borderRadius: 999,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
