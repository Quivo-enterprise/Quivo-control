// Decisión pura de cuándo `RouteMap` debe encuadrar la cámara (`fitToBounds`). Vive aparte de
// `route-map-impl.tsx` (que arrastra maplibre) para poder testearse sin mapa.

export type ModoEncuadre = 'auto' | 'once';

/** Memoria entre evaluaciones. `firma` la usa 'auto'; `fitKey`/`disparado`, 'once'. */
export interface EstadoEncuadre {
  fitKey: string | number | undefined;
  disparado: boolean;
  firma: string | null;
}

export interface EntradaEncuadre {
  modo: ModoEncuadre;
  /** Firma de los puntos visibles (rutas + marcadores + paradas + zonas). */
  firma: string;
  hayPuntos: boolean;
  fitKey: string | number | undefined;
  estado: EstadoEncuadre;
}

export function estadoEncuadreInicial(fitKey: string | number | undefined): EstadoEncuadre {
  return { fitKey, disparado: false, firma: null };
}

/**
 * - 'auto': encuadra cada vez que cambia la firma de los puntos (y hay puntos).
 * - 'once': encuadra una sola vez por `fitKey`, en cuanto existen puntos; cambios posteriores
 *   de marcadores NO reencuadran (respeta el zoom/paneo del usuario).
 * Devuelve el nuevo estado para que el llamador lo guarde.
 */
export function debeEncuadrar({ modo, firma, hayPuntos, fitKey, estado }: EntradaEncuadre): {
  encuadrar: boolean;
  estado: EstadoEncuadre;
} {
  if (modo === 'auto') {
    if (!hayPuntos || estado.firma === firma) return { encuadrar: false, estado };
    return { encuadrar: true, estado: { ...estado, firma } };
  }
  const vigente = estado.fitKey === fitKey ? estado : { ...estado, fitKey, disparado: false };
  if (vigente.disparado || !hayPuntos) return { encuadrar: false, estado: vigente };
  return { encuadrar: true, estado: { ...vigente, disparado: true } };
}
