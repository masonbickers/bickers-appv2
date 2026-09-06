import { AppText as Text, AppPressable as TouchableOpacity } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
// app/(protected)/service/inspections/index.js
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { useServiceCollection } from "../../../../hooks/useServiceData";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

const STATUS_COLORS = {
  pass: { bg: staticColors.rgba_1bnty8h, fg: staticColors.hex_22c55e_740if4 },
  fail: { bg: staticColors.rgba_rveml8, fg: staticColors.hex_ef4444_4oizhh },
  incomplete: { bg: staticColors.rgba_iz9ft7, fg: staticColors.hex_f59e0b_4zbh7f },
};

function formatDate(raw) {
  if (!raw) return "—";
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InspectionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { rows: inspections, loading } = useServiceCollection(
    "equipmentInspections",
    {
      label: "equipment inspections",
      orderByField: "createdAt",
      orderDirection: "desc",
    }
  );

  const handleNew = () => {
    router.push(`/service/inspections/inspection-form/new-${Date.now()}`);
  };

  return (
    <PageShell customHeader={<View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}
          >
            Equipment Inspections
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Pre-use and periodic equipment condition checks.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.newButton}
          onPress={handleNew}
          activeOpacity={0.85}
        >
          <Icon name="plus" size={18} color={COLORS.textHigh} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>} customHeaderPlacement="fixed">
      {/* HEADER */}
      

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primaryAction} />
        </View>
      ) : (
        <>
          {inspections.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name="clipboard"
                size={36}
                color={colors.textMuted || COLORS.textLow}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                No inspections yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Tap New to record your first equipment inspection.
              </Text>
            </View>
          ) : (
            inspections.map((insp) => {
              const statusKey =
                insp.overallResult === "pass"
                  ? "pass"
                  : insp.overallResult === "fail"
                  ? "fail"
                  : "incomplete";
              const sc = STATUS_COLORS[statusKey];

              return (
                <TouchableOpacity
                  key={insp.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderColor: colors.border || COLORS.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() =>
                    router.push(
                      `/service/inspections/inspection-form/${insp.id}`
                    )
                  }
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.cardTitle,
                          { color: colors.text || COLORS.textHigh },
                        ]}
                        numberOfLines={1}
                      >
                        {insp.equipmentName || "Unnamed equipment"}
                      </Text>
                      {!!insp.equipmentId && (
                        <Text
                          style={[
                            styles.cardSub,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          ID: {insp.equipmentId}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusPillText, { color: sc.fg }]}>
                        {statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardMeta}>
                    <View style={styles.metaItem}>
                      <Icon
                        name="calendar"
                        size={12}
                        color={colors.textMuted || COLORS.textLow}
                        style={{ marginRight: t.spacing.xxs }}
                      />
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        {formatDate(insp.createdAt)}
                      </Text>
                    </View>
                    {!!insp.inspectedBy && (
                      <View style={styles.metaItem}>
                        <Icon
                          name="user"
                          size={12}
                          color={colors.textMuted || COLORS.textLow}
                          style={{ marginRight: t.spacing.xxs }}
                        />
                        <Text
                          style={[
                            styles.metaText,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          {insp.inspectedBy}
                        </Text>
                      </View>
                    )}
                  </View>

                  <Icon
                    name="chevron-right"
                    size={16}
                    color={colors.textMuted || COLORS.textLow}
                    style={styles.cardChevron}
                  />
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </>
      )}
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
  },
  pageTitle: { fontSize: t.typography.titleSmall.fontSize, fontWeight: "800" },
  pageSubtitle: { marginTop: t.spacing.none, fontSize: t.typography.bodySmall.fontSize },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primaryAction,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    marginLeft: t.spacing.sm,
  },
  newButtonText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: t.typography.body.fontSize,
    marginLeft: t.spacing.xxs,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: t.spacing.md, paddingTop: t.spacing.sm },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    paddingHorizontal: t.spacing.xl,
  },
  emptyTitle: { marginTop: t.spacing.sm, fontSize: t.typography.sectionTitle.fontSize, fontWeight: "700" },
  emptySubtitle: { marginTop: t.spacing.xxs, fontSize: t.typography.bodySmall.fontSize, textAlign: "center" },
  card: {
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.sm,
    marginBottom: t.spacing.xs,
    position: "relative",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: t.spacing.xs,
  },
  cardTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700" },
  cardSub: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none },
  statusPill: {
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    marginLeft: t.spacing.xs,
    alignSelf: "flex-start",
  },
  statusPillText: { fontSize: t.typography.caption.fontSize, fontWeight: "700" },
  cardMeta: { flexDirection: "row", gap: t.spacing.sm },
  metaItem: { flexDirection: "row", alignItems: "center" },
  metaText: { fontSize: t.typography.metadata.fontSize },
  cardChevron: { position: "absolute", right: 12, top: "50%" },
});
