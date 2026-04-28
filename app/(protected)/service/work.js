// app/(protected)/service/work.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  Alert,
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
import { useTheme } from "../../providers/ThemeProvider";

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

// 🔑 must match service-form/[id].jsx + book-work.jsx
const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";
// 🔑 must match mot-precheck/[id].jsx
const MOT_PRECHECK_DRAFT_KEY = "motPrecheckDrafts_v1";

const showUnavailableForm = () => {
  Alert.alert(
    "Coming soon",
    "This workshop form is planned for a future update."
  );
};

export default function WorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const go = (route) => {
    router.push(route);
  };

  // 👉 start a brand-new Service Job Form
  const handleNewServiceJobForm = async () => {
    try {
      // clear any existing draft so this is a clean form
      await AsyncStorage.removeItem(SERVICE_DRAFTS_KEY);
    } catch (err) {
      console.error("Failed to clear service draft before new form:", err);
    }

    // we just need *some* id for [id].jsx
    const newId = `manual-${Date.now()}`;
    router.push(`/service/service-form/${newId}`);
  };

  // 👉 start a brand-new Minor / Interim Service form
  const handleNewMinorServiceForm = () => {
    const newId = `minor-${Date.now()}`;
    router.push(`/service/minor-service/${newId}`);
  };

  // 👉 start a brand-new MOT Pre-Check form
  const handleNewMotPrecheckForm = async () => {
    try {
      // clear any existing MOT pre-check draft
      await AsyncStorage.removeItem(MOT_PRECHECK_DRAFT_KEY);
    } catch (err) {
      console.error("Failed to clear MOT pre-check draft before new form:", err);
    }

    const newId = `mot-${Date.now()}`;
    router.push(`/service/mot-precheck/${newId}`);
  };

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

        <FormCard
          icon="file-text"
          title="MOT Result / Advisory Log"
          subtitle="Record pass/fail, advisories and next actions."
          onPress={showUnavailableForm}
          colors={colors}
        />

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
          title="Repair / Rectification Form"
          subtitle="Record what was fixed, parts used and test drive notes."
          onPress={() => go("/service/repair-form")}
          colors={colors}
        />

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

        <FormCard
          icon="target"
          title="Tyre & Brake Check"
          subtitle="Depth, wear pattern, pressures, discs & pads condition."
          onPress={() => go("/service/tyre-brake-check")}
          colors={colors}
        />

        <FormCard
          icon="shield"
          title="Pre-Shoot / Daily Check"
          subtitle="Fluids, damage, load security and on-set readiness."
          onPress={() => go("/service/daily-check")}
          colors={colors}
        />

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
});
