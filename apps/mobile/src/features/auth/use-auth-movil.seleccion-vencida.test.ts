import { beforeEach, describe, expect, it, vi } from 'vitest';

const reactHooks = vi.hoisted(() => {
  const state = { value: undefined as unknown };
  const setState = vi.fn((next: unknown) => {
    state.value =
      typeof next === 'function' ? (next as (actual: unknown) => unknown)(state.value) : next;
  });
  return { state, setState };
});

// El paquete móvil no tiene arnés de React; para esta prueba síncrona se usa el estado mínimo
// que necesita el hook y se dejan inactivos sus efectos de montaje.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => [reactHooks.state.value ?? initial, reactHooks.setState],
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (callback: unknown) => callback,
    useEffect: vi.fn(),
  };
});

vi.mock('../../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn(),
  haySesionNoVigenteParaToken: vi.fn(),
  obtenerDeviceIdMovil: vi.fn().mockResolvedValue('device-test'),
}));

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  renovarLease: vi.fn().mockResolvedValue(true),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 15_000,
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { CODIGO_SESION_NO_VIGENTE } from '@quivo/shared';
import { AuthMovilApiError, authMovilApi } from '../../shared/api/auth-movil-api';
import { useAuthMovil, MENSAJE_SELECCION_VENCIDA } from './use-auth-movil';

const seleccionarAsignacionMock = vi.spyOn(authMovilApi, 'seleccionarAsignacionSesion');

describe('seleccionarAsignacion con selección vencida', () => {
  beforeEach(() => {
    reactHooks.state.value = {
      etapa: 'asignacion',
      cargando: false,
      error: null,
      aviso: null,
      sesionNoRevalidada: false,
      sesionIrrecuperable: false,
      sesionNoVigente: false,
      seleccionToken: 'token-seleccion',
      asignaciones: [],
      sesion: null,
      deviceId: 'device-test',
    };
    reactHooks.setState.mockClear();
    seleccionarAsignacionMock.mockReset();
  });

  it('muestra el mensaje para volver a ingresar el PIN ante 401 sin código', async () => {
    seleccionarAsignacionMock.mockRejectedValue(
      new AuthMovilApiError('http', 'Placa o PIN incorrectos', 401),
    );

    const auth = useAuthMovil();
    await auth.seleccionarAsignacion('asignacion-1');

    expect((reactHooks.state.value as { error: string | null }).error).toBe(
      MENSAJE_SELECCION_VENCIDA,
    );
  });

  it('mantiene el mensaje habitual ante 401 con código SESION_NO_VIGENTE', async () => {
    seleccionarAsignacionMock.mockRejectedValue(
      new AuthMovilApiError('http', 'Sesión no vigente', 401, undefined, CODIGO_SESION_NO_VIGENTE),
    );

    const auth = useAuthMovil();
    await auth.seleccionarAsignacion('asignacion-1');

    expect((reactHooks.state.value as { error: string | null }).error).toBe(
      'Tu sesión ya no es válida en este dispositivo. Vuelve a iniciar sesión.',
    );
  });
});
