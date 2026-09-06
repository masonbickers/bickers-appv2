import { AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../components/ui/AppPrimitives";
// app/(protected)/contacts.js
import {
  Fragment,
  useMemo,
  useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import PageHeaderCard from "../../components/PageHeaderCard";
import { EmptyState } from "../../components/AsyncState";
import PageShell from "../../components/layout/PageShell";
import { useContacts } from "../../hooks/useOperationalData";
import { designTokens as t } from "../../lib/design/tokens";

import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";

export default function ContactsPage() {
  const { colors, colorScheme } = useTheme();
  const isDark = colorScheme === "dark";

  const [q, setQ] = useState("");
  const contactsResource = useContacts();
  const employees = useMemo(
    () =>
      [...contactsResource.data].sort((a, b) =>
        (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
      ),
    [contactsResource.data]
  );

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
  const countLabel = q.trim()
    ? `${showingCount} of ${totalCount} contacts`
    : `${totalCount} contacts`;

  // 🔹 All colours from theme
  const cardBg = colors.surface;
  const borderColor = colors.border;
  const textPrimary = colors.text;
  const textMuted = colors.textMuted ?? staticColors.hex_7a7a7a_7vh7e8;
  const iconMuted = colors.iconMuted ?? textMuted;
  const avatarBg = colors.avatarBg ?? colors.surface;
  const avatarBorder = colors.avatarBorder ?? colors.border;
  const metaText = colors.metaText ?? textMuted;
  const callColor = colors.accent ?? staticColors.hex_c8102e_6za5cb;
  const msgColor = staticColors.hex_23c063_74ohzl;
  const disabledBg = colors.disabled ?? (isDark ? staticColors.hex_2a2a2a_631aj9 : staticColors.hex_d1d1d6_pnsuhg);

  return (
    <PageShell
      contentSpacing="compact"
      customHeader={
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
                <Text style={[styles.heroMetaText, { color: textPrimary }]}>{countLabel}</Text>
              </View>
          </View>
        </PageHeaderCard>
      }
      customHeaderPlacement="scroll"
      refresh={{
        refreshing: contactsResource.isRefreshing,
        onRefresh: contactsResource.refresh,
      }}
      state={{
        resources: [contactsResource],
        hasContent: employees.length > 0,
        onRetry: contactsResource.refresh,
        loadingLabel: "Loading contacts…",
        empty: {
          when: employees.length === 0,
          icon: "user-x",
          title: "No employees found",
          message: "Add employees in the web app.",
        },
      }}
    >
      <View style={styles.contactsBody}>
          {/* Search bar */}
          <View style={styles.searchRow}>
              <FormField
                label="Search employee contacts"
                hint="Enter an employee name or phone number"
                placeholder="Search by name or phone"
                value={q}
                onChangeText={setQ}
                style={{ flex: 1 }}
                inputProps={{ autoCapitalize: "none", autoCorrect: false, returnKeyType: "search" }}
              />
          </View>

          {/* List */}
          {filtered.length === 0 ? (
              <EmptyState
                icon="user-x"
                title={q ? "No matches found" : "No employees found"}
                message={
                  q
                    ? "Try a different name or number."
                    : "Add employees in the web app."
                }
                compact
              />
            ) : (
              filtered.map((emp, index) => {
              const initials = (emp.name || "")
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);

              const phone = emp.mobile || "";
              const hasPhone = Boolean(toIntlNoPlusUK(phone));
              const role = Array.isArray(emp.jobTitle)
                ? emp.jobTitle.filter(Boolean).join(" · ")
                : String(emp.jobTitle || "").trim();
              const letter = (emp.name || "#").trim().charAt(0).toUpperCase() || "#";
              const previousLetter = index > 0
                ? (filtered[index - 1]?.name || "#").trim().charAt(0).toUpperCase() || "#"
                : null;

              return (
                <Fragment key={emp.id}>
                  {letter !== previousLetter ? (
                    <Text style={[styles.letterHeading, { color: textMuted }]}>{letter}</Text>
                  ) : null}
                  <View
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
                  <View style={styles.contactCopy}>
                    <Text style={[styles.name, { color: textPrimary }]} numberOfLines={1}>
                      {emp.name || "No Name"}
                    </Text>

                    <View style={styles.infoRow}>
                      <Icon
                        name="phone"
                        size={14}
                        color={hasPhone ? iconMuted : textMuted}
                        style={styles.infoIcon}
                      />
                      <Text style={[styles.meta, { color: hasPhone ? metaText : textMuted }]} numberOfLines={1}>
                        {[role, phone || "No number"].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  </View>

                  {/* Actions */}
                  <View style={styles.actionsCol}>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor: hasPhone
                            ? withAlpha(msgColor, 0.14)
                            : disabledBg,
                          borderColor: hasPhone
                            ? withAlpha(msgColor, 0.4)
                            : withAlpha(borderColor, 0.7),
                        },
                      ]}
                      onPress={() => hasPhone && messageWhatsApp(phone, emp.name)}
                      disabled={!hasPhone}
                      accessibilityRole="button"
                      accessibilityLabel={`Message ${emp.name || "employee"} on WhatsApp`}
                      accessibilityState={{ disabled: !hasPhone }}
                    >
                      <Icon
                        name="message-circle"
                        size={18}
                        color={hasPhone ? msgColor : textMuted}
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor: hasPhone
                            ? withAlpha(callColor, 0.14)
                            : disabledBg,
                          borderColor: hasPhone
                            ? withAlpha(callColor, 0.4)
                            : withAlpha(borderColor, 0.7),
                        },
                      ]}
                      onPress={() => hasPhone && callNumber(phone)}
                      disabled={!hasPhone}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${emp.name || "employee"}`}
                      accessibilityState={{ disabled: !hasPhone }}
                    >
                      <Icon
                        name="phone-call"
                        size={18}
                        color={hasPhone ? callColor : textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                  </View>
                </Fragment>
              );
              })
            )}
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  // 🔹 No colours here – layout only
  container: { flex: 1 },
  content: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.xs,
    paddingBottom: 200,
  },

  /* Hero */
  heroCard: {
    position: "relative",
    borderRadius: t.radius.xl,
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: t.spacing.none,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.none,
  },
  heroEyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },
  heroTitle: {
    ...t.typography.pageTitle,
    marginTop: t.spacing.xxs,
    letterSpacing: 0.4,
  },
  heroSubTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    marginTop: t.spacing.xxs,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "600",
  },
  heroMetaRow: {
    marginTop: t.spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  heroMetaText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },

  /* Search */
  contactsBody: { gap: t.spacing.xs },
  searchRow: {},
  searchInner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: t.radius.xl,
    borderWidth: 1,
    paddingHorizontal: t.spacing.sm,
    height: t.controls.buttonHeight,
  },
  searchInput: {
    flex: 1,
    fontSize: t.typography.body.fontSize,
  },
  clearBtn: {
    width: 24,
    height: 24,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },

  /* Empty state */
  emptyWrap: {
    marginTop: t.spacing["2xl"],
    borderRadius: t.radius.xl,
    paddingVertical: t.spacing.lg,
    paddingHorizontal: t.spacing.lg,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    marginBottom: t.spacing.xxs,
  },
  emptySubtitle: {
    fontSize: t.typography.bodySmall.fontSize,
    textAlign: "center",
  },

  /* Contact card */
  letterHeading: {
    marginTop: t.spacing.xs,
    paddingHorizontal: t.spacing.xxs,
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: t.radius.lg,
    minHeight: 76,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.controls.cardPadding,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  avatarText: {
    fontWeight: "800",
    fontSize: t.typography.bodyLarge.fontSize,
  },

  contactCopy: { flex: 1, minWidth: 0 },
  name: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    marginBottom: t.spacing.none,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.xxs,
  },
  infoIcon: { marginRight: t.spacing.xxs },
  meta: {
    flex: 1,
    fontSize: t.typography.bodySmall.fontSize,
  },

  /* Actions */
  actionsCol: {
    marginLeft: t.spacing.xs,
    flexDirection: "row",
    gap: t.spacing.xxs,
  },
  btn: {
    alignItems: "center",
    justifyContent: "center",
    width: t.controls.iconButton,
    height: t.controls.iconButton,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
