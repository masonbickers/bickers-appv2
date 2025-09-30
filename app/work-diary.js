import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Calendar } from 'react-native-calendars';
import Footer from './components/footer';
import { db } from "./firebaseConfig";

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

  const fetchBookings = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'bookings'));
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const today = new Date().toISOString().split('T')[0];
      const upcoming = data.filter((b) => {
        const date = b.date?.split('T')[0] || b.startDate?.split('T')[0];
        return date > today;
      });

      setAllBookings(data);
      setUpcomingBookings(upcoming);
    } catch (error) {
      console.error('Error fetching bookings:', error);
    }
  };

  const filterJobsForSelectedDate = () => {
    const filtered = allBookings.filter((b) => {
      const date = b.date?.split('T')[0] || b.startDate?.split('T')[0];
      return date === selectedDate;
    });
    setJobsForSelectedDate(filtered);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.header}>Work Diary</Text>

          <Calendar
            onDayPress={(day) => setSelectedDate(day.dateString)}
            markedDates={{
              [selectedDate]: { selected: true, selectedColor: '#505050' },
            }}
            style={styles.calendar}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.buttonText}>+ Add Booking</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.buttonText}>+ Add Stunt</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Jobs for {selectedDate}</Text>
            {jobsForSelectedDate.map((job) => (
              <TouchableOpacity
                key={job.id}
                style={styles.jobCard}
                onPress={() => setSelectedJob(job)}
              >
                <Text style={{ color: '#fff' }}>{job.jobNumber} – {job.client}</Text>
                <Text style={{ color: '#aaa' }}>{job.location}</Text>
                <Text style={{ color: '#aaa' }}>Status: {job.status}</Text>
                <Text style={{ color: '#aaa' }}>
                  Employees:{' '}
                  {job.employees && job.employees.length > 0
                    ? Array.isArray(job.employees)
                      ? job.employees.join(', ')
                      : job.employees
                    : 'No employees assigned'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming Bookings</Text>
            {upcomingBookings.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={styles.jobCard}
                onPress={() => setSelectedJob(b)}
              >
                <Text style={{ color: '#fff' }}>{b.date?.split('T')[0]} – {b.jobNumber}</Text>
                <Text style={{ color: '#aaa' }}>{b.client} @ {b.location}</Text>
                <Text style={{ color: '#aaa' }}>Status: {b.status}</Text>
                <Text style={{ color: '#aaa' }}>
                  Employees:{' '}
                  {b.employees && b.employees.length > 0
                    ? Array.isArray(b.employees)
                      ? b.employees.join(', ')
                      : b.employees
                    : 'No employees assigned'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* ✅ Fixed Footer at the bottom */}
        <Footer />

        {/* 🆕 Job Preview Modal */}
        <Modal
          visible={selectedJob !== null}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setSelectedJob(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              {selectedJob && (
                <>
                  <Text style={styles.modalTitle}>{selectedJob.jobNumber} – {selectedJob.client}</Text>
                  <Text style={styles.modalDetail}>Location: {selectedJob.location}</Text>
                  <Text style={styles.modalDetail}>Status: {selectedJob.status}</Text>
                  <Text style={styles.modalDetail}>
                    Start: {selectedJob.startDate ? selectedJob.startDate.split('T')[0] : 'Not set'}
                  </Text>
                  <Text style={styles.modalDetail}>
                    End: {selectedJob.endDate ? selectedJob.endDate.split('T')[0] : 'Not set'}
                  </Text>
                  <Text style={styles.modalDetail}>
                    Employees:{' '}
                    {selectedJob.employees && selectedJob.employees.length > 0
                      ? Array.isArray(selectedJob.employees)
                        ? selectedJob.employees.join(', ')
                        : selectedJob.employees
                      : 'No employees assigned'}
                  </Text>
                  <Text style={styles.modalDetail}>Notes: {selectedJob.notes || 'No notes'}</Text>

                  <TouchableOpacity
                    style={[styles.actionButton, { marginTop: 20 }]}
                    onPress={() => setSelectedJob(null)}
                  >
                    <Text style={styles.buttonText}>Close</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16 },
  header: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  calendar: { marginBottom: 16, borderRadius: 8 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  actionButton: { backgroundColor: '#505050', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  section: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, marginBottom: 16 },
  sectionTitle: { color: '#fff', fontSize: 18, marginBottom: 8 },
  jobCard: { backgroundColor: '#2e2e2e', padding: 10, borderRadius: 6, marginBottom: 8 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    padding: 20,
    borderRadius: 10,
    width: '80%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalDetail: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 6,
  },
});
