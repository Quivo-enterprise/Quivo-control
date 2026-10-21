import AsyncStorage from '@react-native-async-storage/async-storage';

/** Pausa del recorrido: el GPS sigue rastreando; solo se avisa al backend (`pausa_recorrido`).
 * Se persiste en AsyncStorage (no es un dato sensible) para sobrevivir al kill de la app. */
const CLAVE_PAUSA = 'quivo.pausa-recorrido.v1';

/** `desde` (ISO) si lo guardado es una pausa de ESTA sesión; si no, `null`. */
export function parsearPausa(crudo: string | null, sesionId: string): string | null {
  if (!crudo) return null;
  try {
    const v = JSON.parse(crudo) as { sesionId?: unknown; desde?: unknown };
    return v.sesionId === sesionId && typeof v.desde === 'string' && !Number.isNaN(Date.parse(v.desde))
      ? v.desde
      : null;
  } catch {
    return null;
  }
}

export async function leerPausa(sesionId: string): Promise<string | null> {
  try {
    return parsearPausa(await AsyncStorage.getItem(CLAVE_PAUSA), sesionId);
  } catch {
    return null;
  }
}

export async function guardarPausa(sesionId: string, desde: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_PAUSA, JSON.stringify({ sesionId, desde }));
  } catch {
    // Best-effort: sin persistir, tras un kill la app vuelve a mostrar PAUSAR (el backend manda).
  }
}

export async function borrarPausa(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CLAVE_PAUSA);
  } catch {
    // Best-effort.
  }
}
