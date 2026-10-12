import { haversineMetros, type PuntoControlPaquete } from '@quivo/shared';

/**
 * Progreso de la VUELTA en curso (RF-GPS-054): los puntos de control se marcan en CUALQUIER orden
 * apenas se pasan; pasarlos todos NO es obligatorio (informativo para el chofer — un punto sin
 * pasar queda "omitido", en rojo); y una vuelta se cuenta cuando el vehículo vuelve al punto
 * donde EMPEZÓ (el primero pasado de la vuelta). Módulo PURO y sin dependencias nativas (mismo
 * criterio que `sync-diff.ts`): el almacenamiento vive en `progreso-vuelta-store.ts`.
 */

/** Máximo de claves de idempotencia que se recuerdan (las más recientes). */
const MAX_PROCESADOS = 200;

export interface EstadoProgresoVuelta {
  sesionId: string;
  vueltasCompletadas: number;
  /** Punto donde arrancó la vuelta (el primero pasado); `null` hasta el primer paso. */
  inicioId: string | null;
  /** Ids ya pasados en la vuelta actual (incluye `inicioId`). */
  pasados: string[];
  ultimoId: string | null;
  /** Resumen de la última vuelta cerrada (para el aviso "Vuelta N completada"). */
  ultimaVueltaResumen: { numero: number; pasados: number; total: number } | null;
  /** Claves de idempotencia ya aplicadas (acotado a las últimas `MAX_PROCESADOS`). */
  procesados: string[];
}

export type EstadoPuntoVuelta = 'pasado' | 'omitido' | 'proximo' | 'pendiente';

export interface PuntoProgreso {
  punto: PuntoControlPaquete;
  estado: EstadoPuntoVuelta;
}

export interface ProgresoDerivado {
  /** Puntos en orden ROTADO (el de inicio primero); sin inicio, por `orden`. */
  puntos: PuntoProgreso[];
  proximo: PuntoControlPaquete | null;
  /** Vuelta que se está haciendo ("Vuelta N"). */
  vueltaActual: number;
  pasados: number;
  omitidos: number;
  total: number;
}

export function estadoInicialVuelta(sesionId: string): EstadoProgresoVuelta {
  return {
    sesionId,
    vueltasCompletadas: 0,
    inicioId: null,
    pasados: [],
    ultimoId: null,
    ultimaVueltaResumen: null,
    procesados: [],
  };
}

/**
 * Aplica el paso por un punto. Idempotente por `clave` (el `eventId` del cumplimiento, o
 * `${puntoId}:${pasada}`): el mismo paso llegado dos veces (foreground + headless, reintentos) no
 * cuenta dos veces.
 */
export function pasoPunto(
  estado: EstadoProgresoVuelta,
  paso: { puntoId: string; clave: string },
  totalPuntos: number,
): EstadoProgresoVuelta {
  if (estado.procesados.includes(paso.clave)) return estado;
  const procesados = [...estado.procesados, paso.clave].slice(-MAX_PROCESADOS);
  const base = { ...estado, procesados, ultimoId: paso.puntoId };

  if (estado.inicioId === null) {
    return { ...base, inicioId: paso.puntoId, pasados: [paso.puntoId] };
  }
  // Vuelta al punto de inicio habiendo pasado algo más que él mismo: cierra la vuelta y la nueva
  // arranca con ese punto ya pasado. Con solo el inicio pasado (rebote/jitter), no es una vuelta.
  if (paso.puntoId === estado.inicioId && estado.pasados.length > 1) {
    const numero = estado.vueltasCompletadas + 1;
    return {
      ...base,
      vueltasCompletadas: numero,
      ultimaVueltaResumen: { numero, pasados: estado.pasados.length, total: totalPuntos },
      pasados: [paso.puntoId],
    };
  }
  if (estado.pasados.includes(paso.puntoId)) return base;
  return { ...base, pasados: [...estado.pasados, paso.puntoId] };
}

/**
 * Deriva el estado de cada punto. En orden rotado (inicio primero): `omitido` = sin pasar y
 * anterior al más lejano pasado; `proximo` = primer sin pasar después de ese más lejano (si no
 * queda ninguno, el propio punto de inicio, para cerrar la vuelta). Sin inicio todavía: todo
 * `pendiente` salvo el próximo, que es el más cercano a `posicion` (o el de menor `orden` sin
 * posición).
 */
export function derivarProgreso(
  estado: EstadoProgresoVuelta,
  puntosControl: readonly PuntoControlPaquete[],
  posicion: { lat: number; lng: number } | null,
): ProgresoDerivado {
  const ordenados = [...puntosControl].sort((a, b) => a.orden - b.orden);
  const total = ordenados.length;
  const vueltaActual = estado.vueltasCompletadas + 1;
  const idxInicio =
    estado.inicioId === null ? -1 : ordenados.findIndex((p) => p.id === estado.inicioId);

  if (idxInicio < 0) {
    let proximo: PuntoControlPaquete | null = ordenados[0] ?? null;
    if (posicion) {
      let mejor = Infinity;
      for (const p of ordenados) {
        const d = haversineMetros([posicion.lng, posicion.lat], p.coord.coordinates);
        if (d < mejor) {
          mejor = d;
          proximo = p;
        }
      }
    }
    return {
      puntos: ordenados.map((punto) => ({
        punto,
        estado: punto.id === proximo?.id ? 'proximo' : 'pendiente',
      })),
      proximo,
      vueltaActual,
      pasados: 0,
      omitidos: 0,
      total,
    };
  }

  const rotados = [...ordenados.slice(idxInicio), ...ordenados.slice(0, idxInicio)];
  const pasadosSet = new Set(estado.pasados);
  let maxPasado = 0;
  rotados.forEach((p, i) => {
    if (pasadosSet.has(p.id)) maxPasado = i;
  });
  let idxProximo = rotados.findIndex((p, i) => i > maxPasado && !pasadosSet.has(p.id));
  if (idxProximo < 0) idxProximo = 0; // nada pendiente adelante: volver al inicio cierra la vuelta.

  let pasados = 0;
  let omitidos = 0;
  const puntos = rotados.map((punto, i): PuntoProgreso => {
    const paso = pasadosSet.has(punto.id);
    if (paso) pasados += 1;
    if (i === idxProximo) return { punto, estado: 'proximo' };
    if (paso) return { punto, estado: 'pasado' };
    if (i < maxPasado) {
      omitidos += 1;
      return { punto, estado: 'omitido' };
    }
    return { punto, estado: 'pendiente' };
  });
  return { puntos, proximo: rotados[idxProximo] ?? null, vueltaActual, pasados, omitidos, total };
}
