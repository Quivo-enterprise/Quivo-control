import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  AuthConductorMovilResponseSchema,
  DeviceIdMovilSchema,
  type AuthConductorMovilResponse,
  type ContextoOperativoMovil,
  type RefreshMovilResponse,
} from '@quivo/shared';
import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  ID_LEASE_REFRESH_SESION,
  TTL_LEASE_REFRESH_SESION_MS,
} from '../../db/outbox';

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

/** Duplicado a propósito de `generarTokenLeaseRefresh` (`use-auth-movil.ts`) — mismo motivo que
 * esa duplicación (ver su comentario): no es un identificador criptográfico, solo distingue
 * intentos concurrentes de ESTE dispositivo bajo el lease `refresh-sesion`. Importarlo desde
 * `use-auth-movil.ts` crearía una dependencia circular real (ese módulo SÍ importa de este
 * archivo: `actualizarSesionMovil`, `cargarSesionMovil`, etc.). */
function generarTokenLeaseMigracion(): string {
  return `mig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Divide la clave vieja combinada en las dos nuevas.
 *
 * Punto 2 (`/codex-debug verify-fix`, decisión del CTO — reemplaza el diseño anterior, que
 * migraba con un simple leer-comprobar-escribir SIN exclusión): dos contextos podían leer que
 * faltaban las credenciales nuevas, uno migraba y un refresh concurrente rotaba encima, y el
 * otro terminaba su escritura demorada de la legacy pisando esa rotación. Ahora la migración
 * corre bajo el MISMO lease SQLite `refresh-sesion` que serializa `ejecutarRefresh`/
 * `ejecutarLogout` (`use-auth-movil.ts`) y, YA CON EL LEASE EN MANO, vuelve a chequear si las
 * claves nuevas existen antes de escribir nada — si existen (otro contexto migró, o un login/
 * refresh corrió mientras tanto), NUNCA se pisan con lo que trae la legacy, sin importar qué
 * tan vieja o nueva sea esta frente a ese valor. El relleno es POR CLAVE: si solo falta una de
 * las dos (p. ej. por un fallo de escritura parcial anterior, ver el `catch` de abajo), solo esa
 * se completa desde la legacy — la otra, si ya existe, queda intacta.
 *
 * UN SOLO intento de lease (sin poll-wait, a diferencia de `adquirirLeaseRefreshConEspera` de
 * `use-auth-movil.ts`): esta función es la única llamada por `cargarSesionMovil`, y
 * `cargarSesionMovil` a su vez se llama DESDE DENTRO del lease en `ejecutarRefresh`/
 * `ejecutarLogout` (releen disco ya con el lease tomado). Esperar ahí por el MISMO lease que el
 * propio caller ya tiene sería un auto-bloqueo — el caller nunca lo suelta hasta que esta
 * llamada retorne. Si el lease está ocupado (por el propio caller reentrante o por cualquier
 * otro contexto), la migración simplemente se difiere sin tocar nada: la legacy queda intacta
 * y el PRÓXIMO `cargarSesionMovil()` (se llama todo el tiempo, en casi cualquier flujo)
 * reintenta. Mientras tanto, `cargarSesionMovil` sigue pudiendo componer la sesión completa
 * DIRECTO desde la legacy (`componerSesionDesdeLegacy`, más abajo) — nunca devuelve `null` solo
 * porque la migración todavía no corrió.
 *
 * Punto 1 (verify-fix, decisión del CTO — reemplaza el `finally` anterior, que borraba la
 * legacy SIEMPRE, incluso si una de las dos escrituras nuevas fallaba): la legacy solo se borra
 * DESPUÉS de confirmar que las claves nuevas quedaron completas (ya existían, o se acaban de
 * escribir sin lanzar). Si cualquier escritura falla, se aborta sin borrar nada — perder la
 * legacy ahí perdería la ÚNICA copia completa de la sesión por un fallo transitorio.
 */
async function migrarSesionLegadaSiExiste(): Promise<void> {
  let legado: string | null;
  try {
    legado = await SecureStore.getItemAsync(SESSION_KEY_LEGACY, OPTIONS);
  } catch {
    return;
  }
  if (!legado) return;

  let db: Awaited<ReturnType<typeof abrirOutbox>>;
  try {
    db = await abrirOutbox();
  } catch {
    return;
  }
  const token = generarTokenLeaseMigracion();
  let obtuvoLease: boolean;
  try {
    obtuvoLease = await adquirirLease(
      db,
      ID_LEASE_REFRESH_SESION,
      token,
      Date.now(),
      TTL_LEASE_REFRESH_SESION_MS,
    );
  } catch {
    return;
  }
  if (!obtuvoLease) return;

  try {
    const [credencialesExistentes, contextoExistente] = await Promise.all([
      SecureStore.getItemAsync(CREDENCIALES_KEY, OPTIONS),
      SecureStore.getItemAsync(CONTEXTO_KEY, OPTIONS),
    ]);
    if (credencialesExistentes && contextoExistente) {
      // Ya migrado por otro contexto (o un login/refresh corrió antes de llegar acá) — la
      // legacy quedó huérfana, solo hace falta descartarla.
      await SecureStore.deleteItemAsync(SESSION_KEY_LEGACY, OPTIONS).catch(() => {});
      return;
    }

    let parsed: ReturnType<typeof AuthConductorMovilResponseSchema.safeParse> | undefined;
    try {
      parsed = AuthConductorMovilResponseSchema.safeParse(JSON.parse(legado) as unknown);
    } catch {
      parsed = undefined;
    }
    if (!parsed || !parsed.success || parsed.data.status !== 'autenticado') {
      // Legado corrupto, no parseable o no autenticado: no hay nada que migrar, se descarta.
      await SecureStore.deleteItemAsync(SESSION_KEY_LEGACY, OPTIONS).catch(() => {});
      return;
    }
    const { credenciales, contexto } = partirCredencialesYContexto(parsed.data);
    try {
      if (!credencialesExistentes) {
        await SecureStore.setItemAsync(CREDENCIALES_KEY, JSON.stringify(credenciales), OPTIONS);
      }
      if (!contextoExistente) {
        await SecureStore.setItemAsync(CONTEXTO_KEY, JSON.stringify({ contexto }), OPTIONS);
      }
    } catch {
      // Punto 1: si CUALQUIERA de las escrituras falla, la legacy queda INTACTA — nunca se
      // borra en este camino. `cargarSesionMovil` puede seguir componiendo la sesión completa
      // desde ella mientras tanto (`componerSesionDesdeLegacy`), y el próximo intento de
      // migración retoma desde acá (la clave que sí llegó a escribirse no se vuelve a tocar,
      // por el chequeo de arriba).
      return;
    }
    // Ambas claves nuevas confirmadas (ya existían, o se acaban de escribir sin lanzar): recién
    // ACÁ es seguro borrar la legacy.
    await SecureStore.deleteItemAsync(SESSION_KEY_LEGACY, OPTIONS).catch(() => {});
  } finally {
    await liberarLeaseConCooldown(db, ID_LEASE_REFRESH_SESION, token, Date.now(), 0).catch(
      () => {},
    );
  }
}

/**
 * Punto 1 (verify-fix, decisión del CTO): fallback de lectura cuando la migración no pudo
 * completar sus dos escrituras (una falló a mitad de camino, ver el `catch` de
 * `migrarSesionLegadaSiExiste`) y la legacy sigue intacta a propósito, o cuando la migración se
 * difirió por no conseguir el lease (reentrancia con `ejecutarRefresh`/`ejecutarLogout`, ver esa
 * misma función). En vez de que `cargarSesionMovil` devuelva `null` — perdiendo una sesión
 * perfectamente válida por un fallo transitorio de escritura o por contención del lease —
 * compone la sesión completa DIRECTO desde la legacy. No persiste ni borra nada acá: la
 * migración de verdad se reintenta en la PRÓXIMA llamada, bajo el lease, como siempre.
 */
async function componerSesionDesdeLegacy(): Promise<SesionMovilGuardada | null> {
  let legado: string | null;
  try {
    legado = await SecureStore.getItemAsync(SESSION_KEY_LEGACY, OPTIONS);
  } catch {
    return null;
  }
  if (!legado) return null;
  try {
    const parsed = AuthConductorMovilResponseSchema.safeParse(JSON.parse(legado) as unknown);
    if (!parsed.success || parsed.data.status !== 'autenticado') return null;
    return parsed.data;
  } catch {
    return null;
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
  if (!rawCredenciales || !rawContexto) {
    // Punto 1 (verify-fix): falta alguna de las dos claves nuevas — nunca hubo sesión, o la
    // migración quedó a mitad de camino (fallo de escritura) o se difirió (lease ocupado). Antes
    // de rendirse, se intenta componer desde la legacy — ver `componerSesionDesdeLegacy`.
    return await componerSesionDesdeLegacy();
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

const REVOCACION_PENDIENTE_KEY = 'quivo.mobile.revocacion-pendiente.v1';

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO): `ejecutarLogout` (`use-auth-movil.ts`)
 * SIEMPRE borra la sesión local, incluso si la revocación de red falla (offline) — el chofer
 * espera que "cerrar sesión" limpie el teléfono YA. Pero eso no debe dejar la sesión abierta
 * del lado del servidor para siempre: si la revocación falló, se persiste ACÁ la intención (el
 * refresh token que había que revocar) para reintentarla en el próximo arranque con red o ciclo
 * de drenado — ver `intentarRevocacionesPendientes` en `use-auth-movil.ts`.
 */
export interface RevocacionPendienteGuardada {
  refreshToken: string;
  deviceId?: string;
  /** Intentos NO-red fallidos acumulados (un fallo de red no cuenta, se reintenta indefinido
   * hasta que haya conectividad) — ver `TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED`. */
  intentos: number;
}

export async function guardarRevocacionPendiente(
  revocacion: RevocacionPendienteGuardada,
): Promise<void> {
  await SecureStore.setItemAsync(REVOCACION_PENDIENTE_KEY, JSON.stringify(revocacion), OPTIONS);
}

export async function leerRevocacionPendiente(): Promise<RevocacionPendienteGuardada | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(REVOCACION_PENDIENTE_KEY, OPTIONS);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).refreshToken === 'string' &&
      typeof (parsed as Record<string, unknown>).intentos === 'number'
    ) {
      return parsed as RevocacionPendienteGuardada;
    }
    return null;
  } catch {
    return null;
  }
}

export async function borrarRevocacionPendiente(): Promise<void> {
  await SecureStore.deleteItemAsync(REVOCACION_PENDIENTE_KEY, OPTIONS).catch(() => {});
}
