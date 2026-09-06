"use client";

import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import PageShell from "../../components/layout/PageShell";
import { AppText, ListRow, PageSection } from "../../components/ui/AppPrimitives";
import { designTokens as t } from "../../lib/design/tokens";

export default function AboutPage() {
  const router = useRouter();

  return (
    <PageShell
      header={{
        variant: "compact",
        eyebrow: "Bickers Action",
        title: "About",
        subtitle: "Film vehicle and tracking support",
        onBack: router.back,
      }}
    >
      <PageSection title="Bickers Action">
        <AppText tone="secondary">
          Bickers Action is a leading name in film vehicles and tracking services, providing world-class support to productions of all sizes. From precision driving and stunt tracking to specialist vehicle rigs and crew logistics, our team ensures everything runs safely and seamlessly on set.
        </AppText>
      </PageSection>

      <PageSection title="Our mission">
        <AppText tone="secondary">
          We combine decades of industry experience with cutting-edge equipment to deliver reliable, safe, and innovative solutions for film, television, and live productions.
        </AppText>
      </PageSection>

      <PageSection title="This app">
        <AppText tone="secondary">
          The Bickers Action App streamlines daily operations including bookings, vehicle maintenance, holidays and timesheets. It keeps everything in one place so crew and management stay connected and organised.
        </AppText>
      </PageSection>

      <PageSection title="Contact us">
        <View style={styles.contactList}>
          <ListRow leadingIcon="map-pin" title="Ivy Farm Works" subtitle="Ipswich, Suffolk, United Kingdom" divider />
          <ListRow leadingIcon="mail" title="info@bickers.co.uk" divider />
          <ListRow leadingIcon="globe" title="www.bickers.co.uk" divider />
          <ListRow leadingIcon="phone" title="01449 761300" />
        </View>
      </PageSection>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  contactList: { gap: t.spacing.xxs },
});
