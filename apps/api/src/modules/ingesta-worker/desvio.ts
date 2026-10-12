import {
  DESVIO_MAX_ACCURACY_M,
  DESVIO_MIN_DURACION_MS,
  DESVIO_MIN_PUNTOS,
  DESVIO_MIN_PUNTOS_REGRESO,
  DESVIO_REGRESO_M,
  DESVIO_UMBRAL_M,
  type DetalleDesvio,
} from '@quivo/shared';

/**
 * Máquina de estados PURA de desvío de ruta (docs/plan-en-vivo-alertas.md, PR A). No toca la
 * base: el worker (`deteccion-infracciones.ts`) carga el estado previo de `sesion_desvio_estado`,
 * llama a `avanzarDesvio` con los puntos nuevos de la sesión (ya con su distancia a la ruta
 * calculada por PostGIS y el recorrido al que pertenecen) y aplica las acciones resultantes.
 *
 * Reglas:
 * - Solo se evalúan puntos DENTRO de un recorrido (`recorridoTs` = `inicio_recorrido` al que
 *   pertenecen). Un punto con `recorridoTs: null` (traslado en vacío, entre recorridos) NO mueve
 *   la máquina.
 * - Cambiar de recorrido (primer punto de otro recorrido, o el marcador `inicio`) cierra la
 *   infracción abierta (con el `ts` del último punto evaluado) y reinicia la racha. El marcador
 *   `fin` hace lo mismo y deja la máquina sin recorrido.
 * - Se IGNORAN los puntos con `accuracy` > `DESVIO_MAX_ACCURACY_M` (`accuracy` nula se acepta;
 *   ESTE es el único lugar donde se filtra por precisión) y los puntos con `ts <= ultimoTs`
 *   (tardíos del outbox móvil: no pueden mover la máquina hacia atrás — limitación documentada;
 *   una infracción cuyo tramo llegó tarde y desordenado puede no detectarse o cerrarse tarde).
 * - Se ABRE cuando hay >= `DESVIO_MIN_PUNTOS` puntos consecutivos con distancia >
 *   `DESVIO_UMBRAL_M` abarcando >= `DESVIO_MIN_DURACION_MS` entre el primero y el actual. Un
 *   punto a <= `DESVIO_UMBRAL_M` antes de abrir reinicia la racha.
 * - Con la infracción abierta se sigue el máximo de distancia; se CIERRA tras
 *   `DESVIO_MIN_PUNTOS_REGRESO` puntos consecutivos a < `DESVIO_REGRESO_M` (histéresis: entre
 *   60 y 100 m la infracción sigue abierta). `finTs` = ts del punto que confirma el regreso.
 */

export interface PuntoDesvio {
  ts: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  /** Distancia en metros del punto a la geometría de la ruta (`ST_Distance`). */
  distanciaM: number;
  /** `inicioTs` del recorrido al que pertenece el punto; `null` = fuera de recorrido. */
  recorridoTs: Date | null;
}

/** Límite de recorrido de ESTE lote: `inicio_recorrido` o `fin_recorrido` (con su recorrido). */
export interface MarcadorDesvio {
  tipo: 'inicio' | 'fin';
  ts: Date;
  /** `inicioTs` del recorrido que abre / cierra. */
  recorridoTs: Date;
}

export interface EstadoDesvio {
  /** Inicio de la racha fuera de ruta (candidata, o la de la infracción abierta). */
  fueraDesdeTs: Date | null;
  puntosFuera: number;
  dentroConsecutivos: number;
  ultimoTs: Date | null;
  /** `true` mientras hay una infracción de desvío abierta. */
  abierta: boolean;
  distanciaMaxM: number;
  latInicio: number | null;
  lngInicio: number | null;
  /** Recorrido (`inicioTs`) al que pertenece la racha actual; `null` = ninguno. */
  recorridoTs: Date | null;
}

export type AccionDesvio =
  | { tipo: 'abrir'; inicioTs: Date; lat: number; lng: number; detalle: DetalleDesvio }
  | { tipo: 'actualizar'; detalle: DetalleDesvio }
  | { tipo: 'cerrar'; finTs: Date; detalle: DetalleDesvio };

export const ESTADO_DESVIO_INICIAL: EstadoDesvio = {
  fueraDesdeTs: null,
  puntosFuera: 0,
  dentroConsecutivos: 0,
  ultimoTs: null,
  abierta: false,
  distanciaMaxM: 0,
  latInicio: null,
  lngInicio: null,
  recorridoTs: null,
};

function detalleDe(estado: EstadoDesvio, hastaTs: Date): DetalleDesvio {
  const desde = estado.fueraDesdeTs?.getTime() ?? hastaTs.getTime();
  return {
    distanciaMaxM: Math.round(estado.distanciaMaxM),
    duracionS: Math.max(0, Math.round((hastaTs.getTime() - desde) / 1000)),
    puntos: estado.puntosFuera,
  };
}

type Entrada =
  | { clase: 'punto'; ts: Date; punto: PuntoDesvio }
  | { clase: 'marcador'; ts: Date; marcador: MarcadorDesvio };

const PRIORIDAD = { inicio: 0, punto: 1, fin: 2 } as const;
const prioridadDe = (e: Entrada) => (e.clase === 'punto' ? PRIORIDAD.punto : PRIORIDAD[e.marcador.tipo]);

export function avanzarDesvio(
  previo: EstadoDesvio,
  puntos: readonly PuntoDesvio[],
  marcadores: readonly MarcadorDesvio[] = [],
): { estado: EstadoDesvio; acciones: AccionDesvio[] } {
  let estado: EstadoDesvio = { ...previo };
  const acciones: AccionDesvio[] = [];
  // Hay cambio de detalle pendiente de publicar (infracción abierta y llegaron puntos fuera).
  let detallePendiente = false;
  let ultimoTsAbierta: Date | null = null;

  /** Cierra la infracción abierta (si la hay) en `finTs` y reinicia la racha en `recorridoTs`,
   * conservando `ultimoTs` (la guarda de puntos tardíos no se reinicia). */
  const cerrarYReiniciar = (finTs: Date, recorridoTs: Date | null) => {
    if (estado.abierta) {
      acciones.push({ tipo: 'cerrar', finTs, detalle: detalleDe(estado, finTs) });
      detallePendiente = false;
      ultimoTsAbierta = null;
    }
    estado = { ...ESTADO_DESVIO_INICIAL, ultimoTs: estado.ultimoTs, recorridoTs };
  };
  const mismoRecorrido = (a: Date | null, b: Date | null) => a?.getTime() === b?.getTime();

  const entradas: Entrada[] = [
    ...puntos.map((punto): Entrada => ({ clase: 'punto', ts: punto.ts, punto })),
    ...marcadores.map((marcador): Entrada => ({ clase: 'marcador', ts: marcador.ts, marcador })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime() || prioridadDe(a) - prioridadDe(b));

  for (const entrada of entradas) {
    if (entrada.clase === 'marcador') {
      const { tipo, ts, recorridoTs } = entrada.marcador;
      const finTs = estado.ultimoTs ?? ts;
      if (tipo === 'inicio') {
        if (!mismoRecorrido(estado.recorridoTs, recorridoTs)) cerrarYReiniciar(finTs, recorridoTs);
      } else if (mismoRecorrido(estado.recorridoTs, recorridoTs)) {
        // Fin del recorrido en curso: cierra lo abierto y deja la máquina sin recorrido.
        cerrarYReiniciar(finTs, null);
      }
      continue;
    }

    const punto = entrada.punto;
    if (punto.recorridoTs === null) continue;
    if (punto.accuracy !== null && punto.accuracy > DESVIO_MAX_ACCURACY_M) continue;
    if (estado.ultimoTs && punto.ts.getTime() <= estado.ultimoTs.getTime()) continue;
    if (!mismoRecorrido(estado.recorridoTs, punto.recorridoTs)) {
      cerrarYReiniciar(estado.ultimoTs ?? punto.ts, punto.recorridoTs);
    }
    estado.ultimoTs = punto.ts;

    if (!estado.abierta) {
      if (punto.distanciaM > DESVIO_UMBRAL_M) {
        if (estado.puntosFuera === 0) {
          estado.fueraDesdeTs = punto.ts;
          estado.latInicio = punto.lat;
          estado.lngInicio = punto.lng;
          estado.distanciaMaxM = 0;
        }
        estado.puntosFuera += 1;
        estado.distanciaMaxM = Math.max(estado.distanciaMaxM, punto.distanciaM);
        const duracionMs = punto.ts.getTime() - (estado.fueraDesdeTs?.getTime() ?? punto.ts.getTime());
        if (estado.puntosFuera >= DESVIO_MIN_PUNTOS && duracionMs >= DESVIO_MIN_DURACION_MS) {
          estado.abierta = true;
          estado.dentroConsecutivos = 0;
          acciones.push({
            tipo: 'abrir',
            inicioTs: estado.fueraDesdeTs ?? punto.ts,
            lat: estado.latInicio ?? punto.lat,
            lng: estado.lngInicio ?? punto.lng,
            detalle: detalleDe(estado, punto.ts),
          });
          detallePendiente = false;
          ultimoTsAbierta = punto.ts;
        }
      } else {
        estado = { ...estado, fueraDesdeTs: null, puntosFuera: 0, distanciaMaxM: 0, latInicio: null, lngInicio: null };
      }
      continue;
    }

    // Infracción abierta.
    if (punto.distanciaM < DESVIO_REGRESO_M) {
      estado.dentroConsecutivos += 1;
      if (estado.dentroConsecutivos >= DESVIO_MIN_PUNTOS_REGRESO) {
        acciones.push({ tipo: 'cerrar', finTs: punto.ts, detalle: detalleDe(estado, punto.ts) });
        detallePendiente = false;
        ultimoTsAbierta = null;
        estado = {
          ...ESTADO_DESVIO_INICIAL,
          ultimoTs: punto.ts,
          recorridoTs: estado.recorridoTs,
        };
      }
    } else {
      estado.dentroConsecutivos = 0;
      estado.puntosFuera += 1;
      estado.distanciaMaxM = Math.max(estado.distanciaMaxM, punto.distanciaM);
      detallePendiente = true;
      ultimoTsAbierta = punto.ts;
    }
  }

  if (detallePendiente && estado.abierta && ultimoTsAbierta) {
    acciones.push({ tipo: 'actualizar', detalle: detalleDe(estado, ultimoTsAbierta) });
  }
  return { estado, acciones };
}
