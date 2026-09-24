import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import type { PuntoControlPaquete } from '@quivo/shared';
import type { DeteccionPuntoControl } from '../../gps/geofence';
import { anuncioYaRegistrado, registrarAnuncioSiNuevo } from '../../db/outbox';
import { formatearDistanciaVoz } from './format-distancia';

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
 * TTS"): la fase `'confirmado'` (evidencia) ya tiene su PROPIO sonido dedicado en foreground
 * (`confirmacion-sonido.ts`, disparado desde `gps-provider.tsx`, con `duckOthers`) — sumarle el
 * sonido del CANAL de esta notificación sería un doble sonido para el mismo paso. Esa fase
 * marca su notificación con `data.silenciarSonidoForeground: true` (ver más abajo) para que
 * este handler NO reproduzca el sonido del canal (el banner SÍ se muestra igual, es solo el
 * audio lo que se evita duplicar). Las demás fases (`'confirmado-proximidad'`, sin sonido
 * dedicado propio en foreground) sí suenan a través de este handler — es el ÚNICO audio que
 * tienen. La voz de aproximación (`Speech.speak`) no pasa por notificaciones y no se ve
 * afectada por este handler.
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
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 2, "identidad durable del anuncio"): clave de
 * dedupe PERSISTIDO del anuncio de PROXIMIDAD (`fase: 'confirmado-proximidad'`) — misma tabla
 * (`anuncios_punto_control`) que `claveAnuncio` de arriba, con un prefijo (`proximidad:`) para
 * no colisionar con la clave de EVIDENCIA de la MISMA pasada (son dos anuncios distintos, con
 * textos distintos, que pueden o no coincidir en el tiempo). `pasada` es la de la visita EN
 * CURSO (confirmada o no todavía por la evidencia — ver `filtrarNuevosCumplimientos`), la MISMA
 * que llena `deteccion.pasada` tanto para el disparo INMEDIATO (`<= RADIO_CONFIRMACION_M`) como
 * para el FALLBACK (timeout o salida del radio) — por eso una fila en esta tabla, sin importar
 * cuál de los dos caminos la insertó primero, bloquea al otro para la MISMA visita. A
 * diferencia del Set en memoria que reemplaza (indexado solo por `puntoControlId`, sin sesión
 * ni pasada), esta clave sobrevive reciclar el proceso headless y no confunde dos pasadas
 * distintas del mismo punto (multi-vuelta) ni dos sesiones distintas sobre la misma ruta.
 */
function claveAnuncioProximidad(sesionId: string, puntoControlId: string, pasada: number): string {
  return `proximidad:${sesionId}:${puntoControlId}:${pasada}`;
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

/**
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 2, "identidad durable del anuncio"): el dedupe
 * del anuncio de proximidad (`fase: 'confirmado-proximidad'`) YA NO vive en un Set en memoria
 * indexado por `puntoControlId` — ese Set permitía re-anunciar "llegaste" tras reciclar el
 * proceso headless (Android puede matar y relanzar el contexto JS headless a mitad de turno) y,
 * al no llevar `sesionId`/`pasada`, no distinguía dos pasadas del mismo punto (multi-vuelta) ni
 * dos sesiones sobre la misma ruta recurrente. Ahora es una fila PERSISTIDA en SQLite
 * (`anuncios_punto_control`, misma tabla que la EVIDENCIA — ver `claveAnuncioProximidad` y
 * `registrarAnuncioSiNuevo`/`anuncioYaRegistrado` en `db/outbox.ts`), compartida entre el
 * disparo INMEDIATO y el FALLBACK (los dos escriben/consultan la MISMA clave por visita) — no
 * hace falta ninguna función de "limpieza": una pasada NUEVA produce una clave NUEVA por
 * construcción (`claveAnuncioProximidad` incluye `pasada`), así que no hay nada que liberar al
 * re-armar. La rama `'confirmado'` de abajo consulta esta MISMA tabla (sin insertar) para no
 * repetir vibración/notificación si la proximidad ya avisó "llegaste" para la MISMA visita.
 */

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

  if (deteccion.fase === 'confirmado-proximidad') {
    // FIX POST-REVISIÓN (Codex `verify-fix`, punto 2): sin `pasada` no hay identidad durable
    // que consultar/marcar — no debería ocurrir (la máquina de estados, `geofence.ts`, siempre
    // la completa para esta fase), pero es preferible saltar en silencio a marcar una clave sin
    // sentido (`proximidad:sesion:punto:undefined`).
    if (deteccion.pasada === undefined) return;
    const clave = claveAnuncioProximidad(opciones.sesionId, deteccion.puntoControlId, deteccion.pasada);
    // Fail-open (arranca en `false`, "no registrado"): mismo criterio que el resto del módulo —
    // si la consulta persistida falla, mejor arriesgar un anuncio de más que perder el único
    // que importa.
    let yaAnunciado = false;
    try {
      yaAnunciado = await anuncioYaRegistrado(db, clave);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'anuncio-punto-control', paso: 'dedupe-proximidad-consulta' },
      });
    }
    if (yaAnunciado) return;

    // Mismo piso universal que la confirmación de evidencia (vibración SIEMPRE, antes que
    // cualquier intento de notificación/audio y fuera de su `try/catch` — ver el comentario de
    // la rama `'confirmado'` de abajo).
    Vibration.vibrate(300);

    try {
      await asegurarCanalNotificacion();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${identificador}: llegaste`,
          body: 'Estás a menos de 40 metros del punto de control.',
        },
        trigger: { channelId: CANAL_ANUNCIO_ANDROID },
      });
      // FIX POST-REVISIÓN (Codex `verify-fix`, punto 3, "marcar después de programar"): la
      // marca persistida se escribe SOLO acá, con la notificación ya programada con éxito — si
      // esto falla (SQLite ocupada), la visita queda SIN marcar y el próximo trigger (otro fix
      // dentro del radio, o el fallback) puede reintentar el anuncio completo.
      try {
        await registrarAnuncioSiNuevo(db, clave);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { contexto: 'anuncio-punto-control', paso: 'dedupe-proximidad-marcar' },
        });
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'anuncio-punto-control', paso: 'notificacion-proximidad' },
      });
      // Sin marcar (ver arriba): un fallo de programación no debe dejar esta visita como
      // "ya anunciada" para siempre.
    }
    return;
  }

  if (deteccion.fase !== 'confirmado' || deteccion.pasada === undefined) return;

  // FIX POST-REVISIÓN (bug 4): el ciclo de aproximación YA NO se reabre acá — ver el comentario
  // largo de `aproximacionesAnunciadas`. Reabrirlo recién cuando el geofence re-arma de verdad
  // (`limpiarAproximacionesAnunciadas`, llamada desde `headless-task.ts`/`use-gps-operativo.ts`
  // con `puntosRearmadosVoz`).

  // DECISIÓN CTO 2026-09-23 (adaptada al punto 2 — dedupe ahora PERSISTIDO, no en memoria): si
  // la proximidad YA avisó "llegaste" para esta MISMA visita (misma `pasada`), la confirmación
  // de EVIDENCIA (que puede llegar fixes después, recién en el mínimo local) no repite
  // vibración/notificación para el MISMO paso. Solo CONSULTA (`anuncioYaRegistrado`), nunca
  // marca esta clave — marcarla acá sería mentir ("la proximidad avisó") cuando en realidad fue
  // la evidencia. Si la proximidad NUNCA disparó (el mínimo de la visita no llegó a
  // `RADIO_CONFIRMACION_M`), esta rama sigue anunciando como siempre: "el punto no puede quedar
  // sin confirmar".
  const claveProximidadDeEstaPasada = claveAnuncioProximidad(
    opciones.sesionId,
    deteccion.puntoControlId,
    deteccion.pasada,
  );
  try {
    if (await anuncioYaRegistrado(db, claveProximidadDeEstaPasada)) return;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'dedupe-proximidad-consulta-cruzada' },
    });
    // Fail-open: si la consulta cruzada falla, se sigue de largo y se anuncia como si la
    // proximidad nunca hubiera disparado — un doble aviso es preferible a ninguno.
  }

  const clave = claveAnuncio(opciones.sesionId, deteccion.puntoControlId, deteccion.pasada);
  // Fail-open (`yaAnunciado` arranca en `false`): si la consulta persistida falla (SQLite
  // ocupada, handle zombi que `conReintentoSiHandleMuerto` no logró sanar), es preferible
  // arriesgar un anuncio DE MÁS que perder el único que importa — un chofer que pasa por un
  // punto y nunca lo siente es la falla que esta entrega existe para cerrar; un doble aviso es
  // un detalle.
  let yaAnunciado = false;
  try {
    yaAnunciado = await anuncioYaRegistrado(db, clave);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'anuncio-punto-control', paso: 'dedupe-confirmacion-consulta' },
    });
  }
  if (yaAnunciado) return;

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
        // FIX POST-REVISIÓN (punto 4): esta fase ya tiene su propio sonido en foreground
        // (`confirmacion-sonido.ts`, `gps-provider.tsx`) — el `handleNotification` de cabecera
        // de este módulo lee este flag para NO sumarle el sonido del canal (el banner sí se
        // muestra igual). En background/headless este flag no importa: Android presenta la
        // notificación directo desde el canal nativo, sin pasar por este handler.
        data: { silenciarSonidoForeground: true },
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
    // FIX POST-REVISIÓN (Codex `verify-fix`, punto 3): marcar SOLO tras programar con éxito —
    // ver el comentario largo en la rama `'confirmado-proximidad'` de arriba.
    try {
      await registrarAnuncioSiNuevo(db, clave);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'anuncio-punto-control', paso: 'dedupe-confirmacion-marcar' },
      });
    }
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
    /**
     * DECISIÓN CTO 2026-09-23 (`RADIO_CONFIRMACION_M`): punto más cercano dentro de
     * `RADIO_CONFIRMACION_M` con una visita activa sin confirmar — ver
     * `deteccionConfirmacionProximidad` en `gps/location-task.ts`. Opcional/`null`: el camino
     * de confirmación forzada por antigüedad (`confirmarVisitasVencidas`, heartbeat) no lo
     * calcula (no hay fix nuevo del que leer una distancia en tiempo real).
     */
    deteccionConfirmacionProximidad?: DeteccionPuntoControl | null;
    /** FIX POST-REVISIÓN (G1): puntos cuya histéresis PROPIA de voz re-armó de verdad en este
     * tick — ver `puntosRearmadosVoz` en `gps/geofence.ts` y el comentario largo de
     * `limpiarAproximacionesAnunciadas` arriba. Deliberadamente NO es la histéresis de
     * detección (`puntosRearmados` en `geofence.ts`) — usar esa era justo el bug que G1 cierra.
     * Opcional/vacío por default: el camino de confirmación forzada por antigüedad
     * (`confirmarVisitasVencidas`, heartbeat) nunca re-arma ninguna histéresis por sí solo. */
    puntosRearmadosVoz?: string[];
    /**
     * FIX POST-REVISIÓN (Codex `verify-fix`, punto 2): ya NO se usa para liberar ningún dedupe
     * acá — el dedupe de proximidad es PERSISTIDO y está scopeado por `pasada`
     * (`claveAnuncioProximidad`), así que una pasada nueva ya produce una clave nueva por
     * construcción, sin necesitar ninguna "limpieza" atada al re-armado de la histéresis de
     * DETECCIÓN. Se conserva el campo en la firma (opcional) por compatibilidad con los
     * callers existentes (`headless-task.ts`, `use-gps-operativo.ts`), que lo siguen calculando
     * para telemetría/depuración — ver `puntosRearmados` en `gps/geofence.ts`.
     */
    puntosRearmados?: string[];
  },
): Promise<void> {
  if (resultado.puntosRearmadosVoz && resultado.puntosRearmadosVoz.length > 0) {
    // Antes de anunciar la aproximación de este MISMO tick: si la voz de un punto re-armó y, en
    // el mismo tick, ya está de nuevo dentro de `RADIO_AVISO_M` (rebote poco común pero
    // posible), tiene que poder volver a avisar sin esperar al tick siguiente.
    limpiarAproximacionesAnunciadas(resultado.puntosRearmadosVoz);
  }
  if (resultado.deteccionAproximacion) {
    await anunciarPuntoControl(db, resultado.deteccionAproximacion, opciones);
  }
  // DECISIÓN CTO 2026-09-23: el anuncio de proximidad va ANTES que la confirmación de
  // evidencia — si las dos coincidieran en el MISMO tick (caso borde), la proximidad marca el
  // dedupe primero y la evidencia lo ve y no repite vibración/notificación (ver el comentario
  // largo de `confirmacionesProximidadAnunciadas`).
  if (resultado.deteccionConfirmacionProximidad) {
    await anunciarPuntoControl(db, resultado.deteccionConfirmacionProximidad, opciones);
  }
  if (resultado.deteccion) {
    await anunciarPuntoControl(db, resultado.deteccion, opciones);
  }
}
