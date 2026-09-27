import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { EstadoAuthMovil, useAuthMovil } from '../features/auth/use-auth-movil';
import type { SesionMovilGuardada } from '../shared/security/sesion-movil-store';
import { buscarCuenta, contextoDeCuenta } from './cuentas';

/**
 * Equivalente demo de `useAuthMovil` (`../features/auth/use-auth-movil.ts`) — MISMO contrato
 * exacto (`ReturnType<typeof useAuthMovil>`), para que `App.tsx` pueda elegir entre los dos a
 * nivel de módulo sin que el resto del árbol (`OperationNavigator`, `contextoDe`) sepa cuál está
 * corriendo. Nunca usa la etapa `'asignacion'` (cada placa jugable resuelve un único conductor
 * por PIN, sin selección de turno) — `seleccionarAsignacion` existe solo para cumplir el
 * contrato, nunca se llama en la práctica.
 *
 * `obtenerAccessToken` siempre resuelve `null` — a propósito: además de que el demo no tiene
 * backend, esto deja INERTES (sin editar sus archivos) los hooks/llamadas reales que siguen
 * siendo alcanzables desde las pantallas de operación (`useSyncStatus`, `ruteoApi.rutaAPunto`
 * en `operation-screen.tsx`) — todos gatean su llamada de red con `if (!token) return`, así que
 * un token `null` los deja sin efecto, sin red y sin ningún error visible. Ver el contrato
 * completo en `./index.ts`.
 */

const CLAVE_SESION_DEMO = 'quivo.demo.sesion.v1';
const DEVICE_ID_DEMO = 'quivo-demo-device-001';

interface SesionDemoGuardada {
  placa: string;
  pin: string;
}

const ESTADO_INICIAL_DEMO: EstadoAuthMovil = {
  etapa: 'restaurando',
  cargando: false,
  error: null,
  aviso: null,
  sesionNoRevalidada: false,
  sesionIrrecuperable: false,
  sesionNoVigente: false,
  seleccionToken: null,
  asignaciones: [],
  sesion: null,
  deviceId: null,
};

/** Mismo mensaje que ve el chofer en el login real ante un 401 (`AuthMovilApiError.userMessage`,
 * `../shared/api/auth-movil-api.ts`: `if (this.status === 401) return 'Las credenciales no son
 * válidas.'`) — el backend real distingue placa/PIN internamente, pero el cliente SIEMPRE
 * traduce cualquier 401 a este mismo texto genérico; el demo hace lo mismo por el mismo motivo
 * de seguridad (no darle a nadie pistas de cuál de los dos falló). */
const ERROR_CREDENCIALES_INVALIDAS = 'Las credenciales no son válidas.';

/** FIX POST-REVISIÓN (hallazgo de revisión — "AsyncStorage sin try/catch"): antes `await
 * AsyncStorage.setItem(...)`/`await AsyncStorage.removeItem(...)` no tenían ningún `catch` — un
 * fallo del storage (disco lleno, permiso revocado, corrupción) tiraba una excepción sin manejar
 * que dejaba `cargando: true` para siempre (el spinner del login/logout nunca se apagaba) sin
 * ningún mensaje visible para el chofer. Mismo estilo de mensaje que `ERROR_CREDENCIALES_INVALIDAS`
 * de arriba (frase corta, en español, termina en punto). */
const ERROR_GUARDADO_SESION = 'No se pudo guardar la sesión. Probá de nuevo.';
const ERROR_CIERRE_SESION = 'No se pudo cerrar la sesión. Probá de nuevo.';

/** Resultado de una escritura/borrado en AsyncStorage — nunca lanza, siempre resuelve. Extraído
 * del hook (funciones puras, sin `useState`/`useCallback`) para poder testear el try/catch con
 * `vitest` sin necesitar un renderer de React (no hay ninguno instalado en este paquete — ver
 * `use-auth-movil-demo.test.ts`). */
type ResultadoStorage = { ok: true } | { ok: false; error: string };

/** `AsyncStorage.setItem` de la sesión demo, con `catch` — ver el docblock de `ERROR_GUARDADO_SESION`. */
export async function persistirSesionDemo(cuenta: { placaNormalizada: string; pin: string }): Promise<ResultadoStorage> {
  try {
    await AsyncStorage.setItem(
      CLAVE_SESION_DEMO,
      JSON.stringify({ placa: cuenta.placaNormalizada, pin: cuenta.pin } satisfies SesionDemoGuardada),
    );
    return { ok: true };
  } catch (error) {
    console.error('[QUIVO][auth-demo] No se pudo persistir la sesión demo', error);
    return { ok: false, error: ERROR_GUARDADO_SESION };
  }
}

/** `AsyncStorage.removeItem` de la sesión demo, con `catch` — ver el docblock de `ERROR_CIERRE_SESION`. */
export async function borrarSesionDemo(): Promise<ResultadoStorage> {
  try {
    await AsyncStorage.removeItem(CLAVE_SESION_DEMO);
    return { ok: true };
  } catch (error) {
    console.error('[QUIVO][auth-demo] No se pudo cerrar la sesión demo', error);
    return { ok: false, error: ERROR_CIERRE_SESION };
  }
}

function sesionDesdeContexto(contexto: ContextoOperativoMovil, ahora: number): SesionMovilGuardada {
  const expiresAt = new Date(ahora + 24 * 60 * 60 * 1000).toISOString();
  return {
    status: 'autenticado',
    accessToken: 'quivo-demo-access-token-0000000000',
    refreshToken: 'quivo-demo-refresh-token-0000000000',
    accessTokenExpiresAt: expiresAt,
    refreshTokenExpiresAt: expiresAt,
    contexto,
  };
}

export function useAuthMovilDemo(): ReturnType<typeof useAuthMovil> {
  const [estado, setEstado] = useState<EstadoAuthMovil>(ESTADO_INICIAL_DEMO);
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );

  // Restaura la sesión demo guardada (equivalente a `restaurarSesion` del hook real) — sin
  // esto, matar y reabrir la app volvería siempre a la pantalla de login.
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const irAVehiculo = () => {
        if (!cancelado) setEstado((actual) => ({ ...actual, etapa: 'vehiculo', deviceId: DEVICE_ID_DEMO }));
      };
      try {
        const guardado = await AsyncStorage.getItem(CLAVE_SESION_DEMO);
        if (cancelado) return;
        if (!guardado) return irAVehiculo();
        const sesionGuardada = JSON.parse(guardado) as SesionDemoGuardada;
        const cuenta = buscarCuenta(sesionGuardada.placa, sesionGuardada.pin);
        if (!cuenta) return irAVehiculo();
        const contexto = contextoDeCuenta(cuenta, Date.now());
        if (!cancelado) {
          setEstado({
            ...ESTADO_INICIAL_DEMO,
            etapa: 'operacion',
            deviceId: DEVICE_ID_DEMO,
            sesion: sesionDesdeContexto(contexto, Date.now()),
          });
        }
      } catch {
        irAVehiculo();
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const autenticarSesion = useCallback(async (placa: string, pin: string) => {
    setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    const cuenta = buscarCuenta(placa, pin);
    if (!cuenta) {
      if (montado.current) {
        setEstado((actual) => ({ ...actual, cargando: false, error: ERROR_CREDENCIALES_INVALIDAS }));
      }
      return;
    }
    const ahora = Date.now();
    const contexto = contextoDeCuenta(cuenta, ahora);
    const resultado = await persistirSesionDemo(cuenta);
    if (!resultado.ok) {
      if (montado.current) {
        setEstado((actual) => ({ ...actual, cargando: false, error: resultado.error }));
      }
      return;
    }
    if (!montado.current) return;
    setEstado({
      ...ESTADO_INICIAL_DEMO,
      etapa: 'operacion',
      deviceId: DEVICE_ID_DEMO,
      sesion: sesionDesdeContexto(contexto, ahora),
    });
  }, []);

  // Nunca se usa en la práctica (ver el docblock de arriba) — solo para cumplir el contrato.
  const seleccionarAsignacion = useCallback(async (_asignacionId: string) => {}, []);

  const volverAVehiculo = useCallback(() => {
    setEstado((actual) => ({ ...actual, etapa: 'vehiculo', seleccionToken: null, asignaciones: [], error: null }));
  }, []);

  const logout = useCallback(async () => {
    const resultado = await borrarSesionDemo();
    if (!resultado.ok) {
      // Mismo criterio que `logout()` real (`use-auth-movil.ts`): si el storage falló, la
      // sesión local sigue viva (`removeItem` no llegó a ejecutarse del todo) — resetear
      // `estado` igual desincronizaría la UI del almacenamiento real (el chofer vería la
      // pantalla de login, pero `restaurarSesion` lo volvería a meter a `operacion` en el
      // próximo arranque). Se informa el error y se deja la sesión intacta para reintentar.
      if (montado.current) {
        setEstado((actual) => ({ ...actual, cargando: false, error: resultado.error }));
      }
      return;
    }
    if (montado.current) setEstado({ ...ESTADO_INICIAL_DEMO, etapa: 'vehiculo', deviceId: DEVICE_ID_DEMO });
  }, []);

  const obtenerAccessToken = useCallback(async () => null, []);

  // El demo nunca produce SESION_NO_VIGENTE (no hay backend que revoque sesiones) — no-op de
  // contrato, nunca se llama en la práctica.
  const finalizarTrasSesionNoVigente = useCallback(async () => {}, []);

  return {
    estado,
    autenticarSesion,
    seleccionarAsignacion,
    volverAVehiculo,
    logout,
    obtenerAccessToken,
    finalizarTrasSesionNoVigente,
  };
}
