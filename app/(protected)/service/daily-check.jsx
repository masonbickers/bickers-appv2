import { AppText as Text } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
import { useRouter } from "expo-router";
import {
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

export default function DailyCheckRoute() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <PageShell
      header={{
        variant: "compact",
        title: "Daily Check",
        subtitle: "Pre-shoot and daily vehicle checks are coming soon.",
        onBack: router.back,
      }}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <View style={styles.iconCircle}>
            <Icon name="clipboard" size={24} color={COLORS.primaryAction} />
          </View>
          <Text style={[styles.cardTitle, { color: colors.text || COLORS.textHigh }]}>
            Coming soon
          </Text>
          <Text
            style={[
              styles.cardText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            This workshop form is planned for a future update.
          </Text>
        </View>
      </View>
    </PageShell>
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  title: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  subtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  content: {
    flex: 1,
    padding: t.spacing.md,
    justifyContent: "center",
  },
  card: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: t.radius.md,
    backgroundColor: COLORS.card,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xl,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: t.spacing.sm,
    backgroundColor: staticColors.rgba_qyx9sr,
  },
  cardTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  cardText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
    textAlign: "center",
    color: COLORS.textMid,
  },
});
