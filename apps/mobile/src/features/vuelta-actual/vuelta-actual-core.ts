import type { EstadoFilaSalida, VueltaActualMovil } from '@quivo/shared';
import { desfaseReloj } from '../fila-salida/fila-salida-core';

/**
 * Lógica pura (sin React ni módulos nativos) del aviso de designación a Molinos
 * (`docs/plan-molinos-designacion.md`, "App del chofer"). Decide QUÉ avisar comparando el estado
 * anterior con la respuesta nueva del servidor, y qué sigue pendiente de cerrar/acusar.
 */

export type Designacion = NonNullable<VueltaActualMovil['designacion']>;

/** Cuántas claves se recuerdan como máximo (anunciadas/cerradas): una jornada no pasa de unas
 * pocas designaciones; el tope solo evita que la persistencia crezca sin límite. */
const MAX_CLAVES = 30;

/** Estado local persistido por sesión (sobrevive al reinicio de la app). */
export interface EstadoLocalVuelta {
  /** Última respuesta buena del servidor (para mostrar sin red). */
  ultimo: VueltaActualMovil | null;
  /** Claves de aviso ya anunciadas (voz + notificación): nunca se repiten. */
  anunciadas: string[];
  /** Claves de designación que el chofer ya cerró con "Entendido" (acuse enviado o por reintentar). */
  cerradas: string[];
  /** Clave de una cancelación anunciada y todavía sin cerrar con "Entendido"; `null` = ninguna. */
  cancelacionPendiente: string | null;
  /** Epoch ms (reloj del teléfono) de la última respuesta BUENA del servidor; `null` = nunca. Se
   * refresca como máximo cada `REFRESCO_ACTUALIZADO_MS` para no escribir SQLite en cada poll. */
  actualizadoEn: number | null;
  /** Intentos de anuncio (voz + notificación) hechos por clave aún no anunciada con éxito. */
  intentosAnuncio: Record<string, number>;
  /** Claves cuyo acuse el servidor rechazó de forma permanente (4xx): no se reintenta más. */
  acusesAbandonados: string[];
  /** Salió de la fila de salida y todavía no se alejó de la terminal: la detección automática no
   * lo vuelve a encolar (ver `fila-salida/zona-terminal.ts`). Ausente = `false`. */
  filaDesarmada?: boolean;
  /** `servidorTs - momento de recepción local` (ms) de la última respuesta con fila: base de la
   * cuenta regresiva. Solo se reescribe si varía más de `TOLERANCIA_DESFASE_MS`. Ausente = sin fila. */
  desfaseFilaMs?: number;
}

export const ESTADO_LOCAL_INICIAL: EstadoLocalVuelta = {
  ultimo: null,
  anunciadas: [],
  cerradas: [],
  cancelacionPendiente: null,
  actualizadoEn: null,
  intentosAnuncio: {},
  acusesAbandonados: [],
};

/** Intentos máximos de anunciar un aviso (voz + notificación) antes de rendirse. */
export const MAX_INTENTOS_ANUNCIO = 3;
/** Más viejo que esto, el cache de la vuelta ya no se dibuja/cuenta como actual. */
export const MAX_EDAD_CACHE_MS = 15 * 60_000;
/** Cada cuánto se reescribe `actualizadoEn` aunque la respuesta sea idéntica. */
export const REFRESCO_ACTUALIZADO_MS = 2 * 60_000;

export type AvisoVuelta =
  | { tipo: 'designada'; clave: string; esperaMin: number | null }
  | { tipo: 'cancelada'; clave: string };

/** Identidad de una designación: la vuelta + el instante exacto en que se designó. */
export function claveDesignacion(
  vueltaId: string | null,
  designacion: Pick<Designacion, 'designadaEn'> | null,
): string | null {
  if (!vueltaId || !designacion) return null;
  return `${vueltaId}|${designacion.designadaEn}`;
}

function claveCancelacion(claveDesignacionPrevia: string): string {
  return `cancelada|${claveDesignacionPrevia}`;
}

/**
 * Qué avisos corresponden al pasar de `anterior` a `nuevo`:
 * - Designación nueva o cambiada (clave `vueltaId|designadaEn`) sin acuse y no anunciada antes
 *   -> "designada".
 * - MISMA vuelta, antes había designación (ya anunciada) y ahora no -> "cancelada". Si la vuelta
 *   cambió (cierre natural en Salomón Romero) NO es cancelación.
 * - Nada que ya figure en `anunciadas` se repite.
 */
export function decidirAvisos(
  anterior: VueltaActualMovil | null,
  nuevo: VueltaActualMovil,
  anunciadas: readonly string[],
  intentos: Readonly<Record<string, number>> = {},
  cancelacionPendiente: string | null = null,
): AvisoVuelta[] {
  const avisos: AvisoVuelta[] = [];
  const hayCupo = (clave: string): boolean => (intentos[clave] ?? 0) < MAX_INTENTOS_ANUNCIO;
  const claveNueva = claveDesignacion(nuevo.vueltaId, nuevo.designacion);
  if (
    nuevo.designacion &&
    claveNueva &&
    nuevo.designacion.acuseEn === null &&
    !anunciadas.includes(claveNueva) &&
    hayCupo(claveNueva)
  ) {
    avisos.push({
      tipo: 'designada',
      clave: claveNueva,
      esperaMin: nuevo.designacion.puntoEspera.esperaMin,
    });
  }

  if (anterior && anterior.designacion && !nuevo.designacion && anterior.vueltaId === nuevo.vueltaId) {
    const clavePrevia = claveDesignacion(anterior.vueltaId, anterior.designacion);
    // Solo se cancela lo que el chofer llegó a ver: una designación que nunca se anunció (p. ej.
    // ya estaba acusada) no merece un "cancelada" fuera de contexto.
    if (clavePrevia && anunciadas.includes(clavePrevia)) {
      const clave = claveCancelacion(clavePrevia);
      if (!anunciadas.includes(clave) && hayCupo(clave)) avisos.push({ tipo: 'cancelada', clave });
    }
  }
  // Reintento de una cancelación cuyo anuncio falló: `anterior` ya no tiene designación, así que
  // la rama de arriba no la regenera; se deriva de la cancelación pendiente.
  if (
    cancelacionPendiente &&
    !anunciadas.includes(cancelacionPendiente) &&
    hayCupo(cancelacionPendiente) &&
    !avisos.some((a) => a.clave === cancelacionPendiente)
  ) {
    avisos.push({ tipo: 'cancelada', clave: cancelacionPendiente });
  }
  return avisos;
}

function recortar(claves: string[]): string[] {
  return claves.length > MAX_CLAVES ? claves.slice(claves.length - MAX_CLAVES) : claves;
}

function coordsIguales(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.[0] !== b[i]?.[0] || a[i]?.[1] !== b[i]?.[1]) return false;
  }
  return true;
}

/** Excluye `servidorTs` a propósito: cambia en cada respuesta y reescribiría SQLite en cada poll;
 * su efecto (el desfase del reloj) se guarda aparte en `desfaseFilaMs`. */
function filasIguales(a: VueltaActualMovil['fila'], b: VueltaActualMovil['fila']): boolean {
  if (!a || !b) return (a ?? null) === (b ?? null);
  return (
    a.posicion === b.posicion &&
    a.total === b.total &&
    a.delantePlaca === b.delantePlaca &&
    a.etaTs === b.etaTs &&
    a.esperaMs === b.esperaMs &&
    a.habilitado === b.habilitado &&
    a.demorado === b.demorado
  );
}

/** ¿Dos respuestas del servidor dicen lo mismo? (clave, acuse, espera, número, vuelta y el tramo
 * por contenido). Cada poll devuelve objetos nuevos, así que la igualdad por referencia no sirve. */
export function respuestasIguales(a: VueltaActualMovil | null, b: VueltaActualMovil): boolean {
  if (!a) return false;
  if (a.vueltaId !== b.vueltaId || a.numero !== b.numero) return false;
  if (!filasIguales(a.fila, b.fila)) return false;
  if ((a.enEspera?.desdeTs ?? null) !== (b.enEspera?.desdeTs ?? null)) return false;
  if ((a.enEspera?.posicion ?? null) !== (b.enEspera?.posicion ?? null)) return false;
  const da = a.designacion;
  const db = b.designacion;
  if (!da || !db) return da === db;
  if (
    da.varianteId !== db.varianteId ||
    da.nombre !== db.nombre ||
    da.designadaEn !== db.designadaEn ||
    da.acuseEn !== db.acuseEn ||
    da.puntoEspera.id !== db.puntoEspera.id ||
    da.puntoEspera.esperaMin !== db.puntoEspera.esperaMin ||
    da.puntoEspera.coord.coordinates[0] !== db.puntoEspera.coord.coordinates[0] ||
    da.puntoEspera.coord.coordinates[1] !== db.puntoEspera.coord.coordinates[1]
  ) {
    return false;
  }
  if (!da.tramo || !db.tramo) return da.tramo === db.tramo;
  return coordsIguales(da.tramo.coordinates, db.tramo.coordinates);
}

/** Cuánto puede variar el desfase del reloj antes de que valga la pena persistirlo de nuevo. */
export const TOLERANCIA_DESFASE_MS = 1_000;

export interface ContextoRespuesta {
  /** Reloj del teléfono al recibir la respuesta. */
  ahoraMs: number;
}

/**
 * Incorpora una respuesta del servidor: devuelve el estado nuevo y los avisos a disparar.
 * - Cada aviso emitido consume un intento (`intentosAnuncio`), que se persiste ANTES de hablar:
 *   un crash a mitad de anuncio no produce un bucle. La clave se marca anunciada recién cuando
 *   el anuncio salió bien (`marcarAnunciada`); si falló, se reintenta en las consultas
 *   siguientes hasta `MAX_INTENTOS_ANUNCIO`.
 * - Una designación nueva (clave distinta) limpia una cancelación pendiente de la anterior.
 * - `fila` AUSENTE (p. ej. la respuesta del acuse) conserva la fila previa y no toca
 *   `filaDesarmada`; solo un `null` explícito significa "salió de la fila".
 * - Una respuesta idéntica a la anterior no cambia nada: devuelve el MISMO `estado` (misma
 *   referencia) y `cambio: false`, para no reescribir SQLite ni re-renderizar en cada poll.
 */
export function aplicarRespuesta(
  estado: EstadoLocalVuelta,
  respuesta: VueltaActualMovil,
  ctx: ContextoRespuesta = { ahoraMs: Date.now() },
): { estado: EstadoLocalVuelta; avisos: AvisoVuelta[]; cambio: boolean } {
  const nuevo =
    respuesta.fila === undefined && estado.ultimo?.fila
      ? { ...respuesta, fila: estado.ultimo.fila }
      : respuesta;
  const claveNueva = claveDesignacion(nuevo.vueltaId, nuevo.designacion);
  const cancelBase =
    claveNueva && estado.cancelacionPendiente !== claveCancelacion(claveNueva)
      ? null
      : estado.cancelacionPendiente;
  const avisos = decidirAvisos(estado.ultimo, nuevo, estado.anunciadas, estado.intentosAnuncio, cancelBase);
  const cancelada = avisos.find((a) => a.tipo === 'cancelada');
  const cancelacionPendiente = cancelada ? cancelada.clave : cancelBase;

  const iguales = respuestasIguales(estado.ultimo, nuevo);
  const marcaVencida =
    estado.actualizadoEn === null || ctx.ahoraMs - estado.actualizadoEn >= REFRESCO_ACTUALIZADO_MS;
  // Salir de la fila (`null` explícito tras tener una) desarma la llegada automática; volver a
  // tener fila (p. ej. con el botón "Estoy en la fila") la rearma; sin el campo no se toca.
  const filaDesarmada = respuesta.fila
    ? false
    : respuesta.fila === null && estado.ultimo?.fila
      ? true
      : estado.filaDesarmada === true;
  let desfaseFilaMs = estado.desfaseFilaMs;
  if (respuesta.fila) {
    const d = desfaseReloj(respuesta.fila, ctx.ahoraMs);
    if (desfaseFilaMs === undefined || Math.abs(d - desfaseFilaMs) > TOLERANCIA_DESFASE_MS)
      desfaseFilaMs = d;
  } else if (respuesta.fila === null) {
    desfaseFilaMs = undefined;
  }
  const cambio =
    !iguales ||
    avisos.length > 0 ||
    marcaVencida ||
    cancelacionPendiente !== estado.cancelacionPendiente ||
    filaDesarmada !== (estado.filaDesarmada === true) ||
    desfaseFilaMs !== estado.desfaseFilaMs;
  if (!cambio) return { estado, avisos: [], cambio: false };

  const intentos: Record<string, number> = {};
  for (const [clave, n] of Object.entries(estado.intentosAnuncio)) {
    if (!estado.anunciadas.includes(clave)) intentos[clave] = n;
  }
  for (const a of avisos) intentos[a.clave] = (intentos[a.clave] ?? 0) + 1;
  const claves = Object.keys(intentos);
  for (const clave of claves.slice(0, Math.max(0, claves.length - MAX_CLAVES))) delete intentos[clave];

  return {
    avisos,
    cambio: true,
    estado: {
      ...estado,
      // Misma referencia si el contenido no cambió: la UI y el mapa no se re-dibujan.
      ultimo: iguales && estado.ultimo ? estado.ultimo : nuevo,
      cancelacionPendiente,
      filaDesarmada,
      desfaseFilaMs,
      actualizadoEn: ctx.ahoraMs,
      intentosAnuncio: intentos,
    },
  };
}

/** El anuncio de `clave` salió bien: queda anunciada y deja de reintentarse. */
export function marcarAnunciada(estado: EstadoLocalVuelta, clave: string): EstadoLocalVuelta {
  if (estado.anunciadas.includes(clave)) return estado;
  const intentosAnuncio = { ...estado.intentosAnuncio };
  delete intentosAnuncio[clave];
  return { ...estado, anunciadas: recortar([...estado.anunciadas, clave]), intentosAnuncio };
}

/** El acuse de la designación vigente fue rechazado de forma permanente: no se reintenta más. */
export function abandonarAcuse(estado: EstadoLocalVuelta, clave: string): EstadoLocalVuelta {
  if (estado.acusesAbandonados.includes(clave)) return estado;
  return { ...estado, acusesAbandonados: recortar([...estado.acusesAbandonados, clave]) };
}

/** ¿El cache de la vuelta es demasiado viejo para presentarlo como actual? Sin respuesta
 * guardada no hay nada que envejecer (`false`); una marca ausente (cache anterior a esta
 * versión) cuenta como vieja. */
export function esCacheDesactualizado(estado: EstadoLocalVuelta, ahoraMs: number): boolean {
  if (!estado.ultimo) return false;
  if (estado.actualizadoEn === null) return true;
  return ahoraMs - estado.actualizadoEn > MAX_EDAD_CACHE_MS;
}

/** Identificadores de notificaciones locales que dejaron de tener sentido al pasar de `previo`
 * a `nuevo` (designación cerrada/cancelada/reemplazada, cancelación superada). */
export function notificacionesObsoletas(
  previo: EstadoLocalVuelta,
  nuevo: EstadoLocalVuelta,
): string[] {
  const ids: string[] = [];
  const pv = previo.ultimo;
  const nv = nuevo.ultimo;
  const clavePrevia = pv ? claveDesignacion(pv.vueltaId, pv.designacion) : null;
  const claveNueva = nv ? claveDesignacion(nv.vueltaId, nv.designacion) : null;
  if (clavePrevia && clavePrevia !== claveNueva) ids.push(idNotificacionDesignacion(clavePrevia));
  else if (
    clavePrevia &&
    pv?.designacion?.acuseEn === null &&
    nv?.designacion?.acuseEn !== null &&
    nv?.designacion
  ) {
    ids.push(idNotificacionDesignacion(clavePrevia));
  }
  if (previo.cancelacionPendiente && nuevo.cancelacionPendiente !== previo.cancelacionPendiente) {
    ids.push(previo.cancelacionPendiente);
  }
  return ids;
}

/** Identificador de la notificación local del aviso de designación (y de su descarte). */
export function idNotificacionDesignacion(clave: string): string {
  return `designacion|${clave}`;
}

/** Un error de acuse es PERMANENTE si es un 4xx que reintentar no arregla. Quedan fuera 408
 * (timeout), 429 (throttle) y 401 (token vencido: se renueva y vuelve a servir). */
export function esErrorAcusePermanente(error: unknown): boolean {
  const e = error as { kind?: string; status?: number } | null;
  if (!e || e.kind !== 'http' || typeof e.status !== 'number') return false;
  return e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);
}

/** Designación activa que el chofer todavía tiene que ver/confirmar (tarjeta persistente):
 * sin acuse del servidor y sin cerrar localmente. */
export function designacionPendienteDeAviso(estado: EstadoLocalVuelta): Designacion | null {
  const v = estado.ultimo;
  if (!v || !v.designacion || v.designacion.acuseEn !== null) return null;
  const clave = claveDesignacion(v.vueltaId, v.designacion);
  if (!clave || estado.cerradas.includes(clave)) return null;
  return v.designacion;
}

/** "Entendido" sobre la designación vigente: se cierra localmente (el acuse se manda aparte). */
export function cerrarDesignacion(estado: EstadoLocalVuelta): EstadoLocalVuelta {
  const v = estado.ultimo;
  const clave = v ? claveDesignacion(v.vueltaId, v.designacion) : null;
  if (!clave || estado.cerradas.includes(clave)) return estado;
  return { ...estado, cerradas: recortar([...estado.cerradas, clave]) };
}

export function cerrarCancelacion(estado: EstadoLocalVuelta): EstadoLocalVuelta {
  return estado.cancelacionPendiente === null ? estado : { ...estado, cancelacionPendiente: null };
}

/** Acuse que falta mandar: designación cerrada localmente que el servidor aún no confirmó
 * (`acuseEn` nulo). Se reintenta en cada consulta hasta que el servidor devuelva `acuseEn`. */
export function acusePendiente(
  estado: EstadoLocalVuelta,
): { vueltaId: string; designadaEn: string } | null {
  const v = estado.ultimo;
  if (!v || !v.vueltaId || !v.designacion || v.designacion.acuseEn !== null) return null;
  const clave = claveDesignacion(v.vueltaId, v.designacion);
  if (!clave || !estado.cerradas.includes(clave) || estado.acusesAbandonados.includes(clave)) return null;
  return { vueltaId: v.vueltaId, designadaEn: v.designacion.designadaEn };
}

/** Margen de seguridad (min) de la cuenta regresiva de Molinos. La sanción `espera_corta` compara
 * timestamps del fix GPS (llegada y salida) y el reloj del teléfono puede diferir algunos segundos
 * de ese reloj: el margen evita que el chofer salga antes de tiempo por esa diferencia. */
export const MARGEN_ESPERA_MIN = 1;

/** Minutos que faltan para poder salir de Molinos: `ceil(esperaMin + margen - transcurrido)`, piso 0.
 * `desdeTs` inválido -> `esperaMin + margen` completo (no se inventa un transcurrido). */
export function restanteEsperaMin(esperaMin: number, desdeTs: string, ahoraMs: number): number {
  const total = esperaMin + MARGEN_ESPERA_MIN;
  const desde = Date.parse(desdeTs);
  if (!Number.isFinite(desde)) return Math.max(0, Math.ceil(total));
  const transcurridoMin = Math.max(0, (ahoraMs - desde) / 60_000);
  return Math.max(0, Math.ceil(total - transcurridoMin));
}

/** Pastilla de Molinos. Con minutos de espera: cuenta regresiva. Sin minutos (salida libre): el
 * lugar en la cola por orden de llegada; sin `posicion` (servidor viejo) no hay pastilla. */
export function pastillaEspera(
  esperaMin: number | null,
  desdeTs: string,
  ahoraMs: number,
  posicion: number | undefined,
): { texto: string; listo: boolean } | null {
  if (esperaMin !== null) {
    const restante = restanteEsperaMin(esperaMin, desdeTs, ahoraMs);
    return { texto: textoContadorEspera(restante), listo: restante <= 0 };
  }
  if (posicion === undefined) return null;
  return posicion === 1
    ? { texto: 'Es tu turno. Podés salir', listo: true }
    : { texto: `Sos el ${posicion}.º en Molinos. Salís después del que está adelante.`, listo: false };
}

export function textoContadorEspera(restanteMin: number): string {
  return restanteMin > 0 ? `Podés salir en ${restanteMin} min` : 'Ya podés salir';
}

/** Única fuente del texto del aviso de designación. La tarjeta lo muestra con `unidad: 'min'` y
 * resalta `destacado`; la voz, la notificación y la etiqueta de accesibilidad usan la versión
 * hablada (`textoAvisoDesignada`, "minutos" completo). */
export function partesAvisoDesignada(
  esperaMin: number | null,
  unidad: 'min' | 'minutos' = 'minutos',
): { antes: string; destacado: string; despues: string } {
  return {
    antes: 'Esta vuelta: ',
    destacado: 'vía Molinos',
    // `esperaMin` null = salida libre en Molinos: no hay espera que avisar.
    despues:
      esperaMin === null
        ? '. Después de Honduras subí por Putucu.'
        : `. Después de Honduras subí por Putucu y esperá ${esperaMin} ${unidad}.`,
  };
}

export function textoAvisoDesignada(esperaMin: number | null): string {
  const p = partesAvisoDesignada(esperaMin, 'minutos');
  return `${p.antes}${p.destacado}${p.despues}`;
}

export const CUERPO_AVISO_CANCELADA = 'Volvé directo a Salomón Romero.';
export const TEXTO_AVISO_CANCELADA = `Designación cancelada. ${CUERPO_AVISO_CANCELADA}`;

/** Tramo GeoJSON `[lng, lat][]` -> lista `{latitude, longitude}` para el mapa; `[]` si no hay
 * tramo o tiene menos de 2 puntos (una polilínea necesita 2). */
export function coordenadasTramo(
  tramo: Designacion['tramo'],
): { latitude: number; longitude: number }[] {
  if (!tramo || tramo.coordinates.length < 2) return [];
  return tramo.coordinates.map((c) => ({ latitude: c[1] as number, longitude: c[0] as number }));
}

/** Designación del cache del recorrido actual. El servidor es la única verdad: no hay supresión local. */
export function designacionVigente(estado: EstadoLocalVuelta): Designacion | null {
  return estado.ultimo?.designacion ?? null;
}

/** La detección de zona se alejó lo suficiente: la llegada automática vuelve a estar armada. */
export function rearmarFila(estado: EstadoLocalVuelta): EstadoLocalVuelta {
  return estado.filaDesarmada === true ? { ...estado, filaDesarmada: false } : estado;
}

/** Respuesta sintética con la `fila` que devolvió un POST de la fila (llegada/salida), sobre la
 * última vuelta conocida: se incorpora con `aplicarRespuesta` como si fuera un GET. */
export function respuestaConFila(
  ultimo: VueltaActualMovil | null,
  fila: EstadoFilaSalida | null,
): VueltaActualMovil {
  return { vueltaId: null, numero: null, designacion: null, enEspera: null, ...ultimo, fila };
}
