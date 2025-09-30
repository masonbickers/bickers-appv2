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
import Icon from 'react-native-vector-icons/Feather';
import Footer from '../components/footer';
import { db } from '../firebaseConfig';

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
              customStyles: {
                container: { backgroundColor: '#1a3d7c', borderRadius: 6 },
                text: { color: '#fff', fontWeight: 'bold' },
              },
            };
            if (!jobMap[date]) jobMap[date] = [];
            jobMap[date].push(job);
          });
        }
      });

      holidays.forEach((h) => {
        if (h.employee === employee.name) {
          const start = new Date(h.startDate);
          const end = new Date(h.endDate);
          const d = new Date(start);
          while (d <= end) {
            const date = d.toISOString().split('T')[0];
            marks[date] = {
              customStyles: {
                container: { backgroundColor: '#166534', borderRadius: 6 },
                text: { color: '#fff', fontWeight: 'bold' },
              },
            };
            holidayDates.push(date);
            d.setDate(d.getDate() + 1);
          }
        }
      });

      const today = new Date();
      const futureRange = 30;
      for (let i = 0; i < futureRange; i++) {
        const d = new Date();
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const dayOfWeek = d.getDay();

        if ((dayOfWeek === 0 || dayOfWeek === 6) && !marks[dateStr]) {
          marks[dateStr] = {
            customStyles: {
              container: { backgroundColor: '#444', borderRadius: 6 },
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

  const handleDayPress = (day) => {
    setSelectedDay(day.dateString);
  };

  const renderDayInfo = () => {
    if (!selectedDay || !dayInfo) return null;

    const { jobs, holidays } = dayInfo;

    if (jobs[selectedDay]?.length) {
      return (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>📋 Jobs on {selectedDay}</Text>
          {jobs[selectedDay].map((job) => {
            const dayNote =
              job.notesByDate?.[selectedDay] === 'Other'
                ? job.notesByDate?.[`${selectedDay}-other`]
                : job.notesByDate?.[selectedDay];

            return (
              <View key={job.id} style={styles.jobCard}>
                <Text style={styles.jobText}>Job #{job.jobNumber}</Text>
                {job.client && <Text style={styles.jobText}>👤 Client: {job.client}</Text>}
                {job.location && <Text style={styles.jobText}>📍 Location: {job.location}</Text>}
                {job.vehicles?.length > 0 && (
                  <Text style={styles.jobText}>🚗 Vehicles: {job.vehicles.join(', ')}</Text>
                )}
                {job.equipment?.length > 0 && (
                  <Text style={styles.jobText}>🔧 Equipment: {job.equipment.join(', ')}</Text>
                )}
                {job.notes && <Text style={styles.jobText}>📝 General Notes: {job.notes}</Text>}
                {dayNote && <Text style={styles.jobText}>📅 Day Note: {dayNote}</Text>}
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
        </View>
      );
    }

    const dayOfWeek = new Date(selectedDay).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>⚫ Off (Weekend)</Text>
        </View>
      );
    }

    return (
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>⚪ Yard Based</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Back + Title tight at top */}
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Icon name="arrow-left" size={22} color="#fff" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

{/* Title */}
<Text style={styles.title}>📅 Schedule</Text>

<Calendar
  firstDay={1}   // ✅ week starts on Monday
  markingType={'custom'}
  markedDates={{
    ...markedDates,
    ...(selectedDay
      ? { [selectedDay]: { selected: true, selectedColor: '#C8102E' } }
      : {}),
  }}
  onDayPress={handleDayPress}
  theme={{
    backgroundColor: '#000',
    calendarBackground: '#000',
    dayTextColor: '#fff',
    monthTextColor: '#fff',
    textDisabledColor: '#555',
    arrowColor: '#C8102E',
    todayTextColor: '#C8102E',
  }}
/>


          {renderDayInfo()}

          <View style={styles.legend}>
            <Text style={styles.legendItem}>🔵 On Set</Text>
            <Text style={styles.legendItem}>🟢 Holiday</Text>
            <Text style={styles.legendItem}>⚫ Off</Text>
            <Text style={styles.legendItem}>⚪ Yard</Text>
          </View>

          {/* Push space down here instead of between everything */}
          <View style={{ height: 60 }} />
        </ScrollView>

        <Footer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  backText: { color: '#fff', fontSize: 16, marginLeft: 6 },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  legendItem: { color: '#fff', fontSize: 14 },
  infoCard: {
    marginTop: 12,
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
  },
  infoTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  jobCard: { marginBottom: 8 },
  jobText: { color: '#ccc', fontSize: 14 },
  title: {
  color: '#fff',
  fontSize: 22,
  fontWeight: '700',
  marginBottom: 6,
  textAlign: 'center',   // ✅ centre text
},

});
