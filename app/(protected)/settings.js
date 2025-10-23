import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useColorScheme } from '../../hooks/useColorScheme'; // custom hook

export default function SettingsPage() {
  const router = useRouter();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const { theme, toggleTheme } = useColorScheme();

  const isDark = theme === 'dark';

  const settings = [
    {
      group: 'Account',
      items: [
        { label: 'Edit Profile', icon: 'user', onPress: () => router.push('/edit-profile') },
        { label: 'Change Password', icon: 'lock', onPress: () => router.push('/change-password') },
      ],
    },
    {
      group: 'App',
      items: [
        { label: 'Notifications', icon: 'bell', type: 'toggle' },
        { label: 'Dark Mode', icon: 'moon', type: 'theme' }, // theme toggle
      ],
    },
    {
      group: 'Support',
      items: [
        { label: 'Help Centre', icon: 'info', onPress: () => router.push('/help') },
        { label: 'About', icon: 'info', onPress: () => router.push('/about') },
      ],
    },
  ];

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: isDark ? '#000' : '#fff' },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: isDark ? '#fff' : '#000' }]}>
          Settings
        </Text>

        {settings.map((section, idx) => (
          <View key={idx} style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: isDark ? '#aaa' : '#555' },
              ]}
            >
              {section.group}
            </Text>

            {section.items.map((item, index) => (
              <View
                key={index}
                style={[
                  styles.item,
                  {
                    backgroundColor: isDark ? '#1a1a1a' : '#f2f2f2',
                    borderColor: isDark ? '#2a2a2a' : '#e5e5e5',
                  },
                ]}
              >
                <View style={styles.itemLeft}>
                  <Icon
                    name={item.icon}
                    size={20}
                    color={isDark ? '#ccc' : '#555'}
                  />
                  <Text
                    style={[
                      styles.itemText,
                      { color: isDark ? '#fff' : '#000' },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>

                {item.type === 'toggle' ? (
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ false: '#444', true: '#C8102E' }}
                    thumbColor={notificationsEnabled ? '#fff' : '#888'}
                  />
                ) : item.type === 'theme' ? (
                  <Switch
                    value={isDark}
                    onValueChange={toggleTheme}
                    trackColor={{ false: '#444', true: '#0a7ea4' }}
                    thumbColor={isDark ? '#fff' : '#888'}
                  />
                ) : (
                  <TouchableOpacity onPress={item.onPress} accessibilityRole="button">
                    <Icon name="chevron-right" size={20} color={isDark ? '#888' : '#777'} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        ))}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 12 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
  item: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center' },
  itemText: { fontSize: 16, marginLeft: 10 },
});
