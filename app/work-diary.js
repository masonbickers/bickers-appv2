import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { db } from '../firebaseConfig';

export default function WorkDiaryPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [allBookings, setAllBookings] = useState([]);
  const [jobsForSelectedDate, setJobsForSelectedDate] = useState([]);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    fetchBookings();
  }, []);

  useEffect(() => {
    filterJobsForSelectedDate();
  }, [selectedDate, allBookings]);

  /* ---------- helpers ---------- */
  const toArray = (val) => (Array.isArray(val) ? val : val ? [val] : []);
  const nameOf = (x) =>
    typeof x === 'string'
      ? x
      : x && typeof x === 'object'
      ? x.name || x.fullName || x.label || x.email || x.userCode || 'Unknown'
      : 'Unknown';
  const formatPeople = (val) => {
    const arr = toArray(val).map(nameOf).filter(Boolean);
    return arr.length ? arr.join(', ') : 'No employees assigned';
  };
  const formatVehicles = (val) => {
    const arr = toArray(val).map((v) =>
      typeof v === 'string'
        ? v
        : v && typeof v === 'object'
        ? v.reg || v.name || v.label || 'Vehicle'
        : 'Vehicle'
    );
    return arr.length ? arr.join(', ') : 'None';
  };

  // First ISO date for a booking (YYYY-MM-DD string) from common fields
  const firstDateStr = (b) =>
    (typeof b?.date === 'string' && b.date.split('T')[0]) ||
    (typeof b?.startDate === 'string' && b.startDate.split('T')[0]) ||
    null;

  const formatDateNice = (isoDate) => {
    if (!isoDate) return 'Not set';
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatShortDay = (isoDate) => {
    if (!isoDate) return '—';
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  };

  const productionOf = (b) => b?.production || b?.client || 'Production';

  // grey-out test
  const isMutedStatus = (status) => {
    const s = String(status || '').toLowerCase();
    return s.includes('postpon') || s.includes('cancel') || s.includes('lost');
  };

  const todayISO = useMemo(() => new Date().toISOString().split('T')[0], []);
  const tomorrowISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  const dayChipLabel = (iso) => {
    if (!iso) return '';
    if (iso === todayISO) return 'Today';
    if (iso === tomorrowISO) return 'Tomorrow';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { weekday: 'short' }); // Mon, Tue, ...
  };

  // week helpers
  const startOfWeekISO = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    const day = d.getDay(); // 0 Sun
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    return d.toISOString().split('T')[0];
  };
  const isSameWeek = (isoA, isoB) => startOfWeekISO(isoA) === startOfWeekISO(isoB);

  /* ---------- data ---------- */
  const fetchBookings = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'bookings'));
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const upcoming = data
        .filter((b) => {
          const d = firstDateStr(b);
          return d && d >= todayISO; // today and future
        })
        .sort((a, b) => {
          const da = firstDateStr(a);
          const db = firstDateStr(b);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return da < db ? -1 : da > db ? 1 : 0;
        });

      setAllBookings(data);
      setUpcomingBookings(upcoming);
    } catch (error) {
      console.error('Error fetching bookings:', error);
    }
  };

  const filterJobsForSelectedDate = () => {
    const filtered = allBookings.filter((b) => {
      const date = firstDateStr(b);
      return date === selectedDate;
    });
    setJobsForSelectedDate(filtered);
  };

  /* ---------- group upcoming into clearer day buckets ---------- */
  const groupedUpcoming = useMemo(() => {
    const groups = { today: [], tomorrow: [], thisWeek: [], later: [] };
    for (const b of upcomingBookings) {
      const d = firstDateStr(b);
      if (!d) continue;
      if (d === todayISO) groups.today.push(b);
      else if (d === tomorrowISO) groups.tomorrow.push(b);
      else if (isSameWeek(d, todayISO)) groups.thisWeek.push(b);
      else groups.later.push(b);
    }
    return groups;
  }, [upcomingBookings, todayISO, tomorrowISO]);

  /* ---------- UI ---------- */
  const SelectedHeader = () => {
    const label =
      selectedDate === todayISO
        ? 'Today'
        : selectedDate === tomorrowISO
        ? 'Tomorrow'
        : formatShortDay(selectedDate);
    return (
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.sectionTitle}>Jobs for {selectedDate}</Text>
          <View style={styles.dayChip}>
            <Text style={styles.dayChipText}>{label}</Text>
          </View>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{jobsForSelectedDate.length}</Text>
        </View>
      </View>
    );
  };

  const Card = ({ job }) => {
    const dateStr = firstDateStr(job);
    const muted = isMutedStatus(job.status);
    const tone = muted ? styles.leftMuted : styles.leftActive;
    return (
      <TouchableOpacity
        key={job.id}
        style={[styles.jobCard, muted && styles.jobCardMuted]}
        onPress={() => setSelectedJob(job)}
        activeOpacity={0.9}
      >
        {/* left status bar */}
        <View style={[styles.leftBar, tone]} />
        <View style={{ flex: 1 }}>
          <View style={styles.jobHeader}>
            <Text style={[styles.jobTitle, muted && styles.jobTitleMuted]}>
              #{job.jobNumber || 'N/A'} · {productionOf(job)}
            </Text>
            {/* date chip */}
            <View style={[styles.smallChip, muted && styles.smallChipMuted]}>
              <Text style={[styles.smallChipText, muted && styles.smallChipTextMuted]}>
                {dayChipLabel(dateStr)}
              </Text>
            </View>
          </View>

          <Text style={[styles.jobMeta, muted && styles.jobMetaMuted]}>
            🗓️ {formatDateNice(dateStr)}
          </Text>
          <Text style={[styles.jobMeta, muted && styles.jobMetaMuted]}>
            🎬 Production: {productionOf(job)}
          </Text>
          {job.location ? (
            <Text style={[styles.jobMeta, muted && styles.jobMetaMuted]}>📍 {job.location}</Text>
          ) : null}
          <Text style={[styles.jobMeta, muted && styles.jobMetaMuted]}>
            👥 {formatPeople(job.employees)}
          </Text>
          <Text style={[styles.jobMeta, muted && styles.jobMetaMuted]}>
            🚗 {formatVehicles(job.vehicles || job.vehicle)}
          </Text>

          {job.status ? (
            <View style={styles.statusRow}>
              <Text style={[styles.jobStatus, muted && styles.jobStatusMuted]}>{job.status}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const UpcomingSection = ({ title, items }) => {
    if (!items.length) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{items.length}</Text>
          </View>
        </View>
        {items.map((b) => (
          <Card key={b.id} job={b} />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header (centered title, no back button) */}
          <View style={styles.headerRow}>
            <View style={{ width: 68 }} />
            <Text style={styles.title}>Work Diary</Text>
            <View style={{ width: 68 }} />
          </View>

          {/* Calendar Card */}
          <View style={styles.card}>
            <Calendar
              onDayPress={(day) => setSelectedDate(day.dateString)}
              markedDates={{
                [selectedDate]: { selected: true, selectedColor: '#C8102E' },
                [todayISO]:
                  selectedDate === todayISO
                    ? { selected: true, selectedColor: '#C8102E' }
                    : { marked: true, dotColor: '#C8102E' }, // tiny dot for today if not selected
              }}
              firstDay={1}
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

          {/* Quick Action (Add Booking only) */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]}>
              <Text style={styles.actionText}>+ Add Booking</Text>
            </TouchableOpacity>
          </View>

          {/* Jobs for Selected Day */}
          <View style={styles.section}>
            <SelectedHeader />
            {jobsForSelectedDate.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No jobs assigned</Text>
                <Text style={styles.emptySubtitle}>Add a booking or pick a different date.</Text>
              </View>
            ) : (
              jobsForSelectedDate.map((job) => <Card key={job.id} job={job} />)
            )}
          </View>

          {/* Upcoming grouped */}
          <UpcomingSection title="Today" items={groupedUpcoming.today} />
          <UpcomingSection title="Tomorrow" items={groupedUpcoming.tomorrow} />
          <UpcomingSection title="This Week" items={groupedUpcoming.thisWeek} />
          <UpcomingSection title="Later" items={groupedUpcoming.later} />

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Modal */}
        <Modal
          visible={selectedJob !== null}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedJob(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              {selectedJob && (
                <>
                  <Text style={styles.modalTitle}>
                    #{selectedJob.jobNumber || 'N/A'} · {productionOf(selectedJob)}
                  </Text>

                  <Text style={styles.modalItem}>
                    🗓️ Date: <Text style={styles.modalValue}>{formatDateNice(firstDateStr(selectedJob))}</Text>
                  </Text>
                  {selectedJob.status ? (
                    <Text style={styles.modalItem}>
                      ⚡ Status:{' '}
                      <Text
                        style={[
                          styles.modalValue,
                          isMutedStatus(selectedJob.status) && { color: '#9ca3af' },
                        ]}
                      >
                        {selectedJob.status}
                      </Text>
                    </Text>
                  ) : null}
                  {selectedJob.location ? (
                    <Text style={styles.modalItem}>
                      📍 Location: <Text style={styles.modalValue}>{selectedJob.location}</Text>
                    </Text>
                  ) : null}
                  <Text style={styles.modalItem}>
                    👥 Employees: <Text style={styles.modalValue}>{formatPeople(selectedJob.employees)}</Text>
                  </Text>
                  <Text style={styles.modalItem}>
                    🚗 Vehicles:{' '}
                    <Text style={styles.modalValue}>{formatVehicles(selectedJob.vehicles || selectedJob.vehicle)}</Text>
                  </Text>
                  <Text style={styles.modalItem}>
                    📝 Notes: <Text style={styles.modalValue}>{selectedJob.notes || 'No notes'}</Text>
                  </Text>

                  <TouchableOpacity style={styles.modalBtn} onPress={() => setSelectedJob(null)}>
                    <Text style={styles.modalBtnText}>Close</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  /* Layout */
  safeArea: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16 },

  /* Header (centered title) */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },

  /* Cards */
  card: {
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 14,
  },

  /* Action (only Add Booking) */
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionPrimary: { backgroundColor: '#C8102E' },
  actionText: { color: '#fff', fontWeight: '800' },

  /* Sections */
  section: {
    backgroundColor: '#0f0f0f',
    borderColor: '#1f1f1f',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },

  /* Chips */
  badge: {
    backgroundColor: '#C8102E',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  dayChip: {
    backgroundColor: '#142022',
    borderWidth: 1,
    borderColor: '#1f3a3d',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  dayChipText: { color: '#9be3ea', fontSize: 12, fontWeight: '800' },
  smallChip: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  smallChipMuted: { backgroundColor: '#121212', borderColor: '#1f1f1f' },
  smallChipText: { color: '#cfcfcf', fontSize: 11, fontWeight: '800' },
  smallChipTextMuted: { color: '#a1a1a1' },

  /* Job cards */
  jobCard: {
    flexDirection: 'row',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  jobCardMuted: {
    backgroundColor: '#0f0f0f',
    borderColor: '#1a1a1a',
    opacity: 0.75,
  },
  leftBar: {
    width: 4,
    borderRadius: 3,
    marginRight: 10,
  },
  leftActive: { backgroundColor: '#22c55e' }, // green for active/confirmed-ish
  leftMuted: { backgroundColor: '#6b7280' }, // grey for postponed/cancelled/lost

  jobHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  jobTitle: { color: '#fff', fontWeight: '800', flexShrink: 1, paddingRight: 8 },
  jobTitleMuted: { color: '#b3b3b3' },
  statusRow: { marginTop: 6, flexDirection: 'row', gap: 8 },
  jobStatus: {
    color: '#EDEDED',
    fontSize: 12,
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  jobStatusMuted: { backgroundColor: '#171717', color: '#9ca3af' },
  jobMeta: { color: '#cfcfcf', fontSize: 13, marginTop: 2 },
  jobMetaMuted: { color: '#a3a3a3' },

  /* Empty state */
  emptyCard: {
    backgroundColor: '#101010',
    borderColor: '#1f1f1f',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: { color: '#bdbdbd', fontSize: 13 },

  /* Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '92%',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 14,
    padding: 16,
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalItem: { color: '#cfcfcf', fontSize: 14, marginTop: 4 },
  modalValue: { color: '#fff', fontWeight: '700' },
  modalBtn: { marginTop: 16, backgroundColor: '#C8102E', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  modalBtnText: { color: '#fff', fontWeight: '800' },
});
