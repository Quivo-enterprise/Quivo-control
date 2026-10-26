// Sin imports a propósito: este archivo también lo usa lógica pura (`features/mapa/estilo-ruta.ts`)
// que corre en vitest, y `@quivo/design-system-native` arrastra `react-native`. Los tokens y
// componentes del design system se toman de `./design-system`.

/**
 * Ritmo de burbujas de QUIVO Rutas (`--qv-bubble-*` y `--qv-control-touch-size` en `tokens.css`):
 * el relleno es igual a la separación entre controles y el radio interior es el radio menos el
 * relleno, para que las píldoras de dentro sigan la curva de la burbuja.
 */
export const quivoBubble = {
  touch: 44,
  padding: 8,
  gap: 8,
  radius: 30,
  innerRadius: 22,
  edge: 12,
  // Burbujas flotando sobre el mapa: superficie blanca y borde con el primario al 14 %
  // sobre `borderSubtle` (`--rutas-glass-border` de Rutas).
  // Opaca: en Android la `elevation` dibuja su sombra debajo y se ve a través de una superficie
  // translúcida como un rectángulo fantasma (en nativo no hay desenfoque de fondo que lo justifique).
  surface: '#FFFFFF',
  border: '#CCCCE3',
  scrim: 'rgba(15, 15, 20, 0.48)',
} as const;

export const quivoColors = {
  primary: '#3226B4',
  primaryStrong: '#3123C7',
  // `primary` oscurecido ~40 % — casing (borde) de la polilínea de navegación en el mapa.
  primaryDark: '#1E176C',
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
  // Familia "warning" (offline/almacenamiento casi lleno/etc.) — antes hardcodeada en varios
  // archivos (`next-control-sheet.tsx`, `offline-banner.tsx`, `operation-screen.tsx`) como
  // `#FF9500` / `#FFE5C5` / `#FFC480` / `#C96800` / `#8A4700` sueltos, sin token (QUI-348).
  warning: '#FF9500',
  warningSoft: '#FFE5C5',
  warningBorder: '#FFC480',
  warningStrong: '#C96800',
  warningText: '#8A4700',
  // Badge "sincronizando" del sheet de próximo control — antes `#E5F6FF`/`#99DBFF` sueltos.
  syncingSoft: '#E5F6FF',
  syncingBorder: '#99DBFF',
  // Azul informativo (nota de seguridad en el login del conductor) — antes `#E3F2FD` suelto.
  infoSoft: '#E3F2FD',
  // Navy del gradiente de splash / texto sobre `infoSoft` — antes `#0F1B5C`/`#1a2d7f` sueltos.
  navy: '#0F1B5C',
  navySoft: '#1a2d7f',
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
