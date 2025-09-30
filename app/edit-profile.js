import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import Footer from './components/footer';
import { auth, db } from './firebaseConfig';

export default function ProfilePage() {
  const router = useRouter();
  const employee = global.employee; // ✅ set at login
  const user = auth.currentUser;

  const [name, setName] = useState('');
  const [email, setEmail] = useState(''); // will prefer auth email
  const [phone, setPhone] = useState('');
  const [userCode, setUserCode] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      if (!employee) return;

      const docRef = doc(db, 'employees', employee.id);
      const snap = await getDoc(docRef);

      if (snap.exists()) {
        const data = snap.data();
        setName(data.name || '');
        setPhone(data.phone || '');
        setUserCode(data.userCode || '');

        // ✅ Prefer Firebase Auth email if logged in
        if (user?.email) {
          setEmail(user.email);
        } else {
          setEmail(data.email || '');
        }
      } else if (user) {
        // fallback if no Firestore record
        setName(user.displayName || '');
        setEmail(user.email || '');
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* 🔙 Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Icon name="arrow-left" size={22} color="#fff" />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>👤 My Profile</Text>

        {/* Name */}
        <TextInput
          style={[styles.input, styles.lockedInput]}
          value={name}
          editable={false}
        />

        {/* Email (always from Firebase Auth if available) */}
        <TextInput
          style={[styles.input, styles.lockedInput]}
          value={email}
          editable={false}
        />

        {/* Phone (from Firestore) */}
        <TextInput
          style={[styles.input, styles.lockedInput]}
          value={phone}
          editable={false}
        />

        {/* User Code (read-only) */}
        <TextInput
          style={[styles.input, styles.lockedInput]}
          value={userCode}
          editable={false}
        />
      </ScrollView>

      <Footer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  backButton: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  backText: { color: '#fff', fontSize: 16, marginLeft: 6 },
  scrollContent: { padding: 16, paddingBottom: 100 },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    fontSize: 16,
  },
  lockedInput: {
    backgroundColor: '#333',
    color: '#888',
  },
});
