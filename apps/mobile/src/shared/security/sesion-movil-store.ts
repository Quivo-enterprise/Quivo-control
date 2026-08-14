import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  AuthConductorMovilResponseSchema,
  DeviceIdMovilSchema,
  type AuthConductorMovilResponse,
  type ContextoOperativoMovil,
  type RefreshMovilResponse,
} from '@quivo/shared';

const SESSION_KEY = 'quivo.mobile.session.v2';
const DEVICE_KEY = 'quivo.mobile.device.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export type SesionMovilGuardada = Extract<AuthConductorMovilResponse, { status: 'autenticado' }>;

export async function guardarSesionMovil(sesion: SesionMovilGuardada): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(sesion), OPTIONS);
}

export async function cargarSesionMovil(): Promise<SesionMovilGuardada | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS);
  if (!raw) return null;
  try {
    const parsed = AuthConductorMovilResponseSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || parsed.data.status !== 'autenticado') {
      await borrarSesionMovil();
      return null;
    }
    return parsed.data;
  } catch {
    await borrarSesionMovil();
    return null;
  }
}

export async function actualizarSesionMovil(
  actual: SesionMovilGuardada,
  tokens: RefreshMovilResponse,
  contexto: ContextoOperativoMovil = actual.contexto,
): Promise<SesionMovilGuardada> {
  const nueva: SesionMovilGuardada = {
    status: 'autenticado',
    ...tokens,
    contexto,
  };
  await guardarSesionMovil(nueva);
  return nueva;
}

export async function borrarSesionMovil(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
}

export async function obtenerDeviceIdMovil(): Promise<string> {
  const existente = await SecureStore.getItemAsync(DEVICE_KEY, OPTIONS);
  if (existente && DeviceIdMovilSchema.safeParse(existente).success) return existente;

  const nuevo = `android:${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(DEVICE_KEY, nuevo, OPTIONS);
  return nuevo;
}
