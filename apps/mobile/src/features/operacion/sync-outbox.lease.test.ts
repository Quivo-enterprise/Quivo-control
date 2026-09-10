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

import { adquirirLease, obtenerLotePendiente } from '../../db/outbox';
import { sincronizarPendientesConLease } from './sync-outbox';

const adquirirLeaseMock = adquirirLease as unknown as ReturnType<typeof vi.fn>;
const obtenerLotePendienteMock = obtenerLotePendiente as unknown as ReturnType<typeof vi.fn>;

describe('sincronizarPendientesConLease — hallazgo 6 (iniciarSyncAutomatico/latido de 15s sin lease)', () => {
  beforeEach(() => {
    adquirirLeaseMock.mockReset().mockResolvedValue(true);
    obtenerLotePendienteMock.mockReset().mockResolvedValue([]); // outbox vacío: enviados: 0
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
});
