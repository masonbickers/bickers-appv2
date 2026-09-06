import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import PageShell from "../../components/layout/PageShell";
import {
  AppButton,
  AppText,
  IconBadge,
  ListRow,
  PageSection,
  SectionCard,
} from "../../components/ui/AppPrimitives";
import { db } from "../../firebaseConfig";
import { designTokens as t } from "../../lib/design/tokens";
import { useAuth } from "../../providers/AuthProvider";

const DEFAULT_FAQS = [
  { q: "How do I submit my timesheet?", a: 'Go to the Timesheets section, select your week, fill in the details, and tap "Submit".' },
  { q: "How can I request holiday?", a: "Open the Holidays page, pick your dates, and submit." },
  { q: "What if a vehicle is already booked?", a: "The app prevents double-booking. Pick another vehicle or contact the office." },
];

export default function HelpCentrePage() {
  const router = useRouter();
  const { isAuthed, loading } = useAuth();
  const [busy, setBusy] = useState(true);
  const [support, setSupport] = useState({
    email: "info@bickers.co.uk",
    phone: "+44 (0)1449 761300",
    hours: "Mon–Fri, 8:00 – 17:00",
  });
  const [faqs, setFaqs] = useState(DEFAULT_FAQS);

  const appVersion = useMemo(() => Constants?.expoConfig?.version || Constants?.manifest2?.extra?.expoClient?.version || "—", []);

  const loadContent = useCallback(async () => {
    try {
      const companySnap = await getDoc(doc(db, "settings", "company")).catch(() => null);
      if (companySnap?.exists()) {
        const company = companySnap.data() || {};
        setSupport((previous) => ({
          email: company.supportEmail || company.email || previous.email,
          phone: company.supportPhone || company.phone || previous.phone,
          hours: company.supportHours || previous.hours,
        }));
      }
      const helpSnap = await getDoc(doc(db, "settings", "helpCentre")).catch(() => null);
      if (helpSnap?.exists()) {
        const nextFaqs = helpSnap.data()?.faqs;
        if (Array.isArray(nextFaqs) && nextFaqs.length) setFaqs(nextFaqs.filter((item) => item?.q && item?.a));
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!isAuthed) setBusy(false);
    else void loadContent();
  }, [isAuthed, loadContent, loading]);

  if (!loading && !isAuthed) return null;

  const mail = () => Linking.openURL(`mailto:${support.email}`).catch(() => {});
  const call = () => Linking.openURL(`tel:${support.phone.replace(/[^\d+]/g, "")}`).catch(() => {});
  const quickLinks = [
    { icon: "clock", label: "Timesheets", route: "/timesheet" },
    { icon: "briefcase", label: "Holidays", route: "/holidaypage" },
    { icon: "calendar", label: "Schedule", route: "/screens/schedule" },
  ];

  return (
    <PageShell
      header={{ variant: "compact", title: "Help Centre", subtitle: `App version ${appVersion}`, onBack: router.back }}
      state={{ resources: [{ isInitialLoading: loading || busy }], hasContent: !(loading || busy), loadingLabel: "Loading help…" }}
    >
      <View style={styles.quickLinks}>
        {quickLinks.map((item) => (
          <SectionCard key={item.label} onPress={() => router.push(item.route)} layoutStyle={styles.quickAction}>
            <IconBadge icon={item.icon} label={item.label} />
            <AppText variant="bodyStrong">{item.label}</AppText>
          </SectionCard>
        ))}
      </View>

      <PageSection title="Frequently asked questions">
        <View style={styles.sectionList}>
          {faqs.map((faq, index) => (
            <ListRow key={`${faq.q}-${index}`} leadingIcon="help-circle" title={faq.q} subtitle={faq.a} divider={index < faqs.length - 1} />
          ))}
        </View>
      </PageSection>

      <PageSection title="Guides">
        <View style={styles.sectionList}>
          <ListRow leadingIcon="calendar" title="Bookings" subtitle="View jobs, crew assignments and per-day notes." divider />
          <ListRow leadingIcon="truck" title="Vehicles" subtitle="Track MOT, service, insurance and availability." divider />
          <ListRow leadingIcon="users" title="Employees" subtitle="Contacts, HR tools and timesheets." />
        </View>
      </PageSection>

      <PageSection title="Need more help?">
        <View style={styles.sectionList}>
          <ListRow leadingIcon="mail" title={support.email} onPress={mail} divider />
          <ListRow leadingIcon="phone" title={support.phone} onPress={call} divider />
          <ListRow leadingIcon="clock" title="Office hours" subtitle={support.hours} />
        </View>
        <View style={styles.actions}>
          <AppButton label="Email support" variant="secondary" icon="mail" onPress={mail} layoutStyle={styles.action} />
          <AppButton label="Call office" icon="phone" onPress={call} layoutStyle={styles.action} />
        </View>
      </PageSection>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  quickLinks: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm },
  quickAction: { flexGrow: 1, minWidth: 104, alignItems: "center", gap: t.spacing.xs },
  sectionList: { gap: t.spacing.xxs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.xs, marginTop: t.spacing.md },
  action: { flexGrow: 1 },
});
