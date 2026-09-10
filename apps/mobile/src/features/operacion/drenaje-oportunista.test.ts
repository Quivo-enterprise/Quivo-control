import { describe, expect, it, vi, beforeEach } from 'vitest';

// `drenaje-oportunista.ts` importa `react-native-background-geolocation`/`@sentry/react-native`
// (nativos, no corren bajo vitest/Node) y `db/outbox`/`./sync-outbox` (que a su vez arrastran
// `expo-sqlite`/`@react-native-community/netinfo` → `react-native` entero) — se mockean todos,
// mismo motivo documentado en `headless-task.test.ts`/`outbox.test.ts`.
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

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn(),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  recuperarEnviadosHuerfanos: vi.fn().mockResolvedValue(0),
  ID_LEASE_DRENAJE: 'drenaje-outbox',
  PISO_ENTRE_INTENTOS_DRENAJE_MS: 10_000,
  TTL_LEASE_DRENAJE_MS: 60_000,
}));

vi.mock('./sync-outbox', () => ({
  sincronizarPendientes: vi.fn().mockResolvedValue({ enviados: 1 }),
}));

import {
  abrirOutbox,
  adquirirLease,
  recuperarEnviadosHuerfanos,
} from '../../db/outbox';
import { sincronizarPendientes } from './sync-outbox';
import { intentarDrenarOportunista } from './drenaje-oportunista';

const adquirirLeaseMock = adquirirLease as unknown as ReturnType<typeof vi.fn>;
const recuperarEnviadosHuerfanosMock = recuperarEnviadosHuerfanos as unknown as ReturnType<
  typeof vi.fn
>;
const sincronizarPendientesMock = sincronizarPendientes as unknown as ReturnType<typeof vi.fn>;
const abrirOutboxMock = abrirOutbox as unknown as ReturnType<typeof vi.fn>;

describe('intentarDrenarOportunista — hallazgo 4a (lease ANTES del access token)', () => {
  beforeEach(() => {
    adquirirLeaseMock.mockReset().mockResolvedValue(true);
    recuperarEnviadosHuerfanosMock.mockReset().mockResolvedValue(0);
    sincronizarPendientesMock.mockReset().mockResolvedValue({ enviados: 1 });
    abrirOutboxMock.mockReset().mockResolvedValue({});
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
    expect(sincronizarPendientesMock).not.toHaveBeenCalled();
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
    sincronizarPendientesMock.mockImplementation(async () => {
      orden.push('sincronizarPendientes');
      return { enviados: 0 };
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

    expect(sincronizarPendientesMock).not.toHaveBeenCalled();
  });
});
