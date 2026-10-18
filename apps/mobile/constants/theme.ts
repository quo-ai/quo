import type { ViewStyle } from 'react-native';

// Quo design tokens. Flat, calm brand style: electric indigo (#3B2EFF) and
// white, with a light and a dark palette that follow the device setting
// (overridable in Settings → Appearance). Components read the active
// palette through useTheme()/makeStyles() in hooks/useTheme.ts — never
// import a palette directly into a component.
//
// Contrast (WCAG): text tokens are ≥ 4.5:1 on `background` except
// textTertiary/textMuted (hints, disabled), and `onPrimary` on `primaryFill`
// is 7:1 in both schemes.

export type ColorSchemeName = 'light' | 'dark';

/** Brand constants that never change with the scheme (logo, store art). */
export const brand = {
  indigo: '#3B2EFF',
  white: '#FFFFFF',
};

export interface ThemeColors {
  // Surfaces
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceHover: string;
  /** Dimmed backdrop behind modals/sheets. */
  scrim: string;

  // Translucent layers (cards, chips, borders) over `background`
  glass: string;
  glassMedium: string;
  glassStrong: string;
  glassBorder: string;
  glassHighlight: string;
  glassShine: string;

  // Brand. `primary` is the accent for text, icons and outlines; filled
  // controls use `primaryFill` with `onPrimary` content.
  primary: string;
  primaryMuted: string;
  primaryGlow: string;
  primaryDim: string;
  primaryFill: string;
  onPrimary: string;

  // Premium accent (badges, paywall)
  secondary: string;
  secondaryMuted: string;
  secondaryGlow: string;

  accent: string;
  accentMuted: string;
  success: string;
  successMuted: string;
  successBorder: string;
  warning: string;
  warningMuted: string;
  warningBorder: string;
  error: string;
  errorMuted: string;
  errorBorder: string;

  // Text hierarchy
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;

  // Chat bubbles
  userBubble: string;
  userBubbleBorder: string;
  assistantBubble: string;
  assistantBubbleBorder: string;

  // Code blocks
  codeBackground: string;
  codeBorder: string;
  codeHeader: string;
  codeText: string;

  divider: string;
  dividerStrong: string;

  // High-emphasis inverted surface (toasts, remove-chips): dark on light, light on dark
  inverseSurface: string;
  onInverseSurface: string;
}

export const darkColors: ThemeColors = {
  background: '#000000',
  surface: '#0B0B12',
  surfaceElevated: '#14141D',
  surfaceHover: '#1C1C27',
  scrim: 'rgba(0, 0, 0, 0.7)',

  glass: 'rgba(255, 255, 255, 0.04)',
  glassMedium: 'rgba(255, 255, 255, 0.07)',
  glassStrong: 'rgba(255, 255, 255, 0.11)',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
  glassHighlight: 'rgba(255, 255, 255, 0.16)',
  glassShine: 'rgba(255, 255, 255, 0.22)',

  primary: '#8F87FF',
  primaryMuted: 'rgba(143, 135, 255, 0.14)',
  primaryGlow: 'rgba(143, 135, 255, 0.3)',
  primaryDim: '#6C63F5',
  primaryFill: '#3B2EFF',
  onPrimary: '#FFFFFF',

  secondary: '#C29BFF',
  secondaryMuted: 'rgba(194, 155, 255, 0.14)',
  secondaryGlow: 'rgba(194, 155, 255, 0.3)',

  accent: '#FF6B85',
  accentMuted: 'rgba(255, 107, 133, 0.12)',
  success: '#3DDC97',
  successMuted: 'rgba(61, 220, 151, 0.12)',
  successBorder: 'rgba(61, 220, 151, 0.35)',
  warning: '#FFC24B',
  warningMuted: 'rgba(255, 194, 75, 0.12)',
  warningBorder: 'rgba(255, 194, 75, 0.35)',
  error: '#FF6B85',
  errorMuted: 'rgba(255, 107, 133, 0.12)',
  errorBorder: 'rgba(255, 107, 133, 0.35)',

  textPrimary: '#FFFFFF',
  textSecondary: '#A3A3B5',
  textTertiary: '#74748A',
  textMuted: '#4E4E5E',

  userBubble: '#16152E',
  userBubbleBorder: 'rgba(143, 135, 255, 0.18)',
  assistantBubble: 'transparent',
  assistantBubbleBorder: 'transparent',

  codeBackground: '#0B0B12',
  codeBorder: 'rgba(255, 255, 255, 0.08)',
  codeHeader: '#12121A',
  codeText: '#E6E6F0',

  divider: 'rgba(255, 255, 255, 0.06)',
  dividerStrong: 'rgba(255, 255, 255, 0.12)',

  inverseSurface: '#E9E9F2',
  onInverseSurface: '#0E0E1A',
};

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F6F6FA',
  surfaceElevated: '#FFFFFF',
  surfaceHover: '#EEEEF4',
  scrim: 'rgba(14, 14, 26, 0.4)',

  glass: 'rgba(14, 14, 40, 0.03)',
  glassMedium: 'rgba(14, 14, 40, 0.05)',
  glassStrong: 'rgba(14, 14, 40, 0.08)',
  glassBorder: 'rgba(14, 14, 40, 0.10)',
  glassHighlight: 'rgba(14, 14, 40, 0.14)',
  glassShine: 'rgba(14, 14, 40, 0.18)',

  primary: '#3B2EFF',
  primaryMuted: 'rgba(59, 46, 255, 0.08)',
  primaryGlow: 'rgba(59, 46, 255, 0.2)',
  primaryDim: '#2A1FD6',
  primaryFill: '#3B2EFF',
  onPrimary: '#FFFFFF',

  secondary: '#7A3CF0',
  secondaryMuted: 'rgba(122, 60, 240, 0.08)',
  secondaryGlow: 'rgba(122, 60, 240, 0.2)',

  accent: '#D61F49',
  accentMuted: 'rgba(214, 31, 73, 0.08)',
  success: '#0A7F50',
  successMuted: 'rgba(10, 127, 80, 0.08)',
  successBorder: 'rgba(10, 127, 80, 0.3)',
  warning: '#9A6500',
  warningMuted: 'rgba(154, 101, 0, 0.08)',
  warningBorder: 'rgba(154, 101, 0, 0.3)',
  error: '#D61F49',
  errorMuted: 'rgba(214, 31, 73, 0.08)',
  errorBorder: 'rgba(214, 31, 73, 0.3)',

  textPrimary: '#0E0E1A',
  textSecondary: '#54546A',
  textTertiary: '#737388',
  textMuted: '#A3A3B5',

  userBubble: '#ECEBFF',
  userBubbleBorder: 'rgba(59, 46, 255, 0.12)',
  assistantBubble: 'transparent',
  assistantBubbleBorder: 'transparent',

  codeBackground: '#F6F6FA',
  codeBorder: 'rgba(14, 14, 40, 0.08)',
  codeHeader: '#EEEEF4',
  codeText: '#1C1C2E',

  divider: 'rgba(14, 14, 40, 0.06)',
  dividerStrong: 'rgba(14, 14, 40, 0.12)',

  inverseSurface: '#1C1C2E',
  onInverseSurface: '#FFFFFF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 28,
  full: 9999,
};

export const typography = {
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 26,
    xxxl: 32,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  lineHeights: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.7,
  },
};

export type ThemeShadows = Record<'glowPrimary' | 'glowSecondary' | 'glassInner' | 'elevated' | 'soft', ViewStyle>;

// Flat style: no neon glows. Elevation stays low on Android, where large
// elevations draw heavy dark shadows.
export function getShadows(scheme: ColorSchemeName): ThemeShadows {
  const isDark = scheme === 'dark';
  return {
    glowPrimary: {
      shadowColor: brand.indigo,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.25,
      shadowRadius: 12,
      elevation: 4,
    },
    glowSecondary: {
      shadowColor: isDark ? darkColors.secondary : lightColors.secondary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 4,
    },
    glassInner: {},
    elevated: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.6 : 0.12,
      shadowRadius: 24,
      elevation: isDark ? 12 : 8,
    },
    soft: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.4 : 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
  };
}

export const premium = {
  lockedOpacity: 0.6,
  badgeLockSize: 10,
  actionLockSize: 18,
};

export const animation = {
  fast: 150,
  normal: 250,
  slow: 400,
};
