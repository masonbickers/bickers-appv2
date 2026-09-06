import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
import { useRouter } from "expo-router";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import PageShell from "../../../components/layout/PageShell";
import { db } from "../../../firebaseConfig";
import { designTokens as t } from "../../../lib/design/tokens";
import { groupServiceIssuesByAsset } from "../../../lib/serviceIssueGrouping";
import {
  isOpenAdvisoryItem,
  resolveMonitorReportItem,
} from "../../../lib/serviceAdvisories";
import { useServiceCacheActions, useServiceCollection } from "../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../lib/sync/firestoreQueue";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isApprovedDefect(review) {
  const status = normaliseKey(review?.status);
  const category = normaliseKey(review?.category);
  return status === "approved" && (category === "general" || category === "immediate");
}

function isOpenMaintenance(status) {
  const value = normaliseKey(status);
  return value !== "resolved" && value !== "complete" && value !== "completed";
}

function buildDefectRouteId(source, docId, itemIndex = "") {
  return encodeURIComponent([source, docId, itemIndex].join("|"));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toDateMaybe(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = toDateMaybe(value);
  if (!d) return "No date";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function getRecordDate(record) {
  return (
    record?.reportedAt ||
    record?.createdAt ||
    record?.inspectionDateISO ||
    record?.serviceDateOnly ||
    record?.completedDate ||
    record?.updatedAt ||
    null
  );
}

function getVehicleText(record) {
  return [record?.vehicleName || record?.vehicle || record?.name, record?.registration || record?.reg]
    .filter(Boolean)
    .join(" · ");
}

function getEquipmentText(record) {
  return [
    record?.equipmentName || record?.name,
    record?.serialNumber || record?.equipmentId,
    record?.asset,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildOpenDefects({ vehicleChecks, vehicleIssues, defectReports }) {
  const checkDefects = vehicleChecks.flatMap((check) => {
    const items = Array.isArray(check.items) ? check.items : [];
    return items.flatMap((item, index) =>
      isApprovedDefect(item?.review) &&
      isOpenMaintenance(item?.maintenance?.status)
        ? [
            {
              id: `check-${check.id}-${item?.id || index}`,
              title: item?.label || item?.title || item?.name || "Vehicle check defect",
              details: item?.notes || item?.review?.notes || item?.maintenance?.notes || "Approved check defect.",
              asset: getVehicleText(check) || "Vehicle check",
              date: getRecordDate(check),
              route: `/service/defects/${buildDefectRouteId("vehicleChecks", check.id, index)}`,
            },
          ]
        : []
    );
  });

  const issueDefects = vehicleIssues
    .filter((issue) => isApprovedDefect(issue?.review) && isOpenMaintenance(issue?.maintenance?.status))
    .map((issue) => ({
      id: `issue-${issue.id}`,
      title:
        issue?.title ||
        issue?.category ||
        (issue?.assetType === "equipment" ? "Equipment issue" : "Vehicle issue"),
      details: issue?.description || issue?.notes || issue?.review?.notes || "Approved maintenance issue.",
      asset:
        getEquipmentText(issue) ||
        getVehicleText(issue) ||
        (issue?.assetType === "equipment" ? "Equipment issue" : "Vehicle issue"),
      date: getRecordDate(issue),
      route: `/service/defects/${buildDefectRouteId("vehicleIssues", issue.id)}`,
    }));

  const reportDefects = defectReports
    .filter((report) => isOpenMaintenance(report?.status))
    .map((report) => ({
      id: `defect-${report.id}`,
      title: report?.category || report?.title || "Defect report",
      details: report?.description || report?.notes || "Open defect report.",
      asset: getEquipmentText(report) || getVehicleText(report) || "Defect report",
      date: getRecordDate(report),
      route: report.id
        ? `/service/defects/${buildDefectRouteId("defectReports", report.id)}`
        : "/service/defects",
    }));

  return [...checkDefects, ...issueDefects, ...reportDefects].sort(
    (a, b) => (toDateMaybe(b.date)?.getTime() || 0) - (toDateMaybe(a.date)?.getTime() || 0)
  );
}

function buildAdvisories({ serviceRecords, equipmentInspections }) {
  const services = serviceRecords.flatMap((record) => {
    const report = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    return report.flatMap((item, index) =>
      isOpenAdvisoryItem(item)
        ? [
            {
              id: `service-advisory-${record.id}-${item?.key || index}`,
              title: item?.title || "Service advisory",
              details: item?.details || item?.note || "Amber service item recorded.",
              asset: getVehicleText(record) || "Unknown vehicle",
              date: getRecordDate(record),
              route: record.id ? `/service/service-record/${record.id}` : null,
              sourceCollection: "serviceRecords",
              sourceId: record.id,
              itemKey: item?.key || "",
              itemIndex: index,
            },
          ]
        : []
    );
  });

  const inspections = equipmentInspections.flatMap((record) => {
    const report = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    return report.flatMap((item, index) =>
      isOpenAdvisoryItem(item)
        ? [
            {
              id: `inspection-advisory-${record.id}-${item?.key || index}`,
              title: item?.title || "Equipment advisory",
              details: item?.details || item?.note || "Amber inspection item recorded.",
              asset: getEquipmentText(record) || "Unknown equipment",
              date: getRecordDate(record),
              route: record.id ? `/service/inspections/inspection-form/${record.id}` : null,
              sourceCollection: "equipmentInspections",
              sourceId: record.id,
              itemKey: item?.key || "",
              itemIndex: index,
            },
          ]
        : []
    );
  });

  return [...services, ...inspections].sort(
    (a, b) => (toDateMaybe(b.date)?.getTime() || 0) - (toDateMaybe(a.date)?.getTime() || 0)
  );
}

function useCollectionRows(collectionName, label) {
  const { rows } = useServiceCollection(collectionName);
  return rows;
}

export default function ServiceIssuesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { patchServiceRow } = useServiceCacheActions();
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState(null);
  const [locallyResolvedIds, setLocallyResolvedIds] = useState(new Set());

  const vehicleChecks = useCollectionRows("vehicleChecks", "vehicle check issues");
  const vehicleIssues = useCollectionRows("vehicleIssues", "vehicle issues");
  const defectReports = useCollectionRows("defectReports", "defect reports");
  const serviceRecords = useCollectionRows("serviceRecords", "service advisories");
  const equipmentInspections = useCollectionRows("equipmentInspections", "equipment advisories");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const defects = useMemo(
    () => buildOpenDefects({ vehicleChecks, vehicleIssues, defectReports }),
    [defectReports, vehicleChecks, vehicleIssues]
  );

  const advisories = useMemo(
    () => buildAdvisories({ serviceRecords, equipmentInspections }),
    [equipmentInspections, serviceRecords]
  );
  const visibleAdvisories = useMemo(
    () => advisories.filter((item) => !locallyResolvedIds.has(item.id)),
    [advisories, locallyResolvedIds]
  );

  const markAdvisoryFixed = async (item) => {
    if (!item?.sourceCollection || !item?.sourceId) return;

    setResolvingId(item.id);
    try {
      const sourceRows =
        item.sourceCollection === "serviceRecords"
          ? serviceRecords
          : equipmentInspections;
      const sourceRecord = sourceRows.find(
        (record) => String(record.id) === String(item.sourceId)
      );
      const { nextItems, changed } = resolveMonitorReportItem(
        sourceRecord?.monitorReport,
        {
          itemKey: item.itemKey,
          itemIndex: item.itemIndex,
          nowISO: new Date().toISOString(),
        }
      );

      if (!changed) {
        Alert.alert("Not found", "This advisory could not be found on the source record.");
        return;
      }

      const updateData = {
        monitorReport: nextItems,
        updatedAt: serverTimestamp(),
      };
      const { queued } = await runOrQueueFirestoreMutations([
        {
          run: () =>
            updateDoc(doc(db, item.sourceCollection, String(item.sourceId)), updateData),
          mutation: {
            operation: "update",
            docPath: `${item.sourceCollection}/${item.sourceId}`,
            data: updateData,
            entityType:
              item.sourceCollection === "serviceRecords"
                ? "serviceRecord"
                : "equipmentInspection",
            entityId: String(item.sourceId),
          },
        },
      ]);
      await patchServiceRow(item.sourceCollection, item.sourceId, updateData);

      setLocallyResolvedIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });

      Alert.alert(
        queued ? "Saved offline" : "Marked fixed",
        queued
          ? "This advisory will be closed when the app syncs."
          : "This advisory has been removed from the open advisory list."
      );
    } catch (err) {
      console.error("Failed to mark advisory fixed:", err);
      Alert.alert("Error", "Could not mark this advisory fixed.");
    } finally {
      setResolvingId(null);
    }
  };

  const confirmMarkAdvisoryFixed = (item) => {
    Alert.alert(
      "Mark advisory fixed?",
      "This will close the amber monitor item and remove it from open advisory counts.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark fixed",
          onPress: () => markAdvisoryFixed(item),
        },
      ]
    );
  };

  return (
    <PageShell
      header={{
        variant: "hero",
        eyebrow: "Workshop",
        title: "Issues",
        subtitle: "Open defects and amber advisories needing workshop attention.",
      }}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent || COLORS.primaryAction} />
          <Text style={[styles.loadingText, { color: colors.textMuted || COLORS.textMid }]}>
            Loading issues...
          </Text>
        </View>
      ) : (
        <View style={styles.contentStack}>
          <View style={styles.summaryRow}>
            <SummaryCard label="Open defects" value={defects.length} tone="red" colors={colors} />
            <SummaryCard label="Advisories" value={visibleAdvisories.length} tone="amber" colors={colors} />
          </View>

          <IssueSection
            title="Defects & Issues"
            subtitle="Red/open items that need repair or investigation."
            emptyText="No open defects."
            items={defects}
            icon="alert-triangle"
            tone="red"
            colors={colors}
            onOpen={(route) => {
              if (route) router.push(route);
            }}
          />

          <IssueSection
            title="Advisories"
            subtitle="Amber items to monitor before they become defects."
            emptyText="No amber advisories."
            items={visibleAdvisories}
            icon="eye"
            tone="amber"
            colors={colors}
            onOpen={(route) => {
              if (route) router.push(route);
            }}
            onResolve={confirmMarkAdvisoryFixed}
            resolvingId={resolvingId}
          />

        </View>
      )}
    </PageShell>
  );
}

function SummaryCard({ label, value, tone, colors }) {
  const color = tone === "red" ? COLORS.primaryAction : COLORS.amber;
  return (
    <View
      style={[
        styles.summaryCard,
        {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        },
      ]}
    >
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
    </View>
  );
}

function IssueSection({
  title,
  subtitle,
  emptyText,
  items,
  icon,
  tone,
  colors,
  onOpen,
  onResolve,
  resolvingId,
}) {
  const badgeColor = tone === "red" ? COLORS.primaryAction : COLORS.amber;
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (groupKey) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            {title}
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted || COLORS.textMid }]}>
            {subtitle}
          </Text>
        </View>
        <Text style={[styles.sectionCount, { color: colors.textMuted || COLORS.textMid }]}>
          {items.length}
        </Text>
      </View>

      {items.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <Text style={[styles.emptyText, { color: colors.textMuted || COLORS.textMid }]}>
            {emptyText}
          </Text>
        </View>
      ) : (
        groupServiceIssuesByAsset(items).map((group) =>
          group.items.length > 1 ? (
            <View key={group.key} style={styles.vehicleGroup}>
              <View style={styles.vehicleGroupHeader}>
                <Icon name="truck" size={t.iconSize.sm} color={colors.textMuted || COLORS.textMid} />
                <Text style={[styles.vehicleGroupTitle, { color: colors.text || COLORS.textHigh }]}> 
                  {group.asset}
                </Text>
                <Text style={[styles.vehicleGroupCount, { color: colors.textMuted || COLORS.textMid }]}> 
                  {group.items.length} items
                </Text>
              </View>
              <View
                style={[
                  styles.groupedIssueList,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                {(expandedGroups.has(group.key) ? group.items : group.items.slice(0, 3)).map((item, index) => (
                  <GroupedIssueRow
                    key={item.id}
                    item={item}
                    icon={icon}
                    badgeColor={badgeColor}
                    colors={colors}
                    onOpen={onOpen}
                    onResolve={onResolve}
                    isResolving={resolvingId === item.id}
                    showDivider={index > 0}
                  />
                ))}
                {group.items.length > 3 ? (
                  <TouchableOpacity
                    style={[styles.groupToggle, { borderTopColor: colors.border || COLORS.border }]}
                    onPress={() => toggleGroup(group.key)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={expandedGroups.has(group.key) ? `Show fewer ${group.asset} items` : `Show all ${group.asset} items`}
                  >
                    <Text style={[styles.groupToggleText, { color: colors.link || colors.accent }]}> 
                      {expandedGroups.has(group.key)
                        ? "Show less"
                        : `Show ${group.items.length - 3} more`}
                    </Text>
                    <Icon
                      name={expandedGroups.has(group.key) ? "chevron-up" : "chevron-down"}
                      size={t.iconSize.sm}
                      color={colors.link || colors.accent}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : (
            <IssueCard
              key={group.items[0].id}
              item={group.items[0]}
              icon={icon}
              badgeColor={badgeColor}
              colors={colors}
              onOpen={onOpen}
              onResolve={onResolve}
              isResolving={resolvingId === group.items[0].id}
            />
          )
        )
      )}
    </View>
  );
}

function GroupedIssueRow({
  item,
  icon,
  badgeColor,
  colors,
  onOpen,
  onResolve,
  isResolving,
  showDivider,
}) {
  const canResolve = typeof onResolve === "function";
  const CardShell = item.route ? TouchableOpacity : View;
  const cardProps = item.route
    ? {
        activeOpacity: 0.85,
        onPress: () => onOpen(item.route),
        accessibilityRole: "button",
        accessibilityLabel: `Open ${item.title}`,
      }
    : {};

  return (
    <CardShell
      style={[
        styles.groupedIssueRow,
        showDivider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border || COLORS.border,
        },
      ]}
      {...cardProps}
    >
      <View style={[styles.groupedIssueIcon, { backgroundColor: badgeColor }]}> 
        <Icon name={icon} size={t.iconSize.xs} color={staticColors.hex_ffffff_5c2ocm} />
      </View>
      <View style={styles.groupedIssueCopy}>
        <Text numberOfLines={1} style={[styles.groupedIssueTitle, { color: colors.text || COLORS.textHigh }]}> 
          {item.title}
        </Text>
        <View style={styles.groupedIssueMeta}>
          <Text numberOfLines={1} style={[styles.groupedIssueDetail, { color: colors.textMuted || COLORS.textMid }]}> 
            {item.details}
          </Text>
          <Text style={[styles.issueDate, { color: colors.textMuted || COLORS.textLow }]}> 
            {formatDate(item.date)}
          </Text>
          {!!item.route ? (
            <Icon name="arrow-up-right" size={t.iconSize.xs} color={colors.textMuted || COLORS.textMid} />
          ) : null}
        </View>
      </View>
      {canResolve ? (
        <TouchableOpacity
          style={[styles.compactResolveButton, { borderColor: colors.success || staticColors.hex_157347_a4inet }]}
          activeOpacity={0.8}
          disabled={isResolving}
          accessibilityRole="button"
          accessibilityLabel={`Mark ${item.title} fixed`}
          onPress={(event) => {
            event?.stopPropagation?.();
            onResolve(item);
          }}
        >
          <Icon
            name={isResolving ? "loader" : "check"}
            size={t.iconSize.sm}
            color={colors.success || staticColors.hex_157347_a4inet}
          />
        </TouchableOpacity>
      ) : null}
    </CardShell>
  );
}

function IssueCard({
  item,
  icon,
  badgeColor,
  colors,
  onOpen,
  onResolve,
  isResolving,
  showAsset = true,
}) {
  const CardShell = item.route ? TouchableOpacity : View;
  const cardProps = item.route
    ? {
        activeOpacity: 0.85,
        onPress: () => onOpen(item.route),
        accessibilityRole: "button",
        accessibilityLabel: `Open ${item.title}`,
      }
    : {};
  const canResolve = typeof onResolve === "function";

  return (
    <CardShell
      style={[
        styles.issueCard,
        {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        },
      ]}
      {...cardProps}
    >
      <View style={[styles.iconWrap, { backgroundColor: badgeColor }]}> 
        <Icon name={icon} size={17} color={staticColors.hex_ffffff_5c2ocm} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.issueTitle, { color: colors.text || COLORS.textHigh }]}> 
          {item.title}
        </Text>
        <View style={styles.issueMetaRow}>
          {showAsset ? (
            <Text
              numberOfLines={1}
              style={[styles.assetText, { color: colors.textMuted || COLORS.textMid }]}
            > 
              {item.asset}
            </Text>
          ) : (
            <View style={styles.assetSpacer} />
          )}
          <View style={styles.issueMetaAction}>
            <Text style={[styles.issueDate, { color: colors.textMuted || COLORS.textLow }]}> 
              {formatDate(item.date)}
            </Text>
            {!!item.route && (
              <Icon name="arrow-up-right" size={t.iconSize.xs} color={colors.textMuted || COLORS.textMid} />
            )}
          </View>
        </View>
        <Text style={[styles.detailText, { color: colors.textMuted || COLORS.textMid }]}> 
          {item.details}
        </Text>
        {canResolve && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.resolveButton,
                { borderColor: colors.success || staticColors.hex_157347_a4inet },
              ]}
              activeOpacity={0.85}
              disabled={isResolving}
              onPress={(event) => {
                event?.stopPropagation?.();
                onResolve(item);
              }}
            >
              <Icon name="check-circle" size={13} color={colors.success || staticColors.hex_157347_a4inet} />
              <Text style={[styles.actionText, { color: colors.success || staticColors.hex_157347_a4inet }]}> 
                {isResolving ? "Saving..." : "Mark fixed"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </CardShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
  },
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.none,
    marginBottom: t.spacing.none,
  },
  headerContent: {
    paddingTop: t.spacing.xs,
    paddingBottom: t.spacing.xs,
  },
  headerEyebrow: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
  },
  headerTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    lineHeight: t.typography.titleSmall.lineHeight,
    marginTop: t.spacing.none,
  },
  headerSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: t.spacing.xxs,
    paddingBottom: 140,
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  },
  contentStack: {
    gap: t.spacing.md,
  },
  summaryCard: {
    flex: 1,
    minWidth: 130,
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.sm,
  },
  summaryValue: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "900",
  },
  summaryLabel: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
  },
  sectionBlock: {
    gap: t.spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
  sectionSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
  },
  sectionCount: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.sm,
  },
  emptyText: {
    fontSize: t.typography.bodySmall.fontSize,
  },
  issueCard: {
    flexDirection: "row",
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.sm,
  },
  vehicleGroup: {
    gap: t.spacing.xs,
  },
  vehicleGroupHeader: {
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  vehicleGroupTitle: {
    flex: 1,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "800",
  },
  vehicleGroupCount: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  groupedIssueList: {
    borderRadius: t.radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  groupedIssueRow: {
    minHeight: 64,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  groupedIssueIcon: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  groupedIssueCopy: {
    flex: 1,
    minWidth: 0,
  },
  groupedIssueTitle: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
  },
  groupedIssueMeta: {
    marginTop: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  groupedIssueDetail: {
    flex: 1,
    minWidth: 0,
    fontSize: t.typography.caption.fontSize,
  },
  compactResolveButton: {
    width: t.controls.buttonHeight,
    height: t.controls.buttonHeight,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  groupToggle: {
    minHeight: t.controls.buttonHeight,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  groupToggleText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  issueMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    marginTop: t.spacing.xxs,
  },
  issueMetaAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    flexShrink: 0,
  },
  issueTitle: {
    flex: 1,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },
  issueDate: {
    fontSize: t.typography.caption.fontSize,
  },
  assetText: {
    flex: 1,
    minWidth: 0,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
  },
  assetSpacer: {
    flex: 1,
  },
  detailText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  actionButton: {
    minHeight: 32,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  resolveButton: {
    backgroundColor: staticColors.rgba_13f5dp4,
  },
  actionText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
});
