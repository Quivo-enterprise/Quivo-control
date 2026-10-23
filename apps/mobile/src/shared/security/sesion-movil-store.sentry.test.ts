import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoOperativoMovil } from '@quivo/shared';

/** Las etiquetas de Sentry (placa/sesión) se ponen al guardar y restaurar la sesión y se limpian al borrarla. */
const almacenFalso = vi.hoisted(() => new Map<string, string>());
const etiquetar = vi.hoisted(() => vi.fn());

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
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => randomUUID()) }));
vi.mock('@sentry/react-native', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  ID_LEASE_REVOCACIONES_PENDIENTES: 'revocaciones-pendientes',
  TTL_LEASE_REVOCACIONES_PENDIENTES_MS: 3_000,
}));
vi.mock('../observability/sentry-contexto', () => ({ etiquetarSesionSentry: etiquetar }));

import { borrarSesionMovil, cargarSesionMovil, guardarSesionMovil } from './sesion-movil-store';
import type { SesionMovilGuardada } from './sesion-movil-store';

const contexto = {
  sesionId: randomUUID(),
  asignacion: {
    id: randomUUID(),
    fecha: '2026-10-22',
    horario: 'manana',
    venceAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  vehiculo: { id: randomUUID(), placa: '1234ABC', tipo: 'micro', marca: 'Toyota', modelo: 'Coaster' },
  conductor: { id: randomUUID(), nombre: 'Juan', documentoIdentidad: '1234567' },
  sindicato: { id: randomUUID(), nombre: 'Sindicato' },
  linea: { id: randomUUID(), codigo: '16', nombre: 'Línea 16', color: null },
  ruta: { id: randomUUID(), sentido: 'ida' },
} as ContextoOperativoMovil;

const sesion = {
  status: 'autenticado',
  accessToken: `access-${'x'.repeat(32)}`,
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: `refresh-${'x'.repeat(32)}`,
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  contexto,
} as SesionMovilGuardada;

describe('sesion-movil-store: etiquetas de Sentry', () => {
  beforeEach(() => {
    almacenFalso.clear();
    etiquetar.mockClear();
  });

  it('login y restauración etiquetan; borrar la sesión limpia', async () => {
    await guardarSesionMovil(sesion);
    expect(etiquetar).toHaveBeenLastCalledWith(contexto);

    etiquetar.mockClear();
    await cargarSesionMovil();
    expect(etiquetar).toHaveBeenLastCalledWith(contexto);

    await borrarSesionMovil();
    expect(etiquetar).toHaveBeenLastCalledWith(null);
  });
});
