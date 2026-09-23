import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ContextoOperativoMovil } from '@quivo/shared';

/**
 * G2 (hallazgo de `/codex-debug verify-fix`, ALTO): `reconciliarSesion` (`use-auth-movil.ts`)
 * llamaba a `guardarSesionMovil({ ...copiaVieja, contexto })` con una copia en memoria tomada
 * ANTES de `await authMovilApi.obtenerContexto(...)`. Si un refresh concurrente rotaba y
 * persistía T1 MIENTRAS ese `await` estaba en vuelo, ese `guardarSesionMovil` pisaba el disco
 * entero con los tokens VIEJOS (T0). Este archivo testea `actualizarContextoSesionMovil`
 * (`sesion-movil-store.ts`) contra un SecureStore FALSO (no mockea `cargarSesionMovil`/
 * `guardarSesionMovil` en sí — son las funciones bajo prueba, y necesitan ejercitar la
 * relectura REAL de disco para probar que preservan una rotación concurrente).
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

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => randomUUID()) }));

import {
  actualizarContextoSesionMovil,
  actualizarSesionMovil,
  cargarSesionMovil,
  guardarSesionMovil,
  type SesionMovilGuardada,
} from './sesion-movil-store';

function contexto(): ContextoOperativoMovil {
  return {
    sesionId: randomUUID(),
    asignacion: {
      id: randomUUID(),
      fecha: '2026-09-23',
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
    linea: {
      id: randomUUID(),
      codigo: '101',
      nombre: 'Línea 101',
      color: null,
    },
    ruta: { id: randomUUID(), sentido: 'ida' },
  } as ContextoOperativoMovil;
}

function sesion(refreshToken: string, overrides: Partial<SesionMovilGuardada> = {}): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: `access-${refreshToken}-${'x'.repeat(32)}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken: `${refreshToken}-${'x'.repeat(32)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: contexto(),
    ...overrides,
  } as SesionMovilGuardada;
}

describe('actualizarContextoSesionMovil — G2 (verify-fix): nunca pisa tokens rotados por un refresh concurrente', () => {
  beforeEach(() => {
    almacenFalso.clear();
  });

  it('relee disco (no la copia en memoria del caller) y fusiona SOLO el contexto nuevo', async () => {
    const original = sesion('T0');
    await guardarSesionMovil(original);

    const contextoNuevo = contexto();
    const resultado = await actualizarContextoSesionMovil(contextoNuevo);

    expect(resultado).not.toBeNull();
    expect(resultado?.contexto).toEqual(contextoNuevo);
    expect(resultado?.accessToken).toBe(original.accessToken);
    expect(resultado?.refreshToken).toBe(original.refreshToken);

    const enDisco = await cargarSesionMovil();
    expect(enDisco?.contexto).toEqual(contextoNuevo);
    expect(enDisco?.refreshToken).toBe(original.refreshToken);
  });

  it('un refresh que rota a T1 MIENTRAS obtenerContexto está en vuelo no se pierde — el bug real de G2', async () => {
    // T0 en disco, como si `reconciliarSesion` acabara de leerlo antes de empezar
    // `authMovilApi.obtenerContexto(...)` (el `await` largo que dispara la carrera).
    const t0 = sesion('T0');
    await guardarSesionMovil(t0);

    // Mientras esa llamada está "en vuelo", un refresh CONCURRENTE (otro contexto JS, o el
    // mismo bajo el lease `refresh-sesion`) rota y persiste T1 — vía `actualizarSesionMovil`,
    // el ÚNICO camino que debe tocar tokens.
    const tokensRotados = {
      accessToken: `access-T1-${'x'.repeat(32)}`,
      refreshToken: `T1-${'x'.repeat(32)}`,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const rotada = await actualizarSesionMovil(t0, tokensRotados);
    expect(rotada.refreshToken).toBe(tokensRotados.refreshToken);

    // Ahora "termina" la llamada de contexto que arrancó con la copia VIEJA (t0) en memoria —
    // el bug viejo hacía `guardarSesionMovil({ ...t0, contexto: nuevoContexto })` acá, pisando
    // T1 con T0. El fix relee disco DENTRO de `actualizarContextoSesionMovil`, así que nunca ve
    // `t0` para nada más que decidir qué NO tocar.
    const nuevoContexto = contexto();
    const resultado = await actualizarContextoSesionMovil(nuevoContexto);

    expect(resultado?.refreshToken).toBe(tokensRotados.refreshToken); // T1 preservado
    expect(resultado?.accessToken).toBe(tokensRotados.accessToken);
    expect(resultado?.contexto).toEqual(nuevoContexto);

    const enDisco = await cargarSesionMovil();
    expect(enDisco?.refreshToken).toBe(tokensRotados.refreshToken); // disco también preservó T1
  });

  it('sin sesión en disco (logout concurrente), devuelve null sin escribir nada', async () => {
    const resultado = await actualizarContextoSesionMovil(contexto());
    expect(resultado).toBeNull();
    expect(await cargarSesionMovil()).toBeNull();
  });
});
