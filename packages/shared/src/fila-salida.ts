import { fechaActualBolivia, inicioDeJornadaBolivia } from './tiempo/jornada.js';

/**
 * Cálculo de la fila de salida (plan "fila de salida", "Reglas de cálculo"). Funciones puras: el
 * servidor las llama con las filas del día y `ahora`; el ancla de la hora de salida es la última
 * salida REAL, nunca `now()`.
 */

const MS_MIN = 60_000;

/** Gracia tras la ETA del 1.º antes de marcarlo `demorado` (el chofer necesita tiempo para tocar SALIR). */
export const MARGEN_DEMORADO_MS = 2 * MS_MIN;

export interface ReglaFrecuenciaCalculo {
  alcance: 'todos' | 'grupo' | 'vehiculo';
  grupoId: string | null;
  vehiculoId: string | null;
  minutos: number;
  /** Franja en minutos del día local de Bolivia; ambos o ninguno. */
  desdeMin: number | null;
  hastaMin: number | null;
  creadaEn: Date;
  anuladaEn: Date | null;
}

export interface VehiculoFrecuencia {
  id: string;
  /** El caller pasa null si el grupo está inactivo. */
  grupoId: string | null;
}

export interface EnFilaEntrada {
  /** Id de la fila (`fila_salida.id`), se devuelve tal cual. */
  id: string;
  vehiculoId: string;
  grupoId: string | null;
  llegadaTs: Date;
  ordenTs: Date;
}

export interface PosicionFila {
  id: string;
  vehiculoId: string;
  /** 1 = el próximo en salir. */
  posicion: number;
  etaTs: Date;
  /** `etaTs - ahora`, sin negativos. */
  esperaMs: number;
  /** Solo el 1.º y solo si `ahora >= etaTs`. */
  habilitado: boolean;
  /** Es el 1.º y `ahora > etaTs`. */
  demorado: boolean;
}

// Minuto del día en Bolivia (UTC-4), de 0 a 1439.
function minutoDelDiaBolivia(t: Date): number {
  return Math.floor(
    (t.getTime() - inicioDeJornadaBolivia(fechaActualBolivia(t)).getTime()) / MS_MIN,
  );
}

const nivel = { todos: 1, grupo: 2, vehiculo: 3 } as const;

function aplica(
  r: ReglaFrecuenciaCalculo,
  v: VehiculoFrecuencia,
  t: Date,
  minuto: number,
  vigentesHasta: Date,
): boolean {
  if (r.anuladaEn !== null) return false;
  // Una regla vale desde que se crea hasta la medianoche de Bolivia de ese mismo día.
  if (r.creadaEn.getTime() > vigentesHasta.getTime()) return false;
  if (fechaActualBolivia(r.creadaEn).getTime() !== fechaActualBolivia(t).getTime()) return false;
  if (r.alcance === 'vehiculo' && r.vehiculoId !== v.id) return false;
  if (r.alcance === 'grupo' && (v.grupoId === null || r.grupoId !== v.grupoId)) return false;
  if (r.desdeMin !== null && r.hastaMin !== null)
    return minuto >= r.desdeMin && minuto < r.hastaMin;
  return true;
}

/**
 * Minutos de espera tras la salida del de adelante para el trufi `vehiculo`, con la franja/día
 * evaluados en el instante ancla `t`. "Qué reglas existen" se corta en `vigentesHasta` (por
 * defecto `t`; la fila pasa `ahora`, así una regla creada después de la última salida igual
 * afecta a los que esperan). Precedencia: vehículo > grupo > todos > base; dentro de un nivel gana la regla cuya franja
 * contiene `t` sobre la que no tiene franja, y entre iguales la más reciente.
 * Sin regla aplicable ni base devuelve 0 (sale en orden, sin espera).
 */
export function resolverFrecuencia(
  vehiculo: VehiculoFrecuencia,
  t: Date,
  reglas: readonly ReglaFrecuenciaCalculo[],
  baseMin: number | null,
  vigentesHasta: Date = t,
): number {
  const minuto = minutoDelDiaBolivia(t);
  let mejor: ReglaFrecuenciaCalculo | null = null;
  for (const r of reglas) {
    if (!aplica(r, vehiculo, t, minuto, vigentesHasta)) continue;
    if (mejor === null || esMejor(r, mejor)) mejor = r;
  }
  return mejor?.minutos ?? baseMin ?? 0;
}

function esMejor(a: ReglaFrecuenciaCalculo, b: ReglaFrecuenciaCalculo): boolean {
  if (nivel[a.alcance] !== nivel[b.alcance]) return nivel[a.alcance] > nivel[b.alcance];
  const aFranja = a.desdeMin !== null;
  const bFranja = b.desdeMin !== null;
  if (aFranja !== bFranja) return aFranja;
  return a.creadaEn.getTime() > b.creadaEn.getTime();
}

export interface CalcularFilaSalidaEntrada {
  enFila: readonly EnFilaEntrada[];
  /** Última salida real del día en la parada; `null` si todavía no hubo. */
  ultimaSalidaTs: Date | null;
  reglas: readonly ReglaFrecuenciaCalculo[];
  baseMin: number | null;
  ahora: Date;
}

/** Fila ordenada por `ordenTs` (desempate `llegadaTs`, luego `id`) con hora de salida estimada. */
export function calcularFilaSalida(entrada: CalcularFilaSalidaEntrada): PosicionFila[] {
  const { ultimaSalidaTs, reglas, baseMin, ahora } = entrada;
  const ordenados = [...entrada.enFila].sort(
    (a, b) =>
      a.ordenTs.getTime() - b.ordenTs.getTime() ||
      a.llegadaTs.getTime() - b.llegadaTs.getTime() ||
      a.id.localeCompare(b.id),
  );
  const ahoraMs = ahora.getTime();
  const resultado: PosicionFila[] = [];
  let etaAnteriorMs = 0;
  let primeroDemorado = false;

  ordenados.forEach((item, i) => {
    const frec = (t: number) =>
      resolverFrecuencia(
        { id: item.vehiculoId, grupoId: item.grupoId },
        new Date(t),
        reglas,
        baseMin,
        ahora,
      );
    let etaMs: number;
    if (i === 0) {
      const ordenMs = item.ordenTs.getTime();
      etaMs =
        ultimaSalidaTs === null
          ? ordenMs
          : Math.max(ultimaSalidaTs.getTime() + frec(ultimaSalidaTs.getTime()) * MS_MIN, ordenMs);
      primeroDemorado = ahoraMs > etaMs;
    } else {
      // Si el 1.º está demorado, "ahora" corre la estimación de los de atrás (solo para mostrarla);
      // la franja se evalúa en esa misma base.
      const base = primeroDemorado ? Math.max(etaAnteriorMs, ahoraMs) : etaAnteriorMs;
      etaMs = base + frec(base) * MS_MIN;
    }
    etaAnteriorMs = etaMs;
    resultado.push({
      id: item.id,
      vehiculoId: item.vehiculoId,
      posicion: i + 1,
      etaTs: new Date(etaMs),
      esperaMs: Math.max(0, etaMs - ahoraMs),
      habilitado: i === 0 && ahoraMs >= etaMs,
      demorado: i === 0 && ahoraMs > etaMs + MARGEN_DEMORADO_MS,
    });
  });
  return resultado;
}
