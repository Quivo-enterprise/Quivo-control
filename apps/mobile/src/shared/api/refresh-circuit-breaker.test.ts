import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mismo motivo que `use-auth-movil.refrescar.test.ts`: se mockea `authMovilApi` (no trae
// dependencias nativas, así que se podría usar la clase real, pero mockearla evita golpear
// `fetch`/`AbortController` reales) y `@sentry/react-native` (nativo, rompe bajo vitest/Node).
vi.mock('./auth-movil-api', async () => {
  const actual = await vi.importActual<typeof import('./auth-movil-api')>('./auth-movil-api');
  return {
    ...actual,
    authMovilApi: { refresh: vi.fn() },
  };
});

vi.mock('@sentry/react-native', () => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { authMovilApi, AuthMovilApiError } from './auth-movil-api';
import {
  BACKOFF_INICIAL_MS,
  BACKOFF_MAXIMO_MS,
  ESTADO_INICIAL_CIRCUITO_REFRESH,
  UMBRAL_FALLOS_ABRIR_CIRCUITO,
  UMBRAL_MS_SESION_IRRECUPERABLE,
  circuitoTrasExito,
  circuitoTrasFallo401,
  esSesionIrrecuperable,
  intentarRefrescarConCircuito,
  obtenerEstadoCircuitoRefresh,
  puedeIntentarRefresh,
  reiniciarCircuitoRefresh,
} from './refresh-circuit-breaker';

const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;

const __dirname = dirname(fileURLToPath(import.meta.url));

function tokensFalsos() {
  return {
    accessToken: 'access-nueva',
    refreshToken: 'refresh-nueva',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe('funciones puras del circuito (reloj falso, sin tocar el singleton)', () => {
  it('permite intentar mientras el circuito está cerrado, sin importar la hora', () => {
    expect(puedeIntentarRefresh(ESTADO_INICIAL_CIRCUITO_REFRESH, 0)).toBe(true);
    expect(puedeIntentarRefresh(ESTADO_INICIAL_CIRCUITO_REFRESH, 999_999_999)).toBe(true);
  });

  it(`${UMBRAL_FALLOS_ABRIR_CIRCUITO} fallos 401 seguidos abren el circuito (encargo: "reloj falso — 5 fallos → abierto")`, () => {
    let estado = ESTADO_INICIAL_CIRCUITO_REFRESH;
    let ahoraMs = 0;
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO - 1; i++) {
      estado = circuitoTrasFallo401(estado, ahoraMs);
      expect(estado.estado).toBe('cerrado');
      ahoraMs += 15_000;
    }
    estado = circuitoTrasFallo401(estado, ahoraMs);
    expect(estado.estado).toBe('abierto');
    expect(estado.fallosConsecutivos).toBe(UMBRAL_FALLOS_ABRIR_CIRCUITO);
    expect(estado.backoffActualMs).toBe(BACKOFF_INICIAL_MS);
    expect(estado.proximoIntentoMs).toBe(ahoraMs + BACKOFF_INICIAL_MS);
  });

  it('un éxito cierra el circuito del todo, sin importar cuántos fallos hubiera (encargo: "éxito → cerrado")', () => {
    let estado = ESTADO_INICIAL_CIRCUITO_REFRESH;
    for (let i = 0; i < 10; i++) estado = circuitoTrasFallo401(estado, i * 15_000);
    expect(estado.estado).toBe('abierto');

    estado = circuitoTrasExito();
    expect(estado).toEqual(ESTADO_INICIAL_CIRCUITO_REFRESH);
  });

  it('el backoff se dobla en cada probe fallido sucesivo, con tope', () => {
    let estado = ESTADO_INICIAL_CIRCUITO_REFRESH;
    let ahoraMs = 0;
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO; i++) {
      estado = circuitoTrasFallo401(estado, ahoraMs);
      ahoraMs += 15_000;
    }
    expect(estado.backoffActualMs).toBe(BACKOFF_INICIAL_MS); // 30s

    ahoraMs = estado.proximoIntentoMs; // probe 1 tras el backoff inicial
    estado = circuitoTrasFallo401(estado, ahoraMs);
    expect(estado.backoffActualMs).toBe(BACKOFF_INICIAL_MS * 2); // 60s

    ahoraMs = estado.proximoIntentoMs;
    estado = circuitoTrasFallo401(estado, ahoraMs); // 120s
    ahoraMs = estado.proximoIntentoMs;
    estado = circuitoTrasFallo401(estado, ahoraMs); // 240s
    ahoraMs = estado.proximoIntentoMs;
    estado = circuitoTrasFallo401(estado, ahoraMs); // tope: 300s (5 min)
    expect(estado.backoffActualMs).toBe(BACKOFF_MAXIMO_MS);

    ahoraMs = estado.proximoIntentoMs;
    estado = circuitoTrasFallo401(estado, ahoraMs); // se mantiene en el tope
    expect(estado.backoffActualMs).toBe(BACKOFF_MAXIMO_MS);
  });

  it('sesión irrecuperable solo tras el umbral de tiempo con el circuito abierto sin éxito', () => {
    let estado = ESTADO_INICIAL_CIRCUITO_REFRESH;
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO; i++) estado = circuitoTrasFallo401(estado, 0);
    expect(estado.estado).toBe('abierto');

    expect(esSesionIrrecuperable(estado, UMBRAL_MS_SESION_IRRECUPERABLE - 1)).toBe(false);
    expect(esSesionIrrecuperable(estado, UMBRAL_MS_SESION_IRRECUPERABLE)).toBe(true);
  });

  it('un circuito cerrado (incluso con fallos parciales, sin abrir) nunca es sesión irrecuperable', () => {
    const estado = circuitoTrasFallo401(ESTADO_INICIAL_CIRCUITO_REFRESH, 0);
    expect(estado.estado).toBe('cerrado');
    expect(esSesionIrrecuperable(estado, 999_999_999)).toBe(false);
  });
});

describe('intentarRefrescarConCircuito (singleton stateful)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    reiniciarCircuitoRefresh();
  });

  it('con el circuito cerrado, siempre intenta la red', async () => {
    refreshMock.mockResolvedValueOnce(tokensFalsos());
    await intentarRefrescarConCircuito('refresh-1', 0);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it(`abre el circuito tras ${UMBRAL_FALLOS_ABRIR_CIRCUITO} fallos 401 reales y deja de golpear la red hasta que vence el backoff`, async () => {
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión inválida', 401));

    let ahoraMs = 0;
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO; i++) {
      await expect(intentarRefrescarConCircuito('refresh-1', ahoraMs)).rejects.toThrow();
      ahoraMs += 15_000;
    }
    expect(refreshMock).toHaveBeenCalledTimes(UMBRAL_FALLOS_ABRIR_CIRCUITO);
    expect(obtenerEstadoCircuitoRefresh().estado).toBe('abierto');

    // Circuito recién abierto: el próximo intento, ANTES de que venza el backoff, corta sin
    // tocar la red — no suma una llamada más a `refreshMock`.
    await expect(intentarRefrescarConCircuito('refresh-1', ahoraMs + 1_000)).rejects.toThrow(
      /circuito/i,
    );
    expect(refreshMock).toHaveBeenCalledTimes(UMBRAL_FALLOS_ABRIR_CIRCUITO);
  });

  it('cierra el circuito y resetea el backoff en el primer éxito tras haberse abierto', async () => {
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión inválida', 401));
    let ahoraMs = 0;
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO; i++) {
      await expect(intentarRefrescarConCircuito('refresh-1', ahoraMs)).rejects.toThrow();
      ahoraMs += 15_000;
    }
    const proximoIntento = obtenerEstadoCircuitoRefresh().proximoIntentoMs;

    refreshMock.mockResolvedValueOnce(tokensFalsos());
    const tokens = await intentarRefrescarConCircuito('refresh-1', proximoIntento);
    expect(tokens.accessToken).toBe('access-nueva');
    expect(obtenerEstadoCircuitoRefresh()).toEqual(ESTADO_INICIAL_CIRCUITO_REFRESH);
  });

  it('un error de RED (no 401) no abre ni avanza el circuito — no es evidencia sobre el refresh token', async () => {
    refreshMock.mockRejectedValue(new AuthMovilApiError('network', 'Error de red'));
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO + 3; i++) {
      await expect(intentarRefrescarConCircuito('refresh-1', i * 15_000)).rejects.toThrow();
    }
    // Cada intento SÍ golpeó la red (el circuito seguía cerrado en cada uno) — lo que no pasó
    // es que se abriera.
    expect(refreshMock).toHaveBeenCalledTimes(UMBRAL_FALLOS_ABRIR_CIRCUITO + 3);
    expect(obtenerEstadoCircuitoRefresh().estado).toBe('cerrado');
  });

  /**
   * Entrega 28 (`docs/plan-correccion-post-piloto-2026-09-09.md`): `SESION_NO_VIGENTE` es
   * evidencia DEFINITIVA — a diferencia de un 401 sin código (arriba, sí cuenta) o de un
   * error de red (tampoco cuenta, pero por ser AMBIGUO), acá no cuenta por la razón opuesta:
   * no hay nada que "confirmar" reintentando. El error se propaga tal cual (el caller —
   * `refrescar()`/`obtenerAccessTokenHeadless()` — decide cortar de raíz), sin abrir el
   * circuito ni sumar al backoff.
   */
  it('SESION_NO_VIGENTE (codigo) se propaga SIN abrir el circuito ni sumar fallos — evidencia definitiva, no ambigua', async () => {
    refreshMock.mockRejectedValue(
      new AuthMovilApiError(
        'http',
        'Sesión móvil inválida o expirada',
        401,
        undefined,
        'SESION_NO_VIGENTE',
      ),
    );
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO + 3; i++) {
      await expect(intentarRefrescarConCircuito('refresh-1', i * 15_000)).rejects.toMatchObject({
        codigo: 'SESION_NO_VIGENTE',
      });
    }
    // Cada intento golpeó la red de verdad (nunca se cortó local) — lo que nunca pasó es que
    // el circuito avanzara.
    expect(refreshMock).toHaveBeenCalledTimes(UMBRAL_FALLOS_ABRIR_CIRCUITO + 3);
    expect(obtenerEstadoCircuitoRefresh()).toEqual(ESTADO_INICIAL_CIRCUITO_REFRESH);
  });

  it('bug de QA 2026-08-23 simulado: 42 min de polling cada 15s con 401 permanente hacen MUCHOS menos que los 29 intentos reales originales', async () => {
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión inválida', 401));
    const REFRESCO_MS = 15_000;
    const DURACION_MS = 42 * 60_000;
    let intentosReales = 0;

    for (let ahoraMs = 0; ahoraMs <= DURACION_MS; ahoraMs += REFRESCO_MS) {
      try {
        await intentarRefrescarConCircuito('refresh-1', ahoraMs);
      } catch {
        // esperado: siempre falla en este escenario
      }
    }
    intentosReales = refreshMock.mock.calls.length;

    // El bug real: 29 intentos reales en 42 min, cero éxitos, sin freno. Con el breaker el
    // circuito abre a los 5 fallos y aplica backoff exponencial hasta 5 min — bastante menos
    // que un intento cada 15s durante 42 minutos (que hubiera dado 168).
    expect(intentosReales).toBeLessThan(29);
    expect(intentosReales).toBeLessThanOrEqual(20);
    expect(obtenerEstadoCircuitoRefresh().estado).toBe('abierto');
    expect(esSesionIrrecuperable(obtenerEstadoCircuitoRefresh(), DURACION_MS)).toBe(true);
  });

  it('reiniciarCircuitoRefresh vuelve todo al estado inicial (login/logout nuevo)', async () => {
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión inválida', 401));
    for (let i = 0; i < UMBRAL_FALLOS_ABRIR_CIRCUITO; i++) {
      await expect(intentarRefrescarConCircuito('refresh-1', i * 15_000)).rejects.toThrow();
    }
    expect(obtenerEstadoCircuitoRefresh().estado).toBe('abierto');

    reiniciarCircuitoRefresh();
    expect(obtenerEstadoCircuitoRefresh()).toEqual(ESTADO_INICIAL_CIRCUITO_REFRESH);

    refreshMock.mockResolvedValueOnce(tokensFalsos());
    await intentarRefrescarConCircuito('refresh-2', 0);
    expect(refreshMock).toHaveBeenCalledTimes(UMBRAL_FALLOS_ABRIR_CIRCUITO + 1);
  });
});

describe('el circuito NUNCA se ve desde el motor de sync de datos (principio rector: transporte de captura, separado del transporte de sync)', () => {
  it('sync-outbox.ts (el motor de sync/drenado) no importa el circuit breaker del refresh', () => {
    const contenido = readFileSync(
      resolve(__dirname, '../../features/operacion/sync-outbox.ts'),
      'utf-8',
    );
    expect(contenido).not.toMatch(/refresh-circuit-breaker/);
  });

  it('sync-api.ts (el cliente HTTP del sync) no importa auth-movil-api.ts ni el breaker', () => {
    const contenido = readFileSync(resolve(__dirname, './sync-api.ts'), 'utf-8');
    expect(contenido).not.toMatch(/refresh-circuit-breaker|auth-movil-api/);
  });
});
