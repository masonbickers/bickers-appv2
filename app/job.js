// app/screens/job-day.js  (or app/job-day.js)
// A focused "Jobs by Day" page with prev/next day, Vehicle Check, and Recce actions.

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig'; // <-- adjust if file is at app/job-day.js

/* ---------- Helpers ---------- */
const toISO = (d) => d.toISOString().split('T')[0];

const getCallTime = (job, dateISO) => {
  const byDate =
    job.callTimes?.[dateISO] ||
    job.callTimeByDate?.[dateISO] ||
    job.call_times?.[dateISO];

  const single = job.callTime || job.calltime || job.call_time;

  const fromNotes =
    job.notesByDate?.[`${dateISO}-callTime`] ||
    job.notesByDate?.[dateISO]?.callTime;

  return byDate || single || fromNotes || null;
};

const getDayNote = (job, dateISO) => {
  const v = job?.notesByDate?.[dateISO];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof job?.notes === 'string' && job.notes.trim()) return job.notes.trim();
  return null;
};

// Your rule: "Recce Day" tag is in notesByDate for that date
const isRecceDay = (job, dateISO) => /^(recce\s*day)$/i.test(getDayNote(job, dateISO) || '');

/* ---------- Screen ---------- */
export default function JobDayScreen() {
  const router = useRouter();
  const employee = global.employee; // consistent with your Home page

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [jobs, setJobs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const dateISO = useMemo(() => toISO(selectedDate), [selectedDate]);

  const loadJobs = useCallback(async () => {
    if (!employee) return;

    // Load bookings + employees once (simple approach; optimise later with queries if needed)
    const [jobsSnap, empSnap] = await Promise.all([
      getDocs(collection(db, 'bookings')),
      getDocs(collection(db, 'employees')),
    ]);

    const allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allEmployees = empSnap.docs.map((d) => d.data());

    // Attach userCodes to each job.employees[] for matching
    const withCodes = allJobs.map((job) => {
      const codes = (job.employees || [])
        .map((emp) => {
          if (emp?.userCode) return emp.userCode;
          const found = allEmployees.find((e) => e.name === emp?.name);
          return found ? found.userCode : null;
        })
        .filter(Boolean);
      return { ...job, employeeCodes: codes };
    });

    const todays = withCodes.filter(
      (j) => j.employeeCodes.includes(employee.userCode) && (j.bookingDates || []).includes(dateISO)
    );

    setJobs(todays);
  }, [employee, dateISO]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadJobs();
    setRefreshing(false);
  }, [loadJobs]);

  const goPrevDay = () => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() - 1);
      return nd;
    });
  };

  const goNextDay = () => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + 1);
      return nd;
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>Jobs for the Day</Text>
        <Text style={{ color: '#9e9e9e', marginTop: 4 }}>
          {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
        </Text>
      </View>

      {/* Day Nav */}
      <View style={styles.dayHeader}>
        <TouchableOpacity onPress={goPrevDay}>
          <Icon name="arrow-left" size={18} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.dayTitle}>
          {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' })}
        </Text>
        <TouchableOpacity onPress={goNextDay}>
          <Icon name="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {jobs.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No jobs for you on this day.</Text>
          </View>
        ) : (
          jobs.map((job) => {
            const callTime = getCallTime(job, dateISO);
            const note = getDayNote(job, dateISO);
            const recce = isRecceDay(job, dateISO);
            return (
              <View key={job.id} style={styles.jobCard}>
                <View style={styles.titleRow}>
                  <Text style={styles.jobTitle}>Job #{job.jobNumber || 'N/A'}</Text>
                  {callTime ? <Text style={styles.callBadge}>{callTime}</Text> : null}
                </View>

                {job.client && (
                  <Text style={styles.jobLine}>
                    <Text style={styles.jobLabel}>Production: </Text>{job.client}
                  </Text>
                )}
                {job.location && (
                  <Text style={styles.jobLine}>
                    <Text style={styles.jobLabel}>Location: </Text>{job.location}
                  </Text>
                )}
                {job.vehicles?.length > 0 && (
                  <Text style={styles.jobLine}>
                    <Text style={styles.jobLabel}>Vehicles: </Text>{job.vehicles.join(', ')}
                  </Text>
                )}
                {job.employees?.length > 0 && (
                  <Text style={styles.jobLine}>
                    <Text style={styles.jobLabel}>Crew: </Text>
                    {job.employees.map((e) => e.name || e).join(', ')}
                  </Text>
                )}
                {note && (
                  <Text style={styles.jobLine}>
                    <Text style={styles.jobLabel}>Day Note: </Text>{note}
                  </Text>
                )}

                {/* Actions */}
                <View style={styles.actionsRow}>
                  {/* Vehicle Check */}
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#2E2E2E' }]}
                    activeOpacity={0.85}
                    onPress={() =>
                      router.push({
                        pathname: '/vehicle-check',
                        params: { jobId: job.id, dateISO },
                      })
                    }
                  >
                    <Icon name="check-square" size={14} color="#fff" />
                    <Text style={styles.actionText}>Vehicle Check</Text>
                  </TouchableOpacity>

                  {/* Recce Form (visible only if it's a Recce Day) */}
                  {recce && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#C8102E' }]}
                      activeOpacity={0.9}
                      onPress={() =>
                        router.push({
                          pathname: '/recce',
                          params: { jobId: job.id, dateISO },
                        })
                      }
                    >
                      <Icon name="file-text" size={14} color="#fff" />
                      <Text style={styles.actionText}>Fill Recce Form</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  dayTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },

  jobCard: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  jobTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  callBadge: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: '#1f1f1f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  jobLine: { color: '#ccc', fontSize: 14, marginBottom: 2 },
  jobLabel: { color: '#fff', fontWeight: '700' },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  emptyWrap: { padding: 16, alignItems: 'center' },
  emptyText: { color: '#bdbdbd', fontSize: 14 },
});
