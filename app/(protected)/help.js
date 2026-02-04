// app/(protected)/help.js
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

// 🔑 Firebase + Provider
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

export default function HelpCentrePage() {
  const router = useRouter();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

  const [busy, setBusy] = useState(true);
  const [support, setSupport] = useState({
    email: "info@bickers.co.uk",
    phone: "+44 (0)1449 761300",
    hours: "Mon–Fri, 8:00 – 17:00",
  });
  const [faqs, setFaqs] = useState([
    {
      q: "How do I submit my timesheet?",
      a: 'Go to the Timesheets section, select your week, fill in the details, and tap "Submit".',
    },
    {
      q: "How can I request holiday?",
      a: "Open the Holidays page, pick your dates, and submit.",
    },
    {
      q: "What if a vehicle is already booked?",
      a: "The app prevents double-booking. Pick another vehicle or contact the office.",
    },
  ]);

  const appVersion = useMemo(
    () =>
      Constants?.expoConfig?.version ||
      Constants?.manifest2?.extra?.expoClient?.version ||
      "—",
    []
  );

  const loadContent = useCallback(async () => {
    try {
      const companySnap = await getDoc(doc(db, "settings", "company")).catch(
        () => null
      );
      if (companySnap?.exists()) {
        const c = companySnap.data() || {};
        setSupport((prev) => ({
          email: c.supportEmail || c.email || prev.email,
          phone: c.supportPhone || c.phone || prev.phone,
          hours: c.supportHours || prev.hours,
        }));
      }
      const helpSnap = await getDoc(doc(db, "settings", "helpCentre")).catch(
        () => null
      );
      if (helpSnap?.exists()) {
        const h = helpSnap.data() || {};
        if (Array.isArray(h.faqs) && h.faqs.length) {
          setFaqs(h.faqs.filter((x) => x?.q && x?.a));
        }
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!isAuthed) {
      setBusy(false);
      return;
    }
    loadContent();
  }, [loading, isAuthed, loadContent]);

  const mail = () =>
    Linking.openURL(`mailto:${support.email}`).catch(() => {});
  const call = () =>
    Linking.openURL(`tel:${support.phone.replace(/[^\d+]/g, "")}`).catch(
      () => {}
    );

  if (loading || busy) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>
          Loading help…
        </Text>
      </SafeAreaView>
    );
  }
  if (!isAuthed) return null;

  const initials =
    (employee?.name || "U")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 50 }}>
        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>
            Help Centre
          </Text>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.avatarText, { color: colors.text }]}>
              {initials}
            </Text>
          </View>
        </View>
        <Text style={[styles.metaText, { color: colors.textMuted }]}>
          App version {appVersion}
        </Text>

        {/* Quick links */}
        <View style={styles.quickRow}>
          <QuickBtn
            icon="clock"
            label="Timesheets"
            onPress={() => router.push("/timesheet")}
            colors={colors}
          />
          <QuickBtn
            icon="briefcase"
            label="Holidays"
            onPress={() => router.push("/holidaypage")}
            colors={colors}
          />
          <QuickBtn
            icon="calendar"
            label="Schedule"
            onPress={() => router.push("/screens/schedule")}
            colors={colors}
          />
        </View>

        {/* FAQs */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            FAQs
          </Text>
          {faqs.map((f, i) => (
            <View key={`faq-${i}`} style={styles.faqItem}>
              <Text
                style={[
                  styles.text,
                  { color: colors.text },
                ]}
              >
                ❓ {f.q}
              </Text>
              <Text
                style={[
                  styles.answer,
                  { color: colors.textMuted },
                ]}
              >
                {f.a}
              </Text>
            </View>
          ))}
        </View>

        {/* Guides */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            Guides
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            📅 Bookings: View jobs, crew assignments, and per-day notes.
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            🚗 Vehicles: Track MOT, service, insurance, and availability.
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            👤 Employees: Contacts, HR tools, and timesheets.
          </Text>
        </View>

        {/* Contact Support */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            Need More Help?
          </Text>
          <TouchableOpacity
            style={styles.contactRow}
            onPress={mail}
            activeOpacity={0.85}
          >
            <Icon name="mail" size={16} color={colors.textMuted} />
            <Text
              style={[
                styles.text,
                { color: colors.text },
              ]}
            >
              {support.email}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.contactRow}
            onPress={call}
            activeOpacity={0.85}
          >
            <Icon name="phone" size={16} color={colors.textMuted} />
            <Text
              style={[
                styles.text,
                { color: colors.text },
              ]}
            >
              {support.phone}
            </Text>
          </TouchableOpacity>
          <View style={styles.contactRow}>
            <Icon name="clock" size={16} color={colors.textMuted} />
            <Text
              style={[
                styles.text,
                { color: colors.textMuted },
              ]}
            >
              {support.hours}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                },
              ]}
              onPress={mail}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: colors.text },
                ]}
              >
                Email Support
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: colors.accent, flex: 1 },
              ]}
              onPress={call}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: "#fff" },
                ]}
              >
                Call Office
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickBtn({ icon, label, onPress, colors }) {
  return (
    <TouchableOpacity
      style={[
        styles.quickBtn,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon name={icon} size={18} color={colors.text} />
      <Text
        style={[
          styles.quickText,
          { color: colors.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { fontSize: 15, marginLeft: 6 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#2E2E2E",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  avatarText: { fontWeight: "800" },
  title: { fontSize: 20, fontWeight: "bold" },
  metaText: { fontSize: 12, marginBottom: 10 },
  quickRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  quickText: { fontWeight: "700", fontSize: 12 },
  card: {
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "#1a1a1a",
  },
  sectionTitle: { fontSize: 16, fontWeight: "bold", marginBottom: 8 },
  faqItem: { marginBottom: 10 },
  text: { fontSize: 14, lineHeight: 20 },
  answer: { fontSize: 13, marginTop: 4, paddingLeft: 8 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  actionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontWeight: "800" },
});
