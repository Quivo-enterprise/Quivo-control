import {
  GRAVEDAD_DEFAULT_POR_TIPO,
  REGLA_TIPO_DESVIO_RUTA,
  REGLA_TIPO_ESPERA_CORTA,
  REGLA_TIPO_MOLINOS_OMITIDO,
  REGLA_TIPO_PC_OMITIDO,
  type GravedadRegla,
  type TipoInfraccion,
} from '@quivo/shared';

/** `Regla.tipo` reservado por tipo de infracción (`REGLA_TIPOS_RESERVADOS_INFRACCION`). */
export const REGLA_TIPO_POR_INFRACCION: Record<TipoInfraccion, string> = {
  desvio_ruta: REGLA_TIPO_DESVIO_RUTA,
  pc_omitido: REGLA_TIPO_PC_OMITIDO,
  molinos_omitido: REGLA_TIPO_MOLINOS_OMITIDO,
  espera_corta: REGLA_TIPO_ESPERA_CORTA,
};

export interface ReglaCandidata {
  id: string;
  tipo: string;
  gravedad: string;
  estado: string;
  updatedAt: Date;
}

/**
 * Gravedad + regla de una infracción nueva (docs/plan-en-vivo-alertas.md, "Gravedad
 * configurable sin UI nueva"): si el sindicato tiene una `Regla` ACTIVA con `tipo` EXACTAMENTE
 * igual al reservado, gana la de `updatedAt` más reciente (su `gravedad` y su `id`); si no,
 * default por tipo (desvío → grave, PC omitido → leve) y sin `reglaId`. Pura: el caller trae
 * las reglas del sindicato.
 */
export function resolverGravedadInfraccion(
  tipo: TipoInfraccion,
  reglas: readonly ReglaCandidata[],
): { gravedad: GravedadRegla; reglaId: string | null } {
  const tipoRegla = REGLA_TIPO_POR_INFRACCION[tipo];
  const elegida = reglas
    .filter(
      (r) =>
        r.estado === 'activo' &&
        r.tipo === tipoRegla &&
        (r.gravedad === 'leve' || r.gravedad === 'grave' || r.gravedad === 'gravisima'),
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (elegida) {
    return { gravedad: elegida.gravedad as GravedadRegla, reglaId: elegida.id };
  }
  return { gravedad: GRAVEDAD_DEFAULT_POR_TIPO[tipo], reglaId: null };
}

export interface PuntoControlCandidato {
  id: string;
  orden: number;
  obligatorio: boolean;
  /** `puntos_control.estado` ('activo' = vigente). */
  estado: string;
  lat: number;
  lng: number;
}

/**
 * ¿El cumplimiento de este PC puede disparar la detección de `pc_omitido` EN VIVO? Solo si el
 * PC tiene `rol` (terminal/retorno/espera) o es `obligatorio`. Un intermedio (`rol` NULL y no
 * obligatorio) nunca dispara: con intermedios después de Honduras, cumplir uno temprano (calle
 * compartida) o fallar el GPS en Honduras marcaría falsamente a Honduras como omitido. El
 * chequeo de `fin_recorrido` no pasa por acá y sigue revisando todos los obligatorios.
 */
export function cumplimientoDisparaPcOmitido(pc: {
  rol: string | null;
  obligatorio: boolean;
}): boolean {
  return pc.rol !== null || pc.obligatorio;
}

/**
 * PCs omitidos (docs/plan-en-vivo-alertas.md): los PC `obligatorio` y activos de la ruta, con
 * `orden` < `ordenLimite` (el del PC recién cumplido; `Infinity` en `fin_recorrido` = todos
 * los restantes), que NO tienen un cumplimiento `cumplido` en la ventana del recorrido
 * (`idsCumplidos`). `puntoControlCumplidoId` se excluye siempre. Devuelve en orden ascendente.
 */
export function seleccionarPcOmitidos(
  pcs: readonly PuntoControlCandidato[],
  idsCumplidos: ReadonlySet<string>,
  ordenLimite: number,
  puntoControlCumplidoId?: string,
): PuntoControlCandidato[] {
  return pcs
    .filter(
      (pc) =>
        pc.obligatorio &&
        pc.estado === 'activo' &&
        pc.orden < ordenLimite &&
        pc.id !== puntoControlCumplidoId &&
        !idsCumplidos.has(pc.id),
    )
    .sort((a, b) => a.orden - b.orden);
}

export function dedupeKeyDesvio(sesionId: string, inicioTs: Date): string {
  return `desvio:${sesionId}:${inicioTs.toISOString()}`;
}

/** `molinos_omitido:{vueltaId}` (docs/plan-molinos-designacion.md): una por vuelta designada. */
export function dedupeKeyMolinosOmitido(vueltaId: string): string {
  return `molinos_omitido:${vueltaId}`;
}

/** `espera_corta:{vueltaId}`: una por vuelta designada. */
export function dedupeKeyEsperaCorta(vueltaId: string): string {
  return `espera_corta:${vueltaId}`;
}

export function dedupeKeyPcOmitido(
  sesionId: string,
  puntoControlId: string,
  inicioRecorridoTs: Date,
): string {
  return `pc_omitido:${sesionId}:${puntoControlId}:${inicioRecorridoTs.toISOString()}`;
}

/**
 * Tolerancia entre FUENTES de reloj al encuadrar instantes en un recorrido. Hallazgo
 * (verificado en `insertarEventoOperativoEnTx`): `inicio_recorrido`/`fin_recorrido` se persisten
 * con el `ts` del SOBRE (hora del reloj del sistema del dispositivo al encolar; no tienen
 * `tsFix` ni pasan por `resolverTsFix`), mientras que los `gps_point` y
 * `cumplimiento_punto_control` usan `tsFix` (hora del fix GNSS) cuando viene. Los dos relojes
 * pueden diferir por segundos o minutos, así que el primer fix/cumplimiento "del recorrido"
 * puede caer ligeramente ANTES del `inicio_recorrido`. Se ensancha el límite INFERIOR de cada
 * recorrido por esta tolerancia (nunca más atrás del cierre del recorrido anterior). El límite
 * superior NO se ensancha: lo posterior al fin es traslado en vacío / sin servicio.
 */
export const VENTANA_RECORRIDO_TOLERANCIA_MS = 120_000;

export interface EventoRecorrido {
  tipo: 'inicio_recorrido' | 'fin_recorrido';
  ts: Date;
}

/** Un recorrido reconstruido desde la bitácora `eventos_operativos` de la sesión. */
export interface Recorrido {
  /** `ts` del `inicio_recorrido` (identidad del recorrido; entra en la dedupe key del PC omitido). */
  inicioTs: Date;
  /** Límite inferior efectivo (inclusive): `inicioTs` menos la tolerancia de relojes. */
  desde: Date;
  /** `ts` del `fin_recorrido` que lo cerró; `null` si sigue abierto o lo cerró otro inicio. */
  finTs: Date | null;
  /** Límite superior (exclusivo): el fin, o el siguiente inicio si no hubo fin; `null` = abierto. */
  hasta: Date | null;
}

/**
 * Recorridos de la sesión a partir de sus eventos `inicio_recorrido`/`fin_recorrido`. Un
 * `fin_recorrido` sin recorrido abierto se ignora; un `inicio_recorrido` con otro abierto lo
 * cierra implícitamente en ese instante. A igual `ts`, el fin va antes que el inicio.
 */
export function construirRecorridos(eventos: readonly EventoRecorrido[]): Recorrido[] {
  const ordenados = [...eventos].sort(
    (a, b) =>
      a.ts.getTime() - b.ts.getTime() ||
      (a.tipo === b.tipo ? 0 : a.tipo === 'fin_recorrido' ? -1 : 1),
  );
  const recorridos: Recorrido[] = [];
  let abierto: Recorrido | null = null;
  for (const evento of ordenados) {
    if (evento.tipo === 'inicio_recorrido') {
      if (abierto) abierto.hasta = evento.ts;
      const previo = recorridos[recorridos.length - 1];
      const piso = previo ? (previo.finTs ?? previo.inicioTs) : null;
      const sinTolerancia = evento.ts.getTime() - VENTANA_RECORRIDO_TOLERANCIA_MS;
      abierto = {
        inicioTs: evento.ts,
        desde: new Date(piso ? Math.max(sinTolerancia, piso.getTime()) : sinTolerancia),
        finTs: null,
        hasta: null,
      };
      recorridos.push(abierto);
    } else if (abierto) {
      abierto.finTs = evento.ts;
      abierto.hasta = evento.ts;
      abierto = null;
    }
  }
  return recorridos;
}

/**
 * ¿El recorrido estaba en curso justo ANTES de `ts`? Lee la misma reconstrucción que usa la
 * detección de infracciones (`construirRecorridos`: fin huérfano ignorado, a igual `ts` el fin va
 * antes que el inicio). Sin ningún inicio anterior se asume en curso; el último recorrido iniciado
 * antes de `ts` está en curso salvo que su fin también sea anterior a `ts`.
 */
export function recorridoEnCursoAntesDe(recorridos: readonly Recorrido[], ts: Date): boolean {
  let previo: Recorrido | null = null;
  for (const r of recorridos) {
    if (r.inicioTs.getTime() < ts.getTime()) previo = r;
  }
  if (!previo) return true;
  return !(previo.finTs !== null && previo.finTs.getTime() < ts.getTime());
}

/** Recorrido que contiene el instante (`desde <= ts < hasta`), o `null` (fuera de recorrido). */
export function recorridoDeInstante(
  recorridos: readonly Recorrido[],
  ts: Date,
): Recorrido | null {
  let elegido: Recorrido | null = null;
  for (const r of recorridos) {
    if (r.desde.getTime() <= ts.getTime()) elegido = r;
  }
  if (!elegido) return null;
  if (elegido.hasta && ts.getTime() >= elegido.hasta.getTime()) return null;
  return elegido;
}

/** Recorrido que CERRÓ el `fin_recorrido` con ese `ts` (`null` si era un fin huérfano). */
export function recorridoCerradoEn(recorridos: readonly Recorrido[], finTs: Date): Recorrido | null {
  return recorridos.find((r) => r.finTs?.getTime() === finTs.getTime()) ?? null;
}

/** Recorrido que ABRIÓ el `inicio_recorrido` con ese `ts`. */
export function recorridoIniciadoEn(recorridos: readonly Recorrido[], inicioTs: Date): Recorrido | null {
  return recorridos.find((r) => r.inicioTs.getTime() === inicioTs.getTime()) ?? null;
}

/**
 * Descarta lo fechado en el futuro (`ts > ahora + tolerancia`): un reloj de dispositivo
 * adelantado dejaría `ultimo_ts` en el futuro y la máquina ignoraría todo punto posterior real
 * (misma cifra de drift que `recorridoEstado`, `DRIFT_ALERTA_MS`).
 */
export function descartarFuturos<T extends { ts: Date }>(
  items: readonly T[],
  ahoraMs: number,
  toleranciaMs: number,
): T[] {
  return items.filter((i) => i.ts.getTime() <= ahoraMs + toleranciaMs);
}
