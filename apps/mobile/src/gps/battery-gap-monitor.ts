/**
 * Lógica pura de análisis del spike GPS (QUI-216): sin dependencias de React Native,
 * testeable en Node/vitest. Consume timestamps de puntos GPS y muestras de batería
 * (tomadas del propio evento de ubicación de Transistorsoft, que incluye `battery`).
 */

const DOS_MINUTOS_MS = 2 * 60 * 1000;

export interface MuestraBateria {
  ts: number;
  nivel: number; // 0-100
}

export interface Hueco {
  desdeTs: number;
  hastaTs: number;
  duracionMs: number;
}

export interface ReporteHuecos {
  cantidad: number;
  huecoMaximoMs: number;
  huecos: Hueco[];
}

/** Detecta huecos de tracking > `umbralMs` (criterio GO: ninguno > 2 min, doc técnico §12). */
export function detectarHuecos(timestamps: number[], umbralMs = DOS_MINUTOS_MS): ReporteHuecos {
  const ordenados = [...timestamps].sort((a, b) => a - b);
  const huecos: Hueco[] = [];

  for (let i = 1; i < ordenados.length; i += 1) {
    const anterior = ordenados[i - 1];
    const actual = ordenados[i];
    if (anterior === undefined || actual === undefined) continue;

    const duracionMs = actual - anterior;
    if (duracionMs > umbralMs) {
      huecos.push({ desdeTs: anterior, hastaTs: actual, duracionMs });
    }
  }

  return {
    cantidad: huecos.length,
    huecoMaximoMs: huecos.reduce((max, h) => Math.max(max, h.duracionMs), 0),
    huecos,
  };
}

/** % de batería consumido entre la primera y la última muestra. */
export function bateriaConsumidaPorcentaje(muestras: MuestraBateria[]): number {
  if (muestras.length < 2) return 0;

  const ordenadas = [...muestras].sort((a, b) => a.ts - b.ts);
  const primera = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];
  if (!primera || !ultima) return 0;

  return Math.max(0, primera.nivel - ultima.nivel);
}

export interface ResultadoGoNoGo {
  go: boolean;
  motivos: string[];
  bateriaEstimadaPorJornada8h: number;
}

/**
 * Normaliza el consumo medido a una jornada de 8h y aplica los criterios GO del issue:
 * < 5% batería/jornada y cero huecos > 2 min.
 */
export function evaluarCriteriosGo(params: {
  bateriaConsumidaPorcentaje: number;
  reporteHuecos: ReporteHuecos;
  duracionMedicionHoras: number;
}): ResultadoGoNoGo {
  const motivos: string[] = [];
  const bateriaEstimadaPorJornada8h =
    params.duracionMedicionHoras > 0
      ? (params.bateriaConsumidaPorcentaje / params.duracionMedicionHoras) * 8
      : 0;

  if (bateriaEstimadaPorJornada8h >= 5) {
    motivos.push(
      `Batería estimada por jornada de 8h: ${bateriaEstimadaPorJornada8h.toFixed(1)}% (debe ser < 5%)`,
    );
  }
  if (params.reporteHuecos.cantidad > 0) {
    motivos.push(`${params.reporteHuecos.cantidad} hueco(s) de tracking > 2 min detectados`);
  }

  return { go: motivos.length === 0, motivos, bateriaEstimadaPorJornada8h };
}
