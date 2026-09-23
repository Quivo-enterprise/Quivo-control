import { describe, expect, it, vi } from 'vitest';

// `use-auth-movil.ts` importa `sesion-movil-store` (expo-secure-store/expo-crypto, nativos) y
// `@sentry/react-native` a nivel de módulo — sin mockearlos acá el import del hook revienta en
// vitest (sin runtime nativo). Mismo patrón que `use-auth-movil.refrescar.test.ts`.
// `../../shared/api/auth-movil-api` NO se mockea: no tiene dependencias nativas y acá hace
// falta la clase `AuthMovilApiError` real para construir los `instanceof` que
// `clasificarFalloAccessToken` evalúa.
vi.mock('../../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarSesionMovil: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

// G1 (hallazgo de `/codex-debug verify-fix`): `use-auth-movil.ts` ahora importa `db/outbox`
// (lease `refresh-sesion`, vía `expo-sqlite`) — mismo motivo de mock que `sesion-movil-store`,
// ver `use-auth-movil.refrescar.test.ts`. Este archivo solo ejercita funciones puras
// (`clasificarFalloAccessToken`), pero importar el módulo igual evalúa sus imports.
vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 15_000,
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
}));

import { AuthMovilApiError } from '../../shared/api/auth-movil-api';
import {
  UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA,
  clasificarFalloAccessToken,
} from './use-auth-movil';

/**
 * Cubre el bug de QA 2026-08-23 (401 permanente en `/refresh` cada 15s durante 42 min, sin
 * ninguna señal en pantalla): `obtenerAccessToken` (dentro de `useAuthMovil`) trataba
 * cualquier fallo del refresh como offline silencioso. El fix vive en `clasificarFalloAccessToken`
 * (`use-auth-movil.ts`) — se testea esa función pura en vez de renderizar el hook porque
 * `apps/mobile` todavía no tiene arnés jest-expo/RNTL (docs/plan-movil-login-y-pruebas.md,
 * ítem 7-8): no hay forma de montar un hook de React con vitest+DOM en este paquete hoy. El
 * apagado de la bandera en un refresh exitoso posterior es una asignación trivial
 * (`fallos401Acumulados.current = 0` + `sesionNoRevalidada: false`) dentro del propio hook,
 * sin lógica de clasificación que valga la pena aislar — se verifica leyendo el código de
 * `obtenerAccessToken`, no con un test aparte.
 */
describe('clasificarFalloAccessToken', () => {
  it('un único 401 NO alcanza el umbral (protege la ventana de carrera de reconciliarSesion, ver el comentario del umbral)', () => {
    const error = new AuthMovilApiError('http', 'Sesión móvil inválida o expirada', 401);
    const resultado = clasificarFalloAccessToken(error, 0);
    expect(resultado.fallos401Acumulados).toBe(1);
    expect(resultado.marcarSesionNoRevalidada).toBe(false);
  });

  it(`${UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA} fallos 401 seguidos (sin red en el medio) prenden la bandera`, () => {
    let fallos = 0;
    let marcar = false;
    for (let i = 0; i < UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA; i++) {
      const error = new AuthMovilApiError('http', 'Sesión móvil inválida o expirada', 401);
      ({ fallos401Acumulados: fallos, marcarSesionNoRevalidada: marcar } =
        clasificarFalloAccessToken(error, fallos));
    }
    expect(fallos).toBe(UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA);
    expect(marcar).toBe(true);
  });

  it('un 401 permanente (bug QA: 42 min seguidos) sigue prendiendo la bandera en cada ciclo posterior, no solo una vez', () => {
    let fallos = 0;
    let marcar = false;
    // Simula 10 ciclos de sync seguidos recibiendo 401 (como en producción).
    for (let i = 0; i < 10; i++) {
      const error = new AuthMovilApiError('http', 'Sesión móvil inválida o expirada', 401);
      ({ fallos401Acumulados: fallos, marcarSesionNoRevalidada: marcar } =
        clasificarFalloAccessToken(error, fallos));
    }
    expect(marcar).toBe(true);
  });

  it('un error de red (offline legítimo) NO prende la bandera ni suma al contador', () => {
    const errorRed = new AuthMovilApiError('network', 'Error de red');
    const resultado = clasificarFalloAccessToken(errorRed, 0);
    expect(resultado.fallos401Acumulados).toBe(0);
    expect(resultado.marcarSesionNoRevalidada).toBe(false);
  });

  it('un error de red intercalado entre 401s no prende la bandera por sí solo (no resetea el contador)', () => {
    const error401 = new AuthMovilApiError('http', 'Sesión móvil inválida o expirada', 401);
    const errorRed = new AuthMovilApiError('network', 'Error de red');

    const paso1 = clasificarFalloAccessToken(error401, 0);
    expect(paso1.marcarSesionNoRevalidada).toBe(false);

    const paso2 = clasificarFalloAccessToken(errorRed, paso1.fallos401Acumulados);
    expect(paso2.marcarSesionNoRevalidada).toBe(false);
    expect(paso2.fallos401Acumulados).toBe(paso1.fallos401Acumulados);
  });

  // H4 (hallazgo de revisión, medio): el test anterior frenaba justo un paso antes de probar
  // lo que en realidad importa. Semántica elegida (b, ver el comentario de
  // `UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA` en use-auth-movil.ts): el corte de red NO
  // resetea el contador, así que el 401 de DESPUÉS del corte sí debe completar el umbral y
  // prender la alerta — una sesión revocada sigue revocada del otro lado de un corte de red.
  it('401 → red → 401 SÍ completa el umbral y prende la bandera (semántica (b): la red no resetea la racha)', () => {
    const error401 = new AuthMovilApiError('http', 'Sesión móvil inválida o expirada', 401);
    const errorRed = new AuthMovilApiError('network', 'Error de red');

    const paso1 = clasificarFalloAccessToken(error401, 0);
    expect(paso1.marcarSesionNoRevalidada).toBe(false);

    const paso2 = clasificarFalloAccessToken(errorRed, paso1.fallos401Acumulados);
    expect(paso2.marcarSesionNoRevalidada).toBe(false);

    const paso3 = clasificarFalloAccessToken(error401, paso2.fallos401Acumulados);
    expect(paso3.fallos401Acumulados).toBe(UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA);
    expect(paso3.marcarSesionNoRevalidada).toBe(true);
  });

  it('un error sin status (contract/configuration) tampoco prende la bandera', () => {
    const errorContrato = new AuthMovilApiError(
      'contract',
      'La respuesta de la API no cumple el contrato móvil',
    );
    const resultado = clasificarFalloAccessToken(errorContrato, 1);
    expect(resultado.marcarSesionNoRevalidada).toBe(false);
    expect(resultado.fallos401Acumulados).toBe(1);
  });

  it('un error genérico (no AuthMovilApiError) tampoco prende la bandera', () => {
    const resultado = clasificarFalloAccessToken(new Error('boom'), 0);
    expect(resultado.marcarSesionNoRevalidada).toBe(false);
    expect(resultado.fallos401Acumulados).toBe(0);
  });
});
