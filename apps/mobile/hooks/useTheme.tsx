import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { Appearance, StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import {
  ColorSchemeName,
  ThemeColors,
  ThemeShadows,
  darkColors,
  lightColors,
  getShadows,
} from '@/constants/theme';

export interface Theme {
  scheme: ColorSchemeName;
  isDark: boolean;
  colors: ThemeColors;
  shadows: ThemeShadows;
}

/** User's appearance choice; 'system' follows the device setting. */
export type ThemePreference = 'system' | 'light' | 'dark';

const PREFERENCE_KEY = '@quo_theme_preference';

const THEMES: Record<ColorSchemeName, Theme> = {
  light: { scheme: 'light', isDark: false, colors: lightColors, shadows: getShadows('light') },
  dark: { scheme: 'dark', isDark: true, colors: darkColors, shadows: getShadows('dark') },
};

const ThemeContext = createContext<Theme>(THEMES.dark);
const PreferenceContext = createContext<{
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}>({ preference: 'system', setPreference: () => {} });

function applyPreference(preference: ThemePreference) {
  // Drives useColorScheme() and the native views (keyboard, date pickers,
  // system bars) together; 'unspecified' returns to the device setting.
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(PREFERENCE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') {
          setPreferenceState(stored);
          applyPreference(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyPreference(next);
    void AsyncStorage.setItem(PREFERENCE_KEY, next).catch(() => {});
  }, []);

  const theme = THEMES[systemScheme === 'light' ? 'light' : 'dark'];

  // Root view background shows during transitions and behind the keyboard.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {});
  }, [theme]);

  const preferenceValue = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return (
    <PreferenceContext.Provider value={preferenceValue}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </PreferenceContext.Provider>
  );
}

/** Active theme: colors, shadows and scheme. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** The user's appearance choice and a setter (Settings → Appearance). */
export function useThemePreference() {
  return useContext(PreferenceContext);
}

/**
 * Themed StyleSheet factory. Define once at module level, call the returned
 * hook inside the component:
 *
 *   const useStyles = makeStyles(({ colors }) => ({
 *     container: { backgroundColor: colors.background },
 *   }));
 *   function Screen() { const styles = useStyles(); ... }
 *
 * Styles are created once per scheme and cached.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: Theme) => T,
): () => T {
  const cache: Partial<Record<ColorSchemeName, T>> = {};
  return function useStyles() {
    const theme = useTheme();
    return (cache[theme.scheme] ??= StyleSheet.create(factory(theme)));
  };
}
