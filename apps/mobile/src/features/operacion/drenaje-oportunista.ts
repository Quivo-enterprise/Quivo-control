import * as Sentry from '@sentry/react-native';
import BackgroundGeolocation from 'react-native-background-geolocation';
import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  recuperarEnviadosHuerfanos,
  ID_LEASE_DRENAJE,
  PISO_ENTRE_INTENTOS_DRENAJE_MS as PISO_ENTRE_INTENTOS_MS,
  TTL_LEASE_DRENAJE_MS as TTL_LEASE_MS,
} from '../../db/outbox';
import { intentarRevocacionesPendientes } from '../auth/use-auth-movil';
import { drenarLotesConLease } from './sync-outbox';

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
 * Respeta el diseño de `docs/handoff.md:109-131` (mutex + lease, piso de 3 s, backoff con
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

// `PISO_ENTRE_INTENTOS_MS` y `TTL_LEASE_MS` viven ahora en `db/outbox.ts`
// (`PISO_ENTRE_INTENTOS_DRENAJE_MS`/`TTL_LEASE_DRENAJE_MS`, importados arriba con alias para
// no tocar el resto de este archivo) — `sync-outbox.ts` también los necesita para su propia
// variante con lease (hallazgo 6) y no puede importarlos de acá sin crear un ciclo. Ver el
// comentario de `ID_LEASE_DRENAJE` en `outbox.ts` para el detalle de cada valor: 3 s de piso
// entre intentos exitosos (GPS a alta frecuencia no debe disparar un POST por fix) y 60 s de
// TTL del lease (OkHttp en Android con la Activity pausada puede no respetar timeout propio).

/** Backoff tras un fallo de transporte — arranca en `BACKOFF_INICIAL_FALLO_MS` (10 s, SEPARADO
 * del piso de éxito de 3 s: bajar el piso no debe acortar el primer reintento tras un fallo) y
 * crece exponencial (10 → 20 → 40 → 60) hasta este techo, para no machacar la red mientras el
 * problema (sin cobertura, 5xx, timeout) persiste. */
const BACKOFF_INICIAL_FALLO_MS = 10_000;
const BACKOFF_MAXIMO_MS = 60_000;

/**
 * Hallazgo 3 (code review, MEDIO): umbral para `recuperarEnviadosHuerfanos` — ver su docblock
 * en `db/outbox.ts`. Tiene que ser mayor que AMBOS techos conocidos de "todavía en vuelo,
 * legítimo": el timeout del propio request (`REQUEST_TIMEOUT_MS = 20_000`, `sync-api.ts`) y
 * el TTL del lease (`TTL_LEASE_MS`, 60 s, arriba). 90 s deja 30 s de margen sobre el mayor de
 * los dos — de sobra para no reclamar como huérfana una fila cuyo POST todavía puede resolver.
 */
const UMBRAL_RECUPERACION_ENVIADOS_MS = 90_000;

/** Backoff EN MEMORIA — a propósito no vive en SQLite como el lease. No es una garantía de
 * correctitud (eso lo da el lease, que SÍ cruza contextos): es solo una optimización para que
 * reintentos sucesivos dentro del MISMO contexto JS no ataquen la red apenas vence el piso fijo
 * de 3 s tras una racha de fallos. Si el contexto JS se recicla (headless ↔ foreground), este
 * valor se resetea a `BACKOFF_INICIAL_FALLO_MS` — peor caso, se reintenta un poco antes de lo
 * ideal, nunca se rompe el mutex. */
let backoffActualMs = BACKOFF_INICIAL_FALLO_MS;

/**
 * Punto 8 (code review 2026-09-25): throttle en memoria a nivel de MÓDULO, chequeado ANTES de
 * tocar SQLite (`abrirOutbox`/`adquirirLease`) o de disparar `intentarRevocacionesPendientes`
 * (punto 4) — `use-gps-operativo.ts` llama a `intentarDrenarOportunista` en CADA fix de
 * foreground sin ningún throttle propio; a `distanceFilter` de 15 m eso puede ser varias veces
 * por segundo a velocidad de calle. El lease SQLite YA impedía dos drenados CONCURRENTES entre
 * contextos, pero cada intento igual pagaba el costo de abrir la conexión y perder la carrera
 * por el lease — y, peor, disparaba `intentarRevocacionesPendientes` sin condición alguna. Este
 * throttle es SOLO una optimización de ENTRADA a este contexto JS puntual: no reemplaza el
 * lease SQLite (la garantía real de exclusión mutua entre contextos), solo reduce cuántas veces
 * por segundo este contexto intenta entrar en absoluto. Igual que `backoffActualMs` (arriba),
 * vive en memoria a propósito — un reinicio de contexto (headless ↔ foreground) lo resetea, peor
 * caso se reintenta un poco antes de lo ideal, nunca se rompe ninguna garantía.
 */
let ultimoIntentoDrenajeMs = 0;

/** SOLO para tests: los de este archivo corren `intentarDrenarOportunista` muchas veces en
 * segundos de wall-clock real, y sin este reset el throttle de arriba haría que el segundo test
 * en adelante se salteara entero por heredar el timestamp del anterior. Sin caller en
 * producción — el throttle debe persistir mientras el proceso viva. */
export function reiniciarThrottleDrenajeOportunistaParaTests(): void {
  ultimoIntentoDrenajeMs = 0;
  backoffActualMs = BACKOFF_INICIAL_FALLO_MS;
}

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
 * puede rechazar. El `catch` de `drenarLotesConLease`/`sincronizarPendientes` ya cubre el caso
 * esperado (falla de transporte); este externo cubre lo INESPERADO (p. ej.
 * `abrirOutbox`/`adquirirLease` fallando), que sin este resguardo se filtraría como unhandled
 * rejection en foreground o como una tarea headless rechazada (y sin reintento) en background.
 *
 * G1 (hallazgo de `/codex-debug verify-fix`, ALTO): este camino drena con
 * `drenarLotesConLease` (`sync-outbox.ts`), el MISMO bucle compartido que usa
 * `sincronizarPendientesConLease` en foreground — un atraso grande en background ya no queda
 * cortado a un lote por evento de ubicación/heartbeat, ver el docblock de esa función para el
 * detalle de renovación de lease y encadenado.
 */
export async function intentarDrenarOportunista(
  obtenerAccessToken: () => Promise<string | null>,
): Promise<void> {
  // Punto 8 (ver el docblock de `ultimoIntentoDrenajeMs` arriba): se sale ANTES de tocar
  // SQLite o de disparar `intentarRevocacionesPendientes` si el último intento (exitoso o no)
  // fue hace menos del piso — desistir en silencio acá es el comportamiento correcto, igual
  // que cuando no se consigue el lease SQLite más abajo.
  const ahoraInicioMs = Date.now();
  if (ahoraInicioMs - ultimoIntentoDrenajeMs < PISO_ENTRE_INTENTOS_MS) {
    return;
  }
  ultimoIntentoDrenajeMs = ahoraInicioMs;
  // Punto 3 (`/codex-debug verify-fix`, decisión del CTO): "próximo ciclo de drenado" —
  // aprovecha que esta función se dispara con cada fix de ubicación/heartbeat (hay actividad,
  // y probablemente red) para reintentar una revocación de logout que quedó pendiente por
  // falta de conectividad (ver `intentarRevocacionesPendientes`/`ejecutarLogout` en
  // `use-auth-movil.ts`). Fire-and-forget e independiente del lease/token de abajo: nunca
  // rechaza, y no tiene nada que ver con el drenado del outbox en sí.
  void intentarRevocacionesPendientes();
  try {
    const db = await abrirOutbox();
    const ahoraMs = Date.now();
    const token = generarTokenLease();
    // Hallazgo 4a (code review, causa candidata de los `refresh-agotado` de Sentry
    // QUIVO-CONTROL-CONDUCTOR-2): el lease se adquiere ANTES de pedir el access token, no
    // después. Antes, cada tick llamaba a `obtenerAccessToken()` primero y recién DESPUÉS
    // intentaba el lease — con fixes a ~1/s, cada tick disparaba su propio refresh (si el
    // access token estaba vencido) sin importar si iba a ganar el lease o no, multiplicando
    // los refreshes concurrentes exactamente en el escenario que este mecanismo existe para
    // evitar. Con el lease primero, solo el tick que efectivamente va a drenar pide el token
    // — los demás desisten en el siguiente `if (!obtuvoLease)` sin tocar la red de auth. (El
    // hallazgo 4b — single-flight del refresh en sí — se cierra en
    // `obtenerAccessTokenHeadless`/`refrescar()`, ver `headless-task.ts`.)
    const obtuvoLease = await adquirirLease(db, ID_LEASE_DRENAJE, token, ahoraMs, TTL_LEASE_MS);
    if (!obtuvoLease) {
      // Alguien más lo tiene: o bien otro contexto (headless vs. foreground) está drenando en
      // este mismo instante, o bien el piso de 3 s / el backoff de un intento anterior todavía
      // no venció. En ambos casos, no hay nada que hacer acá — desistir en silencio es el
      // comportamiento correcto, no un error.
      return;
    }

    // Hallazgo 3 (code review): con el lease en mano (nadie más está drenando en este
    // instante), es el momento seguro para recuperar filas `enviado` huérfanas — ver el
    // docblock de `recuperarEnviadosHuerfanos` en `db/outbox.ts`. Best-effort: si esto
    // rechaza, el catch externo lo reporta y el drenado normal sigue su curso igual (una
    // pasada sin recuperar no es peor que el comportamiento de antes de este fix).
    try {
      await recuperarEnviadosHuerfanos(db, new Date(ahoraMs - UMBRAL_RECUPERACION_ENVIADOS_MS));
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'drenaje-oportunista', paso: 'recuperar-enviados-huerfanos' },
      });
    }

    // 🔴 `startBackgroundTask`/`stopBackgroundTask`: sin esto, Android puede matar el proceso
    // A MITAD del `POST` (o del refresh de token que puede correr antes) en cuanto decide que
    // la app ya "terminó" el trabajo que la despertó (el evento `location`/`heartbeat` que
    // disparó este drenado). La evidencia no se pierde (ya está en el outbox), pero el lote
    // quedaría marcado `enviado` sin que nadie lo revierta ni lo confirme — el hallazgo 3 de
    // arriba es justamente la red de seguridad para cuando esto pasa igual. Pedir la prórroga
    // explícita es lo que le garantiza al request el tiempo de vida que necesita para llegar a
    // su propio `catch`.
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
      // Hallazgo 4a: el token se pide DESPUÉS de tener el lease — ver el comentario de arriba.
      const accessToken = await obtenerAccessToken();
      if (!accessToken) {
        // PUNTO DE EXTENSIÓN (Entrega 3, circuit breaker del refresh 401): sin token
        // utilizable (sesión sin restaurar o refresh vencido sin poder renovarse), abortamos
        // el drenado EN SILENCIO — falla de TRANSPORTE, nunca de captura. Se libera el lease
        // con el piso fijo (no el backoff completo: no hubo ningún intento de red que haya
        // fallado, solo ausencia de credencial) para que el próximo tick reintente pronto.
        await liberarLeaseConCooldown(
          db,
          ID_LEASE_DRENAJE,
          token,
          Date.now(),
          PISO_ENTRE_INTENTOS_MS,
        );
        return;
      }

      // G1: bucle COMPARTIDO con el foreground — ver el docblock de `drenarLotesConLease`
      // (`sync-outbox.ts`) y el de la función, arriba.
      const { motivo } = await drenarLotesConLease(db, accessToken, token);
      // Éxito (sin excepción, sea cual sea `motivo`): resetea el backoff en memoria — ver su
      // comentario.
      backoffActualMs = BACKOFF_INICIAL_FALLO_MS;
      if (motivo === 'lease-perdido') {
        // R1 (ver `renovarLease`, `db/outbox.ts`): ya no somos el dueño de esta fila — otro
        // contexto la tomó entre lotes. NO liberar: liberar acá pisaría el lease legítimo del
        // nuevo dueño.
        return;
      }
      // G3 (hallazgo de `/codex-debug verify-fix`, MEDIO — sobre este mismo bloque): en
      // headless, alcanzar el tope (`tope-alcanzado`, 20 lotes = hasta 10 000 eventos) libera
      // el lease SIN programar una continuación explícita (sin `setTimeout`/reintento propio)
      // — el resto del atraso queda esperando el PRÓXIMO evento externo. Evaluado y dejado
      // así a propósito, sin cambiar comportamiento:
      // 1. El heartbeat de `background-geolocation.config.ts` sigue disparando cada 60 s
      //    AUNQUE el vehículo esté quieto (no depende de fixes de ubicación) — la continuación
      //    ya está garantizada por ese camino, sin necesitar un mecanismo nuevo.
      // 2. 10 000 eventos por ciclo es un atraso MUY por encima de una jornada completa (a un
      //    fix cada ~10 s, ~8600 eventos en 24 h corridas) — llegar al tope en la práctica
      //    implica ya varias horas sin ninguna conectividad, un escenario extremo donde 60 s
      //    más de espera hasta el próximo heartbeat es insignificante frente al atraso total.
      // 3. Agregar un `setTimeout` propio acá reintroduciría el problema que
      //    `drenaje-oportunista.ts` ya documenta arriba (RN congela los timers JS con la
      //    Activity en pausa) sin necesidad, dado el punto 1.
      // G2: sin enfriamiento si cortamos por el TOPE con pendientes restantes
      // (`tope-alcanzado`) — el próximo evento de ubicación/heartbeat debe poder adquirir el
      // lease de inmediato, en vez de esperar el piso pensado para intentos oportunistas
      // espaciados. Con `motivo: 'agotado'` (ya no queda más), el piso normal sigue aplicando.
      const cooldownMs = motivo === 'tope-alcanzado' ? 0 : PISO_ENTRE_INTENTOS_MS;
      await liberarLeaseConCooldown(db, ID_LEASE_DRENAJE, token, Date.now(), cooldownMs);
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
    // Cualquier fallo NO cubierto por los catches internos de arriba (p. ej. `abrirOutbox` o
    // `adquirirLease` rechazando) — ver el docblock de la función para el porqué de este
    // resguardo externo.
    Sentry.captureException(error, {
      tags: { contexto: 'drenaje-oportunista', paso: 'inesperado' },
    });
  }
}
