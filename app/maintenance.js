import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { app } from '../firebaseConfig'; // adjust path if needed
import Footer from './components/footer'; // adjust path if needed

export default function VehicleMaintenancePage() {
  const db = getFirestore(app);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'vehicles'));
        const vehicleList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Filter upcoming within next 30 days
        const today = new Date();
        const next30Days = new Date();
        next30Days.setDate(today.getDate() + 30);

        const upcoming = vehicleList.filter(
          (v) =>
            (v.motDate && new Date(v.motDate) <= next30Days) ||
            (v.serviceDate && new Date(v.serviceDate) <= next30Days)
        );

        setVehicles(upcoming);
      } catch (error) {
        console.error('Error fetching vehicles:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchVehicles();
  }, [db]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Upcoming Vehicle Maintenance</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#fff" style={{ marginTop: 20 }} />
        ) : vehicles.length === 0 ? (
          <Text style={styles.noItems}>✅ No upcoming maintenance in next 30 days</Text>
        ) : (
          vehicles.map((v) => (
            <View key={v.id} style={styles.card}>
              <Text style={styles.name}>{v.name || 'Unnamed Vehicle'}</Text>
              <Text style={styles.detail}>
                MOT Due: {v.motDate ? v.motDate : 'N/A'}
              </Text>
              <Text style={styles.detail}>
                Service Due: {v.serviceDate ? v.serviceDate : 'N/A'}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20, paddingBottom: 100 },
  header: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  noItems: {
    color: '#28a745',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
  },
  card: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  name: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  detail: { color: '#ccc', fontSize: 14, marginTop: 4 },
});
