import { usePathname, useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useColorScheme } from '../../hooks/useColorScheme';

export default function Footer() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme } = useColorScheme();
  const isDark = theme === 'dark';

  const tabs = [
    { label: 'Home',     route: '/screens/homescreen', icon: 'home' },
    { label: 'Schedule', route: '/screens/schedule',   icon: 'calendar' },
    { label: 'Diary',    route: '/work-diary',         icon: 'document-text' },
    { label: 'Contacts', route: '/contacts',           icon: 'people' },
    // ⬇️ changed
    { label: 'Me',       route: '/me',                 icon: 'person-circle' },
  ];

  const accent = '#C8102E';
  const fg = isDark ? '#fff' : '#0f0f0f';
  const bg = isDark ? '#0A0A0A' : '#FFFFFF';
  const border = isDark ? '#202020' : '#E6E6E6';
  const muted = isDark ? '#A7A7A7' : '#6b6b6b';

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <View
        style={[
          styles.footer,
          {
            backgroundColor: bg,
            borderTopColor: border,
            shadowColor: '#000',
          },
        ]}
      >
        {tabs.map((t) => {
          const isActive =
            pathname === t.route || (t.route !== '/' && pathname?.startsWith(t.route));

          return (
            <TouchableOpacity
              key={t.route}
              style={styles.tab}
              activeOpacity={0.85}
              onPress={() => router.push(t.route)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t.label}
            >
              <View
                style={[
                  styles.indicator,
                  { backgroundColor: isActive ? accent : 'transparent' },
                ]}
              />
              <Ionicons
                name={`${t.icon}${isActive ? '' : '-outline'}`}
                size={22}
                color={isActive ? accent : fg}
                style={{ marginBottom: 4 }}
              />
              <Text
                style={[
                  styles.label,
                  { color: isActive ? accent : muted },
                ]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 6 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    marginHorizontal: 10,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 8,
    ...Platform.select({
      ios: { shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: -2 } },
      android: { elevation: 12 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  label: { fontSize: 10, fontWeight: '600' },
  indicator: { position: 'absolute', top: -8, width: 24, height: 3, borderRadius: 2 },
});
