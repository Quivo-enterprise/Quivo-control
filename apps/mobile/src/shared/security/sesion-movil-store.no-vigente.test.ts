import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ContextoOperativoMovil } from '@quivo/shared';

/**
 * Rescope SESION_NO_VIGENTE (decisión del CTO, code review de `fix/sesion-no-vigente`): la
 * marca durable keyed por refresh token (`marcarSesionNoVigenteHeadless`/
 * `haySesionNoVigenteParaToken`) que reemplaza el borrado directo de la sesión en
 * `obtenerAccessTokenHeadless` (`headless-task.ts`). Mismo SecureStore FALSO que
 * `sesion-movil-store.contexto.test.ts` — necesitamos la relectura REAL de disco para probar
 * que un login nuevo (`guardarSesionMovil`) borra la marca de verdad.
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
  borrarSesionNoVigenteMarcada,
  guardarSesionMovil,
  haySesionNoVigenteParaToken,
  marcarSesionNoVigenteHeadless,
  obtenerSesionNoVigenteMarcada,
  type SesionMovilGuardada,
} from './sesion-movil-store';

function contexto(): ContextoOperativoMovil {
  return {
    sesionId: randomUUID(),
    asignacion: {
      id: randomUUID(),
      fecha: '2026-09-26',
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
    linea: { id: randomUUID(), codigo: '101', nombre: 'Línea 101', color: null },
    ruta: { id: randomUUID(), sentido: 'ida' },
  } as ContextoOperativoMovil;
}

function sesion(refreshToken: string): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: `access-${refreshToken}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: contexto(),
  } as SesionMovilGuardada;
}

describe('marca SESION_NO_VIGENTE (sesion-movil-store)', () => {
  beforeEach(() => {
    almacenFalso.clear();
  });

  it('sin ninguna marca puesta, haySesionNoVigenteParaToken devuelve false', async () => {
    await expect(haySesionNoVigenteParaToken('refresh-1')).resolves.toBe(false);
    await expect(obtenerSesionNoVigenteMarcada()).resolves.toBeNull();
  });

  it('marca y lee — round-trip básico', async () => {
    await marcarSesionNoVigenteHeadless('refresh-1');
    await expect(haySesionNoVigenteParaToken('refresh-1')).resolves.toBe(true);
    await expect(obtenerSesionNoVigenteMarcada()).resolves.toEqual({ refreshToken: 'refresh-1' });
  });

  it('keyed por token: la marca para "refresh-1" no aplica a "refresh-2"', async () => {
    await marcarSesionNoVigenteHeadless('refresh-1');
    await expect(haySesionNoVigenteParaToken('refresh-2')).resolves.toBe(false);
  });

  it('borrarSesionNoVigenteMarcada limpia la marca', async () => {
    await marcarSesionNoVigenteHeadless('refresh-1');
    await borrarSesionNoVigenteMarcada();
    await expect(haySesionNoVigenteParaToken('refresh-1')).resolves.toBe(false);
  });

  /**
   * B/C del rescope: un login nuevo trae un refreshToken DISTINTO al que quedó marcado por un
   * tick headless anterior — `guardarSesionMovil` debe borrar la marca vieja para que no
   * sobreviva a la sesión nueva (doble protección: además, cualquier lector la ignoraría por
   * `haySesionNoVigenteParaToken` comparando contra el token vigente, pero el borrado explícito
   * es la primera línea de defensa).
   */
  it('guardarSesionMovil (login nuevo) borra la marca dejada por un token anterior', async () => {
    await marcarSesionNoVigenteHeadless('refresh-viejo');
    await expect(haySesionNoVigenteParaToken('refresh-viejo')).resolves.toBe(true);

    await guardarSesionMovil(sesion('refresh-nuevo'));

    await expect(obtenerSesionNoVigenteMarcada()).resolves.toBeNull();
    await expect(haySesionNoVigenteParaToken('refresh-viejo')).resolves.toBe(false);
  });
});
