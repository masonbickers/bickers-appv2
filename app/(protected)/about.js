// app/about.js
"use client";

import { useRouter } from "expo-router";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { useTheme } from "../providers/ThemeProvider";

export default function AboutPage() {
  const router = useRouter();
  const { colors } = useTheme();

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

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>About</Text>

        {/* Content */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            Bickers Action
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            Bickers Action is a leading name in film vehicles and tracking
            services, providing world-class support to productions of all sizes.
            From precision driving and stunt tracking to specialist vehicle rigs
            and crew logistics, our team ensures everything runs safely and
            seamlessly on set.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            Our Mission
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            We combine decades of industry experience with cutting-edge
            equipment to deliver reliable, safe, and innovative solutions for
            film, television, and live productions.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            This App
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            The Bickers Action App is designed to streamline daily operations —{" "}
            bookings, vehicle maintenance, holidays, timesheets, and more. It
            keeps everything in one place, making it easier for crew and
            management to stay connected and organised.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.accent },
            ]}
          >
            Contact Us
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            📍 Ivy Farm Works, Ipswich, Suffolk, United Kingdom
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            📧 info@bickers.co.uk
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            🌐 www.bickers.co.uk
          </Text>
          <Text
            style={[
              styles.text,
              { color: colors.textMuted },
            ]}
          >
            📞 01449 761300
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  backText: { fontSize: 15, marginLeft: 6 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  card: {
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#262626",
  },
  sectionTitle: { fontSize: 16, fontWeight: "bold", marginBottom: 6 },
  text: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
});
