import { describe, expect, it, vi, beforeEach } from 'vitest';

// `use-auth-movil.ts` importa `sesion-movil-store` (expo-secure-store/expo-crypto, nativos) y
// `@sentry/react-native` a nivel de módulo — sin mockearlos acá el import del hook revienta en
// vitest (sin runtime nativo). Mismo patrón que `use-auth-movil.restaurar-sesion.test.ts`.
vi.mock('../../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn(),
  haySesionNoVigenteParaToken: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

// G1 (hallazgo de `/codex-debug verify-fix`): `use-auth-movil.ts`/`confirmarTokenRechazadoVigente`
// corren bajo el lease SQLite `refresh-sesion` — se mockea igual que en el resto de los tests de
// este archivo, concediendo el lease de inmediato.
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

import { cargarSesionMovil, type SesionMovilGuardada } from '../../shared/security/sesion-movil-store';
import {
  huboLecturaDeRecorridoActivo,
  marcarRecorridoActivoGlobal,
  reiniciarEstadoRecorridoActivoParaTests,
  suscribirseARecorridoActivo,
} from '../operacion/estado-recorrido-activo';
import { decidirCierrePorNoVigente, type VeredictoCierrePorNoVigente } from './use-auth-movil';

const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;

function sesion(refreshToken: string): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: `access-${refreshToken}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {} as SesionMovilGuardada['contexto'],
  } as SesionMovilGuardada;
}

/**
 * Rescope SESION_NO_VIGENTE (decisión del CTO, code review de `fix/sesion-no-vigente`):
 * `decidirCierrePorNoVigente` es la decisión B (¿el rechazo sigue vigente contra disco?) + C
 * (¿hay un recorrido activo?) extraída a standalone — se testea acá en vez de renderizar el
 * hook (`apps/mobile` no tiene arnés jest-expo/RNTL, ver el docblock de
 * `clasificarFalloAccessToken` en `use-auth-movil.ts`). El call site real
 * (`cerrarSesionPorNoVigente`, dentro de `useAuthMovil`) solo traduce el veredicto a
 * `setEstado`/`borrarSesionMovil`, sin lógica propia que valga la pena aislar aparte.
 */
describe('decidirCierrePorNoVigente', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    reiniciarEstadoRecorridoActivoParaTests();
  });

  it('sin recorrido activo: token todavía vigente en disco → "borrar" (camino directo de siempre)', async () => {
    const guardada = sesion('refresh-1');
    cargarSesionMovilMock.mockResolvedValue(guardada);
    marcarRecorridoActivoGlobal(false);

    await expect(decidirCierrePorNoVigente('refresh-1')).resolves.toEqual({ tipo: 'borrar' });
  });

  it('con recorrido ACTIVO: token todavía vigente en disco → "esperar_finalizar" (no borra, espera "Finalizar")', async () => {
    const guardada = sesion('refresh-1');
    cargarSesionMovilMock.mockResolvedValue(guardada);
    marcarRecorridoActivoGlobal(true);

    await expect(decidirCierrePorNoVigente('refresh-1')).resolves.toEqual({
      tipo: 'esperar_finalizar',
    });
  });

  it('token-mismatch (un login nuevo ya rotó el token en disco) → "token_superado", nunca borra ni espera', async () => {
    const trasLoginNuevo = sesion('refresh-de-otro-login');
    cargarSesionMovilMock.mockResolvedValue(trasLoginNuevo);
    // Con recorrido activo IGUAL — el mismatch de token corta ANTES de llegar a mirar el
    // recorrido, sin importar su estado.
    marcarRecorridoActivoGlobal(true);

    await expect(decidirCierrePorNoVigente('refresh-1')).resolves.toEqual({
      tipo: 'token_superado',
      sesionEnDisco: trasLoginNuevo,
    });
  });

  it('sin sesión en disco (logout ganó la carrera) → "token_superado" con sesionEnDisco null', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);
    marcarRecorridoActivoGlobal(false);

    await expect(decidirCierrePorNoVigente('refresh-1')).resolves.toEqual({
      tipo: 'token_superado',
      sesionEnDisco: null,
    });
  });

  it('sin refreshTokenRechazado (caller defensivo sin el dato): salta el chequeo B y decide solo por C', async () => {
    marcarRecorridoActivoGlobal(true);
    await expect(decidirCierrePorNoVigente(undefined)).resolves.toEqual({
      tipo: 'esperar_finalizar',
    });
    expect(cargarSesionMovilMock).not.toHaveBeenCalled();

    marcarRecorridoActivoGlobal(false);
    await expect(decidirCierrePorNoVigente(undefined)).resolves.toEqual({ tipo: 'borrar' });
  });
});

/**
 * FIX POST-REVISIÓN (hallazgo ALTO, Entrega 28): documenta la secuencia real que sigue
 * `restaurarSesion` (`use-auth-movil.ts`, bloque `void (async () => { ... })()` tras el flag
 * headless) cuando reabre la app y el re-enganche de `useGpsOperativo` TODAVÍA no resolvió
 * ningún veredicto — `huboLecturaDeRecorridoActivo()` en `false` SIN que eso signifique "no hay
 * recorrido", sino "todavía no se sabe". `restaurarSesion` se suscribe con
 * `suscribirseARecorridoActivo` y espera la PRIMERA publicación real antes de decidir. Este
 * paquete no tiene arnés de React (`renderHook`, ver el docblock de
 * `clasificarFalloAccessToken`), así que se ejercita el módulo compartido
 * (`estado-recorrido-activo.ts`) directo, sin renderizar `useGpsOperativo` — es exactamente lo
 * que `restaurarSesion` consume de él.
 */
describe('secuencia real de restaurarSesion: sin veredicto todavía → suscribirse → primer veredicto real', () => {
  beforeEach(() => {
    reiniciarEstadoRecorridoActivoParaTests();
  });

  it('sin publicación previa (huboLectura false) y luego publicar `true` resuelve "esperar_finalizar"', async () => {
    expect(huboLecturaDeRecorridoActivo()).toBe(false);

    const veredicto = new Promise<VeredictoCierrePorNoVigente>((resolve) => {
      const desuscribir = suscribirseARecorridoActivo(() => {
        desuscribir();
        resolve(decidirCierrePorNoVigente(undefined));
      });
    });

    // FIX POST-REVISIÓN: este `true` es el veredicto REAL que `useGpsOperativo` publica cuando
    // el re-enganche resuelve con el plugin `enabled` — nunca el `false` prematuro del montaje
    // que causaba el bug (ver `veredictoPublicable`, `use-gps-operativo.ts`).
    marcarRecorridoActivoGlobal(true);

    await expect(veredicto).resolves.toEqual({ tipo: 'esperar_finalizar' });
  });

  it('sin publicación previa y luego publicar `false` (re-enganche sin nada que enganchar) resuelve "borrar"', async () => {
    expect(huboLecturaDeRecorridoActivo()).toBe(false);

    const veredicto = new Promise<VeredictoCierrePorNoVigente>((resolve) => {
      const desuscribir = suscribirseARecorridoActivo(() => {
        desuscribir();
        resolve(decidirCierrePorNoVigente(undefined));
      });
    });

    marcarRecorridoActivoGlobal(false);

    await expect(veredicto).resolves.toEqual({ tipo: 'borrar' });
  });
});
