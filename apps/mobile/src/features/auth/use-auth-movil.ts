import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import type {
  AuthVehiculoMovilResponse,
  ContextoOperativoMovil,
  ResumenAsignacionMovil,
} from '@quivo/shared';
import { AuthMovilApiError, authMovilApi } from '../../shared/api/auth-movil-api';
import {
  actualizarSesionMovil,
  borrarSesionMovil,
  cargarSesionMovil,
  guardarSesionMovil,
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';

export type EtapaAuthMovil = 'restaurando' | 'vehiculo' | 'conductor' | 'asignacion' | 'operacion';

export interface EstadoAuthMovil {
  etapa: EtapaAuthMovil;
  cargando: boolean;
  error: string | null;
  aviso: string | null;
  /** A5 (hallazgo de revisión, alto): distinto de `aviso` — se enciende cuando
   * `refrescarConReintentos` agota el backoff DE VERDAD (4 intentos, ~40 s) tras un 401 al
   * validar la sesión restaurada. El `aviso` genérico de "sin red" es engañoso acá: si la
   * sesión fue cerrada server-side (no una caída de red), el sync NUNCA se va a restablecer
   * solo — hace falta que el chofer vuelva a iniciar sesión. Nunca se borra la sesión
   * automáticamente por esto (ver el comentario de `refrescarConReintentos`); esta bandera solo
   * se apaga con un login nuevo exitoso, un `logout()` manual, o si un refresh posterior
   * (`obtenerAccessToken`) vuelve a tener éxito.
   */
  sesionNoRevalidada: boolean;
  vehiculo: AuthVehiculoMovilResponse | null;
  asignaciones: ResumenAsignacionMovil[];
  sesion: SesionMovilGuardada | null;
  deviceId: string | null;
}

const ESTADO_INICIAL: EstadoAuthMovil = {
  etapa: 'restaurando',
  cargando: false,
  error: null,
  aviso: null,
  sesionNoRevalidada: false,
  vehiculo: null,
  asignaciones: [],
  sesion: null,
  deviceId: null,
};

export function useAuthMovil() {
  const [estado, setEstado] = useState<EstadoAuthMovil>(ESTADO_INICIAL);
  const mounted = useRef(true);
  const deviceId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    void restaurarSesion();
    return () => {
      mounted.current = false;
    };

    async function restaurarSesion() {
      try {
        deviceId.current = await obtenerDeviceIdMovil();
        setEstado((actual) => ({ ...actual, deviceId: deviceId.current }));
        const guardada = await cargarSesionMovil();
        if (!mounted.current) return;
        
        // Validar que la sesión no esté vencida y que no tenga una estructura corrupta
        if (
          !guardada || 
          !guardada.contexto?.conductor || 
          !guardada.contexto?.asignacion?.horario ||
          new Date(guardada.refreshTokenExpiresAt) <= new Date()
        ) {
          if (guardada) await borrarSesionMovil();
          setEstado((actual) => ({ ...actual, etapa: 'vehiculo', sesion: null }));
          return;
        }

        // El contexto cacheado permite continuar el recorrido aunque la app se abra sin red.
        setEstado((actual) => ({ ...actual, etapa: 'operacion', sesion: guardada }));
        void reconciliarSesion(guardada);
      } catch {
        if (mounted.current) {
          setEstado((actual) => ({
            ...actual,
            etapa: 'vehiculo',
            error: 'No se pudo abrir el almacenamiento seguro del dispositivo.',
          }));
        }
      }
    }

    async function reconciliarSesion(guardada: SesionMovilGuardada) {
      // A4 (hallazgo de revisión CRÍTICO): `vigente` vive en el scope de la FUNCIÓN, no del
      // `try` de abajo — así el `catch` puede reintentar con el refresh token YA ROTADO si
      // `refrescar(guardada)` tuvo éxito acá pero `obtenerContexto` falló después con 401, en
      // vez de reintentar con `guardada`, cuyo refresh token el servidor ya invalidó al
      // rotarlo. El bug real: `refrescar(guardada)` rota y persiste en disco;
      // `obtenerContexto` devuelve 401; el `catch` reintentaba con el refresh VIEJO (~40 s,
      // los 4 intentos), todos fallaban, se degradaba a offline, y `estado.sesion` quedaba con
      // los tokens VIEJOS mientras el disco ya tenía los nuevos — `obtenerAccessToken` (que
      // compara contra `estado.sesion`, nunca contra disco) devolvía `null` para siempre y el
      // sync no volvía a correr hasta reiniciar la app.
      let vigente = guardada;
      try {
        if (new Date(guardada.accessTokenExpiresAt) <= new Date()) {
          vigente = await refrescar(guardada);
          if (!mounted.current) return;
          // Persistir el estado con los tokens ROTADOS en cuanto el refresh tiene éxito, sin
          // esperar a que `obtenerContexto` (la llamada de abajo) también funcione: si esa
          // llamada falla con algo que NO sea 401 (offline puntual), el `catch` genérico de
          // más abajo solo pone el aviso de "trabajando offline" y nunca toca `estado.sesion`
          // — sin este `setEstado` acá, los tokens rotados quedarían solo en disco (`refrescar`
          // ya los persiste vía `actualizarSesionMovil`) pero no en memoria.
          setEstado((actual) => ({ ...actual, sesion: vigente }));
        }
        const contexto = await authMovilApi.obtenerContexto(vigente.accessToken);
        if (!mounted.current) return;
        const actualizada = { ...vigente, contexto };
        await guardarSesionMovil(actualizada);
        setEstado((actual) => ({ ...actual, sesion: actualizada, aviso: null }));
      } catch (error: unknown) {
        if (!mounted.current) return;
        if (error instanceof AuthMovilApiError && error.status === 401) {
          // Plan §2.4.1: antes, CUALQUIER fallo del refresh que no fuera `kind: 'network'`
          // (incluido otro 401 llano) disparaba `borrarSesionMovil()` en el primer intento.
          // Eso desmontaba `GpsProvider`, removía la suscripción `onLocation` (el SDK nativo
          // seguía grabando, pero nadie copiaba al outbox) y habilitaba el `stop()` headless
          // irreversible en el próximo tick — la causa confirmada de las 8 sesiones abiertas
          // sin cerrar en producción. `refrescarConReintentos` reintenta con backoff antes
          // de rendirse, y si igual falla, NUNCA borra la sesión automáticamente acá — ver
          // su comentario para el porqué (el servidor no distingue repudio real de un 401
          // transitorio). Reintenta con `vigente` — ya rotado si el `refrescar` de arriba
          // tuvo éxito — nunca con `guardada` (A4, ver el comentario de arriba).
          const revalidada = await refrescarConReintentos(vigente);
          if (!revalidada) {
            // A5 (hallazgo de revisión, alto): el backoff se agotó DE VERDAD (4 intentos,
            // ~40 s) sin lograr revalidar. El aviso genérico de "sin red" es FALSO acá si la
            // sesión fue cerrada server-side: `sincronizarPendientes` va a recibir 401 en cada
            // ciclo para siempre y el sync NUNCA se va a restablecer solo — hace falta que el
            // chofer vuelva a iniciar sesión. Bandera nueva y distinta (`sesionNoRevalidada`)
            // en vez de reusar `aviso`: la UI (`operation-screen.tsx`) la renderiza como
            // alerta con CTA explícito, no como el mismo texto casi idéntico al de "sin red".
            // La sesión NO se borra acá (misma decisión que arriba) — el chofer sigue pudiendo
            // operar offline, solo que ahora sabe que necesita volver a loguearse para que
            // sincronice.
            if (mounted.current) {
              setEstado((actual) => ({ ...actual, sesionNoRevalidada: true, aviso: null }));
            }
            return;
          }
          try {
            const contexto = await authMovilApi.obtenerContexto(revalidada.accessToken);
            if (!mounted.current) return;
            const actualizada = { ...revalidada, contexto };
            await guardarSesionMovil(actualizada);
            setEstado((actual) => ({ ...actual, sesion: actualizada, aviso: null }));
          } catch {
            // El refresh de tokens SÍ funcionó (ya persistido dentro de `refrescar`, vía
            // `actualizarSesionMovil`) pero traer el contexto falló (offline puntual, etc.):
            // se degrada a offline con la sesión (y los tokens nuevos) intactos, nunca se
            // borra nada acá tampoco.
            if (mounted.current) {
              setEstado((actual) => ({
                ...actual,
                sesion: revalidada,
                aviso: 'Trabajando offline. Los eventos quedarán pendientes de sincronización.',
              }));
            }
          }
          return;
        }
        setEstado((actual) => ({
          ...actual,
          aviso: 'Trabajando offline. Los eventos quedarán pendientes de sincronización.',
        }));
      }
    }
  }, []);

  /** Backoff exponencial (plan §2.4.1) para el `refresh()` disparado por un 401 al validar
   * la sesión restaurada: 3 reintentos a 2 s, 8 s y 30 s antes de rendirse. Nunca lanza —
   * devuelve `null` si los 4 intentos (el original + 3 reintentos) fallan, y el caller
   * decide degradar a offline sin borrar la sesión local.
   *
   * Por qué nunca borra automáticamente ni siquiera al agotar los reintentos: revisado
   * `authMovilApi.refresh` / `AuthMovilApiError` (`shared/api/auth-movil-api.ts`) y
   * `AuthMovilService.refresh` (`apps/api/.../auth-movil.service.ts`) — el servidor tira el
   * MISMO 401 genérico (`UnauthorizedException`) para sesión no encontrada, revocada,
   * inactiva o con el refresh token vencido; no existe un código (403 u otro) que distinga
   * "repudio permanente" de "token vencido"/"caída de red temporal". Sin esa señal
   * inequívoca, borrar acá arriesga cortar una sesión válida por una falla transitoria —
   * exactamente el bug que este fix cierra. El logout manual (`logout()`, abajo) sigue
   * siendo la ÚNICA vía para borrar la sesión de verdad. Si el servidor llega a exponer esa
   * señal en el futuro (p. ej. un 403 específico de "sesión reemplazada por login nuevo",
   * ver plan §2.4.5), ahí sí correspondería un borrado automático acotado a ese código.
   */
  async function refrescarConReintentos(
    guardada: SesionMovilGuardada,
  ): Promise<SesionMovilGuardada | null> {
    const esperasMs = [2_000, 8_000, 30_000];
    let ultimoError: unknown;
    for (let intento = 0; intento <= esperasMs.length; intento++) {
      try {
        return await refrescar(guardada);
      } catch (error) {
        ultimoError = error;
        if (!mounted.current) return null;
        if (intento < esperasMs.length) {
          await new Promise((resolve) => setTimeout(resolve, esperasMs[intento]));
        }
      }
    }
    Sentry.captureException(ultimoError, {
      tags: { contexto: 'auth-movil', paso: 'refresh-agotado' },
      extra: { reintentos: esperasMs.length },
    });
    return null;
  }

  const autenticarVehiculo = useCallback(async (placa: string, pin: string) => {
    await ejecutar(async () => {
      const instalacionId = await asegurarDeviceId();
      const vehiculo = await authMovilApi.autenticarVehiculo({
        placa,
        pin,
        deviceId: instalacionId,
      });
      setEstado((actual) => ({ ...actual, etapa: 'conductor', vehiculo, asignaciones: [] }));
    });
  }, []);

  const autenticarConductor = useCallback(
    async (documentoIdentidad: string, pin: string) => {
      await ejecutar(async () => {
        const actual = obtenerDesafio(estado);
        const respuesta = await authMovilApi.autenticarConductor({
          challengeToken: actual.challengeToken,
          deviceId: await asegurarDeviceId(),
          documentoIdentidad,
          pin,
        });
        if (respuesta.status === 'seleccion_requerida') {
          setEstado((previo) => ({
            ...previo,
            etapa: 'asignacion',
            asignaciones: respuesta.asignaciones,
          }));
          return;
        }
        await guardarSesionMovil(respuesta);
        setEstado((previo) => ({ ...previo, etapa: 'operacion', sesion: respuesta }));
      });
    },
    [estado],
  );

  const seleccionarAsignacion = useCallback(
    async (asignacionId: string) => {
      await ejecutar(async () => {
        const actual = obtenerDesafio(estado);
        const respuesta = await authMovilApi.autenticarConductor({
          challengeToken: actual.challengeToken,
          deviceId: await asegurarDeviceId(),
          asignacionId,
        });
        if (respuesta.status !== 'autenticado') {
          throw new Error('La asignación no pudo confirmarse');
        }
        await guardarSesionMovil(respuesta);
        setEstado((previo) => ({ ...previo, etapa: 'operacion', sesion: respuesta }));
      });
    },
    [estado],
  );

  const volverAVehiculo = useCallback(() => {
    setEstado((actual) => ({
      ...actual,
      etapa: 'vehiculo',
      vehiculo: null,
      asignaciones: [],
      error: null,
    }));
  }, []);

  const logout = useCallback(async () => {
    setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    const refreshToken = estado.sesion?.refreshToken;
    if (refreshToken) {
      try {
        await authMovilApi.logout(refreshToken);
      } catch {
        // La limpieza local siempre se ejecuta; la sesión expira/revoca server-side después.
      }
    }
    await borrarSesionMovil();
    if (mounted.current) setEstado({ ...ESTADO_INICIAL, etapa: 'vehiculo' });
  }, [estado.sesion?.refreshToken]);

  /** Access token vigente para llamadas propias de la pantalla de operación (paquete del
   * día QUI-236, sync QUI-240) — refresca sola si ya venció, sin duplicar la lógica de
   * `reconciliarSesion`. Devuelve `null` sin sesión o si el refresh falla (offline). */
  const obtenerAccessToken = useCallback(async (): Promise<string | null> => {
    const sesion = estado.sesion;
    if (!sesion) return null;
    if (new Date(sesion.accessTokenExpiresAt) > new Date()) {
      return sesion.accessToken;
    }
    try {
      const actualizada = await refrescar(sesion);
      // A5: un refresh posterior exitoso es evidencia de que la sesión SÍ es válida de nuevo
      // (el servidor la aceptó) — apaga la alerta de "no se pudo revalidar" si había quedado
      // prendida, en vez de dejarla pegada hasta el próximo login manual.
      if (mounted.current) {
        setEstado((actual) => ({ ...actual, sesion: actualizada, sesionNoRevalidada: false }));
      }
      return actualizada.accessToken;
    } catch {
      return null;
    }
  }, [estado.sesion]);

  async function ejecutar(accion: () => Promise<void>): Promise<void> {
    setEstado((actual) => ({ ...actual, cargando: true, error: null, aviso: null }));
    try {
      await accion();
    } catch (error: unknown) {
      if (!mounted.current) return;
      setEstado((actual) => ({ ...actual, error: mensajeUsuario(error) }));
    } finally {
      if (mounted.current) setEstado((actual) => ({ ...actual, cargando: false }));
    }
  }

  async function asegurarDeviceId(): Promise<string> {
    deviceId.current ??= await obtenerDeviceIdMovil();
    setEstado((actual) => ({ ...actual, deviceId: deviceId.current }));
    return deviceId.current;
  }

  return {
    estado,
    autenticarVehiculo,
    autenticarConductor,
    seleccionarAsignacion,
    volverAVehiculo,
    logout,
    obtenerAccessToken,
  };
}

function obtenerDesafio(estado: EstadoAuthMovil): AuthVehiculoMovilResponse {
  if (!estado.vehiculo) throw new Error('La validación del vehículo expiró. Vuelve a comenzar.');
  if (new Date(estado.vehiculo.expiresAt) <= new Date()) {
    throw new Error('La validación del vehículo expiró. Vuelve a comenzar.');
  }
  return estado.vehiculo;
}

/** Hallazgo ALTO (piloto día 1, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): los refresh
 * tokens rotan del lado del servidor — una segunda llamada a `authMovilApi.refresh()` con el
 * MISMO refresh token que ya fue canjeado recibe 401, aunque la sesión sea perfectamente
 * válida. `refrescarConReintentos` reintenta el mismo `guardada.refreshToken` hasta 4 veces en
 * ~40 s, y en esa ventana `OperationScreen`/`useSyncStatus` llaman a `obtenerAccessToken()` en
 * paralelo (el access token está vencido, que es justo la condición que nos trajo acá) —
 * también con `refrescar()`. Sin coordinación, dos llamadas concurrentes con el mismo token
 * disparan dos rotaciones en paralelo: la que aterriza segunda en el servidor recibe 401 real
 * y puede terminar marcando `sesionNoRevalidada: true` (o dejando `obtenerAccessToken` en
 * `null` para siempre) sobre una sesión que en realidad es válida.
 *
 * Fix: single-flight sobre el refresh, con el `refreshToken` como clave. Toda llamada
 * concurrente a `refrescar()` para el mismo token comparte la ÚNICA promesa en vuelo en vez
 * de disparar una rotación paralela — `refrescarConReintentos` y `obtenerAccessToken` pasan
 * por esta misma función, así que quedan cubiertos automáticamente. La entrada se borra del
 * mapa en el `finally`, tanto si resuelve como si rechaza: así un rechazo nunca queda
 * cacheado — el próximo llamador (p. ej. el siguiente intento de `refrescarConReintentos`,
 * tras el backoff) dispara un intento nuevo, no reutiliza el error viejo. Si el token SÍ fue
 * revocado server-side, ese 401 real se sigue propagando a todos los que esperaban la promesa
 * compartida, y `refrescarConReintentos` lo sigue tratando como falla tras agotar reintentos —
 * la semántica de `sesionNoRevalidada` no cambia. */
const refrescosEnVuelo = new Map<string, Promise<SesionMovilGuardada>>();

/** `export` solo para el test de single-flight (`use-auth-movil.refrescar.test.ts`) — no se
 * usa fuera de este módulo en producción. */
export async function refrescar(guardada: SesionMovilGuardada): Promise<SesionMovilGuardada> {
  const clave = guardada.refreshToken;
  const enVuelo = refrescosEnVuelo.get(clave);
  if (enVuelo) return enVuelo;

  const promesa = (async () => {
    const tokens = await authMovilApi.refresh(guardada.refreshToken);
    return actualizarSesionMovil(guardada, tokens);
  })();
  refrescosEnVuelo.set(clave, promesa);
  try {
    return await promesa;
  } finally {
    refrescosEnVuelo.delete(clave);
  }
}

function mensajeUsuario(error: unknown): string {
  if (error instanceof AuthMovilApiError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado. Intenta nuevamente.';
}

export function contextoDe(estado: EstadoAuthMovil): ContextoOperativoMovil | null {
  return estado.sesion?.contexto ?? null;
}
