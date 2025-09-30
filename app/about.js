// app/about.js
"use client";

import { useRouter } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/Feather";

export default function AboutPage() {
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
        <Text style={styles.title}>About</Text>

        {/* Content */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Bickers Action</Text>
          <Text style={styles.text}>
            Bickers Action is a leading name in film vehicles and tracking services, 
            providing world-class support to productions of all sizes. 
            From precision driving and stunt tracking to specialist vehicle rigs 
            and crew logistics, our team ensures everything runs safely and seamlessly on set.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Our Mission</Text>
          <Text style={styles.text}>
            We combine decades of industry experience with cutting-edge equipment 
            to deliver reliable, safe, and innovative solutions for film, television, 
            and live productions. 
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>This App</Text>
          <Text style={styles.text}>
            The Bickers Action App is designed to streamline daily operations — 
            bookings, vehicle maintenance, holidays, timesheets, and more. 
            It keeps everything in one place, making it easier for crew and 
            management to stay connected and organised.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Contact Us</Text>
          <Text style={styles.text}>📍 Ivy Farm Works, Ipswich, Suffolk, United Kingdom</Text>
          <Text style={styles.text}>📧 info@bickers.co.uk</Text>
          <Text style={styles.text}>🌐 www.bickers.co.uk</Text>
             <Text style={styles.text}>📞 01449 761300</Text>
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
  text: { fontSize: 14, color: "#ccc", lineHeight: 20, marginBottom: 4 },
});
