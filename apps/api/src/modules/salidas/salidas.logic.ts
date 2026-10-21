import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  EstadoFilaSalida,
  FilaSalidaPanelItem,
  OrigenSalida,
  PosicionFila,
  SalidaRecientePanel,
} from '@quivo/shared';

/**
 * Precisión máxima del fix (m) para registrar la llegada. La terminal tiene radio de 150 m: con un
 * fix peor que esto, "dentro del radio" no dice nada. (`ESPERA_MAX_ACCURACY_M` = 30 m es para
 * confirmar salidas finas del punto de espera; acá alcanza un corte más laxo.)
 */
export const ACCURACY_MAX_LLEGADA_M = 100;

/** Salidas del día que el panel muestra debajo de la fila. */
export const SALIDAS_RECIENTES_MAX = 10;

export const MSG_FILA_NO_ENCONTRADA = 'Fila no encontrada';
export const MSG_PC_NO_ENCONTRADO = 'Punto de control no encontrado';
export const MSG_PC_NO_TERMINAL = 'El punto de control no es una terminal';
// Mismo texto para "no existe" y "es de otro sindicato": no revela si el id existe en otro tenant.
export const MSG_VEHICULO_INVALIDO = 'Vehículo no encontrado';
export const MSG_GRUPO_INVALIDO = 'Grupo no encontrado';

export const noEncontrado = (msg: string) => new NotFoundException(msg);
export const sinTerminal = () => new UnprocessableEntityException(MSG_PC_NO_TERMINAL);
export const yaNoEstaEnFila = () => new ConflictException('El trufi ya no está en la fila');

/** Violación de FK (P2003): carrera con un borrado o id ajeno que se coló; se normaliza a 404. */
export function esErrorFk(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2003';
}

/** `anticipada` = el trufi no estaba habilitado (no era el 1.º o no llegó su hora). */
export function esAnticipada(posiciones: readonly PosicionFila[], filaId: string): boolean {
  return !(posiciones.find((p) => p.id === filaId)?.habilitado ?? false);
}

export interface FilaCalculada {
  id: string;
  vehiculoId: string;
  placa: string;
  llegadaTs: Date;
}

export function armarEstadoMovil(
  posiciones: readonly PosicionFila[],
  filas: readonly FilaCalculada[],
  filaId: string,
  ahora: Date,
): EstadoFilaSalida | null {
  const mia = posiciones.find((p) => p.id === filaId);
  if (!mia) return null;
  const delante = posiciones[mia.posicion - 2];
  return {
    posicion: mia.posicion,
    total: posiciones.length,
    delantePlaca: delante ? (filas.find((f) => f.id === delante.id)?.placa ?? null) : null,
    etaTs: mia.etaTs.toISOString(),
    esperaMs: Math.round(mia.esperaMs),
    habilitado: mia.habilitado,
    demorado: mia.demorado,
    servidorTs: ahora.toISOString(),
  };
}

export function armarItemsPanel(
  posiciones: readonly PosicionFila[],
  filas: readonly FilaCalculada[],
): FilaSalidaPanelItem[] {
  const porId = new Map(filas.map((f) => [f.id, f]));
  return posiciones.map((p) => {
    const f = porId.get(p.id)!;
    return {
      id: p.id,
      vehiculoId: p.vehiculoId,
      placa: f.placa,
      posicion: p.posicion,
      llegadaTs: f.llegadaTs.toISOString(),
      etaTs: p.etaTs.toISOString(),
      esperaMs: Math.round(p.esperaMs),
      estado: 'en_fila' as const,
      habilitado: p.habilitado,
      demorado: p.demorado,
      anticipada: false,
    };
  });
}

export interface SalidaRecienteDb {
  id: string;
  vehiculoId: string;
  placa: string;
  llegadaTs: Date;
  salidaTs: Date;
  salidaOrigen: string;
  anticipada: boolean;
}

export function armarSalidasRecientes(filas: readonly SalidaRecienteDb[]): SalidaRecientePanel[] {
  return filas.map((s) => ({
    id: s.id,
    vehiculoId: s.vehiculoId,
    placa: s.placa,
    llegadaTs: s.llegadaTs.toISOString(),
    salidaTs: s.salidaTs.toISOString(),
    salidaOrigen: s.salidaOrigen as OrigenSalida,
    anticipada: s.anticipada,
  }));
}
