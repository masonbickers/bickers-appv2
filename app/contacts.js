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
import Icon from 'react-native-vector-icons/Feather';
import Footer from './components/footer'; // ✅ make sure the path is correct
import { db } from "./firebaseConfig";

export default function EmployeeListPage() {
  const [employees, setEmployees] = useState([]);
  const router = useRouter();

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'employees'));
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      // ✅ sort alphabetically by name (case-insensitive)
      const sortedData = data.sort((a, b) =>
        (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
      );

      setEmployees(sortedData);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* 🔙 Back Button */}
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Icon name="arrow-left" size={22} color="#fff" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.header}>Employee Contacts</Text>

          {employees.length === 0 ? (
            <Text style={styles.noData}>No employees found.</Text>
          ) : (
            employees.map(emp => (
              <View key={emp.id} style={styles.card}>
                <Text style={styles.name}>{emp.name || 'No Name'}</Text>
                <Text style={styles.phone}>{emp.mobile || 'No Number'}</Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* ✅ Footer fixed at bottom */}
        <Footer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 80 }, // ✅ extra bottom padding for footer
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 6,
  },
  header: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  name: { color: '#fff', fontSize: 16, fontWeight: '600' },
  phone: { color: '#ccc', fontSize: 14, marginTop: 4 },
  noData: { color: '#888', textAlign: 'center', marginTop: 20 },
});
