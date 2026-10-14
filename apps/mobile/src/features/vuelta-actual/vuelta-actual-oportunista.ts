import * as Sentry from '@sentry/react-native';
import {
  borrarEstadoVueltaLocal,
  borrarEstadosVueltaLocalDeOtrasSesiones,
  guardarEstadoVueltaLocal,
  leerEstadoVueltaLocal,
} from '../../db/vuelta-actual-local';
import { leerRecorridoActual } from '../../db/recorrido-actual';
import type { VueltaActualMovil } from '@quivo/shared';
import { vueltaActualApi } from '../../shared/api/vuelta-actual-api';
import { cargarSesionMovil } from '../../shared/security/sesion-movil-store';
import { anunciarAvisoEnCanal, descartarNotificacionAviso } from '../operacion/anuncio-punto-control';
import {
  TEXTO_AVISO_CANCELADA,
  abandonarAcuse,
  acusePendiente,
  aplicarRespuesta,
  cerrarCancelacion,
  cerrarDesignacion,
  claveDesignacion,
  esErrorAcusePermanente,
  idNotificacionDesignacion,
  marcarAnunciada,
  notificacionesObsoletas,
  reiniciarEstadoRecorrido,
  resolverEstadoParaRecorrido,
  ESTADO_LOCAL_INICIAL,
  textoAvisoDesignada,
  type AvisoVuelta,
  type EstadoLocalVuelta,
} from './vuelta-actual-core';

/**
 * Consulta OPORTUNISTA de la vuelta actual (mismo patrón que `operacion/drenaje-oportunista.ts`):
 * la llama el hook en primer plano cada ~20 s Y los eventos de ubicación (foreground y headless),
 * con un piso de 20 s entre intentos — así el aviso de designación llega con la app en segundo
 * plano mientras el JS viva. Sin React: en headless no hay árbol montado.
 *
 * El servidor es la verdad de la vuelta y la designación: el cliente no deduce cierres de vuelta,
 * solo refleja lo último que dijo el servidor, atado al RECORRIDO ACTUAL (`leerRecorridoActual`,
 * el registro `recorrido_actual` de la SQLite del paquete: igual en foreground y headless; lo
 * borra `detener()` antes de apagar el tracking). Un error de lectura (`ok:false`) no es "sin
 * recorrido": se conserva el cache y no se consulta en ese tick. Cada consulta/acuse captura el
 * `recorridoId` al empezar y descarta su respuesta si el recorrido activo ya es otro (o ya no hay).
 *
 * Limitaciones aceptadas: (a) la cuenta regresiva de la espera usa `Date.now()` con margen de 1 min:
 * un reloj del teléfono desfasado más de 1 min puede adelantar el "Ya podés salir"; (b) una
 * designación que llega después de pasar un PC posterior al retorno marca Molinos como omitido (en
 * la L16 no hay PCs entre Honduras/Molinos y SR); (c) llegar a Molinos segundos antes de que la
 * designación llegue al cache no se notifica (el paso igual se registra); (d) sin red, la designación
 * de una vuelta que ya cerró puede seguir mostrándose hasta la próxima respuesta del servidor (se
 * marca "sin actualizar"): se prefiere eso a perder un aviso vigente.
 *
 * Contrato: NUNCA rechaza y NUNCA le muestra un error al chofer. Un fallo de red conserva el
 * último estado (cache en SQLite) y el siguiente evento reintenta. El piso se mide con
 * `Date.now()`, no con timers (RN congela los timers JS en background).
 */

export const PISO_ENTRE_CONSULTAS_MS = 20_000;
/** Los eventos de ubicación/heartbeat llegan con jitter: el piso tolera 1 s para que una consulta
 * a 19,x s del intento anterior no se salte un tick entero (cadencia de 40 s en vez de 20 s). */
export const TOLERANCIA_PISO_MS = 1_000;
/** Una consulta en vuelo más vieja que esto se da por colgada (red sin timeout, promesa perdida) y
 * deja pasar una nueva; la respuesta de la vieja, si llega, se descarta. */
export const VENCIMIENTO_EN_VUELO_MS = 60_000;

let ultimoIntentoMs = 0;
let enVuelo = false;
let enVueloDesdeMs = 0;
/** Identifica la consulta vigente: una consulta vencida que termina tarde no pisa a la nueva. */
let secuenciaConsulta = 0;
/** Se pidió un refresco mientras había una consulta en vuelo: corre apenas ésta termine. */
let refetchPendiente = false;
let obtenerTokenReciente: (() => Promise<string | null>) | null = null;

type Oyente = (sesionId: string, estado: EstadoLocalVuelta) => void;
const oyentes = new Set<Oyente>();

/** Suscripción en-proceso a los cambios de estado que este contexto JS escribe. */
export function suscribirEstadoVuelta(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Cola en-proceso: serializa leer-modificar-escribir del estado local para que una consulta y
 * un "Entendido" simultáneos no se pisen (entre contextos JS distintos la ventana es mínima y el
 * peor caso es repetir un aviso o volver a tocar "Entendido"). */
let cola: Promise<unknown> = Promise.resolve();
function serializar<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(tarea, tarea);
  cola = siguiente.catch(() => undefined);
  return siguiente;
}

function emitir(sesionId: string, estado: EstadoLocalVuelta): void {
  for (const oyente of oyentes) oyente(sesionId, estado);
}

/** SOLO para tests/diagnóstico: reinicia el piso y las banderas en memoria. */
export function reiniciarPisoVueltaActualParaTests(): void {
  ultimoIntentoMs = 0;
  enVuelo = false;
  enVueloDesdeMs = 0;
  secuenciaConsulta = 0;
  refetchPendiente = false;
  obtenerTokenReciente = null;
}

/** Anuncia por voz + notificación. `true` solo si la notificación se programó (si falló, el aviso
 * se reintenta en las consultas siguientes, con tope). */
async function anunciar(aviso: AvisoVuelta): Promise<boolean> {
  if (aviso.tipo === 'designada') {
    const texto = textoAvisoDesignada(aviso.esperaMin);
    return anunciarAvisoEnCanal({
      identifier: idNotificacionDesignacion(aviso.clave),
      titulo: 'Designación: vía Molinos',
      cuerpo: texto,
      voz: texto,
    });
  }
  return anunciarAvisoEnCanal({
    identifier: aviso.clave,
    titulo: 'Designación cancelada',
    cuerpo: TEXTO_AVISO_CANCELADA,
    voz: TEXTO_AVISO_CANCELADA,
  });
}

/**
 * Incorpora una respuesta del servidor (de un GET o del acuse): la aplica al estado persistido,
 * dispara los avisos y descarta de la bandeja las notificaciones que ya no valen. Una respuesta
 * idéntica a la anterior no escribe SQLite ni emite. Devuelve el estado resultante, o `null` si la
 * respuesta se descartó porque el recorrido activo ya no es el de la consulta.
 */
type ResultadoAplicado = ReturnType<typeof aplicarRespuesta>;

/** ¿Sigue activo `recorridoId`? Un error de lectura cuenta como NO confirmado (no se habla ni se
 * toca el cache), sin interpretarlo como fin del recorrido. */
async function recorridoSigueActivo(sesionId: string, recorridoId: string): Promise<boolean> {
  const lectura = await leerRecorridoActual(sesionId);
  return lectura.ok && lectura.recorridoId === recorridoId;
}

async function incorporarRespuesta(
  sesionId: string,
  recorridoId: string,
  respuesta: VueltaActualMovil,
): Promise<EstadoLocalVuelta | null> {
  const ahoraMs = Date.now();
  const { crudo, previo, resultado, descartada } = await serializar(async () => {
    // Se verifica DENTRO de la cola: si el recorrido activo ya no es el de esta consulta (o no se
    // pudo leer), se descarta sin tocar el cache.
    if (!(await recorridoSigueActivo(sesionId, recorridoId))) {
      return { crudo: ESTADO_LOCAL_INICIAL, previo: ESTADO_LOCAL_INICIAL, resultado: null, descartada: true };
    }
    // Único lugar que reemplaza el cache de otro recorrido: acá, dentro de la cola.
    const crudo = await leerEstadoVueltaLocal(sesionId);
    const previo = resolverEstadoParaRecorrido(crudo, recorridoId);
    const aplicado = aplicarRespuesta(previo, respuesta, { ahoraMs });
    const resultado: ResultadoAplicado = { ...aplicado, estado: { ...aplicado.estado, recorridoId } };
    // Se persiste ANTES de hablar/notificar: el intento queda contado y un reinicio (o el otro
    // contexto JS) no entra en bucle. Si la fila era de otro recorrido o no tenía `recorridoId`
    // (APK anterior), se reescribe aunque la respuesta sea idéntica.
    if (resultado.cambio || crudo.recorridoId !== recorridoId) {
      await guardarEstadoVueltaLocal(sesionId, resultado.estado);
    }
    return { crudo, previo, resultado, descartada: false };
  });
  if (descartada || !resultado) return null;
  if (!resultado.cambio && crudo.recorridoId === recorridoId) return resultado.estado;
  emitir(sesionId, resultado.estado);
  // Si el cache era de OTRO recorrido, sus notificaciones (designación/cancelación vieja) se
  // descartan ahora, contra el estado crudo que se acaba de reemplazar.
  const anterior = crudo.recorridoId !== null && crudo.recorridoId !== recorridoId ? crudo : previo;
  for (const id of notificacionesObsoletas(anterior, resultado.estado)) {
    await descartarNotificacionAviso(id);
  }
  let estado = resultado.estado;
  for (const aviso of resultado.avisos) {
    if (!(await recorridoSigueActivo(sesionId, recorridoId))) return estado;
    const exito = await anunciar(aviso);
    if (!exito) continue;
    const marcado = await serializar(async () => {
      if (!(await recorridoSigueActivo(sesionId, recorridoId))) return null;
      const nuevo = marcarAnunciada(await leerEstadoVueltaLocal(sesionId), aviso.clave);
      await guardarEstadoVueltaLocal(sesionId, nuevo);
      return nuevo;
    });
    if (!marcado) return estado;
    estado = marcado;
    emitir(sesionId, estado);
  }
  return estado;
}

/** Pide un refresco: si hay una consulta en vuelo queda marcado y corre al terminar ésta (antes se
 * perdía: `consultarVueltaActual` descartaba la llamada); si no, consulta ya. */
/** ¿Hay una consulta en vuelo VIGENTE? Una que lleva más de `VENCIMIENTO_EN_VUELO_MS` se da por
 * colgada y no bloquea. */
function hayConsultaVigente(ahoraMs: number): boolean {
  return enVuelo && ahoraMs - enVueloDesdeMs < VENCIMIENTO_EN_VUELO_MS;
}

async function solicitarRefresco(obtenerAccessToken: () => Promise<string | null>): Promise<void> {
  if (hayConsultaVigente(Date.now())) {
    refetchPendiente = true;
    obtenerTokenReciente = obtenerAccessToken;
    return;
  }
  await consultarVueltaActual(obtenerAccessToken, { forzar: true });
}

/** Manda el acuse de una designación cerrada localmente que el servidor aún no confirmó. La
 * respuesta del acuse trae el estado actualizado y se incorpora; si no lo trae se pide un GET.
 * Un 4xx permanente (salvo 401/408/429) corta el reintento y se reporta a Sentry; red y 5xx
 * siguen reintentando en cada consulta. */
async function enviarAcuse(
  accessToken: string,
  sesionId: string,
  recorridoId: string,
  estado: EstadoLocalVuelta,
  obtenerAccessToken: () => Promise<string | null>,
): Promise<void> {
  const pendiente = acusePendiente(estado);
  if (!pendiente) return;
  try {
    const respuesta = await vueltaActualApi.acusar(accessToken, pendiente);
    if (respuesta) await incorporarRespuesta(sesionId, recorridoId, respuesta);
    else await solicitarRefresco(obtenerAccessToken);
  } catch (error) {
    if (!esErrorAcusePermanente(error)) return; // silencioso: se reintenta en la próxima consulta
    Sentry.captureException(error, {
      tags: { contexto: 'vuelta-actual', paso: 'acuse-permanente' },
      extra: { status: (error as { status?: number }).status },
    });
    const clave = claveDesignacion(pendiente.vueltaId, { designadaEn: pendiente.designadaEn });
    if (!clave) return;
    const nuevo = await serializar(async () => {
      const abandonado = abandonarAcuse(await leerEstadoVueltaLocal(sesionId), clave);
      await guardarEstadoVueltaLocal(sesionId, abandonado);
      return abandonado;
    });
    emitir(sesionId, nuevo);
  }
}

/**
 * Consulta `GET /mobile/vuelta-actual`, guarda el estado, dispara los avisos que correspondan
 * (voz + notificación) y reintenta el acuse pendiente. `forzar` salta el piso (primer fetch del
 * recorrido, o tras mandar un acuse).
 */
export async function consultarVueltaActual(
  obtenerAccessToken: () => Promise<string | null>,
  opciones: { forzar?: boolean } = {},
): Promise<void> {
  // El instante se toma al DISPARAR la llamada (antes de los awaits): el piso se mide entre
  // disparos, no entre el final de las lecturas previas.
  const disparoMs = Date.now();
  if (hayConsultaVigente(disparoMs)) return;
  if (!opciones.forzar && disparoMs - ultimoIntentoMs < PISO_ENTRE_CONSULTAS_MS - TOLERANCIA_PISO_MS) return;
  // El registro del recorrido se lee ANTES de tomar el slot: sin recorrido (o con la lectura
  // fallida) no se consume el piso ni se marca en vuelo, así la primera consulta tras registrarse
  // el recorrido no queda esperando 20 s.
  let sesionId: string;
  let recorridoId: string;
  try {
    const sesion = await cargarSesionMovil();
    if (!sesion) return;
    sesionId = sesion.contexto.sesionId;
    const lectura = await leerRecorridoActual(sesionId);
    if (!lectura.ok || !lectura.recorridoId) return;
    recorridoId = lectura.recorridoId;
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'vuelta-actual', paso: 'previa' } });
    return;
  }
  // Los awaits de arriba pudieron ceder el paso a otra consulta: se re-chequea antes del slot.
  if (hayConsultaVigente(Date.now())) return;
  if (!opciones.forzar && disparoMs - ultimoIntentoMs < PISO_ENTRE_CONSULTAS_MS - TOLERANCIA_PISO_MS) return;
  enVuelo = true;
  enVueloDesdeMs = Date.now();
  ultimoIntentoMs = disparoMs;
  const miSecuencia = ++secuenciaConsulta;
  try {
    const accessToken = await obtenerAccessToken();
    if (!accessToken) return;

    const respuesta = await vueltaActualApi.obtener(accessToken);
    // Una consulta vencida (otra tomó el slot mientras esta seguía colgada) descarta su respuesta.
    if (miSecuencia !== secuenciaConsulta) return;
    const estado = await incorporarRespuesta(sesionId, recorridoId, respuesta);
    if (!estado) return; // el recorrido cambió/terminó mientras la consulta estaba en vuelo
    await enviarAcuse(accessToken, sesionId, recorridoId, estado, obtenerAccessToken);
  } catch (error) {
    // Red caída / 5xx / 429 / sesión: silencioso para el chofer. Solo se reporta lo que no es
    // un fallo de transporte esperable (contrato roto, SQLite).
    const kind = (error as { kind?: string } | null)?.kind;
    if (kind !== 'network' && kind !== 'http') {
      Sentry.captureException(error, { tags: { contexto: 'vuelta-actual' } });
    }
  } finally {
    // Solo la consulta vigente libera el slot y dispara el refetch pendiente.
    if (miSecuencia === secuenciaConsulta) {
      enVuelo = false;
      if (refetchPendiente) {
        refetchPendiente = false;
        const token = obtenerTokenReciente ?? obtenerAccessToken;
        void consultarVueltaActual(token, { forzar: true });
      }
    }
  }
}

/** "Entendido" sobre la designación: cierra la tarjeta localmente (persistido), quita la
 * notificación de la bandeja y manda el acuse; si falla la red el aviso igual queda cerrado y el
 * acuse se reintenta en cada consulta hasta que el servidor devuelva `acuseEn`. */
export async function entenderDesignacion(
  obtenerAccessToken: () => Promise<string | null>,
  sesionId: string,
): Promise<void> {
  try {
    const estado = await serializar(async () => {
      const nuevo = cerrarDesignacion(await leerEstadoVueltaLocal(sesionId));
      await guardarEstadoVueltaLocal(sesionId, nuevo);
      return nuevo;
    });
    emitir(sesionId, estado);
    const clave = estado.ultimo ? claveDesignacion(estado.ultimo.vueltaId, estado.ultimo.designacion) : null;
    if (clave) await descartarNotificacionAviso(idNotificacionDesignacion(clave));
    const lectura = await leerRecorridoActual(sesionId);
    const recorridoId = lectura.ok ? lectura.recorridoId : null;
    const accessToken = recorridoId ? await obtenerAccessToken() : null;
    if (accessToken && recorridoId) {
      await enviarAcuse(accessToken, sesionId, recorridoId, estado, obtenerAccessToken);
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'vuelta-actual', paso: 'entendido' } });
  }
}

/** "Entendido" sobre la cancelación: solo local, sin acuse al servidor. */
export async function entenderCancelacion(sesionId: string): Promise<void> {
  try {
    const { estado, clave } = await serializar(async () => {
      const previo = await leerEstadoVueltaLocal(sesionId);
      const nuevo = cerrarCancelacion(previo);
      await guardarEstadoVueltaLocal(sesionId, nuevo);
      return { estado: nuevo, clave: previo.cancelacionPendiente };
    });
    emitir(sesionId, estado);
    if (clave) await descartarNotificacionAviso(clave);
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'vuelta-actual', paso: 'entendido-cancelacion' } });
  }
}

/** Fin del recorrido: limpieza inmediata (la corrección no depende de ella: el cache y las
 * consultas están atados al recorrido activo). Descarta la última respuesta y sus derivados y deja
 * de insistir con lo pendiente. */
export async function limpiarVueltaActual(sesionId: string): Promise<void> {
  refetchPendiente = false;
  try {
    const estado = await serializar(async () => {
      const nuevo = reiniciarEstadoRecorrido(await leerEstadoVueltaLocal(sesionId));
      if (nuevo.anunciadas.length || nuevo.cerradas.length || nuevo.acusesAbandonados.length) {
        await guardarEstadoVueltaLocal(sesionId, nuevo);
      } else {
        await borrarEstadoVueltaLocal(sesionId);
      }
      return nuevo;
    });
    emitir(sesionId, estado);
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'vuelta-actual', paso: 'limpiar' } });
  }
}

/** Al montar: borra el cache que quedó de OTRAS sesiones (la tabla solo guarda la vigente al
 * escribir; sin recorrido nadie escribe y la fila vieja quedaría). */
export async function limpiarVueltaActualDeOtrasSesiones(sesionId: string): Promise<void> {
  try {
    await serializar(() => borrarEstadosVueltaLocalDeOtrasSesiones(sesionId));
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'vuelta-actual', paso: 'limpiar-otras' } });
  }
}
