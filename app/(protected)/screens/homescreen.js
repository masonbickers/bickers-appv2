// React / hooks
import { useCallback, useEffect, useMemo, useState } from 'react';

// Navigation
import { useRouter } from 'expo-router';

// Expo libs
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';



const MediaEnum = ImagePicker?.MediaType ?? ImagePicker?.MediaTypeOptions;
const IMAGES_ONLY = MediaEnum?.Images ?? undefined;

// Firebase
import { signOut } from 'firebase/auth';

import { auth, db, storage } from '../../../firebaseConfig';


// React Native UI

import {
  Dimensions,
  Image,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { serverTimestamp, setDoc } from 'firebase/firestore';

import Icon from 'react-native-vector-icons/Feather';
console.log('STORAGE BUCKET FROM APP:', storage.app.options.storageBucket);




const buttons = [
  { label: 'Schedule', icon: 'calendar', group: 'Operations' },
  { label: 'Work Diary', icon: 'clipboard', group: 'Operations' },
  { label: 'Vehicle Maintenance', icon: 'settings', group: 'Operations' },
  { label: 'Employee Contacts', icon: 'users', group: 'HR' },
  { label: 'Holidays', icon: 'briefcase', group: 'HR' },
  { label: 'Time Sheet', icon: 'clock', group: 'HR' },
  { label: 'Spec Sheets', icon: 'file-text', group: 'Other' }, // <- was Client Contacts


  { label: 'Insurance & Compliance', icon: 'shield', group: 'Other' },

  { label: 'Settings', icon: 'settings', group: 'Other' },
];

const screenWidth = Dimensions.get('window').width;
const numColumns = 3;
const buttonSpacing = 12;
const buttonSize = (screenWidth - buttonSpacing * (numColumns + 1)) / numColumns;

const dayStatusLabel = ({ jobsLen, isHoliday, dateISO }) => {
  if (jobsLen > 0) return 'On Set';
  const d = new Date(dateISO);
  const dow = d.getDay();
  if (isHoliday) return 'Holiday';
  if (dow === 0 || dow === 6) return 'Off';
  return 'Yard';
};

// Call time helper
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

// NOTES: your shape is notesByDate: { "YYYY-MM-DD": "Recce Day" | "On Set" | ... }
const getDayNote = (job, dateISO) => {
  const v = job?.notesByDate?.[dateISO];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof job?.notes === 'string' && job.notes.trim()) return job.notes.trim(); // optional global fallback
  return null;
};

const isRecceDay = (job, dateISO) => /^(recce\s*day)$/i.test(getDayNote(job, dateISO) || '');

export default function HomeScreen() {
  const router = useRouter();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);

  const [todayJobs, setTodayJobs] = useState([]);
  const [tomorrowJobs, setTomorrowJobs] = useState([]);
  const [onHoliday, setOnHoliday] = useState(false);
  const [onHolidayTomorrow, setOnHolidayTomorrow] = useState(false);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [dayJobs, setDayJobs] = useState([]);
  const [onHolidayDay, setOnHolidayDay] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const employee = global.employee;

  // Recce form state
  const [recceOpen, setRecceOpen] = useState(false);
  const [recceJob, setRecceJob] = useState(null);
  const [recceDateISO, setRecceDateISO] = useState(null);
  const [savingRecce, setSavingRecce] = useState(false);
  const [reccePhotos, setReccePhotos] = useState([]); // [{ uri, width, height }] local picks
// near your other recce state
  const [recceDocId, setRecceDocId] = useState(null);

  const [recceForm, setRecceForm] = useState({
    lead: '',
    locationName: '',
    address: '',
    parking: '',  
    access: '',
    hazards: '',
    power: '',
    measurements: '',
    recommendedKit: '',
    notes: '',
    createdAt: null,
    createdBy: null,
  });

  const groups = useMemo(() => {
    return buttons.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      global.employee = null;
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const user = auth.currentUser;
  const isAnon = !!user?.isAnonymous;
  const account = employee
    ? { name: employee.name || 'Unknown', email: employee.email || 'No email', userCode: employee.userCode || 'N/A' }
    : user && !isAnon
    ? { name: user.displayName || 'Manager', email: user.email || 'No email', userCode: 'N/A' }
    : { name: 'Unknown User', email: 'No email', userCode: 'N/A' };

  const userInitials = account.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const timeOfDay = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const loadDayStatus = useCallback(async (date) => {
    if (!employee) return;
    const dateStr = date.toISOString().split('T')[0];

    const jobsSnap = await getDocs(collection(db, 'bookings'));
    const jobs = jobsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    const empSnap = await getDocs(collection(db, 'employees'));
    const allEmployees = empSnap.docs.map((doc) => doc.data());

    const jobsWithCodes = jobs.map((job) => {
      const codes = (job.employees || [])
        .map((emp) => {
          if (emp?.userCode) return emp.userCode;
          const found = allEmployees.find((e) => e.name === emp?.name);
          return found ? found.userCode : null;
        })
        .filter(Boolean);
      return { ...job, employeeCodes: codes };
    });

    const filteredJobs = jobsWithCodes.filter(
      (job) => job.employeeCodes.includes(employee.userCode) && (job.bookingDates || []).includes(dateStr)
    );
    setDayJobs(filteredJobs);

    if (filteredJobs.length === 0) {
      const holSnap = await getDocs(collection(db, 'holidays'));
      const holidays = holSnap.docs.map((doc) => doc.data());
      const isHoliday = holidays.some(
        (h) => h.employee === employee.name && h.startDate <= dateStr && h.endDate >= dateStr
      );
      setOnHolidayDay(isHoliday);
    } else {
      setOnHolidayDay(false);
    }
  }, [employee]);

  useEffect(() => {
    loadDayStatus(selectedDate);
  }, [selectedDate, loadDayStatus]);

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

  // Always materialize to a real file:// via ImageManipulator (fixes iOS ph://)
const ensureFileUri = async (uri) => {
  if (!uri) return null;
  try {
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manip?.uri || null;
  } catch {
    return uri;
  }
};

// Upload via Blob only (no ArrayBuffer, no base64 anywhere)
const uploadFromUri = async (fileUri, storageRef) => {
  const resp = await fetch(fileUri);
  const blob = await resp.blob();

  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, { contentType: 'image/jpeg' });
    task.on('state_changed', undefined, reject, resolve);
  });

  return getDownloadURL(storageRef);
};


  const loadHeaderStatus = useCallback(async () => {
    if (!employee) return;

    const today = new Date().toISOString().split('T')[0];
    const tmr = (() => {
      const td = new Date();
      td.setDate(td.getDate() + 1);
      return td.toISOString().split('T')[0];
    })();

    const jobsSnap = await getDocs(collection(db, 'bookings'));
    const jobs = jobsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    const empSnap = await getDocs(collection(db, 'employees'));
    const allEmployees = empSnap.docs.map((doc) => doc.data());

    const jobsWithCodes = jobs.map((job) => {
      const codes = (job.employees || [])
        .map((emp) => {
          if (emp?.userCode) return emp.userCode;
          const found = allEmployees.find((e) => e.name === emp?.name);
          return found ? found.userCode : null;
        })
        .filter(Boolean);
      return { ...job, employeeCodes: codes };
    });

    const todaysJobs = jobsWithCodes.filter(
      (job) => job.employeeCodes.includes(employee.userCode) && (job.bookingDates || []).includes(today)
    );
    const tomorrowsJobs = jobsWithCodes.filter(
      (job) => job.employeeCodes.includes(employee.userCode) && (job.bookingDates || []).includes(tmr)
    );
    setTodayJobs(todaysJobs);
    setTomorrowJobs(tomorrowsJobs);

    if (todaysJobs.length === 0) {
      const holSnap = await getDocs(collection(db, 'holidays'));
      const holidays = holSnap.docs.map((doc) => doc.data());
      const isHoliday = holidays.some(
        (h) => h.employee === employee.name && h.startDate <= today && h.endDate >= today
      );
      if (isHoliday) setOnHoliday(true);
    }
    if (tomorrowsJobs.length === 0) {
      const holSnap = await getDocs(collection(db, 'holidays'));
      const holidays = holSnap.docs.map((doc) => doc.data());
      const isHolidayTomorrow = holidays.some(
        (h) => h.employee === employee.name && h.startDate <= tmr && h.endDate >= tmr
      );
      if (isHolidayTomorrow) setOnHolidayTomorrow(true);
    }
  }, [employee]);

  useEffect(() => {
    loadHeaderStatus();
  }, [loadHeaderStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadHeaderStatus(), loadDayStatus(selectedDate)]);
    setRefreshing(false);
  }, [loadHeaderStatus, loadDayStatus, selectedDate]);

  const todayISO = new Date().toISOString().split('T')[0];
  const tomorrowISO = (() => {
    const td = new Date();
    td.setDate(td.getDate() + 1);
    return td.toISOString().split('T')[0];
  })();

  const withEmoji = (label) =>
    ({
      'On Set': 'On Set',
      Holiday: 'Holiday',
      Off: 'Off',
      Yard: 'Yard',
    }[label] || label);

  // Permissions
const ensureMediaPerms = async () => {
  if (Platform.OS === 'web') return;  // web: no native perms
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') throw new Error('Permission to access photos is required.');
};

const ensureCameraPerms = async () => {
  if (Platform.OS === 'web') return;  // web: no native perms
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') throw new Error('Permission to use camera is required.');
};

// one doc per booking + date + user
const recceDocKey = (bookingId, dateISO, userCode) =>
  `${bookingId}__${dateISO}__${userCode || 'N/A'}`;


// Resize to keep uploads light
const shrink = async (uri) => {
  try {
    const res = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    return res.uri;
  } catch {
    return uri;
  }
};

// Convert a local file URI to Blob (works on RN/Expo)


// Request base64 from picker/camera so iOS ph:// works
const pickPhotos = async () => {
  await ensureMediaPerms();
  const res = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: true,
    selectionLimit: 8,
    mediaTypes: IMAGES_ONLY,
    quality: 1, // ✅ no base64
  });
  if (res.canceled) return;

  const assets = res.assets ?? [];
  setReccePhotos(prev =>
    [...prev, ...assets.map(a => ({ uri: a.uri }))].slice(0, 8)
  );
};


const takePhoto = async () => {
  await ensureCameraPerms();
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: IMAGES_ONLY,
    quality: 1, // ✅ no base64
  });
  if (res.canceled) return;

  const a = res.assets?.[0];
  if (a) {
    setReccePhotos(prev =>
      [...prev, { uri: a.uri }].slice(0, 8)
    );
  }
};





const uploadReccePhotos = async (bookingId, dateISO, items) => {
  const urls = [];
  const uid = auth.currentUser?.uid || 'public';

  for (let i = 0; i < items.length; i++) {
    const fileUri = await ensureFileUri(items[i].uri);
    if (!fileUri) continue;

    const filename = `${Date.now()}_${i}.jpg`;
    const path = `recce-photos/${uid}/${bookingId}/${dateISO}/${filename}`;
    const r = ref(storage, path);

    // blob upload
    const resp = await fetch(fileUri);
    const blob = await resp.blob();
    await new Promise((res, rej) =>
      uploadBytesResumable(r, blob, { contentType: 'image/jpeg' }).on('state_changed', undefined, rej, res)
    );

    urls.push(await getDownloadURL(r));
  }
  return urls;
};






// Upload chosen photos to Fireba

// one doc per booking + date + user (you already have recceDocKey)
const openRecceFor = async (job, dateISO) => {
  setRecceJob(job);
  setRecceDateISO(dateISO);
  setRecceOpen(true);

  const creator = employee?.userCode || 'N/A';
  const key = recceDocKey(job.id, dateISO, creator);
  setRecceDocId(key);

  try {
    const snap = await getDoc(doc(db, 'recces', key));
    if (!snap.exists()) {
      // brand new form
      setRecceForm(prev => ({
        ...prev,
        lead: employee?.name || prev.lead || '',
        locationName: job?.location || '',
        createdAt: new Date().toISOString(),
        createdBy: creator,
      }));
      setReccePhotos([]); // no photos yet
      return;
    }

    // existing form
    const data = snap.data();
    const a = data?.answers || {};
    const existingUrls = Array.isArray(a.photos) ? a.photos :
                         (Array.isArray(data?.photos) ? data.photos : []);

    setRecceForm(prev => ({
      ...prev,
      lead: a.lead || employee?.name || prev.lead || '',
      locationName: a.locationName || job?.location || '',
      address: a.address || '',
      parking: a.parking || '',
      access: a.access || '',
      hazards: a.hazards || '',
      power: a.power || '',
      measurements: a.measurements || '',
      recommendedKit: a.recommendedKit || '',
      notes: a.notes || '',
      createdAt: a.createdAt || data.createdAt || new Date().toISOString(),
      createdBy: a.createdBy || data.createdBy || creator,
    }));

    // keep remote URLs in state so saveRecce will preserve them
    setReccePhotos(existingUrls.map(u => ({ uri: u, remote: true })));
  } catch (e) {
    console.warn('openRecceFor error:', e);
  }
};

const saveRecce = async () => {
  if (!recceJob || !recceDateISO) return;
  try {
    setSavingRecce(true);

    // keep already-uploaded URLs, upload only new local files
    const keepUrls = reccePhotos
      .filter(p => p?.remote || (p?.uri || '').startsWith('http'))
      .map(p => p.uri);

    const newLocals = reccePhotos
      .filter(p => !p?.remote && !(p?.uri || '').startsWith('http'));

    const uploaded = await uploadReccePhotos(recceJob.id, recceDateISO, newLocals);
    const finalPhotos = [...keepUrls, ...uploaded];

    const payload = {
      ...recceForm,
      photos: finalPhotos,
      createdAt: recceForm.createdAt || new Date().toISOString(),
      createdBy: employee?.userCode || 'N/A',
      dateISO: recceDateISO,
    };

    // merge into booking (per-day key)
    await setDoc(
      doc(db, 'bookings', recceJob.id),
      { recceForms: { [recceDateISO]: payload } },
      { merge: true }
    );

    // upsert single recce doc at stable id
    const key = recceDocId || `${recceJob.id}__${recceDateISO}__${employee?.userCode || 'N/A'}`;
    await setDoc(
      doc(db, 'recces', key),
      {
        bookingId: recceJob.id,
        jobNumber: recceJob.jobNumber || null,
        client: recceJob.client || null,
        dateISO: recceDateISO,
        status: 'submitted',
        answers: payload,
        notes: payload.notes || '',
        photos: finalPhotos,
        createdAt: recceForm.createdAt ? recceForm.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: employee?.userCode || 'N/A',
        lead: payload.lead || '',
        locationName: payload.locationName || '',
      },
      { merge: true }
    );

    // (optional) close after save
    setRecceOpen(false);
    setRecceJob(null);
    setRecceDateISO(null);
    setReccePhotos([]);
  } catch (e) {
    console.error('Error saving recce form:', e);
  } finally {
    setSavingRecce(false);
  }
};

  

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Image
              source={require('../../../assets/images/bickers-action-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <TouchableOpacity style={styles.userIcon} onPress={() => setShowAccountModal(true)}>
              <Text style={styles.userInitials}>{userInitials}</Text>
            </TouchableOpacity>
          </View>

          {/* Greeting + date */}
          <View style={styles.greetingCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>{timeOfDay},</Text>
              <Text style={styles.greetingName}>{account.name}</Text>
              <Text style={styles.todayText}>
                {new Date().toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>

            {/* Quick chips */}
            <View style={styles.chipsCol}>
              <TouchableOpacity style={[styles.chip, styles.chipPrimary]} onPress={() => router.push('screens/schedule')}>
                <Icon name="calendar" size={14} color="#fff" />
                <Text style={styles.chipText}>My Schedule</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chip, styles.chipGhost]} onPress={() => router.push('/contacts')}>
                <Icon name="users" size={14} color="#fff" />
                <Text style={styles.chipText}>Contacts</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chip, styles.chipGhost]} onPress={() => router.push('/holidaypage')}>
                <Icon name="briefcase" size={14} color="#fff" />
                <Text style={styles.chipText}>Holidays</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Today / Tomorrow strip */}
          <View style={styles.stripRow}>
            <View style={styles.stripCard}>
              <Text style={styles.stripLabel}>Today</Text>
              <Text style={styles.stripValue}>
                {withEmoji(
                  dayStatusLabel({
                    jobsLen: todayJobs.length,
                    isHoliday: onHoliday,
                    dateISO: todayISO,
                  })
                )}
              </Text>
            </View>
            <View style={styles.stripCard}>
              <Text style={styles.stripLabel}>Tomorrow</Text>
              <Text style={styles.stripValue}>
                {withEmoji(
                  dayStatusLabel({
                    jobsLen: tomorrowJobs.length,
                    isHoliday: onHolidayTomorrow,
                    dateISO: tomorrowISO,
                  })
                )}
              </Text>
            </View>
          </View>

          {/* Today’s Work */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Today’s Work</Text>
            {todayJobs.length > 0 ? (
              todayJobs.map((job) => {
                const showRecce = isRecceDay(job, todayISO);
                return (
                  <TouchableOpacity key={job.id} onPress={() => setSelectedJob(job)} activeOpacity={0.85}>
                    <View style={styles.jobCard}>
                      <View style={styles.titleRow}>
                        <Text style={styles.jobTitle}>Job #{job.jobNumber || 'N/A'}</Text>
                        {(() => {
                          const ct = getCallTime(job, todayISO);
                          return ct ? <Text style={styles.callTime}>{ct}</Text> : null;
                        })()}
                      </View>

                      {job.client && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Production: </Text>{job.client}
                        </Text>
                      )}

                      {job.location && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Location: </Text>{job.location}
                        </Text>
                      )}

                      {job.bookingDates?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Dates: </Text>{job.bookingDates.join(', ')}
                        </Text>
                      )}

                      {job.employees?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Crew: </Text>
                          {job.employees.map((e) => e.name || e).join(', ')}
                        </Text>
                      )}

                      {job.vehicles?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Vehicles: </Text>{job.vehicles.join(', ')}
                        </Text>
                      )}

                      {job.equipment?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Equipment: </Text>{job.equipment.join(', ')}
                        </Text>
                      )}

                      {job.status && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Status: </Text>{job.status}
                        </Text>
                      )}

                      {/* Show the exact day note */}
                      {getDayNote(job, todayISO) && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Day Note: </Text>{getDayNote(job, todayISO)}
                        </Text>
                      )}

                      {showRecce && (
                        <TouchableOpacity
                          style={styles.recceBtn}
                          onPress={() => openRecceFor(job, todayISO)}
                          activeOpacity={0.9}
                        >
                          <Icon name="file-text" size={14} color="#fff" />
                          <Text style={styles.recceBtnText}>Fill Recce Form</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : onHoliday ? (
              <Text style={styles.statusText}>Holiday</Text>
            ) : (
              <Text style={styles.statusText}>Yard Based</Text>
            )}
          </View>

          {/* Day scroller */}
          <View style={styles.block}>
            <View style={styles.dayHeader}>
              <TouchableOpacity onPress={goPrevDay}>
                <Icon name="arrow-left" size={18} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.blockTitle}>
                {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' })}
              </Text>
              <TouchableOpacity onPress={goNextDay}>
                <Icon name="arrow-right" size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            {dayJobs.length > 0 ? (
              dayJobs.map((job) => {
                const selectedISO = selectedDate.toISOString().split('T')[0];
                const showRecce = isRecceDay(job, selectedISO);
                return (
                  <TouchableOpacity key={job.id} onPress={() => setSelectedJob(job)} activeOpacity={0.85}>
                    <View style={styles.jobCard}>
                      <View style={styles.titleRow}>
                        <Text style={styles.jobTitle}>Job #{job.jobNumber || 'N/A'}</Text>
                        {(() => {
                          const ct = getCallTime(job, selectedISO);
                          return ct ? <Text style={styles.callTime}>{ct}</Text> : null;
                        })()}
                      </View>

                      {job.client && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Production: </Text>{job.client}
                        </Text>
                      )}

                      {job.location && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Location: </Text>{job.location}
                        </Text>
                      )}

                      {job.bookingDates?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Dates: </Text>{job.bookingDates.join(', ')}
                        </Text>
                      )}

                      {job.employees?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Crew: </Text>
                          {job.employees.map((e) => e.name || e).join(', ')}
                        </Text>
                      )}

                      {job.vehicles?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Vehicles: </Text>{job.vehicles.join(', ')}
                        </Text>
                      )}

                      {job.equipment?.length > 0 && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Equipment: </Text>{job.equipment.join(', ')}
                        </Text>
                      )}

                      {job.status && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Status: </Text>{job.status}
                        </Text>
                      )}

                      {/* Show the exact day note */}
                      {getDayNote(job, selectedISO) && (
                        <Text style={styles.jobDetail}>
                          <Text style={styles.jobLabel}>Day Note: </Text>{getDayNote(job, selectedISO)}
                        </Text>
                      )}

                      {showRecce && (
                        <TouchableOpacity
                          style={styles.recceBtn}
                          onPress={() => openRecceFor(job, selectedISO)}
                          activeOpacity={0.9}
                        >
                          <Icon name="file-text" size={14} color="#fff" />
                          <Text style={styles.recceBtnText}>Fill Recce Form</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : onHolidayDay ? (
              <Text style={styles.statusText}>Holiday</Text>
            ) : [0, 6].includes(selectedDate.getDay()) ? (
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
            const buttonSizeDynamic = (screenWidth - buttonSpacing * (colCount + 1)) / colCount;

            return (
              <View key={groupName} style={{ marginBottom: 18 }}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{groupName}</Text>
                  <View style={styles.groupDividerLine} />
                </View>

                <View
                  style={[
                    styles.grid,
                    { justifyContent: colCount === 2 ? 'space-around' : 'space-between' },
                  ]}
                >
                  {filteredItems.map((btn, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[styles.button, { width: buttonSizeDynamic, height: buttonSizeDynamic }]}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (btn.label === 'Schedule') router.push('screens/schedule');
                        else if (btn.label === 'Work Diary') router.push('/work-diary');
                        else if (btn.label === 'Employee Contacts') router.push('/contacts');
                        else if (btn.label === 'Holidays') router.push('/holidaypage');
                        else if (btn.label === 'Time Sheet') router.push('/timesheet');
                        else if (btn.label === 'Vehicle Maintenance') router.push('/maintenance');
                        else if (btn.label === 'Settings') router.push('/settings');
                        else if (btn.label === 'Spec Sheets') router.push('/spec-sheets'); // <-- add this
                        else if (btn.label === 'Insurance & Compliance') router.push('/insurance');          // if app/insurance.js


                      }}
                    >
                      <Icon name={btn.icon} size={24} color="#fff" style={{ marginBottom: 6 }} />
                      <Text style={styles.buttonText}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* Job Details Modal */}
        {selectedJob && (
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Job #{selectedJob.jobNumber || 'N/A'}</Text>

              {selectedJob.client && (
                <Text style={styles.modalDetail}>🧑‍💼 Production: {selectedJob.client}</Text>
              )}
              {selectedJob.location && <Text style={styles.modalDetail}>📌 Location: {selectedJob.location}</Text>}
              {selectedJob.bookingDates?.length > 0 && (
                <Text style={styles.modalDetail}>🗓️ Dates: {selectedJob.bookingDates.join(', ')}</Text>
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
              {selectedJob.notes && <Text style={styles.modalDetail}>📄 Notes: {selectedJob.notes}</Text>}

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#C8102E', marginTop: 20 }]}
                onPress={() => setSelectedJob(null)}
              >
                <Text style={styles.modalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Account Modal */}
        {showAccountModal && (
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>My Account</Text>
              <Text style={styles.modalDetail}>Name: {account.name}</Text>
              <Text style={styles.modalDetail}>Email: {account.email}</Text>
              <Text style={styles.modalDetail}>Code: {account.userCode}</Text>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#2E2E2E' }]}
                onPress={() => {
                  setShowAccountModal(false);
                  router.push('/edit-profile');
                }}
              >
                <Text style={styles.modalButtonText}>View Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#f44336', marginTop: 10 }]}
                onPress={handleLogout}
              >
                <Text style={styles.modalButtonText}>Logout</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#505050', marginTop: 10 }]}
                onPress={() => setShowAccountModal(false)}
              >
                <Text style={styles.modalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Recce Form Modal */}
        {recceOpen && (
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, { maxHeight: '86%' }]}>
              <Text style={styles.modalTitle}>Recce Form — {recceDateISO}</Text>
              <Text style={[styles.modalDetail, { marginBottom: 8 }]}>
                Job #{recceJob?.jobNumber || 'N/A'} {recceJob?.client ? `· ${recceJob.client}` : ''}
              </Text>

              <ScrollView style={{ maxHeight: 420 }}>
                <Label>Recce Lead</Label>
                <Input
                  value={recceForm.lead}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, lead: t }))}
                  placeholder="Your name"
                />

                <Label>Location Name</Label>
                <Input
                  value={recceForm.locationName}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, locationName: t }))}
                  placeholder="e.g., Richmond Park — Gate A"
                />

                <Label>Address</Label>
                <Input
                  value={recceForm.address}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, address: t }))}
                  placeholder="Street, City, Postcode"
                />

                <Label>Parking</Label>
                <Input
                  value={recceForm.parking}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, parking: t }))}
                  placeholder="Where can we park? Permits? Height limits?"
                  multiline
                />

                <Label>Access</Label>
                <Input
                  value={recceForm.access}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, access: t }))}
                  placeholder="Route in/out, gate codes, load-in distance…"
                  multiline
                />

                <Label>Hazards</Label>
                <Input
                  value={recceForm.hazards}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, hazards: t }))}
                  placeholder="Slopes, public areas, water, overheads…"
                  multiline
                />

                <Label>Power Availability</Label>
                <Input
                  value={recceForm.power}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, power: t }))}
                  placeholder="Mains? Generator required? Distances?"
                />

                <Label>Measurements</Label>
                <Input
                  value={recceForm.measurements}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, measurements: t }))}
                  placeholder="Clearances, widths, distances…"
                />
<Label>Recommended Vehicle/Kit</Label>
<Input
  value={recceForm.recommendedKit}
  onChangeText={(t) => setRecceForm((f) => ({ ...f, recommendedKit: t }))}
  placeholder="Vehicle type, rigging, radios, PPE…"
/>

{/* ADD — Photos */}
<Label>Photos</Label>
<View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
  <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#2E2E2E', flex: 1 }]} onPress={pickPhotos}>
    <Text style={styles.modalButtonText}>Add from Library</Text>
  </TouchableOpacity>
  <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#2E2E2E', flex: 1 }]} onPress={takePhoto}>
    <Text style={styles.modalButtonText}>Take Photo</Text>
  </TouchableOpacity>
</View>

<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
  {reccePhotos.map((p, idx) => (
    <View key={`${p.uri}-${idx}`} style={{ position: 'relative' }}>
      <Image source={{ uri: p.uri }} style={{ width: 84, height: 84, borderRadius: 8 }} />
      <TouchableOpacity
        onPress={() => setReccePhotos(prev => prev.filter((_, i) => i !== idx))}
        style={{ position: 'absolute', top: -8, right: -8, backgroundColor: '#C8102E', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}
      >
        <Text style={{ color: '#fff', fontWeight: '800' }}>×</Text>
      </TouchableOpacity>
    </View>
  ))}
  {reccePhotos.length === 0 && <Text style={{ color: '#8e8e8e' }}>No photos yet.</Text>}
</View>


<Label>Notes</Label>

                <Input
                  value={recceForm.notes}
                  onChangeText={(t) => setRecceForm((f) => ({ ...f, notes: t }))}
                  placeholder="Anything else"
                  multiline
                />
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: '#505050', flex: 1 }]}
                  onPress={() => {
                    setRecceOpen(false);
                    setRecceJob(null);
                    setRecceDateISO(null);
                  }}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: '#C8102E', flex: 1, opacity: savingRecce ? 0.7 : 1 }]}
                  onPress={saveRecce}
                  disabled={savingRecce}
                >
                  <Text style={styles.modalButtonText}>{savingRecce ? 'Saving…' : 'Save Recce'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* Small UI helpers */
const Label = ({ children }) => (
  <Text style={{ color: '#bdbdbd', fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 }}>
    {children}
  </Text>
);

const Input = (props) => (
  <TextInput
    {...props}
    style={[
      {
        color: '#fff',
        backgroundColor: '#232323',
        borderColor: '#333',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: props.multiline ? 10 : 8,
        minHeight: props.multiline ? 68 : undefined,
        marginBottom: 8,
      },
      props.style,
    ]}
    placeholderTextColor="#8e8e8e"
  />
);

/* Styles */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { paddingHorizontal: buttonSpacing, paddingTop: 16, paddingBottom: 20 },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  logo: { width: 150, height: 50 },
  userIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#2E2E2E',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#3a3a3a',
  },
  userInitials: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // Greeting card
  greetingCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    marginBottom: 14,
  },
  greeting: { color: '#cfcfcf', fontSize: 13, marginBottom: 2 },
  greetingName: { color: '#fff', fontSize: 18, fontWeight: '800' },
  todayText: { color: '#9e9e9e', fontSize: 12, marginTop: 2 },
  chipsCol: { justifyContent: 'center', alignItems: 'flex-end', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1,
  },
  chipPrimary: { backgroundColor: '#C8102E', borderColor: '#C8102E' },
  chipGhost: { backgroundColor: '#141414', borderColor: '#232323' },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Today/Tomorrow strip
  stripRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  stripCard: {
    flex: 1,
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 12,
  },
  stripLabel: { color: '#bdbdbd', fontWeight: '700', fontSize: 12 },
  stripValue: { color: '#fff', fontWeight: '800', fontSize: 16, marginTop: 4 },

  // Blocks
  block: {
    backgroundColor: '#1a1a1a',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  blockTitle: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  statusText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 8 },

  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },

  // Job card
  jobCard: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  jobTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  callTime: {
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
  jobDetail: { color: '#ccc', fontSize: 14, marginBottom: 2 },
  jobLabel: { fontWeight: '700', color: '#fff' },

  // Recce button
  recceBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#C8102E',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  recceBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // Groups
  groupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  groupTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginRight: 10 },
  groupDividerLine: { height: 1, backgroundColor: '#333', flex: 1, borderRadius: 1, opacity: 0.7 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  button: {
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: buttonSpacing,
    backgroundColor: '#2E2E2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    padding: 10,
    width: buttonSize,
    height: buttonSize,
  },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 },

  // Modals
  modalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 16,
  },
  modalContent: { backgroundColor: '#1a1a1a', padding: 20, borderRadius: 12, width: '90%', maxHeight: '80%' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  modalDetail: { color: '#ccc', fontSize: 14, marginBottom: 6 },
  modalButton: { backgroundColor: '#333', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalButtonText: { color: '#fff', fontWeight: '800' },
});
