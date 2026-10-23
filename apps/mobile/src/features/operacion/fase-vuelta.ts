import {
  deltaAnguloCorto,
  haversineMetros,
  partirCircuitoPorRetorno,
  prepararRutaSnap,
  segmentoMasCercano,
  type CircuitoPartido,
  type FaseCircuito,
  type PuntoControlPaquete,
  type RutaSnap,
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

/** Fallback: diferencia máxima (°) entre el rumbo del vehículo y el de la mitad candidata para contar el fix. */
export const TOLERANCIA_SENTIDO_FASE_GRADOS = 60;
/** Radio (m) del PC retorno dentro del cual, ya pasado, no se vuelve a ida: el flip residual justo tras Honduras (la ida se extiende más allá). */
export const RADIO_CANDADO_RETORNO_M = 1500;
/** Compuerta de PC: diferencia (°) por encima de la cual el vehículo va en contra del sentido del PC. */
export const SENTIDO_OPUESTO_PC_GRADOS = 90;

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

interface RutasCircuito {
  mitades: CircuitoPartido | null;
  rutaIda: RutaSnap | null;
  rutaRegreso: RutaSnap | null;
  /** Rumbo del trazado (bearing del segmento más cercano de SU mitad) en cada PC sujeto a la compuerta. */
  rumboPc: ReadonlyMap<string, number>;
}

/** Candado regreso→ida: retorno ya pasado Y el fix aún cerca de él (`RADIO_CANDADO_RETORNO_M`). */
export function retornoBloqueaIda(
  retornoPasado: boolean,
  posicion: [number, number],
  retorno: PuntoControlPaquete,
): boolean {
  return retornoPasado && haversineMetros(posicion, retorno.coord.coordinates) <= RADIO_CANDADO_RETORNO_M;
}

let cacheRutas: { firma: string; rutas: RutasCircuito } | null = null;

/**
 * Rumbos del trazado por mitad y por PC, memoizados por contenido igual que `mitadesDelCircuito`
 * (una sola vez por paquete, no por fix). Cada PC se mide sobre la mitad a la que pertenece según
 * `crearFiltroFase` (retorno en la ida); terminal, retorno (Honduras: el rumbo se invierte ahí) y espera
 * (Molinos) quedan fuera: no tienen un sentido propio. Sin retorno o sin mitades, todo `null`/vacío.
 */
export function rutasDelCircuito(
  geometria: readonly [number, number][],
  puntos: readonly PuntoControlPaquete[],
): RutasCircuito {
  const mitades = mitadesDelCircuito(geometria, puntos);
  const firma = `${firmaGeometria(geometria)}|${puntos.map((p) => `${p.id}:${p.orden}:${p.rol}:${p.coord.coordinates}`).join(',')}`;
  if (cacheRutas?.firma !== firma) {
    const aRuta = (c: readonly [number, number][]) => prepararRutaSnap(c.map(([lng, lat]) => ({ lat, lng })));
    const rutaIda = mitades ? aRuta(mitades.ida) : null;
    const rutaRegreso = mitades ? aRuta(mitades.regreso) : null;
    const rumboPc = new Map<string, number>();
    if (rutaIda && rutaRegreso) {
      const enIda = crearFiltroFase(puntos, 'ida');
      const enRegreso = crearFiltroFase(puntos, 'regreso');
      for (const p of puntos) {
        if (p.rol === 'terminal' || p.rol === 'retorno' || p.rol === 'espera' || (enIda(p) && enRegreso(p))) continue;
        const [lng, lat] = p.coord.coordinates;
        const rumbo = segmentoMasCercano(enIda(p) ? rutaIda : rutaRegreso, lat, lng)?.rumbo;
        if (rumbo !== undefined) rumboPc.set(p.id, rumbo);
      }
    }
    cacheRutas = { firma, rutas: { mitades, rutaIda, rutaRegreso, rumboPc } };
  }
  return cacheRutas.rutas;
}

/**
 * Compuerta de sentido: con rumbo confiable (`rumbo !== null`), descarta los PC cuyo trazado corre
 * en contra (> `SENTIDO_OPUESTO_PC_GRADOS`) del movimiento. Sin rumbo (lento/desconocido) devuelve
 * `puntos` tal cual. Los PC sin rumbo de trazado (terminal, retorno, espera) nunca se descartan.
 */
export function filtrarPorSentido(
  puntos: PuntoControlPaquete[],
  rumboPc: ReadonlyMap<string, number>,
  rumbo: number | null,
): PuntoControlPaquete[] {
  if (rumbo === null || rumboPc.size === 0) return puntos;
  return puntos.filter((p) => {
    const rumboTrazado = rumboPc.get(p.id);
    return rumboTrazado === undefined || Math.abs(deltaAnguloCorto(rumboTrazado, rumbo)) <= SENTIDO_OPUESTO_PC_GRADOS;
  });
}

/** Sentido de marcha del fix frente al trazado: `rumbo` confiable del vehículo y rumbo de cada mitad en su posición. */
export interface SentidoFix {
  rumbo: number | null;
  rumboIda: number | null;
  rumboRegreso: number | null;
}

/**
 * Fallback de fase por geometría (el GPS pudo no capturar Honduras ni la terminal), simétrico: en
 * `ida` pasa a `regreso` tras `FIXES_FALLBACK_REGRESO` fixes consecutivos a más de
 * `DISTANCIA_FUERA_IDA_M` de la mitad de ida y a menos de `DISTANCIA_SOBRE_REGRESO_M` de la de
 * regreso; en `regreso` pasa a `ida` con la condición inversa (también corrige un cambio erróneo
 * por un desvío). Además el fix solo cuenta si hay rumbo confiable del vehículo y coincide
 * (≤ `TOLERANCIA_SENTIDO_FASE_GRADOS`) con el de la mitad candidata: en calles compartidas las dos
 * mitades están a < 30 m pero corren en sentido contrario, y un trazado que difiere de la calle real
 * no debe invertir la fase (piloto 22/10). No se compara con la mitad actual: a > 60 m su segmento
 * más cercano no dice nada del sentido. Un fix sin rumbo confiable (lento / sin heading) ni cuenta ni reinicia, como uno
 * impreciso; cualquier otro fix que no califica reinicia el contador (`fixesRegreso`, que cuenta hacia la fase contraria). Con `retornoPasado` (retorno pasado Y fix cerca de él,
 * ver `retornoBloqueaIda`) NO vuelve de regreso a ida: la mitad de ida se extiende más allá de
 * Honduras y el vehículo sigue en su sentido ahí (22/10). Lejos de él, o antes del retorno, el
 * fallback sigue siendo la recuperación de un PC perdido. Un fix impreciso (`accuracy` > radio
 * de regreso) no cuenta ni reinicia. Devuelve el MISMO objeto si no hay nada que cambiar (evita
 * escrituras a SQLite en cada fix).
 */
export function evaluarFixFase<T extends { fase?: FaseVuelta; fixesRegreso?: number }>(
  estado: T,
  distanciaIdaM: number,
  distanciaRegresoM: number,
  accuracyM: number | null | undefined,
  sentido: SentidoFix,
  retornoPasado = false,
): T {
  if (typeof accuracyM === 'number' && accuracyM > DISTANCIA_SOBRE_REGRESO_M) return estado;
  const fase = faseDe(estado);
  if (fase === 'regreso' && retornoPasado) return estado;
  if (sentido.rumbo === null) return estado;
  const rumboCandidata = fase === 'ida' ? sentido.rumboRegreso : sentido.rumboIda;
  const cumple =
    (fase === 'ida'
      ? distanciaIdaM > DISTANCIA_FUERA_IDA_M && distanciaRegresoM < DISTANCIA_SOBRE_REGRESO_M
      : distanciaRegresoM > DISTANCIA_FUERA_IDA_M && distanciaIdaM < DISTANCIA_SOBRE_REGRESO_M) &&
    rumboCandidata !== null &&
    Math.abs(deltaAnguloCorto(rumboCandidata, sentido.rumbo)) <= TOLERANCIA_SENTIDO_FASE_GRADOS;
  const previos = estado.fixesRegreso ?? 0;
  if (!cumple) return previos === 0 ? estado : { ...estado, fixesRegreso: 0 };
  if (previos + 1 >= FIXES_FALLBACK_REGRESO) {
    return { ...estado, fase: fase === 'ida' ? 'regreso' : 'ida', fixesRegreso: 0 };
  }
  return { ...estado, fixesRegreso: previos + 1 };
}
