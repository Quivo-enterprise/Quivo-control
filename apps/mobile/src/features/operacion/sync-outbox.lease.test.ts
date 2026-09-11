import { describe, expect, it, vi, beforeEach } from 'vitest';

// `sync-outbox.ts` importa `@react-native-community/netinfo` (arrastra `react-native` entero,
// no corre bajo vitest/Node) y `db/outbox`/`shared/api/*` — se mockea lo necesario, mismo
// motivo documentado en `drenaje-oportunista.test.ts`/`outbox.test.ts`. Este archivo cubre
// SOLO `sincronizarPendientesConLease` (hallazgo 6, code review de la Entrega 2): el resto de
// `sync-outbox.ts` (`sincronizarPendientes`, `iniciarSyncAutomatico`) no se ejercita acá.
vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn() },
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn(),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  marcarAcusados: vi.fn(),
  marcarEnviados: vi.fn(),
  obtenerLotePendiente: vi.fn().mockResolvedValue([]),
  purgarAcusadosAntesDe: vi.fn().mockResolvedValue(0),
  recuperarEnviadosHuerfanos: vi.fn().mockResolvedValue(0),
  revertirAPendiente: vi.fn(),
  ID_LEASE_DRENAJE: 'drenaje-outbox',
  PISO_ENTRE_INTENTOS_DRENAJE_MS: 10_000,
  TTL_LEASE_DRENAJE_MS: 60_000,
}));

vi.mock('../../shared/api/http-client', () => ({
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../shared/api/sync-api', () => ({
  syncApi: { enviarLote: vi.fn() },
}));

import { adquirirLease, liberarLeaseConCooldown, obtenerLotePendiente } from '../../db/outbox';
import { syncApi } from '../../shared/api/sync-api';
import { sincronizarPendientesConLease } from './sync-outbox';

const adquirirLeaseMock = adquirirLease as unknown as ReturnType<typeof vi.fn>;
const obtenerLotePendienteMock = obtenerLotePendiente as unknown as ReturnType<typeof vi.fn>;
const liberarLeaseConCooldownMock = liberarLeaseConCooldown as unknown as ReturnType<typeof vi.fn>;
const enviarLoteMock = syncApi.enviarLote as unknown as ReturnType<typeof vi.fn>;

describe('sincronizarPendientesConLease — hallazgo 6 (iniciarSyncAutomatico/latido de 15s sin lease)', () => {
  beforeEach(() => {
    adquirirLeaseMock.mockReset().mockResolvedValue(true);
    obtenerLotePendienteMock.mockReset().mockResolvedValue([]); // outbox vacío: enviados: 0
    liberarLeaseConCooldownMock.mockReset().mockResolvedValue(undefined);
  });

  it('sin lease disponible (el drenado por ubicación lo tiene en este instante) devuelve null y NO llama a obtenerLotePendiente', async () => {
    adquirirLeaseMock.mockResolvedValue(false);

    const resultado = await sincronizarPendientesConLease('access-token');

    expect(resultado).toBeNull();
    // Prueba central del hallazgo: antes de este fix, `iniciarSyncAutomatico`/el latido de
    // 15s llamaban a `sincronizarPendientes` SIN pasar por ningún lease — con el drenado por
    // ubicación corriendo en paralelo, esto habría igual intentado leer/mandar el lote. Con
    // el fix, si no se consigue el lease, ni siquiera se toca el outbox.
    expect(obtenerLotePendienteMock).not.toHaveBeenCalled();
  });

  it('con el lease disponible, sincroniza normalmente y devuelve el resultado', async () => {
    const resultado = await sincronizarPendientesConLease('access-token');

    expect(resultado).toEqual({ enviados: 0 });
    expect(obtenerLotePendienteMock).toHaveBeenCalled();
  });

  it('el lease pedido es el MISMO `ID_LEASE_DRENAJE` que usa `intentarDrenarOportunista`', async () => {
    await sincronizarPendientesConLease('access-token');

    expect(adquirirLeaseMock).toHaveBeenCalledWith(
      expect.anything(),
      'drenaje-outbox',
      expect.any(String),
      expect.any(Number),
      60_000,
    );
  });

  describe('Hallazgo 2 (code review, MEDIO): encadenado de lotes llenos bajo el mismo lease', () => {
    const LOTE_MAXIMO = 500;

    function loteDe(cantidad: number, prefijo: string) {
      return Array.from({ length: cantidad }, (_, i) => ({
        eventId: `${prefijo}-${i}`,
        deviceId: 'device-1',
        ts: new Date().toISOString(),
        tipo: 'gps_point' as const,
        payload: {},
        estado: 'pendiente' as const,
      }));
    }

    beforeEach(() => {
      enviarLoteMock.mockReset();
    });

    it('2 lotes llenos seguidos + 1 parcial se drenan en UN SOLO ciclo (un único adquirir/liberar lease)', async () => {
      // 3 llamadas a obtenerLotePendiente: 500 llenos, 500 llenos, 120 parciales (fin).
      obtenerLotePendienteMock
        .mockResolvedValueOnce(loteDe(LOTE_MAXIMO, 'a'))
        .mockResolvedValueOnce(loteDe(LOTE_MAXIMO, 'b'))
        .mockResolvedValueOnce(loteDe(120, 'c'));
      // El servidor acusa el lote entero cada vez (todos los IDs que se mandaron).
      enviarLoteMock.mockImplementation(
        async (eventos: { eventId: string }[]) =>
          ({ aceptados: eventos.map((e) => e.eventId) }) as { aceptados: string[] },
      );

      const resultado = await sincronizarPendientesConLease('access-token');

      // Antes del fix: el primer lote lleno liberaba el lease con cooldown de 10s y devolvía
      // { enviados: 500 } — el resto quedaba para un `setTimeout(500ms)` que llegaba a un
      // lease todavía tomado, recibía `null` y la cadena se cortaba ahí. Con el fix, los 3
      // lotes se drenan bajo el MISMO lease en una sola llamada.
      expect(resultado).toEqual({ enviados: LOTE_MAXIMO + LOTE_MAXIMO + 120 });
      expect(obtenerLotePendienteMock).toHaveBeenCalledTimes(3);
      // Un solo ciclo de adquisición/liberación — el lease nunca se soltó entre lotes.
      expect(adquirirLeaseMock).toHaveBeenCalledTimes(1);
      expect(liberarLeaseConCooldownMock).toHaveBeenCalledTimes(1);
    });

    it('respeta el tope de lotes por ciclo (no monopoliza el lease indefinidamente)', async () => {
      // Outbox que nunca converge: siempre hay un lote lleno esperando.
      obtenerLotePendienteMock.mockImplementation(async () => loteDe(LOTE_MAXIMO, 'x'));
      enviarLoteMock.mockImplementation(
        async (eventos: { eventId: string }[]) =>
          ({ aceptados: eventos.map((e) => e.eventId) }) as { aceptados: string[] },
      );

      const resultado = await sincronizarPendientesConLease('access-token');

      const TOPE_LOTES_POR_CICLO_DRENAJE = 20;
      expect(resultado).toEqual({ enviados: LOTE_MAXIMO * TOPE_LOTES_POR_CICLO_DRENAJE });
      expect(obtenerLotePendienteMock).toHaveBeenCalledTimes(TOPE_LOTES_POR_CICLO_DRENAJE);
      // El lease se libera igual al llegar al tope — no queda tomado para siempre.
      expect(liberarLeaseConCooldownMock).toHaveBeenCalledTimes(1);
    });
  });
});
