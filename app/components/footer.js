import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useColorScheme } from '../../hooks/useColorScheme'; // ✅ import theme hook

export default function Footer() {
  const router = useRouter();
  const { theme } = useColorScheme();
  const isDark = theme === 'dark';

  return (
    <View
      style={[
        styles.footer,
        { backgroundColor: isDark ? '#000' : '#fff', borderTopColor: isDark ? '#333' : '#ccc' },
      ]}
    >
      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => router.push('/screens/homescreen')}
      >
        <Ionicons
          name="home-outline"
          size={22}
          color={isDark ? '#fff' : '#000'}
        />
        <Ionicons
          name="chevron-down-outline"
          size={14}
          color={isDark ? '#fff' : '#000'}
          style={styles.arrowIcon}
        />
        <Text style={[styles.footerText, { color: isDark ? '#fff' : '#000' }]}>
          Home
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => router.push('/screens/schedule')}
      >
        <Ionicons
          name="clipboard-outline"
          size={22}
          color={isDark ? '#fff' : '#000'}
        />
        <Ionicons
          name="chevron-down-outline"
          size={14}
          color={isDark ? '#fff' : '#000'}
          style={styles.arrowIcon}
        />
        <Text style={[styles.footerText, { color: isDark ? '#fff' : '#000' }]}>
          Schedule
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => router.push('/settings')}
      >
        <Ionicons
          name="settings-outline"
          size={22}
          color={isDark ? '#fff' : '#000'}
        />
        <Ionicons
          name="chevron-down-outline"
          size={14}
          color={isDark ? '#fff' : '#000'}
          style={styles.arrowIcon}
        />
        <Text style={[styles.footerText, { color: isDark ? '#fff' : '#000' }]}>
          Settings
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  tabButton: {
    alignItems: 'center',
  },
  footerText: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  arrowIcon: {
    marginTop: -4,
  },
});
