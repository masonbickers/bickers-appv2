// providers/ThemeProvider.tsx
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
import { designTokens, type DesignTokens } from "../lib/design/tokens";

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
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
  focusRing: string;
  inputBackground: string;
  inputBorder: string;
  link: string;
  disabled: string;
  disabledText: string;
  overlay: string;
  mediaBackdrop: string;
  pressed: string;
  selected: string;
  divider: string;
  navigationSurface: string;
  navigationSelected: string;
  navigationBorder: string;
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
  forcedTheme?: ColorScheme;
}

/* ---------- Helpers ---------- */

function buildColors(scheme: ColorScheme): Colors {
  if (scheme === "light") {
    return {
      background: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceAlt: "#F2F3F5",
      surfaceElevated: "#FFFFFF",
      border: "#D8DCE2",
      text: "#15202B",
      textMuted: "#5F6C7B",
      textOnAccent: "#FFFFFF",
      primary: "#ED1C25",
      accent: "#ED1C25",
      accentSoft: "#F8E6E7",
      danger: "#B42318",
      dangerSoft: "#FEE2E2",
      warning: "#B76800",
      warningSoft: "#FEF3C7",
      success: "#157347",
      successSoft: "#DCFCE7",
      info: "#1D4ED8",
      infoSoft: "#DBEAFE",
      focusRing: "#1D4ED8",
      inputBackground: "#FFFFFF",
      inputBorder: "#C7D1DD",
      link: "#B42318",
      disabled: "#E5E7EB",
      disabledText: "#6B7280",
      overlay: "rgba(21, 32, 43, 0.48)",
      mediaBackdrop: "#000000",
      pressed: "#E4E7EB",
      selected: "#F8E6E7",
      divider: "#D4DCE6",
      navigationSurface: "rgba(255, 255, 255, 0.78)",
      navigationSelected: "#D9DADD",
      navigationBorder: "rgba(99, 99, 102, 0.34)",
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
    dangerSoft: "#3B1212",
    warning: "#F2A93B",
    warningSoft: "#33280C",
    success: "#34C38F",
    successSoft: "#112A1B",
    info: "#60A5FA",
    infoSoft: "#14213D",
    focusRing: "#93C5FD",
    inputBackground: "#111114",
    inputBorder: "#303038",
    link: "#FF6B72",
    disabled: "#27272A",
    disabledText: "#A1A1AA",
    overlay: "rgba(0, 0, 0, 0.68)",
    mediaBackdrop: "#000000",
    pressed: "#54191E",
    selected: "#3A1216",
    divider: "#2B2B31",
    navigationSurface: "rgba(18, 18, 20, 0.78)",
    navigationSelected: "rgba(174, 174, 178, 0.28)",
    navigationBorder: "rgba(199, 199, 204, 0.34)",
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

export function ThemeProvider({ children, forcedTheme }: ThemeProviderProps) {
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

  const colorScheme: ColorScheme = forcedTheme || (theme === "system" ? systemScheme : theme);

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
