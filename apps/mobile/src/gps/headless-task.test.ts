import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hallazgo 3 (MEDIO, code review sobre el hallazgo 1 de `docs/plan-v2-app-y-mapa-en-vivo.md`
// §2.4): `obtenerContextoUbicacionPersistido` (`headless-task.ts`) puede quedar corriendo el
// tracker toda la noche si el paquete del día guardado en SQLite es de OTRA asignación (la
// fila sobrevive al logout) — `interpretarFilaPaqueteDia` lo rechaza y `paqueteLocal` queda
// `null`, y con la lógica vieja eso saltaba ENTERA la rama de vencimiento (ni descarte
// inmediato del punto ni, tras la gracia, el `stop()` del plugin nativo). Este archivo cubre
// que el vencimiento ahora se evalúa contra `sesion.contexto.asignacion.venceAt` — la sesión
// activa, siempre disponible — y no contra el paquete local, que puede faltar.
//
// Se mockean `../db/outbox`, `../db/paquete-dia`, `../shared/security/sesion-movil-store`,
// `@sentry/react-native`, `react-native-background-geolocation` y (Entrega 2)
// `../features/operacion/drenaje-oportunista` porque todos traen, directa o
// transitivamente (`sync-outbox.ts` → `@react-native-community/netinfo` importa `react-native`
// entero), dependencias nativas (`expo-sqlite`, `expo-crypto`, `expo-secure-store`) que rompen
// bajo vitest/Node — mismo motivo documentado en `db/paquete-dia-local.ts` y en
// `use-auth-movil.refrescar.test.ts`. Este archivo solo cubre
// `obtenerContextoUbicacionPersistido`, que ni siquiera llama al drenado — el mock de
// `drenaje-oportunista` es puramente para que `import './headless-task'` no arrastre esa
// cadena al evaluar el módulo.
vi.mock('react-native-background-geolocation', () => ({
  default: {
    getState: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// G1 (hallazgo de `/codex-debug verify-fix`): importar `headless-task.ts` evalúa
// transitivamente `use-auth-movil.ts`, que ahora importa `db/outbox` para el lease
// `refresh-sesion` — se completan los exports aunque este archivo no ejercite ese camino
// (solo cubre `obtenerContextoUbicacionPersistido`), para que el import no falle.
vi.mock('../db/outbox', () => ({
  abrirOutbox: vi.fn(),
  encolarEvento: vi.fn(),
  obtenerEventosPorTipo: vi.fn(),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 15_000,
}));

vi.mock('../db/paquete-dia', () => ({
  abrirPaqueteDiaDb: vi.fn(),
  obtenerPaqueteDiaLocal: vi.fn(),
}));

vi.mock('../shared/security/sesion-movil-store', () => ({
  cargarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

vi.mock('../features/operacion/drenaje-oportunista', () => ({
  intentarDrenarOportunista: vi.fn().mockResolvedValue(undefined),
}));

import BackgroundGeolocation from 'react-native-background-geolocation';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal, type PaqueteDiaLocal } from '../db/paquete-dia';
import {
  cargarSesionMovil,
  hayLogoutSolicitado,
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../shared/security/sesion-movil-store';
import { obtenerContextoUbicacionPersistido } from './headless-task';

const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const hayLogoutSolicitadoMock = hayLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const obtenerDeviceIdMovilMock = obtenerDeviceIdMovil as unknown as ReturnType<typeof vi.fn>;
const abrirPaqueteDiaDbMock = abrirPaqueteDiaDb as unknown as ReturnType<typeof vi.fn>;
const obtenerPaqueteDiaLocalMock = obtenerPaqueteDiaLocal as unknown as ReturnType<typeof vi.fn>;
const getStateMock = BackgroundGeolocation.getState as unknown as ReturnType<typeof vi.fn>;
const stopMock = BackgroundGeolocation.stop as unknown as ReturnType<typeof vi.fn>;

/** Sesión mínima "autenticado" — sólo lo que lee `obtenerContextoUbicacionPersistido`. El
 * resto del contrato de `SesionMovilGuardada` (vehículo, conductor, sindicato, etc.) no le
 * importa a este código, así que se castea en vez de rellenarlo entero. */
function sesion(venceAtIso: string, asignacionId = 'asignacion-1'): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {
      sesionId: 'sesion-1',
      asignacion: { id: asignacionId, fecha: '2026-08-18', horario: 'manana', venceAt: venceAtIso },
    },
  } as unknown as SesionMovilGuardada;
}

function paqueteLocalDe(venceAtIso: string): PaqueteDiaLocal {
  return {
    paquete: {
      asignacion: { id: 'asignacion-1', venceAt: venceAtIso },
      puntosControl: [{ id: 'pc-1' }],
    },
    vencido: new Date(venceAtIso).getTime() <= Date.now(),
    descargadoEn: new Date().toISOString(),
  } as unknown as PaqueteDiaLocal;
}

describe('obtenerContextoUbicacionPersistido — hallazgo 3 (vencimiento evaluado contra la sesión)', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    hayLogoutSolicitadoMock.mockReset().mockResolvedValue(false);
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    getStateMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue(undefined);
  });

  it('detiene el tracking nativo tras el margen de gracia cuando la sesión venció, aunque el paquete local no matchee (identidad, hallazgo 1)', async () => {
    // 3h vencida: supera el margen de gracia de 2h (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`).
    const venceAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    // `obtenerPaqueteDiaLocal` devuelve `null` — la fila de SQLite es de OTRA asignación
    // (rechazada por `interpretarFilaPaqueteDia`, hallazgo 1). Antes del fix, esto saltaba
    // toda la rama de vencimiento y el `stop()` nunca se disparaba.
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('NO detiene el tracking todavía si el vencimiento de la sesión está dentro del margen de gracia', async () => {
    // 5 minutos vencida: dentro del margen de gracia de 2h.
    const venceAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('sigue registrando el punto (sin puntos de control) cuando la sesión NO venció, aunque el paquete local no matchee', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);
    obtenerDeviceIdMovilMock.mockResolvedValue('device-xyz');

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toEqual({ deviceId: 'device-xyz', sesionId: 'sesion-1', puntosControl: [] });
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('usa los puntos de control del paquete local cuando SÍ matchea la asignación de la sesión y no está vencido', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    obtenerPaqueteDiaLocalMock.mockResolvedValue(paqueteLocalDe(venceAt));

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).not.toBeNull();
    expect(contexto?.puntosControl).toEqual([{ id: 'pc-1' }]);
    expect(stopMock).not.toHaveBeenCalled();
  });
});

describe('obtenerContextoUbicacionPersistido — fix drenado en background (punto 2, marca de logout pendiente)', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    hayLogoutSolicitadoMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    getStateMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue(undefined);
  });

  it('con la marca de logout pendiente presente, detiene el tracking y descarta el punto aunque la sesión en disco siga vigente', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    hayLogoutSolicitadoMock.mockResolvedValue(true);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).toHaveBeenCalledTimes(1);
    // No debe llegar a evaluar el paquete del día: se corta antes.
    expect(obtenerPaqueteDiaLocalMock).not.toHaveBeenCalled();
  });

  it('fail-closed: si la lectura de la marca falla, trata igual que si estuviera presente', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    hayLogoutSolicitadoMock.mockRejectedValue(new Error('SecureStore no disponible'));

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('sin marca de logout pendiente, sigue registrando el punto como antes', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    hayLogoutSolicitadoMock.mockResolvedValue(false);
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).not.toBeNull();
    expect(stopMock).not.toHaveBeenCalled();
  });
});
