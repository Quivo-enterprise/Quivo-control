import AsyncStorage from '@react-native-async-storage/async-storage';

/** Sesión (`sesionId`) bajo la cual se emitió el `inicio_recorrido` del recorrido activo. Un
 * re-login a mitad del día crea una sesión NUEVA con el nativo ya corriendo: el re-enganche nunca
 * pasa por `iniciar()`, y sin este dato la sesión nueva queda sin `inicio_recorrido`. Se persiste
 * en AsyncStorage (no es sensible) para distinguir "re-login" de "reabrir la app". */
const CLAVE_SESION_RECORRIDO = 'quivo.sesion-recorrido.v1';

/** `true` si el re-enganche debe emitir `inicio_recorrido`: hay sesión guardada Y difiere de la
 * actual (re-login). Nunca guardada (`null`, p. ej. recorrido iniciado con un bundle previo a
 * este guardado) o misma sesión (app reabierta) NO re-emite: duplicarlo a mitad de vuelta puede
 * descuadrar la máquina de vueltas del servidor. */
export function debeReemitirInicio(guardada: string | null, actual: string): boolean {
  return guardada !== null && guardada !== actual;
}

/** Puede rechazar: quien llama trata el estado desconocido como "no re-emitir". */
export async function leerSesionRecorrido(): Promise<string | null> {
  return AsyncStorage.getItem(CLAVE_SESION_RECORRIDO);
}

export async function guardarSesionRecorrido(sesionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_SESION_RECORRIDO, sesionId);
  } catch {
    // Best-effort: sin persistir, un re-login posterior no re-emitiría el inicio.
  }
}

export async function borrarSesionRecorrido(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CLAVE_SESION_RECORRIDO);
  } catch {
    // Best-effort.
  }
}
