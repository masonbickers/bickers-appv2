import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from 'react-native-vector-icons/Ionicons';

export default function Footer() {
  const router = useRouter();

  return (
    <View style={styles.footer}>
      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => router.push('/')} // ✅ usually Home is at '/index.js'
      >
        <Ionicons name="home-outline" size={22} color="#fff" />
        <Ionicons name="chevron-down-outline" size={14} color="#fff" style={styles.arrowIcon} />
        <Text style={styles.footerText}>Home</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => router.push('/tabs')}>
        <Ionicons name="grid-outline" size={22} color="#fff" />
        <Ionicons name="chevron-down-outline" size={14} color="#fff" style={styles.arrowIcon} />
        <Text style={styles.footerText}>Tabs</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => router.push('/work-diary')}>
        <Ionicons name="clipboard-outline" size={22} color="#fff" />
        <Ionicons name="chevron-down-outline" size={14} color="#fff" style={styles.arrowIcon} />
        <Text style={styles.footerText}>Work Diary</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => router.push('/settings')}>
        <Ionicons name="settings-outline" size={22} color="#fff" />
        <Ionicons name="chevron-down-outline" size={14} color="#fff" style={styles.arrowIcon} />
        <Text style={styles.footerText}>Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  tabButton: {
    alignItems: 'center',
  },
  footerText: {
    color: '#fff',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  arrowIcon: {
    marginTop: -4,
  },
});
