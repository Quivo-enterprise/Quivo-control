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

/**
 * G2 (hallazgo de `/codex-debug verify-fix`, ALTO): `reconciliarSesion` (`use-auth-movil.ts`)
 * llamaba a `guardarSesionMovil({ ...copiaVieja, contexto })`, donde `copiaVieja` es la sesión
 * que ya tenía en memoria ANTES de `await authMovilApi.obtenerContexto(...)`. Si un refresh
 * concurrente (otro contexto JS, o el propio módulo bajo el lease de
 * `ID_LEASE_REFRESH_SESION`) rota y persiste T1 MIENTRAS ese `await` está en vuelo, ese
 * `guardarSesionMovil` pisaba el disco ENTERO con los tokens VIEJOS (T0) al volver — perdiendo
 * la rotación de T1 sin que nada la recupere: el próximo refresh vuelve a intentar con un T0
 * que el servidor ya invalidó.
 *
 * Fix: relee la sesión VIGENTE de disco (nunca la copia en memoria del caller) y fusiona SOLO
 * `contexto` — jamás toca `accessToken`/`refreshToken`/sus vencimientos. Sea cual sea la
 * antigüedad de la copia en memoria que disparó esta llamada, un refresh concurrente que ya
 * ganó la carrera queda intacto. Si no hay sesión en disco (logout concurrente), devuelve
 * `null` — el caller decide qué hacer (no hay nada que fusionar).
 */
export async function actualizarContextoSesionMovil(
  contexto: ContextoOperativoMovil,
): Promise<SesionMovilGuardada | null> {
  const vigente = await cargarSesionMovil();
  if (!vigente) return null;
  const actualizada: SesionMovilGuardada = { ...vigente, contexto };
  await guardarSesionMovil(actualizada);
  return actualizada;
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
