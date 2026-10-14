import { haversineMetros, type PuntoControlPaquete } from '@quivo/shared';

/**
 * Progreso de la VUELTA en curso (RF-GPS-054): los puntos de control se marcan en CUALQUIER orden
 * apenas se pasan; pasarlos todos NO es obligatorio (informativo para el chofer — un punto sin
 * pasar queda "omitido", en rojo); y una vuelta se cuenta cuando el vehículo vuelve al punto
 * donde EMPEZÓ (el primero pasado de la vuelta). Módulo PURO y sin dependencias nativas (mismo
 * criterio que `sync-diff.ts`): el almacenamiento vive en `progreso-vuelta-store.ts`.
 *
 * Clave del progreso: `sesionId` + fecha LOCAL del dispositivo. `sesionId` es la sesión de LOGIN
 * (puede abarcar varios días; no es el recorrido), así que el conteo de vueltas es por día.
 */

/** Máximo de claves de idempotencia que se recuerdan (las más recientes). */
const MAX_PROCESADOS = 200;

export interface EstadoProgresoVuelta {
  sesionId: string;
  /** Fecha local `YYYY-MM-DD` del dispositivo a la que pertenece el conteo. */
  fecha: string;
  /** Contador monótono: lo incrementa el almacén en cada escritura (descarta lecturas viejas). */
  version: number;
  vueltasCompletadas: number;
  /** Punto donde arrancó la vuelta (el primero pasado); `null` hasta el primer paso. */
  inicioId: string | null;
  /** Ids ya pasados en la vuelta actual (incluye `inicioId`). */
  pasados: string[];
  /** Último punto pasado EN EL TIEMPO (no el de mayor índice). */
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
  /** `false` = todavía no se pasó ningún punto (el próximo depende de la posición). */
  conInicio: boolean;
  /** Vuelta que se está haciendo ("Vuelta N"). */
  vueltaActual: number;
  pasados: number;
  omitidos: number;
  total: number;
}

/** Designación activa mínima que necesita el orden (estructural: no acopla con `vuelta-actual`). */
export type DesignacionOrden = { puntoEspera: { id: string } } | null | undefined;

/**
 * Orden EFECTIVO de los puntos de la vuelta (puro). Un PC con `rol === 'espera'` (Molinos) no es
 * parte de la base de la ruta: se EXCLUYE salvo que la designación activa apunte a él, en cuyo caso
 * va inmediatamente DESPUÉS del PC `retorno` (si no hay, queda en su `orden`). Sin ningún `rol`
 * (paquete viejo u otras líneas) devuelve los puntos ordenados por `orden`, igual que siempre.
 */
export function ordenEfectivoPuntos(
  puntosControl: readonly PuntoControlPaquete[],
  designacion: DesignacionOrden,
): PuntoControlPaquete[] {
  const ordenados = [...puntosControl].sort((a, b) => a.orden - b.orden);
  if (!ordenados.some((p) => p.rol === 'espera')) return ordenados;
  const idEspera = designacion?.puntoEspera.id ?? null;
  const base = ordenados.filter((p) => p.rol !== 'espera');
  const espera = idEspera === null ? undefined : ordenados.find((p) => p.rol === 'espera' && p.id === idEspera);
  if (!espera) return base;
  const idxRetorno = base.findIndex((p) => p.rol === 'retorno');
  if (idxRetorno >= 0) return [...base.slice(0, idxRetorno + 1), espera, ...base.slice(idxRetorno + 1)];
  // Sin PC retorno: queda en su `orden` relativo.
  return ordenados.filter((p) => p.rol !== 'espera' || p.id === espera.id);
}

/** Fecha local del dispositivo `YYYY-MM-DD` (no UTC: el día del chofer). */
export function fechaLocal(ahoraMs: number = Date.now()): string {
  const d = new Date(ahoraMs);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Clave de almacenamiento del progreso: sesión de login + día local. */
export function claveProgresoVuelta(sesionId: string, fecha: string): string {
  return `${sesionId}:${fecha}`;
}

/** Inversa de `claveProgresoVuelta` (la fecha mide siempre 10 caracteres). */
export function separarClaveProgreso(clave: string): { sesionId: string; fecha: string } {
  return { sesionId: clave.slice(0, -11), fecha: clave.slice(-10) };
}

export function estadoInicialVuelta(
  sesionId: string,
  fecha: string = fechaLocal(),
): EstadoProgresoVuelta {
  return {
    sesionId,
    fecha,
    version: 0,
    vueltasCompletadas: 0,
    inicioId: null,
    pasados: [],
    ultimoId: null,
    ultimaVueltaResumen: null,
    procesados: [],
  };
}

/**
 * Ajusta el estado al paquete ACTUAL de puntos (un refresco puede quitar puntos, incluido el de
 * inicio): `pasados` solo conserva ids vigentes; si el inicio ya no existe se re-ancla al primer
 * pasado vigente (o `null`); si el último ya no existe se usa el último pasado vigente (o el
 * inicio). Al re-anclar se saltean los PC de espera (`idsEspera`): nunca anclan la vuelta. Devuelve
 * el MISMO objeto si no hay nada que ajustar.
 */
export function normalizarEstado(
  estado: EstadoProgresoVuelta,
  idsActuales: readonly string[],
  idsEspera: readonly string[] = [],
): EstadoProgresoVuelta {
  const vigentes = new Set(idsActuales);
  const pasados = estado.pasados.filter((id) => vigentes.has(id));
  // Sin inicio no hay nada que re-anclar (puede haber pasos por un PC de espera sin vuelta anclada).
  const inicioId =
    estado.inicioId === null || vigentes.has(estado.inicioId)
      ? estado.inicioId
      : (pasados.find((id) => !idsEspera.includes(id)) ?? null);
  const ultimoId =
    estado.ultimoId !== null && vigentes.has(estado.ultimoId)
      ? estado.ultimoId
      : (pasados[pasados.length - 1] ?? inicioId);
  if (
    pasados.length === estado.pasados.length &&
    inicioId === estado.inicioId &&
    ultimoId === estado.ultimoId
  ) {
    return estado;
  }
  return { ...estado, pasados, inicioId, ultimoId };
}

/**
 * Aplica el paso por un punto. Idempotente por `clave` (el `eventId` del cumplimiento, o
 * `${puntoId}:${pasada}`): el mismo paso llegado dos veces (foreground + headless, reintentos) no
 * cuenta dos veces. `idsActuales` = ids del ORDEN EFECTIVO de la vuelta (`ordenEfectivoPuntos`:
 * sin el PC de espera salvo designación activa) — define el `total` y qué pasos cuentan.
 * `idsEspera` = ids de todo PC con `rol === 'espera'`: su paso se registra SIEMPRE en `pasados`
 * (así, si la designación llega después de pasar por Molinos, figura pasado), pero sin anclar la
 * vuelta y sin contar en el total ni en el cierre mientras no esté en `idsActuales`.
 */
export function pasoPunto(
  estadoCrudo: EstadoProgresoVuelta,
  paso: { puntoId: string; clave: string },
  idsActuales: readonly string[],
  idsEspera: readonly string[] = [],
): EstadoProgresoVuelta {
  if (estadoCrudo.procesados.includes(paso.clave)) return estadoCrudo;
  const procesados = [...estadoCrudo.procesados, paso.clave].slice(-MAX_PROCESADOS);
  const estado = normalizarEstado(estadoCrudo, [...idsActuales, ...idsEspera], idsEspera);
  const esEspera = idsEspera.includes(paso.puntoId);
  // Un punto que ya no está en el paquete no aporta al progreso: solo se recuerda la clave.
  if (!idsActuales.includes(paso.puntoId) && !esEspera) return { ...estado, procesados };
  const base = { ...estado, procesados, ultimoId: paso.puntoId };

  // PC de espera: nunca ancla la vuelta ni la cierra; solo queda registrado como pasado.
  if (esEspera && (estado.inicioId === null || !idsActuales.includes(paso.puntoId))) {
    if (estado.pasados.includes(paso.puntoId)) return { ...estado, procesados };
    return { ...estado, procesados, pasados: [...estado.pasados, paso.puntoId] };
  }
  if (estado.inicioId === null) {
    return { ...base, inicioId: paso.puntoId, pasados: [...estado.pasados, paso.puntoId] };
  }
  // Vuelta al punto de inicio habiendo pasado algo más que él mismo: cierra la vuelta y la nueva
  // arranca con ese punto ya pasado. Con solo el inicio pasado (rebote/jitter), no es una vuelta.
  const pasadosEfectivos = estado.pasados.filter((id) => idsActuales.includes(id)).length;
  if (paso.puntoId === estado.inicioId && pasadosEfectivos > 1) {
    const numero = estado.vueltasCompletadas + 1;
    return {
      ...base,
      vueltasCompletadas: numero,
      ultimaVueltaResumen: { numero, pasados: pasadosEfectivos, total: idsActuales.length },
      pasados: [paso.puntoId],
    };
  }
  if (estado.pasados.includes(paso.puntoId)) return base;
  return { ...base, pasados: [...estado.pasados, paso.puntoId] };
}

/**
 * Evento "arrancó un recorrido": la vuelta en curso empieza de cero (sin inicio ni pasados) pero
 * el conteo de vueltas del día (`vueltasCompletadas`) se conserva. Devuelve el MISMO objeto si ya
 * estaba limpia.
 */
export function reiniciarVuelta(estado: EstadoProgresoVuelta): EstadoProgresoVuelta {
  if (estado.inicioId === null && estado.pasados.length === 0 && estado.ultimoId === null) {
    return estado;
  }
  return { ...estado, inicioId: null, pasados: [], ultimoId: null };
}

/** Id del punto más cercano a `posicion` entre los del orden efectivo; `null` sin posición o sin puntos. */
export function proximoMasCercanoIdEnOrden(
  ordenEfectivo: readonly PuntoControlPaquete[],
  posicion: { lat: number; lng: number } | null,
): string | null {
  if (!posicion) return null;
  let mejor = Infinity;
  let id: string | null = null;
  for (const p of ordenEfectivo) {
    const d = haversineMetros([posicion.lng, posicion.lat], p.coord.coordinates);
    if (d < mejor) {
      mejor = d;
      id = p.id;
    }
  }
  return id;
}

/**
 * Deriva el estado de cada punto SIN depender de la posición. En orden rotado (inicio primero),
 * relativo al ÚLTIMO punto pasado en el tiempo (`ultimoId`): `omitido` = sin pasar y anterior a
 * él; `proximo` = primer sin pasar después de él (si no queda ninguno, el propio punto de
 * inicio, para cerrar la vuelta). Sin inicio todavía: todo `pendiente` salvo el de menor `orden`
 * como próximo provisional (la UI lo reemplaza por el más cercano con `conProximo`).
 */
export function derivarProgresoEstaticoEnOrden(
  estadoCrudo: EstadoProgresoVuelta,
  ordenados: readonly PuntoControlPaquete[],
): ProgresoDerivado {
  const total = ordenados.length;
  const estado = normalizarEstado(
    estadoCrudo,
    ordenados.map((p) => p.id),
    ordenados.filter((p) => p.rol === 'espera').map((p) => p.id),
  );
  const vueltaActual = estado.vueltasCompletadas + 1;
  const idxInicio =
    estado.inicioId === null ? -1 : ordenados.findIndex((p) => p.id === estado.inicioId);

  if (idxInicio < 0) {
    const proximo = ordenados[0] ?? null;
    return {
      puntos: ordenados.map((punto) => ({
        punto,
        estado: punto.id === proximo?.id ? 'proximo' : 'pendiente',
      })),
      proximo,
      conInicio: false,
      vueltaActual,
      pasados: 0,
      omitidos: 0,
      total,
    };
  }

  const rotados = [...ordenados.slice(idxInicio), ...ordenados.slice(0, idxInicio)];
  const pasadosSet = new Set(estado.pasados);
  const idxUltimo = Math.max(
    0,
    rotados.findIndex((p) => p.id === estado.ultimoId),
  );
  let idxProximo = rotados.findIndex((p, i) => i > idxUltimo && !pasadosSet.has(p.id));
  if (idxProximo < 0) idxProximo = 0; // nada pendiente adelante: volver al inicio cierra la vuelta.
  let pasados = 0;
  let omitidos = 0;
  const puntos = rotados.map((punto, i): PuntoProgreso => {
    const paso = pasadosSet.has(punto.id);
    if (paso) pasados += 1;
    if (i === idxProximo) return { punto, estado: 'proximo' };
    if (paso) return { punto, estado: 'pasado' };
    if (i < idxUltimo) {
      omitidos += 1;
      return { punto, estado: 'omitido' };
    }
    return { punto, estado: 'pendiente' };
  });
  return {
    puntos,
    proximo: rotados[idxProximo] ?? null,
    conInicio: true,
    vueltaActual,
    pasados,
    omitidos,
    total,
  };
}

/** Sin inicio: fija como próximo el punto `proximoId` (el más cercano). Con inicio, o si ya es
 * el próximo, devuelve el MISMO objeto (referencia estable para los `useMemo` de la UI). */
export function conProximo(derivado: ProgresoDerivado, proximoId: string | null): ProgresoDerivado {
  if (derivado.conInicio || proximoId === null || derivado.proximo?.id === proximoId) {
    return derivado;
  }
  const puntos = derivado.puntos.map(
    ({ punto }): PuntoProgreso => ({
      punto,
      estado: punto.id === proximoId ? 'proximo' : 'pendiente',
    }),
  );
  return { ...derivado, puntos, proximo: puntos.find((p) => p.estado === 'proximo')?.punto ?? null };
}
