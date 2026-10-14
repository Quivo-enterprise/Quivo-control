/**
 * Lógica pura de la fila "Versión" y del botón "Buscar actualización" (OTA con expo-updates).
 * Sin imports de React Native / expo para poder probarla con vitest.
 */

/** "0.1.0 · a1b2c3d4" con OTA aplicada, "0.1.0 · integrada" con el bundle del APK. */
export function etiquetaVersion(
  version: string | null | undefined,
  updateId: string | null | undefined,
  isEmbeddedLaunch: boolean,
): string {
  const v = version && version.length > 0 ? version : '—';
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
  if (entorno.isDev || !entorno.updatesHabilitado) {
    return { habilitado: false, motivo: 'No disponible en desarrollo' };
  }
  return { habilitado: true };
}

/**
 * Nunca se ofrece reiniciar con un recorrido/GPS operativo activo: `reloadAsync()` mataría la
 * JS en pleno turno. La actualización descargada se aplica sola al próximo arranque en frío.
 */
export function puedeReiniciarAhora(recorridoActivo: boolean): boolean {
  return !recorridoActivo;
}

export const MENSAJE_SE_APLICARA_AL_CERRAR = 'Se aplicará al cerrar la app';
