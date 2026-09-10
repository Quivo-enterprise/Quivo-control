import * as Sentry from '@sentry/react-native';
import BackgroundGeolocation from 'react-native-background-geolocation';
import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  ID_LEASE_DRENAJE,
} from '../../db/outbox';
import { sincronizarPendientes } from './sync-outbox';

/**
 * Drenado OPORTUNISTA del outbox en background (Entrega 2,
 * `docs/plan-correccion-post-piloto-2026-09-09.md`) — causa raíz del síntoma más reportado del
 * piloto ("tengo que cerrar la app para que se actualice la ubicación"). `headless-task.ts`
 * escribe al outbox en cada fix, pero NUNCA lo drena por su cuenta; el único motor de sync
 * hasta esta entrega era un `setInterval` de 15 s dentro de `use-sync-status.ts`, un HOOK DE
 * PANTALLA — con la app en background no hay árbol de React montado, así que ese intervalo
 * simplemente no existe. Esta función se cuelga del evento de ubicación en ambos caminos
 * (headless y foreground, ver los call sites) para que el drenado ocurra sin depender de que
 * haya una pantalla viva.
 *
 * Respeta el diseño de `docs/handoff.md:109-131` (mutex + lease, piso de 10 s, backoff con
 * `Date.now()`) con UNA corrección explícita del CTO sobre ese documento: el mutex vive en
 * SQLite (`sync_lease`, `db/outbox.ts`), no en memoria — ver el comentario de
 * `ID_LEASE_DRENAJE` en `outbox.ts` para el porqué (headless y foreground pueden ser contextos
 * JS DISTINTOS en Android, y un `let` de módulo no los cubre a los dos).
 *
 * 🔴 `Date.now()`, NO `setTimeout`, para el backoff: en background, RN congela los timers JS
 * apenas la Activity pausa (`JavaTimerManager.onHostPause`, citado en `docs/handoff.md`) —
 * un backoff basado en `setTimeout` simplemente nunca dispararía en el escenario que esta
 * función existe para cubrir. Acá no hace falta un timer para "esperar": el piso y el backoff
 * son enteramente pasivos — se expresan como el `expira_at` que queda en la fila del lease, y
 * el PRÓXIMO evento de ubicación (que sí va a llegar, es la razón por la que esta función se
 * invoca) es quien vuelve a preguntar si ya se puede intentar.
 */

/** Piso duro entre intentos EXITOSOS — evita que un GPS a alta frecuencia (distanceFilter 15 m
 * ≈ cada pocos segundos a velocidad de calle) dispare un POST por cada fix. Valor fijado en el
 * encargo. */
const PISO_ENTRE_INTENTOS_MS = 10_000;

/** Backoff tras un fallo de transporte — arranca en el mismo piso y crece exponencial hasta
 * este techo, igual que el motor de sync en primer plano (`sync-outbox.ts`,
 * `BACKOFF_INICIAL_MS`/`BACKOFF_MAXIMO_MS`) para no machacar la red mientras el problema (sin
 * cobertura, 5xx, timeout) persiste. */
const BACKOFF_MAXIMO_MS = 60_000;

/**
 * TTL del lease en sí (distinto del cooldown de arriba) — el techo de tiempo que protege contra
 * un lease HUÉRFANO: si el proceso muere a mitad del `POST` sin llegar a liberar, esta es la
 * ventana máxima que el drenado queda bloqueado antes de que un intento nuevo lo recupere solo.
 *
 * 60 s, no menos: `docs/handoff.md` documenta que en Android, con la Activity pausada, OkHttp
 * corre SIN timeout propio y el `AbortController` de `sync-api.ts` (que depende de un
 * `setTimeout` de 20 s para abortar) puede no disparar nunca — un POST puede quedar colgado de
 * verdad, más allá de su timeout nominal. El TTL tiene que ser mayor a ese peor caso conocido
 * para no reclamar como "huérfano" un intento que en realidad sigue vivo, legítimo y a punto
 * de resolver. Coincide, no por casualidad, con el `heartbeatInterval` del SDK
 * (`background-geolocation.config.ts`): en el peor caso, un lease atascado se libera solo a
 * tiempo para el próximo latido.
 */
const TTL_LEASE_MS = 60_000;

/** Backoff EN MEMORIA — a propósito no vive en SQLite como el lease. No es una garantía de
 * correctitud (eso lo da el lease, que SÍ cruza contextos): es solo una optimización para que
 * reintentos sucesivos dentro del MISMO contexto JS no ataquen la red apenas vence el piso fijo
 * de 10 s tras una racha de fallos. Si el contexto JS se recicla (headless ↔ foreground), este
 * valor se resetea a `PISO_ENTRE_INTENTOS_MS` — peor caso, se reintenta un poco antes de lo
 * ideal, nunca se rompe el mutex. */
let backoffActualMs = PISO_ENTRE_INTENTOS_MS;

function generarTokenLease(): string {
  // No es un identificador criptográfico ni de seguridad — solo necesita ser distinto entre
  // intentos concurrentes de ESTE dispositivo para que `construirLiberarLeaseConCooldown`
  // pueda distinguir "soy el dueño que adquirió este lease" de "otro contexto ya lo tomó de
  // nuevo tras que mi TTL venciera" (ver el comentario de esa función en `outbox.ts`).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Punto de enganche único, llamado desde:
 * - `headless-task.ts`, al final de `tareaHeadlessUbicacion`, CON `await` — el SDK de
 *   Transistorsoft da por terminada la tarea headless en cuanto se ejecuta la última línea de
 *   la función; sin `await` acá, el drenado queda cortado a mitad de camino en cuanto el SDK
 *   libera el wake lock.
 * - `use-gps-operativo.ts`, tras `registrarPuntoGps` en el `onLocation` de foreground.
 * - `background-geolocation.config.ts`, desde el handler de `onHeartbeat` (cada 60 s, aunque el
 *   vehículo esté quieto y no dispare ningún evento `location`).
 *
 * Bajo el PRINCIPIO RECTOR del plan (`la app nunca miente sobre si está REGISTRANDO; solo calla
 * sobre si ya ENVIÓ"): esta función NUNCA debe llegarle al chofer. Ni banner, ni toast, ni
 * `errorGps`. Un fallo de transporte va a Sentry y nada más — la evidencia ya está a salvo en
 * el outbox, drenarla es un detalle de transporte, no de captura.
 *
 * 🔴 Por eso TODO el cuerpo vive bajo un único try/catch defensivo externo: esta función se
 * invoca de dos formas — `await`ada desde el headless (donde una excepción sin capturar
 * rechazaría la promesa que el SDK usa para cerrar la tarea, y además cortaría el `await` que
 * el caller necesita) y "fire and forget" desde el foreground (`void
 * intentarDrenarOportunista(...)`, sin `.catch` propio en el call site) — en NINGÚN camino
 * puede rechazar. El `catch` de `sincronizarPendientes` ya cubre el caso esperado (falla de
 * transporte); este externo cubre lo INESPERADO (p. ej. `abrirOutbox`/`adquirirLease`
 * fallando), que sin este resguardo se filtraría como unhandled rejection en foreground o
 * como una tarea headless rechazada (y sin reintento) en background.
 */
export async function intentarDrenarOportunista(
  obtenerAccessToken: () => Promise<string | null>,
): Promise<void> {
  try {
    const accessToken = await obtenerAccessToken();
    if (!accessToken) {
      // PUNTO DE EXTENSIÓN (Entrega 3, circuit breaker del refresh 401 — no es el alcance de
      // esta entrega): hoy, sin token utilizable (sesión sin restaurar o refresh vencido sin
      // poder renovarse), abortamos el drenado EN SILENCIO. Es la decisión correcta bajo el
      // principio rector: un token vencido es una falla de TRANSPORTE (no se puede hablar con
      // el servidor), nunca de captura — el outbox sigue creciendo sin que el chofer se entere.
      // Cuando la Entrega 3 traiga el circuit breaker de refresh, ESTE es el lugar donde
      // intentar un refresh antes de rendirse (hoy `obtenerAccessToken` ya intenta un refresh
      // normal si el access token venció pero el refresh token sigue vivo — ver
      // `use-auth-movil.ts`; lo que falta es el circuito para cuando el refresh mismo empieza a
      // fallar en bucle).
      return;
    }

    const db = await abrirOutbox();
    const ahoraMs = Date.now();
    const token = generarTokenLease();
    const obtuvoLease = await adquirirLease(db, ID_LEASE_DRENAJE, token, ahoraMs, TTL_LEASE_MS);
    if (!obtuvoLease) {
      // Alguien más lo tiene: o bien otro contexto (headless vs. foreground) está drenando en
      // este mismo instante, o bien el piso de 10 s / el backoff de un intento anterior todavía
      // no venció. En ambos casos, no hay nada que hacer acá — desistir en silencio es el
      // comportamiento correcto, no un error.
      return;
    }

    // 🔴 `startBackgroundTask`/`stopBackgroundTask`: sin esto, Android puede matar el proceso
    // A MITAD del `POST` en cuanto decide que la app ya "terminó" el trabajo que la despertó
    // (el evento `location`/`heartbeat` que disparó este drenado). La evidencia no se pierde
    // (ya está en el outbox), pero el lote quedaría marcado `enviado` sin que nadie lo revierta
    // ni lo confirme — colgado hasta el próximo intento. Pedir la prórroga explícita es lo que
    // le garantiza al request el tiempo de vida que necesita para llegar a su propio `catch`.
    let taskId: number | null = null;
    try {
      taskId = await BackgroundGeolocation.startBackgroundTask();
    } catch (error) {
      // Sin poder pedir la prórroga seguimos igual — un intento sin la garantía extra es mejor
      // que ninguno — pero se reporta: si esto se vuelve frecuente, el análisis de por qué el
      // drenado se corta a mitad de camino empieza acá.
      Sentry.captureException(error, {
        tags: { contexto: 'drenaje-oportunista', paso: 'start-background-task' },
      });
    }

    try {
      await sincronizarPendientes(accessToken);
      // Éxito: resetea el backoff en memoria (ver su comentario) y libera con el piso fijo — el
      // próximo intento, en cualquier contexto, puede volver a intentar en 10 s.
      backoffActualMs = PISO_ENTRE_INTENTOS_MS;
      await liberarLeaseConCooldown(db, ID_LEASE_DRENAJE, token, Date.now(), PISO_ENTRE_INTENTOS_MS);
    } catch (error) {
      // Falla de transporte (sin cobertura, 5xx, timeout, 429): SOLO Sentry, nunca la pantalla
      // del chofer — ver el docblock de la función. La evidencia sigue intacta en el outbox
      // (`sincronizarPendientes` ya revierte su propio lote a `pendiente` en este mismo catch,
      // con el guard de la Entrega 1 protegiendo lo que sí llegó a acusarse).
      Sentry.captureException(error, {
        tags: { contexto: 'drenaje-oportunista' },
        extra: { backoffMsAntesDeEsteFallo: backoffActualMs },
      });
      await liberarLeaseConCooldown(db, ID_LEASE_DRENAJE, token, Date.now(), backoffActualMs);
      backoffActualMs = Math.min(backoffActualMs * 2, BACKOFF_MAXIMO_MS);
    } finally {
      // Se libera la prórroga SIEMPRE (éxito o fallo del POST) y solo si se llegó a obtener —
      // dejar un `taskId` sin cerrar hace que el SDK fuerce el kill de la app para protegerse.
      if (taskId !== null) {
        try {
          await BackgroundGeolocation.stopBackgroundTask(taskId);
        } catch (error) {
          Sentry.captureException(error, {
            tags: { contexto: 'drenaje-oportunista', paso: 'stop-background-task' },
          });
        }
      }
    }
  } catch (error) {
    // Cualquier fallo NO cubierto por los catches internos de arriba (p. ej. `obtenerAccessToken`,
    // `abrirOutbox` o `adquirirLease` rechazando) — ver el docblock de la función para el porqué
    // de este resguardo externo.
    Sentry.captureException(error, {
      tags: { contexto: 'drenaje-oportunista', paso: 'inesperado' },
    });
  }
}
