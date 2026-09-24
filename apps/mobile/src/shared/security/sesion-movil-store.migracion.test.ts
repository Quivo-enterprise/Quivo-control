import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ContextoOperativoMovil } from '@quivo/shared';

/**
 * Puntos 1 y 2 (`/codex-debug verify-fix` sobre `75c1189`, decisión del CTO): cubre
 * `migrarSesionLegadaSiExiste` (la migración de `quivo.mobile.session.v2` a las dos claves
 * nuevas), ejercitada indirectamente a través de `cargarSesionMovil` (su único caller).
 *
 * - Punto 1: si CUALQUIERA de las dos escrituras nuevas falla, la legacy debe quedar INTACTA
 *   (nunca se borra en ese camino) y `cargarSesionMovil` debe poder seguir componiendo la
 *   sesión completa desde ella en vez de devolver `null`.
 * - Punto 2: la migración corre bajo el lease SQLite `refresh-sesion` (mockeado acá con un
 *   estado compartido simple que modela la exclusión real: solo un dueño a la vez) y, ya con el
 *   lease en mano, vuelve a chequear si las claves nuevas existen antes de escribir — nunca las
 *   pisa con lo que trae la legacy, sin importar qué tan vieja o nueva sea esta.
 */
const almacenFalso = vi.hoisted(() => new Map<string, string>());
const leaseCompartido = vi.hoisted(() => ({ ocupado: false }));

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  setItemAsync: vi.fn(async (clave: string, valor: string) => {
    almacenFalso.set(clave, valor);
  }),
  getItemAsync: vi.fn(async (clave: string) => almacenFalso.get(clave) ?? null),
  deleteItemAsync: vi.fn(async (clave: string) => {
    almacenFalso.delete(clave);
  }),
}));

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => randomUUID()) }));

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn(async () => ({})),
  adquirirLease: vi.fn(async () => {
    if (leaseCompartido.ocupado) return false;
    leaseCompartido.ocupado = true;
    return true;
  }),
  liberarLeaseConCooldown: vi.fn(async () => {
    leaseCompartido.ocupado = false;
  }),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 20_000,
}));

import {
  actualizarSesionMovil,
  cargarSesionMovil,
  guardarSesionMovil,
  type SesionMovilGuardada,
} from './sesion-movil-store';

/** Literal de `SESSION_KEY_LEGACY` (`sesion-movil-store.ts`) — no está exportado, así que este
 * archivo la reescribe directamente para poder sembrar/inspeccionar la legacy sin pasar por
 * `guardarSesionMovil` (que escribe SOLO en el formato nuevo). */
const SESSION_KEY_LEGACY = 'quivo.mobile.session.v2';
const CREDENCIALES_KEY = 'quivo.mobile.credenciales.v1';
const CONTEXTO_KEY = 'quivo.mobile.contexto.v1';

function contexto(): ContextoOperativoMovil {
  return {
    sesionId: randomUUID(),
    asignacion: {
      id: randomUUID(),
      fecha: '2026-09-23',
      horario: 'manana',
      venceAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    vehiculo: {
      id: randomUUID(),
      placa: '1234ABC',
      tipo: 'micro',
      marca: 'Toyota',
      modelo: 'Coaster',
    },
    conductor: { id: randomUUID(), nombre: 'Juan Pérez', documentoIdentidad: '1234567' },
    sindicato: { id: randomUUID(), nombre: 'Sindicato 1 de Mayo' },
    linea: { id: randomUUID(), codigo: '101', nombre: 'Línea 101', color: null },
    ruta: { id: randomUUID(), sentido: 'ida' },
  } as ContextoOperativoMovil;
}

function sesion(refreshToken: string, overrides: Partial<SesionMovilGuardada> = {}): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: `access-${refreshToken}-${'x'.repeat(32)}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken: `${refreshToken}-${'x'.repeat(32)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: contexto(),
    ...overrides,
  } as SesionMovilGuardada;
}

function tokensRefrescados(refreshTokenNuevo: string) {
  return {
    accessToken: `access-${refreshTokenNuevo}-${'x'.repeat(32)}`,
    refreshToken: `${refreshTokenNuevo}-${'x'.repeat(32)}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe('migrarSesionLegadaSiExiste (vía cargarSesionMovil) — puntos 1 y 2 (verify-fix)', () => {
  beforeEach(async () => {
    almacenFalso.clear();
    leaseCompartido.ocupado = false;
    const secureStore = await import('expo-secure-store');
    vi.mocked(secureStore.setItemAsync).mockImplementation(async (clave: string, valor: string) => {
      almacenFalso.set(clave, valor);
    });
  });

  it('migra la legacy completa cuando ninguna clave nueva existe todavía, y borra la legacy al terminar', async () => {
    const t0 = sesion('T0');
    almacenFalso.set(SESSION_KEY_LEGACY, JSON.stringify(t0));

    const resultado = await cargarSesionMovil();

    expect(resultado?.refreshToken).toBe(t0.refreshToken);
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(false);
    expect(almacenFalso.has(CREDENCIALES_KEY)).toBe(true);
    expect(almacenFalso.has(CONTEXTO_KEY)).toBe(true);
  });

  it('Punto 1: si la escritura de CONTEXTO_KEY falla, la legacy queda INTACTA y cargarSesionMovil compone la sesión completa desde ella igual', async () => {
    const t0 = sesion('T0');
    almacenFalso.set(SESSION_KEY_LEGACY, JSON.stringify(t0));

    const secureStore = await import('expo-secure-store');
    vi.mocked(secureStore.setItemAsync).mockImplementation(async (clave: string, valor: string) => {
      if (clave === CONTEXTO_KEY) {
        throw new Error('fallo simulado de escritura en SecureStore (CONTEXTO_KEY)');
      }
      almacenFalso.set(clave, valor);
    });

    const resultado = await cargarSesionMovil();

    // La sesión sigue siendo válida y completa — compuesta desde la legacy, no `null`.
    expect(resultado).not.toBeNull();
    expect(resultado?.refreshToken).toBe(t0.refreshToken);
    expect(resultado?.contexto).toEqual(t0.contexto);

    // La legacy NUNCA se borra si una escritura falló — es la red de recuperación.
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(true);
    // La escritura que SÍ pudo completarse (credenciales) no se pierde ni se reintenta de más.
    expect(almacenFalso.has(CREDENCIALES_KEY)).toBe(true);
    expect(almacenFalso.has(CONTEXTO_KEY)).toBe(false);
  });

  it('Punto 1: una migración fallida no bloquea el arranque — un segundo intento (ya sin el fallo simulado) completa la migración y recién ahí borra la legacy', async () => {
    const t0 = sesion('T0');
    almacenFalso.set(SESSION_KEY_LEGACY, JSON.stringify(t0));

    const secureStore = await import('expo-secure-store');
    let fallar = true;
    vi.mocked(secureStore.setItemAsync).mockImplementation(async (clave: string, valor: string) => {
      if (clave === CONTEXTO_KEY && fallar) {
        throw new Error('fallo simulado (una sola vez)');
      }
      almacenFalso.set(clave, valor);
    });

    const primerIntento = await cargarSesionMovil();
    expect(primerIntento?.refreshToken).toBe(t0.refreshToken);
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(true); // todavía intacta

    fallar = false;
    const segundoIntento = await cargarSesionMovil();

    expect(segundoIntento?.refreshToken).toBe(t0.refreshToken);
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(false); // recién ahora se borra
    expect(almacenFalso.has(CONTEXTO_KEY)).toBe(true);
  });

  it('Punto 2: una migración que llega DESPUÉS de que las claves nuevas ya reflejan una rotación (T1) nunca las pisa con la legacy vieja (T0) — T1 sobrevive', async () => {
    const t0 = sesion('T0');
    almacenFalso.set(SESSION_KEY_LEGACY, JSON.stringify(t0));

    // "Primera migración": corre de punta a punta (lease libre), migra T0 y borra la legacy.
    const primeraMigracion = await cargarSesionMovil();
    expect(primeraMigracion?.refreshToken).toBe(t0.refreshToken);
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(false);

    // Refresh CONCURRENTE (bajo el MISMO lease en producción — ver `ejecutarRefresh`,
    // `use-auth-movil.ts`): rota T0 -> T1.
    const tokensT1 = tokensRefrescados('T1');
    const rotada = await actualizarSesionMovil(primeraMigracion!, tokensT1);
    expect(rotada.refreshToken).toBe(tokensT1.refreshToken);
    const refreshTokenT1 = rotada.refreshToken;

    // Escenario del hallazgo (`/codex-debug verify-fix`): otro contexto JS había leído la
    // MISMA legacy (T0) en su propia copia de memoria ANTES de que la primera migración la
    // borrara, y recién ahora completa su propio intento de migración — se reinserta la
    // legacy vieja "a mano" para forzar exactamente ese caso (la legacy real ya fue borrada;
    // esto simula que ese segundo contexto todavía la tiene en su variable local `legado`).
    almacenFalso.set(SESSION_KEY_LEGACY, JSON.stringify(t0));

    const segundaMigracion = await cargarSesionMovil();

    // T1 sobrevive: el re-chequeo bajo el lease vio CREDENCIALES_KEY ya existente y NUNCA lo
    // pisó con T0, sin importar que la legacy (recién reinsertada) siga pareciendo "más nueva"
    // que lo que había antes.
    expect(segundaMigracion?.refreshToken).toBe(refreshTokenT1);
    // La legacy huérfana (ya sin nada que migrar) se limpia igual.
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(false);

    const enDiscoFinal = await cargarSesionMovil();
    expect(enDiscoFinal?.refreshToken).toBe(refreshTokenT1);
  });

  it('Punto 2: si el lease está ocupado (reentrancia con ejecutarRefresh/ejecutarLogout), la migración se difiere SIN bloquear — la legacy sigue intacta y cargarSesionMovil compone desde ella', async () => {
    const t0 = sesion('T0');
    almacenFalso.set(SESSION_KEY_LEGACY, JSON.stringify(t0));
    leaseCompartido.ocupado = true; // otro contexto (o el propio caller reentrante) lo tiene

    const resultado = await cargarSesionMovil();

    // No hay poll-wait: la llamada retorna de inmediato con la sesión compuesta desde la
    // legacy, sin haber escrito ni borrado nada.
    expect(resultado?.refreshToken).toBe(t0.refreshToken);
    expect(almacenFalso.has(SESSION_KEY_LEGACY)).toBe(true);
    expect(almacenFalso.has(CREDENCIALES_KEY)).toBe(false);
    expect(almacenFalso.has(CONTEXTO_KEY)).toBe(false);
  });

  it('sin legacy y sin claves nuevas (nunca hubo sesión), no toca el lease en absoluto y devuelve null', async () => {
    const outbox = await import('../../db/outbox');
    vi.mocked(outbox.abrirOutbox).mockClear();
    const resultado = await cargarSesionMovil();

    expect(resultado).toBeNull();
    expect(outbox.abrirOutbox).not.toHaveBeenCalled();
  });

  it('con las dos claves nuevas ya migradas (sin legacy), guardarSesionMovil/cargarSesionMovil siguen funcionando sin tocar el lease', async () => {
    const nueva = sesion('T-directo');
    await guardarSesionMovil(nueva);

    const outbox = await import('../../db/outbox');
    vi.mocked(outbox.abrirOutbox).mockClear();

    const resultado = await cargarSesionMovil();
    expect(resultado?.refreshToken).toBe(nueva.refreshToken);
    expect(outbox.abrirOutbox).not.toHaveBeenCalled();
  });
});
