import { LINEAS_MOCK } from '../datos';
import type { ConfigLineaInput, ConfigLineaMock, EstadoFlotaMock, LineaMockId, ParadaMock } from '../tipos';

/**
 * Slice `config` — horario y puntos de control EDITABLES por línea (E08 06:01 del guion:
 * "Configurar recorrido, horario, parada, punto de control"). Los valores DEFAULT de
 * `esPuntoControl`/`radioToleranciaM`/`nombre` viven en `LINEAS_MOCK[lineaId].paradas`
 * (`datos.ts`, geometría + semilla fija); este slice guarda la copia EDITABLE en vivo, que es
 * la que lee el resto del reducer (control-point crossing en `estado/index.ts#tick`).
 */

const DEFAULTS: Record<LineaMockId, { frecuenciaMin: number; horaInicio: string; horaFin: string }> = {
  z12: { frecuenciaMin: 8, horaInicio: '05:00', horaFin: '22:00' },
  l120: { frecuenciaMin: 12, horaInicio: '05:30', horaFin: '21:30' },
};

export function configInicial(): Record<LineaMockId, ConfigLineaMock> {
  const resultado = {} as Record<LineaMockId, ConfigLineaMock>;
  for (const lineaId of Object.keys(LINEAS_MOCK) as LineaMockId[]) {
    const linea = LINEAS_MOCK[lineaId];
    resultado[lineaId] = {
      lineaId,
      ...DEFAULTS[lineaId],
      paradas: linea.paradas.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        esPuntoControl: p.esPuntoControl,
        radioToleranciaM: p.radioToleranciaM,
      })),
    };
  }
  return resultado;
}

/** Selector — config EN VIVO de una línea (con cualquier edición de `guardarConfigLinea` ya
 * aplicada). */
export function configDe(estado: EstadoFlotaMock, lineaId: LineaMockId): ConfigLineaMock {
  return estado.config[lineaId];
}

/**
 * Paradas de `lineaId` con las ediciones EN VIVO de Configuración ya aplicadas (ítem 14 del
 * guion delegado: hoy nombre/radio se guardan en `estado.config` pero nadie los lee — todo el
 * módulo sigue mirando `LINEAS_MOCK[lineaId].paradas`, la copia FIJA de semilla). Mezcla la
 * geometría fija (`lat`/`lng`/`orden`/`avance`, que la config NO puede editar) con
 * `nombre`/`esPuntoControl`/`radioToleranciaM` de `estado.config[lineaId].paradas`. Todo
 * consumidor INTERNO de este módulo que necesite el nombre o el estado de punto de control de
 * una parada en vivo (demanda, cumplimientos, mensajes) tiene que pasar por acá — no leer
 * `LINEAS_MOCK` directo (eso, la geometría de la línea en sí, sigue siendo el único uso legítimo
 * de `LINEAS_MOCK[lineaId].paradas` sin pasar por este selector).
 */
export function paradasDe(estado: EstadoFlotaMock, lineaId: LineaMockId): ParadaMock[] {
  const linea = LINEAS_MOCK[lineaId];
  const config = estado.config[lineaId];
  const editablesPorId = new Map((config?.paradas ?? []).map((p) => [p.id, p]));
  return linea.paradas.map((p) => {
    const editable = editablesPorId.get(p.id);
    return editable
      ? { ...p, nombre: editable.nombre, esPuntoControl: editable.esPuntoControl, radioToleranciaM: editable.radioToleranciaM }
      : p;
  });
}

function minutosDeHHMM(valor: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(valor);
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

/** Validación PURA (sin estado) — usada por el reducer (que IGNORA el input inválido, ver
 * `guardarConfigLinea` abajo) y por la UI para mostrar los errores antes de guardar. Ítem 14
 * del guion delegado: suma validación por parada — antes solo validaba frecuencia/horario y
 * dejaba pasar cualquier `nombre`/`radioToleranciaM` (incluso un radio de 3 m o de 5000 m, o un
 * nombre vacío). */
export function validarConfigLinea(input: ConfigLineaInput): string[] {
  const errores: string[] = [];
  if (!Number.isFinite(input.frecuenciaMin) || input.frecuenciaMin < 3 || input.frecuenciaMin > 60) {
    errores.push('La frecuencia debe estar entre 3 y 60 minutos.');
  }
  const inicio = minutosDeHHMM(input.horaInicio);
  const fin = minutosDeHHMM(input.horaFin);
  if (inicio === null || fin === null) {
    errores.push('El horario debe tener formato HH:MM.');
  } else if (inicio >= fin) {
    errores.push('La hora de inicio debe ser anterior a la hora de fin.');
  }
  for (const parada of input.paradas) {
    const nombre = parada.nombre.trim();
    if (nombre.length === 0 || nombre.length > 40) {
      errores.push(`El nombre de "${parada.nombre || parada.id}" debe tener entre 1 y 40 caracteres.`);
    }
    if (parada.esPuntoControl && (!Number.isInteger(parada.radioToleranciaM) || parada.radioToleranciaM < 20 || parada.radioToleranciaM > 300)) {
      errores.push(`El radio de tolerancia de "${parada.nombre || parada.id}" debe ser un entero entre 20 y 300 m.`);
    }
  }
  return errores;
}

/** Reducer — input inválido se IGNORA (contrato: "The reducer ignores invalid input"), la UI
 * usa `validarConfigLinea` para mostrar los errores ANTES de intentar guardar. */
export function guardarConfigLinea(estado: EstadoFlotaMock, lineaId: LineaMockId, input: ConfigLineaInput): EstadoFlotaMock {
  if (validarConfigLinea(input).length > 0) {
    return estado;
  }
  return { ...estado, config: { ...estado.config, [lineaId]: { lineaId, ...input } } };
}

/** Puntos de control ACTIVOS ahora mismo (geometría fija de `datos.ts` + `esPuntoControl` en
 * vivo de `estado.config`) — usado por `estado/index.ts#tick` para detectar cumplimientos, y
 * por `salidas.ts` para calcular `RecorridoMock.puntosTotal` al despachar. */
export function puntosControlActivosDe(
  estado: EstadoFlotaMock,
  lineaId: LineaMockId,
): { id: string; avance: number; radioToleranciaM: number }[] {
  const linea = LINEAS_MOCK[lineaId];
  const config = estado.config[lineaId];
  const activos = new Map((config?.paradas ?? []).filter((p) => p.esPuntoControl).map((p) => [p.id, p.radioToleranciaM]));
  return linea.paradas
    .filter((p) => activos.has(p.id))
    .map((p) => ({ id: p.id, avance: p.avance, radioToleranciaM: activos.get(p.id)! }));
}
