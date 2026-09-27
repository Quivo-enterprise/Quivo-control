import { posicionEnPolilinea } from '../geometria';
import { detectarEventos, type ParadaControlActiva } from './flota';
import type { EstadoTrufi, EventoTrufiTick, LineaMock, PuntoTrazado } from '../tipos';

/**
 * Slice `senal` — pérdida y recuperación de señal GPS (E08 05:42/05:53 del guion): mientras
 * `fase === 'sin_senal'` el trufi sigue moviéndose "de verdad" (su `avance` interno avanza,
 * como si el GPS del vehículo siguiera transmitiendo a un buffer local que el backend no ve
 * todavía) pero la posición EXPUESTA (`lat`/`lng`, lo que pinta el mapa) se congela — de ahí
 * que el marcador no se mueva por más de la duración real del corte. Al recuperar la señal
 * pasa por `fase === 'sincronizando'` unos ticks ("Sincronizando N puntos…") y recién ahí
 * vuelca el buffer a `traza` y salta la posición expuesta al lugar real.
 *
 * Ítem 6 del guion delegado: mientras está `sin_senal`, TAMBIÉN se detectan cruces de punto de
 * control y cierre de vuelta (antes se descartaban por completo) — pero como el panel todavía
 * no "ve" esos eventos (son de la caja negra, no llegaron a sincronizar), se ACUMULAN en
 * `trufi.eventosPendientes` en vez de aplicarse. Recién cuando `sincronizando` termina de
 * volcar el buffer se reconcilian de una sola vez, EN ORDEN, contra `recorridos`/`cumplimientos`
 * — `avanzarSincronizando` devuelve esa lista para que `estado/index.ts#tick` la aplique (mismo
 * mecanismo que usa para los eventos "en vivo" de `en_ruta`/`desviado`, ver `flota.ts#cerrarVuelta`).
 */

/** Ticks (~1 s c/u) que dura la fase `sincronizando` antes de volcar el buffer — "~3 s" del
 * contrato. */
export const SINCRONIZANDO_TICKS = 3;

/** Dispara la pérdida de señal — llamado por `perderSenal` (acción de escenario,
 * `estado/index.ts`). El trufi tiene que estar `en_ruta` al momento de llamarla (lo garantiza
 * el caller vía `trufisEnRutaVisibles`, `flota.ts`). */
export function iniciarPerderSenal(trufi: EstadoTrufi, nowIso: string): EstadoTrufi {
  return { ...trufi, fase: 'sin_senal', bufferPuntos: [], eventosPendientes: [], ultimaSenalEn: nowIso };
}

/** Dispara la recuperación — llamado por `recuperarSenal`. Congela también el avance durante
 * `sincronizando` (deja de acumular buffer: la "sincronización" es una pausa deliberada para
 * que la UI tenga tiempo de mostrar el mensaje antes de saltar la posición). */
export function iniciarRecuperarSenal(trufi: EstadoTrufi): EstadoTrufi {
  return {
    ...trufi,
    fase: 'sincronizando',
    puntosPendientes: trufi.bufferPuntos.length,
    sincronizandoTicksRestantes: SINCRONIZANDO_TICKS,
  };
}

/** Tick mientras `fase === 'sin_senal'`: el avance interno sigue, la posición real se acumula
 * en `bufferPuntos`, la posición EXPUESTA (`lat`/`lng`) no cambia. Los cruces de punto de
 * control / cierre de vuelta que hubiera en este tramo (ítem 6) se detectan igual que en
 * `en_ruta` pero se acumulan en `eventosPendientes` — NO se devuelven como `eventos` de
 * `avanzarTrufi` (nada que aplicar todavía, sigue offline). */
export function avanzarSinSenal(
  trufi: EstadoTrufi,
  linea: LineaMock,
  paradasControl: ParadaControlActiva[],
  paso: number,
  nowMs: number,
  nowIso: string,
): EstadoTrufi {
  const anterior = trufi.avance;
  const nuevoAvance = (anterior + paso) % 1;
  const { lat, lng } = posicionEnPolilinea(linea.polilinea, nuevoAvance);
  const punto: PuntoTrazado = [lat, lng, nowMs];
  const eventos = detectarEventos(paradasControl, anterior, nuevoAvance, nowIso);
  return {
    ...trufi,
    avance: nuevoAvance,
    bufferPuntos: [...trufi.bufferPuntos, punto],
    eventosPendientes: [...trufi.eventosPendientes, ...eventos],
  };
}

/**
 * Tick mientras `fase === 'sincronizando'`: cuenta regresiva; al llegar a 0 vuelca el buffer a
 * `traza`, salta la posición expuesta a la real (según el avance acumulado), guarda
 * `ultimoTramoSincronizado` (ítem 15 — EXACTAMENTE los puntos que traía el buffer) y vuelve a
 * `en_ruta`. Devuelve `trufi.eventosPendientes` COMPLETO como `eventos` (y lo vacía en el
 * trufi) para que `estado/index.ts#tick` los reconcilie contra `recorridos`/`cumplimientos` con
 * EXACTAMENTE la misma lógica que usa para los eventos "en vivo" de `en_ruta`/`desviado`
 * (`registrarCumplimiento` por cada cumplimiento, `flota.ts#cerrarVuelta` por cada
 * `vuelta-completa`, en orden) — este archivo no conoce el slice `recorridos`, así que no
 * decide nada de eso acá, solo detecta/acumula y ahora reporta.
 */
export function avanzarSincronizando(
  trufi: EstadoTrufi,
  linea: LineaMock,
  nowIso: string,
): { trufi: EstadoTrufi; eventos: EventoTrufiTick[] } {
  const restantes = (trufi.sincronizandoTicksRestantes ?? 1) - 1;
  if (restantes > 0) {
    return { trufi: { ...trufi, sincronizandoTicksRestantes: restantes }, eventos: [] };
  }
  const { lat, lng } = posicionEnPolilinea(linea.polilinea, trufi.avance);
  const pendientes = trufi.eventosPendientes;
  return {
    trufi: {
      ...trufi,
      fase: 'en_ruta',
      lat,
      lng,
      traza: [...trufi.traza, ...trufi.bufferPuntos],
      ultimoTramoSincronizado: { puntos: trufi.bufferPuntos.map(([puntoLat, puntoLng]): [number, number] => [puntoLat, puntoLng]), en: nowIso },
      bufferPuntos: [],
      puntosPendientes: 0,
      sincronizandoTicksRestantes: undefined,
      ultimaSenalEn: nowIso,
      eventosPendientes: [],
    },
    eventos: pendientes,
  };
}
