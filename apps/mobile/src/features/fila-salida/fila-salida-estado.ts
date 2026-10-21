import { ESTADO_DETECCION_INICIAL, type EstadoDeteccionFila, type FixFila } from './zona-terminal';

/**
 * Estado en memoria de la detección de zona. Vive aparte de `fila-salida-deteccion.ts` para que
 * `limpiarVueltaActual` (oportunista) pueda reiniciarlo sin un import circular: la detección
 * importa al oportunista, no al revés.
 */
export const deteccion: {
  estado: EstadoDeteccionFila;
  enCurso: boolean;
  ultimoFix: FixFila | null;
  /** Reloj LOCAL al recibir `ultimoFix` (el `ts` del SDK no es de fiar para medir su edad). */
  ultimoFixRecibidoMs: number;
} = { estado: ESTADO_DETECCION_INICIAL, enCurso: false, ultimoFix: null, ultimoFixRecibidoMs: 0 };

/** Inicio/fin de recorrido y tests: olvida racha, anti-rebote y último fix. */
export function reiniciarDeteccionFila(): void {
  deteccion.estado = ESTADO_DETECCION_INICIAL;
  deteccion.enCurso = false;
  deteccion.ultimoFix = null;
  deteccion.ultimoFixRecibidoMs = 0;
}
