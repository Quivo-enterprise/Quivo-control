/**
 * Lógica pura de las actualizaciones OTA (expo-updates): cuándo chequear, cuándo aplicar y
 * etiquetas de la pantalla Perfil. Sin imports de React Native / expo para probarla con vitest.
 *
 * Principio: la app NUNCA cambia de bundle ni se reinicia con un recorrido activo. "Inactivo"
 * exige una lectura REAL del estado del recorrido (`huboLectura`): sin ella, `recorridoActivo ===
 * false` es solo el valor inicial y se trata como ACTIVO (ver `estado-recorrido-activo.ts`).
 */
import {
  hayRecorridoActivoGlobal,
  huboLecturaDeRecorridoActivo,
} from '../operacion/estado-recorrido-activo';

/** Mínimo entre chequeos automáticos (arranque/foreground). */
export const INTERVALO_CHEQUEO_MS = 30 * 60 * 1000;

export const MENSAJE_SE_APLICARA_AL_CERRAR = 'Se aplicará al cerrar la app';

/** `true` solo si hubo una lectura real y esta dice que NO hay recorrido. */
export function recorridoInactivo(lectura: { hayActivo: boolean; huboLectura: boolean }): boolean {
  return lectura.huboLectura && !lectura.hayActivo;
}

/**
 * Mapea el estado nativo de `BackgroundGeolocation.getState()` a una lectura de recorrido:
 * `enabled === true` -> hay tracking nativo activo (recorrido activo); `enabled === false` -> no
 * hay. Cualquier otra cosa (estado ausente/malformado) -> `null`: no se publica nada y la app
 * sigue tratándose como ACTIVA (fail-safe). Misma semántica que `useGpsOperativo`.
 */
export function lecturaDesdeEstadoNativo(estado: { enabled?: unknown } | null | undefined): boolean | null {
  if (!estado) return null;
  if (estado.enabled === true) return true;
  if (estado.enabled === false) return false;
  return null;
}

/** ¿Hay que leer el estado nativo? Solo si todavía no existe ninguna lectura real. */
export function debeLeerEstadoNativo(huboLectura: boolean): boolean {
  return !huboLectura;
}

/** Al llegar una publicación de estado: reintentar solo si es inactivo y la app está en primer plano. */
export function debeReintentarTrasPublicacion(hayActivo: boolean, appState: string): boolean {
  return !hayActivo && appState === 'active';
}

/** Condición para fetch/reload: recorrido inactivo (lectura real) y app en primer plano. */
export function puedeOperarOtaAhora(e: { inactivo: boolean; appState: string }): boolean {
  return e.inactivo && e.appState === 'active';
}

/** Lectura EN VIVO (no capturada en un closure) del estado compartido del recorrido. */
export function estaInactivoAhora(): boolean {
  return recorridoInactivo({
    hayActivo: hayRecorridoActivoGlobal(),
    huboLectura: huboLecturaDeRecorridoActivo(),
  });
}

export interface EntornoChequeo {
  /** `__DEV__` || `!Updates.isEnabled`. */
  actualizacionesDisponibles: boolean;
  inactivo: boolean;
  enCurso: boolean;
  ahora: number;
  /** Timestamp del último chequeo iniciado, o null si nunca. */
  ultimoChequeo: number | null;
  intervaloMs?: number;
}

/** ¿Hay que consultar el servidor ahora? Solo con la app inactiva, sin otro chequeo en curso. */
export function debeChequear(e: EntornoChequeo): boolean {
  if (!e.actualizacionesDisponibles || !e.inactivo || e.enCurso) return false;
  if (e.ultimoChequeo === null) return true;
  const intervalo = e.intervaloMs ?? INTERVALO_CHEQUEO_MS;
  // Reloj retrocedido: tratar como "ya pasó" evita quedar bloqueado para siempre.
  if (e.ahora < e.ultimoChequeo) return true;
  return e.ahora - e.ultimoChequeo >= intervalo;
}

/**
 * ¿Se puede llamar a `reloadAsync()` ahora? Requiere sin recorrido Y una pantalla pre-operación
 * libre (login/selección de asignación y no cargando). Se reevalúa justo antes de recargar.
 */
export function puedeAplicarAhora(e: {
  inactivo: boolean;
  pantallaPreOperacionLibre: boolean;
}): boolean {
  return e.inactivo && e.pantallaPreOperacionLibre;
}

/** Etapas de auth de `useAuthMovil` que son pantallas pre-operación (antes de iniciar jornada). */
export function esPantallaPreOperacion(etapa: string, cargando: boolean): boolean {
  return (etapa === 'vehiculo' || etapa === 'asignacion') && !cargando;
}

/** "0.2.0 · a1b2c3d4" con OTA aplicada, "0.2.0 · integrada" con el bundle del APK. */
export function etiquetaVersion(
  versionApk: string | null | undefined,
  updateId: string | null | undefined,
  isEmbeddedLaunch: boolean,
): string {
  const v = versionApk && versionApk.length > 0 ? versionApk : '—';
  const sufijo = isEmbeddedLaunch || !updateId ? 'integrada' : updateId.slice(0, 8);
  return `${v} · ${sufijo}`;
}

export type EstadoBotonActualizar =
  | { habilitado: true }
  | { habilitado: false; motivo: string };

export function estadoBotonActualizar(entorno: {
  isDev: boolean;
  updatesHabilitado: boolean;
}): EstadoBotonActualizar {
  if (entorno.isDev) return { habilitado: false, motivo: 'No disponible en desarrollo' };
  if (!entorno.updatesHabilitado) {
    return { habilitado: false, motivo: 'Actualizaciones desactivadas en esta versión' };
  }
  return { habilitado: true };
}
