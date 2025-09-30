import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  Dimensions,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import Footer from '../components/footer';
import { auth, db } from '../firebaseConfig';

const buttons = [
  { label: 'Schedule', icon: 'calendar', group: 'Operations' },
  { label: 'Work Diary', icon: 'clipboard', group: 'Operations' },
  { label: 'Vehicle Maintenance', icon: 'settings', group: 'Operations' },
  { label: 'Employee Contacts', icon: 'users', group: 'HR' },
  { label: 'Holidays', icon: 'briefcase', group: 'HR' },
  { label: 'Time Sheet', icon: 'clock', group: 'HR' },
  { label: 'Client Contacts', icon: 'phone', group: 'Other' },
  { label: 'Job Numbers', icon: 'hash', group: 'Other' },
  { label: 'Risk Assessments', icon: 'alert-circle', group: 'Other' },
  { label: 'Insurance & Compliance', icon: 'shield', group: 'Other' },
  { label: 'Company Updates', icon: 'info', group: 'Other' },
  { label: 'Settings', icon: 'settings', group: 'Other' },
];

const screenWidth = Dimensions.get('window').width;
const numColumns = 3;
const buttonSpacing = 12;
const buttonSize = (screenWidth - (buttonSpacing * (numColumns + 1))) / numColumns;

export default function HomeScreen() {
  const router = useRouter();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null); // ✅ for job details modal
  const [todayJobs, setTodayJobs] = useState([]);
  const [tomorrowJobs, setTomorrowJobs] = useState([]);
  const [onHoliday, setOnHoliday] = useState(false);
  const [onHolidayTomorrow, setOnHolidayTomorrow] = useState(false);

  const employee = global.employee; // ✅ set at employee login

  const groups = buttons.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

const handleLogout = async () => {
  try {
    await signOut(auth);

    // Clear employee global if used
    global.employee = null;

    // ✅ route back to login page
    router.replace('/screens/login');

    console.log('User signed out');
  } catch (error) {
    console.error('Error signing out:', error);
  }
};

  // ✅ Account info
  const user = auth.currentUser;
  const account = user
    ? {
        name: user.displayName || 'Manager',
        email: user.email || 'No email',
        userCode: 'N/A',
      }
    : employee
    ? {
        name: employee.name || 'Unknown',
        email: employee.email || 'No email',
        userCode: employee.userCode || 'N/A',
      }
    : {
        name: 'Unknown User',
        email: 'No email',
        userCode: 'N/A',
      };

      // --- NEW STATE ---
const [selectedDate, setSelectedDate] = useState(() => {
  const d = new Date();
  d.setDate(d.getDate() + 1); // start at tomorrow
  return d;
});
const [dayJobs, setDayJobs] = useState([]);
const [onHolidayDay, setOnHolidayDay] = useState(false);

useEffect(() => {
  const fetchStatus = async () => {
    if (!employee) return;

    const dateStr = selectedDate.toISOString().split("T")[0]; // YYYY-MM-DD

    const jobsSnap = await getDocs(collection(db, "bookings"));
    const jobs = jobsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const empSnap = await getDocs(collection(db, "employees"));
    const allEmployees = empSnap.docs.map((doc) => doc.data());

    const jobsWithCodes = jobs.map((job) => {
      const codes = (job.employees || [])
        .map((emp) => {
          if (emp.userCode) return emp.userCode;
          const found = allEmployees.find((e) => e.name === emp.name);
          return found ? found.userCode : null;
        })
        .filter(Boolean);
      return { ...job, employeeCodes: codes };
    });

    const filteredJobs = jobsWithCodes.filter(
      (job) =>
        job.employeeCodes.includes(employee.userCode) &&
        (job.bookingDates || []).includes(dateStr)
    );
    setDayJobs(filteredJobs);

    // holiday check if no jobs
    if (filteredJobs.length === 0) {
      const holSnap = await getDocs(collection(db, "holidays"));
      const holidays = holSnap.docs.map((doc) => doc.data());
      const isHoliday = holidays.some(
        (h) =>
          h.employee === employee.name &&
          h.startDate <= dateStr &&
          h.endDate >= dateStr
      );
      setOnHolidayDay(isHoliday);
    } else {
      setOnHolidayDay(false);
    }
  };

  fetchStatus();
}, [selectedDate, employee]);

// --- HANDLERS ---
const goPrevDay = () => {
  setSelectedDate((d) => {
    const newDate = new Date(d);
    newDate.setDate(newDate.getDate() - 1);
    return newDate;
  });
};

const goNextDay = () => {
  setSelectedDate((d) => {
    const newDate = new Date(d);
    newDate.setDate(newDate.getDate() + 1);
    return newDate;
  });
};


  const userInitials = account.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  useEffect(() => {
    const fetchStatus = async () => {
      if (!employee) return;

      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const tomorrowDateObj = new Date();
      tomorrowDateObj.setDate(tomorrowDateObj.getDate() + 1);
      const tomorrow = tomorrowDateObj.toISOString().split('T')[0];

      const jobsSnap = await getDocs(collection(db, 'bookings'));
      const jobs = jobsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const empSnap = await getDocs(collection(db, 'employees'));
      const allEmployees = empSnap.docs.map((doc) => doc.data());

      const jobsWithCodes = jobs.map((job) => {
        const codes = (job.employees || [])
          .map((emp) => {
            if (emp.userCode) return emp.userCode;
            const found = allEmployees.find((e) => e.name === emp.name);
            return found ? found.userCode : null;
          })
          .filter(Boolean);
        return { ...job, employeeCodes: codes };
      });

      const todaysJobs = jobsWithCodes.filter(
        (job) =>
          job.employeeCodes.includes(employee.userCode) &&
          (job.bookingDates || []).includes(today)
      );
      setTodayJobs(todaysJobs);

      const tomorrowsJobs = jobsWithCodes.filter(
        (job) =>
          job.employeeCodes.includes(employee.userCode) &&
          (job.bookingDates || []).includes(tomorrow)
      );
      setTomorrowJobs(tomorrowsJobs);

      // 🔹 If no jobs today, check holiday
      if (todaysJobs.length === 0) {
        const holSnap = await getDocs(collection(db, 'holidays'));
        const holidays = holSnap.docs.map((doc) => doc.data());
        const isHoliday = holidays.some(
          (h) =>
            h.employee === employee.name &&
            h.startDate <= today &&
            h.endDate >= today
        );
        if (isHoliday) setOnHoliday(true);
      }

      // 🔹 If no jobs tomorrow, check holiday
      if (tomorrowsJobs.length === 0) {
        const holSnap = await getDocs(collection(db, 'holidays'));
        const holidays = holSnap.docs.map((doc) => doc.data());
        const isHolidayTomorrow = holidays.some(
          (h) =>
            h.employee === employee.name &&
            h.startDate <= tomorrow &&
            h.endDate >= tomorrow
        );
        if (isHolidayTomorrow) setOnHolidayTomorrow(true);
      }
    };

    fetchStatus();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header with logo + user icon */}
          <View style={styles.headerRow}>
            <Image
              source={require('../../assets/images/bickers-action-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <TouchableOpacity
              style={styles.userIcon}
              onPress={() => setShowAccountModal(true)}
            >
              <Text style={styles.userInitials}>{userInitials}</Text>
            </TouchableOpacity>
          </View>

      {/* 🔥 Today's Work Block */}
<View style={styles.statusBlock}>
  <Text style={styles.sectionHeading}>Today's Work</Text>
  {todayJobs.length > 0 ? (
    todayJobs.map((job) => (
      <TouchableOpacity key={job.id} onPress={() => setSelectedJob(job)}>
        <View style={styles.jobCard}>
          <Text style={styles.jobTitle}>📋 Job #{job.jobNumber || 'N/A'}</Text>
          {job.client && <Text style={styles.jobDetail}>👤 Client: {job.client}</Text>}
          {job.location && <Text style={styles.jobDetail}>📍 Location: {job.location}</Text>}
          {job.bookingDates?.length > 0 && (
            <Text style={styles.jobDetail}>📅 Dates: {job.bookingDates.join(', ')}</Text>
          )}
          {job.employees?.length > 0 && (
            <Text style={styles.jobDetail}>
              👷 Employees: {job.employees.map((e) => e.name || e).join(', ')}
            </Text>
          )}
          {job.vehicles?.length > 0 && (
            <Text style={styles.jobDetail}>🚗 Vehicles: {job.vehicles.join(', ')}</Text>
          )}
          {job.equipment?.length > 0 && (
            <Text style={styles.jobDetail}>🔧 Equipment: {job.equipment.join(', ')}</Text>
          )}
          {job.status && <Text style={styles.jobDetail}>⚡ Status: {job.status}</Text>}
          {job.notes && <Text style={styles.jobDetail}>📝 Notes: {job.notes}</Text>}
        </View>
      </TouchableOpacity>
    ))
  ) : onHoliday ? (
    <Text style={styles.statusText}>On Holiday</Text>
  ) : (
    <Text style={styles.statusText}>Yard Based</Text>
  )}
</View>

{/* 🔥 Work Block with arrows */}
<View style={styles.statusBlock}>
  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
    <TouchableOpacity onPress={goPrevDay}>
      <Icon name="arrow-left" size={20} color="#fff" />
    </TouchableOpacity>

    <Text style={styles.sectionHeading}>
      {selectedDate.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "2-digit",
        month: "short",
      })}
    </Text>

    <TouchableOpacity onPress={goNextDay}>
      <Icon name="arrow-right" size={20} color="#fff" />
    </TouchableOpacity>
  </View>

{dayJobs.length > 0 ? (
  dayJobs.map((job) => (
    <TouchableOpacity key={job.id} onPress={() => setSelectedJob(job)}>
      <View style={styles.jobCard}>
        <Text style={styles.jobTitle}> Job #{job.jobNumber || "N/A"}</Text>
        {job.client && <Text style={styles.jobDetail}>👤 Production: {job.client}</Text>}
        {job.location && <Text style={styles.jobDetail}>📍 Location: {job.location}</Text>}
        {job.bookingDates?.length > 0 && (
          <Text style={styles.jobDetail}>📅 Dates: {job.bookingDates.join(", ")}</Text>
        )}
        {job.employees?.length > 0 && (
          <Text style={styles.jobDetail}>
            👥 Crew: {job.employees.map((e) => e.name || e).join(", ")}
          </Text>
        )}
        {job.vehicles?.length > 0 && (
          <Text style={styles.jobDetail}>🚗 Vehicles: {job.vehicles.join(", ")}</Text>
        )}
        {job.equipment?.length > 0 && (
          <Text style={styles.jobDetail}>🔧 Equipment: {job.equipment.join(", ")}</Text>
        )}
        {job.notes && <Text style={styles.jobDetail}>📝 Notes: {job.notes}</Text>}
      </View>
    </TouchableOpacity>
  ))
) : onHolidayDay ? (
  <Text style={styles.statusText}>On Holiday</Text>
) : [0, 6].includes(selectedDate.getDay()) ? ( // 0=Sunday, 6=Saturday
  <Text style={styles.statusText}>Off</Text>
) : (
  <Text style={styles.statusText}>Yard Based</Text>
)}

</View>



          {/* Buttons grid */}
          {Object.entries(groups).map(([groupName, groupItems]) => {
            const filteredItems = groupItems.filter(
              (btn) => !(btn.label === 'Work Diary' && global.employee?.userCode !== '2996')
            );
            const colCount = filteredItems.length === 2 ? 2 : 3;
            const buttonSizeDynamic =
              (screenWidth - buttonSpacing * (colCount + 1)) / colCount;

            return (
              <View key={groupName} style={{ marginBottom: 20 }}>
                <Text style={styles.groupTitle}>{groupName}</Text>
                <View
                  style={[
                    styles.grid,
                    { justifyContent: colCount === 2 ? 'space-around' : 'space-between' },
                  ]}
                >
                  {filteredItems.map((btn, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.button,
                        styles.buttonColor,
                        { width: buttonSizeDynamic, height: buttonSizeDynamic },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (btn.label === 'Schedule') {
                          router.push('screens/schedule');
                        } else if (btn.label === 'Work Diary') {
                          router.push('/work-diary');
                        } else if (btn.label === 'Employee Contacts') {
                          router.push('/contacts');
                        } else if (btn.label === 'Holidays') {
                          router.push('/holidaypage');
                        } else if (btn.label === 'Time Sheet') {
                          router.push('/timesheet');
                        } else if (btn.label === 'Vehicle Maintenance') {
                          router.push('/maintenance');
                        }
                      }}
                    >
                      <Icon name={btn.icon} size={24} color="#fff" style={{ marginBottom: 6 }} />
                      <Text style={styles.buttonText}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.groupDivider} />
              </View>
            );
          })}
        </ScrollView>

        {/* ✅ Footer fixed at bottom */}
        <Footer />

{/* ✅ Job Details Modal */}
{selectedJob && (
  <View style={styles.modalBackdrop}>
    <View style={styles.modalContent}>
      <Text style={styles.modalTitle}>Job #{selectedJob.jobNumber || 'N/A'}</Text>

      {selectedJob.client && (
        <Text style={styles.modalDetail}>🧑‍💼 Production: {selectedJob.client}</Text>
      )}
      {selectedJob.location && (
        <Text style={styles.modalDetail}>📌 Location: {selectedJob.location}</Text>
      )}
      {selectedJob.bookingDates?.length > 0 && (
        <Text style={styles.modalDetail}>
          🗓️ Dates: {selectedJob.bookingDates.join(', ')}
        </Text>
      )}
      {selectedJob.employees?.length > 0 && (
        <Text style={styles.modalDetail}>
          👥 Crew: {selectedJob.employees.map((e) => e.name || e).join(', ')}
        </Text>
      )}
      {selectedJob.vehicles?.length > 0 && (
        <Text style={styles.modalDetail}>🚙 Vehicles: {selectedJob.vehicles.join(', ')}</Text>
      )}
      {selectedJob.equipment?.length > 0 && (
        <Text style={styles.modalDetail}>🛠️ Equipment: {selectedJob.equipment.join(', ')}</Text>
      )}

      {selectedJob.notes && (
        <Text style={styles.modalDetail}>📄 Notes: {selectedJob.notes}</Text>
      )}
  


      <TouchableOpacity
        style={[styles.modalButton, { backgroundColor: '#C8102E', marginTop: 20 }]}
        onPress={() => setSelectedJob(null)}
      >
        <Text style={styles.buttonText}>Close</Text>
      </TouchableOpacity>
    </View>
  </View>
)}


{/* ✅ Account Modal */}
{showAccountModal && (
  <View style={styles.modalBackdrop}>
    <View style={styles.modalContent}>
      <Text style={styles.modalTitle}>My Account</Text>
      <Text style={styles.modalDetail}>Name: {account.name}</Text>
      <Text style={styles.modalDetail}>Email: {account.email}</Text>
      <Text style={styles.modalDetail}>Code: {account.userCode}</Text>

      <TouchableOpacity
        style={styles.modalButton}
        onPress={() => {
          setShowAccountModal(false); // close modal
          router.push('/edit-profile'); // ✅ route to edit profile
        }}
      >
        <Text style={styles.buttonText}>View Profile</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.modalButton, { backgroundColor: '#f44336', marginTop: 10 }]}
        onPress={handleLogout}
      >
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.modalButton, { backgroundColor: '#505050', marginTop: 10 }]}
        onPress={() => setShowAccountModal(false)}
      >
        <Text style={styles.buttonText}>Close</Text>
      </TouchableOpacity>
    </View>
  </View>
)}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { paddingHorizontal: buttonSpacing, paddingTop: 20, paddingBottom: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  logo: { width: 150, height: 50 },
  userIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2E2E2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInitials: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  statusBlock: {
    backgroundColor: '#1a1a1a',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  sectionHeading: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  statusText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  jobCard: { backgroundColor: '#2a2a2a', padding: 12, borderRadius: 8, marginBottom: 12 },
  jobTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  jobDetail: { color: '#ccc', fontSize: 14, marginBottom: 2 },

  groupTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12, marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  button: {
    width: buttonSize,
    height: buttonSize,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: buttonSpacing,
    backgroundColor: '#2E2E2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonColor: { backgroundColor: '#2E2E2E' },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', textAlign: 'center', paddingHorizontal: 4 },

  groupDivider: { height: 1, backgroundColor: '#333', marginTop: 6, borderRadius: 1, opacity: 0.7 },

  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: { backgroundColor: '#1a1a1a', padding: 20, borderRadius: 10, width: '90%', maxHeight: '80%' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  modalDetail: { color: '#ccc', fontSize: 14, marginBottom: 6 },
  modalButton: { backgroundColor: '#333', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
});
