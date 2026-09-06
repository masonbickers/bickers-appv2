import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
// app/(protected)/service/work.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useFocusEffect,
  useRouter } from "expo-router";
import { useCallback,
  useState } from "react";
import { StyleSheet, View } from "react-native";
import Icon from "react-native-vector-icons/Feather";

import PageShell from "../../../components/layout/PageShell";
import { servicePalette as COLORS } from "../../../lib/design/semantics";
import { designTokens as t } from "../../../lib/design/tokens";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";

const FEATURE_FLAGS = {
  motResultLog: false,
  tyreBrakeCheck: false,
  dailyCheck: false,
};

const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";
const MINOR_SERVICE_DRAFTS_KEY = "minorServiceFormDrafts_v1";

const FORM_ICON_COLORS = {
  service: staticColors.hex_2563eb_6ywilf,
  inspection: staticColors.hex_64748b_4jwrvh,
  defect: COLORS.primaryAction,
  repair: staticColors.hex_d97706_6cn8pp,
};

function getDraftTimestampFromId(id) {
  if (!id) return 0;
  const n = Number(String(id).split("-").pop());
  return Number.isNaN(n) ? 0 : n;
}

function buildDraftList(raw, type, routePrefix, fallbackTitle) {
  const drafts = raw ? JSON.parse(raw) || {} : {};
  return Object.entries(drafts).map(([id, draft]) => ({
    id,
    type,
    route: `${routePrefix}/${id}`,
    timestamp: getDraftTimestampFromId(id),
    title: draft.vehicleName || draft.vehicleSearch || fallbackTitle,
    registration: draft.registration || "",
    serviceType: draft.serviceType || type,
    serviceDate: draft.serviceDate || "In progress",
  }));
}

export default function WorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [serviceDrafts, setServiceDrafts] = useState([]);

  const go = (route) => {
    router.push(route);
  };

  // 👉 start a brand-new Service Job Form
  const handleNewServiceJobForm = () => {
    // Keep existing drafts intact; the form autosaves under this unique id.
    const newId = `manual-${Date.now()}`;
    router.push(`/service/service-form/${newId}`);
  };

  // 👉 start a brand-new Minor / Interim Service form
  const handleNewMinorServiceForm = () => {
    const newId = `minor-${Date.now()}`;
    router.push(`/service/minor-service/${newId}`);
  };

  // 👉 start a brand-new MOT Pre-Check form
  const handleNewMotPrecheckForm = () => {
    // Keep existing MOT drafts intact; the form autosaves under this unique id.
    const newId = `mot-${Date.now()}`;
    router.push(`/service/mot-precheck/${newId}`);
  };

  const handleNewEquipmentInspection = () => {
    router.push(`/service/inspections/inspection-form/new-${Date.now()}`);
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadDrafts = async () => {
        try {
          const [fullRaw, minorRaw] = await Promise.all([
            AsyncStorage.getItem(SERVICE_DRAFTS_KEY),
            AsyncStorage.getItem(MINOR_SERVICE_DRAFTS_KEY),
          ]);

          const drafts = [
            ...buildDraftList(
              fullRaw,
              "Service Job Form",
              "/service/service-form",
              "Service draft"
            ),
            ...buildDraftList(
              minorRaw,
              "Interim / Minor Service",
              "/service/minor-service",
              "Minor service draft"
            ),
          ].sort((a, b) => b.timestamp - a.timestamp);

          if (active) setServiceDrafts(drafts);
        } catch (err) {
          console.error("Failed to load service form drafts:", err);
          if (active) setServiceDrafts([]);
        }
      };

      loadDrafts();

      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <PageShell
      contentSpacing="compact"
      header={{
        variant: "hero",
        eyebrow: "Workshop",
        title: "Workshop Forms",
        subtitle: "Templates for servicing, MOT prep, defects and safety checks.",
      }}
    >
        {/* SECTION: SERVICE FORMS */}
        <View style={styles.sectionDivider}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service Forms
          </Text>
        </View>

        <FormCard
          icon="tool"
          iconTone="service"
          title="Full Service"
          subtitle="Full service checklist, parts, labour and workshop notes."
          onPress={handleNewServiceJobForm}
          colors={colors}
        />

        <FormCard
          icon="refresh-ccw"
          iconTone="service"
          title="Interim / Minor Service"
          subtitle="Oil, filters and basic safety checks for shorter intervals."
          onPress={handleNewMinorServiceForm}
          colors={colors}
        />

        {serviceDrafts.length > 0 && (
          <View style={styles.draftsWrap}>
            <Text
              style={[
                styles.draftsTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Drafts
            </Text>
            {serviceDrafts.map((draft) => (
              <DraftCard
                key={`${draft.type}-${draft.id}`}
                draft={draft}
                onPress={() => router.push(draft.route)}
                colors={colors}
              />
            ))}
          </View>
        )}

        {/* SECTION: INSPECTIONS */}
        <View style={styles.sectionDivider}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Inspections
          </Text>
        </View>

        <FormCard
          icon="clipboard"
          iconTone="inspection"
          title="Equipment Inspection"
          subtitle="Pre-use condition check for stunt equipment, rigs and vehicles."
          onPress={handleNewEquipmentInspection}
          colors={colors}
        />

        {/* SECTION: MOT FORMS */}
        <View style={styles.sectionDivider}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            MOT & Compliance
          </Text>
        </View>

        <FormCard
          icon="clipboard"
          iconTone="inspection"
          title="MOT Pre-Check"
          subtitle="Lights, tyres, brakes, washer, emissions prep and advisories."
          onPress={handleNewMotPrecheckForm}
          colors={colors}
        />

        {FEATURE_FLAGS.motResultLog && (
          <FormCard
            icon="file-text"
            iconTone="inspection"
            title="MOT Result / Advisory Log"
            subtitle="Record pass/fail, advisories and next actions."
            onPress={() => go("/service/mot-result")}
            colors={colors}
          />
        )}

        {/* SECTION: DEFECTS / REPAIRS */}
        <View style={styles.sectionDivider}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Defects & Repairs
          </Text>
        </View>

        <FormCard
          icon="alert-triangle"
          iconTone="defect"
          title="Defect Report"
          subtitle="Driver or crew-reported issues that need investigation."
          onPress={() => go("/service/defect-form")}
          colors={colors}
        />

        <FormCard
          icon="wrench"
          iconTone="repair"
          title="General Repairs"
          subtitle="Record ad-hoc repairs, rectification work and parts used."
          onPress={() => go("/service/repair-form")}
          colors={colors}
        />

        {(FEATURE_FLAGS.tyreBrakeCheck || FEATURE_FLAGS.dailyCheck) && (
          <>
            {/* SECTION: TYRES / SAFETY CHECKS */}
            <View style={styles.sectionDivider}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Tyres & Safety Checks
              </Text>
            </View>

            {FEATURE_FLAGS.tyreBrakeCheck && (
              <FormCard
                icon="target"
                iconTone="inspection"
                title="Tyre & Brake Check"
                subtitle="Depth, wear pattern, pressures, discs & pads condition."
                onPress={() => go("/service/tyre-brake-check")}
                colors={colors}
              />
            )}

            {FEATURE_FLAGS.dailyCheck && (
              <FormCard
                icon="shield"
                iconTone="inspection"
                title="Pre-Shoot / Daily Check"
                subtitle="Fluids, damage, load security and on-set readiness."
                onPress={() => go("/service/daily-check")}
                colors={colors}
              />
            )}
          </>
        )}

    </PageShell>
  );
}

/* ---------- SMALL CARD COMPONENT ---------- */

function FormCard({ icon, iconTone = "service", title, subtitle, onPress, colors }) {
  const iconColor = FORM_ICON_COLORS[iconTone] || staticColors.hex_64748b_4jwrvh;

  return (
    <TouchableOpacity
      style={[
        cardStyles.card,
        {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[cardStyles.iconWrap, { backgroundColor: iconColor }]}>
        <Icon name={icon} size={18} color={COLORS.textHigh} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            cardStyles.title,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            cardStyles.subtitle,
            { color: colors.textMuted || COLORS.textLow },
          ]}
        >
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function DraftCard({ draft, onPress, colors }) {
  return (
    <TouchableOpacity
      style={[
        cardStyles.draftCard,
        {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.primary || COLORS.primaryAction,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={cardStyles.draftIconWrap}>
        <Icon name="save" size={17} color={COLORS.textHigh} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            cardStyles.draftTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          {draft.title}
          {draft.registration ? ` · ${draft.registration}` : ""}
        </Text>
        <Text
          style={[
            cardStyles.draftSubtitle,
            { color: colors.textMuted || COLORS.textLow },
          ]}
        >
          {draft.serviceType} · {draft.serviceDate}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.none,
    marginBottom: t.spacing.none,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: t.spacing.none,
    paddingBottom: 140,
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.xs,
  },
  sectionTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
    paddingRight: t.spacing.xs,
  },
  draftsWrap: {
    marginTop: t.spacing.none,
    marginBottom: t.spacing.sm,
  },
  draftsTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.xs,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    minHeight: 72,
    padding: t.spacing.sm,
    borderWidth: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_262626_70t9oi,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  title: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.none,
  },
  subtitle: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
  },
  draftCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    minHeight: 64,
    padding: t.spacing.sm,
    marginBottom: t.spacing.xs,
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
  },
  draftIconWrap: {
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_6el2ey,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  draftTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.none,
  },
  draftSubtitle: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
  },
});
