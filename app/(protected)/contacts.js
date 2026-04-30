// app/(protected)/contacts.js
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import PageHeaderCard from "../../components/PageHeaderCard";
import { db } from "../../firebaseConfig";
import { designTokens as t } from "../../lib/design/tokens";

import { useTheme } from "../../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function ContactsPage() {
  const { colors, colorScheme } = useTheme();
  const isDark = colorScheme === "dark";

  const [employees, setEmployees] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(collection(db, "employees"));
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const sorted = data.sort((a, b) =>
        (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
      );
      setEmployees(sorted);
    } catch (error) {
      console.error("Error fetching employees:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return employees;

    return employees.filter((emp) => {
      const name = (emp.name || "").toLowerCase();
      const phone = (emp.mobile || "").toLowerCase();
      let titles = "";
      if (Array.isArray(emp.jobTitle)) {
        titles = emp.jobTitle.join(" ").toLowerCase();
      } else if (typeof emp.jobTitle === "string") {
        titles = emp.jobTitle.toLowerCase();
      }
      return (
        name.includes(needle) ||
        phone.includes(needle) ||
        titles.includes(needle)
      );
    });
  }, [employees, q]);

  /* ---------- Phone helpers ---------- */
  const sanitizePhone = (raw) => {
    if (!raw) return "";
    const trimmed = String(raw).trim();
    const plus = trimmed.startsWith("+") ? "+" : "";
    const digits = trimmed.replace(/[^\d]/g, "");
    return plus + digits;
  };

  const toIntlNoPlusUK = (raw) => {
    if (!raw) return "";
    const only = String(raw).replace(/[^\d+]/g, "");

    if (only.startsWith("+44")) return only.slice(1);
    if (only.startsWith("44")) return only;
    if (only.startsWith("07")) return "44" + only.slice(1);
    if (only.startsWith("7")) return "44" + only;
    if (only.startsWith("+")) return only.slice(1);
    if (only.startsWith("0") && only.length > 1) return "44" + only.slice(1);
    return only.replace(/[^\d]/g, "");
  };

  /* ---------- Actions ---------- */
  const callNumber = async (raw) => {
    const num = sanitizePhone(raw);
    if (!num) {
      Alert.alert("No number", "This contact does not have a phone number.");
      return;
    }
    const scheme = Platform.OS === "ios" ? "telprompt:" : "tel:";
    const url = `${scheme}${num}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert("Cannot call", "Calling is not supported on this device.");
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Error", "Failed to start the call.");
      console.error(e);
    }
  };

  const messageWhatsApp = async (raw, name) => {
    const intlNoPlus = toIntlNoPlusUK(raw);
    if (!intlNoPlus) {
      Alert.alert(
        "Invalid number",
        "This number could not be formatted for WhatsApp."
      );
      return;
    }
    const text = encodeURIComponent(`Hi ${name || ""}`.trim());

    const appUrl = `whatsapp://send?phone=${intlNoPlus}&text=${text}`;
    const webUrl = `https://wa.me/${intlNoPlus}?text=${text}`;

    try {
      const hasApp = await Linking.canOpenURL("whatsapp://send?text=hello");
      if (hasApp) {
        await Linking.openURL(appUrl);
      } else {
        await Linking.openURL(webUrl);
      }
    } catch (e) {
      Alert.alert("Error", "Unable to open WhatsApp.");
      console.error(e);
    }
  };

  const totalCount = employees.length;
  const showingCount = filtered.length;

  // 🔹 All colours from theme
  const bg = colors.background;
  const cardBg = colors.surfaceAlt ?? colors.surface;
  const borderColor = colors.border;
  const textPrimary = colors.text;
  const textMuted = colors.textMuted ?? "#7a7a7a";
  const inputBg = colors.inputBackground ?? colors.surface;
  const inputBorder = colors.inputBorder ?? colors.border;
  const placeholder = colors.placeholder ?? textMuted;
  const iconMuted = colors.iconMuted ?? textMuted;
  const emptyBg = colors.surface ?? colors.surfaceAlt;
  const avatarBg = colors.avatarBg ?? colors.surface;
  const avatarBorder = colors.avatarBorder ?? colors.border;
  const metaText = colors.metaText ?? textMuted;
  const clearBg = colors.chipBg ?? (isDark ? "#252525" : "#e5e5ea");
  const callColor = colors.accent ?? "#C8102E";
  const msgColor = "#23C063";
  const disabledBg = colors.disabled ?? (isDark ? "#2a2a2a" : "#d1d1d6");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={loadEmployees}
              tintColor={colors.accent}
            />
          }
        >
          <PageHeaderCard
            eyebrow="Team"
            title="Contacts"
            subtitle="Reach crew quickly by phone or WhatsApp."
            style={styles.heroCard}
            contentStyle={styles.heroContent}
            titleStyle={{ color: textPrimary }}
            eyebrowStyle={{ color: textMuted }}
            subtitleStyle={{ color: textMuted }}
          >
            <View style={styles.heroMetaRow}>
                <View
                  style={[
                    styles.heroMetaChip,
                    {
                      backgroundColor: withAlpha(colors.surfaceAlt, 0.8),
                      borderColor: withAlpha(colors.border, 0.8),
                    },
                  ]}
                >
                  <Icon name="users" size={12} color={textMuted} />
                  <Text style={[styles.heroMetaText, { color: textPrimary }]}>
                    Total: {totalCount}
                  </Text>
                </View>
                <View
                  style={[
                    styles.heroMetaChip,
                    {
                      backgroundColor: withAlpha(colors.surfaceAlt, 0.8),
                      borderColor: withAlpha(colors.border, 0.8),
                    },
                  ]}
                >
                  <Icon name="filter" size={12} color={textMuted} />
                  <Text style={[styles.heroMetaText, { color: textPrimary }]}>
                    Showing: {showingCount}
                  </Text>
                </View>
            </View>
          </PageHeaderCard>

          {/* Search bar */}
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchInner,
                {
                  backgroundColor: inputBg,
                  borderColor: inputBorder,
                },
              ]}
            >
              <Icon
                name="search"
                size={16}
                color={iconMuted}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={[styles.searchInput, { color: textPrimary }]}
                placeholder="Search by name or phone"
                placeholderTextColor={placeholder}
                value={q}
                onChangeText={setQ}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {q.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQ("")}
                  accessibilityLabel="Clear search"
                  style={[styles.clearBtn, { backgroundColor: clearBg }]}
                >
                  <Text
                    style={[
                      styles.clearBtnText,
                      { color: textPrimary, opacity: 0.9 },
                    ]}
                  >
                    ×
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* List */}
          {filtered.length === 0 ? (
            <View
              style={[
                styles.emptyWrap,
                {
                  backgroundColor: emptyBg,
                  borderColor,
                },
              ]}
            >
              <Icon
                name="user-x"
                size={26}
                color={iconMuted}
                style={{ marginBottom: 8 }}
              />
              <Text style={[styles.emptyTitle, { color: textPrimary }]}>
                {q ? "No matches found" : "No employees found"}
              </Text>
              <Text style={[styles.emptySubtitle, { color: textMuted }]}>
                {q
                  ? "Try a different name or number."
                  : "Add employees in the web app."}
              </Text>
            </View>
          ) : (
            filtered.map((emp) => {
              const initials = (emp.name || "")
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);

              const phone = emp.mobile || "";
              const hasPhone = Boolean(toIntlNoPlusUK(phone));

              return (
                <View
                  key={emp.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: cardBg,
                      borderColor,
                    },
                  ]}
                >
                  {/* Left avatar */}
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: avatarBg,
                        borderColor: avatarBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.avatarText, { color: textPrimary }]}>
                      {initials || "—"}
                    </Text>
                  </View>

                  {/* Middle content */}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: textPrimary }]}>
                      {emp.name || "No Name"}
                    </Text>

                    <View style={styles.infoRow}>
                      <Icon
                        name="phone"
                        size={14}
                        color={hasPhone ? iconMuted : textMuted}
                        style={{ marginRight: 6 }}
                      />
                      <TouchableOpacity
                        onPress={() => hasPhone && callNumber(phone)}
                        activeOpacity={hasPhone ? 0.7 : 1}
                      >
                        <Text
                          style={[
                            styles.meta,
                            {
                              color: hasPhone ? metaText : textMuted,
                              textDecorationLine: hasPhone
                                ? "underline"
                                : "none",
                            },
                          ]}
                        >
                          {phone || "No number"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Actions */}
                  <View style={styles.actionsCol}>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor: hasPhone ? msgColor : disabledBg,
                        },
                      ]}
                      onPress={() => hasPhone && messageWhatsApp(phone, emp.name)}
                      disabled={!hasPhone}
                    >
                      <Icon
                        name="message-circle"
                        size={14}
                        color="#000"
                        style={{ marginRight: 6 }}
                      />
                      <Text style={[styles.btnText, { color: "#000" }]}>Message</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor: hasPhone ? callColor : disabledBg,
                        },
                      ]}
                      onPress={() => hasPhone && callNumber(phone)}
                      disabled={!hasPhone}
                    >
                      <Icon
                        name="phone-call"
                        size={14}
                        color="#fff"
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.btnText}>Call</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={{ height: 18 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 🔹 No colours here – layout only
  container: { flex: 1 },
  content: {
    paddingHorizontal: t.spacing.md,
    paddingTop: 10,
    paddingBottom: t.spacing.lg,
  },

  /* Hero */
  heroCard: {
    position: "relative",
    borderRadius: t.radius.xl,
    marginBottom: t.spacing.lg,
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 0,
    paddingVertical: t.spacing.md,
  },
  heroEyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },
  heroTitle: {
    ...t.typography.pageTitle,
    marginTop: 3,
    letterSpacing: 0.4,
  },
  heroSubTitle: {
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
    fontWeight: "600",
  },
  heroMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroMetaText: {
    fontSize: 11,
    fontWeight: "700",
  },

  /* Search */
  searchRow: { marginBottom: 12 },
  searchInner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: t.controls.buttonHeight,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  clearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: {
    fontSize: 16,
    fontWeight: "800",
  },

  /* Empty state */
  emptyWrap: {
    marginTop: 30,
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: "center",
  },

  /* Contact card */
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    minHeight: 68,
    paddingVertical: 12,
    paddingHorizontal: t.controls.cardPadding,
    marginBottom: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  avatarText: {
    fontWeight: "800",
    fontSize: 16,
  },

  name: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  meta: {
    fontSize: 13,
  },

  /* Actions */
  actionsCol: {
    marginLeft: 10,
    gap: 6,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: t.controls.buttonHeight,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    minWidth: 96,
  },
  btnText: { color: "#ffffff", fontWeight: "800", fontSize: 13 },
});
