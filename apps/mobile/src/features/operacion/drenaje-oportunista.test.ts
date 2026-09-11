import { describe, expect, it, vi, beforeEach } from 'vitest';

// `drenaje-oportunista.ts` importa `react-native-background-geolocation`/`@sentry/react-native`
// (nativos, no corren bajo vitest/Node) — se mockean, mismo motivo documentado en
// `headless-task.test.ts`/`outbox.test.ts`.
//
// G1 (hallazgo de `/codex-debug verify-fix`, ALTO): a diferencia de la versión anterior de este
// archivo, acá NO se mockea `./sync-outbox` entero — el fix de G1 es justamente que
// `intentarDrenarOportunista` pase a usar el bucle COMPARTIDO `drenarLotesConLease`
// (`sync-outbox.ts`), el mismo que usa `sincronizarPendientesConLease` en foreground. Mockear
// `./sync-outbox` completo (como antes) ocultaría por completo esa regresión: un test que
// mockeara `drenarLotesConLease` pasaría igual aunque `intentarDrenarOportunista` siguiera
// llamando una sola vez a `sincronizarPendientes` por dentro. En su lugar se mockean las
// dependencias TRANSITIVAS de `sync-outbox.ts` (mismo patrón que `sync-outbox.lease.test.ts`),
// así el bucle real corre y se puede observar cuántos lotes intenta.
vi.mock('react-native-background-geolocation', () => ({
  default: {
    startBackgroundTask: vi.fn().mockResolvedValue(1),
    stopBackgroundTask: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn() },
}));

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn(),
  renovarLease: vi.fn(),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  recuperarEnviadosHuerfanos: vi.fn().mockResolvedValue(0),
  marcarAcusados: vi.fn(),
  marcarEnviados: vi.fn(),
  obtenerLotePendiente: vi.fn().mockResolvedValue([]),
  purgarAcusadosAntesDe: vi.fn().mockResolvedValue(0),
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

import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  obtenerLotePendiente,
  recuperarEnviadosHuerfanos,
  renovarLease,
} from '../../db/outbox';
import { syncApi } from '../../shared/api/sync-api';
import { intentarDrenarOportunista } from './drenaje-oportunista';

const adquirirLeaseMock = adquirirLease as unknown as ReturnType<typeof vi.fn>;
const renovarLeaseMock = renovarLease as unknown as ReturnType<typeof vi.fn>;
const liberarLeaseConCooldownMock = liberarLeaseConCooldown as unknown as ReturnType<typeof vi.fn>;
const recuperarEnviadosHuerfanosMock = recuperarEnviadosHuerfanos as unknown as ReturnType<
  typeof vi.fn
>;
const obtenerLotePendienteMock = obtenerLotePendiente as unknown as ReturnType<typeof vi.fn>;
const abrirOutboxMock = abrirOutbox as unknown as ReturnType<typeof vi.fn>;
const enviarLoteMock = syncApi.enviarLote as unknown as ReturnType<typeof vi.fn>;

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

describe('intentarDrenarOportunista — hallazgo 4a (lease ANTES del access token)', () => {
  beforeEach(() => {
    adquirirLeaseMock.mockReset().mockResolvedValue(true);
    renovarLeaseMock.mockReset().mockResolvedValue(true);
    recuperarEnviadosHuerfanosMock.mockReset().mockResolvedValue(0);
    obtenerLotePendienteMock.mockReset().mockResolvedValue([]); // outbox vacío por defecto
    liberarLeaseConCooldownMock.mockReset().mockResolvedValue(undefined);
    abrirOutboxMock.mockReset().mockResolvedValue({});
    enviarLoteMock.mockReset();
  });

  it('adquiere el lease ANTES de pedir el access token — no al revés', async () => {
    const orden: string[] = [];
    adquirirLeaseMock.mockImplementation(async () => {
      orden.push('adquirirLease');
      return true;
    });
    const obtenerAccessToken = vi.fn(async () => {
      orden.push('obtenerAccessToken');
      return 'access-token';
    });

    await intentarDrenarOportunista(obtenerAccessToken);

    // Hallazgo 4a: ANTES del fix, `obtenerAccessToken()` se llamaba primero — con fixes a
    // ~1/s, cada tick pedía un refresh sin importar si iba a ganar el lease, multiplicando
    // refreshes concurrentes. Con el fix, `adquirirLease` va primero SIEMPRE.
    expect(orden).toEqual(['adquirirLease', 'obtenerAccessToken']);
  });

  it('si NO consigue el lease, ni siquiera pide el access token', async () => {
    adquirirLeaseMock.mockResolvedValue(false);
    const obtenerAccessToken = vi.fn().mockResolvedValue('access-token');

    await intentarDrenarOportunista(obtenerAccessToken);

    expect(obtenerAccessToken).not.toHaveBeenCalled();
    expect(obtenerLotePendienteMock).not.toHaveBeenCalled();
  });

  it('hallazgo 3: al conseguir el lease, recupera enviados huérfanos ANTES de sincronizar', async () => {
    const orden: string[] = [];
    adquirirLeaseMock.mockImplementation(async () => {
      orden.push('adquirirLease');
      return true;
    });
    recuperarEnviadosHuerfanosMock.mockImplementation(async () => {
      orden.push('recuperarEnviadosHuerfanos');
      return 0;
    });
    obtenerLotePendienteMock.mockImplementation(async () => {
      orden.push('sincronizarPendientes');
      return [];
    });

    await intentarDrenarOportunista(vi.fn().mockResolvedValue('access-token'));

    expect(orden).toEqual(['adquirirLease', 'recuperarEnviadosHuerfanos', 'sincronizarPendientes']);
    // Umbral pasado a `recuperarEnviadosHuerfanos`: una Date en el pasado (ahora menos el
    // umbral), nunca "ahora" ni el futuro.
    const [, antesDe] = recuperarEnviadosHuerfanosMock.mock.calls[0]!;
    expect(antesDe.getTime()).toBeLessThan(Date.now());
  });

  it('sin access token (sesión no restaurable), libera el lease sin llegar a sincronizar', async () => {
    await intentarDrenarOportunista(vi.fn().mockResolvedValue(null));

    expect(obtenerLotePendienteMock).not.toHaveBeenCalled();
  });

  describe('G1 (hallazgo de `/codex-debug verify-fix`, ALTO): el headless encadena lotes igual que el foreground', () => {
    const LOTE_MAXIMO = 500;

    it('un atraso de 3 lotes llenos se drena en UN SOLO ciclo (no un lote por evento de ubicación)', async () => {
      obtenerLotePendienteMock
        .mockResolvedValueOnce(loteDe(LOTE_MAXIMO, 'a'))
        .mockResolvedValueOnce(loteDe(LOTE_MAXIMO, 'b'))
        .mockResolvedValueOnce(loteDe(120, 'c'));
      enviarLoteMock.mockImplementation(
        async (eventos: { eventId: string }[]) =>
          ({ aceptados: eventos.map((e) => e.eventId) }) as { aceptados: string[] },
      );

      await intentarDrenarOportunista(vi.fn().mockResolvedValue('access-token'));

      // ANTES del fix: `intentarDrenarOportunista` llamaba UNA sola vez a
      // `sincronizarPendientes` (un lote de 500, `obtenerLotePendiente` una sola vez) y
      // liberaba el lease con el enfriamiento de éxito — con la app cerrada, un atraso grande
      // solo drenaba un lote por cada evento de ubicación/heartbeat que llegara. Con el fix
      // (`drenarLotesConLease` compartido), los 3 lotes se drenan en ESTE MISMO evento.
      expect(obtenerLotePendienteMock).toHaveBeenCalledTimes(3);
      // Único ciclo: un solo adquirir/liberar lease para los 3 lotes.
      expect(adquirirLeaseMock).toHaveBeenCalledTimes(1);
      expect(liberarLeaseConCooldownMock).toHaveBeenCalledTimes(1);
      // Motivo 'agotado' (el último lote salió parcial): cooldown normal (piso de 10s), no 0.
      expect(liberarLeaseConCooldownMock).toHaveBeenCalledWith(
        expect.anything(),
        'drenaje-outbox',
        expect.any(String),
        expect.any(Number),
        10_000,
      );
    });

    it('R1: renueva el lease antes de CADA lote también en el camino headless', async () => {
      obtenerLotePendienteMock
        .mockResolvedValueOnce(loteDe(LOTE_MAXIMO, 'a'))
        .mockResolvedValueOnce(loteDe(50, 'b'));
      enviarLoteMock.mockImplementation(
        async (eventos: { eventId: string }[]) =>
          ({ aceptados: eventos.map((e) => e.eventId) }) as { aceptados: string[] },
      );

      await intentarDrenarOportunista(vi.fn().mockResolvedValue('access-token'));

      expect(renovarLeaseMock).toHaveBeenCalledTimes(2);
    });

    it('al llegar al tope con pendientes, libera SIN enfriamiento (0) también en headless', async () => {
      obtenerLotePendienteMock.mockImplementation(async () => loteDe(LOTE_MAXIMO, 'x'));
      enviarLoteMock.mockImplementation(
        async (eventos: { eventId: string }[]) =>
          ({ aceptados: eventos.map((e) => e.eventId) }) as { aceptados: string[] },
      );

      await intentarDrenarOportunista(vi.fn().mockResolvedValue('access-token'));

      expect(liberarLeaseConCooldownMock).toHaveBeenCalledWith(
        expect.anything(),
        'drenaje-outbox',
        expect.any(String),
        expect.any(Number),
        0,
      );
    });

    it('lease perdido a mitad del bucle: corta sin liberar (no es más el dueño)', async () => {
      obtenerLotePendienteMock.mockImplementation(async () => loteDe(LOTE_MAXIMO, 'y'));
      enviarLoteMock.mockImplementation(
        async (eventos: { eventId: string }[]) =>
          ({ aceptados: eventos.map((e) => e.eventId) }) as { aceptados: string[] },
      );
      renovarLeaseMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await intentarDrenarOportunista(vi.fn().mockResolvedValue('access-token'));

      expect(obtenerLotePendienteMock).toHaveBeenCalledTimes(1);
      expect(liberarLeaseConCooldownMock).not.toHaveBeenCalled();
    });
  });
});
