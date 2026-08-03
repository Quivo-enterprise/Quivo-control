export const quivoColors = {
  primary: '#3226B4',
  primaryStrong: '#3123C7',
  primarySoft: '#DCD9FB',
  primarySubtle: '#EFEEFC',
  accent: '#FD9E15',
  accentStrong: '#E0880A',
  accentSoft: '#FFEFD9',
  page: '#F1F1F8',
  card: '#FFFFFF',
  text: '#1A1A2E',
  textSecondary: '#4B4B6B',
  textMuted: '#9191B0',
  border: '#D9D9E8',
  success: '#16805D',
  successSoft: '#DDF4EA',
  danger: '#C53B4A',
  dangerSoft: '#FBE5E8',
  white: '#FFFFFF',
  blackOverlay: 'rgba(26, 26, 46, 0.12)',
  glassSurface: 'rgba(255, 255, 255, 0.76)',
  glassSurfaceStrong: 'rgba(255, 255, 255, 0.9)',
  glassBorder: 'rgba(255, 255, 255, 0.72)',
  glassDivider: 'rgba(50, 38, 180, 0.12)',
} as const;

export const quivoSpacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const quivoRadius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const quivoFonts = {
  displayRegular: 'Oxanium_400Regular',
  displaySemiBold: 'Oxanium_600SemiBold',
  displayBold: 'Oxanium_700Bold',
  bodyRegular: 'Montserrat_400Regular',
  bodyMedium: 'Montserrat_500Medium',
  bodySemiBold: 'Montserrat_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
} as const;
