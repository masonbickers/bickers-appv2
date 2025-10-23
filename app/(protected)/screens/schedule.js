import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { db } from '../../../firebaseConfig';

export default function SchedulePage() {
  const router = useRouter();
  const employee = global.employee;

  const [markedDates, setMarkedDates] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayInfo, setDayInfo] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      if (!employee) return;

      const jobsSnap = await getDocs(collection(db, 'bookings'));
      const jobs = jobsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const holSnap = await getDocs(collection(db, 'holidays'));
      const holidays = holSnap.docs.map((doc) => doc.data());

      const marks = {};
      const jobMap = {};
      const holidayDates = [];

      const empSnap = await getDocs(collection(db, 'employees'));
      const allEmployees = empSnap.docs.map((doc) => doc.data());

      // Mark jobs
      jobs.forEach((job) => {
        const codes = (job.employees || [])
          .map((emp) => {
            if (emp.userCode) return emp.userCode;
            const found = allEmployees.find((e) => e.name === emp.name);
            return found ? found.userCode : null;
          })
          .filter(Boolean);

        if (codes.includes(employee.userCode)) {
          (job.bookingDates || []).forEach((date) => {
            marks[date] = {
              ...(marks[date] || {}),
              customStyles: {
                container: { backgroundColor: '#1a3d7c', borderRadius: 8 },
                text: { color: '#fff', fontWeight: 'bold' },
              },
            };
            if (!jobMap[date]) jobMap[date] = [];
            jobMap[date].push(job);
          });
        }
      });

      // Mark holidays
      holidays.forEach((h) => {
        if (h.employee === employee.name) {
          const start = new Date(h.startDate);
          const end = new Date(h.endDate);
          const d = new Date(start);
          while (d <= end) {
            const date = d.toISOString().split('T')[0];
            marks[date] = {
              ...(marks[date] || {}),
              customStyles: {
                container: { backgroundColor: '#166534', borderRadius: 8 },
                text: { color: '#fff', fontWeight: 'bold' },
              },
            };
            holidayDates.push(date);
            d.setDate(d.getDate() + 1);
          }
        }
      });

      // Mark weekends (next 30 days)
      const today = new Date();
      const futureRange = 30;
      for (let i = 0; i < futureRange; i++) {
        const d = new Date();
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const dow = d.getDay();
        if ((dow === 0 || dow === 6) && !marks[dateStr]) {
          marks[dateStr] = {
            customStyles: {
              container: { backgroundColor: '#3b3b3b', borderRadius: 8 },
              text: { color: '#fff', fontWeight: 'bold' },
            },
          };
        }
      }

      setMarkedDates(marks);
      setDayInfo({ jobs: jobMap, holidays: holidayDates });
    };

    loadData();
  }, []);

  const handleDayPress = (day) => setSelectedDay(day.dateString);

  const jumpToToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setSelectedDay(today);
  };

  const clearSelected = () => setSelectedDay(null);

  // Build markedDates with selectedDay highlight for custom marking
  const computedMarked = (() => {
    if (!selectedDay) return markedDates;
    return {
      ...markedDates,
      [selectedDay]: {
        ...(markedDates[selectedDay] || {}),
        customStyles: {
          // selected wins visually but keeps white text
          container: { backgroundColor: '#C8102E', borderRadius: 8 },
          text: { color: '#fff', fontWeight: 'bold' },
        },
      },
    };
  })();

  const renderDayInfo = () => {
    if (!selectedDay || !dayInfo) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Pick a date to see details</Text>
          <Text style={styles.emptySubtitle}>
            Tap any day in the calendar to view jobs, holidays, or status.
          </Text>
        </View>
      );
    }

    const { jobs, holidays } = dayInfo;

    if (jobs[selectedDay]?.length) {
      return (
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Text style={styles.infoTitle}>📋 Jobs on {selectedDay}</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{jobs[selectedDay].length}</Text>
            </View>
          </View>

          {jobs[selectedDay].map((job) => {
            const dayNote =
              job.notesByDate?.[selectedDay] === 'Other'
                ? job.notesByDate?.[`${selectedDay}-other`]
                : job.notesByDate?.[selectedDay];

            return (
              <View key={job.id} style={styles.jobCard}>
                <View style={styles.jobRow}>
                  <Text style={styles.jobTitle}>Job #{job.jobNumber || 'N/A'}</Text>
                  {job.status && <Text style={styles.jobStatus}>{job.status}</Text>}
                </View>

                {job.client && (
                  <Text style={styles.jobItem}>
                    👤 Client: <Text style={styles.jobValue}>{job.client}</Text>
                  </Text>
                )}
                {job.location && (
                  <Text style={styles.jobItem}>
                    📍 Location: <Text style={styles.jobValue}>{job.location}</Text>
                  </Text>
                )}
                {job.vehicles?.length > 0 && (
                  <Text style={styles.jobItem}>
                    🚗 Vehicles:{' '}
                    <Text style={styles.jobValue}>{job.vehicles.join(', ')}</Text>
                  </Text>
                )}
                {job.equipment?.length > 0 && (
                  <Text style={styles.jobItem}>
                    🛠️ Equipment:{' '}
                    <Text style={styles.jobValue}>{job.equipment.join(', ')}</Text>
                  </Text>
                )}
                {job.notes && (
                  <Text style={styles.jobItem}>
                    📝 Notes: <Text style={styles.jobValue}>{job.notes}</Text>
                  </Text>
                )}
                {dayNote && (
                  <Text style={styles.jobItem}>
                    📅 Day Note: <Text style={styles.jobValue}>{dayNote}</Text>
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      );
    }

    if (holidays.includes(selectedDay)) {
      return (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>🌴 On Holiday</Text>
          <Text style={styles.infoSubtitle}>Enjoy your time off!</Text>
        </View>
      );
    }

    const dow = new Date(selectedDay).getDay();
    if (dow === 0 || dow === 6) {
      return (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>⚫ Off (Weekend)</Text>
          <Text style={styles.infoSubtitle}>No bookings assigned.</Text>
        </View>
      );
    }

    return (
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>⚪ Yard Based</Text>
        <Text style={styles.infoSubtitle}>No offsite jobs for this day.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Centered Header */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>Schedule</Text>
          </View>

          {/* Quick actions under title */}
          <View style={styles.quickRow}>
            <TouchableOpacity style={[styles.quickBtn, styles.primaryBtn]} onPress={jumpToToday}>
              <Text style={styles.quickText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.quickBtn, styles.ghostBtn]} onPress={clearSelected}>
              <Text style={styles.quickText}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Calendar card */}
          <View style={styles.calCard}>
            <Calendar
              firstDay={1}
              markingType="custom"
              markedDates={computedMarked}
              onDayPress={handleDayPress}
              theme={{
                backgroundColor: '#0B0B0B',
                calendarBackground: '#0B0B0B',
                dayTextColor: '#EDEDED',
                monthTextColor: '#FFFFFF',
                textDisabledColor: '#5E5E5E',
                arrowColor: '#C8102E',
                todayTextColor: '#C8102E',
                textSectionTitleColor: '#A5A5A5',
              }}
            />
          </View>

          {/* Selected day banner */}
          <View style={styles.dayBanner}>
            <Text style={styles.dayBannerText}>
              {selectedDay
                ? new Date(selectedDay).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'No date selected'}
            </Text>
          </View>

          {/* Details */}
          {renderDayInfo()}

          {/* Legend */}
          <View style={styles.legendRow}>
            <LegendPill color="#1a3d7c" label="On Set" />
            <LegendPill color="#166534" label="Holiday" />
            <LegendPill color="#3b3b3b" label="Off" />
            <LegendPill color="#C0C0C0" label="Yard" textDark />
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* ---------- tiny subcomponent ---------- */
function LegendPill({ color, label, textDark }) {
  return (
    <View style={[styles.pill, { backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color: textDark ? '#111' : '#DDD' }]}>{label}</Text>
    </View>
  );
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },

  // centered header
  headerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.3, textAlign: 'center' },

  // quick actions
  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 8, justifyContent: 'center' },
  quickBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  primaryBtn: { backgroundColor: '#C8102E', borderColor: '#C8102E' },
  ghostBtn: { backgroundColor: '#141414', borderColor: '#232323' },
  quickText: { color: '#fff', fontWeight: '700' },

  // calendar card
  calCard: {
    backgroundColor: '#0B0B0B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    overflow: 'hidden',
    marginTop: 4,
  },

  // day banner
  dayBanner: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  dayBannerText: { color: '#F1F1F1', fontSize: 14, fontWeight: '600' },

  // legend
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pillText: { fontSize: 12, fontWeight: '700' },

  // empty state
  emptyCard: {
    marginTop: 12,
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 14,
  },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: { color: '#bdbdbd', fontSize: 13 },

  // info
  infoCard: {
    marginTop: 12,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 12,
    gap: 10,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  infoSubtitle: { color: '#cfcfcf', marginTop: 2 },

  badge: {
    backgroundColor: '#C8102E',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  jobCard: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#232323',
    marginTop: 2,
    gap: 4,
  },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobTitle: { color: '#fff', fontWeight: '800' },
  jobStatus: {
    color: '#EDEDED',
    fontSize: 12,
    backgroundColor: '#1f1f1f',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  jobItem: { color: '#bfbfbf', fontSize: 13 },
  jobValue: { color: '#eaeaea', fontWeight: '600' },
});
