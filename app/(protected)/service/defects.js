import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
// app/(protected)/service/defects.jsx
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { designTokens as t } from "../../../lib/design/tokens";
import { useServiceCollection } from "../../../hooks/useServiceData";
import {
  getVehicleDisplayName,
  getVehicleRegistration,
} from "../../../lib/fleetSchema";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import PageShell from "../../../components/layout/PageShell";

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

function getIssueAssetLabel(issue) {
  if (issue?.assetType !== "equipment") return getVehicleLabel(issue);
  return (
    [issue?.equipmentName || issue?.assetName, issue?.serialNumber || issue?.equipmentId]
      .filter(Boolean)
      .join(" · ") || "Unknown equipment"
  );
}

function cleanRegistration(value) {
  const text = String(value || "").trim();
  return text && text.toLowerCase() !== "n/a" ? text : "";
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
        assetType: issue.assetType || "vehicle",
        vehicleId:
          issue.assetType === "equipment"
            ? null
            : issue.vehicleId || issue.vehicleDocId || null,
        vehicleName: getIssueAssetLabel(issue),
        registration:
          issue.assetType === "equipment"
            ? issue.serialNumber || issue.equipmentId || issue.asset || ""
            : issue.registration || issue.reg || "",
        reporter: issue.reporterName || issue.driverName || "",
        jobNumber: issue.jobNumber || "",
        dateValue: getDateValue(issue.createdAt || issue.dateISO || issue.date),
        maintenanceStatus: issue?.maintenance?.status || "",
      };
    });
}

function buildManualDefectReports(reports) {
  return reports
    .filter((report) => isOpenMaintenance(report?.status))
    .map((report) => {
      const severity = normaliseKey(report.severity);
      const priority = normaliseKey(report.priority);
      const isImmediate =
        severity === "immediate" || priority === "high" || !!report.offRoad;
      const title = report.category || report.title || report.severity || "Defect report";
      const description = report.description || report.note || report.summary || "";
      const text = description ? `${title}: ${description}` : title;

      return {
        id: report.id,
        routeId: buildDefectRouteId("defectReports", report.id),
        source: "defectReports",
        docId: report.id,
        category: isImmediate ? "immediate" : "general",
        text,
        vehicleId: report.vehicleId || report.vehicleDocId || null,
        vehicleName: getVehicleLabel(report),
        registration: report.registration || report.reg || "",
        reporter: report.reportedBy || report.reporterName || report.driverName || "",
        jobNumber: report.jobNumber || "",
        dateValue: getDateValue(report.createdAt || report.dateISO || report.date),
        maintenanceStatus: report.status || "open",
      };
    });
}

/* ---------- MAIN SCREEN ---------- */

export default function DefectsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const textColor = colors.text || COLORS.textHigh;
  const mutedColor = colors.textMuted || COLORS.textMid;
  const cardBg = colors.surfaceAlt || COLORS.card;
  const borderColor = colors.border || COLORS.border;
  const dangerColor = colors.danger || COLORS.primaryAction;
  const warningColor = colors.warning || staticColors.hex_ffcc00_5c6g4m;

  const { rows: vehicles, loading: vehiclesLoading } = useServiceCollection("vehicles", {
    label: "vehicles for defects",
    orderByField: "name",
  });
  const { rows: vehicleChecks, loading: checksLoading } = useServiceCollection(
    "vehicleChecks",
    { label: "approved vehicle checks" }
  );
  const { rows: vehicleIssues, loading: issuesLoading } = useServiceCollection(
    "vehicleIssues",
    { label: "approved vehicle issues" }
  );
  const { rows: defectReports, loading: reportsLoading } = useServiceCollection(
    "defectReports",
    { label: "manual defect reports" }
  );
  const loading = vehiclesLoading || checksLoading || issuesLoading || reportsLoading;

  // Attach approved split defects per vehicle/source.
  const withDefects = useMemo(() => {
    const approvedDefects = [
      ...buildApprovedCheckDefects(vehicleChecks),
      ...buildApprovedIssueDefects(vehicleIssues),
      ...buildManualDefectReports(defectReports),
    ].sort((a, b) => b.dateValue - a.dateValue);

    const grouped = new Map();

    approvedDefects.forEach((defect) => {
      const matchedVehicle = findVehicleForDefect(defect, vehicles);
      const embeddedVehicle =
        defect.vehicleName && defect.vehicleName !== defect.vehicleId
          ? { vehicleName: defect.vehicleName, registration: defect.registration }
          : {};
      const vehicleName = getVehicleDisplayName(
        matchedVehicle || embeddedVehicle,
        vehicles
      );
      const registration =
        cleanRegistration(
          getVehicleRegistration(matchedVehicle || embeddedVehicle) || ""
        );
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
  }, [defectReports, vehicleChecks, vehicleIssues, vehicles]);

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
    <PageShell header={{
      variant: "compact",
      title: "Defects & Issues",
      subtitle: "Split into immediate maintenance and general follow-up.",
      onBack: router.back,
    }}>
      

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
        <>
          {/* SUMMARY CARD */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryPill}>
              <View
                style={[styles.summaryDot, { backgroundColor: staticColors.hex_ed1c25_4py4qa }]}
              />
              <Text style={styles.summaryText}>
                {totalImmediate} immediate
              </Text>
            </View>
            <View style={styles.summaryPill}>
              <View
                style={[styles.summaryDot, { backgroundColor: staticColors.hex_ffcc00_5c6g4m }]}
              />
              <Text style={styles.summaryText}>
                {totalGeneral} general
              </Text>
            </View>
          </View>

          {/* IMMEDIATE SECTION */}
          {immediateVehicles.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: textColor }]}>
                  Immediate maintenance
                </Text>
                <Text style={[styles.sectionHint, { color: mutedColor }]}>
                  Safety-critical / do not delay.
                </Text>
              </View>

              {immediateVehicles.map((v) => {
                const name = v.name || v.vehicleName || "Unnamed vehicle";
                const reg = cleanRegistration(v.reg || v.registration);
                const immediate = v.immediateDefects;
                const general = v.generalDefects;

                return (
                  <View
                    key={v.id}
                    style={[
                      styles.card,
                      {
                        borderColor,
                        backgroundColor: cardBg,
                      },
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, { color: textColor }]}>{name}</Text>
                        {!!reg && (
                          <Text style={[styles.cardReg, { color: mutedColor }]}>{reg}</Text>
                        )}
                        <Text style={[styles.countImmediate, { color: dangerColor }]}>
                          {immediate.length} immediate issue
                          {immediate.length > 1 ? "s" : ""} ·{" "}
                          {v.totalDefects} total
                        </Text>
                      </View>
                      <View style={[styles.badgeImmediate, { borderColor: dangerColor }]}>
                        <Text style={[styles.badgeText, { color: dangerColor }]}>Immediate</Text>
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
                          color={dangerColor}
                          style={{ marginRight: t.spacing.xxs }}
                        />
                        <Text style={[styles.defectText, { color: textColor }]}>{defect.text}</Text>
                        <Icon name="chevron-right" size={14} color={mutedColor} />
                      </TouchableOpacity>
                    ))}

                    {general.length > 0 && (
                      <View style={{ marginTop: t.spacing.xxs }}>
                        <Text style={[styles.subSectionLabel, { color: mutedColor }]}>
                          Related general issue{general.length > 1 ? "s" : ""}
                        </Text>
                        {general.slice(0, 2).map((defect) => (
                          <TouchableOpacity
                            key={defect.id}
                            style={[styles.defectRow, { marginTop: t.spacing.none }]}
                            onPress={() => goDefect(defect.routeId)}
                            activeOpacity={0.75}
                          >
                            <Icon
                              name="minus-circle"
                              size={13}
                              color={warningColor}
                              style={{ marginRight: t.spacing.xxs }}
                            />
                            <Text style={[styles.defectText, { color: textColor }]}>{defect.text}</Text>
                            <Icon name="chevron-right" size={14} color={mutedColor} />
                          </TouchableOpacity>
                        ))}
                        {general.length > 2 && (
                          <Text style={[styles.moreText, { color: mutedColor }]}>
                            + {general.length - 2} more…
                          </Text>
                        )}
                      </View>
                    )}

                    {immediate.length > 3 && general.length === 0 && (
                      <Text style={[styles.moreText, { color: mutedColor }]}>
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
                <Text style={[styles.sectionTitle, { color: textColor }]}>
                  General defects & follow-up
                </Text>
                <Text style={[styles.sectionHint, { color: mutedColor }]}>
                  Plan into future workshop slots.
                </Text>
              </View>

              {generalVehicles.map((v) => {
                const name = v.name || v.vehicleName || "Unnamed vehicle";
                const reg = cleanRegistration(v.reg || v.registration);
                const general = v.generalDefects;

                return (
                  <View
                    key={v.id}
                    style={[
                      styles.card,
                      {
                        borderColor,
                        backgroundColor: cardBg,
                      },
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, { color: textColor }]}>{name}</Text>
                        {!!reg && (
                          <Text style={[styles.cardReg, { color: mutedColor }]}>{reg}</Text>
                        )}
                        <Text style={[styles.countGeneral, { color: mutedColor }]}>
                          {general.length} general issue
                          {general.length > 1 ? "s" : ""} open
                        </Text>
                      </View>
                      <View style={[styles.badgeGeneral, { borderColor: warningColor }]}>
                        <Text style={[styles.badgeText, { color: warningColor }]}>General</Text>
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
                          color={warningColor}
                          style={{ marginRight: t.spacing.xxs }}
                        />
                        <Text style={[styles.defectText, { color: textColor }]}>{defect.text}</Text>
                        <Icon name="chevron-right" size={14} color={mutedColor} />
                      </TouchableOpacity>
                    ))}

                    {general.length > 3 && (
                      <Text style={[styles.moreText, { color: mutedColor }]}>
                        + {general.length - 3} more…
                      </Text>
                    )}
                  </View>
                );
              })}
            </>
          )}

          <View style={{ height: 40 }} />
        </>
      )}
    </PageShell>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
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
  },
  pageSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },

  scrollContent: { padding: t.spacing.md, paddingTop: t.spacing.xxs, paddingBottom: 110 },

  /* SUMMARY CARD */
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: t.spacing.sm,
  },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: t.controls.chipMinHeight,
    marginRight: t.spacing.sm,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.card,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: t.radius.pill,
    marginRight: t.spacing.xxs,
  },
  summaryText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textHigh,
    fontWeight: "600",
  },

  /* SECTIONS */
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
    color: COLORS.textHigh,
  },
  sectionHint: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  /* VEHICLE CARDS */
  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.controls.cardPadding,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.xxs,
  },
  cardTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  cardReg: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  countImmediate: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    color: staticColors.hex_ed1c25_4py4qa,
  },
  countGeneral: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
  },
  badgeImmediate: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: staticColors.hex_ed1c25_4py4qa,
    marginRight: t.spacing.xs,
  },
  badgeGeneral: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_1bodets,
    borderWidth: 1,
    borderColor: staticColors.hex_ffcc00_5c6g4m,
    marginRight: t.spacing.xs,
  },
  badgeText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },

  defectRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: t.spacing.xs,
  },
  defectText: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textHigh,
    flex: 1,
  },
  subSectionLabel: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
    marginBottom: t.spacing.none,
  },
  moreText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  /* EMPTY STATE */
  emptyOuter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing["2xl"],
  },
  emptyTitle: {
    marginTop: t.spacing.sm,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    textAlign: "center",
    color: COLORS.textMid,
  },
});
