// app/EmployeeListPage.tsx (or wherever this file lives)
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { db } from '../../firebaseConfig';

export default function EmployeeListPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'employees'));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = data.sort((a, b) =>
        (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
      );
      setEmployees(sorted);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;

    return employees.filter(emp => {
      const name = (emp.name || '').toLowerCase();
      const phone = (emp.mobile || '').toLowerCase();
      let titles = '';
      if (Array.isArray(emp.jobTitle)) {
        titles = emp.jobTitle.join(' ').toLowerCase();
      } else if (typeof emp.jobTitle === 'string') {
        titles = emp.jobTitle.toLowerCase();
      }
      return name.includes(q) || phone.includes(q) || titles.includes(q);
    });
  }, [employees, query]);

  /** ---------- Phone normalisers ---------- */
  const sanitizePhone = (raw) => {
    if (!raw) return '';
    const trimmed = String(raw).trim();
    const plus = trimmed.startsWith('+') ? '+' : '';
    const digits = trimmed.replace(/[^\d]/g, '');
    return plus + digits;
  };

  const toIntlNoPlusUK = (raw) => {
    if (!raw) return '';
    const only = String(raw).replace(/[^\d+]/g, '');

    if (only.startsWith('+44')) return only.slice(1);
    if (only.startsWith('44')) return only;
    if (only.startsWith('07')) return '44' + only.slice(1);
    if (only.startsWith('7')) return '44' + only;
    if (only.startsWith('+')) return only.slice(1);
    if (only.startsWith('0') && only.length > 1) return '44' + only.slice(1);
    return only.replace(/[^\d]/g, '');
  };

  /** ---------- Actions ---------- */
  const callNumber = async (raw) => {
    const num = sanitizePhone(raw);
    if (!num) {
      Alert.alert('No number', 'This contact does not have a phone number.');
      return;
    }
    const scheme = Platform.OS === 'ios' ? 'telprompt:' : 'tel:';
    const url = `${scheme}${num}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Cannot call', 'Calling is not supported on this device.');
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Error', 'Failed to start the call.');
      console.error(e);
    }
  };

  const messageWhatsApp = async (raw, name) => {
    const intlNoPlus = toIntlNoPlusUK(raw);
    if (!intlNoPlus) {
      Alert.alert('Invalid number', 'This number could not be formatted for WhatsApp.');
      return;
    }
    const text = encodeURIComponent(`Hi ${name || ''}`.trim());

    const appUrl = `whatsapp://send?phone=${intlNoPlus}&text=${text}`;
    const webUrl = `https://wa.me/${intlNoPlus}?text=${text}`;

    try {
      const hasApp = await Linking.canOpenURL('whatsapp://send?text=hello');
      if (hasApp) {
        await Linking.openURL(appUrl);
      } else {
        await Linking.openURL(webUrl);
      }
    } catch (e) {
      Alert.alert('Error', 'Unable to open WhatsApp.');
      console.error(e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header row with Upload button */}
          <View style={styles.headerRow}>
            <Text style={styles.header}>Employee Contacts</Text>

          </View>

          {/* Search bar */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, phone, or title…"
              placeholderTextColor="#7a7a7a"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
            />
            {query.length > 0 && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => setQuery('')}
                accessibilityLabel="Clear search"
              >
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {filtered.length === 0 ? (
            <Text style={styles.noData}>
              {query ? 'No matches found.' : 'No employees found.'}
            </Text>
          ) : (
            filtered.map(emp => {
              const initials = (emp.name || '')
                .split(' ')
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);

              const title =
                Array.isArray(emp.jobTitle)
                  ? emp.jobTitle.join(' · ')
                  : (emp.jobTitle || '');

              const phone = emp.mobile || '';
              const hasPhone = Boolean(toIntlNoPlusUK(phone));

              return (
                <View key={emp.id} style={styles.card}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials || '—'}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{emp.name || 'No Name'}</Text>
                    {!!title && <Text style={styles.meta}>{title}</Text>}

                    {/* Phone line is tappable to call */}
                    <TouchableOpacity
                      onPress={() => hasPhone && callNumber(phone)}
                      activeOpacity={hasPhone ? 0.7 : 1}
                    >
                      <Text style={[styles.meta, hasPhone && styles.link]}>
                        {phone || 'No Number'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Actions: Message + Call */}
                  <View style={styles.actionsCol}>
                    <TouchableOpacity
                      style={[styles.btn, hasPhone ? styles.msgBtn : styles.btnDisabled]}
                      onPress={() => hasPhone && messageWhatsApp(phone, emp.name)}
                      disabled={!hasPhone}
                    >
                      <Text style={styles.btnText}>Message</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.btn, hasPhone ? styles.callBtn : styles.btnDisabled]}
                      onPress={() => hasPhone && callNumber(phone)}
                      disabled={!hasPhone}
                    >
                      <Text style={styles.btnText}>Call</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={{ height: 16 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  header: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'left',
    marginBottom: 0,
    letterSpacing: 0.2,
  },
  uploaderBtn: {
    backgroundColor: '#C8102E',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#a40e25',
  },
  uploaderBtnText: { color: '#fff', fontWeight: '800' },

  // search
  searchRow: { position: 'relative', marginBottom: 12 },
  searchInput: {
    height: 44,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#fff',
  },
  clearBtn: {
    position: 'absolute',
    right: 8,
    top: 6,
    height: 32,
    width: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1f1f',
  },
  clearBtnText: { color: '#e5e5e5', fontSize: 14, fontWeight: '800' },

  // list card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#232323',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#222',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#333',
  },
  avatarText: { color: '#fff', fontWeight: '800' },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  meta: { color: '#cfcfcf', fontSize: 13, marginTop: 2 },
  link: { textDecorationLine: 'underline' },

  // actions
  actionsCol: { gap: 8, marginLeft: 6 },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 86,
  },
  btnText: { color: '#fff', fontWeight: '800' },
  callBtn: { backgroundColor: '#C8102E' },
  msgBtn: { backgroundColor: '#25D366' },
  btnDisabled: { backgroundColor: '#2a2a2a' },

  noData: { color: '#888', textAlign: 'center', marginTop: 16 },
});
