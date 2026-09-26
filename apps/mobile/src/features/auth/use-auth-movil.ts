import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import type { ContextoOperativoMovil, ResumenAsignacionMovil } from '@quivo/shared';
import {
  AuthMovilApiError,
  authMovilApi,
  esSesionNoVigente,
  obtenerRefreshTokenRechazado,
} from '../../shared/api/auth-movil-api';
import {
  CircuitoRefreshAbiertoError,
  esSesionIrrecuperable,
  intentarRefrescarConCircuito,
  obtenerEstadoCircuitoRefresh,
  reiniciarCircuitoRefresh,
} from '../../shared/api/refresh-circuit-breaker';
import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  renovarLease,
  ID_LEASE_REFRESH_SESION,
  TTL_LEASE_REFRESH_SESION_MS,
} from '../../db/outbox';
import {
  actualizarContextoSesionMovil,
  actualizarSesionMovil,
  borrarLogoutSolicitado,
  borrarRevocacionPendientePorId,
  borrarSesionMovil,
  cargarSesionMovil,
  guardarRevocacionPendiente,
  guardarSesionMovil,
  hayLogoutSolicitado,
  listarRevocacionesPendientes,
  marcarLogoutSolicitado,
  haySesionNoVigenteParaToken,
  obtenerDeviceIdMovil,
  type RevocacionPendienteGuardada,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';
import {
  hayRecorridoActivoGlobal,
  huboLecturaDeRecorridoActivo,
  suscribirseARecorridoActivo,
} from '../operacion/estado-recorrido-activo';

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
  /** Rescope SESION_NO_VIGENTE (decisión del CTO, code review de `fix/sesion-no-vigente`):
   * distinto de `sesionNoRevalidada` (ambigua, puede recuperarse sola) — este es el corte de
   * raíz (`SESION_NO_VIGENTE`, evidencia definitiva del servidor) pero con un recorrido de GPS
   * ACTIVO, así que `cerrarSesionPorNoVigente` NO puede borrar la sesión ni cambiar `etapa`
   * todavía (eso desmontaría `GpsProvider` y mataría el tracking sin `fin_recorrido` — ver el
   * comentario de `reconciliarSesion` sobre las "8 sesiones abiertas"). Se prende para que
   * `OperationScreen` bloquee con un aviso no descartable ("Tocá Finalizar…") y se apaga (junto
   * con el borrado real) recién cuando `finalizarTrasSesionNoVigente` corre, tras que el chofer
   * confirme "Finalizar" y `gps.detener()` complete. */
  sesionNoVigente: boolean;
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
  sesionNoVigente: false,
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

  /**
   * Entrega 28 (`docs/plan-correccion-post-piloto-2026-09-09.md`): corte de raíz ante
   * `SESION_NO_VIGENTE` — evidencia DEFINITIVA del servidor de que esta sesión ya no existe
   * (cerrada, revocada, desplazada por otro dispositivo, o el refresh token ya rotó). A
   * diferencia de un 401 ambiguo (que sólo prende `sesionNoRevalidada` y deja al chofer
   * seguir operando offline con la esperanza de un refresh futuro), acá no hay nada que
   * reintentar: se borran los tokens locales YA (mismo `borrarSesionMovil` que usa
   * `logout()` — nunca toca el outbox de SQLite, así que la evidencia GPS pendiente queda
   * intacta para drenar después del re-login) y se lleva al chofer a la pantalla de login,
   * con un mensaje en su idioma. No hay servidor al que avisar (no queda sesión que
   * revocar: el servidor ya la dio por muerta), así que no se llama a `authMovilApi.logout`
   * acá. También resetea el circuito de refresh y la racha de 401 acumulados — mismo
   * motivo que `logout()`/un login nuevo exitoso (H5): sin esto, esta sesión muerta podía
   * dejar el circuito abierto o la racha a mitad de camino para la sesión siguiente.
   */
  /** Tramo final común de un corte por `SESION_NO_VIGENTE` SIN recorrido activo — extraído
   * para que `cerrarSesionPorNoVigente` (camino directo) y `finalizarTrasSesionNoVigente`
   * (camino con recorrido, recién tras "Finalizar") no dupliquen el reset de `estado`. */
  const borrarSesionYVolverALogin = useCallback(async () => {
    await borrarSesionMovil().catch(() => {});
    fallos401Acumulados.current = 0;
    reiniciarCircuitoRefresh();
    if (!mounted.current) return;
    setEstado((actual) => ({
      ...actual,
      etapa: 'vehiculo',
      sesion: null,
      seleccionToken: null,
      asignaciones: [],
      sesionNoRevalidada: false,
      sesionIrrecuperable: false,
      sesionNoVigente: false,
      aviso: null,
      error: 'Tu sesión ya no es válida en este dispositivo. Vuelve a iniciar sesión.',
    }));
  }, []);

  const cerrarSesionPorNoVigente = useCallback(
    async (refreshTokenRechazado?: string) => {
      const veredicto = await decidirCierrePorNoVigente(refreshTokenRechazado);
      if (veredicto.tipo === 'token_superado') {
        if (mounted.current) {
          setEstado((actual) => ({
            ...actual,
            sesion: veredicto.sesionEnDisco ?? actual.sesion,
            sesionNoVigente: false,
          }));
        }
        return;
      }
      if (veredicto.tipo === 'esperar_finalizar') {
        if (mounted.current) {
          setEstado((actual) => ({ ...actual, sesionNoVigente: true }));
        }
        return;
      }
      await borrarSesionYVolverALogin();
    },
    [borrarSesionYVolverALogin],
  );

  /**
   * Rescope SESION_NO_VIGENTE, punto C: la llama `OperationScreen` cuando el chofer confirma
   * "Finalizar" con `sesionNoVigente` prendido — para cuando esto corre, `gps.detener()` ya
   * completó (best-effort escribió `fin_recorrido` y apagó `tracking`, ver el efecto que
   * dispara esto en `operation-screen.tsx`). Recién ACÁ se borra la sesión local y se vuelve al
   * login — nunca antes, para no perder la evidencia GPS del cierre del recorrido.
   */
  const finalizarTrasSesionNoVigente = useCallback(async () => {
    await borrarSesionYVolverALogin();
  }, [borrarSesionYVolverALogin]);

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
        // Punto 3 (verify-fix, decisión del CTO): "próximo arranque con red" — intenta drenar
        // cualquier revocación de logout que quedó pendiente de un arranque anterior sin
        // conectividad (ver `intentarRevocacionesPendientes`). Fire-and-forget: nunca bloquea
        // ni puede fallar la restauración de sesión (esa función nunca rechaza).
        void intentarRevocacionesPendientes();

        // Fix drenado en background (2026-09-25, crítico): `ejecutarLogout` puede devolver
        // 'pendiente' cuando no consigue el lease `refresh-sesion` a tiempo (caso patológico,
        // ver su docblock) — marca `marcarLogoutSolicitado()` pero NO toca la sesión en disco
        // a propósito (`intentarRevocacionesPendientes`, arriba, necesita encontrarla intacta
        // para reintentar el logout completo bajo lease). Sin este chequeo, `cargarSesionMovil`
        // de abajo devolvía la sesión tal cual y el chofer volvía a `operacion` al reabrir la
        // app — un chofer que cerró sesión quedaba re-logueado, crítico en teléfonos
        // compartidos entre choferes. Chequea ANTES de leer la sesión: si hay que tratar esto
        // como deslogueado, ni siquiera se toca `CREDENCIALES_KEY`/`CONTEXTO_KEY` acá, así que
        // la sesión en disco queda intacta (el borrado real sigue siendo exclusivo de
        // `ejecutarLogout`, vía `intentarRevocacionesPendientes`).
        if (await debeRestaurarComoDeslogueado()) {
          if (!mounted.current) return;
          setEstado((actual) => ({ ...actual, etapa: 'vehiculo', sesion: null }));
          return;
        }

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

        // Rescope SESION_NO_VIGENTE, punto C ("también al abrir la app con el flag headless
        // prendido para el token actual"): el headless (`headless-task.ts`) puede haber marcado
        // `marcarSesionNoVigenteHeadless` en un tick mientras la app estaba terminada — a
        // propósito SIN borrar la sesión (ver su docblock), así que `guardada` de arriba llega
        // intacta y este chequeo corre DESPUÉS de montar `etapa: 'operacion'` (deja que
        // `GpsProvider`/`useGpsOperativo` re-enganchen normalmente). No se puede leer
        // `hayRecorridoActivoGlobal()` de inmediato: el re-enganche nativo (`getState()`/
        // `ready()`) es asíncrono y todavía no publicó ningún veredicto en este instante — leer
        // el booleano crudo acá daría casi siempre `false` aunque el recorrido siga activo. Se
        // usa el valor si YA hubo una lectura real (`huboLecturaDeRecorridoActivo`, caso runtime
        // reciclado sin cold start) o, si no, se espera la PRIMERA publicación real antes de
        // decidir — `cerrarSesionPorNoVigente` hace el resto (chequeo B + C).
        void (async () => {
          if (!(await haySesionNoVigenteParaToken(guardada.refreshToken).catch(() => false))) {
            return;
          }
          if (huboLecturaDeRecorridoActivo()) {
            void cerrarSesionPorNoVigente(guardada.refreshToken);
            return;
          }
          const desuscribir = suscribirseARecorridoActivo(() => {
            desuscribir();
            void cerrarSesionPorNoVigente(guardada.refreshToken);
          });
        })();

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
        // G2 (hallazgo de `/codex-debug verify-fix`, ALTO): `actualizarContextoSesionMovil`
        // relee la sesión VIGENTE de disco y fusiona SOLO `contexto` — nunca pisa
        // accessToken/refreshToken con la copia en memoria (`vigente`), que puede haber
        // quedado vieja si un refresh concurrente (otro contexto JS, bajo el lease de
        // `ID_LEASE_REFRESH_SESION`) rotó y persistió mientras este `await` estaba en vuelo.
        // Ver el docblock de esa función en `sesion-movil-store.ts`.
        const actualizada = await actualizarContextoSesionMovil(contexto);
        setEstado((actual) => ({ ...actual, sesion: actualizada ?? actual.sesion, aviso: null }));
      } catch (error: unknown) {
        if (!mounted.current) return;
        // Entrega 28: chequeo PRIMERO — antes de la rama de 401 ambiguo de abajo. Cubre el
        // caso en que el PRIMER `refrescar(guardada)` (arriba, fuera de este catch) ya vino
        // con `SESION_NO_VIGENTE`: no hay backoff que valga, se corta de raíz.
        if (esSesionNoVigente(error)) {
          await cerrarSesionPorNoVigente(obtenerRefreshTokenRechazado(error) ?? guardada.refreshToken);
          return;
        }
        // Punto 10 (code review 2026-09-25): `CircuitoRefreshAbiertoError` tiene
        // `status: 401` A PROPÓSITO (ver su docblock en `refresh-circuit-breaker.ts` — así
        // `error.status === 401` lo trata igual que un 401 real EN OTROS callers que solo
        // necesitan degradar a "sesión no revalidada"), pero acá SÍ importa la diferencia: es
        // una decisión LOCAL (el circuito ya estaba abierto por fallos 401 PREVIOS), nunca
        // evidencia nueva del servidor — ni siquiera tocó la red esta vez. Tratarlo igual que
        // un 401 real dispara `refrescarConReintentos` (reintentos que, mientras el circuito
        // siga abierto, vuelven a fallar con el MISMO error local sin volver a consultar al
        // servidor) y puede terminar marcando `sesionNoRevalidada` sin que el servidor haya
        // dicho nada nuevo. Se excluye acá; cae al `else` genérico de abajo (aviso de
        // "trabajando offline", sin tocar `sesionNoRevalidada`).
        if (
          error instanceof AuthMovilApiError &&
          error.status === 401 &&
          !(error instanceof CircuitoRefreshAbiertoError)
        ) {
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
          let revalidada: SesionMovilGuardada | null;
          try {
            revalidada = await refrescarConReintentos(vigente);
          } catch (errorReintento: unknown) {
            // Entrega 28: `refrescarConReintentos` corta sin reintentar (rethrow inmediato,
            // ver su docblock) ante `SESION_NO_VIGENTE` — es evidencia definitiva, no hay
            // backoff que le sirva. Cortar acá también, sin contar esto como "no
            // revalidada" (ese estado implica "puede que se recupere sola", y esto no).
            if (esSesionNoVigente(errorReintento)) {
              sincronizarSesionIrrecuperable();
              await cerrarSesionPorNoVigente(
                obtenerRefreshTokenRechazado(errorReintento) ?? vigente.refreshToken,
              );
              return;
            }
            // Defensivo: `refrescarConReintentos` sólo debería rechazar por lo de arriba —
            // cualquier otra cosa es inesperada; se reporta y se degrada al mismo camino que
            // un backoff agotado sin éxito, en vez de dejar una excepción sin capturar.
            Sentry.captureException(errorReintento, {
              tags: { contexto: 'auth-movil', paso: 'refrescar-con-reintentos-inesperado' },
            });
            revalidada = null;
          }
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
            // G2 — misma razón que arriba: relee y fusiona SOLO contexto, nunca pisa tokens.
            const actualizada = await actualizarContextoSesionMovil(contexto);
            setEstado((actual) => ({ ...actual, sesion: actualizada ?? revalidada, aviso: null }));
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
   *
   * Entrega 28 (`docs/plan-correccion-post-piloto-2026-09-09.md`): esa señal YA EXISTE
   * (`SESION_NO_VIGENTE`, `SesionNoVigenteException` en la API) — a diferencia de cualquier
   * otro fallo, este NO se reintenta con backoff: se re-lanza en el PRIMER intento. Es
   * exactamente la ráfaga de reintentos que el `refresh-agotado` de Sentry documentaba (los
   * 3 reintentos, ~40 s, siempre al arrancar con un refresh token que ya no era vigente) —
   * con evidencia definitiva del servidor de que el token no es vigente, siquiera un solo
   * reintento adicional es indistinguible de machacar la red en vano. El caller
   * (`reconciliarSesion`) es responsable de tratar este rechazo como corte de raíz, no como
   * "no revalidada".
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
        if (esSesionNoVigente(error)) throw error;
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
    // Punto 3 (verify-fix, decisión del CTO): la lógica real vive en `ejecutarLogout`
    // (standalone, ver su docblock más abajo) — coordina con `ejecutarRefresh` a través del
    // MISMO lease `refresh-sesion`, SIEMPRE espera a conseguirlo (nunca degrada al
    // `estado.sesion?.refreshToken` de React, que puede estar varias rotaciones headless
    // atrás) y revoca con el refresh token RELEÍDO de disco.
    //
    // Ronda 6 (gaps 4 y 5 de Codex): `ejecutarLogout` ahora puede (a) resolver `'pendiente'`
    // (no consiguió el lease — no tocó nada localmente) o (b) RECHAZAR (la relectura bajo lease
    // falló repetidamente — tampoco tocó nada). Se tratan distinto a propósito: en (a) el
    // chofer igual debe ver "sesión cerrada" ya (requisito de producto, la limpieza real llega
    // después vía `intentarRevocacionesPendientes`), así que el reset de `estado` sigue
    // corriendo igual que en el camino feliz. En (b) la sesión local sigue siendo VÁLIDA —
    // resetear `estado` acá desincronizaría la UI del almacenamiento real (el chofer creería
    // estar deslogueado mientras `restaurarSesion` lo vuelve a meter a `operacion` en el
    // próximo arranque) — se informa el error y se deja `estado.sesion` intacto para reintentar.
    try {
      await ejecutarLogout(deviceId.current ?? estado.deviceId ?? undefined);
    } catch (error: unknown) {
      if (mounted.current) {
        setEstado((actual) => ({ ...actual, cargando: false, error: mensajeUsuario(error) }));
      }
      return;
    }
    // H5: `ESTADO_INICIAL` limpia `estado`, pero este ref vive fuera de `estado` — sin este
    // reset explícito, una racha de 401 de la sesión que se está cerrando sobrevivía al
    // logout y podía combinarse con un solo 401 de la sesión siguiente.
    fallos401Acumulados.current = 0;
    // Entrega 3: mismo motivo, para el circuit breaker del refresh (global al módulo).
    reiniciarCircuitoRefresh();
    if (mounted.current) setEstado({ ...ESTADO_INICIAL, etapa: 'vehiculo' });
  }, [estado.deviceId]);

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
    // Rescope SESION_NO_VIGENTE, punto C ("no sync attempts while sesionNoVigente"): mientras se
    // espera que el chofer toque "Finalizar" (recorrido activo, ver `cerrarSesionPorNoVigente`),
    // este camino corre cada `REFRESCO_MS` (`use-sync-status.ts`) — sin este corte, reintentaría
    // refresh/sync (y la relectura bajo lease de `confirmarTokenRechazadoVigente`) en cada ciclo
    // mientras la sesión sigue vigente en pantalla solo para no desmontar `GpsProvider`.
    if (estado.sesionNoVigente) return null;
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
      // Entrega 28: corte de raíz, ANTES de `clasificarFalloAccessToken` — este camino corre
      // cada `REFRESCO_MS` (15s, `use-sync-status.ts`) mientras haya sesión, así que sin este
      // chequeo un token muerto de verdad seguiría golpeando la red cada ciclo (nunca cuenta
      // como "no revalidada": eso implica que puede recuperarse solo, y esto no puede).
      if (esSesionNoVigente(error)) {
        await cerrarSesionPorNoVigente(obtenerRefreshTokenRechazado(error) ?? sesion.refreshToken);
        return null;
      }
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
      // borrado automático sigue siendo exclusivo de `logout()` (y, desde la Entrega 28, de
      // `cerrarSesionPorNoVigente` arriba).
      return null;
    }
  }, [estado.sesion, estado.sesionNoVigente, sincronizarSesionIrrecuperable, cerrarSesionPorNoVigente]);

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
    finalizarTrasSesionNoVigente,
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
 * Fix: single-flight sobre el refresh, con el `refreshToken` (ya RECONCILIADO contra disco —
 * ver `reconciliarConDisco`/`refrescar` más abajo) como clave. Toda llamada concurrente a
 * `refrescar()` para el mismo token vigente comparte la ÚNICA promesa en vuelo en vez de
 * disparar una rotación paralela — `refrescarConReintentos` y `obtenerAccessToken` pasan por
 * esta misma función, así que quedan cubiertos automáticamente. La entrada se borra del mapa
 * en el `finally`, tanto si resuelve como si rechaza: así un rechazo nunca queda cacheado — el
 * próximo llamador (p. ej. el siguiente intento de `refrescarConReintentos`, tras el backoff)
 * dispara un intento nuevo, no reutiliza el error viejo. Si el token SÍ fue revocado
 * server-side, ese 401 real se sigue propagando a todos los que esperaban la promesa
 * compartida, y `refrescarConReintentos` lo sigue tratando como falla tras agotar reintentos —
 * la semántica de `sesionNoRevalidada` no cambia. */
const refrescosEnVuelo = new Map<string, Promise<SesionMovilGuardada>>();

/**
 * G3/R4 (hallazgo de `/codex-debug verify-fix` sobre `ea3d84e`, ALTO — reemplaza el diseño
 * anterior de esta función, que reconciliaba DESPUÉS de un 401): el SDK de Transistorsoft
 * corre el headless task en SU PROPIO contexto JS, distinto del que arranca al reabrir la app.
 * Un tick headless puede rotar el refresh token de T0 a T1 y persistirlo en SecureStore
 * mientras el contexto de foreground, recién arrancado, todavía tiene T0 en memoria. Ese T0 ya
 * fue canjeado server-side: enviarlo recibe un 401 REAL, aunque la sesión sea perfectamente
 * válida — SecureStore ya tiene T1.
 *
 * El diseño ANTERIOR reconciliaba reactivamente: intentaba con T0, capturaba el 401, RECIÉN
 * ahí releía disco y reintentaba con T1 — pero ese primer intento con T0 fallido SIEMPRE
 * pasaba primero por `intentarRefrescarConCircuito`, así que SIEMPRE contaba como un fallo 401
 * real contra el circuit breaker (`circuitoTrasFallo401`). Con el circuito ya en
 * `UMBRAL_FALLOS_ABRIR_CIRCUITO - 1` fallos previos (4), ese intento con T0 era el QUINTO — el
 * circuito se ABRÍA en ESE MISMO `intentarRefrescarConCircuito`, ANTES de que el código
 * alcanzara siquiera a releer disco. El reintento con T1 que venía después quedaba bloqueado
 * por el circuito que su propio intento fallido acababa de abrir — `CircuitoRefreshAbiertoError`
 * en vez de la rotación exitosa que T1 hubiera dado. Y cada probe POSTERIOR del backoff volvía
 * a repetir T0 (nunca releía disco de nuevo, el reintento con T1 vivía solo en el `catch` de
 * un único intento), reabriendo el circuito en loop — `obtenerAccessToken` quedaba en `null`
 * indefinidamente pese a que T1 era válido desde el principio.
 *
 * Fix: reconciliar ANTES de intentar, no después de fallar. `refrescar()` relee SIEMPRE la
 * sesión persistida (best-effort — ver el `catch` de abajo) antes de tocar la red; si el
 * `refreshToken` en disco difiere del que trae `guardada` (memoria), es evidencia de que OTRO
 * contexto ya lo rotó, y se adopta el de disco DE ENTRADA. Con esto, el ÚNICO intento de red
 * de esta llamada usa siempre el token más vigente conocido sin golpear el servidor — un T0 ya
 * sabido obsoleto JAMÁS se envía, así que el circuito nunca cuenta un fallo evitable por él (el
 * 401 que abría el circuito en el diseño viejo simplemente no vuelve a ocurrir). Además, la
 * reconciliación ahora ocurre ANTES del single-flight (`refrescar`, abajo): dos llamadas
 * concurrentes que arrancan con el mismo T0 viejo en memoria reconcilian AL MISMO T1 y
 * comparten la única request — nunca dos rotaciones en paralelo, ni siquiera con el reintento
 * de disco de por medio (antes, ese reintento llamaba a `intentarRefrescarConCircuito` DIRECTO,
 * salteando el single-flight).
 *
 * Cubre foreground Y headless con un solo fix porque los dos pasan por ESTA función: los 4 call
 * sites de `refrescar()` (`reconciliarSesion`, `refrescarConReintentos` y `obtenerAccessToken`
 * acá abajo, más `obtenerAccessTokenHeadless` en `headless-task.ts`) terminan todos acá.
 */
async function reconciliarConDisco(guardada: SesionMovilGuardada): Promise<SesionMovilGuardada> {
  try {
    const enDisco = await cargarSesionMovil();
    if (enDisco && enDisco.refreshToken !== guardada.refreshToken) {
      return enDisco;
    }
  } catch {
    // Best-effort: si la lectura de disco falla (SecureStore no disponible, corrupción), seguimos
    // con `guardada` tal cual — un fallo acá no debe impedir el intento de refresh con lo que ya
    // teníamos en memoria.
  }
  return guardada;
}

/** `export` solo para el test de single-flight (`use-auth-movil.refrescar.test.ts`) — no se
 * usa fuera de este módulo en producción. */
export async function refrescar(guardada: SesionMovilGuardada): Promise<SesionMovilGuardada> {
  // G3/R4: reconciliar ANTES de calcular la clave del single-flight — ver el docblock de
  // `reconciliarConDisco`. Así, toda llamada (aunque arranque con un token de memoria distinto
  // y desactualizado) converge a la MISMA clave si el token vigente en disco es el mismo.
  const vigente = await reconciliarConDisco(guardada);
  // Punto 7 (code review 2026-09-25): si `reconciliarConDisco` adoptó una sesión de DISCO
  // porque OTRO contexto ya rotó el refresh token (`vigente !== guardada`), y esa sesión de
  // disco todavía tiene el access token VIGENTE, no hace falta rotar de nuevo acá — la rotación
  // ya la hizo el otro contexto hace un instante. Sin este chequeo, cada contexto que
  // reconciliaba contra un T1 recién rotado igual disparaba SU PROPIA request de refresh sobre
  // T1 (en vez de reusar el access token que esa rotación ya trajo), multiplicando refreshes
  // evitables exactamente en el escenario (headless + foreground concurrentes) que
  // `reconciliarConDisco` existe para cubrir. Comparación estricta (sin margen): mismo criterio
  // que el resto del archivo (`obtenerAccessToken` más abajo, `headless-task.ts`) — no hay una
  // constante de margen para `accessTokenExpiresAt` en este código base, así que no se inventa
  // una acá.
  if (vigente !== guardada && new Date(vigente.accessTokenExpiresAt) > new Date()) {
    return vigente;
  }
  const clave = vigente.refreshToken;
  const enVuelo = refrescosEnVuelo.get(clave);
  if (enVuelo) return enVuelo;

  const promesa = ejecutarRefresh(vigente);
  refrescosEnVuelo.set(clave, promesa);
  try {
    return await promesa;
  } finally {
    refrescosEnVuelo.delete(clave);
  }
}

/** Mismo generador de token de lease que `drenaje-oportunista.ts` (`generarTokenLease`) —
 * duplicado a propósito, no importado: no es un identificador criptográfico, solo necesita
 * distinguir intentos concurrentes de ESTE dispositivo para `liberarLeaseConCooldown`
 * (`owner = token`, ver su comentario en `db/outbox.ts`). */
function generarTokenLeaseRefresh(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Intervalo de poll mientras se espera el lease `refresh-sesion` — corto a propósito: el
 * peor caso (el dueño actual termina su única request de red y libera con cooldown 0) se
 * resuelve en el orden de cientos de ms, no de segundos. */
const INTERVALO_POLL_LEASE_REFRESH_MS = 150;

/**
 * G1 (hallazgo de `/codex-debug verify-fix`, ALTO): a diferencia del drenado oportunista
 * (`drenaje-oportunista.ts`), acá NO se puede desistir en silencio si el lease está tomado —
 * el caller necesita el resultado del refresh sí o sí. Reintenta adquirir con un poll corto
 * hasta el TTL del lease ajeno (`TTL_LEASE_REFRESH_SESION_MS`): pasado ese tiempo, el dueño
 * anterior o bien ya liberó (éxito/fallo de su request) o su fila quedó huérfana y
 * `adquirirLease` la reclama sola en el siguiente intento — nunca hace falta esperar más que
 * eso. Devuelve `false` (en vez de esperar indefinidamente) si ni así se consigue — caso
 * patológico (dos rondas de contención seguidas): `ejecutarRefresh` YA NO degrada a un refresh
 * sin lease en ese caso (ver `ReintentarRefreshMasTardeError` y el docblock de `ejecutarRefresh`
 * — ronda 4 de `/codex-debug verify-fix`, ese camino reproducía la carrera original).
 */
async function adquirirLeaseRefreshConEspera(
  db: SQLite.SQLiteDatabase,
  token: string,
  esperaMaximaMs: number = TTL_LEASE_REFRESH_SESION_MS,
): Promise<boolean> {
  const limiteMs = Date.now() + esperaMaximaMs;
  for (;;) {
    const ahoraMs = Date.now();
    const obtenido = await adquirirLease(
      db,
      ID_LEASE_REFRESH_SESION,
      token,
      ahoraMs,
      TTL_LEASE_REFRESH_SESION_MS,
    );
    if (obtenido) return true;
    if (Date.now() >= limiteMs) return false;
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_POLL_LEASE_REFRESH_MS));
  }
}

/**
 * Rescope SESION_NO_VIGENTE (decisión del CTO, code review de `fix/sesion-no-vigente`): antes
 * de CUALQUIER acción destructiva ante `SESION_NO_VIGENTE` (borrar la sesión en foreground —
 * `cerrarSesionPorNoVigente` — o marcar el flag durable en headless —
 * `obtenerAccessTokenHeadless`, `headless-task.ts`), releer el refresh token PERSISTIDO bajo el
 * MISMO lease `refresh-sesion` que usa `ejecutarRefresh`, y actuar solo si sigue siendo el
 * mismo que `refreshTokenRechazado`. Nunca compara contra la copia en memoria del caller, que
 * pudo quedar vieja si, ENTRE que el servidor rechazó ese token y que el caller llega a este
 * chequeo, un login nuevo (u otra rotación) ya escribió un token DISTINTO en disco — en ese
 * caso se descarta el rechazo (`vigente: false`) y se devuelve la sesión de disco para que el
 * caller la adopte sin borrar nada.
 *
 * Mismo fallback best-effort que G1(a) en `ejecutarRefresh`: si no consigue el lease a tiempo,
 * relee igual sin él — esto es de SOLO LECTURA (nunca persiste nada bajo este lease), así que
 * no hay nada que proteger de una escritura concurrente; degradar a una relectura sin lease es
 * preferible a bloquear indefinidamente una decisión que de todos modos es una comparación de
 * lectura.
 */
export async function confirmarTokenRechazadoVigente(
  refreshTokenRechazado: string,
): Promise<{ vigente: true } | { vigente: false; sesionEnDisco: SesionMovilGuardada | null }> {
  const db = await abrirOutbox();
  const tokenLease = generarTokenLeaseRefresh();
  const obtuvoLease = await adquirirLeaseRefreshConEspera(db, tokenLease);
  try {
    const enDisco = await cargarSesionMovil().catch(() => null);
    if (!enDisco || enDisco.refreshToken !== refreshTokenRechazado) {
      return { vigente: false, sesionEnDisco: enDisco };
    }
    return { vigente: true };
  } finally {
    if (obtuvoLease) {
      await liberarLeaseConCooldown(db, ID_LEASE_REFRESH_SESION, tokenLease, Date.now(), 0);
    }
  }
}

/** Veredicto puro (sin `setEstado`/`mounted`) de `decidirCierrePorNoVigente` — separado para
 * poder testearlo sin el arnés de React que este paquete no tiene (mismo patrón que
 * `clasificarFalloAccessToken`/`debeRestaurarComoDeslogueado`, ver sus docblocks). */
export type VeredictoCierrePorNoVigente =
  | { tipo: 'token_superado'; sesionEnDisco: SesionMovilGuardada | null }
  | { tipo: 'esperar_finalizar' }
  | { tipo: 'borrar' };

/**
 * Rescope SESION_NO_VIGENTE (decisión del CTO, code review de `fix/sesion-no-vigente` —
 * reemplaza el borrado incondicional que hacía `cerrarSesionPorNoVigente`). Extraída a
 * standalone (mismo patrón que `refrescar`/`ejecutarLogout`/`debeRestaurarComoDeslogueado`) para
 * poder testear la decisión B+C sin renderizar el hook. `refreshTokenRechazado`: el token que el
 * servidor rechazó en ESTE intento (ver `obtenerRefreshTokenRechazado`, `auth-movil-api.ts`);
 * opcional porque algún caller defensivo puede no tenerlo — sin él, se salta el chequeo B (no hay
 * nada que comparar) y se procede directo al chequeo C.
 *
 * B: antes de CUALQUIER acción destructiva, se relee el refresh token PERSISTIDO bajo el lease
 * `refresh-sesion` (`confirmarTokenRechazadoVigente`, arriba) y se actúa solo si sigue siendo el
 * mismo que el servidor rechazó — si difiere, un login (u otra rotación) más reciente ya superó
 * este rechazo: `'token_superado'`, el caller descarta el error y adopta lo que haya en disco,
 * sin borrar nada ni tocar `etapa`.
 *
 * C: con un recorrido ACTIVO (`hayRecorridoActivoGlobal`, `estado-recorrido-activo.ts`), borrar
 * la sesión/cambiar `etapa` acá desmontaría `GpsProvider` — ver el comentario grande en
 * `reconciliarSesion` sobre las "8 sesiones abiertas" — y mataría el tracking SIN
 * `fin_recorrido`. `'esperar_finalizar'`: el caller prende `sesionNoVigente` para que
 * `OperationScreen` bloquee con un aviso y el chofer confirme "Finalizar"; el borrado real llega
 * recién con `finalizarTrasSesionNoVigente`, después de `gps.detener()`. Sin recorrido:
 * `'borrar'`, el camino directo de siempre.
 */
export async function decidirCierrePorNoVigente(
  refreshTokenRechazado?: string,
): Promise<VeredictoCierrePorNoVigente> {
  if (refreshTokenRechazado) {
    const chequeo = await confirmarTokenRechazadoVigente(refreshTokenRechazado);
    if (!chequeo.vigente) {
      return { tipo: 'token_superado', sesionEnDisco: chequeo.sesionEnDisco };
    }
  }
  if (hayRecorridoActivoGlobal()) {
    return { tipo: 'esperar_finalizar' };
  }
  return { tipo: 'borrar' };
}

/**
 * G1 (`/codex-debug verify-fix` ronda 4): señaliza contención pasajera del lease `refresh-sesion`
 * sin evidencia de que el token en memoria esté mal — el caller (`refrescarConReintentos`,
 * `obtenerAccessToken`) ya trata cualquier error NO-`AuthMovilApiError`/401 como transitorio, así
 * que esto NUNCA cuenta contra el circuit breaker ni prende `sesionNoRevalidada`. Ver el
 * docblock de `ejecutarRefresh` para la rama que la lanza.
 */
export class ReintentarRefreshMasTardeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReintentarRefreshMasTardeError';
  }
}

/**
 * G3-logout (verify-fix, punto 3 — decisión del CTO): `ejecutarRefresh` lanza esto cuando,
 * bajo el lease `refresh-sesion` ya adquirido, `cargarSesionMovil()` devuelve `null` — evidencia
 * de que `ejecutarLogout` (más abajo) ganó la carrera por el MISMO lease, revocó la sesión y la
 * borró ANTES de soltarlo. No es un 401 (nadie tocó la red) ni un error de red: es información
 * definitiva de que ya no hay nada que refrescar. Mismo tratamiento que
 * `ReintentarRefreshMasTardeError` en los callers (no cuenta contra el circuito), pero semántica
 * distinta — no tiene sentido reintentar esto "más tarde": la sesión está cerrada.
 */
export class SesionCerradaEnRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SesionCerradaEnRefreshError';
  }
}

/**
 * Único punto que golpea la red de refresh — ya recibe la sesión RECONCILIADA (`refrescar`,
 * arriba se encarga de eso, antes de entrar al single-flight). Sin retry propio: si
 * `intentarRefrescarConCircuito` falla (401 real, circuito abierto, o red), el error se propaga
 * tal cual — no hay nada más que reconciliar acá, ya se hizo antes de llegar. `sin llamadas
 * directas a `intentarRefrescarConCircuito` fuera de `refrescar()`" (decisión de diseño del
 * CTO): esta es la ÚNICA función del módulo que la invoca.
 *
 * G1 (hallazgo de `/codex-debug verify-fix`, ALTO — reemplaza el diseño anterior, que solo
 * reconciliaba una vez en `refrescar()` antes del single-flight EN MEMORIA): ese single-flight
 * (`refrescosEnVuelo`) es por CONTEXTO JS, así que dos contextos (foreground/headless) podían
 * releer el mismo T0 casi al mismo tiempo, cada uno en su propio single-flight, y los dos
 * llegar hasta acá. Ahora TODO el tramo releer-decidir-refrescar-persistir corre bajo el lease
 * SQLite `ID_LEASE_REFRESH_SESION` (mismo mecanismo que `ID_LEASE_DRENAJE`, que sí cruza
 * contextos): solo un contexto puede estar en esta sección a la vez. El que entra segundo
 * espera el lease y, al conseguirlo, relee disco DE NUEVO — si el primero ya rotó, adopta el
 * token nuevo sin tocar la red; el circuito de `intentarRefrescarConCircuito` solo se toca
 * cuando, incluso con el lease en mano, el token en disco sigue siendo el mismo que se iba a
 * enviar (ahí un 401 es evidencia real, no un artefacto de carrera).
 *
 * G1 ronda 4 (hallazgo de `/codex-debug verify-fix`, ALTO — reemplaza DOS partes del diseño
 * anterior):
 * (a) Se ELIMINA el camino "sin lease": si `adquirirLeaseRefreshConEspera` agota su espera, este
 *     diseño anterior refrescaba igual, sin exclusión — reproduciendo la carrera original que el
 *     lease existe para cerrar. Ahora, sin lease, NO se toca la red: se relee disco una vez más
 *     (best-effort) y, si cambió, se adopta; si no, se lanza `ReintentarRefreshMasTardeError` —
 *     el caller ya sabe tratar eso como transitorio, sin abrir el circuito.
 * (b) Antes de PERSISTIR el resultado de un refresh exitoso, se verifica con
 *     `renovarLease` (compare-and-set por `owner`) que el lease sigue siendo nuestro — a la vez
 *     que se renueva su TTL, cubriendo el caso de una operación de red más lenta de lo esperado.
 *     Si lo perdimos (`renovado === false`), NO se pisa el disco a ciegas: se relee y, si otro
 *     contexto ya dejó un token distinto (más nuevo que el que enviamos), se adopta sin más. Si
 *     el disco sigue mostrando el token que acabamos de invalidar server-side y nadie más
 *     avanzó, no hay forma segura de persistir la rotación que el servidor YA aceptó — caso
 *     aceptado EXPLÍCITAMENTE (decisión del CTO): esta rotación exitosa queda sin reflejar en
 *     ningún almacenamiento local, y el PRÓXIMO intento manda el token ahora inválido, recibe un
 *     401 real, y sigue el camino normal (sesión no revalidada → login limpio). No se reintenta
 *     la persistencia para no arriesgar pisar un estado más nuevo que el propio.
 *
 * También aborta sin tocar la red (`SesionCerradaEnRefreshError`) si, ya con el lease en mano,
 * `cargarSesionMovil()` devuelve `null` — `ejecutarLogout` (más abajo) pudo haber ganado la
 * carrera por este mismo lease y borrado la sesión.
 */
async function ejecutarRefresh(guardada: SesionMovilGuardada): Promise<SesionMovilGuardada> {
  const db = await abrirOutbox();
  const tokenLease = generarTokenLeaseRefresh();
  const obtuvoLease = await adquirirLeaseRefreshConEspera(db, tokenLease);
  if (!obtuvoLease) {
    // G1(a): sin lease, NO se toca la red — ver el docblock de arriba. Solo queda una relectura
    // best-effort: si alguien más ya rotó mientras esperábamos, la adoptamos gratis; si no, no
    // hay evidencia de nada roto, solo de contención — se señaliza como transitorio.
    Sentry.addBreadcrumb({
      category: 'auth-movil',
      level: 'warning',
      message: 'Lease refresh-sesion no disponible a tiempo; se difiere sin tocar la red (G1a)',
    });
    const relectura = await reconciliarConDisco(guardada);
    if (relectura.refreshToken !== guardada.refreshToken) return relectura;
    throw new ReintentarRefreshMasTardeError(
      'No se pudo adquirir el lease de refresh-sesion a tiempo y no hay evidencia de que otro contexto ya haya rotado; reintentar más tarde sin tocar la red.',
    );
  }

  try {
    // Lectura AUTORITATIVA bajo el lease — a diferencia de `reconciliarConDisco` (best-effort,
    // solo para la clave del single-flight FUERA del lease), acá SÍ importa distinguir un fallo
    // de lectura (best-effort: seguimos con `guardada`) de una ausencia EXPLÍCITA de sesión
    // (`null`, ver `SesionCerradaEnRefreshError` arriba): esa ausencia es información, no un
    // fallo, y no se degrada a `guardada`.
    let enDiscoBajoLease: SesionMovilGuardada | null;
    try {
      enDiscoBajoLease = await cargarSesionMovil();
    } catch {
      // Punto 2 (`/codex-debug verify-fix` ronda 6, ALTO, decisión del CTO — reemplaza el
      // fallback anterior a `guardada`): un fallo de LECTURA bajo el lease no es evidencia de
      // que el token en memoria siga siendo el vigente — otro contexto pudo haber rotado
      // exactamente en esta ventana, y degradar a `guardada` (memoria) podía mandarle al
      // servidor un T0 ya canjeado, contando un 401 evitable contra el circuito. Se aborta sin
      // tocar la red (mismo tratamiento que la contención de lease, G1a): transitorio, no
      // cuenta para el circuito, el caller reintenta más tarde.
      throw new ReintentarRefreshMasTardeError(
        'Fallo al releer la sesión persistida bajo el lease de refresh-sesion; no hay forma segura de saber qué token está vigente, se reintenta más tarde sin tocar la red.',
      );
    }
    if (!enDiscoBajoLease) {
      throw new SesionCerradaEnRefreshError(
        'La sesión fue cerrada (logout) mientras se esperaba el lease de refresh-sesion; se aborta sin tocar la red ni persistir nada.',
      );
    }
    if (enDiscoBajoLease.refreshToken !== guardada.refreshToken) {
      // Otro contexto rotó mientras esperábamos el lease (o entre la reconciliación de
      // `refrescar()` y este punto) — adoptamos SIN tocar la red. Cierra el hallazgo G1: antes,
      // un T0 desactualizado podía llegar hasta acá y su 401 contaba contra el circuito.
      return enDiscoBajoLease;
    }
    // El token en disco sigue siendo el mismo que íbamos a usar: recién ACÁ es seguro que un
    // 401 cuente contra el circuito — no hay evidencia de ninguna rotación concurrente.
    const tokens = await intentarRefrescarConCircuito(enDiscoBajoLease.refreshToken);
    // G1(b) ronda 4: el servidor YA rotó con éxito — antes de persistir, confirmar (y renovar)
    // que seguimos siendo dueños del lease. Ver el docblock de `ejecutarRefresh` para el caso
    // aceptado explícitamente si lo perdimos.
    // Punto 4 (`/codex-debug verify-fix`, decisión del CTO — riesgo residual ACEPTADO, sin
    // cambio de comportamiento): entre que este `renovarLease` confirma (compare-and-set en
    // SQLite) que seguimos siendo dueños del lease y que `actualizarSesionMovil` (abajo)
    // termina de escribir en SecureStore, el runtime de Android puede suspenderse (la app pasa
    // a background y el sistema congela/mata el proceso, o el hilo se apantalla más de lo
    // esperado). Si eso pasa, el lease puede vencer (`TTL_LEASE_REFRESH_SESION_MS`) y otro
    // contexto adquirirlo y rotar de nuevo ANTES de que esta escritura, ya en curso, alcance a
    // aplicarse — el CAS de SQLite protege la FILA del lease, no la escritura posterior en
    // SecureStore: `expo-secure-store` no ofrece ninguna escritura condicional/con fencing
    // (no hay equivalente a un `WHERE owner = ?` para el Keychain/Keystore), así que no hay
    // forma de que esta escritura se autoinvalide si perdimos el lease mientras estaba en
    // vuelo. Cerrar esto de raíz exigiría persistencia con fencing atómico real (fuera del
    // alcance de SecureStore) — no se implementa acá.
    //
    // Punto 9 (code review 2026-09-25 — corrige un comentario FALSO de esta misma sección):
    // NO hay ninguna detección de reuso en el servidor acá. `refresh()`
    // (`apps/api/src/modules/auth-movil/auth-movil.service.ts`) busca la sesión por
    // `refreshTokenHash` (el hash VIGENTE) — nunca lee `refreshTokenHashAnterior`; esa columna
    // la usa SOLO `logout()`, como prueba de posesión de un fallback por `deviceId` (ver su
    // docblock), no como mecanismo de detección de reuso de `refresh()`. Decisión del CTO: NO
    // se implementa detección de reuso en el servidor.
    //
    // Lo que pasa de verdad si esta escritura tardía llega a pisar una rotación más nueva: el
    // teléfono queda en disco con el token YA ROTADO (el que esta escritura tardía persistió,
    // no el que el servidor reconoce como vigente después de la rotación más nueva). El
    // próximo `refresh()` con ese token da 401, el circuit breaker cuenta el fallo y eventualmente
    // abre el circuito, y el chofer termina teniendo que volver a loguearse (Entrega 28,
    // `SESION_NO_VIGENTE`, pendiente de implementar) — no hay corrupción de datos ni sesión de
    // otro chofer comprometida, solo esa degradación a login manual.
    const renovado = await renovarLease(
      db,
      ID_LEASE_REFRESH_SESION,
      tokenLease,
      Date.now(),
      TTL_LEASE_REFRESH_SESION_MS,
    );
    if (!renovado) {
      const relecturaTrasPerderLease = await cargarSesionMovil().catch(() => null);
      if (
        relecturaTrasPerderLease &&
        relecturaTrasPerderLease.refreshToken !== enDiscoBajoLease.refreshToken
      ) {
        return relecturaTrasPerderLease;
      }
      Sentry.captureException(
        new Error('Se perdió el lease refresh-sesion tras una rotación exitosa; no se persiste'),
        { tags: { contexto: 'use-auth-movil', paso: 'lease-perdido-post-rotacion' } },
      );
      throw new Error(
        'Se perdió el lease de refresh-sesion después de que el servidor ya rotó exitosamente; no hay forma segura de persistir sin arriesgar pisar un estado más nuevo. El próximo 401 exigirá un login limpio (caso aceptado explícitamente, ver el docblock de ejecutarRefresh).',
      );
    }
    return await actualizarSesionMovil(enDiscoBajoLease, tokens);
  } finally {
    // Cooldown 0: a diferencia del drenado, acá no hace falta un piso entre intentos — el
    // single-flight en memoria y el circuit breaker ya evitan machacar la red; el próximo
    // contexto que necesite el lease debe poder tomarlo de inmediato.
    await liberarLeaseConCooldown(db, ID_LEASE_REFRESH_SESION, tokenLease, Date.now(), 0);
  }
}

/** Punto 3 (verify-fix, decisión del CTO): margen sobre `TTL_LEASE_REFRESH_SESION_MS` que
 * `ejecutarLogout` espera además del TTL del lease — logout YA NO degrada al token de memoria
 * si no consigue el lease a tiempo (ver el docblock de `ejecutarLogout`), así que tiene que
 * esperar lo que haga falta. El lease vence SOLO (todo dueño legítimo lo suelta o lo deja
 * expirar dentro de `TTL_LEASE_REFRESH_SESION_MS` desde que lo adquirió) — este margen extra
 * solo cubre el jitter del poll (`INTERVALO_POLL_LEASE_REFRESH_MS`) y relojes no perfectamente
 * sincronizados entre el momento en que ESTA espera arrancó y el momento en que el dueño previo
 * (si lo hay) adquirió el suyo. */
const MARGEN_ESPERA_LEASE_LOGOUT_MS = 5_000;

/** Punto 3 (verify-fix ronda 6): número de intentos de `cargarSesionMovil()` dentro de
 * `ejecutarLogout` antes de rendirse y devolver el error al llamador SIN tocar almacenamiento
 * — ver el gap de Codex en el docblock de `ejecutarLogout`. */
const REINTENTOS_LECTURA_SESION_LOGOUT = 3;

async function leerSesionParaLogoutConReintentos(): Promise<SesionMovilGuardada | null> {
  let ultimoError: unknown;
  for (let intento = 0; intento < REINTENTOS_LECTURA_SESION_LOGOUT; intento++) {
    try {
      return await cargarSesionMovil();
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError;
}

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO — reemplaza el diseño anterior, que
 * degradaba a `estado.sesion?.refreshToken` en memoria si no conseguía el lease a tiempo):
 * lógica de `logout()` extraída a standalone (mismo patrón que `refrescar`/`ejecutarRefresh`)
 * para poder testearla sin el arnés de React que este paquete no tiene (ver el comentario de
 * `clasificarFalloAccessToken` más abajo).
 *
 * `use-auth-movil.service.ts:logout` (API) revoca por MATCH EXACTO del `refreshTokenHash`
 * vigente, con un fallback que solo cubre UNA rotación de historia
 * (`refreshTokenHashAnterior`). El `logout()` viejo mandaba `estado.sesion?.refreshToken`
 * (React, en memoria) — si el headless task rotó dos veces (T0→T1→T2) mientras foreground
 * seguía mostrando T0, el servidor no reconocía T0 y el logout terminaba en el camino no-op
 * silencioso, dejando la sesión ABIERTA del lado del servidor. El fallback a memoria cuando el
 * lease estaba ocupado reproducía EXACTAMENTE el mismo bug bajo contención — el hallazgo que
 * cierra este cambio.
 *
 * Fix: SIEMPRE espera el lease `refresh-sesion` (el mismo de `ejecutarRefresh`) con poll hasta
 * `TTL_LEASE_REFRESH_SESION_MS + MARGEN_ESPERA_LEASE_LOGOUT_MS` — nunca degrada a memoria. El
 * lease vence SOLO (ningún dueño legítimo lo retiene más allá de su propio TTL), así que esa
 * espera SIEMPRE termina consiguiéndolo salvo el caso patológico de abajo. Una vez con el lease,
 * relee el refresh token PERSISTIDO (nunca la memoria) antes de revocar — con eso alcanza el
 * token EXACTO que el servidor reconoce como vigente, sin importar cuántas rotaciones headless
 * hayan pasado.
 *
 * Gap 4 (`/codex-debug verify-fix` ronda 6, decisión del CTO — reemplaza el diseño anterior, que
 * SEGUÍA adelante y ejecutaba toda la sección crítica igual aunque `obtuvoLease` fuera `false`):
 * sin lease no hay sección crítica — punto. Si el margen se agota (síntoma grave: SQLite
 * inaccesible, reloj roto), NO se relee, revoca ni borra nada: se marca la intención de forma
 * durable (`marcarLogoutSolicitado`) y se devuelve `'pendiente'` sin tocar el almacenamiento de
 * la sesión. El chofer de todos modos ve la sesión cerrada YA (el caller, `logout()` en el hook,
 * limpia el `estado` de React sin importar este resultado) — la limpieza real y la revocación
 * server-side se completan en el próximo arranque o ciclo de drenado, cuando
 * `intentarRevocacionesPendientes` encuentra la marca y reintenta `ejecutarLogout` completo
 * (la sesión sigue intacta en disco mientras tanto, nunca se tocó sin el lease).
 *
 * Gap 5 (`/codex-debug verify-fix` ronda 6, decisión del CTO — reemplaza el diseño anterior, que
 * ignoraba un fallo de `cargarSesionMovil()` y borraba la sesión igual, sin revocar ni dejar
 * ningún registro): si la relectura falla tras `REINTENTOS_LECTURA_SESION_LOGOUT` intentos, se
 * propaga el error al llamador SIN tocar almacenamiento — ni se borra la sesión local ni se
 * persiste nada. La sesión queda intacta para un logout posterior.
 *
 * Orden (decisión del CTO, con lease y credenciales ya leídas): primero se persiste la
 * INTENCIÓN de revocación (el refresh token leído) — así, si el proceso muere entre el borrado
 * local y que el POST de red confirme, la intención sobrevive y `intentarRevocacionesPendientes`
 * la retoma. Recién después se borra la sesión local (el chofer espera que "cerrar sesión"
 * limpie el teléfono YA) y se intenta revocar en la red; al confirmar (204), se borra SOLO esa
 * intención — nunca las de otros logouts que puedan estar en vuelo (ver `sesion-movil-store.ts`,
 * punto 4).
 *
 * Marca la sesión como cerrada (`borrarSesionMovil`) ANTES de soltar el lease: cualquier
 * `ejecutarRefresh` que estaba esperando este MISMO lease lo adquiere DESPUÉS, encuentra
 * `cargarSesionMovil()` en `null` y aborta (`SesionCerradaEnRefreshError`) sin tocar la red ni
 * persistir nada — ver ese chequeo arriba. Así, un refresh que "termina después" del logout
 * nunca resucita una sesión ya cerrada en disco.
 */
export async function ejecutarLogout(
  deviceIdParaLogout: string | undefined,
  opciones?: {
    // Punto 3 (code review 2026-09-25): solo lo pasa `intentarRevocacionesPendientes` cuando
    // dispara este logout PORQUE leyó `hayLogoutSolicitado()` en `true` — nunca el logout
    // directo del chofer (`logout()` en el hook), que no depende de esa marca. Ver el chequeo
    // bajo lease más abajo.
    soloSiSigueSolicitadoBajoLease?: boolean;
  },
): Promise<'completado' | 'pendiente'> {
  const db = await abrirOutbox();
  const tokenLease = generarTokenLeaseRefresh();
  const obtuvoLease = await adquirirLeaseRefreshConEspera(
    db,
    tokenLease,
    TTL_LEASE_REFRESH_SESION_MS + MARGEN_ESPERA_LEASE_LOGOUT_MS,
  );
  if (!obtuvoLease) {
    // Gap 4: caso patológico (ver el docblock de arriba) — no debería ocurrir nunca dado el
    // margen. Sin lease, NADA de lectura/revocación/borrado corre acá.
    Sentry.captureException(
      new Error('No se pudo adquirir el lease refresh-sesion para logout ni con margen'),
      { tags: { contexto: 'use-auth-movil', paso: 'logout-lease-no-adquirido' } },
    );
    await marcarLogoutSolicitado().catch(() => {});
    return 'pendiente';
  }
  try {
    // Punto 3 (code review 2026-09-25): `intentarRevocacionesPendientes` pudo haber leído la
    // marca de logout pendiente ANTES de que `guardarSesionMovil` (login nuevo, concurrente) la
    // borrara — para cuando este logout consigue el lease, la sesión que `guardarSesionMovil`
    // dejó en disco puede ya ser la NUEVA, no la que originó la marca. Relee la marca ACÁ, con
    // el lease ya tomado (`guardarSesionMovil` no toma este lease al escribir, así que esto no
    // cierra la ventana del todo, pero la reduce a lo que dura este `await`): si ya no está,
    // un login más reciente la superó — no revocar ni tocar la sesión (nueva) que haya en
    // disco. Riesgo residual documentado en `guardarSesionMovil`.
    if (opciones?.soloSiSigueSolicitadoBajoLease) {
      const sigueSolicitado = await hayLogoutSolicitado().catch(() => true);
      if (!sigueSolicitado) {
        return 'completado';
      }
    }
    // Gap 5: si esto agota sus reintentos, se propaga SIN tocar almacenamiento — ver el
    // docblock de arriba.
    const vigente = await leerSesionParaLogoutConReintentos();
    const refreshTokenParaRevocar = vigente?.refreshToken;
    if (refreshTokenParaRevocar) {
      // Orden (ver el docblock de arriba): persistir la intención PRIMERO.
      const idRevocacion = await guardarRevocacionPendiente({
        refreshToken: refreshTokenParaRevocar,
        deviceId: deviceIdParaLogout,
        intentos: 0,
      });
      await borrarSesionMovil();
      try {
        // Entrega 3: se manda el `deviceId` como fallback server-side — ver el docblock de
        // `AuthMovilService.logout` para el porqué (refresh token localmente obsoleto por una
        // rotación cuya respuesta el cliente nunca confirmó recibir).
        await authMovilApi.logout(refreshTokenParaRevocar, deviceIdParaLogout);
        // 204: la intención ya se cumplió — borrar SOLO esta entrada (nunca un borrado global,
        // ver `sesion-movil-store.ts` punto 4: puede haber otras intenciones en vuelo).
        await borrarRevocacionPendientePorId(idRevocacion);
      } catch {
        // Punto 3: revocación de red fallida — la intención ya quedó persistida arriba, no
        // hace falta volver a guardarla. Se reintenta en el próximo arranque/drenado (ver
        // `intentarRevocacionesPendientes`).
      }
    } else {
      // Sin refresh token que revocar (nunca hubo sesión) — solo limpiar local.
      await borrarSesionMovil();
    }
    return 'completado';
  } finally {
    await liberarLeaseConCooldown(db, ID_LEASE_REFRESH_SESION, tokenLease, Date.now(), 0);
  }
}

/** Punto 3 (verify-fix, decisión del CTO): tope de intentos NO-red antes de descartar una
 * revocación pendiente (ver `intentarRevocacionesPendientes`) — un fallo de RED no cuenta
 * contra este tope (se reintenta indefinidamente hasta que haya conectividad); solo un fallo
 * con respuesta real del servidor (4xx/5xx/contrato) tres veces seguidas hace desistir. */
export const TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED = 3;

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO): reintenta las revocaciones de logout
 * que quedaron pendientes porque `ejecutarLogout` no pudo completarlas por falta de red (ver su
 * docblock). Se llama desde `restaurarSesion` ("próximo arranque con red") y desde
 * `intentarDrenarOportunista` (`drenaje-oportunista.ts`, "próximo ciclo de drenado") — ambos
 * puntos donde ya hay, o estamos por confirmar, conectividad. No usa el lease `refresh-sesion`
 * para ESTA parte: la sesión asociada a cada refresh token ya está borrada (el logout que la
 * generó ya limpió el disco), así que no hay ningún token vigente con el que pueda chocar.
 *
 * Punto 4 (verify-fix ronda 6): itera TODAS las entradas de `listarRevocacionesPendientes`
 * (antes era una sola) — cada una se procesa y se borra de forma independiente
 * (`borrarRevocacionPendientePorId`), así que una que está en vuelo/reintentando nunca pisa ni
 * borra a otra que se guardó mientras tanto (ver `sesion-movil-store.ts`, punto 4).
 *
 * Punto 3 (gap 4 de Codex): además, si un logout anterior no llegó a conseguir el lease
 * `refresh-sesion` (`ejecutarLogout` devolvió `'pendiente'` y marcó la intención con
 * `marcarLogoutSolicitado`, sin haber leído ningún token todavía), reintenta acá
 * `ejecutarLogout` completo — misma cola/mismo punto de retoma que las revocaciones con token ya
 * conocido. Si esta vez sí consigue el lease, sigue el camino normal completo (lee la sesión,
 * que sigue intacta en disco, persiste la intención, borra local, revoca).
 *
 * NUNCA rechaza — todos los callers la disparan fire-and-forget.
 *
 * Punto 4 (code review 2026-09-25): esta función hace read-modify-write sobre la colección de
 * revocaciones pendientes (ver `sesion-movil-store.ts`, que ahora sincroniza esa parte bajo
 * `ID_LEASE_REVOCACIONES_PENDIENTES`) — pero llamados CONCURRENTES a esta misma función, dentro
 * del MISMO contexto JS, igual multiplicaban trabajo redundante sin necesidad (cada uno vuelve a
 * listar/reintentar las mismas entradas). `drenaje-oportunista.ts:120` la dispara sin `await` en
 * cada fix (mitigado además por su propio throttle, punto 8) y `restaurarSesion` también la
 * dispara al arrancar — de sobra para que dos pasadas se solapen en la práctica. Single-flight +
 * piso de 10 s a nivel de MÓDULO (memoria, no cruza contextos — igual que `backoffActualMs` en
 * `drenaje-oportunista.ts`, ver su comentario): si ya hay una pasada en vuelo, los llamadores
 * subsiguientes ESPERAN esa misma promesa en vez de arrancar la suya; si la última pasada
 * terminó hace menos del piso, se resuelve al toque sin hacer nada.
 */
const PISO_ENTRE_PASADAS_REVOCACIONES_MS = 10_000;
let pasadaRevocacionesEnVuelo: Promise<void> | null = null;
let ultimaPasadaRevocacionesMs = 0;

/** SOLO para tests: ver el mismo patrón en `reiniciarThrottleDrenajeOportunistaParaTests`
 * (`drenaje-oportunista.ts`) — sin este reset, los tests de este archivo (que corren varias
 * pasadas en milisegundos de wall-clock real) se saltearían entero a partir de la segunda. Sin
 * caller en producción. */
export function reiniciarThrottleRevocacionesPendientesParaTests(): void {
  pasadaRevocacionesEnVuelo = null;
  ultimaPasadaRevocacionesMs = 0;
}

export function intentarRevocacionesPendientes(): Promise<void> {
  if (pasadaRevocacionesEnVuelo) return pasadaRevocacionesEnVuelo;
  if (Date.now() - ultimaPasadaRevocacionesMs < PISO_ENTRE_PASADAS_REVOCACIONES_MS) {
    return Promise.resolve();
  }
  const pasada = ejecutarPasadaRevocacionesPendientes().finally(() => {
    ultimaPasadaRevocacionesMs = Date.now();
    pasadaRevocacionesEnVuelo = null;
  });
  pasadaRevocacionesEnVuelo = pasada;
  return pasada;
}

async function ejecutarPasadaRevocacionesPendientes(): Promise<void> {
  let pendientes: Array<RevocacionPendienteGuardada & { id: string }>;
  try {
    pendientes = await listarRevocacionesPendientes();
  } catch {
    pendientes = [];
  }
  for (const pendiente of pendientes) {
    try {
      await authMovilApi.logout(pendiente.refreshToken, pendiente.deviceId);
      await borrarRevocacionPendientePorId(pendiente.id);
    } catch (error) {
      if (error instanceof AuthMovilApiError && error.kind === 'network') {
        // Sin red todavía: se deja esta entrada intacta (no cuenta contra el tope) — se sigue
        // igual con las demás entradas independientes.
        continue;
      }
      const intentos = pendiente.intentos + 1;
      if (intentos >= TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED) {
        Sentry.captureException(error, {
          tags: { contexto: 'auth-movil', paso: 'revocacion-pendiente-agotada' },
          extra: { intentos },
        });
        await borrarRevocacionPendientePorId(pendiente.id).catch(() => {});
        continue;
      }
      // Reescribe la MISMA entrada (mismo refresh token ⇒ mismo id derivado) con el contador
      // actualizado — nunca crea una entrada nueva ni toca las demás.
      await guardarRevocacionPendiente({ ...pendiente, intentos }).catch(() => {});
    }
  }

  let solicitado: boolean;
  try {
    solicitado = await hayLogoutSolicitado();
  } catch {
    return;
  }
  if (!solicitado) return;
  try {
    const idDispositivo = await obtenerDeviceIdMovil();
    const resultado = await ejecutarLogout(idDispositivo, { soloSiSigueSolicitadoBajoLease: true });
    if (resultado === 'completado') {
      await borrarLogoutSolicitado().catch(() => {});
    }
    // Si sigue `'pendiente'`, la marca queda intacta a propósito — el próximo ciclo reintenta.
  } catch {
    // Best-effort (p. ej. `cargarSesionMovil` agotó sus reintentos dentro de `ejecutarLogout`):
    // la marca queda intacta, se reintenta en el próximo ciclo — esta función nunca rechaza.
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
 * constante del umbral) — solo lo deja sin sumar.
 *
 * Punto 10 (code review 2026-09-25): tampoco suma un `CircuitoRefreshAbiertoError` — tiene
 * `status: 401` a propósito (ver su docblock en `refresh-circuit-breaker.ts`), pero es una
 * decisión LOCAL (el circuito ya estaba abierto por fallos anteriores), nunca evidencia NUEVA
 * del servidor. Contarlo acumularía la racha más rápido de lo que el servidor realmente la
 * generó — el umbral (`UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA`) existe para confirmar con
 * el servidor, no con el propio circuito local.
 *
 * Entrega 28: tampoco suma un `SESION_NO_VIGENTE` — el caller (`obtenerAccessToken`) ya lo
 * intercepta ANTES de llegar acá (ver ese chequeo), así que en la práctica esta función nunca
 * lo ve desde ese call site; se excluye igual acá, defensivamente, para que esta función siga
 * siendo correcta en solitario (p. ej. si algún test o caller futuro la llama directo) — un
 * corte definitivo nunca debería sumar a una racha pensada para confirmar ambigüedad. */
export function clasificarFalloAccessToken(
  error: unknown,
  fallos401AcumuladosPrevios: number,
): { fallos401Acumulados: number; marcarSesionNoRevalidada: boolean } {
  if (
    error instanceof AuthMovilApiError &&
    error.status === 401 &&
    !(error instanceof CircuitoRefreshAbiertoError) &&
    !esSesionNoVigente(error)
  ) {
    const fallos401Acumulados = fallos401AcumuladosPrevios + 1;
    return {
      fallos401Acumulados,
      marcarSesionNoRevalidada: fallos401Acumulados >= UMBRAL_401_ACUMULADOS_SESION_NO_REVALIDADA,
    };
  }
  return { fallos401Acumulados: fallos401AcumuladosPrevios, marcarSesionNoRevalidada: false };
}

/**
 * Fix drenado en background (2026-09-25): decide si `restaurarSesion` debe tratar el arranque
 * como deslogueado por una marca `marcarLogoutSolicitado()` pendiente — ver el comentario del
 * call site en `restaurarSesion`. Extraída a standalone y exportada para poder testearla sin el
 * arnés de React que este paquete no tiene (mismo patrón que `clasificarFalloAccessToken`,
 * `refrescar` y `ejecutarLogout`, todas en este archivo).
 *
 * Fail-closed: si la LECTURA de la marca falla (SecureStore no disponible/corrupto), se trata
 * IGUAL que si la marca estuviera presente. Sin esa señal, no hay forma de descartar que un
 * logout haya quedado pendiente — y el costo de un falso "sesión cerrada" (el chofer legítimo
 * tiene que volver a loguearse) es mucho menor que el de dejar operando, sin saberlo, a un
 * chofer que ya pidió cerrar sesión en un teléfono que puede estar compartido con otro.
 */
export async function debeRestaurarComoDeslogueado(): Promise<boolean> {
  try {
    return await hayLogoutSolicitado();
  } catch {
    return true;
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
