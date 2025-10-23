// app/help-centre.js
"use client";

import { useRouter } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/Feather";

export default function HelpCentrePage() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 50 }}>
        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Icon name="arrow-left" size={20} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text style={styles.title}>Help Centre</Text>

        {/* Quick FAQs */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>FAQs</Text>
          <Text style={styles.text}>❓ How do I submit my timesheet?</Text>
          <Text style={styles.answer}>
            Go to the Timesheets section, select your week, fill in the details, and tap "Submit".
          </Text>

          <Text style={styles.text}>❓ How can I request holiday?</Text>
          <Text style={styles.answer}>
            Open the Holidays page, select your dates, and submit a request for approval.
          </Text>

          <Text style={styles.text}>❓ What if a vehicle is already booked?</Text>
          <Text style={styles.answer}>
            The app prevents double booking. Select another vehicle or speak with the office for support.
          </Text>
        </View>

        {/* Guides */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Guides</Text>
          <Text style={styles.text}>📅 Bookings: View jobs, crew assignments, and add notes for each day.</Text>
          <Text style={styles.text}>🚗 Vehicles: Track MOT, service dates, and availability.</Text>
          <Text style={styles.text}>👤 Employees: Access contact details and HR tools.</Text>
        </View>

        {/* Contact Support */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Need More Help?</Text>
          <Text style={styles.text}>📧 info@bickers.co.uk</Text>
          <Text style={styles.text}>📞 +44 (0)1449 761300</Text>
          <Text style={styles.text}>🕐 Mon–Fri, 8:00 – 17:00</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  backText: { color: "#fff", fontSize: 15, marginLeft: 6 },
  title: { fontSize: 20, fontWeight: "bold", color: "#fff", marginBottom: 12 },
  card: {
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#22c55e", marginBottom: 6 },
  text: { fontSize: 14, color: "#ccc", lineHeight: 20, marginBottom: 6 },
  answer: { fontSize: 13, color: "#aaa", marginBottom: 10, paddingLeft: 8 },
});
