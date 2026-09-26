import * as Sentry from '@sentry/react-native';
import { AuthMovilApiError, authMovilApi, esSesionNoVigente } from './auth-movil-api';
import type { RefreshMovilResponse } from '@quivo/shared';

/**
 * Circuit breaker del refresh de tokens móviles (Entrega 3,
 * `docs/plan-correccion-post-piloto-2026-09-09.md`) — cierra el defecto documentado en
 * `docs/handoff.md:734-736, 3369-3380`: la app quedó 42 minutos golpeando
 * `POST /v1/mobile/auth/refresh` cada 15 s (29 intentos, 0 éxitos) sin que nadie lo frenara.
 * PR #53 ya distingue un 401 de refresh de un corte de red (`clasificarFalloAccessToken`,
 * `use-auth-movil.ts`) y prende una bandera (`sesionNoRevalidada`), pero NUNCA deja de
 * reintentar — cada tick de `use-sync-status.ts` (`REFRESCO_MS = 15_000`) seguía llamando a
 * la red sin freno. Este módulo agrega el freno que faltaba.
 *
 * 🔴 Alcance deliberadamente angosto: SOLO envuelve `authMovilApi.refresh` (el único camino
 * que golpea `POST /v1/mobile/auth/refresh`). El sync de datos (`sync-outbox.ts` /
 * `sync-api.ts`) usa un cliente HTTP completamente distinto (`shared/api/http-client.ts`,
 * `ApiError`, no `AuthMovilApiError`) y JAMÁS importa este módulo — el outbox sigue creciendo
 * y drenando (cuando hay token) sin que el circuito lo toque. Ver el test de este archivo que
 * verifica esa separación a nivel de imports.
 *
 * Diseño (estado en un módulo, NO en SQLite como el lease de `drenaje-oportunista.ts`): a
 * diferencia del mutex de drenado, este circuito no necesita corrección estricta entre
 * contextos JS (headless vs. foreground) — es una optimización para no golpear la red en
 * vano, no una garantía de exactitud de datos. Si Android recicla el contexto JS, el circuito
 * se resetea a `cerrado` y el peor caso es un intento de más antes de reabrirse — nunca se
 * rompe nada. Mismo criterio que `backoffActualMs` en `drenaje-oportunista.ts`.
 *
 * Estados pensados como funciones PURAS (parametrizadas por `ahoraMs`) para poder testear con
 * reloj falso sin `vi.useFakeTimers()` — mismo patrón que `clasificarFalloAccessToken`
 * (`use-auth-movil.ts`) y el resto del proyecto (no hay arnés jest-expo/RNTL, ver
 * `docs/plan-movil-login-y-pruebas.md` ítem 7-8). La función stateful de más abajo
 * (`intentarRefrescarConCircuito`) es el único punto de mutación del estado en memoria, y es
 * la que consumen `use-auth-movil.ts` (foreground) y `headless-task.ts` (background).
 */

export type EstadoCircuito = 'cerrado' | 'abierto';

export interface EstadoCircuitoRefresh {
  estado: EstadoCircuito;
  /** Fallos 401 reales (NUNCA cuenta cortos-circuito ni errores de red) desde la última vez
   * que el circuito estuvo cerrado. No se resetea al reabrir con backoff mayor — solo un
   * éxito real (`circuitoTrasExito`) lo vuelve a cero. */
  fallosConsecutivos: number;
  /** `Date.now()` (o el reloj falso del test) del momento en que el circuito se abrió por
   * PRIMERA VEZ en esta racha — no se actualiza en reaperturas sucesivas por probes fallidos,
   * es la base de `esSesionIrrecuperable`. */
  primeraAperturaMs: number | null;
  /** No intentar un refresh real antes de este instante. Con el circuito cerrado vale 0
   * (siempre permitido). */
  proximoIntentoMs: number;
  /** Backoff que se aplicó para llegar al `proximoIntentoMs` actual — se dobla en cada probe
   * fallido sucesivo, tope `BACKOFF_MAXIMO_MS`. */
  backoffActualMs: number;
}

/** 5 fallos 401 reales y seguidos abren el circuito (valor fijado en el encargo de la
 * Entrega 3: "reloj falso — 5 fallos → abierto"). Con el poll de 15 s de `use-sync-status.ts`
 * son 60-75 s de intentos reales antes de que el freno entre — tiempo de sobra para no abrir
 * por una ventana de carrera puntual (ver H4 en `use-auth-movil.ts`, que documenta por qué
 * `clasificarFalloAccessToken` no resetea ante un solo fallo aislado). */
export const UMBRAL_FALLOS_ABRIR_CIRCUITO = 5;

/** Backoff inicial al abrir: 30 s. Ya es "minutos" para el segundo probe (dobla a 60 s) y
 * llega al tope en el cuarto. */
export const BACKOFF_INICIAL_MS = 30_000;

/** Techo del backoff — 5 minutos. Ver el docblock del módulo: "backoff a minutos". */
export const BACKOFF_MAXIMO_MS = 5 * 60_000;

/** Circuito abierto por más de este tiempo, sin que ningún probe haya tenido éxito, es la
 * frontera entre "transitorio" (transporte, invisible) y "sesión irrecuperable" (captura,
 * debe hacerse visible — ver `esSesionIrrecuperable` y `EstadoAuthMovil.sesionIrrecuperable`
 * en `use-auth-movil.ts`). 5 minutos: da margen de sobra a un corte de cobertura largo (túnel,
 * sótano) sin gritar de más, y sigue siendo mucho menos que los 42 minutos mudos del bug de
 * QA — con este umbral la Entrega 26 (preflight, fuera de este alcance) podría haber avisado
 * al chofer a los 5 minutos en vez de nunca. */
export const UMBRAL_MS_SESION_IRRECUPERABLE = 5 * 60_000;

export const ESTADO_INICIAL_CIRCUITO_REFRESH: EstadoCircuitoRefresh = {
  estado: 'cerrado',
  fallosConsecutivos: 0,
  primeraAperturaMs: null,
  proximoIntentoMs: 0,
  backoffActualMs: BACKOFF_INICIAL_MS,
};

/** Pura: ¿se puede intentar un refresh REAL (contra la red) en este instante? */
export function puedeIntentarRefresh(estado: EstadoCircuitoRefresh, ahoraMs: number): boolean {
  return estado.estado === 'cerrado' || ahoraMs >= estado.proximoIntentoMs;
}

/** Pura: un refresh exitoso es evidencia positiva del servidor — cierra el circuito del todo,
 * sin importar cuántos fallos hubiera antes. "cerrar al primer éxito" (encargo). */
export function circuitoTrasExito(): EstadoCircuitoRefresh {
  return ESTADO_INICIAL_CIRCUITO_REFRESH;
}

/** Pura: transición tras un 401 REAL de `authMovilApi.refresh` (nunca ante un corto-circuito
 * ni un error de red — el caller es responsable de esa distinción, ver
 * `intentarRefrescarConCircuito`). */
export function circuitoTrasFallo401(
  estado: EstadoCircuitoRefresh,
  ahoraMs: number,
): EstadoCircuitoRefresh {
  const fallosConsecutivos = estado.fallosConsecutivos + 1;
  if (estado.estado === 'cerrado' && fallosConsecutivos < UMBRAL_FALLOS_ABRIR_CIRCUITO) {
    return { ...estado, fallosConsecutivos };
  }
  // Se abre ahora (recién cruzó el umbral) o ya estaba abierto y este fue el probe que
  // también falló — en ambos casos el backoff avanza: arranca en `BACKOFF_INICIAL_MS` la
  // primera vez, se dobla en cada probe fallido sucesivo con tope `BACKOFF_MAXIMO_MS`.
  const backoffActualMs =
    estado.estado === 'abierto'
      ? Math.min(estado.backoffActualMs * 2, BACKOFF_MAXIMO_MS)
      : BACKOFF_INICIAL_MS;
  return {
    estado: 'abierto',
    fallosConsecutivos,
    primeraAperturaMs: estado.primeraAperturaMs ?? ahoraMs,
    proximoIntentoMs: ahoraMs + backoffActualMs,
    backoffActualMs,
  };
}

/** Pura: distingue transitorio (transporte, invisible) de sesión irrecuperable (captura,
 * debe exponerse) — ver `UMBRAL_MS_SESION_IRRECUPERABLE`. */
export function esSesionIrrecuperable(estado: EstadoCircuitoRefresh, ahoraMs: number): boolean {
  return (
    estado.estado === 'abierto' &&
    estado.primeraAperturaMs !== null &&
    ahoraMs - estado.primeraAperturaMs >= UMBRAL_MS_SESION_IRRECUPERABLE
  );
}

/** Único estado mutable del módulo — deliberadamente en memoria, ver el docblock de arriba
 * sobre por qué no hace falta SQLite acá. */
let estadoCircuito: EstadoCircuitoRefresh = ESTADO_INICIAL_CIRCUITO_REFRESH;

export function obtenerEstadoCircuitoRefresh(): EstadoCircuitoRefresh {
  return estadoCircuito;
}

/** Reinicia el circuito a `cerrado` — llamar en cada login exitoso y en `logout()`
 * (`use-auth-movil.ts`), mismo motivo que el reset de `fallos401Acumulados.current` (H5): el
 * circuito es GLOBAL al módulo, no por sesión, así que sin este reset una sesión vieja rota
 * podía dejar el circuito abierto y bloquear (con backoff de minutos) los primeros refreshes
 * de una sesión nueva y perfectamente válida. */
export function reiniciarCircuitoRefresh(): void {
  estadoCircuito = ESTADO_INICIAL_CIRCUITO_REFRESH;
}

/** Corto-circuito: mismo `kind`/`status` que un 401 real de `authMovilApi.refresh`
 * (`AuthMovilApiError('http', ..., 401)`) para que los callers existentes
 * (`refrescarConReintentos`, `obtenerAccessToken` en `use-auth-movil.ts`, que ya hacen
 * `error instanceof AuthMovilApiError && error.status === 401`) lo traten IGUAL que un 401 de
 * verdad — degradan a "sesión no revalidada" sin código nuevo que duplique esa rama. La
 * diferencia real (transitorio vs. sesión irrecuperable) NO vive en el tipo de error sino en
 * `esSesionIrrecuperable(obtenerEstadoCircuitoRefresh(), ahora)`, que `use-auth-movil.ts`
 * consulta aparte. */
export class CircuitoRefreshAbiertoError extends AuthMovilApiError {
  constructor() {
    super('http', 'Circuito de refresh abierto: se posterga el intento', 401);
    this.name = 'CircuitoRefreshAbiertoError';
  }
}

/**
 * Único punto de entrada para un refresh REAL, usado por `refrescar()` (`use-auth-movil.ts`,
 * foreground — ya con su propio single-flight por `refreshToken`, sigue intacto por encima de
 * este wrapper) y por `obtenerAccessTokenHeadless()` (`headless-task.ts`, background — el
 * punto de extensión que la Entrega 2 dejó documentado).
 *
 * Si el circuito está abierto y todavía no venció el backoff: corta ACÁ, sin tocar la red —
 * lanza `CircuitoRefreshAbiertoError` (ver su docblock). Si está cerrado o ya venció el
 * backoff (probe): intenta `authMovilApi.refresh` de verdad y actualiza el estado del
 * circuito según el resultado — éxito lo cierra, 401 real lo hace avanzar (abrir o
 * profundizar el backoff). Un error de RED (offline legítimo, `kind !== 'http'` o
 * `status !== 401`) NO se cuenta como fallo del circuito — misma decisión (b) que
 * `clasificarFalloAccessToken` ya documenta: el corte de red no dice nada sobre si el
 * refresh token es válido.
 */
export async function intentarRefrescarConCircuito(
  refreshToken: string,
  ahoraMs: number = Date.now(),
): Promise<RefreshMovilResponse> {
  if (!puedeIntentarRefresh(estadoCircuito, ahoraMs)) {
    throw new CircuitoRefreshAbiertoError();
  }
  try {
    const tokens = await authMovilApi.refresh(refreshToken);
    const seAbrioAntes = estadoCircuito.estado === 'abierto';
    estadoCircuito = circuitoTrasExito();
    if (seAbrioAntes) {
      Sentry.addBreadcrumb({
        category: 'auth-movil',
        message: 'Circuito de refresh cerrado tras un éxito',
        level: 'info',
      });
    }
    return tokens;
  } catch (error: unknown) {
    // Entrega 28: `SESION_NO_VIGENTE` es evidencia DEFINITIVA del servidor de que esta
    // sesión ya no existe — no es un fallo transitorio del transporte ni una señal parcial
    // sobre la que tenga sentido contar/abrir el circuito. Se re-lanza tal cual, SIN tocar
    // `estadoCircuito`, para que el caller (`refrescar()`/`obtenerAccessTokenHeadless()`)
    // corte de raíz (tokens borrados, login limpio) sin que esto cuente contra la racha de
    // fallos 401 ni dispare el backoff de reapertura del circuito.
    if (esSesionNoVigente(error)) {
      throw error;
    }
    if (error instanceof AuthMovilApiError && error.status === 401) {
      const previo = estadoCircuito;
      estadoCircuito = circuitoTrasFallo401(estadoCircuito, ahoraMs);
      if (previo.estado === 'cerrado' && estadoCircuito.estado === 'abierto') {
        // Recién cruzó el umbral en ESTE intento — reportar una sola vez, no en cada probe
        // futuro (eso sería tan ruidoso como el bug original, solo que en Sentry en vez de
        // en el servidor).
        Sentry.captureMessage('Circuito de refresh móvil abierto tras fallos consecutivos', {
          level: 'warning',
          tags: { contexto: 'refresh-circuit-breaker' },
          extra: {
            fallosConsecutivos: estadoCircuito.fallosConsecutivos,
            backoffMs: estadoCircuito.backoffActualMs,
          },
        });
      }
    }
    // Errores de red u otros: el circuito no se toca — se re-lanza tal cual, igual que antes
    // de que este módulo existiera (`refrescar`/`obtenerAccessTokenHeadless` lo manejan solos).
    throw error;
  }
}
