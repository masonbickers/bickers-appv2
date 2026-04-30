// app/(protected)/service/work.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import PageHeaderCard from "../../../components/PageHeaderCard";
import { designTokens as t } from "../../../lib/design/tokens";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#000000",
  card: "#151517",
  border: "#2B2B31",
  textHigh: "#F5F5F5",
  textMid: "#D4D4D8",
  textLow: "#A1A1AA",
  primaryAction: "#D94B52",
  recceAction: "#D94B52",
  inputBg: "#111114",
  lightGray: "#3F3F46",
};

const FEATURE_FLAGS = {
  motResultLog: false,
  tyreBrakeCheck: false,
  dailyCheck: false,
};

const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";
const MINOR_SERVICE_DRAFTS_KEY = "minorServiceFormDrafts_v1";

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
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      <PageHeaderCard
        eyebrow="Workshop"
        title="Workshop Forms"
        subtitle="Templates for servicing, MOT prep, defects and safety checks."
        style={styles.headerCard}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* INTRO CARD */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderLeftColor: colors.primary || COLORS.primaryAction,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <Text
            style={[
              styles.infoTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service & MOT workflow
          </Text>
          <Text
            style={[
              styles.infoSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Use these forms to log workshop jobs, complete MOT pre-checks and
            record findings against each vehicle.
          </Text>
        </View>

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
          title="Service Job Form"
          subtitle="Full service checklist, parts, labour and workshop notes."
          onPress={handleNewServiceJobForm}
          colors={colors}
        />

        <FormCard
          icon="refresh-ccw"
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
          title="MOT Pre-Check"
          subtitle="Lights, tyres, brakes, washer, emissions prep and advisories."
          onPress={handleNewMotPrecheckForm}
          colors={colors}
        />

        {FEATURE_FLAGS.motResultLog && (
          <FormCard
            icon="file-text"
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
          title="Defect Report"
          subtitle="Driver or crew-reported issues that need investigation."
          onPress={() => go("/service/defect-form")}
          colors={colors}
        />

        <FormCard
          icon="wrench"
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
                title="Tyre & Brake Check"
                subtitle="Depth, wear pattern, pressures, discs & pads condition."
                onPress={() => go("/service/tyre-brake-check")}
                colors={colors}
              />
            )}

            {FEATURE_FLAGS.dailyCheck && (
              <FormCard
                icon="shield"
                title="Pre-Shoot / Daily Check"
                subtitle="Fluids, damage, load security and on-set readiness."
                onPress={() => go("/service/daily-check")}
                colors={colors}
              />
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- SMALL CARD COMPONENT ---------- */

function FormCard({ icon, title, subtitle, onPress, colors }) {
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
      <View style={cardStyles.iconWrap}>
        {/* 🔒 Force icons to white so they’re always visible */}
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
      <Icon
        name="chevron-right"
        size={18}
        color={colors.textMuted || COLORS.textMid}
        style={{ marginLeft: 8 }}
      />
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
      <Icon
        name="chevron-right"
        size={18}
        color={colors.textMuted || COLORS.textMid}
        style={{ marginLeft: 8 }}
      />
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
    marginTop: t.spacing.xs,
    marginBottom: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: 0,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.sm,
    padding: t.controls.cardPadding,
    marginBottom: t.spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textHigh,
    paddingRight: 10,
  },
  draftsWrap: {
    marginTop: 2,
    marginBottom: 12,
  },
  draftsTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 8,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: 10,
    minHeight: 72,
    padding: t.controls.cardPadding,
    marginBottom: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textLow,
  },
  draftCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: 10,
    minHeight: 64,
    padding: t.controls.cardPadding,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
  },
  draftIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(217, 75, 82, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  draftTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 2,
  },
  draftSubtitle: {
    fontSize: 12,
    color: COLORS.textLow,
  },
});
