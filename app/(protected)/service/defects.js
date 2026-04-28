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
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../firebaseConfig";
import { designTokens as t } from "../../../lib/design/tokens";
import { useTheme } from "../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  recceAction: "#ED1C25",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

/* ---------- DEFECT HELPERS ---------- */

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isApprovedDefect(review) {
  const status = normaliseKey(review?.status);
  const category = normaliseKey(review?.category);
  return (
    status === "approved" &&
    (category === "general" || category === "immediate")
  );
}

function isOpenMaintenance(status) {
  const value = normaliseKey(status);
  return value !== "resolved" && value !== "complete" && value !== "completed";
}

function buildDefectRouteId(source, docId, itemIndex = "") {
  return encodeURIComponent([source, docId, itemIndex].join("|"));
}

function getDateValue(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getVehicleLabel(record) {
  return (
    record?.vehicle ||
    record?.vehicleName ||
    record?.name ||
    record?.registration ||
    record?.reg ||
    "Unknown vehicle"
  );
}

function findVehicleForDefect(defect, vehicles) {
  if (defect.vehicleId) {
    const byId = vehicles.find((v) => v.id === defect.vehicleId);
    if (byId) return byId;
  }

  const defectVehicle = normaliseKey(defect.vehicleName);
  const defectReg = normaliseKey(defect.registration);

  return vehicles.find((v) => {
    const names = [
      v.name,
      v.vehicleName,
      v.vehicle,
      v.registration,
      v.reg,
    ].map(normaliseKey);
    return names.includes(defectVehicle) || (!!defectReg && names.includes(defectReg));
  });
}

function buildApprovedCheckDefects(checkDocs) {
  return checkDocs.flatMap((check) => {
    const items = Array.isArray(check.items) ? check.items : [];

    return items
      .filter((item) => isApprovedDefect(item?.review))
      .filter((item) => isOpenMaintenance(item?.maintenance?.status))
      .map((item, index) => {
        const label = item?.label || item?.title || item?.category || "Vehicle check";
        const note = item?.note || item?.description || "";
        const text = note ? `${label}: ${note}` : label;

        return {
          id: `${check.id}-${index}`,
          routeId: buildDefectRouteId("vehicleChecks", check.id, index),
          source: "vehicleChecks",
          docId: check.id,
          itemIndex: index,
          category: normaliseKey(item.review.category),
          text,
          vehicleId: check.vehicleId || check.vehicleDocId || null,
          vehicleName: getVehicleLabel(check),
          registration: check.registration || check.reg || "",
          reporter: check.driverName || check.reporterName || "",
          jobNumber: check.jobNumber || "",
          dateValue: getDateValue(check.dateISO || check.createdAt || check.date),
          maintenanceStatus: item?.maintenance?.status || "",
        };
      });
  });
}

function buildApprovedIssueDefects(issueDocs) {
  return issueDocs
    .filter((issue) => isApprovedDefect(issue?.review))
    .filter((issue) => isOpenMaintenance(issue?.maintenance?.status))
    .map((issue) => {
      const category = issue.category || issue.title || "Issue";
      const description = issue.description || issue.note || issue.summary || "";
      const text = description ? `${category}: ${description}` : category;

      return {
        id: issue.id,
        routeId: buildDefectRouteId("vehicleIssues", issue.id),
        source: "vehicleIssues",
        docId: issue.id,
        category: normaliseKey(issue.review.category),
        text,
        vehicleId: issue.vehicleId || issue.vehicleDocId || null,
        vehicleName: getVehicleLabel(issue),
        registration: issue.registration || issue.reg || "",
        reporter: issue.reporterName || issue.driverName || "",
        jobNumber: issue.jobNumber || "",
        dateValue: getDateValue(issue.createdAt || issue.dateISO || issue.date),
        maintenanceStatus: issue?.maintenance?.status || "",
      };
    });
}

/* ---------- MAIN SCREEN ---------- */

export default function DefectsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [vehicleChecks, setVehicleChecks] = useState([]);
  const [vehicleIssues, setVehicleIssues] = useState([]);
  const [loadingSources, setLoadingSources] = useState({
    vehicles: true,
    checks: true,
    issues: true,
  });
  const loading =
    loadingSources.vehicles || loadingSources.checks || loadingSources.issues;

  // Vehicles are used to link approved defects back to service vehicle pages.
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
        setLoadingSources((prev) => ({ ...prev, vehicles: false }));
      },
      (err) => {
        console.error("Failed to load vehicles for defects:", err);
        setLoadingSources((prev) => ({ ...prev, vehicles: false }));
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "vehicleChecks"),
      (snap) => {
        const data = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVehicleChecks(data);
        setLoadingSources((prev) => ({ ...prev, checks: false }));
      },
      (err) => {
        console.error("Failed to load approved vehicle checks:", err);
        setLoadingSources((prev) => ({ ...prev, checks: false }));
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "vehicleIssues"),
      (snap) => {
        const data = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVehicleIssues(data);
        setLoadingSources((prev) => ({ ...prev, issues: false }));
      },
      (err) => {
        console.error("Failed to load approved vehicle issues:", err);
        setLoadingSources((prev) => ({ ...prev, issues: false }));
      }
    );

    return () => unsub();
  }, []);

  // Attach approved split defects per vehicle/source.
  const withDefects = useMemo(() => {
    const approvedDefects = [
      ...buildApprovedCheckDefects(vehicleChecks),
      ...buildApprovedIssueDefects(vehicleIssues),
    ].sort((a, b) => b.dateValue - a.dateValue);

    const grouped = new Map();

    approvedDefects.forEach((defect) => {
      const matchedVehicle = findVehicleForDefect(defect, vehicles);
      const vehicleName =
        matchedVehicle?.name ||
        matchedVehicle?.vehicleName ||
        defect.vehicleName ||
        "Unknown vehicle";
      const registration =
        matchedVehicle?.registration ||
        matchedVehicle?.reg ||
        defect.registration ||
        "";
      const groupKey =
        matchedVehicle?.id ||
        defect.vehicleId ||
        normaliseKey(`${vehicleName}-${registration}`) ||
        defect.id;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          id: groupKey,
          vehicleId: matchedVehicle?.id || defect.vehicleId || null,
          name: vehicleName,
          vehicleName,
          reg: registration,
          registration,
          immediateDefects: [],
          generalDefects: [],
          totalDefects: 0,
        });
      }

      const group = grouped.get(groupKey);
      if (defect.category === "immediate") {
        group.immediateDefects.push(defect);
      } else {
        group.generalDefects.push(defect);
      }
      group.totalDefects += 1;
    });

    return Array.from(grouped.values());
  }, [vehicleChecks, vehicleIssues, vehicles]);

  const immediateVehicles = useMemo(
    () => withDefects.filter((v) => v.immediateDefects.length > 0),
    [withDefects]
  );

  const generalVehicles = useMemo(
    () => withDefects.filter((v) => v.generalDefects.length > 0),
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

  const goDefect = (routeId) => {
    router.push(`/service/defects/${routeId}`);
  };

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
            Defects & Issues
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
            Approved general and immediate defects from vehicle checks and
            vehicle issues will appear here automatically.
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
                  style={[styles.summaryDot, { backgroundColor: "#ED1C25" }]}
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
                  <View
                    key={v.id}
                    style={[
                      styles.card,
                      {
                        borderColor: "rgba(255,59,48,0.7)",
                        backgroundColor: colors.surfaceAlt || COLORS.card,
                      },
                    ]}
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
                    </View>

                    {immediate.slice(0, 3).map((defect) => (
                      <TouchableOpacity
                        key={defect.id}
                        style={styles.defectRow}
                        onPress={() => goDefect(defect.routeId)}
                        activeOpacity={0.75}
                      >
                        <Icon
                          name="alert-triangle"
                          size={14}
                          color={COLORS.recceAction}
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.defectText}>{defect.text}</Text>
                        <Icon name="chevron-right" size={14} color={COLORS.textMid} />
                      </TouchableOpacity>
                    ))}

                    {general.length > 0 && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={styles.subSectionLabel}>
                          Other issues
                        </Text>
                        {general.slice(0, 2).map((defect) => (
                          <TouchableOpacity
                            key={defect.id}
                            style={[styles.defectRow, { marginTop: 2 }]}
                            onPress={() => goDefect(defect.routeId)}
                            activeOpacity={0.75}
                          >
                            <Icon
                              name="minus-circle"
                              size={13}
                              color="#FFCC00"
                              style={{ marginRight: 6 }}
                            />
                            <Text style={styles.defectText}>{defect.text}</Text>
                            <Icon name="chevron-right" size={14} color={COLORS.textMid} />
                          </TouchableOpacity>
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
                  </View>
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
                  <View
                    key={v.id}
                    style={[
                      styles.card,
                      {
                        borderColor: COLORS.border,
                        backgroundColor: colors.surfaceAlt || COLORS.card,
                      },
                    ]}
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
                    </View>

                    {general.slice(0, 3).map((defect) => (
                      <TouchableOpacity
                        key={defect.id}
                        style={styles.defectRow}
                        onPress={() => goDefect(defect.routeId)}
                        activeOpacity={0.75}
                      >
                        <Icon
                          name="minus-circle"
                          size={14}
                          color="#FFCC00"
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.defectText}>{defect.text}</Text>
                        <Icon name="chevron-right" size={14} color={COLORS.textMid} />
                      </TouchableOpacity>
                    ))}

                    {general.length > 3 && (
                      <Text style={styles.moreText}>
                        + {general.length - 3} more…
                      </Text>
                    )}
                  </View>
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
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },

  scrollContent: { padding: t.spacing.md, paddingTop: 4 },

  /* SUMMARY CARD */
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.sm,
    padding: t.controls.cardPadding,
    marginBottom: t.spacing.sm,
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
    minHeight: t.controls.chipMinHeight,
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#181818",
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
    padding: t.controls.cardPadding,
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
    color: "#ED1C25",
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
    borderColor: "#ED1C25",
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
