import { describe, expect, it, vi } from 'vitest';

// `use-auth-movil.ts` importa `sesion-movil-store` (expo-secure-store/expo-crypto, nativos) y
// `@sentry/react-native` a nivel de módulo — sin mockearlos acá el import del hook revienta en
// vitest (sin runtime nativo). Mismo patrón que `use-auth-movil.obtener-access-token.test.ts`.
vi.mock('../../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

// G1 (hallazgo de `/codex-debug verify-fix`): `use-auth-movil.ts` importa `db/outbox` (lease
// `refresh-sesion`, vía `expo-sqlite`) — mismo motivo de mock que `sesion-movil-store`, ver
// `use-auth-movil.refrescar.test.ts`. Este archivo solo ejercita una función pura
// (`debeRestaurarComoDeslogueado`), pero importar el módulo igual evalúa sus imports.
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

import { hayLogoutSolicitado } from '../../shared/security/sesion-movil-store';
import { debeRestaurarComoDeslogueado } from './use-auth-movil';

const hayLogoutSolicitadoMock = hayLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;

/**
 * Fix drenado en background (2026-09-25, crítico): `restaurarSesion` (dentro de `useAuthMovil`)
 * no consultaba `hayLogoutSolicitado()` antes de restaurar la sesión guardada — un logout que
 * quedó `'pendiente'` (no consiguió el lease `refresh-sesion`, ver `ejecutarLogout`) deja la
 * marca puesta pero la sesión INTACTA en disco, y sin este chequeo `restaurarSesion` la volvía
 * a cargar tal cual: un chofer que cerró sesión quedaba re-logueado al reabrir la app, crítico
 * en teléfonos compartidos entre choferes.
 *
 * `debeRestaurarComoDeslogueado` es la decisión extraída a standalone que resuelve esto — se
 * testea acá en vez de renderizar el hook porque `apps/mobile` no tiene arnés jest-expo/RNTL
 * (ver el comentario de `clasificarFalloAccessToken` en `use-auth-movil.ts`). El call site en
 * `restaurarSesion` corre esta función ANTES de `cargarSesionMovil()` — cuando devuelve `true`,
 * la sesión en disco ni siquiera se lee, así que queda intacta por construcción (el borrado
 * real sigue siendo exclusivo de `ejecutarLogout`, vía `intentarRevocacionesPendientes`).
 */
describe('debeRestaurarComoDeslogueado', () => {
  it('con la marca de logout pendiente presente, devuelve true (tratar como deslogueado)', async () => {
    hayLogoutSolicitadoMock.mockResolvedValue(true);

    await expect(debeRestaurarComoDeslogueado()).resolves.toBe(true);
  });

  it('sin marca de logout pendiente, devuelve false (comportamiento actual: restaurar)', async () => {
    hayLogoutSolicitadoMock.mockResolvedValue(false);

    await expect(debeRestaurarComoDeslogueado()).resolves.toBe(false);
  });

  it('fail-closed: si la lectura de la marca falla, devuelve true igual', async () => {
    hayLogoutSolicitadoMock.mockRejectedValue(new Error('SecureStore no disponible'));

    await expect(debeRestaurarComoDeslogueado()).resolves.toBe(true);
  });
});
