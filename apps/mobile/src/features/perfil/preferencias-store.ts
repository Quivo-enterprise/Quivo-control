import * as SecureStore from 'expo-secure-store';

const PREFERENCIAS_KEY = 'quivo.mobile.preferencias.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface PreferenciasOperacion {
  navegacionVoz: boolean;
  registroAutomatico: boolean;
  ahorroDatos: boolean;
  trabajarOffline: boolean;
  textoGrande: boolean;
}

export const PREFERENCIAS_DEFAULT: PreferenciasOperacion = {
  navegacionVoz: true,
  registroAutomatico: true,
  ahorroDatos: false,
  trabajarOffline: true,
  textoGrande: false,
};

/** Ajustes de operación (QUI-263) — persistidos en el dispositivo vía SecureStore (mismo
 * mecanismo que la sesión móvil, ver `sesion-movil-store.ts`) en vez de sumar una dependencia
 * nueva (AsyncStorage) solo para 5 booleanos. No hay endpoint de servidor todavía
 * (`POST /v1/mobile/preferencias` es "opcional para MVP" según el ticket) — el guardado es
 * 100% local por ahora. */
export async function cargarPreferenciasOperacion(): Promise<PreferenciasOperacion> {
  const raw = await SecureStore.getItemAsync(PREFERENCIAS_KEY, OPTIONS);
  if (!raw) return PREFERENCIAS_DEFAULT;
  try {
    const parsed = JSON.parse(raw) as Partial<PreferenciasOperacion>;
    return { ...PREFERENCIAS_DEFAULT, ...parsed };
  } catch {
    return PREFERENCIAS_DEFAULT;
  }
}

export async function guardarPreferenciasOperacion(
  preferencias: PreferenciasOperacion,
): Promise<void> {
  await SecureStore.setItemAsync(PREFERENCIAS_KEY, JSON.stringify(preferencias), OPTIONS);
}
