import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Punto 4 (code review 2026-09-25): `guardarRevocacionPendiente`/`borrarRevocacionPendientePorId`
 * (`sesion-movil-store.ts`) hacían relectura+escritura de la colección de revocaciones
 * pendientes SIN ninguna sincronización — dos llamadas concurrentes (p. ej. `ejecutarLogout`
 * agregando una entrada nueva MIENTRAS `intentarRevocacionesPendientes` procesa/borra otra) se
 * pisaban: la segunda escritura, basada en una lectura vieja, podía perder la entrada que la
 * primera acababa de agregar. Fix: ambas mutaciones ahora corren bajo
 * `ID_LEASE_REVOCACIONES_PENDIENTES` (lease SQLite propio, NO `ID_LEASE_REFRESH_SESION` — ver
 * el porqué en el comentario de esa constante en `db/outbox.ts`: `ejecutarLogout` llama a
 * estas funciones mientras YA tiene tomado el lease de refresh, y reusarlo autobloquearía esa
 * escritura contra su propio dueño).
 *
 * Este archivo mockea `expo-secure-store` con un almacén falso (mismo patrón que
 * `sesion-movil-store.contexto.test.ts`) y `../../db/outbox` con un lease FALSO pero con
 * semántica real (un solo dueño a la vez, condicionado por token) para poder forzar el
 * intercalado exacto que el hallazgo describe.
 */
const almacenFalso = vi.hoisted(() => new Map<string, string>());
const leaseFalso = vi.hoisted(() => new Map<string, { owner: string; expiraAt: number }>());

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

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'device-uuid'),
  // Hash real (no un valor fijo): `derivarIdRevocacion` necesita ids DISTINTOS para refresh
  // tokens distintos — con un mock fijo, dos entradas distintas colisionarían en el mismo id.
  digestStringAsync: vi.fn(async (_algo: unknown, data: string) =>
    createHash('sha256').update(data).digest('hex'),
  ),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

// Sin mockear esto, `sesion-movil-store.ts` arrastra la dependencia nativa real de
// `@sentry/react-native` (que a su vez tira de `react-native`, que vitest/rollup no puede
// parsear sin el transform de Metro) — mismo motivo que en el resto de los archivos de este
// directorio.
vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// Lease FALSO con semántica real de `adquirirLease`/`liberarLeaseConCooldown` (un solo dueño a
// la vez, condicionado por `token` == owner) — necesario para que el test de intercalado de
// abajo pueda forzar contención real entre dos llamadas concurrentes.
vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn(
    async (_db: unknown, id: string, token: string, ahoraMs: number, ttlMs: number) => {
      const fila = leaseFalso.get(id);
      if (fila && fila.expiraAt > ahoraMs) return false;
      leaseFalso.set(id, { owner: token, expiraAt: ahoraMs + ttlMs });
      return true;
    },
  ),
  liberarLeaseConCooldown: vi.fn(
    async (_db: unknown, id: string, token: string, ahoraMs: number, cooldownMs: number) => {
      const fila = leaseFalso.get(id);
      if (!fila || fila.owner !== token) return;
      fila.expiraAt = ahoraMs + cooldownMs;
    },
  ),
  ID_LEASE_REVOCACIONES_PENDIENTES: 'revocaciones-pendientes',
  TTL_LEASE_REVOCACIONES_PENDIENTES_MS: 3_000,
}));

import {
  borrarRevocacionPendientePorId,
  guardarRevocacionPendiente,
  listarRevocacionesPendientes,
} from './sesion-movil-store';

describe('guardarRevocacionPendiente/borrarRevocacionPendientePorId — punto 4 (lease propio)', () => {
  beforeEach(() => {
    almacenFalso.clear();
    leaseFalso.clear();
  });

  it('guarda y lista una entrada nueva', async () => {
    const id = await guardarRevocacionPendiente({ refreshToken: 'refresh-A', intentos: 0 });

    const pendientes = await listarRevocacionesPendientes();

    expect(pendientes).toEqual([{ id, refreshToken: 'refresh-A', intentos: 0 }]);
  });

  it('borrar por id no afecta ninguna otra entrada', async () => {
    const idA = await guardarRevocacionPendiente({ refreshToken: 'refresh-A', intentos: 0 });
    const idB = await guardarRevocacionPendiente({ refreshToken: 'refresh-B', intentos: 0 });

    await borrarRevocacionPendientePorId(idA);

    const pendientes = await listarRevocacionesPendientes();
    expect(pendientes.map((p) => p.id)).toEqual([idB]);
  });

  /**
   * El caso concreto pedido por el code review: `ejecutarLogout` agrega R2 MIENTRAS una pasada
   * de `intentarRevocacionesPendientes` está a mitad de borrar P (ya adquirió el lease, ya leyó
   * la colección, todavía no escribió) → R2 no debe perderse.
   */
  it('intercalado: agregar R2 mientras una pasada borra P (ya con el lease tomado) — R2 sobrevive', async () => {
    const idP = await guardarRevocacionPendiente({ refreshToken: 'refresh-P', intentos: 0 });

    const secureStore = await import('expo-secure-store');
    const getItemAsyncMock = vi.mocked(secureStore.getItemAsync);
    const CLAVE_REVOCACIONES = 'quivo.mobile.revocaciones-pendientes.v1';

    // Pausa la LECTURA de la colección dentro del borrado de P — simula que esa pasada quedó
    // a mitad de su sección crítica, con el lease YA tomado (`adquirirLease` ya corrió, la
    // relectura todavía no).
    let liberarLecturaP!: () => void;
    const lecturaPBloqueada = new Promise<void>((resolve) => {
      liberarLecturaP = resolve;
    });
    let alcanzoLecturaP = false;
    let yaBloqueoUnaVez = false;
    getItemAsyncMock.mockImplementation(async (clave: string) => {
      if (clave === CLAVE_REVOCACIONES && !yaBloqueoUnaVez) {
        yaBloqueoUnaVez = true;
        alcanzoLecturaP = true;
        await lecturaPBloqueada;
      }
      return almacenFalso.get(clave) ?? null;
    });

    const promesaBorrarP = borrarRevocacionPendientePorId(idP);
    await vi.waitFor(() => expect(alcanzoLecturaP).toBe(true));

    // `ejecutarLogout` intenta agregar R2 mientras P sigue "colgado" bajo el lease — debe
    // quedar esperando el lease (reintentos internos), nunca perderse ni pisar la escritura
    // de P.
    const promesaGuardarR2 = guardarRevocacionPendiente({ refreshToken: 'refresh-R2', intentos: 0 });

    // Deja pasar un par de vueltas de reintento de R2 contra el lease todavía tomado por P,
    // para que el intercalado sea real y no un artefacto de orden de microtasks.
    await new Promise((resolve) => setTimeout(resolve, 200));

    liberarLecturaP();
    await promesaBorrarP;
    const idR2 = await promesaGuardarR2;

    const pendientes = await listarRevocacionesPendientes();
    const ids = pendientes.map((p) => p.id);
    expect(ids).not.toContain(idP); // P: borrado como se pidió
    expect(ids).toContain(idR2); // R2: sobrevive, nunca se perdió
  }, 10_000);
});
