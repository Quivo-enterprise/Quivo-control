import { useEffect, useRef } from 'react';
import { INTERVALO_POLL_POSICIONES_MS } from './use-en-vivo';
import { useReloj } from './use-reloj';

export type SaludRefresco = { estado: 'ok' | 'lento' | 'sin_conexion'; segundos: number };

/** Segundos sin datos nuevos a partir de los cuales el refresco se considera lento: 3 polls. */
const FACTOR_LENTO = 3;

type Consulta = { dataUpdatedAt: number; isError: boolean };

/**
 * Núcleo puro. `segundos` = ahora - max(último dato, momento en que la pestaña volvió a ser visible):
 * el navegador pausa el poll en segundo plano, así que volver a la pestaña no es "lento", pero un
 * refetch colgado o reintentando con la pestaña visible sí. Un error manda. `dataUpdatedAt` = 0
 * (todavía sin datos) cuenta como `ok`: la carga inicial no es una falla.
 */
export function saludRefresco(
  q: Consulta,
  ahoraMs: number,
  intervaloMs: number = INTERVALO_POLL_POSICIONES_MS,
  visibleDesdeMs: number = 0,
): SaludRefresco {
  const base = Math.max(q.dataUpdatedAt, visibleDesdeMs);
  const segundos = q.dataUpdatedAt ? Math.max(0, Math.floor((ahoraMs - base) / 1000)) : 0;
  if (q.isError) return { estado: 'sin_conexion', segundos };
  return { estado: segundos * 1000 > FACTOR_LENTO * intervaloMs ? 'lento' : 'ok', segundos };
}

/** Salud del refresco de `usePosicionesEnVivo`. Re-renderiza cada segundo: usarlo solo en una hoja (barra de mando). */
export function useSaludRefresco(q: Consulta): SaludRefresco {
  const ahora = useReloj(1000);
  const visibleDesde = useRef(Date.now());
  useEffect(() => {
    const alCambiar = () => {
      if (document.visibilityState === 'visible') visibleDesde.current = Date.now();
    };
    document.addEventListener('visibilitychange', alCambiar);
    return () => document.removeEventListener('visibilitychange', alCambiar);
  }, []);
  return saludRefresco(q, ahora, INTERVALO_POLL_POSICIONES_MS, visibleDesde.current);
}
