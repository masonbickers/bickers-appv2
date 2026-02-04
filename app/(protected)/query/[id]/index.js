// app/(protected)/timesheet-query/[id]/index.js
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function dateToISO(d) {
  return d.toISOString().slice(0, 10);
}
function getDayName(dateStr) {
  const i = new Date(dateStr).getDay();
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][i];
}
const fmt = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      })
    : "—";


export default function TimesheetQuery() {
  const { id } = useLocalSearchParams(); // query doc ID
  const router = useRouter();
  const { employee } = useAuth();
  const { colors } = useTheme();

  const [queryData, setQueryData] = useState(null);
  const [timesheetEntry, setTimesheetEntry] = useState(null);
  const [jobsByDay, setJobsByDay] = useState({});
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const [messageText, setMessageText] = useState("");

  /* -----------------------------------------------------------
      LOAD QUERY + MATCH DAY + JOBS
  ----------------------------------------------------------- */
  useEffect(() => {
    if (!id || !employee) return;

    (async () => {
      try {
        // 1) Load query
        const qRef = doc(db, "timesheetQueries", id);
        const qSnap = await getDoc(qRef);
        if (!qSnap.exists()) {
          setLoading(false);
          return;
        }
        const qData = { id, ...qSnap.data() };
        setQueryData(qData);

        const weekStart = qData.weekStart;
        const employeeCode = qData.employeeCode;
        const dayName = qData.day;

        // 2) Load timesheet entry
        const tsRef = doc(db, "timesheets", `${employeeCode}_${weekStart}`);
        const tsSnap = await getDoc(tsRef);

        if (tsSnap.exists()) {
          const ts = tsSnap.data();
          setTimesheetEntry(ts.days?.[dayName] || null);
        }

        // 3) Build week dates
        const start = new Date(`${weekStart}T00:00:00`);
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          weekDates.push(dateToISO(d));
        }

        // 4) Load employees
        const empSnap = await getDocs(collection(db, "employees"));
        const allEmps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const nameToCode = {};
        allEmps.forEach((e) => {
          const nm = String(e.name || e.fullName || "")
            .trim()
            .toLowerCase();
          if (nm && e.userCode) nameToCode[nm] = e.userCode;
        });

        // 5) Load bookings
        const jobsQ = query(
          collection(db, "bookings"),
          where("bookingDates", "array-contains-any", weekDates)
        );
        const jobSnap = await getDocs(jobsQ);
        const allJobs = jobSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const jobsMap = {};
        DAYS.forEach((d) => (jobsMap[d] = []));

        const deriveCodes = (list = []) =>
          list
            .map((emp) => {
              if (emp?.userCode) return emp.userCode;
              const nm = String(emp?.name || "")
                .trim()
                .toLowerCase();
              return nameToCode[nm] || null;
            })
            .filter(Boolean);

        // 6) Match jobs
        allJobs.forEach((job) => {
          const bookingDates = Array.isArray(job.bookingDates)
            ? job.bookingDates
            : [];
          const employeesByDate = job.employeesByDate || {};

          const globalCodes = deriveCodes(job.employees || []);

          bookingDates.forEach((iso) => {
            if (!weekDates.includes(iso)) return;

            let isAssigned = false;

            if (Object.keys(employeesByDate).length > 0) {
              const list = Array.isArray(employeesByDate[iso])
                ? employeesByDate[iso]
                : [];
              const codes = deriveCodes(list);
              isAssigned = codes.includes(employeeCode);
            } else {
              isAssigned = globalCodes.includes(employeeCode);
            }

            if (!isAssigned) return;

            const dName = getDayName(iso);
            jobsMap[dName].push(job);
          });
        });

        setJobsByDay(jobsMap);
      } catch (err) {
        console.error("Query page load error", err);
      }

      setLoading(false);
    })();
  }, [id, employee]);


  /* -----------------------------------------------------------
      CHAT LISTENER
  ----------------------------------------------------------- */
  useEffect(() => {
    if (!id) return;

    const msgRef = collection(db, "timesheetQueries", id, "messages");

    const unsub = onSnapshot(msgRef, (snap) => {
      const msgs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

      setMessages(msgs);
    });

    return () => unsub();
  }, [id]);


  /* -----------------------------------------------------------
      SEND MESSAGE
  ----------------------------------------------------------- */
  async function sendMessage() {
    if (!messageText.trim()) return;
    try {
      await addDoc(collection(db, "timesheetQueries", id, "messages"), {
        text: messageText.trim(),
        sender: "employee",
        createdAt: serverTimestamp(),
      });
      setMessageText("");
    } catch (err) {
      console.error("Send message error:", err);
    }
  }


  /* -----------------------------------------------------------
      LOADING UI
  ----------------------------------------------------------- */
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!queryData) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: colors.text }}>Query not found</Text>
      </SafeAreaView>
    );
  }

  const dayName = queryData.day;
  const jobList = jobsByDay[dayName] || [];

  /* -----------------------------------------------------------
      UI RENDER
  ----------------------------------------------------------- */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behaviour={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          
          {/* Back */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}
          >
            <Icon name="chevron-left" size={20} color={colors.text} />
            <Text style={{ color: colors.text, marginLeft: 8 }}>Back</Text>
          </TouchableOpacity>

          {/* Header */}
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: 18 }}>
            Timesheet Query
          </Text>

          {/* ---------------- JOB INFO ---------------- */}
          <Text style={{ fontWeight: "700", fontSize: 15, color: colors.textMuted }}>
            Job Info — {dayName}
          </Text>

          <View
            style={{
              marginTop: 10,
              marginBottom: 20,
              padding: 15,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            }}
          >
            {jobList.length === 0 ? (
              <Text style={{ color: colors.textMuted }}>No job for this day.</Text>
            ) : (
              jobList.map((job) => (
                <View
                  key={job.id}
                  style={{
                    paddingBottom: 10,
                    marginBottom: 10,
                    borderBottomWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.success, fontWeight: "700", fontSize: 15 }}>
                    {job.jobNumber || job.id} • {job.client || "Client"}
                  </Text>
                  <Text style={{ color: colors.textMuted, marginTop: 2 }}>
                    {job.location}
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* ---------------- DAY ENTRY ---------------- */}
          <Text
            style={{
              fontWeight: "700",
              fontSize: 15,
              color: colors.textMuted,
              marginBottom: 6,
            }}
          >
            Day Entry
          </Text>

          <View
            style={{
              padding: 15,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              marginBottom: 20,
            }}
          >
            {timesheetEntry ? (
              Object.entries(timesheetEntry).map(([key, val]) =>
                val ? (
                  <View key={key} style={{ marginBottom: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>{key}</Text>
                    <Text style={{ color: colors.text, fontSize: 15 }}>{String(val)}</Text>
                  </View>
                ) : null
              )
            ) : (
              <Text style={{ color: colors.textMuted }}>No entry recorded for this day.</Text>
            )}
          </View>

          {/* ---------------- QUERY CARD ---------------- */}
          <View
            style={{
              backgroundColor: colors.surfaceAlt,
              borderRadius: 12,
              borderColor: colors.border,
              borderWidth: 1,
              padding: 15,
              marginBottom: 30,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Field Queried</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 10 }}>
              {queryData.field}
            </Text>

            <Text style={{ color: colors.textMuted, fontWeight: "700" }}>Manager Note:</Text>
            <Text
              style={{
                color: colors.textMuted,
                fontStyle: "italic",
                marginTop: 4,
                marginBottom: 10,
              }}
            >
              “{queryData.note || "No note provided"}”
            </Text>

            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 10 }}>
              Created: {fmt(queryData.createdAt)}
            </Text>

            <TouchableOpacity
              onPress={() =>
                router.push(`/(protected)/week/${queryData.weekStart}?day=${queryData.day}`)
              }
              style={{
                borderRadius: 8,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 5,
              }}
            >
              <Icon name="edit-2" size={16} color={colors.text} />
              <Text
                style={{ marginLeft: 8, color: colors.text, fontWeight: "600", fontSize: 14 }}
              >
                Open Timesheet
              </Text>
            </TouchableOpacity>
          </View>

          {/* ---------------- CHAT THREAD ---------------- */}
          <Text style={{ fontWeight: "700", fontSize: 16, color: colors.text, marginBottom: 10 }}>
            Messages
          </Text>

          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: 15,
              borderColor: colors.border,
              borderWidth: 1,
              marginBottom: 20,
            }}
          >
            {messages.length === 0 ? (
              <Text style={{ color: colors.textMuted }}>No messages yet.</Text>
            ) : (
              messages.map((msg) => (
                <View
                  key={msg.id}
                  style={{
                    marginBottom: 14,
                    padding: 10,
                    borderRadius: 12,
                    alignSelf: msg.sender === "employee" ? "flex-end" : "flex-start",
                    backgroundColor:
                      msg.sender === "employee" ? colors.accentSoft : colors.surfaceAlt,
                    maxWidth: "80%",
                  }}
                >
                  <Text style={{ color: colors.text }}>{msg.text}</Text>
                  <Text
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      marginTop: 4,
                      textAlign: "right",
                    }}
                  >
                    {msg.createdAt ? fmt(msg.createdAt.toDate()) : ""}
                  </Text>
                </View>
              ))
            )}
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* ---------------- MESSAGE COMPOSER ---------------- */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 12,
            borderTopWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <TextInput
            placeholder="Write a message…"
            placeholderTextColor={colors.textMuted}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 20,
              backgroundColor: colors.surfaceAlt,
              color: colors.text,
            }}
            value={messageText}
            onChangeText={setMessageText}
          />

          <TouchableOpacity
            onPress={sendMessage}
            style={{ marginLeft: 12, padding: 8 }}
          >
            <Icon name="send" size={20} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
