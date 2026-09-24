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
 * Punto 1/2 (`/codex-debug verify-fix` ronda 6, decisión del CTO: SIMPLIFICAR en vez de
 * parchear la migración de `quivo.mobile.session.v2`) — sin migración: el próximo APK cambia de
 * `applicationId` (`com.quivotech.conductor` → `com.quivotech.conductor.app`) por licencia, es
 * instalación limpia, y SecureStore es por app, así que esa clave legacy nunca va a existir acá.
 */
const CREDENCIALES_KEY = 'quivo.mobile.credenciales.v1';
const CONTEXTO_KEY = 'quivo.mobile.contexto.v1';
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

export async function guardarSesionMovil(sesion: SesionMovilGuardada): Promise<void> {
  const { credenciales, contexto } = partirCredencialesYContexto(sesion);
  await Promise.all([
    SecureStore.setItemAsync(CREDENCIALES_KEY, JSON.stringify(credenciales), OPTIONS),
    SecureStore.setItemAsync(CONTEXTO_KEY, JSON.stringify({ contexto }), OPTIONS),
  ]);
  // Punto 3 (verify-fix ronda 6): un login nuevo y exitoso supera cualquier intento de logout
  // que hubiera quedado "solicitado" (ver `marcarLogoutSolicitado`) para la sesión ANTERIOR —
  // sin esto, un reintento tardío de `intentarRevocacionesPendientes` podría terminar cerrando
  // esta sesión recién abierta. Riesgo residual aceptado (decisión del CTO): si esto ocurre, la
  // revocación server-side de la sesión vieja queda sin completar (nunca se llegó a leer su
  // refresh token bajo lease) — ver el docblock de `marcarLogoutSolicitado`.
  await borrarLogoutSolicitado();
}

export async function cargarSesionMovil(): Promise<SesionMovilGuardada | null> {
  const [rawCredenciales, rawContexto] = await Promise.all([
    SecureStore.getItemAsync(CREDENCIALES_KEY, OPTIONS),
    SecureStore.getItemAsync(CONTEXTO_KEY, OPTIONS),
  ]);
  if (!rawCredenciales || !rawContexto) {
    // Nunca hubo sesión (o quedó parcialmente escrita/borrada) — sin legacy que migrar (ver el
    // docblock de arriba), no hay ningún otro lugar donde buscarla.
    return null;
  }
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
  ]);
}

export async function obtenerDeviceIdMovil(): Promise<string> {
  const existente = await SecureStore.getItemAsync(DEVICE_KEY, OPTIONS);
  if (existente && DeviceIdMovilSchema.safeParse(existente).success) return existente;

  const nuevo = `android:${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(DEVICE_KEY, nuevo, OPTIONS);
  return nuevo;
}

const REVOCACIONES_PENDIENTES_KEY = 'quivo.mobile.revocaciones-pendientes.v1';

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO): `ejecutarLogout` (`use-auth-movil.ts`)
 * SIEMPRE borra la sesión local, incluso si la revocación de red falla (offline) — el chofer
 * espera que "cerrar sesión" limpie el teléfono YA. Pero eso no debe dejar la sesión abierta
 * del lado del servidor para siempre: si la revocación falló, se persiste ACÁ la intención (el
 * refresh token que había que revocar) para reintentarla en el próximo arranque con red o ciclo
 * de drenado — ver `intentarRevocacionesPendientes` en `use-auth-movil.ts`.
 *
 * Punto 4 (`/codex-debug verify-fix` ronda 6 — reemplaza el diseño de una sola clave):
 * `REVOCACION_PENDIENTE_KEY` guardaba UNA sola intención. Dos logouts offline seguidos (o uno
 * en reintento mientras otro recién se guarda — p. ej. rotación headless entre medio) se pisaban
 * entre sí: la segunda escritura sobre la misma clave borraba la primera sin haberla revocado
 * nunca, dejando esa sesión abierta server-side para siempre. Ahora es una COLECCIÓN indexada
 * por `derivarIdRevocacion` (hash del refresh token) — cada intención vive en su propia entrada,
 * y solo `borrarRevocacionPendientePorId` (nunca un borrado global) la descarta.
 */
export interface RevocacionPendienteGuardada {
  refreshToken: string;
  deviceId?: string;
  /** Intentos NO-red fallidos acumulados (un fallo de red no cuenta, se reintenta indefinido
   * hasta que haya conectividad) — ver `TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED`. */
  intentos: number;
}

type ColeccionRevocacionesPendientes = Record<string, RevocacionPendienteGuardada>;

function esRevocacionPendienteValida(valor: unknown): valor is RevocacionPendienteGuardada {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as Record<string, unknown>).refreshToken === 'string' &&
    typeof (valor as Record<string, unknown>).intentos === 'number'
  );
}

async function leerColeccionRevocacionesPendientes(): Promise<ColeccionRevocacionesPendientes> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(REVOCACIONES_PENDIENTES_KEY, OPTIONS);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const coleccion: ColeccionRevocacionesPendientes = {};
    for (const [id, valor] of Object.entries(parsed as Record<string, unknown>)) {
      if (esRevocacionPendienteValida(valor)) coleccion[id] = valor;
    }
    return coleccion;
  } catch {
    return {};
  }
}

async function escribirColeccionRevocacionesPendientes(
  coleccion: ColeccionRevocacionesPendientes,
): Promise<void> {
  if (Object.keys(coleccion).length === 0) {
    await SecureStore.deleteItemAsync(REVOCACIONES_PENDIENTES_KEY, OPTIONS).catch(() => {});
    return;
  }
  await SecureStore.setItemAsync(
    REVOCACIONES_PENDIENTES_KEY,
    JSON.stringify(coleccion),
    OPTIONS,
  );
}

/**
 * Punto 4 (verify-fix ronda 6): id estable derivado del refresh token — permite indexar varias
 * intenciones de revocación EN VUELO al mismo tiempo sin que una pise a la otra. SHA-256
 * truncado a 16 hex (64 bits): de sobra para no colisionar entre el puñado de intenciones que
 * puede haber pendientes a la vez en un solo dispositivo; no es uso criptográfico, solo una
 * clave estable derivada del contenido (mismo patrón que `sha256HexNativo` en
 * `features/perfil/rescate-dia1.ts`).
 */
async function derivarIdRevocacion(refreshToken: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, refreshToken);
  return hash.slice(0, 16);
}

/** Devuelve el id de la entrada escrita (derivado del `refreshToken`) — el caller lo necesita
 * para poder borrar DESPUÉS únicamente esa entrada (`borrarRevocacionPendientePorId`) sin
 * afectar ninguna otra intención que haya quedado pendiente en paralelo. */
export async function guardarRevocacionPendiente(
  revocacion: RevocacionPendienteGuardada,
): Promise<string> {
  const id = await derivarIdRevocacion(revocacion.refreshToken);
  const coleccion = await leerColeccionRevocacionesPendientes();
  coleccion[id] = revocacion;
  await escribirColeccionRevocacionesPendientes(coleccion);
  return id;
}

export async function listarRevocacionesPendientes(): Promise<
  Array<RevocacionPendienteGuardada & { id: string }>
> {
  const coleccion = await leerColeccionRevocacionesPendientes();
  return Object.entries(coleccion).map(([id, revocacion]) => ({ id, ...revocacion }));
}

export async function borrarRevocacionPendientePorId(id: string): Promise<void> {
  const coleccion = await leerColeccionRevocacionesPendientes();
  if (!(id in coleccion)) return;
  delete coleccion[id];
  await escribirColeccionRevocacionesPendientes(coleccion);
}

const LOGOUT_SOLICITADO_KEY = 'quivo.mobile.logout-solicitado.v1';

/**
 * Punto 3 (`/codex-debug verify-fix` ronda 6, gap 4 de Codex — decisión del CTO): marca durable
 * y mínima (sin token, sin datos de sesión) de que el chofer pidió cerrar sesión pero
 * `ejecutarLogout` no consiguió el lease `refresh-sesion` ni con margen (caso patológico) — sin
 * lease no se leyó nada todavía, así que acá no hay ningún refresh token que guardar. Sirve solo
 * para que `intentarRevocacionesPendientes` sepa que tiene que reintentar `ejecutarLogout`
 * completo en el próximo arranque/ciclo de drenado — si esa vez sí consigue el lease, retoma
 * desde leer la sesión (todavía intacta en disco, nunca se tocó sin el lease).
 */
export async function marcarLogoutSolicitado(): Promise<void> {
  await SecureStore.setItemAsync(LOGOUT_SOLICITADO_KEY, '1', OPTIONS);
}

export async function hayLogoutSolicitado(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(LOGOUT_SOLICITADO_KEY, OPTIONS)) !== null;
  } catch {
    return false;
  }
}

export async function borrarLogoutSolicitado(): Promise<void> {
  await SecureStore.deleteItemAsync(LOGOUT_SOLICITADO_KEY, OPTIONS).catch(() => {});
}
