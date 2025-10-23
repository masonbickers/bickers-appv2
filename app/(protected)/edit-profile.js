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
import { auth, db } from '../../firebaseConfig';
// ⛔️ Removed: import Footer from '../components/footer';

export default function ProfilePage() {
  const router = useRouter();
  const employee = global.employee; // set at login
  const user = auth.currentUser;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
        setEmail(user?.email ?? data.email ?? '');
      } else if (user) {
        setName(user.displayName || '');
        setEmail(user.email || '');
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Icon name="arrow-left" size={22} color="#fff" />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>👤 My Profile</Text>

        <TextInput style={[styles.input, styles.lockedInput]} value={name} editable={false} />
        <TextInput style={[styles.input, styles.lockedInput]} value={email} editable={false} />
        <TextInput style={[styles.input, styles.lockedInput]} value={phone} editable={false} />
        <TextInput style={[styles.input, styles.lockedInput]} value={userCode} editable={false} />
      </ScrollView>

      {/* ⛔️ Removed page-level <Footer /> */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  backButton: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  backText: { color: '#fff', fontSize: 16, marginLeft: 6 },
  // Keep enough bottom padding so the global footer doesn’t overlap content
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
