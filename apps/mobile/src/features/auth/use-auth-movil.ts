import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import type { ContextoOperativoMovil, ResumenAsignacionMovil } from '@quivo/shared';
import { AuthMovilApiError, authMovilApi } from '../../shared/api/auth-movil-api';
import {
  CircuitoRefreshAbiertoError,
  esSesionIrrecuperable,
  intentarRefrescarConCircuito,
  obtenerEstadoCircuitoRefresh,
  reiniciarCircuitoRefresh,
} from '../../shared/api/refresh-circuit-breaker';
import {
  actualizarSesionMovil,
  borrarSesionMovil,
  cargarSesionMovil,
  guardarSesionMovil,
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';

export type EtapaAuthMovil = 'restaurando' | 'vehiculo' | 'asignacion' | 'operacion';

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
  /** Entrega 3 (`docs/plan-correccion-post-piloto-2026-09-09.md`): distingue un 401 de refresh
   * TRANSITORIO (el circuito sigue reintentando con backoff, el chofer no ve nada — principio
   * rector) de una sesión REALMENTE muerta: `esSesionIrrecuperable` solo se prende cuando el
   * circuit breaker (`shared/api/refresh-circuit-breaker.ts`) lleva ABIERTO más de
   * `UMBRAL_MS_SESION_IRRECUPERABLE` sin que ningún probe haya tenido éxito. Es una falla de
   * CAPTURA (la app no puede recuperar sesión de forma autónoma) y por eso SÍ debe hacerse
   * visible — pero esta entrega solo expone el estado, no construye la UI: la consume la
   * Entrega 26 (preflight). Se apaga con el primer refresh exitoso o con un login/logout
   * nuevo (`reiniciarCircuitoRefresh`). */
  sesionIrrecuperable: boolean;
  /** Login de un paso (`POST /sesion`): token de un solo uso que llega en la respuesta
   * `seleccion_requerida` (≥2 asignaciones hoy) y hay que reenviar en
   * `POST /sesion/asignacion` junto con el `asignacionId` elegido. Reemplaza al
   * `AuthVehiculoMovilResponse` completo que el flujo viejo guardaba en `estado.vehiculo`
   * (ver el comentario de `autenticarSesion` más abajo sobre por qué ese campo desapareció). */
  seleccionToken: string | null;
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
  sesionIrrecuperable: false,
  seleccionToken: null,
  asignaciones: [],
  sesion: null,
  deviceId: null,
};

export function useAuthMovil() {
  const [estado, setEstado] = useState<EstadoAuthMovil>(ESTADO_INICIAL);
  const mounted = useRef(true);
  const deviceId = useRef<string | null>(null);
  /** Contador ACUMULADO de 401 de `obtenerAccessToken` (bug QA 2026-08-23: 401 permanente
   * cada 15s durante 42 min sin ninguna señal en pantalla) — ver `clasificarFalloAccessToken`
   * para el porqué del umbral y por qué NO es un contador estrictamente consecutivo (H4,
   * hallazgo de revisión: un error de red intercalado NO lo resetea a propósito). Vive en un
   * ref (no en `estado`) porque no debe disparar renders por sí solo; sólo importa cuando
   * cruza el umbral.
   *
   * H5 (hallazgo de revisión, bajo): este ref sobrevive a `ESTADO_INICIAL` — un `logout()` o
   * un login nuevo exitoso limpian `estado`, pero no este ref, así que una racha vieja de 401
   * (de la sesión ANTERIOR) podía combinarse con un solo 401 de la sesión nueva y disparar la
   * alerta sin motivo. Se resetea explícitamente en `logout()` y en el camino exitoso de
   * `autenticarSesion`/`seleccionarAsignacion` (búsqueda: `fallos401Acumulados.current = 0`). */
  const fallos401Acumulados = useRef(0);

  /** Entrega 3: refleja en `estado` el veredicto ACTUAL del circuit breaker
   * (`refresh-circuit-breaker.ts`) — se llama después de cada intento de refresh (éxito o
   * fallo), en foreground. El breaker vive fuera de React (módulo compartido con el camino
   * headless), así que esto es lo que lo sincroniza con el estado que puede leer un
   * componente. Barato de sobra para llamarlo en cada intento: son 4 comparaciones puras. */
  const sincronizarSesionIrrecuperable = useCallback(() => {
    if (!mounted.current) return;
    const irrecuperable = esSesionIrrecuperable(obtenerEstadoCircuitoRefresh(), Date.now());
    setEstado((actual) =>
      actual.sesionIrrecuperable === irrecuperable
        ? actual
        : { ...actual, sesionIrrecuperable: irrecuperable },
    );
  }, []);

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
          sincronizarSesionIrrecuperable();
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
          // Entrega 3: sincroniza el veredicto del circuit breaker DESPUÉS de que
          // `refrescarConReintentos` agotó (o no) sus reintentos — cubre tanto el éxito como
          // el fallo definitivo de este camino de restauración.
          sincronizarSesionIrrecuperable();
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

  /**
   * Login de un solo paso: placa + PIN del CONDUCTOR (el parámetro se llamaba `telefono` en
   * el puente visual temporal que esta función reemplaza — nunca fue un teléfono, era el PIN
   * del conductor que la pantalla mandaba como segundo campo). Una sola llamada a
   * `POST /v1/mobile/auth/sesion`: ya no hay credenciales demo ni segundo round-trip
   * encadenado — el backend prueba la identidad del conductor en el mismo request (plan
   * §1.d, `auth-movil.service.ts:autenticarSesion`).
   *
   * `estado.vehiculo` (el `AuthVehiculoMovilResponse` completo del `POST /vehiculo` legado)
   * deja de setearse en este camino a propósito: ese contrato traía `challengeToken` +
   * `expiresAt` para el segundo paso del flujo viejo, y acá no hay nada parecido — la
   * identidad ya se probó en este mismo request. Si el resultado es `seleccion_requerida`,
   * lo único que hace falta para el segundo paso es el `seleccionToken` (ver más abajo), así
   * que ese es el único dato nuevo que entra al estado.
   */
  const autenticarSesion = useCallback(async (placa: string, pin: string) => {
    await ejecutar(async () => {
      const instalacionId = await asegurarDeviceId();
      const respuesta = await authMovilApi.autenticarSesion({
        placa,
        pin,
        deviceId: instalacionId,
      });
      if (respuesta.status === 'seleccion_requerida') {
        setEstado((actual) => ({
          ...actual,
          etapa: 'asignacion',
          seleccionToken: respuesta.seleccionToken,
          asignaciones: respuesta.asignaciones,
        }));
        return;
      }
      await guardarSesionMovil(respuesta);
      // H5: login nuevo exitoso — cortar cualquier racha de 401 heredada de la sesión
      // anterior (el ref no lo limpia `ESTADO_INICIAL` porque vive fuera de `estado`).
      fallos401Acumulados.current = 0;
      // Entrega 3: mismo motivo que arriba, pero para el circuit breaker del refresh — es
      // GLOBAL al módulo (ver el docblock de `reiniciarCircuitoRefresh`), así que un login
      // nuevo y válido no debe heredar un circuito abierto por la sesión anterior.
      reiniciarCircuitoRefresh();
      setEstado((actual) => ({
        ...actual,
        etapa: 'operacion',
        sesion: respuesta,
        sesionIrrecuperable: false,
      }));
    });
  }, []);

  const seleccionarAsignacion = useCallback(
    async (asignacionId: string) => {
      await ejecutar(async () => {
        // A diferencia del `obtenerDesafio()` del flujo viejo, acá no hay `expiresAt` que
        // chequear del lado del cliente: el `seleccionToken` es de un solo uso y el
        // servidor lo valida (expirado/consumido/deviceId distinto → 401 "Placa o PIN
        // incorrectos", ver `seleccionarAsignacion` en auth-movil.service.ts) — una
        // validación de expiración local duplicaría esa lógica sin agregar nada, porque de
        // todos modos hay que manejar el rechazo del servidor.
        const seleccionToken = estado.seleccionToken;
        if (!seleccionToken) {
          throw new Error('La selección de turno expiró. Vuelve a comenzar.');
        }
        const respuesta = await authMovilApi.seleccionarAsignacionSesion({
          seleccionToken,
          asignacionId,
          deviceId: await asegurarDeviceId(),
        });
        if (respuesta.status !== 'autenticado') {
          throw new Error('La asignación no pudo confirmarse');
        }
        await guardarSesionMovil(respuesta);
        // H5: misma razón que en `autenticarSesion` — este es el otro camino de login
        // exitoso (segundo paso de `seleccion_requerida`).
        fallos401Acumulados.current = 0;
        // Entrega 3: mismo motivo que en `autenticarSesion`.
        reiniciarCircuitoRefresh();
        setEstado((previo) => ({
          ...previo,
          etapa: 'operacion',
          sesion: respuesta,
          seleccionToken: null,
          sesionIrrecuperable: false,
        }));
      });
    },
    [estado.seleccionToken],
  );

  const volverAVehiculo = useCallback(() => {
    setEstado((actual) => ({
      ...actual,
      etapa: 'vehiculo',
      seleccionToken: null,
      asignaciones: [],
      error: null,
    }));
  }, []);

  const logout = useCallback(async () => {
    setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    const refreshToken = estado.sesion?.refreshToken;
    if (refreshToken) {
      try {
        // Entrega 3: se manda el `deviceId` como fallback server-side — ver el docblock de
        // `AuthMovilService.logout` para el porqué (refresh token localmente obsoleto por una
        // rotación cuya respuesta el cliente nunca confirmó recibir).
        await authMovilApi.logout(refreshToken, deviceId.current ?? estado.deviceId ?? undefined);
      } catch {
        // La limpieza local siempre se ejecuta; la sesión expira/revoca server-side después.
      }
    }
    await borrarSesionMovil();
    // H5: `ESTADO_INICIAL` limpia `estado`, pero este ref vive fuera de `estado` — sin este
    // reset explícito, una racha de 401 de la sesión que se está cerrando sobrevivía al
    // logout y podía combinarse con un solo 401 de la sesión siguiente.
    fallos401Acumulados.current = 0;
    // Entrega 3: mismo motivo, para el circuit breaker del refresh (global al módulo).
    reiniciarCircuitoRefresh();
    if (mounted.current) setEstado({ ...ESTADO_INICIAL, etapa: 'vehiculo' });
  }, [estado.sesion?.refreshToken, estado.deviceId]);

  /** Access token vigente para llamadas propias de la pantalla de operación (paquete del
   * día QUI-236, sync QUI-240) — refresca sola si ya venció, sin duplicar la lógica de
   * `reconciliarSesion`. Devuelve `null` sin sesión o si el refresh falla (offline).
   *
   * Bug QA 2026-08-23: `use-sync-status.ts` llama a esta función cada `REFRESCO_MS` (15s), y
   * el `catch` de acá trataba CUALQUIER falla igual (`return null` en silencio) — un 401
   * permanente (sesión revocada de verdad) y una caída de red transitoria (offline legítimo,
   * requisito duro del producto) rendían exactamente lo mismo. El teléfono hizo esa llamada
   * cada 15s durante 42 minutos recibiendo 401 siempre, mientras la pantalla mostraba
   * operación normal y cero `sync/batches` llegaban. `clasificarFalloAccessToken` (abajo)
   * distingue los dos casos sin duplicar la lógica de reintento de `refrescarConReintentos`
   * (esa sigue siendo la única que corre al restaurar la sesión; ésta es la que corre en el
   * loop de sync). */
  const obtenerAccessToken = useCallback(async (): Promise<string | null> => {
    const sesion = estado.sesion;
    if (!sesion) return null;
    if (new Date(sesion.accessTokenExpiresAt) > new Date()) {
      return sesion.accessToken;
    }
    try {
      const actualizada = await refrescar(sesion);
      fallos401Acumulados.current = 0;
      // A5: un refresh posterior exitoso es evidencia de que la sesión SÍ es válida de nuevo
      // (el servidor la aceptó) — apaga la alerta de "no se pudo revalidar" si había quedado
      // prendida, en vez de dejarla pegada hasta el próximo login manual.
      if (mounted.current) {
        setEstado((actual) => ({ ...actual, sesion: actualizada, sesionNoRevalidada: false }));
      }
      // Entrega 3: el `refrescar` de arriba ya pasó por `intentarRefrescarConCircuito`, que
      // cierra el circuito en un éxito — sincronizar acá apaga `sesionIrrecuperable` si había
      // quedado prendida (mismo espíritu que el `sesionNoRevalidada: false` de arriba).
      sincronizarSesionIrrecuperable();
      return actualizada.accessToken;
    } catch (error: unknown) {
      const { fallos401Acumulados: fallosActualizados, marcarSesionNoRevalidada } =
        clasificarFalloAccessToken(error, fallos401Acumulados.current);
      fallos401Acumulados.current = fallosActualizados;
      if (marcarSesionNoRevalidada && mounted.current) {
        setEstado((actual) => ({ ...actual, sesionNoRevalidada: true }));
      }
      // Entrega 3: ESTE es el camino que corría sin freno cada 15s en el bug de QA — acá es
      // donde `sesionIrrecuperable` puede prenderse de verdad (circuito abierto hace más de
      // `UMBRAL_MS_SESION_IRRECUPERABLE`). Bajo el principio rector, esto NO dispara ningún
      // aviso en pantalla por sí solo — solo actualiza el estado que la Entrega 26 (preflight,
      // fuera de este alcance) va a consumir.
      sincronizarSesionIrrecuperable();
      // NO se borra la sesión acá en ningún caso (401 ni network): misma decisión, mismo
      // motivo que en `refrescarConReintentos` — ver su comentario. Un 401 aislado o
      // repetido solo enciende la señal para que el chofer decida volver a loguearse; el
      // borrado automático sigue siendo exclusivo de `logout()`.
      return null;
    }
  }, [estado.sesion, sincronizarSesionIrrecuperable]);

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
    autenticarSesion,
    seleccionarAsignacion,
    volverAVehiculo,
    logout,
    obtenerAccessToken,
  };
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

  const promesa = ejecutarRefresh(guardada);
  refrescosEnVuelo.set(clave, promesa);
  try {
    return await promesa;
  } finally {
    refrescosEnVuelo.delete(clave);
  }
}

/**
 * Hallazgo 3 (code review, MEDIO — carrera de refresh entre headless y foreground,
 * `headless-task.ts`): el SDK de Transistorsoft corre el headless task en SU PROPIO contexto
 * JS, distinto del que arranca al reabrir la app. Un tick headless puede rotar el refresh
 * token de T0 a T1 y persistirlo en SecureStore mientras el contexto de foreground, recién
 * arrancado, todavía tiene T0 en memoria (`estado.sesion`/`guardada`, cargado de disco antes
 * de que la escritura del headless aterrizara, o simplemente porque los dos contextos
 * partieron del mismo T0 y el headless ganó la carrera). Ese T0 ya fue canjeado server-side:
 * `authMovilApi.refresh(T0)` desde foreground recibe un 401 REAL, aunque la sesión sea
 * perfectamente válida — SecureStore ya tiene T1.
 *
 * Antes de este fix ese 401 se propagaba tal cual: `refrescarConReintentos` reintentaba hasta
 * 4 veces MÁS, siempre con el mismo T0 en memoria (nunca releía disco), acumulando 5 fallos
 * 401 reales — exactamente `UMBRAL_FALLOS_ABRIR_CIRCUITO` — que abrían el circuit breaker. Con
 * el circuito abierto (backoff de minutos) y sin que nada volviera a mirar SecureStore,
 * `obtenerAccessToken`/`obtenerAccessTokenHeadless` quedaban devolviendo `null`
 * INDEFINIDAMENTE — sync completamente detenido en foreground hasta matar la app — aunque el
 * refresh token VIGENTE (T1) estuviera ahí, a un `SecureStore.getItemAsync` de distancia. El
 * docblock de `obtenerAccessTokenHeadless` (`headless-task.ts`) documentaba el peor caso como
 * "un intento extra, nunca se rompe nada" — eso era falso, este es el patrón de ráfaga de 401
 * visto en producción (Entrega 28 del plan).
 *
 * Fix: ante un 401 REAL (no un corto-circuito del breaker, `CircuitoRefreshAbiertoError`, que
 * no dice nada sobre si el token en memoria quedó obsoleto — reintentar ahí no cambiaría
 * nada), releer la sesión persistida. Si el `refreshToken` guardado ahí difiere del que se
 * acaba de usar, es evidencia de que OTRO contexto ya lo rotó mientras este seguía con el
 * viejo — reintentar UNA sola vez con el valor de disco antes de darse por vencido. Si
 * coincide (o no hay sesión guardada, p. ej. logout concurrente), el 401 es de verdad y se
 * propaga tal cual — nunca reintenta en loop.
 *
 * Cubre foreground Y headless con un solo fix porque los dos pasan por ESTA función: los 4
 * call sites de `refrescar()` (`reconciliarSesion`, `refrescarConReintentos` y
 * `obtenerAccessToken` acá abajo, más `obtenerAccessTokenHeadless` en `headless-task.ts`)
 * terminan todos acá.
 */
async function ejecutarRefresh(guardada: SesionMovilGuardada): Promise<SesionMovilGuardada> {
  try {
    // Entrega 3: el circuit breaker (`shared/api/refresh-circuit-breaker.ts`) envuelve ACÁ, en
    // el único lugar que golpea `POST /v1/mobile/auth/refresh` — cubre automáticamente a todos
    // los callers de `refrescar` sin duplicar el chequeo, y nunca toca el sync de datos (otro
    // cliente HTTP por completo, ver el docblock del breaker).
    const tokens = await intentarRefrescarConCircuito(guardada.refreshToken);
    return await actualizarSesionMovil(guardada, tokens);
  } catch (error) {
    const esFalloRealDeRefresh =
      error instanceof AuthMovilApiError &&
      error.status === 401 &&
      !(error instanceof CircuitoRefreshAbiertoError);
    if (!esFalloRealDeRefresh) throw error;

    const enDisco = await cargarSesionMovil();
    if (!enDisco || enDisco.refreshToken === guardada.refreshToken) {
      // Sin sesión guardada (logout concurrente) o el mismo token que ya falló: el 401 es de
      // verdad, no una carrera entre contextos — se propaga tal cual.
      throw error;
    }

    // Otro contexto (headless o foreground) ya rotó el token mientras este seguía con el
    // viejo — un solo reintento con el valor vigente de disco, antes de contar el fallo.
    const tokens = await intentarRefrescarConCircuito(enDisco.refreshToken);
    return await actualizarSesionMovil(enDisco, tokens);
  }
}

/** Umbral de 401 ACUMULADOS (NO estrictamente consecutivos — ver H4 más abajo) antes de
 * prender `sesionNoRevalidada` desde `obtenerAccessToken` (plan Tarea B, bug QA 2026-08-23).
 * `refrescar()` ya es single-flight por `refreshToken` (ver el comentario largo arriba de esa
 * función), así que la rotación CONCURRENTE del mismo token no produce 401 falsos — ese caso
 * ya está cerrado. Lo que el single-flight NO cierra es una ventana más angosta:
 * `reconciliarSesion` (efecto de montaje) puede rotar el token con éxito y todavía no haber
 * comiteado `setEstado({ sesion: vigente })` cuando el intervalo independiente de
 * `use-sync-status.ts` (`REFRESCO_MS = 15_000`) llama a `obtenerAccessToken`, lee
 * `estado.sesion` y todavía ve el refreshToken VIEJO — ya canjeado server-side. Ese intento
 * golpea al servidor con un token que ya no es válido y recibe un 401 real, aunque la sesión
 * esté sana. Exigir 2 fallos 401 acumulados (hasta 30 s con el intervalo actual, más si hay
 * cortes de red en el medio — ver H4) le da tiempo de sobra a ese commit de React para
 * asentarse antes de alarmar; un 401 de verdad (sesión revocada/expirada, como el bug de QA
 * de 42 min) sigue prendiendo la alerta, solo que un ciclo de sync más tarde.
 *
 * H4 (hallazgo de revisión, medio — renombrada acá de `..._CONSECUTIVOS_...`): el nombre
 * anterior prometía "SEGUIDOS" pero `clasificarFalloAccessToken` nunca reseteaba el contador
 * ante un error de red, así que la promesa era falsa. Quedaban dos semánticas posibles: (a)
 * resetear en error de red (haciendo el nombre literal), o (b) mantener la racha a través de
 * cortes de red. Se elige (b), que es lo que el código YA hacía: una sesión revocada/expirada
 * SIGUE revocada/expirada del otro lado de un corte de red — el corte no es evidencia de que
 * el servidor haya cambiado de opinión. Resetear con (a) le regala al chofer legítimo que
 * tiene mal la cobertura (CGNAT de Entel/Tigo, túnel, sótano de depósito) una ventana infinita
 * para nunca acumular los 2 fallos y jamás enterarse de que su sesión real está revocada — el
 * caso exactamente inverso al que motivó el umbral. Lo único que SÍ resetea el contador es un
 * refresh REAL exitoso (evidencia positiva del servidor, ver `obtenerAccessToken` arriba) o un
 * logout/login nuevo (H5, ver el comentario del ref `fallos401Acumulados`). */
export const UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA = 2;

/** Pura y exportada para poder testearla sin montar React (este paquete no tiene arnés
 * jest-expo/RNTL, ver docs/plan-movil-login-y-pruebas.md ítem 7-8): clasifica el resultado de
 * un intento fallido de `refrescar()` dentro de `obtenerAccessToken`. Distingue un 401 de
 * verdad (`AuthMovilApiError` con `status === 401`) de cualquier otro fallo — sobre todo
 * `kind === 'network'`, que es offline legítimo: la app tiene que poder operar sin red (
 * requisito duro del producto), así que eso nunca debe encender la alarma. A propósito NO
 * resetea el contador ante un error de red (decisión (b) documentada arriba, junto a la
 * constante del umbral) — solo lo deja sin sumar. */
export function clasificarFalloAccessToken(
  error: unknown,
  fallos401AcumuladosPrevios: number,
): { fallos401Acumulados: number; marcarSesionNoRevalidada: boolean } {
  if (error instanceof AuthMovilApiError && error.status === 401) {
    const fallos401Acumulados = fallos401AcumuladosPrevios + 1;
    return {
      fallos401Acumulados,
      marcarSesionNoRevalidada: fallos401Acumulados >= UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA,
    };
  }
  return { fallos401Acumulados: fallos401AcumuladosPrevios, marcarSesionNoRevalidada: false };
}

function mensajeUsuario(error: unknown): string {
  if (error instanceof AuthMovilApiError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado. Intenta nuevamente.';
}

export function contextoDe(estado: EstadoAuthMovil): ContextoOperativoMovil | null {
  return estado.sesion?.contexto ?? null;
}
