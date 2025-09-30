import { useRouter } from "expo-router";
import { collection, deleteDoc, doc, getDocs, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import Footer from "./components/footer";
import { auth, db } from "./firebaseConfig";


// --- Helpers ---
const eachDateInclusive = (start, end) => {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const out = [];
  for (let d = s; d <= e; d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
};

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const countWeekdaysInclusive = (start, end) =>
  eachDateInclusive(start, end).filter((d) => !isWeekend(d)).length;

const toDate = (v) => {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  return new Date(v);
};

export default function HolidayPage() {
  const router = useRouter();
  const user = auth.currentUser;
  const employee = global.employee;
  const [employeeData, setEmployeeData] = useState(null);
  const [holidays, setHolidays] = useState([]);

useEffect(() => {
  let unsubscribe = null;

  const fetchData = async () => {
    const empSnap = await getDocs(collection(db, "employees"));
    const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let empRecord = null;
    if (employee) {
      empRecord = employees.find((e) => e.userCode === employee.userCode);
    } else if (user) {
      empRecord = employees.find((e) => e.email === user.email);
    }
    if (!empRecord) return;
    setEmployeeData(empRecord);

    // ✅ Real-time subscription
    const holRef = collection(db, "holidays");
    unsubscribe = onSnapshot(holRef, (snapshot) => {
      const allHolidays = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const myHolidays = allHolidays.filter(
        (h) => h.employee === empRecord.name || h.employeeCode === empRecord.userCode
      );
      setHolidays(myHolidays);
    });
  };

  fetchData();

  // ✅ Cleanup listener when component unmounts
  return () => {
    if (unsubscribe) unsubscribe();
  };
}, []);


const cancelHoliday = async (id) => {
  try {
    console.log("Cancelling holiday with ID:", id);
await deleteDoc(doc(db, "holidays", id));
alert("Holiday request cancelled");
// ❌ no need to call fetchData, listener updates automatically

  } catch (err) {
    console.error("Error cancelling holiday:", err.message, err);
    alert("Failed to cancel holiday: " + err.message);
  }
};



  // ✅ Summary calculation
  const calc = () => {
    let paid = 0,
      unpaid = 0,
      accruedTaken = 0,
      accruedEarned = 0;

holidays.forEach((h) => {
  const status = (h.status || "").toLowerCase();

  // 🚫 only process if approved (ignore requested/declined/empty)
  if (status !== "approved") return;

  const start = toDate(h.startDate);
  const end = toDate(h.endDate);
  if (!start || !end) return;

let days = countWeekdaysInclusive(start, end);
if (h.halfDay) days = 0.5; // 👈 handle half-day

  const isAccrued =
    h.isAccrued === true ||
    ["leaveType", "paidStatus", "holidayReason"]
      .map((k) => (h[k] || "").toLowerCase())
      .some((t) => t.includes("accrued") || t.includes("toil"));

  const isUnpaid =
    !isAccrued &&
    (h.isUnpaid === true ||
      h.unpaid === true ||
      h.paid === false ||
      ["leaveType", "paidStatus", "holidayReason"]
        .map((k) => (h[k] || "").toLowerCase())
        .some((t) => t.includes("unpaid")));

  const isPaid = !isUnpaid && !isAccrued;

  if (isPaid) {
    paid += days;
  } else if (isUnpaid) {
    unpaid += days;
  } else if (isAccrued) {
    accruedTaken += days;
  }
});


    const allowance = Number(employeeData?.holidayAllowance || 0);
    const carryOver = Number(employeeData?.carriedOverDays || 0);
    const totalAllowance = allowance + carryOver;

    const accruedBalance = accruedEarned - accruedTaken;
    const allowanceBalance = totalAllowance - paid;

    return {
      paid,
      unpaid,
      accruedEarned,
      accruedTaken,
      accruedBalance,
      allowance,
      carryOver,
      totalAllowance,
      allowanceBalance,
    };
  };

  const {
    paid,
    unpaid,
    accruedEarned,
    accruedTaken,
    accruedBalance,
    allowance,
    carryOver,
    totalAllowance,
    allowanceBalance,
  } = calc();

  // Split holidays into requested vs confirmed
  const requestedHolidays = holidays.filter((h) => !h.status || h.status === "requested");
  const confirmedHolidays = holidays.filter((h) => h.status === "approved");

  return (
    <SafeAreaView style={styles.container}>
      {/* 🔙 Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Icon name="arrow-left" size={22} color="#fff" />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <ScrollView style={{ flex: 1, padding: 12 }}>
        {employeeData && (
          <>
            {/* Yellow Header */}
            <View style={styles.header}>
              <Text style={styles.headerName}>{employeeData.name}</Text>
              <View style={styles.headerRow}>
                <Text style={styles.headerText}>Allowance: {allowance}</Text>
                <Text style={styles.headerText}>Carry Over: {carryOver}</Text>
                <Text style={styles.headerText}>Total: {totalAllowance}</Text>
                <Text
                  style={[
                    styles.headerText,
                    { fontWeight: "bold", color: allowanceBalance < 0 ? "red" : "green" },
                  ]}
                >
                  Left: {allowanceBalance}
                </Text>
              </View>
            </View>

            {/* Stat Row */}
            <View style={styles.statRow}>
              <Stat label="Paid Used" value={`${paid}/${totalAllowance}`} color="#2563eb" />
              <Stat label="Unpaid" value={unpaid} color="#dc2626" />
              <Stat label="Accrued Earned" value={accruedEarned} color="#0d9488" />
              <Stat label="Accrued Taken" value={accruedTaken} color="#92400e" />
              <Stat label="Accrued Balance" value={accruedBalance} color="#16a34a" />
              <Stat
                label="Allowance Balance"
                value={allowanceBalance}
                color={allowanceBalance < 0 ? "#dc2626" : "#16a34a"}
              />
            </View>

            <TouchableOpacity
              style={styles.requestButton}
              onPress={() => router.push("/holiday-request")}
            >
              <Text style={styles.requestButtonText}>➕ Request Holiday</Text>
            </TouchableOpacity>

            {/* Requested Holidays Table */}
            <Text style={{ color: "#fff", fontSize: 16, marginVertical: 8 }}>
              Requested Holidays
            </Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.th}>Date From</Text>
                <Text style={styles.th}>Date To</Text>
                <Text style={styles.th}>Days</Text>
                <Text style={styles.th}>Type</Text>
                <Text style={styles.th}>Notes</Text>
                <Text style={styles.th}>Status</Text>
              </View>

              {requestedHolidays.length === 0 ? (
                <Text style={{ color: "#aaa", padding: 10 }}>No requested holidays.</Text>
              ) : (
                requestedHolidays
                  .slice()
                  .sort((a, b) => toDate(a.startDate) - toDate(b.startDate))
                  .map((h) => {
                    const start = toDate(h.startDate);
                    const end = toDate(h.endDate);
                      let days = start && end ? countWeekdaysInclusive(start, end) : 0;
                      if (h.halfDay) days = 0.5;

                    return (
<View key={h.id} style={styles.tableRowContainer}>
  {/* Holiday row */}
  <View style={styles.tableRow}>
    <Text style={styles.td}>{start?.toDateString()}</Text>
    <Text style={styles.td}>{end?.toDateString()}</Text>
    <Text style={styles.td}>{days}</Text>
{(() => {
  let displayType = "Other";
  let typeColor = "#0d9488";

  const typeStr = (h.leaveType || h.paidStatus || "").toLowerCase();

  if (h.isAccrued || typeStr.includes("accrued") || typeStr.includes("toil")) {
    displayType = "Accrued";
    typeColor = "#0ea5e9";
  } else if (h.isUnpaid || typeStr.includes("unpaid")) {
    displayType = "Unpaid";
    typeColor = "#ef4444";
  } else if (h.paid || typeStr.includes("paid")) {
    displayType = "Paid";
    typeColor = "#22c55e";
  }

  return (
    <Text style={[styles.td, { color: typeColor, fontWeight: "bold" }]}>
      {displayType}
    </Text>
  );
})()}

    <Text style={styles.td}>{h.notes || "-"}</Text>
    <Text style={[styles.td, { color: "#facc15", fontWeight: "bold" }]}>
      Requested
    </Text>
  </View>

  {/* Cancel button row */}
  <View style={styles.cancelRow}>
    <TouchableOpacity
      style={styles.cancelButton}
      onPress={() => cancelHoliday(h.id)}
    >
      <Text style={styles.cancelButtonText}>Cancel Request</Text>
    </TouchableOpacity>
  </View>
</View>

                    );
                  })
              )}
            </View>

            {/* Confirmed Holidays Table with Balance */}
            <Text style={{ color: "#fff", fontSize: 16, marginVertical: 8 }}>
              Confirmed Holidays
            </Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.th}>Date From</Text>
                <Text style={styles.th}>Date To</Text>
                <Text style={styles.th}>Days</Text>
                <Text style={styles.th}>Type</Text>
                <Text style={styles.th}>Notes</Text>
                <Text style={styles.th}>Balance</Text>
              </View>

              {confirmedHolidays.length === 0 ? (
                <Text style={{ color: "#aaa", padding: 10 }}>No confirmed holidays.</Text>
              ) : (
                (() => {
                  let runningBalance = totalAllowance;
return confirmedHolidays
  .slice()
  .sort((a, b) => toDate(a.startDate) - toDate(b.startDate))
  .map((h) => {
    if (h.status === "declined") return null; // 🚫 skip declined

    const start = toDate(h.startDate);
    const end = toDate(h.endDate);
let days = start && end ? countWeekdaysInclusive(start, end) : 0;
if (h.halfDay) days = 0.5;

    let displayType = "Other";
    let typeColor = "#0d9488";

    const typeStr = (h.leaveType || h.paidStatus || "").toLowerCase();

    if (h.isAccrued || typeStr.includes("accrued") || typeStr.includes("toil")) {
      displayType = "Accrued";
      typeColor = "#0ea5e9";
    } else if (h.isUnpaid || typeStr.includes("unpaid")) {
      displayType = "Unpaid";
      typeColor = "#ef4444";
    } else if (h.paid || typeStr.includes("paid")) {
      displayType = "Paid";
      typeColor = "#22c55e";
      runningBalance -= days;
    }

    return (
      <View key={h.id} style={styles.tableRow}>
        <Text style={styles.td}>{start?.toDateString()}</Text>
        <Text style={styles.td}>{end?.toDateString()}</Text>
        <Text style={styles.td}>{days}</Text>
        <Text style={[styles.td, { color: typeColor, fontWeight: "bold" }]}>{displayType}</Text>
        <Text style={styles.td}>{h.notes || "-"}</Text>
        <Text style={styles.td}>{runningBalance}</Text>
      </View>
    );
  });

                })()
              )}
            </View>
          </>
        )}
      </ScrollView>
      <Footer />
    </SafeAreaView>
  );
}

function Stat({ label, value, color }) {
  return (
    <View style={[styles.statBox, { borderColor: color }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  backText: { color: "#fff", fontSize: 16, marginLeft: 6 },

  header: {
    backgroundColor: "#fde68a",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  headerName: { fontSize: 18, fontWeight: "bold", color: "#000", marginBottom: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  headerText: { fontSize: 14, color: "#000" },

  statRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  statBox: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    margin: 4,
    flex: 1,
    minWidth: "45%",
  },
  statLabel: { color: "#ccc", fontSize: 12 },
  statValue: { fontSize: 16, fontWeight: "bold" },

  table: { marginTop: 10, borderTopWidth: 1, borderColor: "#333" },
  tableHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 6,
    backgroundColor: "#111",
  },
  th: { flex: 1, color: "#fff", fontWeight: "bold", textAlign: "center" },
  td: { flex: 1, color: "#ccc", textAlign: "center", fontSize: 12 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: "#222",
  },

  requestButton: {
    backgroundColor: "#22c55e",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginVertical: 10,
  },
  requestButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "bold",
  },

  tableRowContainer: {
  marginBottom: 8,
  borderBottomWidth: 1,
  borderColor: "#333",
},

cancelRow: {
  flexDirection: "row",
  justifyContent: "flex-end",
  paddingVertical: 4,
  paddingRight: 8,
},

cancelButton: {
  backgroundColor: "#dc2626",
  paddingVertical: 6,
  paddingHorizontal: 12,
  borderRadius: 6,
},

cancelButtonText: {
  color: "#fff",
  fontSize: 13,
  fontWeight: "bold",
},

});
