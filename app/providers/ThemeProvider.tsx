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
import { designTokens, type DesignTokens } from "../../lib/design/tokens";

const THEME_STORAGE_KEY = "bickers-theme-preference";

/* ---------- Types ---------- */
type Theme = "light" | "dark" | "system";
type ColorScheme = "light" | "dark";

type Colors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceElevated: string;
  border: string;
  text: string;
  textMuted: string;
  textOnAccent: string;
  primary: string;
  accent: string;
  accentSoft: string;
  danger: string;
  warning: string;
  success: string;
  inputBackground: string;
  inputBorder: string;
};

type ThemeContextValue = {
  theme: Theme;          // user preference
  colorScheme: ColorScheme; // effective scheme
  colors: Colors;
  tokens: DesignTokens;
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
      background: "#F4F7FA",
      surface: "#FFFFFF",
      surfaceAlt: "#E9EEF5",
      surfaceElevated: "#FFFFFF",
      border: "#D4DCE6",
      text: "#15202B",
      textMuted: "#5F6C7B",
      textOnAccent: "#FFFFFF",
      primary: "#ED1C25",
      accent: "#ED1C25",
      accentSoft: "#F8E6E7",
      danger: "#B42318",
      warning: "#B76800",
      success: "#157347",
      inputBackground: "#FFFFFF",
      inputBorder: "#C7D1DD",
    };
  }

  return {
    background: "#000000",
    surface: "#0B0B0C",
    surfaceAlt: "#151517",
    surfaceElevated: "#1D1D21",
    border: "#2B2B31",
    text: "#F5F5F5",
    textMuted: "#A1A1AA",
    textOnAccent: "#FFFFFF",
    primary: "#ED1C25",
    accent: "#ED1C25",
    accentSoft: "#3A1216",
    danger: "#ED1C25",
    warning: "#F2A93B",
    success: "#34C38F",
    inputBackground: "#111114",
    inputBorder: "#303038",
  };
}

/* ---------- Context ---------- */

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  colorScheme: "light",
  colors: buildColors("light"),
  tokens: designTokens,
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
      tokens: designTokens,
      setTheme,
      toggleTheme,
    }),
    [theme, colorScheme, colors, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/* ---------- Hook ---------- */

export const useTheme = () => useContext(ThemeContext);

// Expo Router treats every file inside app/ as a route.
// Keep a noop default export here so this provider module is not warned as invalid.
export default function ThemeProviderRouteShim() {
  return null;
}
