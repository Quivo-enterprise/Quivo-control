import {
  partirCircuitoPorRetorno,
  type CircuitoPartido,
  type FaseCircuito,
  type PuntoControlPaquete,
} from '@quivo/shared';

/**
 * Fase de la vuelta del circuito cerrado (línea 16): `ida` hasta pasar el PC `retorno` (Honduras) y
 * `regreso` desde ahí hasta cerrar en la terminal. Ida y regreso comparten calles, así que el
 * chofer solo ve (y solo se le detectan/anuncian) los PC y el trazado de SU fase. Módulo PURO.
 * Solo hay fases si la ruta tiene un PC con `rol === 'retorno'`; sin él todo vale como siempre.
 */
export type FaseVuelta = FaseCircuito;

/** Fallback si el GPS no captura el retorno: fixes consecutivos que hacen falta para pasar a regreso. */
export const FIXES_FALLBACK_REGRESO = 3;
/** Fallback: distancia mínima (m) a la mitad de ida para considerar que el vehículo ya no va por ella. */
export const DISTANCIA_FUERA_IDA_M = 60;
/** Fallback: distancia máxima (m) a la mitad de regreso para considerar que va por ella. */
export const DISTANCIA_SOBRE_REGRESO_M = 30;

/** Fase persistida del progreso; sin dato (estado viejo o vuelta recién empezada) es `ida`. */
export function faseDe(estado: { fase?: FaseVuelta }): FaseVuelta {
  return estado.fase ?? 'ida';
}

export function puntoRetorno(puntos: readonly PuntoControlPaquete[]): PuntoControlPaquete | undefined {
  return puntos.find((p) => p.rol === 'retorno');
}

/**
 * Predicado de pertenencia a la fase (derivado del orden de viaje): terminal en ambas; ida =
 * `orden < retorno.orden` más el propio retorno (cierra la ida); regreso = `orden > retorno.orden`;
 * el PC de espera (Molinos, que en datos viejos tiene `orden` menor al retorno) es del regreso.
 * `fase === null` o ruta sin retorno: todos pertenecen. La terminal es el PC `rol === 'terminal'`
 * o, en datos viejos sin ese rol, el de menor `orden` (Salomón Romero).
 */
export function crearFiltroFase(
  puntos: readonly PuntoControlPaquete[],
  fase: FaseVuelta | null,
): (p: PuntoControlPaquete) => boolean {
  const retorno = puntoRetorno(puntos);
  if (fase === null || !retorno) return () => true;
  const hayTerminal = puntos.some((p) => p.rol === 'terminal');
  const primero = puntos.reduce((a, b) => (b.orden < a.orden ? b : a));
  return (p) => {
    if (p.rol === 'terminal' || (!hayTerminal && p.id === primero.id)) return true;
    if (p.id === retorno.id) return fase === 'ida';
    if (p.rol === 'espera') return fase === 'regreso';
    return fase === 'ida' ? p.orden < retorno.orden : p.orden > retorno.orden;
  };
}

export function puntosDeFase(
  puntos: readonly PuntoControlPaquete[],
  fase: FaseVuelta | null,
): PuntoControlPaquete[] {
  return puntos.filter(crearFiltroFase(puntos, fase));
}

/** Firma barata de contenido de la geometría (cantidad + hash de las coordenadas). */
export function firmaGeometria(coordenadas: ReadonlyArray<ReadonlyArray<number>>): string {
  let hash = 0;
  for (const c of coordenadas) {
    hash = (Math.imul(hash, 31) + Math.round((c[0] ?? 0) * 1e6)) | 0;
    hash = (Math.imul(hash, 31) + Math.round((c[1] ?? 0) * 1e6)) | 0;
  }
  return `${coordenadas.length}:${hash}`;
}

let cacheMitades: { firma: string; mitades: CircuitoPartido | null } | null = null;

/**
 * Mitades ida/regreso del circuito cortado por el PC retorno (`partirCircuitoPorRetorno`).
 * Memoizado por contenido (una sola entrada): se llama en cada fix. `null` sin retorno o si el
 * circuito no pasa cerca de él (entonces se usa el circuito completo, como siempre).
 */
export function mitadesDelCircuito(
  geometria: readonly [number, number][],
  puntos: readonly PuntoControlPaquete[],
): CircuitoPartido | null {
  const retorno = puntoRetorno(puntos);
  if (!retorno || geometria.length < 2) return null;
  const [lng, lat] = retorno.coord.coordinates;
  const firma = `${firmaGeometria(geometria)}|${lng},${lat}`;
  if (cacheMitades?.firma !== firma) {
    cacheMitades = { firma, mitades: partirCircuitoPorRetorno(geometria, [lng, lat]) };
  }
  return cacheMitades.mitades;
}

/**
 * Fallback de fase por geometría (el GPS pudo no capturar Honduras ni la terminal), simétrico: en
 * `ida` pasa a `regreso` tras `FIXES_FALLBACK_REGRESO` fixes consecutivos a más de
 * `DISTANCIA_FUERA_IDA_M` de la mitad de ida y a menos de `DISTANCIA_SOBRE_REGRESO_M` de la de
 * regreso; en `regreso` pasa a `ida` con la condición inversa (también corrige un cambio erróneo
 * por un desvío). Cualquier otro fix reinicia el contador (`fixesRegreso`, que cuenta hacia la fase
 * contraria); un fix impreciso (`accuracy` > radio de regreso) no cuenta ni reinicia. Devuelve el
 * MISMO objeto si no hay nada que cambiar (evita escrituras a SQLite en cada fix).
 */
export function evaluarFixFase<T extends { fase?: FaseVuelta; fixesRegreso?: number }>(
  estado: T,
  distanciaIdaM: number,
  distanciaRegresoM: number,
  accuracyM?: number | null,
): T {
  if (typeof accuracyM === 'number' && accuracyM > DISTANCIA_SOBRE_REGRESO_M) return estado;
  const fase = faseDe(estado);
  const cumple =
    fase === 'ida'
      ? distanciaIdaM > DISTANCIA_FUERA_IDA_M && distanciaRegresoM < DISTANCIA_SOBRE_REGRESO_M
      : distanciaRegresoM > DISTANCIA_FUERA_IDA_M && distanciaIdaM < DISTANCIA_SOBRE_REGRESO_M;
  const previos = estado.fixesRegreso ?? 0;
  if (!cumple) return previos === 0 ? estado : { ...estado, fixesRegreso: 0 };
  if (previos + 1 >= FIXES_FALLBACK_REGRESO) {
    return { ...estado, fase: fase === 'ida' ? 'regreso' : 'ida', fixesRegreso: 0 };
  }
  return { ...estado, fixesRegreso: previos + 1 };
}
