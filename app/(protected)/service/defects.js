// app/(protected)/service/defects.jsx
import { useRouter } from "expo-router";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30",
  recceAction: "#FF3B30",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

/* ---------- DEFECT HELPERS ---------- */

function normaliseDefect(defect) {
  if (!defect && defect !== "") {
    return { text: "Issue", bucket: "general" };
  }

  // If it's just a string
  if (typeof defect === "string") {
    const text = defect.trim() || "Issue";
    const lower = text.toLowerCase();
    const isImmediate =
      lower.includes("urgent") ||
      lower.includes("asap") ||
      lower.includes("do not drive") ||
      lower.includes("do not use") ||
      lower.includes("unsafe") ||
      lower.includes("off road") ||
      lower.includes("off-road") ||
      lower.includes("stop use");

    return { text, bucket: isImmediate ? "immediate" : "general" };
  }

  // If it's an object
  const text =
    defect.description ||
    defect.summary ||
    defect.title ||
    "Issue";

  const lower = text.toLowerCase();
  const priority = (defect.priority || "").toLowerCase();
  const severity = (defect.severity || "").toLowerCase();

  const isImmediate =
    defect.urgent === true ||
    priority === "high" ||
    priority === "urgent" ||
    severity === "high" ||
    severity === "critical" ||
    lower.includes("do not drive") ||
    lower.includes("do not use") ||
    lower.includes("unsafe") ||
    lower.includes("off road") ||
    lower.includes("off-road");

  return { text, bucket: isImmediate ? "immediate" : "general" };
}

/* ---------- MAIN SCREEN ---------- */

export default function DefectsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Live defects from vehicles collection
  useEffect(() => {
    const q = query(collection(db, "vehicles"), orderBy("name", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVehicles(data);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load vehicles for defects:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Attach split defects per vehicle
  const withDefects = useMemo(() => {
    return vehicles
      .map((v) => {
        const rawDefects = Array.isArray(v.defects) ? v.defects : [];
        const immediateDefects = [];
        const generalDefects = [];

        rawDefects.forEach((d) => {
          const { text, bucket } = normaliseDefect(d);
          if (bucket === "immediate") immediateDefects.push(text);
          else generalDefects.push(text);
        });

        const totalCount = immediateDefects.length + generalDefects.length;

        return {
          ...v,
          defectsRaw: rawDefects,
          immediateDefects,
          generalDefects,
          totalDefects: totalCount,
        };
      })
      .filter((v) => v.totalDefects > 0);
  }, [vehicles]);

  const immediateVehicles = useMemo(
    () => withDefects.filter((v) => v.immediateDefects.length > 0),
    [withDefects]
  );

  const generalVehicles = useMemo(
    () =>
      withDefects.filter(
        (v) =>
          v.immediateDefects.length === 0 &&
          v.generalDefects.length > 0
      ),
    [withDefects]
  );

  const totalImmediate = immediateVehicles.reduce(
    (sum, v) => sum + v.immediateDefects.length,
    0
  );
  const totalGeneral = generalVehicles.reduce(
    (sum, v) => sum + v.generalDefects.length,
    0
  );

  const goVehicle = (id) => {
    // align with service-list / service-home route
    router.push(`/service/vehicles/${id}`);
  };

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
        {/* 🔙 back button added */}
        <TouchableOpacity
          onPress={router.back}
          style={styles.backButton}
          activeOpacity={0.8}
        >
          <Icon
            name="chevron-left"
            size={20}
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
            Defects & issues
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Split into immediate maintenance and general follow-up.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primaryAction} />
        </View>
      ) : withDefects.length === 0 ? (
        <View style={styles.emptyOuter}>
          <Icon
            name="check-circle"
            size={32}
            color={colors.textMuted || COLORS.textMid}
          />
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            No defects logged
          </Text>
          <Text
            style={[
              styles.emptySubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            When drivers or crew log issues against a vehicle, they’ll appear
            here automatically.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* SUMMARY CARD */}
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.surfaceAlt || COLORS.card },
            ]}
          >
            <Text
              style={[
                styles.infoTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Reported defects
            </Text>
            <Text
              style={[
                styles.infoSubtitle,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Use this view to decide what needs workshop time now, and what can
              be planned later.
            </Text>

            <View style={styles.summaryRow}>
              <View style={styles.summaryPill}>
                <View
                  style={[styles.summaryDot, { backgroundColor: "#FF3B30" }]}
                />
                <Text style={styles.summaryText}>
                  {totalImmediate} immediate
                </Text>
              </View>
              <View style={styles.summaryPill}>
                <View
                  style={[styles.summaryDot, { backgroundColor: "#FFCC00" }]}
                />
                <Text style={styles.summaryText}>
                  {totalGeneral} general
                </Text>
              </View>
            </View>
          </View>

          {/* IMMEDIATE SECTION */}
          {immediateVehicles.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Immediate maintenance
                </Text>
                <Text style={styles.sectionHint}>
                  Safety-critical / do not delay.
                </Text>
              </View>

              {immediateVehicles.map((v) => {
                const name = v.name || v.vehicleName || "Unnamed vehicle";
                const reg = v.reg || v.registration || "";
                const immediate = v.immediateDefects;
                const general = v.generalDefects;

                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.card,
                      {
                        borderColor: "rgba(255,59,48,0.7)",
                        backgroundColor: colors.surfaceAlt || COLORS.card,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => goVehicle(v.id)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{name}</Text>
                        {!!reg && (
                          <Text style={styles.cardReg}>{reg}</Text>
                        )}
                        <Text style={styles.countImmediate}>
                          {immediate.length} immediate issue
                          {immediate.length > 1 ? "s" : ""} ·{" "}
                          {v.totalDefects} total
                        </Text>
                      </View>
                      <View style={styles.badgeImmediate}>
                        <Text style={styles.badgeText}>Immediate</Text>
                      </View>
                      <Icon
                        name="chevron-right"
                        size={18}
                        color={COLORS.textMid}
                      />
                    </View>

                    {immediate.slice(0, 3).map((text, idx) => (
                      <View key={`imm-${idx}`} style={styles.defectRow}>
                        <Icon
                          name="alert-triangle"
                          size={14}
                          color={COLORS.recceAction}
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.defectText}>{text}</Text>
                      </View>
                    ))}

                    {general.length > 0 && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={styles.subSectionLabel}>
                          Other issues
                        </Text>
                        {general.slice(0, 2).map((text, idx) => (
                          <View
                            key={`gen-${idx}`}
                            style={[styles.defectRow, { marginTop: 2 }]}
                          >
                            <Icon
                              name="minus-circle"
                              size={13}
                              color="#FFCC00"
                              style={{ marginRight: 6 }}
                            />
                            <Text style={styles.defectText}>{text}</Text>
                          </View>
                        ))}
                        {general.length > 2 && (
                          <Text style={styles.moreText}>
                            + {general.length - 2} more…
                          </Text>
                        )}
                      </View>
                    )}

                    {immediate.length > 3 && general.length === 0 && (
                      <Text style={styles.moreText}>
                        + {immediate.length - 3} more…
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* GENERAL SECTION */}
          {generalVehicles.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  General defects & follow-up
                </Text>
                <Text style={styles.sectionHint}>
                  Plan into future workshop slots.
                </Text>
              </View>

              {generalVehicles.map((v) => {
                const name = v.name || v.vehicleName || "Unnamed vehicle";
                const reg = v.reg || v.registration || "";
                const general = v.generalDefects;

                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.card,
                      {
                        borderColor: COLORS.border,
                        backgroundColor: colors.surfaceAlt || COLORS.card,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => goVehicle(v.id)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{name}</Text>
                        {!!reg && (
                          <Text style={styles.cardReg}>{reg}</Text>
                        )}
                        <Text style={styles.countGeneral}>
                          {general.length} general issue
                          {general.length > 1 ? "s" : ""} open
                        </Text>
                      </View>
                      <View style={styles.badgeGeneral}>
                        <Text style={styles.badgeText}>General</Text>
                      </View>
                      <Icon
                        name="chevron-right"
                        size={18}
                        color={COLORS.textMid}
                      />
                    </View>

                    {general.slice(0, 3).map((text, idx) => (
                      <View key={idx} style={styles.defectRow}>
                        <Icon
                          name="minus-circle"
                          size={14}
                          color="#FFCC00"
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.defectText}>{text}</Text>
                      </View>
                    ))}

                    {general.length > 3 && (
                      <Text style={styles.moreText}>
                        + {general.length - 3} more…
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 2,
    color: COLORS.textMid,
  },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },

  scrollContent: { padding: 16 },

  /* SUMMARY CARD */
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
    color: COLORS.textHigh,
  },
  infoSubtitle: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  summaryRow: {
    flexDirection: "row",
    marginTop: 10,
  },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  summaryText: {
    fontSize: 12,
    color: COLORS.textHigh,
    fontWeight: "600",
  },

  /* SECTIONS */
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
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMid,
  },

  /* VEHICLE CARDS */
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  cardReg: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  countImmediate: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#FF3B30",
  },
  countGeneral: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMid,
  },
  badgeImmediate: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,59,48,0.15)",
    borderWidth: 1,
    borderColor: "#FF3B30",
    marginRight: 8,
  },
  badgeGeneral: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,204,0,0.15)",
    borderWidth: 1,
    borderColor: "#FFCC00",
    marginRight: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textHigh,
  },

  defectRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  defectText: {
    fontSize: 13,
    color: COLORS.textHigh,
    flex: 1,
  },
  subSectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMid,
    marginBottom: 2,
  },
  moreText: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textMid,
  },

  /* EMPTY STATE */
  emptyOuter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
    color: COLORS.textMid,
  },
});
