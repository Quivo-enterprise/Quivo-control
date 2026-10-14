/**
 * Sugerencia de envíos a Molinos (docs/plan-molinos-designacion.md, "Sugerencia"). Todos los
 * móviles de la línea suben una vez por día: para repartirlo en la jornada el intervalo objetivo
 * entre envíos es la ventana diurna dividida por la flota activa (≈ cada 5 min con 125 móviles).
 * Constantes por ahora; configurables por línea en F2.
 */

/** Ventana de servicio diurna sobre la que se reparten los envíos (horas). */
export const MOLINOS_VENTANA_DIURNA_H = 10;
/** Piso del intervalo objetivo (ms): con muy pocos móviles activos no se sugiere "ya" a cada rato. */
export const MOLINOS_INTERVALO_MIN_MS = 60_000;

export interface SugerenciaMolinosEntrada {
  /** Sesiones activas de la línea con recorrido no finalizado. */
  flotaActiva: number;
  /** Último envío designado hoy en la línea; `null` si todavía no hubo. */
  ultimoEnvioTs: Date | null;
  ahora: Date;
}

export interface SugerenciaMolinos {
  intervaloObjetivoMs: number;
  /** Instante a partir del cual toca enviar el próximo (`ahora` si no hubo envíos hoy). */
  proximoSugeridoEn: Date;
}

/** Intervalo objetivo: ventana diurna / flota activa (>= 1), con piso de `MOLINOS_INTERVALO_MIN_MS`. */
export function intervaloObjetivoMolinosMs(flotaActiva: number): number {
  const flota = Math.max(1, Math.floor(Number.isFinite(flotaActiva) ? flotaActiva : 1));
  const ms = Math.round((MOLINOS_VENTANA_DIURNA_H * 3_600_000) / flota);
  return Math.max(MOLINOS_INTERVALO_MIN_MS, ms);
}

export function calcularSugerenciaMolinos(entrada: SugerenciaMolinosEntrada): SugerenciaMolinos {
  const intervaloObjetivoMs = intervaloObjetivoMolinosMs(entrada.flotaActiva);
  const proximoSugeridoEn = entrada.ultimoEnvioTs
    ? new Date(entrada.ultimoEnvioTs.getTime() + intervaloObjetivoMs)
    : entrada.ahora;
  return { intervaloObjetivoMs, proximoSugeridoEn };
}
