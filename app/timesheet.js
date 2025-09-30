import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import { FlatList, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { db } from "./firebaseConfig"; // ✅ adjust path if needed

// Helpers
function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function formatWeekRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${sunday.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
}

export default function TimesheetOverview() {
  const employee = global.employee;
  const [timesheets, setTimesheets] = useState([]);
  const router = useRouter();

  useEffect(() => {
    loadTimesheets();
  }, []);

  const loadTimesheets = async () => {
    if (!employee) return;
    const snap = await getDocs(collection(db, "timesheets"));
    const mySheets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.employeeCode === employee.userCode);
    setTimesheets(mySheets);
  };

  // Past 4 weeks (including current)
  const weekOptions = [...Array(4)].map((_, i) => {
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() - 7 * i);
    return {
      key: monday.toISOString().split("T")[0],
      label: formatWeekRange(monday),
    };
  });

  const renderWeekCard = (weekKey, label, submitted) => (
    <TouchableOpacity
      key={weekKey}
      style={[styles.weekCard, submitted && styles.submittedCard]}
      onPress={() => router.push(`/week/${weekKey}`)}
    >
      <Text style={styles.weekLabel}>{label}</Text>
      <Text style={{ color: submitted ? "#22c55e" : "#f59e0b" }}>
        {submitted ? "Submitted" : "Not filled"}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 🔙 Back + Title */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🕒 Timesheets</Text>
      </View>

      {/* Weeks to fill */}
      <Text style={styles.sectionHeader}>This Month</Text>
      {weekOptions.map((w) => {
        const existing = timesheets.find((t) => t.weekStart === w.key);
        return renderWeekCard(w.key, w.label, !!existing);
      })}

      {/* Submitted list */}
      <Text style={styles.sectionHeader}>📂 Past Submissions</Text>
      {timesheets.length === 0 ? (
        <Text style={styles.emptyText}>No timesheets submitted yet.</Text>
      ) : (
        <FlatList
          data={timesheets.sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart))}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            renderWeekCard(item.weekStart, formatWeekRange(new Date(item.weekStart)), true)
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  backText: { color: "#aaa", fontSize: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#fff" },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    color: "#fff",
  },
  weekCard: {
    backgroundColor: "#1a1a1a",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  submittedCard: { borderLeftWidth: 3, borderLeftColor: "#22c55e" },
  weekLabel: { color: "#ccc", fontSize: 14 },
  emptyText: { color: "#777", fontStyle: "italic", marginTop: 8 },
});
