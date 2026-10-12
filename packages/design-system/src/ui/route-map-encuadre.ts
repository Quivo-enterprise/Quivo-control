// Decisión pura de cuándo `RouteMap` debe encuadrar la cámara (`fitToBounds`). Vive aparte de
// `route-map-impl.tsx` (que arrastra maplibre) para poder testearse sin mapa.
//
// Contrato independiente del motor de mapas: el motor guarda el estado que devuelve cada función,
// lo pasa en la siguiente evaluación y encuadra solo cuando `encuadrar` es true. Lo reutilizará
// el futuro motor de Google Maps. Hay una función por modo (`fitMode='off'` nunca llama a ninguna).
// El llamador debe reiniciar el estado (`estadoEncuadre*Inicial`) cuando cambia el modo.

/** Memoria de `encuadreAuto`: firma de los puntos del último encuadre, o `null` si no hay. */
export interface EstadoEncuadreAuto {
  firma: string | null;
}

/** Memoria de `encuadreUnaVez`: `fitKey` vigente y si ya se encuadró para esa clave. */
export interface EstadoEncuadreUnaVez {
  fitKey: string | number | undefined;
  disparado: boolean;
}

export function estadoEncuadreAutoInicial(): EstadoEncuadreAuto {
  return { firma: null };
}

export function estadoEncuadreUnaVezInicial(
  fitKey: string | number | undefined,
): EstadoEncuadreUnaVez {
  return { fitKey, disparado: false };
}

/**
 * Modo 'auto': encuadra cada vez que cambia la firma de los puntos visibles (rutas + marcadores +
 * paradas + zonas) y hay puntos. Sin puntos no encuadra y olvida la firma, de modo que
 * A -> [] -> A vuelve a encuadrar. Devuelve el nuevo estado para que el llamador lo guarde.
 */
export function encuadreAuto({
  firma,
  hayPuntos,
  estado,
}: {
  firma: string;
  hayPuntos: boolean;
  estado: EstadoEncuadreAuto;
}): { encuadrar: boolean; estado: EstadoEncuadreAuto } {
  if (!hayPuntos) return { encuadrar: false, estado: { firma: null } };
  if (estado.firma === firma) return { encuadrar: false, estado };
  return { encuadrar: true, estado: { firma } };
}

/**
 * Modo 'once': encuadra una sola vez por `fitKey`, en cuanto existen puntos (la traza puede llegar
 * después de montar). Los cambios posteriores de marcadores NO reencuadran, así se respeta el
 * zoom/paneo del usuario; cambiar `fitKey` rearma el disparo. Devuelve el nuevo estado.
 */
export function encuadreUnaVez({
  fitKey,
  hayPuntos,
  estado,
}: {
  fitKey: string | number | undefined;
  hayPuntos: boolean;
  estado: EstadoEncuadreUnaVez;
}): { encuadrar: boolean; estado: EstadoEncuadreUnaVez } {
  const vigente = estado.fitKey === fitKey ? estado : { fitKey, disparado: false };
  if (vigente.disparado || !hayPuntos) return { encuadrar: false, estado: vigente };
  return { encuadrar: true, estado: { fitKey, disparado: true } };
}
