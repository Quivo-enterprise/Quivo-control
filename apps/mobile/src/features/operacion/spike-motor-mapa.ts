/**
 * Spike `ubicación fluida` (S2, `docs/plan-ubicacion-fluida.md`, Fase C): selección del motor de
 * mapa (`'leaflet'` de siempre vs `'google'`, el candidato del spike) — lógica pura, sin React ni
 * `process.env` leído más de una vez por caller, para poder testearla con `vitest`.
 *
 * Invariante (brief de esta tarea): "Fuera del spike, siempre Leaflet, cero cambio de
 * comportamiento" — por eso el default es SIEMPRE `'leaflet'`, incluso con el spike habilitado.
 * El toggle en caliente (`alternarMotorMapa`, solo montado en `operation-screen.tsx` detrás de
 * `EXPO_PUBLIC_SPIKE === '1'`) es la ÚNICA forma de pasar a `'google'` — nunca el arranque.
 */

export type MotorMapa = 'leaflet' | 'google';

export const MOTOR_MAPA_DEFAULT: MotorMapa = 'leaflet';

/** `true` solo con `EXPO_PUBLIC_SPIKE === '1'` — gatea tanto el toggle de motor como el overlay
 * de métricas S1 en `operation-screen.tsx`.
 *
 * IMPORTANTE: el default tiene que leer `process.env.EXPO_PUBLIC_SPIKE` de forma LITERAL y
 * estática. `babel-preset-expo` solo inlinea las variables `EXPO_PUBLIC_*` cuando el código
 * escribe exactamente `process.env.EXPO_PUBLIC_X`; un acceso indirecto (`env = process.env` y
 * luego `env.EXPO_PUBLIC_SPIKE`, o `process.env[nombre]`) no se reemplaza, y en el bundle release
 * `process.env` no trae la variable, así que devolvería siempre `false` (el toggle y el overlay
 * nunca aparecían en el APK). Un test (`env-publico-literal.test.ts`) vigila esta regla en todo
 * `src`. Función (no una constante de módulo) para que los tests puedan variar el valor pasando
 * el parámetro `valor`, sin depender de `process.env` global. */
export function spikeHabilitado(valor: string | undefined = process.env.EXPO_PUBLIC_SPIKE): boolean {
  return valor === '1';
}

/** Alterna entre los dos motores — `Leaflet ⇄ Google`. Pura: el componente que la usa es quien
 * decide cuándo llamarla (el botón de toggle del spike) y guarda el resultado en su propio
 * estado. */
export function alternarMotorMapa(actual: MotorMapa): MotorMapa {
  return actual === 'leaflet' ? 'google' : 'leaflet';
}

/** Etiqueta corta para el botón de toggle — el motor que se activaría al tocarlo (no el actual),
 * mismo criterio que un botón "cambiar a X". */
export function etiquetaMotorMapa(actual: MotorMapa): string {
  return actual === 'leaflet' ? 'Google' : 'Leaflet';
}
