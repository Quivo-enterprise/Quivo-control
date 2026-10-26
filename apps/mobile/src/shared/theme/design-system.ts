// Puente de la app con `@quivo/design-system-native` (QUIVO Design System para React Native).
// Las pantallas importan de acá los tokens del design system; `quivo-theme.ts` queda para
// `quivoBubble` y para `quivoColors`, que se mantiene por compatibilidad mientras dura la migración
// al lenguaje de QUIVO Rutas (`docs/specs/movil-rediseno-rutas/`). La app solo tiene tema claro.
import { colors } from '@quivo/design-system-native';

export {
  space as dsSpace,
  radius as dsRadius,
  fontSize as dsFontSize,
  fontWeight as dsFontWeight,
  fontFamily as dsFontFamily,
  duration as dsDuration,
  easing as dsEasing,
  elevation as dsElevation,
} from '@quivo/design-system-native';

/** Colores del design system en tema claro, el único que usa la app. */
export const dsColors = colors.light;
