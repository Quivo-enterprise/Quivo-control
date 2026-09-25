import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import { RADIO_CONFIRMACION_M, type PuntoControlPaquete } from '@quivo/shared';
import type { DeteccionPuntoControl } from '../../gps/geofence';
import {
  marcarAnuncioProgramado,
  obtenerAnunciosPendientesDeProgramar,
  reclamarIntencionAnuncio,
} from '../../db/outbox';
import { formatearDistanciaVoz } from './format-distancia';
import type { MotivoAnuncio } from './decidir-anuncio';

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
 * ID VERSIONADO a propósito (sufijo `-v1`): el día que este timbre cambie (otro `.wav`, otro
 * `vibrationPattern`), el fix NO es editar esta constante — los teléfonos que YA crearon el
 * canal `-v1` van a seguir sonando con el timbre viejo para siempre (Android ignora el update).
 * El fix es subir a `-v2` acá (deja `-v1` comentado abajo como registro histórico) y actualizar
 * `assets/sounds/<archivo-nuevo>.wav` + `app.config.ts` en el mismo cambio.
 */
const CANAL_ANUNCIO_ANDROID = 'quivo-anuncio-punto-control-v1';

/**
 * Nombre del recurso de sonido tal como lo registra el plugin `expo-notifications` en
 * `app.config.ts` (`sounds: ['./assets/sounds/confirmacion_chime_notificacion.wav']`) — copia
 * DEDICADA del mismo timbre que usa `confirmacion-sonido.ts` (`assets/sounds/
 * confirmacion-chime.wav`), con nombre distinto A PROPÓSITO: los recursos `raw` de Android solo
 * aceptan `[a-z0-9_.]` en el nombre de archivo — un guion (el que tiene el original) rompe el
 * build nativo (`aapt2`) en cuanto el plugin lo copie a `res/raw/`. NO VERIFICADO en dispositivo
 * real en esta sesión (sin acceso a un teléfono) — confirmar que el canal efectivamente suena
 * con este timbre (y no el default del sistema) es parte del preflight de la Entrega 26.
 */
const SONIDO_NOTIFICACION_ANDROID = 'confirmacion_chime_notificacion.wav';

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

/** `orden` humano (1-indexado, mismo criterio que `next-control-sheet.tsx` y el
 * `gps-provider.tsx` anterior a esta entrega) del punto de control, buscado en el paquete del
 * día — así la voz dice "Punto de control 16" en vez de un id UUID o un genérico "alcanzado". */
function ordenDe(puntoControlId: string, puntosControl: PuntoControlPaquete[]): number | undefined {
  const pc = puntosControl.find((p) => p.id === puntoControlId);
  return pc ? pc.orden + 1 : undefined;
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
  for (const id of puntosControlIds) aproximacionesAnunciadas.delete(id);
}

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

  const orden = ordenDe(deteccion.puntoControlId, opciones.puntosControl);
  const identificador = orden !== undefined ? `Punto de control ${orden}` : 'Punto de control';

  if (aproximacionesAnunciadas.has(deteccion.puntoControlId)) return;
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
 * Programa la notificación de "llegaste" (best-effort) y, si sale bien, marca la intención
 * (`marcarAnuncioProgramado`) como `'programado'`. Compartida por `anunciarLlegadaPuntoControl`
 * (primer intento, tras reclamar la intención) y `reintentarAnunciosLlegadaPendientes` (reintento
 * de una intención YA reclamada) — ninguna de las dos vuelve a reclamar acá.
 */
async function programarNotificacionLlegada(
  db: SQLite.SQLiteDatabase,
  clave: string,
  puntoControlId: string,
  motivo: MotivoAnuncio,
  opciones: AnuncioPuntoControlOpciones,
): Promise<void> {
  const orden = ordenDe(puntoControlId, opciones.puntosControl);
  const identificador = orden !== undefined ? `Punto de control ${orden}` : 'Punto de control';

  // VIBRACIÓN SIEMPRE (regla dura del plan, Entrega 7): el canal más robusto porque no depende
  // de audio. Va ANTES de cualquier intento de notificación y fuera de su `try/catch`, para que
  // un fallo de notificación nunca se lleve puesta la vibración.
  Vibration.vibrate(300);

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
    try {
      await marcarAnuncioProgramado(db, clave);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'anuncio-punto-control', paso: 'marcar-anuncio-programado' },
      });
      // No marcado: queda 'pendiente' pese a que SÍ se programó — un reintento futuro
      // reprograma con el MISMO `identifier`, así que reemplaza en vez de duplicar. Peor caso:
      // una vibración de más, nunca una notificación duplicada visible.
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'notificacion-llegada' },
    });
    // Sin programar: la fila queda 'pendiente' (reclamada en `anunciarLlegadaPuntoControl`) —
    // el próximo tick de la cola la reintenta vía `reintentarAnunciosLlegadaPendientes`.
  }
}

/**
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23): ejecuta la decisión de anuncio de "llegaste" que YA tomó `decidirAnuncio`
 * (`decidir-anuncio.ts`) en el único punto de llamada dentro de `colaRegistroGps`
 * (`gps/headless-task.ts`) — este módulo NUNCA decide, solo reclama la intención de forma
 * durable (punto 3 del brief — `INSERT OR IGNORE` en estado `'pendiente'` ANTES de programar,
 * `reclamarIntencionAnuncio`, `db/outbox.ts`) y la ejecuta. `reclamado: false` significa que
 * otra llamada (otro tick, u otro proceso) ya está a cargo de esta identidad exacta
 * `{sesionId, puntoControlId, pasada}` — no hace falta hacer nada más.
 */
export async function anunciarLlegadaPuntoControl(
  db: SQLite.SQLiteDatabase,
  puntoControlId: string,
  pasada: number,
  motivo: MotivoAnuncio,
  opciones: AnuncioPuntoControlOpciones,
): Promise<void> {
  let reclamado = false;
  let clave = `${opciones.sesionId}:${puntoControlId}:${pasada}`;
  try {
    const resultado = await reclamarIntencionAnuncio(db, opciones.sesionId, puntoControlId, pasada, motivo);
    reclamado = resultado.reclamado;
    clave = resultado.clave;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'reclamar-intencion-llegada' },
    });
    // Fail-open: si la reclamación misma falla (SQLite ocupada), preferimos arriesgar un
    // duplicado (best-effort, mismo criterio que el resto del módulo) a perder el único aviso
    // que importa — se sigue como si se hubiera reclamado.
    reclamado = true;
  }
  if (!reclamado) return;

  await programarNotificacionLlegada(db, clave, puntoControlId, motivo, opciones);
}

/**
 * Reintenta las intenciones que quedaron `'pendiente'` (reclamadas, nunca programadas con
 * éxito) — llamada desde el único punto de llamada, DENTRO de `conTimeout`
 * (`gps/headless-task.ts`), antes de procesar el siguiente fix/heartbeat (mismo patrón que
 * `drenarReintentosVisitaPendiente`). No vuelve a reclamar nada — la intención YA es de esta
 * corrida, solo falta programar la notificación.
 */
export async function reintentarAnunciosLlegadaPendientes(
  db: SQLite.SQLiteDatabase,
  puntosControl: PuntoControlPaquete[],
): Promise<void> {
  let pendientes: Awaited<ReturnType<typeof obtenerAnunciosPendientesDeProgramar>> = [];
  try {
    pendientes = await obtenerAnunciosPendientesDeProgramar(db);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'listar-anuncios-pendientes' },
    });
    return;
  }
  for (const pendiente of pendientes) {
    await programarNotificacionLlegada(
      db,
      pendiente.clave,
      pendiente.puntoControlId,
      pendiente.motivo as MotivoAnuncio,
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
