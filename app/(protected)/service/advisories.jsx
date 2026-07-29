import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../../../firebaseConfig";
import {
  isOpenAdvisoryItem,
  resolveMonitorReportItem,
} from "../../../lib/serviceAdvisories";
import { useServiceCacheActions, useServiceCollection } from "../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../lib/sync/firestoreQueue";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  amber: "#F59E0B",
  inputBg: "#111114",
};

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const str = String(value).trim();
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const ukMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ukMatch) {
    const [, dd, mm, yyyy] = ukMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return "No date";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function daysSince(value) {
  const d = parseDate(value);
  if (!d) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const noted = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.floor((start.getTime() - noted.getTime()) / 86400000));
}

function getRecordDate(record) {
  return (
    record?.inspectionDateISO ||
    record?.serviceDateOnly ||
    record?.completedDate ||
    record?.inspectionDate ||
    record?.serviceDate ||
    record?.createdAt ||
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

function buildAdvisories({ serviceRecords, equipmentInspections }) {
  const serviceAdvisories = serviceRecords.flatMap((record) => {
    const report = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    const date = getRecordDate(record);
    return report.flatMap((item, index) =>
      isOpenAdvisoryItem(item)
        ? [
            {
              id: `service-${record.id}-${item?.key || index}`,
              sourceType: "Service",
              icon: "tool",
              sourceCollection: "serviceRecords",
              sourceId: record.id,
              itemKey: item?.key || "",
              itemIndex: index,
              title: item?.title || "Service advisory",
              details: item?.details || item?.note || "Amber service item recorded.",
              asset: getVehicleText(record) || "Unknown vehicle",
              notedDate: date,
              days: daysSince(date),
              route: record.id ? `/service/service-record/${record.id}` : null,
            },
          ]
        : []
    );
  });

  const inspectionAdvisories = equipmentInspections.flatMap((record) => {
    const report = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    const date = getRecordDate(record);
    return report.flatMap((item, index) =>
      isOpenAdvisoryItem(item)
        ? [
            {
              id: `inspection-${record.id}-${item?.key || index}`,
              sourceType: "Inspection",
              icon: "clipboard",
              sourceCollection: "equipmentInspections",
              sourceId: record.id,
              itemKey: item?.key || "",
              itemIndex: index,
              title: item?.title || "Equipment advisory",
              details: item?.details || item?.note || "Amber inspection item recorded.",
              asset: getEquipmentText(record) || "Unknown equipment",
              notedDate: date,
              days: daysSince(date),
              route: record.id ? `/service/inspections/inspection-form/${record.id}` : null,
            },
          ]
        : []
    );
  });

  return [...serviceAdvisories, ...inspectionAdvisories].sort(
    (a, b) => (b.days ?? -1) - (a.days ?? -1)
  );
}

function groupAdvisoriesByAsset(items) {
  const groups = new Map();

  items.forEach((item) => {
    const key = normaliseKey(item.asset) || item.id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        asset: item.asset,
        items: [],
      });
    }
    groups.get(key).items.push(item);
  });

  return Array.from(groups.values())
    .map((group) => {
      const sortedItems = [...group.items].sort(
        (a, b) => (b.days ?? -1) - (a.days ?? -1)
      );
      return {
        ...group,
        items: sortedItems,
        oldestDays: sortedItems[0]?.days ?? null,
        sourceTypes: Array.from(new Set(sortedItems.map((item) => item.sourceType))),
      };
    })
    .sort((a, b) => (b.oldestDays ?? -1) - (a.oldestDays ?? -1));
}

function useCollectionRows(collectionName, label) {
  const { rows } = useServiceCollection(collectionName);
  return rows;
}

export default function AdvisoriesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { patchServiceRow } = useServiceCacheActions();
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [resolvingId, setResolvingId] = useState(null);
  const [locallyResolvedIds, setLocallyResolvedIds] = useState(new Set());

  const serviceRecords = useCollectionRows("serviceRecords", "service advisories");
  const equipmentInspections = useCollectionRows("equipmentInspections", "inspection advisories");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const advisories = useMemo(
    () => buildAdvisories({ serviceRecords, equipmentInspections }),
    [equipmentInspections, serviceRecords]
  );
  const visibleAdvisories = useMemo(
    () => advisories.filter((item) => !locallyResolvedIds.has(item.id)),
    [advisories, locallyResolvedIds]
  );

  const filtered = useMemo(() => {
    const queryText = normaliseKey(searchText);
    return visibleAdvisories.filter((item) => {
      if (sourceFilter !== "all" && normaliseKey(item.sourceType) !== sourceFilter) {
        return false;
      }
      if (!queryText) return true;
      return [item.title, item.details, item.asset, item.sourceType]
        .map(normaliseKey)
        .join(" ")
        .includes(queryText);
    });
  }, [searchText, sourceFilter, visibleAdvisories]);

  const groupedAdvisories = useMemo(() => groupAdvisoriesByAsset(filtered), [filtered]);

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
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.container, { backgroundColor: colors.background || COLORS.background }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border || COLORS.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Icon name="chevron-left" size={22} color={colors.text || COLORS.textHigh} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}>
            Advisories
          </Text>
          <Text style={[styles.pageSubtitle, { color: colors.textMuted || COLORS.textMid }]}>
            Amber service and equipment inspection items being monitored.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent || COLORS.primaryAction} />
          <Text style={[styles.loadingText, { color: colors.textMuted || COLORS.textMid }]}>
            Loading advisories...
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <SummaryItem label="Total" value={visibleAdvisories.length} colors={colors} />
            <SummaryItem
              label="Service"
              value={visibleAdvisories.filter((item) => item.sourceType === "Service").length}
              colors={colors}
            />
            <SummaryItem
              label="Inspection"
              value={visibleAdvisories.filter((item) => item.sourceType === "Inspection").length}
              colors={colors}
            />
          </View>

          <View
            style={[
              styles.filterCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.inputBackground || COLORS.inputBg,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
            >
              <Icon
                name="search"
                size={16}
                color={colors.textMuted || COLORS.textMid}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text || COLORS.textHigh }]}
                placeholder="Search vehicle, equipment or advisory..."
                placeholderTextColor={colors.textMuted || COLORS.textLow}
                value={searchText}
                onChangeText={setSearchText}
              />
            </View>

            <View style={styles.filterRow}>
              {[
                ["all", "All"],
                ["service", "Service"],
                ["inspection", "Inspection"],
              ].map(([value, label]) => {
                const active = sourceFilter === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.filterPill,
                      {
                        backgroundColor: active
                          ? COLORS.primaryAction
                          : colors.surface || COLORS.card,
                        borderColor: active
                          ? COLORS.primaryAction
                          : colors.border || COLORS.border,
                      },
                    ]}
                    onPress={() => setSourceFilter(value)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        { color: active ? "#FFFFFF" : colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {groupedAdvisories.length === 0 ? (
            <View
              style={[
                styles.emptyState,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.card,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
            >
              <Icon name="eye" size={30} color={colors.textMuted || COLORS.textMid} />
              <Text style={[styles.emptyTitle, { color: colors.text || COLORS.textHigh }]}>
                No advisories
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted || COLORS.textMid }]}>
                Amber service and inspection items will appear here.
              </Text>
            </View>
          ) : (
            groupedAdvisories.map((group) => (
              <View
                key={group.id}
                style={[
                  styles.advisoryGroupCard,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                <View style={styles.groupHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assetTitle, { color: colors.text || COLORS.textHigh }]}>
                      {group.asset}
                    </Text>
                    <Text style={[styles.groupMetaText, { color: colors.textMuted || COLORS.textMid }]}>
                      {group.items.length} advisory{group.items.length === 1 ? "" : "ies"} · {group.sourceTypes.join(" + ")}
                    </Text>
                  </View>
                  {group.items.length > 1 ? (
                    <View style={styles.countPill}>
                      <Text style={styles.countPillText}>{group.items.length}</Text>
                    </View>
                  ) : null}
                </View>

                {group.items.map((item, index) => (
                  <View
                    key={item.id}
                    style={[
                      styles.advisoryItemRow,
                      index > 0 && styles.advisoryItemDivider,
                    ]}
                  >
                    <View style={styles.iconWrap}>
                      <Icon name={item.icon} size={18} color={COLORS.textHigh} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.cardHeaderRow}>
                        <Text style={[styles.advisoryTitle, { color: colors.text || COLORS.textHigh }]}>
                          {item.title}
                        </Text>
                        <View style={styles.daysPill}>
                          <Text style={styles.daysPillText}>
                            {item.days === null
                              ? "No date"
                              : `${item.days} day${item.days === 1 ? "" : "s"}`}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.detailsText, { color: colors.textMuted || COLORS.textMid }]}>
                        {item.details}
                      </Text>
                      <Text style={[styles.metaText, { color: colors.textMuted || COLORS.textLow }]}>
                        {item.sourceType} · Noted {formatDate(item.notedDate)}
                      </Text>
                      <View style={styles.actionRow}>
                        {!!item.route && (
                          <TouchableOpacity
                            style={[
                              styles.actionButton,
                              { borderColor: colors.border || COLORS.border },
                            ]}
                            activeOpacity={0.85}
                            onPress={() => router.push(item.route)}
                          >
                            <Icon
                              name="file-text"
                              size={13}
                              color={colors.text || COLORS.textHigh}
                            />
                            <Text style={[styles.actionText, { color: colors.text || COLORS.textHigh }]}>
                              Open record
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[
                            styles.actionButton,
                            styles.resolveButton,
                            { borderColor: colors.success || "#157347" },
                          ]}
                          activeOpacity={0.85}
                          disabled={resolvingId === item.id}
                          onPress={() => confirmMarkAdvisoryFixed(item)}
                        >
                          <Icon name="check-circle" size={13} color={colors.success || "#157347"} />
                          <Text style={[styles.actionText, { color: colors.success || "#157347" }]}>
                            {resolvingId === item.id ? "Saving..." : "Mark fixed"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SummaryItem({ label, value, colors }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, { color: colors.text || COLORS.textHigh }]}>
        {value}
      </Text>
      <Text style={[styles.summaryLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
    </View>
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
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
  },
  scrollContent: {
    padding: 16,
  },
  summaryCard: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  summaryItem: {
    flex: 1,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: "800",
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 12,
  },
  filterCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  filterPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "800",
  },
  emptyState: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: "800",
  },
  emptySubtitle: {
    marginTop: 4,
    fontSize: 13,
    textAlign: "center",
  },
  advisoryGroupCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  assetTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  groupMetaText: {
    marginTop: 2,
    fontSize: 12,
  },
  countPill: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  countPillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  advisoryItemRow: {
    flexDirection: "row",
    paddingTop: 8,
  },
  advisoryItemDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.amber,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  advisoryTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  daysPill: {
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.16)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  daysPillText: {
    color: COLORS.amber,
    fontSize: 11,
    fontWeight: "800",
  },
  detailsText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
  },
  metaText: {
    marginTop: 6,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  actionButton: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  resolveButton: {
    backgroundColor: "rgba(21,115,71,0.08)",
  },
  actionText: {
    fontSize: 12,
    fontWeight: "800",
  },
});
