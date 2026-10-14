import * as Sentry from '@sentry/react-native';

/** Falla de chequeo/descarga/reinicio de una actualización OTA (expo-updates). */
export function reportarErrorActualizacion(error: unknown, paso: 'check' | 'fetch' | 'reload'): void {
  Sentry.captureException(error, { tags: { contexto: 'actualizaciones', paso } });
}
