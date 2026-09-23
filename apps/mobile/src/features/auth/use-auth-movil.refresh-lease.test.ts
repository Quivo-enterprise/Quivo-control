import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * G1 (hallazgo de `/codex-debug verify-fix`, ALTO): `use-auth-movil.refrescar.test.ts` cubre
 * la reconciliación DENTRO de un mismo contexto JS (`refrescosEnVuelo`, en memoria) — pero
 * foreground y headless son contextos JS DISTINTOS en Android, cada uno con su PROPIO
 * `refrescosEnVuelo`, así que ese single-flight no los cubre entre sí. El fix (`ejecutarRefresh`
 * en `use-auth-movil.ts`) serializa el tramo releer→decidir→refrescar→persistir bajo el lease
 * SQLite `ID_LEASE_REFRESH_SESION` (`db/outbox.ts`), que SÍ cruza contextos.
 *
 * Este archivo simula DOS runtimes con `vi.resetModules()` + `import()` dinámico. Solo los
 * módulos REALES (no mockeados) se re-evalúan frescos en cada reimport — confirmado
 * empíricamente: `vi.mock(...)` factories quedan MEMOIZADAS entre `resetModules()`, un módulo
 * real no. Eso es EXACTAMENTE lo que hace falta acá, sin ningún truco extra:
 * - `use-auth-movil.ts` (real, bajo prueba) → cada import da un `refrescosEnVuelo` NUEVO, como
 *   dos contextos JS Android que nunca comparten memoria.
 * - `refresh-circuit-breaker.ts` (real, importado transitivamente) → cada runtime obtiene su
 *   PROPIO circuito, igual que en producción (su docblock: "estado en un módulo, NO en SQLite").
 * - `sesion-movil-store.ts` y `db/outbox.ts` (mockeados acá) → quedan COMPARTIDOS entre los dos
 *   imports, tal como el SecureStore real y el archivo `sync_lease.db` SÍ son compartidos entre
 *   contextos JS distintos en el dispositivo real. `authMovilApi` (mockeado) también queda
 *   compartido — correcto: solo hay UN servidor de verdad del otro lado.
 */
const compartido = vi.hoisted(() => ({
  sesionEnDisco: null as unknown,
  lease: null as { owner: string; expiraAt: number } | null,
}));

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

vi.mock('../../shared/api/auth-movil-api', () => ({
  authMovilApi: { refresh: vi.fn() },
  AuthMovilApiError: class AuthMovilApiError extends Error {
    constructor(
      public readonly kind: string,
      message: string,
      public readonly status?: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('../../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(async (actual: any, tokens: any, contexto = actual.contexto) => {
    const nueva = { status: 'autenticado', ...tokens, contexto };
    compartido.sesionEnDisco = nueva;
    return nueva;
  }),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(async () => compartido.sesionEnDisco),
  guardarSesionMovil: vi.fn(async (s: unknown) => {
    compartido.sesionEnDisco = s;
  }),
  obtenerDeviceIdMovil: vi.fn(),
}));

// Fake mínimo del mecanismo de `db/outbox.ts`: una fila de lease compartida (igual que la fila
// real de `sync_lease` en SQLite, un solo archivo .db compartido entre contextos JS). El
// `owner`/`expiraAt` reproducen la semántica de `adquirirLease`/`liberarLeaseConCooldown`
// reales: libre si no hay dueño o si `expiraAt <= ahoraMs`.
vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn(async () => ({})),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 20_000,
  adquirirLease: vi.fn(
    async (_db: unknown, _id: string, token: string, ahoraMs: number, ttlMs: number) => {
      if (compartido.lease && compartido.lease.expiraAt > ahoraMs) return false;
      compartido.lease = { owner: token, expiraAt: ahoraMs + ttlMs };
      return true;
    },
  ),
  liberarLeaseConCooldown: vi.fn(
    async (_db: unknown, _id: string, token: string, ahoraMs: number, cooldownMs: number) => {
      if (compartido.lease?.owner === token) {
        compartido.lease = { owner: token, expiraAt: ahoraMs + cooldownMs };
      }
    },
  ),
  // G1 ronda 4: `renovarLease` es el MISMO UPDATE condicionado por `owner` que
  // `liberarLeaseConCooldown` (ver `db/outbox.ts`) — reproduce esa semántica de compare-and-set
  // sobre la fila de lease compartida en memoria de este fake.
  renovarLease: vi.fn(
    async (_db: unknown, _id: string, token: string, ahoraMs: number, ttlMs: number) => {
      if (compartido.lease?.owner !== token) return false;
      compartido.lease = { owner: token, expiraAt: ahoraMs + ttlMs };
      return true;
    },
  ),
}));

import { authMovilApi } from '../../shared/api/auth-movil-api';
import type { SesionMovilGuardada } from '../../shared/security/sesion-movil-store';

function sesion(refreshToken: string): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: 'access-vieja',
    accessTokenExpiresAt: new Date(0).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {} as SesionMovilGuardada['contexto'],
  } as SesionMovilGuardada;
}

function tokensRefrescados(refreshTokenNuevo: string) {
  return {
    accessToken: `access-${refreshTokenNuevo}`,
    refreshToken: refreshTokenNuevo,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;

describe('ejecutarRefresh — G1 (verify-fix): lease SQLite serializa el refresh entre DOS runtimes/contextos JS', () => {
  beforeEach(() => {
    compartido.sesionEnDisco = null;
    compartido.lease = null;
    refreshMock.mockReset();
  });

  it('foreground y headless leen T0 al mismo tiempo: solo UNO de los dos toca la red — el que pierde la carrera por el lease adopta T1 de disco', async () => {
    const t0 = sesion('T0');
    compartido.sesionEnDisco = t0;

    // Barrera: `use-auth-movil.ts` (real, no mockeado) da un `refrescosEnVuelo` NUEVO en cada
    // reimport tras `resetModules()` — dos "contextos JS" que nunca se ven entre sí en memoria,
    // exactamente como foreground/headless en Android.
    vi.resetModules();
    const runtimeA = await import('./use-auth-movil');

    vi.resetModules();
    const runtimeB = await import('./use-auth-movil');

    // No sabemos (ni debe importar) cuál de los dos gana la carrera por el lease compartido —
    // eso es un detalle de timing, no la propiedad que este test verifica. Lo que SÍ debe
    // cumplirse pase lo que pase: la red (`authMovilApi.refresh`, mock COMPARTIDO entre los
    // dos runtimes — hay un solo servidor real del otro lado) se toca UNA sola vez con 'T0'.
    let llamadasRed = 0;
    let resolverPrimeraLlamada!: (t: ReturnType<typeof tokensRefrescados>) => void;
    refreshMock.mockImplementation((token: string) => {
      llamadasRed += 1;
      if (llamadasRed > 1) {
        throw new Error(
          `segunda llamada de red inesperada (token=${token}) — el lease debía impedirla: exactamente esto es el bug G1`,
        );
      }
      expect(token).toBe('T0'); // el único intento de red es siempre con el token original
      return new Promise((resolve) => {
        resolverPrimeraLlamada = resolve;
      });
    });

    // "Al mismo tiempo": ambos arrancan con T0 en memoria, ANTES de que ninguno rote nada.
    const pA = runtimeA.refrescar(t0);
    const pB = runtimeB.refrescar(t0);

    await vi.waitFor(() => expect(llamadasRed).toBe(1));
    resolverPrimeraLlamada(tokensRefrescados('T1'));

    const [resultadoA, resultadoB] = await Promise.all([pA, pB]);

    // Ambos runtimes terminan viendo T1 — el que hizo la request de red la recibe directo; el
    // otro la adopta de disco bajo el lease, sin haber tocado la red.
    expect(resultadoA.refreshToken).toBe('T1');
    expect(resultadoB.refreshToken).toBe('T1');
    expect(llamadasRed).toBe(1);
    expect(compartido.sesionEnDisco).toMatchObject({ refreshToken: 'T1' });

    // El lease queda liberado al final (cooldown 0), no tomado para siempre.
    expect(compartido.lease?.expiraAt).toBeLessThanOrEqual(Date.now());
  }, 10_000);

  it('sin contención (un solo runtime), el refresh sigue funcionando igual que antes del fix', async () => {
    const t0 = sesion('T0');
    compartido.sesionEnDisco = t0;

    vi.resetModules();
    const runtime = await import('./use-auth-movil');
    refreshMock.mockResolvedValue(tokensRefrescados('T1'));

    const resultado = await runtime.refrescar(t0);

    expect(resultado.refreshToken).toBe('T1');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith('T0');
    expect(compartido.lease).not.toBeNull();
    // El lease queda liberado (cooldown 0) al terminar, no "colgado" tomado para siempre.
    expect(compartido.lease?.expiraAt).toBeLessThanOrEqual(Date.now());
  });
});
