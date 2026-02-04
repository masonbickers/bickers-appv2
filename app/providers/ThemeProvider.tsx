// app/providers/ThemeProvider.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { Appearance } from "react-native";

const THEME_STORAGE_KEY = "bickers-theme-preference";

/* ---------- Types ---------- */
type Theme = "light" | "dark" | "system";
type ColorScheme = "light" | "dark";

type Colors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  danger: string;
  success: string;
  inputBackground: string;
  inputBorder: string;
};

type ThemeContextValue = {
  theme: Theme;          // user preference
  colorScheme: ColorScheme; // effective scheme
  colors: Colors;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

interface ThemeProviderProps {
  children: ReactNode;
}

/* ---------- Helpers ---------- */

function buildColors(scheme: ColorScheme): Colors {
  if (scheme === "light") {
    return {
      background: "#ffffff",
      surface: "#FFFFFF",
      surfaceAlt: "#F3F4F6",
      border: "#E5E7EB",
      text: "#202020ff",
      textMuted: "#7d7d7dff",
      accent: "#ED1C24",
      accentSoft: "#E0F2FE",
      danger: "#ED1C24",
      success: "#16A34A",
      inputBackground: "#FFFFFF",
      inputBorder: "#d9d9d9ff",
    };
  }

  // True black dark mode
  return {
    background: "#000000",
    surface: "#000000",
    surfaceAlt: "#111111",
    border: "#262626",
    text: "#FFFFFF",
    textMuted: "#A3A3A3",
    accent: "#ED1C24",
    accentSoft: "#404040ff",
    danger: "#ED1C24",
    success: "#22C55E",
    inputBackground: "#000000",
    inputBorder: "#262626",
  };
}

/* ---------- Context ---------- */

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  colorScheme: "light",
  colors: buildColors("light"),
  setTheme: () => {},
  toggleTheme: () => {},
});

/* ---------- Provider ---------- */

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemScheme, setSystemScheme] = useState<ColorScheme>(
    Appearance.getColorScheme() === "dark" ? "dark" : "light"
  );

  // Load stored preference
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") {
          setThemeState(stored);
        }
      } catch (err) {
        console.warn("Failed to load theme preference", err);
      }
    })();
  }, []);

  // Watch system theme
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === "dark" ? "dark" : "light");
    });
    return () => {
      // Appearance.addChangeListener returns { remove: fn } on native
      // @ts-ignore
      sub?.remove?.();
    };
  }, []);

  const colorScheme: ColorScheme = theme === "system" ? systemScheme : theme;

  const colors = useMemo(() => buildColors(colorScheme), [colorScheme]);

  // Set theme & persist (synchronous state, async fire-and-forget storage)
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch((err) =>
      console.warn("Failed to save theme preference", err)
    );
  }, []);

  // Toggle between light/dark, ignoring "system"
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch((err) =>
        console.warn("Failed to save theme preference", err)
      );
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      colorScheme,
      colors,
      setTheme,
      toggleTheme,
    }),
    [theme, colorScheme, colors, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/* ---------- Hook ---------- */

export const useTheme = () => useContext(ThemeContext);
