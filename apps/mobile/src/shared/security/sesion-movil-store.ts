import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  AuthConductorMovilResponseSchema,
  DeviceIdMovilSchema,
  type AuthConductorMovilResponse,
  type ContextoOperativoMovil,
  type RefreshMovilResponse,
} from '@quivo/shared';

/**
 * G2 (hallazgo de `/codex-debug verify-fix` ronda 4, ALTO — reemplaza el diseño de una sola
 * clave combinada): `SESSION_KEY_LEGACY` guardaba credenciales (`accessToken`/`refreshToken`/
 * vencimientos) Y `contexto` en el MISMO objeto JSON. `actualizarContextoSesionMovil` releía
 * ese objeto completo y volvía a escribirlo completo con `contexto` nuevo — releer no lo hace
 * ATÓMICO: un refresh concurrente (bajo el lease `refresh-sesion`, `use-auth-movil.ts`) podía
 * persistir T1 EXACTAMENTE entre la relectura y la escritura de `actualizarContextoSesionMovil`,
 * y esa escritura pisaba el disco ENTERO con las credenciales VIEJAS (T0) que traía su copia en
 * memoria — perdiendo la rotación de T1 sin que nada la recupere.
 *
 * Fix: separar el almacenamiento en DOS claves independientes — `CREDENCIALES_KEY` (tokens y
 * vencimientos) y `CONTEXTO_KEY` (`contexto`, el resto del recorrido/asignación). Cada función
 * de escritura tiene UN solo dueño de escritura:
 * - `actualizarSesionMovil` (el camino de refresh) escribe SOLO `CREDENCIALES_KEY`.
 * - `actualizarContextoSesionMovil` escribe SOLO `CONTEXTO_KEY`.
 * Ninguna de las dos puede pisar a la otra sin importar el orden/intercalado — no hace falta
 * ningún lock adicional para este caso: el bug era enteramente un problema de una sola clave
 * compartida por dos escritores con información independiente.
 *
 * Migración transparente: `cargarSesionMovil` (el único punto de lectura) detecta si todavía
 * existe la clave vieja combinada y, de ser así, la divide en las dos nuevas UNA sola vez
 * (`migrarSesionLegadaSiExiste`, idempotente) antes de seguir. `guardarSesionMovil` (login
 * nuevo) escribe directamente en el formato nuevo y limpia cualquier resto de la clave vieja.
 */
const CREDENCIALES_KEY = 'quivo.mobile.credenciales.v1';
const CONTEXTO_KEY = 'quivo.mobile.contexto.v1';
const SESSION_KEY_LEGACY = 'quivo.mobile.session.v2';
const DEVICE_KEY = 'quivo.mobile.device.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export type SesionMovilGuardada = Extract<AuthConductorMovilResponse, { status: 'autenticado' }>;

type CredencialesGuardadas = Omit<SesionMovilGuardada, 'contexto'>;

function partirCredencialesYContexto(
  sesion: SesionMovilGuardada,
): { credenciales: CredencialesGuardadas; contexto: ContextoOperativoMovil } {
  const { contexto, ...credenciales } = sesion;
  return { credenciales, contexto };
}

/**
 * Divide la clave vieja combinada en las dos nuevas — solo si TODAVÍA no existe
 * `CREDENCIALES_KEY` (postcondición ya cumplida por otro contexto, o por un login/refresh que
 * corrió antes de que esta migración alcanzara a ejecutarse): en ese caso, la clave vieja queda
 * huérfana y solo hace falta borrarla, NUNCA pisar el estado nuevo (que puede ser más reciente
 * que lo que la clave vieja tenía guardado). Idempotente y best-effort: cualquier fallo de
 * lectura/parseo de la clave vieja se trata como "no hay nada que migrar", nunca bloquea el
 * arranque.
 */
async function migrarSesionLegadaSiExiste(): Promise<void> {
  let legado: string | null;
  try {
    legado = await SecureStore.getItemAsync(SESSION_KEY_LEGACY, OPTIONS);
  } catch {
    return;
  }
  if (!legado) return;
  try {
    const credencialesExistentes = await SecureStore.getItemAsync(CREDENCIALES_KEY, OPTIONS);
    if (!credencialesExistentes) {
      const parsed = AuthConductorMovilResponseSchema.safeParse(JSON.parse(legado) as unknown);
      if (parsed.success && parsed.data.status === 'autenticado') {
        const { credenciales, contexto } = partirCredencialesYContexto(parsed.data);
        await Promise.all([
          SecureStore.setItemAsync(CREDENCIALES_KEY, JSON.stringify(credenciales), OPTIONS),
          SecureStore.setItemAsync(CONTEXTO_KEY, JSON.stringify({ contexto }), OPTIONS),
        ]);
      }
    }
  } catch {
    // Best-effort: un legado corrupto no debe bloquear la migración — simplemente se descarta
    // (se borra más abajo) y `cargarSesionMovil` sigue con lo que haya (o no) en las claves
    // nuevas.
  } finally {
    await SecureStore.deleteItemAsync(SESSION_KEY_LEGACY, OPTIONS).catch(() => {});
  }
}

export async function guardarSesionMovil(sesion: SesionMovilGuardada): Promise<void> {
  const { credenciales, contexto } = partirCredencialesYContexto(sesion);
  await Promise.all([
    SecureStore.setItemAsync(CREDENCIALES_KEY, JSON.stringify(credenciales), OPTIONS),
    SecureStore.setItemAsync(CONTEXTO_KEY, JSON.stringify({ contexto }), OPTIONS),
  ]);
  // Login nuevo (o restauración completa) establece el formato nuevo de punta a punta — un
  // resto de la clave vieja acá solo podría ser basura de una instalación no migrada todavía.
  await SecureStore.deleteItemAsync(SESSION_KEY_LEGACY, OPTIONS).catch(() => {});
}

export async function cargarSesionMovil(): Promise<SesionMovilGuardada | null> {
  await migrarSesionLegadaSiExiste();
  const [rawCredenciales, rawContexto] = await Promise.all([
    SecureStore.getItemAsync(CREDENCIALES_KEY, OPTIONS),
    SecureStore.getItemAsync(CONTEXTO_KEY, OPTIONS),
  ]);
  if (!rawCredenciales || !rawContexto) return null;
  try {
    const credenciales = JSON.parse(rawCredenciales) as unknown;
    const { contexto } = JSON.parse(rawContexto) as { contexto: unknown };
    const combinado =
      typeof credenciales === 'object' && credenciales !== null
        ? { ...(credenciales as Record<string, unknown>), contexto }
        : null;
    const parsed = AuthConductorMovilResponseSchema.safeParse(combinado);
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
  // G2: escribe SOLO `CREDENCIALES_KEY` — jamás toca `CONTEXTO_KEY`. Es justo esta separación
  // la que hace que una rotación de refresh nunca pueda pisar (ni ser pisada por) una
  // actualización de contexto concurrente, sin importar el orden en que intercalen. Ver el
  // docblock de arriba.
  const credenciales: CredencialesGuardadas = { status: 'autenticado', ...tokens };
  await SecureStore.setItemAsync(CREDENCIALES_KEY, JSON.stringify(credenciales), OPTIONS);
  return { status: 'autenticado', ...tokens, contexto };
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
 * Fix (ronda 4, tras el hallazgo de que "releer + escribir el objeto completo" TAMPOCO era
 * atómico — Codex reprodujo una rotación intercalada EXACTAMENTE entre la relectura y la
 * escritura de esta función): en vez de perseguir un lock para volver atómico un
 * releer-fusionar-escribir sobre una sola clave, se separa el almacenamiento (ver el docblock
 * de arriba). Esta función SOLO escribe `CONTEXTO_KEY` — nunca `CREDENCIALES_KEY` — así que,
 * sin importar en qué momento exacto un refresh concurrente rote y persista, nunca hay nada que
 * pisar: los dos escritores tienen claves disjuntas.
 */
export async function actualizarContextoSesionMovil(
  contexto: ContextoOperativoMovil,
): Promise<SesionMovilGuardada | null> {
  const vigente = await cargarSesionMovil();
  if (!vigente) return null;
  await SecureStore.setItemAsync(CONTEXTO_KEY, JSON.stringify({ contexto }), OPTIONS);
  return { ...vigente, contexto };
}

export async function borrarSesionMovil(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CREDENCIALES_KEY, OPTIONS),
    SecureStore.deleteItemAsync(CONTEXTO_KEY, OPTIONS),
    SecureStore.deleteItemAsync(SESSION_KEY_LEGACY, OPTIONS),
  ]);
}

export async function obtenerDeviceIdMovil(): Promise<string> {
  const existente = await SecureStore.getItemAsync(DEVICE_KEY, OPTIONS);
  if (existente && DeviceIdMovilSchema.safeParse(existente).success) return existente;

  const nuevo = `android:${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(DEVICE_KEY, nuevo, OPTIONS);
  return nuevo;
}
