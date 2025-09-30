import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useColorScheme as _useColorScheme } from 'react-native';

export function useColorScheme() {
  const systemTheme = _useColorScheme(); // "light" | "dark"
  const [theme, setTheme] = useState<'light' | 'dark'>(systemTheme || 'light');

  // Load saved theme preference
  useEffect(() => {
    AsyncStorage.getItem('theme').then((saved) => {
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
      }
    });
  }, []);

  // Toggle and persist theme
  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    await AsyncStorage.setItem('theme', newTheme);
  };

  return { theme, toggleTheme };
}
