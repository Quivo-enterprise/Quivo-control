import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import type { PuntoControlPaquete } from '@quivo/shared';
import type { DeteccionPuntoControl } from '../../gps/geofence';
import { registrarAnuncioSiNuevo } from '../../db/outbox';
import { formatearDistanciaVoz } from './format-distancia';

/**
 * ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless" — probablemente el arreglo
 * más importante del plan): `gps-provider.tsx` es un componente React — si el árbol no está
 * montado (pantalla apagada, que es la condición NORMAL de un chofer manejando) no hay voz, ni
 * sonido, ni toast. El reporte de Rosa ("marcó el punto... sin sonido") es exactamente esto:
 * el anuncio hoy funciona solo en la condición que casi nunca ocurre.
 *
 * Este módulo es DELIBERADAMENTE sin React (sin `import ... from 'react'`, sin hooks): lo llama
 * tanto `tareaHeadlessUbicacion` (`gps/headless-task.ts`, sin árbol de componentes, mismo
 * motivo por el que `location-task.ts` es puro — ver su docblock) como el `useEffect` de
 * `gps-provider.tsx` en foreground, como WRAPPER DELGADO sobre las mismas dos funciones de
 * abajo. Un solo camino de anuncio para los dos contextos: el chofer escucha/siente lo mismo
 * esté la app en primer plano o no.
 *
 * Reparto de canales por `fase` (`DeteccionPuntoControl.fase`, `gps/geofence.ts`, `location-task.ts`):
 * - `'aproximacion'`: SOLO voz informativa (distancia). Nunca vibra, nunca notifica — es un
 *   aviso de que el punto se acerca, no evidencia de que se pasó.
 * - `'confirmado'`: vibración SIEMPRE + notificación local con sonido. NUNCA voz acá —
 *   `gps-provider.tsx` sigue teniendo, además, su propio sonido custom más prolijo
 *   (`confirmacion-sonido.ts`, foreground-only, con `duckOthers`) como capa extra; este módulo
 *   solo garantiza el piso universal (headless incluido).
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

/** Clave de dedupe PERSISTIDO (`registrarAnuncioSiNuevo`, `db/outbox.ts`) — misma tripleta que
 * identifica una pasada evidenciada en `filtrarNuevosCumplimientos` (`gps/geofence.ts`). */
function claveAnuncio(sesionId: string, puntoControlId: string, pasada: number): string {
  return `${sesionId}:${puntoControlId}:${pasada}`;
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
 * `limpiarAproximacionesAnunciadas` (abajo), llamada SOLO cuando el geofence RE-ARMA de verdad
 * el punto (`puntosRearmados`, `gps/geofence.ts` — misma histéresis que la detección:
 * `FACTOR_REARME_RADIO` × `FIXES_REARME_CONSECUTIVOS`), NUNCA al confirmar. Antes se borraba
 * acá mismo dentro de `anunciarPuntoControl` en cuanto el punto CONFIRMABA — con el vehículo
 * todavía a bastante menos de `RADIO_AVISO_M` (la confirmación ocurre en el mínimo local, muy
 * cerca del punto), el próximo fix mientras sigue alejándose (todavía dentro de
 * `RADIO_AVISO_M`, que es mucho más ancho) volvía a pasar por `fase: 'aproximacion'` con la
 * entrada YA libre → segunda voz anunciando la "aproximación" de un punto del que se está
 * alejando. Y esa segunda voz dejaba la entrada "usada" de nuevo, así que la aproximación REAL
 * de la vuelta siguiente no volvía a sonar. Limpiar recién en el re-armado real evita las dos
 * mitades del bug a la vez, con la misma histéresis que ya protege la evidencia.
 */
const aproximacionesAnunciadas = new Set<string>();

/**
 * FIX POST-REVISIÓN (bug 4): libera el dedupe de aproximación para los puntos que el geofence
 * ACABA de re-armar en este tick/heartbeat — ver el comentario largo de `aproximacionesAnunciadas`
 * arriba y el de `puntosRearmados` en `gps/geofence.ts`. Llamarla con una lista vacía (el caso
 * normal, ningún punto re-armó) es un no-op.
 */
export function limpiarAproximacionesAnunciadas(puntosControlIds: readonly string[]): void {
  for (const id of puntosControlIds) aproximacionesAnunciadas.delete(id);
}

export interface AnuncioPuntoControlOpciones {
  sesionId: string;
  puntosControl: PuntoControlPaquete[];
}

/**
 * Anuncia UNA detección — `fase: 'aproximacion'` (solo voz) o `fase: 'confirmado'` (vibración +
 * notificación con sonido, con dedupe persistido). NUNCA rechaza: todo intento de I/O real
 * (voz, notificación, dedupe en SQLite) va en su propio `try/catch` con `Sentry.captureException`
 * — un anuncio fallido es un detalle (regla del plan: perder el sonido no es perder evidencia),
 * pero antes de esta entrega esos fallos eran invisibles (`confirmacion-sonido.ts` los tragaba
 * con `console.error` a secas). El caller (`anunciarDeteccionesDelTick`, headless-task.ts,
 * gps-provider.tsx) puede invocarla sin su propio `try/catch` por esta garantía.
 */
export async function anunciarPuntoControl(
  db: SQLite.SQLiteDatabase,
  deteccion: DeteccionPuntoControl,
  opciones: AnuncioPuntoControlOpciones,
): Promise<void> {
  const orden = ordenDe(deteccion.puntoControlId, opciones.puntosControl);
  const identificador = orden !== undefined ? `Punto de control ${orden}` : 'Punto de control';

  if (deteccion.fase === 'aproximacion') {
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
    return;
  }

  if (deteccion.fase !== 'confirmado' || deteccion.pasada === undefined) return;

  // FIX POST-REVISIÓN (bug 4): el ciclo de aproximación YA NO se reabre acá — ver el comentario
  // largo de `aproximacionesAnunciadas`. Reabrirlo recién cuando el geofence re-arma de verdad
  // (`limpiarAproximacionesAnunciadas`, llamada desde `headless-task.ts`/`use-gps-operativo.ts`
  // con `puntosRearmados`).

  const clave = claveAnuncio(opciones.sesionId, deteccion.puntoControlId, deteccion.pasada);
  // Fail-open (`esNuevo` arranca en `true`): si el dedupe persistido falla (SQLite ocupada,
  // handle zombi que `conReintentoSiHandleMuerto` no logró sanar), es preferible arriesgar un
  // anuncio DE MÁS que perder el único que importa — un chofer que pasa por un punto y nunca lo
  // siente es la falla que esta entrega existe para cerrar; un doble aviso es un detalle.
  let esNuevo = true;
  try {
    esNuevo = await registrarAnuncioSiNuevo(db, clave);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'dedupe-confirmacion' },
    });
  }
  if (!esNuevo) return;

  // VIBRACIÓN SIEMPRE (regla dura del plan, Entrega 7): el canal más robusto porque no depende
  // de audio — ni de que el volumen del stream de media esté arriba de 0 (ver el aviso de
  // `duckOthers` en `confirmacion-sonido.ts`, que NO ayuda si ese volumen está en 0). Va ANTES
  // de cualquier intento de notificación/audio y fuera de su `try/catch`, para que un fallo de
  // notificación nunca se lleve puesta la vibración.
  Vibration.vibrate(300);

  try {
    await asegurarCanalNotificacion();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${identificador} registrado`,
        body: 'Quedó confirmado en tu recorrido.',
      },
      // FIX POST-REVISIÓN (bug 3, "cae en el canal por defecto — sin heads-up ni chime"):
      // `trigger: null` entrega inmediato pero SIN canal — Android 8+/O+ ignora `content.sound`
      // de una notificación individual (el sonido/importancia los define el CANAL), y
      // `expo-notifications@0.32.17` NO expone `channelId` dentro de `content` (confirmado
      // contra `NotificationContentInput`, `build/Notifications.types.d.ts`): el único lugar
      // donde este SDK deja elegir el canal de una notificación inmediata es el propio
      // `trigger`, vía `ChannelAwareTriggerInput` (`{ channelId: string }`,
      // `NotificationTriggerInput = null | ChannelAwareTriggerInput | ...`). Con `trigger: null`
      // el sistema enruta al canal DEFAULT (creado con `importance` genérica) — silencioso y sin
      // heads-up, aunque `asegurarCanalNotificacion()` de arriba haya creado el canal
      // `CANAL_ANUNCIO_ANDROID` con `importance: HIGH` y el timbre propio: ese canal nunca se
      // referenciaba desde ningún lado.
      trigger: { channelId: CANAL_ANUNCIO_ANDROID },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'notificacion-confirmacion' },
    });
  }
}

/**
 * Wrapper de conveniencia: anuncia las (hasta) dos detecciones de UN tick de
 * `construirEventosDeUbicacion` (`gps/location-task.ts`) — la de aproximación y la confirmada,
 * si las hay. Llamado desde `tareaHeadlessUbicacion` (`gps/headless-task.ts`) y desde el
 * `useEffect` de `gps-provider.tsx`, como wrapper delgado en los dos casos (ver el docblock de
 * cabecera del módulo).
 */
export async function anunciarDeteccionesDelTick(
  db: SQLite.SQLiteDatabase,
  opciones: AnuncioPuntoControlOpciones,
  resultado: {
    deteccion: DeteccionPuntoControl | null;
    deteccionAproximacion: DeteccionPuntoControl | null;
    /** FIX POST-REVISIÓN (bug 4): puntos re-armados en este tick — ver
     * `limpiarAproximacionesAnunciadas` arriba. Opcional/vacío por default: el camino de
     * confirmación forzada por antigüedad (`confirmarVisitasVencidas`, heartbeat) nunca re-arma
     * por sí solo. */
    puntosRearmados?: string[];
  },
): Promise<void> {
  if (resultado.puntosRearmados && resultado.puntosRearmados.length > 0) {
    // Antes de anunciar la aproximación de este MISMO tick: si un punto re-armó y, en el mismo
    // tick, ya está de nuevo dentro de `RADIO_AVISO_M` (rebote poco común pero posible), tiene
    // que poder volver a avisar sin esperar al tick siguiente.
    limpiarAproximacionesAnunciadas(resultado.puntosRearmados);
  }
  if (resultado.deteccionAproximacion) {
    await anunciarPuntoControl(db, resultado.deteccionAproximacion, opciones);
  }
  if (resultado.deteccion) {
    await anunciarPuntoControl(db, resultado.deteccion, opciones);
  }
}
