import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ContextoOperativoMovil } from '@quivo/shared';

/**
 * G2 (hallazgo de `/codex-debug verify-fix`, ALTO): `reconciliarSesion` (`use-auth-movil.ts`)
 * llamaba a `guardarSesionMovil({ ...copiaVieja, contexto })` con una copia en memoria tomada
 * ANTES de `await authMovilApi.obtenerContexto(...)`. Si un refresh concurrente rotaba y
 * persistía T1 MIENTRAS ese `await` estaba en vuelo, ese `guardarSesionMovil` pisaba el disco
 * entero con los tokens VIEJOS (T0). Este archivo testea `actualizarContextoSesionMovil`
 * (`sesion-movil-store.ts`) contra un SecureStore FALSO (no mockea `cargarSesionMovil`/
 * `guardarSesionMovil` en sí — son las funciones bajo prueba, y necesitan ejercitar la
 * relectura REAL de disco para probar que preservan una rotación concurrente).
 */
const almacenFalso = vi.hoisted(() => new Map<string, string>());

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
  randomUUID: vi.fn(() => randomUUID()),
  digestStringAsync: vi.fn(async () => 'a'.repeat(64)),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

// Punto 4 (code review 2026-09-25): `sesion-movil-store.ts` ahora importa `@sentry/react-native`
// y `../../db/outbox` (lease propio para la colección de revocaciones pendientes) — sin
// mockearlos acá, el import de este módulo arrastra la dependencia nativa real de
// `@sentry/react-native` (que a su vez tira de `react-native`, que vitest/rollup no puede
// parsear sin el transform de Metro). Mismo motivo que el resto de los archivos de este
// directorio que mockean `db/outbox`.
vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  ID_LEASE_REVOCACIONES_PENDIENTES: 'revocaciones-pendientes',
  TTL_LEASE_REVOCACIONES_PENDIENTES_MS: 3_000,
}));

import {
  actualizarContextoSesionMovil,
  actualizarSesionMovil,
  cargarSesionMovil,
  guardarSesionMovil,
  type SesionMovilGuardada,
} from './sesion-movil-store';

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
    linea: {
      id: randomUUID(),
      codigo: '101',
      nombre: 'Línea 101',
      color: null,
    },
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

describe('actualizarContextoSesionMovil — G2 (verify-fix): nunca pisa tokens rotados por un refresh concurrente', () => {
  beforeEach(() => {
    almacenFalso.clear();
  });

  it('relee disco (no la copia en memoria del caller) y fusiona SOLO el contexto nuevo', async () => {
    const original = sesion('T0');
    await guardarSesionMovil(original);

    const contextoNuevo = contexto();
    const resultado = await actualizarContextoSesionMovil(contextoNuevo);

    expect(resultado).not.toBeNull();
    expect(resultado?.contexto).toEqual(contextoNuevo);
    expect(resultado?.accessToken).toBe(original.accessToken);
    expect(resultado?.refreshToken).toBe(original.refreshToken);

    const enDisco = await cargarSesionMovil();
    expect(enDisco?.contexto).toEqual(contextoNuevo);
    expect(enDisco?.refreshToken).toBe(original.refreshToken);
  });

  it('un refresh que rota a T1 MIENTRAS obtenerContexto está en vuelo no se pierde — el bug real de G2', async () => {
    // T0 en disco, como si `reconciliarSesion` acabara de leerlo antes de empezar
    // `authMovilApi.obtenerContexto(...)` (el `await` largo que dispara la carrera).
    const t0 = sesion('T0');
    await guardarSesionMovil(t0);

    // Mientras esa llamada está "en vuelo", un refresh CONCURRENTE (otro contexto JS, o el
    // mismo bajo el lease `refresh-sesion`) rota y persiste T1 — vía `actualizarSesionMovil`,
    // el ÚNICO camino que debe tocar tokens.
    const tokensRotados = {
      accessToken: `access-T1-${'x'.repeat(32)}`,
      refreshToken: `T1-${'x'.repeat(32)}`,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const rotada = await actualizarSesionMovil(t0, tokensRotados);
    expect(rotada.refreshToken).toBe(tokensRotados.refreshToken);

    // Ahora "termina" la llamada de contexto que arrancó con la copia VIEJA (t0) en memoria —
    // el bug viejo hacía `guardarSesionMovil({ ...t0, contexto: nuevoContexto })` acá, pisando
    // T1 con T0. El fix relee disco DENTRO de `actualizarContextoSesionMovil`, así que nunca ve
    // `t0` para nada más que decidir qué NO tocar.
    const nuevoContexto = contexto();
    const resultado = await actualizarContextoSesionMovil(nuevoContexto);

    expect(resultado?.refreshToken).toBe(tokensRotados.refreshToken); // T1 preservado
    expect(resultado?.accessToken).toBe(tokensRotados.accessToken);
    expect(resultado?.contexto).toEqual(nuevoContexto);

    const enDisco = await cargarSesionMovil();
    expect(enDisco?.refreshToken).toBe(tokensRotados.refreshToken); // disco también preservó T1
  });

  it('sin sesión en disco (logout concurrente), devuelve null sin escribir nada', async () => {
    const resultado = await actualizarContextoSesionMovil(contexto());
    expect(resultado).toBeNull();
    expect(await cargarSesionMovil()).toBeNull();
  });

  /**
   * G2 ronda 4 (hallazgo de `/codex-debug verify-fix`, ALTO): Codex reprodujo que "releer +
   * escribir el objeto completo" tampoco es atómico — una rotación puede terminar de rotar y
   * persistir EXACTAMENTE entre la relectura y la escritura de `actualizarContextoSesionMovil`,
   * y el test anterior (arriba) solo cubría una rotación COMPLETADA antes de que la relectura
   * arrancara. Este test fuerza esa ventana exacta con un `setItemAsync` controlado a mano: deja
   * avanzar la lectura de `actualizarContextoSesionMovil` con normalidad, pero pausa
   * específicamente su ESCRITURA (la clave `quivo.mobile.contexto.v1`) hasta después de que una
   * rotación concurrente (`actualizarSesionMovil`) corra de punta a punta.
   */
  it('G2 (verify-fix ronda 4, caso reportado por Codex): una rotación que corre EXACTAMENTE entre la lectura y la escritura de actualizarContextoSesionMovil no se pierde', async () => {
    const secureStore = await import('expo-secure-store');
    const setItemAsyncMock = vi.mocked(secureStore.setItemAsync);
    const CLAVE_CONTEXTO = 'quivo.mobile.contexto.v1';

    const t0 = sesion('T0');
    await guardarSesionMovil(t0);

    let liberarEscrituraContexto!: () => void;
    const escrituraContextoBloqueada = new Promise<void>((resolve) => {
      liberarEscrituraContexto = resolve;
    });
    let alcanzoEscrituraContexto = false;
    setItemAsyncMock.mockImplementation(async (clave: string, valor: string) => {
      if (clave === CLAVE_CONTEXTO) {
        alcanzoEscrituraContexto = true;
        await escrituraContextoBloqueada;
      }
      almacenFalso.set(clave, valor);
    });

    try {
      const nuevoContexto = contexto();
      const promesaContexto = actualizarContextoSesionMovil(nuevoContexto);

      // Deja que `actualizarContextoSesionMovil` avance hasta quedar PARADO justo en su
      // escritura (ya leyó T0 en memoria) — el hueco exacto que el diseño de una sola clave
      // combinada dejaba abierto.
      await vi.waitFor(() => expect(alcanzoEscrituraContexto).toBe(true));

      // Mientras el contexto sigue "en vuelo", una rotación CONCURRENTE corre de punta a punta
      // — su escritura usa OTRA clave (`quivo.mobile.credenciales.v1`), así que el gate de
      // arriba no la afecta en absoluto.
      const tokensRotados = {
        accessToken: `access-T1-${'x'.repeat(32)}`,
        refreshToken: `T1-${'x'.repeat(32)}`,
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      const rotada = await actualizarSesionMovil(t0, tokensRotados);
      expect(rotada.refreshToken).toBe(tokensRotados.refreshToken);

      // Recién ahora se libera la escritura de contexto, que arrancó con T0 en su copia en
      // memoria (`vigente`) — el bug viejo hubiera pisado T1 con esa copia al escribir.
      liberarEscrituraContexto();
      const resultado = await promesaContexto;

      expect(resultado?.contexto).toEqual(nuevoContexto);
      // El valor de RETORNO de `actualizarContextoSesionMovil` refleja lo que leyó AL EMPEZAR
      // (T0 — la lectura corrió ANTES de que la rotación existiera, a propósito, para forzar
      // el hueco exacto). Eso es aceptable: nadie asume que ese retorno sea la sesión más
      // fresca posible, y `use-auth-movil.ts` ya maneja esto (`actualizada ?? actual.sesion`,
      // seguido por el próximo `obtenerAccessToken`/reconciliación). LA PROPIEDAD QUE CIERRA
      // G2 DE VERDAD es la del DISCO, no la del valor de retorno — ver `enDisco` abajo.
      expect(resultado?.refreshToken).toBe(t0.refreshToken);

      const enDisco = await cargarSesionMovil();
      expect(enDisco?.refreshToken).toBe(tokensRotados.refreshToken);
      expect(enDisco?.contexto).toEqual(nuevoContexto);
    } finally {
      // Restaura el mock genérico para no afectar otros tests de este archivo.
      setItemAsyncMock.mockImplementation(async (clave: string, valor: string) => {
        almacenFalso.set(clave, valor);
      });
    }
  });
});
