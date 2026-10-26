import { Easing, Platform } from "react-native";

/**
 * QUIVO v3.0 design tokens, ported by hand from
 * packages/design-system/src/styles/tokens.css (the web source of truth).
 * CSS custom properties don't exist in React Native, so this is a plain
 * object mirror — keep it in sync manually when tokens.css changes.
 */

export type QuivoTheme = "light" | "dark";

export interface QuivoColors {
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  primarySubtle: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentHighlight: string;
  dark: string;
  white: string;
  black: string;
  navInk: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
  infoSoft: string;
  surfacePage: string;
  surfaceCard: string;
  surfaceSoft: string;
  surfaceRaised: string;
  surfaceSunken: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  textInverse: string;
  textOnPrimary: string;
  /** Morado de marca como texto, borde o icono: legible en claro y en oscuro. */
  primaryText: string;
  /** Texto sobre fondos de aviso o acento suaves. */
  warningText: string;
  borderSubtle: string;
  borderStrong: string;
}

export const colors: Record<QuivoTheme, QuivoColors> = {
  light: {
    primary: "#3226b4",
    primaryStrong: "#4f22d6",
    primarySoft: "#dcd9fb",
    primarySubtle: "#efeefc",
    accent: "#fd9e15",
    accentStrong: "#e88905",
    accentSoft: "#ffefd9",
    accentHighlight: "#ffa827",
    dark: "#1a1a2e",
    white: "#ffffff",
    black: "#101010",
    navInk: "#120a38",

    success: "#10b981",
    warning: "#fd9e15",
    danger: "#ef4444",
    info: "#3226b4",
    successSoft: "#ecfdf5",
    warningSoft: "#ffefd9",
    dangerSoft: "#fef2f2",
    infoSoft: "#efeefc",

    surfacePage: "#ffffff",
    surfaceCard: "#f8f9fa",
    surfaceSoft: "#f8f9fa",
    surfaceRaised: "#ffffff",
    surfaceSunken: "#eef0f2",

    textPrimary: "#0f0f14",
    textSecondary: "#333333",
    textTertiary: "#666666",
    textMuted: "#1a1a1a",
    textInverse: "#ffffff",
    textOnPrimary: "#ffffff",
    primaryText: "#3226b4",
    warningText: "#8a4f00",

    borderSubtle: "#e5e7eb",
    borderStrong: "#d1d5db",
  },
  dark: {
    primary: "#3226b4",
    primaryStrong: "#4f22d6",
    primarySoft: "#272357",
    primarySubtle: "#191733",
    accent: "#fd9e15",
    accentStrong: "#e88905",
    accentSoft: "#3a2b15",
    accentHighlight: "#ffa827",
    dark: "#e7e7f5",
    white: "#ffffff",
    black: "#101010",
    navInk: "#120a38",

    success: "#10b981",
    warning: "#fd9e15",
    danger: "#ef4444",
    info: "#3226b4",
    successSoft: "rgba(16, 185, 129, 0.16)",
    warningSoft: "rgba(253, 158, 21, 0.16)",
    dangerSoft: "rgba(239, 68, 68, 0.16)",
    infoSoft: "rgba(50, 38, 180, 0.16)",

    surfacePage: "#0b0b10",
    surfaceCard: "#1a1a24",
    surfaceSoft: "#1a1a24",
    surfaceRaised: "#212130",
    surfaceSunken: "#08080d",

    textPrimary: "#f5f7fb",
    textSecondary: "#cccccc",
    textTertiary: "#999999",
    textMuted: "#999999",
    textInverse: "#101010",
    textOnPrimary: "#ffffff",
    // color-mix(primary 45%, textPrimary) de tokens.css
    primaryText: "#9d99db",
    warningText: "#fd9e15",

    borderSubtle: "#2a2a3a",
    borderStrong: "#3a3a4a",
  },
};

export const space = {
  "2xs": 2,
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
  "4xl": 96,
  "5xl": 128,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
} as const;

export const fontWeight = {
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
} as const;

export const fontFamily = {
  display: Platform.select({ ios: "Oxanium", android: "Oxanium", default: "System" }),
  body: Platform.select({ ios: "Montserrat", android: "Montserrat", default: "System" }),
} as const;

/*
 * QUIVO Control (adaptación local, ver README del paquete): en Android una fuente cargada con
 * expo-font solo trae su variante normal, y pedir `fontWeight: "700"` sobre esa familia cae a la
 * fuente del sistema. Por eso el peso se elige por nombre de archivo (los que carga la app con
 * `@expo-google-fonts/*`) y `fontWeight` queda en "normal".
 */
const FAMILIA_POR_PESO = {
  display: {
    "300": "Oxanium_400Regular",
    "400": "Oxanium_400Regular",
    "500": "Oxanium_600SemiBold",
    "600": "Oxanium_600SemiBold",
    "700": "Oxanium_700Bold",
    "800": "Oxanium_700Bold",
  },
  body: {
    "300": "Montserrat_400Regular",
    "400": "Montserrat_400Regular",
    "500": "Montserrat_500Medium",
    "600": "Montserrat_600SemiBold",
    "700": "Montserrat_700Bold",
    "800": "Montserrat_700Bold",
  },
} as const;

/** Estilo de fuente para un tipo (`display` o `body`) y un peso de `fontWeight`. */
export function fontStyle(
  kind: keyof typeof FAMILIA_POR_PESO,
  weight: (typeof fontWeight)[keyof typeof fontWeight] = fontWeight.normal,
): { fontFamily: string; fontWeight: "normal" } {
  return { fontFamily: FAMILIA_POR_PESO[kind][weight], fontWeight: "normal" };
}

/** Animation durations in ms, mirroring `--qv-duration-*` in tokens.css. */
export const duration = {
  fast: 150,
  base: 220,
  slow: 350,
  slower: 500,
} as const;

/**
 * Easing curves, mirroring `--qv-ease-*` in tokens.css. Pair with `duration`
 * in `Animated.timing(value, { duration: duration.base, easing: easing.easeOut })`.
 * `--qv-transition-fast/base/slow` in tokens.css are just `duration.fast/base/slow`
 * paired with the CSS `ease` keyword — there's no dedicated RN equivalent for
 * that generic default curve, so it isn't ported as its own export.
 */
export const easing = {
  easeIn: Easing.bezier(0.4, 0, 1, 1),
  easeOut: Easing.bezier(0, 0, 0.2, 1),
  easeInOut: Easing.bezier(0.4, 0, 0.2, 1),
  spring: Easing.bezier(0.34, 1.56, 0.64, 1),
} as const;

/** Platform-appropriate shadow props for a given elevation level (1-4, matching the web's shadow scale). */
export function elevation(level: 1 | 2 | 3 | 4) {
  const config = {
    1: { ios: { opacity: 0.08, radius: 6, offset: 2 }, android: 2 },
    2: { ios: { opacity: 0.12, radius: 10, offset: 4 }, android: 4 },
    3: { ios: { opacity: 0.18, radius: 20, offset: 8 }, android: 8 },
    4: { ios: { opacity: 0.24, radius: 30, offset: 12 }, android: 12 },
  }[level];

  return Platform.select({
    android: { elevation: config.android },
    default: {
      shadowColor: "#1a1a2e",
      shadowOpacity: config.ios.opacity,
      shadowRadius: config.ios.radius,
      shadowOffset: { width: 0, height: config.ios.offset },
    },
  });
}
