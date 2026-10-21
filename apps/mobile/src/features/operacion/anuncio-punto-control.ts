import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Platform, Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import { RADIO_CONFIRMACION_M, type PuntoControlPaquete } from '@quivo/shared';
import type { DeteccionPuntoControl } from '../../gps/geofence';
import {
  claveAnuncio,
  marcarAnuncioProgramado,
  marcarAnuncioProgramando,
  obtenerAnunciosPendientesDeProgramar,
  reclamarIntencionAnuncio,
} from '../../db/outbox';
import { leerDesignacionOrdenLocal } from '../../db/vuelta-actual-local';
import { formatearDistanciaVoz } from './format-distancia';
import { ordenEfectivoPuntos } from './progreso-vuelta';
import { esMotivoAnuncio, type MotivoAnuncio } from './decidir-anuncio';

/**
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 4, "sin setNotificationHandler no se muestra ni
 * suena en foreground"): sin un handler registrado, `expo-notifications` (a partir de la v0.28)
 * NO presenta la notificación mientras la app está en primer plano — ni banner, ni sonido —
 * aunque `scheduleNotificationAsync` resuelva "bien". Se registra UNA sola vez, como efecto de
 * módulo (este archivo lo importan tanto `use-gps-operativo.ts`, en el árbol de React, como
 * `headless-task.ts`/`index.js`, sin árbol — entre los dos cubren tanto el arranque en frío de
 * la app como el registro del headless task, así que no hace falta un punto de entrada
 * dedicado). Fuera del foreground (pantalla apagada, app terminada) este handler NO interviene
 * — Android presenta la notificación directo desde el CANAL nativo (`asegurarCanalNotificacion`
 * más abajo), que ya está configurado con `importance: HIGH` + sonido propio.
 *
 * DECISIÓN (documentada, punto 4 del brief — "evitar doble voz+sonido en foreground si ya hay
 * TTS"): el anuncio de LLEGADA (`anunciarLlegadaPuntoControl`, más abajo) tiene su PROPIO sonido
 * dedicado en foreground (`confirmacion-sonido.ts`, disparado desde `gps-provider.tsx` sobre
 * `gps.ultimoAnuncioLlegada`, con `duckOthers`) — sumarle el sonido del CANAL de esta
 * notificación sería un doble sonido para el mismo paso. Por eso SIEMPRE marca su notificación
 * con `data.silenciarSonidoForeground: true` (ver más abajo) para que este handler NO reproduzca
 * el sonido del canal (el banner SÍ se muestra igual, es solo el audio lo que se evita
 * duplicar) — en headless (sin árbol de React, sin sonido custom) esto es un no-op: Android
 * presenta la notificación directo desde el canal nativo, sin pasar por este handler. La voz de
 * aproximación (`Speech.speak`) no pasa por notificaciones y no se ve afectada por este handler.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const silenciarSonido = notification.request.content.data?.['silenciarSonidoForeground'] === true;
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: !silenciarSonido,
      shouldSetBadge: false,
    };
  },
});

/**
 * ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): `gps-provider.tsx` es un
 * componente React — si el árbol no está montado (pantalla apagada, la condición NORMAL de un
 * chofer manejando) no hay voz, ni sonido, ni toast. Este módulo es DELIBERADAMENTE sin React
 * (sin `import ... from 'react'`, sin hooks): lo llama tanto `tareaHeadlessUbicacion`
 * (`gps/headless-task.ts`, sin árbol de componentes) como `use-gps-operativo.ts` en foreground,
 * como EJECUTOR de las decisiones que YA tomó el único punto de llamada de `decidirAnuncio`
 * dentro de `colaRegistroGps` (`gps/headless-task.ts`) — el chofer escucha/siente lo mismo esté
 * la app en primer plano o no.
 *
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23): este módulo YA NO decide nada — solo EJECUTA. Dos funciones, dos canales
 * completamente separados, ninguno disparado por evidencia:
 * - `anunciarPuntoControl` (fase `'aproximacion'` únicamente): SOLO voz informativa (distancia).
 *   Nunca vibra, nunca notifica — un aviso de que el punto se acerca, no evidencia de que se
 *   pasó ni un anuncio de llegada.
 * - `anunciarLlegadaPuntoControl`/`reintentarAnunciosLlegadaPendientes`: vibración SIEMPRE +
 *   notificación local con sonido, para el motivo (`MotivoAnuncio`, `decidir-anuncio.ts`) que el
 *   único punto de llamada ya decidió — reclama la intención de forma durable ANTES de programar
 *   (punto 3 del brief, ver `db/outbox.ts`), nunca a partir de `fase: 'confirmado'` ni de ningún
 *   otro dato de evidencia.
 */

/**
 * HALLAZGO DE CAMPO (Sentry, build 10 de producción, Galaxy A71 Android 13, post-Entrega 7):
 * `POST_NOTIFICATIONS: not_granted` a pesar de estar declarado en `app.config.ts:52` — en
 * Android 13+ (API 33) es un permiso de RUNTIME real, igual que `ACCESS_FINE_LOCATION`:
 * declararlo en el manifest solo habilita que el sistema pueda llegar a pedirlo, no lo concede.
 * Sin el pedido explícito, `Notifications.scheduleNotificationAsync` de más abajo NO tira
 * error — ejecuta "bien" y el sistema simplemente no muestra nada, indistinguible de "todo
 * OK" desde el código (por eso pasó un build entero sin que nadie lo notara).
 *
 * `asegurarPermisoNotificaciones()` lo pide UNA vez, con la app en FOREGROUND, antes de iniciar
 * el recorrido — la llama `iniciar()` en `use-gps-operativo.ts`. NUNCA se llama desde
 * `headless-task.ts`: el diálogo del sistema necesita una Activity visible para montarse, y en
 * headless no hay ninguna — pedirlo ahí no haría nada (o peor, podría colgar la promesa).
 *
 * Best-effort a propósito, como el resto del módulo: si el chofer deniega, o el pedido mismo
 * falla, el anuncio NO se pierde — la vibración (sin gate, siempre) y la voz de aproximación
 * (que no toca notificaciones) siguen funcionando igual. La notificación es UN canal más, no
 * el único, y `iniciar()` nunca debe bloquearse esperando esta respuesta.
 */
export async function asegurarPermisoNotificaciones(): Promise<Notifications.PermissionStatus | null> {
  try {
    const actual = await Notifications.getPermissionsAsync();
    if (actual.status === Notifications.PermissionStatus.GRANTED) return actual.status;
    const pedido = await Notifications.requestPermissionsAsync();
    return pedido.status;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'pedir-permiso-notificaciones' },
    });
    return null;
  }
}

/**
 * Lectura del estado ACTUAL del permiso, sin disparar el diálogo del sistema (a diferencia de
 * `asegurarPermisoNotificaciones` arriba) — pensada para que la Entrega 26 (preflight de
 * captura) pueda mostrarle al chofer "las notificaciones de confirmación están desactivadas"
 * sin volver a preguntarle en cada chequeo. Esta función NO construye esa UI — solo expone el
 * dato. `null` significa "no se pudo determinar" (fallo del bridge nativo), nunca "denegado":
 * un caller que confunda los dos leería un problema transitorio como una decisión del chofer.
 */
export async function obtenerEstadoPermisoNotificaciones(): Promise<Notifications.PermissionStatus | null> {
  try {
    const actual = await Notifications.getPermissionsAsync();
    return actual.status;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'leer-permiso-notificaciones' },
    });
    return null;
  }
}

/**
 * Canal de notificaciones Android dedicado (Android 8+/O+ IGNORA `content.sound` de una
 * notificación individual — el sonido lo define el CANAL, fijado la PRIMERA vez que se crea
 * en cada dispositivo; cambiarlo después requiere un id de canal nuevo, no alcanza con volver a
 * llamar `setNotificationChannelAsync` con otro `sound`). `importance: HIGH` es lo que hace que
 * la notificación aparezca como heads-up (banner + sonido) en vez de silenciosa en la bandeja —
 * sin esto, un chofer con la pantalla apagada no la ve nunca a tiempo.
 *
 * ID VERSIONADO a propósito (sufijo `-v2`): el día que este timbre cambie (otro `.wav`, otro
 * `vibrationPattern`), el fix NO es editar esta constante — los teléfonos que YA crearon el
 * canal van a seguir sonando con el timbre viejo para siempre (Android ignora el update).
 * El fix es subir a `-v3` acá (el `-v2` pasa a ser el obsoleto que se borra) y actualizar
 * `assets/sounds/<archivo-nuevo>.wav` + `app.config.ts` en el mismo cambio. (`-v1` → `-v2` en
 * la r14: chime saturado.)
 */
const CANAL_ANUNCIO_ANDROID = 'quivo-anuncio-punto-control-v2';
// Histórico: `-v1` sonaba con el chime saturado de la r13; se borra al arrancar la app
// (`limpiarCanalesObsoletos`).
const CANAL_ANUNCIO_ANDROID_OBSOLETO = 'quivo-anuncio-punto-control-v1';

/**
 * Nombre del recurso de sonido tal como lo registra el plugin `expo-notifications` en
 * `app.config.ts` (`sounds: ['./assets/sounds/confirmacion_chime_notificacion_v2.wav']`) — copia
 * DEDICADA del mismo timbre que usa `confirmacion-sonido.ts` (`assets/sounds/
 * confirmacion-chime.wav`), con nombre distinto A PROPÓSITO: los recursos `raw` de Android solo
 * aceptan `[a-z0-9_.]` en el nombre de archivo — un guion (el que tiene el original) rompe el
 * build nativo (`aapt2`) en cuanto el plugin lo copie a `res/raw/`. NO VERIFICADO en dispositivo
 * real en esta sesión (sin acceso a un teléfono) — confirmar que el canal efectivamente suena
 * con este timbre (y no el default del sistema) es parte del preflight de la Entrega 26.
 */
const SONIDO_NOTIFICACION_ANDROID = 'confirmacion_chime_notificacion_v2.wav';

/**
 * Borra los canales Android obsoletos (el `-v1` del chime saturado de la r13 sigue visible en los
 * Ajustes del teléfono aunque ya nada lo use). Se llama UNA vez al arrancar la app (`App.tsx`),
 * solo en Android; fire-and-forget: best-effort, nunca rechaza ni bloquea el arranque.
 */
export function limpiarCanalesObsoletos(): void {
  if (Platform.OS !== 'android') return;
  void Notifications.deleteNotificationChannelAsync(CANAL_ANUNCIO_ANDROID_OBSOLETO).catch(
    () => undefined,
  );
}

let canalConfigurado: Promise<void> | null = null;

/** Crea (o no-opea si ya existe) el canal Android — `setNotificationChannelAsync` es
 * idempotente por `channelId`, así que llamarlo en cada anuncio es seguro, pero se memoiza
 * igual (mismo patrón que `asegurarModoAudioConfigurado` en `confirmacion-sonido.ts`) para no
 * cruzar el bridge nativo de sobra en cada punto de control de la jornada. */
function asegurarCanalNotificacion(): Promise<void> {
  if (!canalConfigurado) {
    canalConfigurado = Notifications.setNotificationChannelAsync(CANAL_ANUNCIO_ANDROID, {
      name: 'Puntos de control',
      importance: Notifications.AndroidImportance.HIGH,
      sound: SONIDO_NOTIFICACION_ANDROID,
      vibrationPattern: [0, 250, 250, 250],
    }).then(
      () => undefined,
      (error: unknown) => {
        // Best-effort: si el canal no se pudo crear, `scheduleNotificationAsync` de abajo va a
        // fallar también (o va a caer al canal default del sistema, según la versión de
        // Android) — de cualquier forma queda capturado ahí. Acá solo se reporta el fallo
        // puntual de creación del canal para que quede diferenciado en Sentry.
        Sentry.captureException(error, {
          tags: { contexto: 'anuncio-punto-control', paso: 'crear-canal-android' },
        });
      },
    );
  }
  return canalConfigurado;
}

/**
 * Posición humana (1-indexada) del punto de control en el ORDEN EFECTIVO de la vuelta — el mismo
 * que muestran el mapa y el sheet (`ordenEfectivoPuntos`: el PC de espera de Molinos no cuenta
 * salvo designación activa). La designación se lee del cache SQLite de la vuelta actual, así que
 * sirve igual en foreground y headless. `numero` = `undefined` si el punto no está en el orden
 * efectivo; `espera` = es un PC de espera SIN designación activa (no se anuncia).
 */
async function ubicarEnOrdenEfectivo(
  puntoControlId: string,
  opciones: AnuncioPuntoControlOpciones,
): Promise<{ numero: number | undefined; esperaSinDesignacion: boolean }> {
  const designacion = await leerDesignacionOrdenLocal(opciones.sesionId);
  const idx = ordenEfectivoPuntos(opciones.puntosControl, designacion).findIndex(
    (p) => p.id === puntoControlId,
  );
  if (idx >= 0) return { numero: idx + 1, esperaSinDesignacion: false };
  const pc = opciones.puntosControl.find((p) => p.id === puntoControlId);
  return { numero: undefined, esperaSinDesignacion: pc?.rol === 'espera' };
}

/**
 * Dedupe EN MEMORIA (no persistido) del aviso de aproximación, por `puntoControlId` — sin
 * `pasada` (una `deteccionAproximacion` nunca la trae, ver `location-task.ts`). A propósito no
 * usa SQLite: es informativo, no evidencia (ver el docblock del módulo), y `location-task.ts`
 * ya documenta que "el dedupe de 'ya lo anuncié' es responsabilidad del caller" — sin este Set,
 * la voz repetiría "Punto de control 16 a 140 metros" en CADA fix mientras el vehículo siga
 * dentro de `RADIO_AVISO_M` (varios fixes seguidos, no uno solo).
 *
 * FIX POST-REVISIÓN (bug 4, "la voz vuelve a anunciar la aproximación al alejarse"/"la
 * aproximación real de la vuelta siguiente queda en silencio"): se limpia con
 * `limpiarAproximacionesAnunciadas` (abajo), NUNCA al confirmar. Antes se borraba acá mismo
 * dentro de `anunciarPuntoControl` en cuanto el punto CONFIRMABA — con el vehículo todavía a
 * bastante menos de `RADIO_AVISO_M` (la confirmación ocurre en el mínimo local, muy cerca del
 * punto), el próximo fix mientras sigue alejándose (todavía dentro de `RADIO_AVISO_M`, que es
 * mucho más ancho) volvía a pasar por `fase: 'aproximacion'` con la entrada YA libre → segunda
 * voz anunciando la "aproximación" de un punto del que se está alejando.
 *
 * FIX POST-REVISIÓN (G1, "la voz se re-anuncia dentro del radio de aviso"): la limpieza YA NO se
 * dispara con el re-armado de DETECCIÓN (`puntosRearmados`, sobre `radioToleranciaM` — mucho más
 * chico que `RADIO_AVISO_M`) — eso era justo el bug: con `radioToleranciaM=30` y
 * `RADIO_AVISO_M=150`, la detección re-arma en cuanto el vehículo supera ~45 m, con el vehículo
 * TODAVÍA a 60-140 m, bien adentro de la zona de aviso — la voz volvía a sonar mientras el
 * vehículo se seguía alejando. Ahora se dispara con `puntosRearmadosVoz` (`gps/geofence.ts`),
 * una histéresis PROPIA sobre `RADIO_AVISO_M` (rearma recién más allá de
 * `RADIO_AVISO_M * FACTOR_REARME_RADIO`, con los mismos `FIXES_REARME_CONSECUTIVOS` fixes
 * seguidos que ya exige el rearme), independiente de la de detección y NUNCA al confirmar. Ver
 * el comentario largo de `avisoVozDentro`/`puntosRearmadosVoz` en `geofence.ts`.
 */
const aproximacionesAnunciadas = new Set<string>();

/**
 * FIX POST-REVISIÓN (G1): libera el dedupe de aproximación para los puntos cuya histéresis de
 * VOZ (`puntosRearmadosVoz`, `gps/geofence.ts`) ACABA de re-armar en este tick/heartbeat — ver
 * el comentario largo de `aproximacionesAnunciadas` arriba. Llamarla con una lista vacía (el
 * caso normal, ninguna voz re-armó) es un no-op.
 */
export function limpiarAproximacionesAnunciadas(puntosControlIds: readonly string[]): void {
  for (const id of puntosControlIds) {
    aproximacionesAnunciadas.delete(id);
    veredictoEsperaSinDesignacion.delete(id);
  }
}

/** Cuánto se recuerda que un PC de espera no tiene designación (solo para el aviso de aproximación;
 * una designación nueva tarda a lo sumo esto en habilitar la voz de Molinos). */
const VIGENCIA_VEREDICTO_ESPERA_MS = 3_000;
const veredictoEsperaSinDesignacion = new Map<string, number>();

export interface AnuncioPuntoControlOpciones {
  sesionId: string;
  puntosControl: PuntoControlPaquete[];
}

/**
 * Anuncia el AVISO de aproximación — SOLO voz, nunca vibra ni notifica. Es la ÚNICA fase que
 * `DeteccionPuntoControl.fase` sigue distinguiendo tras el rediseño (ver `gps/geofence.ts`): un
 * aviso informativo mientras el vehículo se acerca, nunca evidencia ni anuncio de llegada. NUNCA
 * rechaza: el intento de voz va en su propio `try/catch` con `Sentry.captureException` — el
 * caller (`anunciarDeteccionesDelTick`) puede invocarla sin su propio `try/catch`.
 */
export async function anunciarPuntoControl(
  // `db` sin uso hoy (sin dedupe persistido para la voz — ver `aproximacionesAnunciadas`, en
  // memoria): se conserva en la firma para no romper a `anunciarDeteccionesDelTick` ni a los
  // callers existentes (`headless-task.ts`, `use-gps-operativo.ts`).
  _db: SQLite.SQLiteDatabase,
  deteccion: DeteccionPuntoControl,
  opciones: AnuncioPuntoControlOpciones,
): Promise<void> {
  if (deteccion.fase !== 'aproximacion') return;

  // Dedupe primero: el caso normal (ya anunciado) no lee SQLite ni calcula el orden.
  if (aproximacionesAnunciadas.has(deteccion.puntoControlId)) return;
  // Molinos sin designación se vuelve a detectar en cada tick de aproximación (no entra al set):
  // el veredicto negativo se recuerda unos segundos para no leer/parsear SQLite en cada uno.
  const ahoraMs = Date.now();
  const vigenteHasta = veredictoEsperaSinDesignacion.get(deteccion.puntoControlId);
  if (vigenteHasta !== undefined && ahoraMs < vigenteHasta) return;
  const { numero, esperaSinDesignacion } = await ubicarEnOrdenEfectivo(
    deteccion.puntoControlId,
    opciones,
  );
  // Molinos sin designación activa no es parte de la ruta: no se anuncia (ni se agrega al set).
  if (esperaSinDesignacion) {
    veredictoEsperaSinDesignacion.set(deteccion.puntoControlId, ahoraMs + VIGENCIA_VEREDICTO_ESPERA_MS);
    return;
  }
  veredictoEsperaSinDesignacion.delete(deteccion.puntoControlId);
  // Se vuelve a chequear: otro tick pudo anunciarlo mientras se leía la designación.
  if (aproximacionesAnunciadas.has(deteccion.puntoControlId)) return;
  const identificador = numero !== undefined ? `Punto de control ${numero}` : 'Punto de control';
  aproximacionesAnunciadas.add(deteccion.puntoControlId);
  try {
    // `volume: 1.0` explícito, mismo criterio que tenía `gps-provider.tsx` antes de esta
    // entrega: el pedido original fue "sonido super fuerte para que se escuche", y no todos
    // los OEM respetan el volumen máximo del stream de media por default.
    Speech.speak(`${identificador}, a ${formatearDistanciaVoz(deteccion.distanciaM)}.`, {
      volume: 1.0,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'voz-aproximacion' },
    });
  }
}

/**
 * Aviso genérico (voz + vibración + notificación local) en el MISMO canal del anuncio de punto de
 * control (`CANAL_ANUNCIO_ANDROID`) — lo usa el aviso de designación a Molinos
 * (`features/vuelta-actual`) para no crear un canal nuevo. Best-effort como el resto del módulo:
 * nunca rechaza; un fallo de voz o de notificación va a Sentry y no corta a la otra. Devuelve
 * `true` si la notificación se programó. `identifier` fijo = un reintento reemplaza en vez de apilar.
 */
export async function anunciarAvisoEnCanal(aviso: {
  identifier: string;
  titulo: string;
  cuerpo: string;
  /** Texto para la voz; `null` = sin voz. */
  voz: string | null;
}): Promise<boolean> {
  Vibration.vibrate([0, 250, 250, 250]);
  if (aviso.voz) {
    try {
      Speech.speak(aviso.voz, { volume: 1.0 });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'anuncio-punto-control', paso: 'voz-aviso-canal' },
      });
    }
  }
  try {
    await asegurarCanalNotificacion();
    await Notifications.scheduleNotificationAsync({
      identifier: aviso.identifier,
      // La voz ya suena en foreground: el sonido del canal se silencia ahí (ver el handler de
      // arriba); en background Android presenta la notificación directo desde el canal.
      content: { title: aviso.titulo, body: aviso.cuerpo, data: { silenciarSonidoForeground: true } },
      trigger: { channelId: CANAL_ANUNCIO_ANDROID },
    });
    return true;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'notificacion-aviso-canal' },
    });
    return false;
  }
}

/**
 * Programa una notificación local para `fechaMs` (trigger por fecha de `expo-notifications`, en el
 * canal del anuncio): suena aunque la app no esté en primer plano. Con el mismo `identifier` REEMPLAZA
 * a la anterior. Sin el permiso de alarma exacta Android la entrega "inexacta" (puede atrasarse en
 * Doze). `true` solo si quedó programada.
 */
export async function programarAvisoEnCanal(aviso: {
  identifier: string;
  titulo: string;
  cuerpo: string;
  fechaMs: number;
}): Promise<boolean> {
  try {
    await asegurarCanalNotificacion();
    await Notifications.scheduleNotificationAsync({
      identifier: aviso.identifier,
      content: { title: aviso.titulo, body: aviso.cuerpo, data: { silenciarSonidoForeground: true } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: aviso.fechaMs,
        channelId: CANAL_ANUNCIO_ANDROID,
      },
    });
    return true;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'programar-aviso-canal' },
    });
    return false;
  }
}

/** Cancela SOLO la notificación programada con ese `identifier` (no la ya presentada). Best-effort:
 * nunca rechaza. */
export async function cancelarProgramada(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // silencioso: si no existía o falla el SO, no hay nada más que hacer
  }
}

/** Cancela la programada y quita de la bandeja la ya presentada. Best-effort: nunca rechaza. */
export async function cancelarAvisoProgramado(identifier: string): Promise<void> {
  await cancelarProgramada(identifier);
  await descartarNotificacionAviso(identifier);
}

/** Quita de la bandeja una notificación local ya presentada (`identifier` del aviso). Best-effort:
 * nunca rechaza; que no exista o falle el SO no es un problema para el chofer. */
export async function descartarNotificacionAviso(identifier: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(identifier);
  } catch {
    // silencioso: la notificación vieja simplemente queda hasta que el chofer la limpie
  }
}

/** Texto del anuncio de "llegaste" según el motivo que `decidirAnuncio`
 * (`decidir-anuncio.ts`) ya decidió — ninguno de los tres menciona `RADIO_CONFIRMACION_M`
 * salvo `'proximidad'` (el único motivo que en verdad significa "el fix midió esa distancia");
 * los dos fallbacks (vehículo detenido sin haberse acercado nunca, o saliendo del radio sin
 * haber anunciado) tienen su PROPIO texto — punto 7 del brief ("el texto «a menos de 40 m»
 * también se usa en los fallbacks", ya cerrado acá). */
function textoAnuncioLlegada(motivo: MotivoAnuncio): string {
  switch (motivo) {
    case 'proximidad':
      return `Estás a menos de ${RADIO_CONFIRMACION_M} metros del punto de control.`;
    case 'fallback-tiempo':
      return 'Llevás varios minutos junto al punto de control — quedó registrado.';
    case 'fallback-salida':
      return 'El punto de control quedó registrado en tu recorrido.';
  }
}

/**
 * Programa la notificación de "llegaste" (best-effort). Compartida por `anunciarLlegadaPuntoControl`
 * (primer intento, tras reclamar la intención) y `reintentarAnunciosLlegadaPendientes` (reintento
 * de una intención YA reclamada) — ninguna de las dos vuelve a reclamar acá.
 *
 * Devuelve `true` solo si la vibración+notificación de verdad se dispararon (`scheduleNotificationAsync`
 * resolvió) — FIX POST-REVISIÓN (hallazgo 3, "el chime suena aunque el reclamo se perdió"): los
 * callers en React (`use-gps-operativo.ts`) usan este valor para decidir si corresponde el sonido
 * custom de foreground (`gps.ultimoAnuncioLlegada`) — nunca lo asumen de antemano. Que
 * `marcarAnuncioProgramado` (el bookkeeping DESPUÉS de programar) falle no cambia este resultado:
 * la vibración/notificación YA ocurrieron, es solo la fila de SQLite la que puede quedar
 * `'programando'` un poco más (el próximo reintento la retoma sin re-disparar nada visible al
 * chofer, ver `identifier` fijo más abajo).
 */
async function programarNotificacionLlegada(
  db: SQLite.SQLiteDatabase,
  clave: string,
  puntoControlId: string,
  motivo: MotivoAnuncio,
  opciones: AnuncioPuntoControlOpciones,
  ubicacionPrecalculada?: { numero: number | undefined },
): Promise<boolean> {
  // VIBRACIÓN SIEMPRE (regla dura del plan, Entrega 7): el canal más robusto porque no depende
  // de audio. Va ANTES de cualquier intento de notificación y fuera de su `try/catch`, para que
  // un fallo de notificación nunca se lleve puesta la vibración.
  Vibration.vibrate(300);

  // El primer intento ya calculó la ubicación (`anunciarLlegadaPuntoControl`); el reintento no.
  const { numero } = ubicacionPrecalculada ?? (await ubicarEnOrdenEfectivo(puntoControlId, opciones));
  const identificador = numero !== undefined ? `Punto de control ${numero}` : 'Punto de control';

  try {
    await asegurarCanalNotificacion();
    await Notifications.scheduleNotificationAsync({
      // FIX POST-REVISIÓN (Codex `verify-fix`, punto 3, "identidad durable"): `identifier`
      // explícito = la MISMA clave que reclamó la intención (`{sesionId, puntoControlId,
      // pasada}`) — un reintento (`reintentarAnunciosLlegadaPendientes`) para la MISMA visita
      // REEMPLAZA la notificación pendiente en vez de apilar una segunda.
      identifier: clave,
      content: {
        title: `${identificador}: llegaste`,
        body: textoAnuncioLlegada(motivo),
        // Ver el docblock de `setNotificationHandler` (cabecera del módulo): esta notificación
        // SIEMPRE se marca así — el sonido custom de foreground (`confirmacion-sonido.ts`,
        // disparado por `gps-provider.tsx` sobre `gps.ultimoAnuncioLlegada`) es su capa de audio
        // en foreground; en headless este flag no importa (el canal nativo suena directo).
        data: { silenciarSonidoForeground: true },
      },
      // Ver el comentario largo (bug 3) que tenía esta misma línea antes del rediseño: el
      // `trigger` es el único lugar de este SDK donde una notificación inmediata puede elegir
      // canal (`ChannelAwareTriggerInput`) — sin esto cae al canal default, silencioso.
      trigger: { channelId: CANAL_ANUNCIO_ANDROID },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'notificacion-llegada' },
    });
    // Sin programar: la fila queda 'programando' (marcada antes de este intento, ver
    // `intentarProgramarNotificacion`) — el próximo tick de la cola la reintenta vía
    // `reintentarAnunciosLlegadaPendientes`, una vez que el intento quede viejo.
    return false;
  }

  try {
    await marcarAnuncioProgramado(db, clave);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'marcar-anuncio-programado' },
    });
    // No marcado: queda 'programando' pese a que SÍ se programó — un reintento futuro (una vez
    // vieja) reprograma con el MISMO `identifier`, así que reemplaza en vez de duplicar. La
    // vibración/notificación YA salieron — eso es lo que importa para el valor de retorno.
  }
  return true;
}

/**
 * FIX POST-REVISIÓN (hallazgo 1, code review — "'pendiente' mezcla reclamado-programando con
 * reclamado-falló"): marca la fila como `'programando'` (`marcarAnuncioProgramando`, `db/outbox.ts`)
 * INMEDIATAMENTE ANTES de intentar programar — best-effort: si esta marca falla, se intenta
 * programar igual (peor caso: una ventana un poco más larga en la que un reintento concurrente
 * podría competir, el mismo riesgo que ya existía sin este mecanismo — nunca se pierde el
 * anuncio por esto). Punto único que comparten el primer intento
 * (`anunciarLlegadaPuntoControl`) y el reintento (`reintentarAnunciosLlegadaPendientes`).
 */
async function intentarProgramarNotificacion(
  db: SQLite.SQLiteDatabase,
  clave: string,
  puntoControlId: string,
  motivo: MotivoAnuncio,
  opciones: AnuncioPuntoControlOpciones,
  ubicacionPrecalculada?: { numero: number | undefined },
): Promise<boolean> {
  try {
    await marcarAnuncioProgramando(db, clave);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'marcar-anuncio-programando' },
    });
  }
  return programarNotificacionLlegada(db, clave, puntoControlId, motivo, opciones, ubicacionPrecalculada);
}

/**
 * FIX POST-REVISIÓN (hallazgo 6, code review — "si el reclamo mismo falla, fail-open duplica bajo
 * contención cruzada"): reclamos que fallaron ANTES de llegar a persistir nada en
 * `anuncios_punto_control` — sin fila que `obtenerAnunciosPendientesDeProgramar` pueda ofrecer, la
 * única forma de reintentarlos es este mapa en memoria, drenado por
 * `reintentarAnunciosLlegadaPendientes` en el próximo turno de la cola. Vive a nivel de módulo,
 * igual criterio que `aproximacionesAnunciadas` — el proceso headless no tiene otro lugar donde
 * guardarlo, y perderlo si el proceso muere es aceptable (el próximo tick que decida esta MISMA
 * visita la vuelve a intentar desde cero vía `evaluarAnunciosDeFixes`/`evaluarAnuncioDeHeartbeat`
 * solo si esta visita todavía no quedó marcada `anuncioHecho`, que es exactamente el caso: la
 * decisión y la ejecución están desacopladas — ver el rediseño de `decidir-anuncio.ts`).
 */
interface ReclamoFallido {
  puntoControlId: string;
  pasada: number;
  motivo: MotivoAnuncio;
  opciones: AnuncioPuntoControlOpciones;
}
const reclamosFallidos = new Map<string, ReclamoFallido>();

/**
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23): ejecuta la decisión de anuncio de "llegaste" que YA tomó `decidirAnuncio`
 * (`decidir-anuncio.ts`) en el único punto de llamada dentro de `colaRegistroGps`
 * (`gps/headless-task.ts`) — este módulo NUNCA decide, solo reclama la intención de forma
 * durable (punto 3 del brief — `INSERT OR IGNORE` en estado `'pendiente'` ANTES de programar,
 * `reclamarIntencionAnuncio`, `db/outbox.ts`) y la ejecuta. `reclamado: false` significa que
 * otra llamada (otro tick, u otro proceso) ya está a cargo de esta identidad exacta
 * `{sesionId, puntoControlId, pasada}` — no hace falta hacer nada más.
 *
 * Devuelve `true` solo si ESTA llamada disparó de verdad la vibración/notificación — ver el
 * docblock de `programarNotificacionLlegada` (hallazgo 3).
 *
 * FIX POST-REVISIÓN (hallazgo 6): si el reclamo mismo falla (SQLite ocupada), ahora falla CERRADO
 * — antes se asumía `reclamado: true` (fail-open) y se programaba igual, arriesgando un duplicado
 * REAL bajo contención cruzada (headless y foreground reclamando la MISMA visita a la vez, cada
 * uno viendo su propio error transitorio). El reclamo se reintenta en el próximo tick, vía
 * `reclamosFallidos` (arriba) + `reintentarAnunciosLlegadaPendientes`.
 */
export async function anunciarLlegadaPuntoControl(
  db: SQLite.SQLiteDatabase,
  puntoControlId: string,
  pasada: number,
  motivo: MotivoAnuncio,
  opciones: AnuncioPuntoControlOpciones,
): Promise<boolean> {
  // PC de espera (Molinos) sin designación activa: no es parte de la ruta, ni vibra ni notifica ni
  // se reclama la intención (no quedaría nada pendiente que reintentar).
  const ubicacion = await ubicarEnOrdenEfectivo(puntoControlId, opciones);
  if (ubicacion.esperaSinDesignacion) return false;
  let reclamado = false;
  let clave = claveAnuncio(opciones.sesionId, puntoControlId, pasada);
  try {
    const resultado = await reclamarIntencionAnuncio(db, opciones.sesionId, puntoControlId, pasada, motivo);
    reclamado = resultado.reclamado;
    clave = resultado.clave;
    reclamosFallidos.delete(clave); // reclamó bien esta vez — cualquier reintento viejo sobra
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'reclamar-intencion-llegada' },
    });
    reclamosFallidos.set(clave, { puntoControlId, pasada, motivo, opciones });
    return false;
  }
  if (!reclamado) return false;

  return intentarProgramarNotificacion(db, clave, puntoControlId, motivo, opciones, ubicacion);
}

/**
 * Reintenta las intenciones pendientes de programar — llamada desde el único punto de llamada,
 * DENTRO de `conTimeout` (`gps/headless-task.ts`), en cada turno de la cola (mismo patrón que
 * `drenarReintentosVisitaPendiente`). Dos fuentes, en orden:
 * 1. `reclamosFallidos` (hallazgo 6): reclamos que fallaron ANTES de persistir nada — se
 *    reintenta el reclamo COMPLETO (`anunciarLlegadaPuntoControl`), filtrado a `sesionId` para no
 *    reintentar reclamos de una sesión que ya no es la activa.
 * 2. `obtenerAnunciosPendientesDeProgramar` (hallazgo 1/5): intenciones YA reclamadas
 *    (`'pendiente'`, o `'programando'` con un intento viejo) — no vuelve a reclamar nada acá, solo
 *    falta programar la notificación.
 */
export async function reintentarAnunciosLlegadaPendientes(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  puntosControl: PuntoControlPaquete[],
): Promise<void> {
  for (const [clave, reclamo] of Array.from(reclamosFallidos.entries())) {
    if (reclamo.opciones.sesionId !== sesionId) continue;
    reclamosFallidos.delete(clave);
    await anunciarLlegadaPuntoControl(db, reclamo.puntoControlId, reclamo.pasada, reclamo.motivo, reclamo.opciones);
  }

  let pendientes: Awaited<ReturnType<typeof obtenerAnunciosPendientesDeProgramar>> = [];
  try {
    pendientes = await obtenerAnunciosPendientesDeProgramar(db, sesionId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'listar-anuncios-pendientes' },
    });
    return;
  }
  for (const pendiente of pendientes) {
    // FIX POST-REVISIÓN (hallazgo 10, cleanup — "validar motivo antes de textoAnuncioLlegada"):
    // `pendiente.motivo` viene de una columna `TEXT` sin restricción (`outbox-ddl.ts`) — antes se
    // casteaba a ciegas. Una fila con un `motivo` irreconocible (legado, corrupción, o una
    // versión futura de la app con un motivo nuevo) se reporta y se salta en vez de programar una
    // notificación con un texto potencialmente `undefined` (`textoAnuncioLlegada` es un `switch`
    // exhaustivo sobre `MotivoAnuncio`, sin `default` — TypeScript no puede validar en runtime lo
    // que ya vino casteado).
    if (!esMotivoAnuncio(pendiente.motivo)) {
      Sentry.captureException(new Error(`motivo de anuncio irreconocible: ${pendiente.motivo}`), {
        tags: { contexto: 'anuncio-punto-control', paso: 'reintentar-motivo-invalido' },
        extra: { clave: pendiente.clave },
      });
      continue;
    }
    await intentarProgramarNotificacion(
      db,
      pendiente.clave,
      pendiente.puntoControlId,
      pendiente.motivo,
      { sesionId: pendiente.sesionId, puntosControl },
    );
  }
}

/**
 * Wrapper de conveniencia: ejecuta el aviso de aproximación (voz) y los anuncios de llegada
 * (`anunciosLlegada`, YA decididos por `decidirAnuncio` en el único punto de llamada) de UN tick
 * — llamado desde `tareaHeadlessUbicacion` (`gps/headless-task.ts`) y desde
 * `use-gps-operativo.ts` en foreground.
 */
export async function anunciarDeteccionesDelTick(
  db: SQLite.SQLiteDatabase,
  opciones: AnuncioPuntoControlOpciones,
  resultado: {
    deteccionAproximacion: DeteccionPuntoControl | null;
    /** REDISEÑO: decisiones YA tomadas (`AnuncioDecidido[]`, `decidir-anuncio.ts`) — este
     * módulo solo las ejecuta, nunca vuelve a evaluar `distanciaM`/tiempo/salida. */
    anunciosLlegada?: { puntoControlId: string; pasada: number; motivo: MotivoAnuncio }[];
    /** FIX POST-REVISIÓN (G1): puntos cuya histéresis PROPIA de voz re-armó de verdad en este
     * tick — ver `puntosRearmadosVoz` en `gps/geofence.ts` y el comentario largo de
     * `limpiarAproximacionesAnunciadas` arriba. */
    puntosRearmadosVoz?: string[];
  },
): Promise<void> {
  if (resultado.puntosRearmadosVoz && resultado.puntosRearmadosVoz.length > 0) {
    limpiarAproximacionesAnunciadas(resultado.puntosRearmadosVoz);
  }
  if (resultado.deteccionAproximacion) {
    await anunciarPuntoControl(db, resultado.deteccionAproximacion, opciones);
  }
  for (const anuncio of resultado.anunciosLlegada ?? []) {
    await anunciarLlegadaPuntoControl(
      db,
      anuncio.puntoControlId,
      anuncio.pasada,
      anuncio.motivo,
      opciones,
    );
  }
}
