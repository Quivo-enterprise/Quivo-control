import BackgroundGeolocation from 'react-native-background-geolocation';
import { huboLecturaDeRecorridoActivo, marcarRecorridoActivoGlobal } from '../operacion/estado-recorrido-activo';
import { debeLeerEstadoNativo, lecturaDesdeEstadoNativo } from './actualizaciones-core';

/**
 * Establece una lectura REAL del estado del recorrido sin depender de que monte la pantalla de
 * operación (donde `useGpsOperativo` publica). Solo llama `getState()`: no `ready()`, no
 * `setConfig`, no `start()` (misma llamada que hace `useGpsOperativo` antes de `ready()`).
 * `enabled === true` -> activo; `false` -> inactivo. Si falla o el estado es ilegible, no
 * publica: queda "sin lectura" = tratado como activo (fail-safe). Si mientras tanto otro
 * publicó una lectura real, no la pisa.
 */
export async function leerEstadoRecorridoNativo(): Promise<void> {
  if (!debeLeerEstadoNativo(huboLecturaDeRecorridoActivo())) return;
  try {
    const lectura = lecturaDesdeEstadoNativo(await BackgroundGeolocation.getState());
    if (lectura === null) return;
    if (!debeLeerEstadoNativo(huboLecturaDeRecorridoActivo())) return;
    marcarRecorridoActivoGlobal(lectura);
  } catch {
    // Sin estado nativo: sin lectura -> activo.
  }
}
