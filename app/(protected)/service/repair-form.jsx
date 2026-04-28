import { useRouter } from "expo-router";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { useTheme } from "../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  primaryAction: "#ED1C25",
};

export default function RepairFormRoute() {
  const router = useRouter();
  const { colors } = useTheme();

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
          <Text style={[styles.title, { color: colors.text || COLORS.textHigh }]}>
            Repair / Rectification
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Repair logging and rectification records are coming soon.
          </Text>
        </View>
      </View>

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
            <Icon name="tool" size={24} color={COLORS.primaryAction} />
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
    </SafeAreaView>
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
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  content: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
  },
  card: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    backgroundColor: "rgba(237,28,37,0.12)",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  cardText: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    color: COLORS.textMid,
  },
});
