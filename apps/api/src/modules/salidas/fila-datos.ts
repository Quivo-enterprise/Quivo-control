import type { Prisma } from '@quivo/db';
import {
  calcularFilaSalida,
  type PosicionFila,
  type ReglaFrecuenciaCalculo,
} from '@quivo/shared';
import {
  MSG_PC_NO_ENCONTRADO,
  noEncontrado,
  sinTerminal,
  type FilaCalculada,
  type SalidaRecienteDb,
} from './salidas.logic.js';

type Tx = Prisma.TransactionClient;

export const diaStr = (fecha: Date): string => fecha.toISOString().slice(0, 10);

export interface PuntoControlTerminal {
  id: string;
  sindicatoId: string;
  baseMin: number | null;
}

/**
 * Resuelve una terminal por id. `puntos_control` no tiene RLS: la barrera de tenant es la línea
 * (`lineas` sí la tiene), así que el JOIN bajo `withTenantContext` oculta los PC de otro sindicato
 * (404, igual que uno inexistente). Un PC propio que no es terminal es 422.
 */
export async function resolverTerminal(tx: Tx, puntoControlId: string): Promise<PuntoControlTerminal> {
  const [pc] = await tx.$queryRaw<
    { id: string; rol: string | null; sindicatoId: string; baseMin: number | null }[]
  >`
    SELECT pc.id, pc.rol, l."sindicatoId", pc."frecuenciaSalidaMin" AS "baseMin"
    FROM puntos_control pc
    JOIN rutas r ON r.id = pc."rutaId"
    JOIN lineas l ON l.id = r."lineaId"
    WHERE pc.id = ${puntoControlId}
  `;
  if (!pc) throw noEncontrado(MSG_PC_NO_ENCONTRADO);
  if (pc.rol !== 'terminal') throw sinTerminal();
  return { id: pc.id, sindicatoId: pc.sindicatoId, baseMin: pc.baseMin };
}

export interface FilaDelPc {
  baseMin: number | null;
  filas: FilaCalculada[];
  posiciones: PosicionFila[];
}

/**
 * Fila del día de una terminal: 3 consultas (en fila + grupo activo; última salida + base; reglas
 * no anuladas) y `calcularFilaSalida`. Solo cuentan filas con la sesión `activa`: si la sesión se
 * cerró por otra vía (rotación de PIN, etc.) el trufi no puede bloquear la cola.
 * shortcut: fila calculada en cada request, agregar CacheTtl por puntoControl si el p95 de vuelta-actual pasa 150 ms
 */
export async function calcularFilaPc(tx: Tx, puntoControlId: string, fecha: Date, ahora: Date): Promise<FilaDelPc> {
  const dia = diaStr(fecha);
  const filas = await tx.$queryRaw<(FilaCalculada & { ordenTs: Date; grupoId: string | null })[]>`
    SELECT f.id, f."vehiculoId", v.placa, f."llegadaTs", f."ordenTs", g.id AS "grupoId"
    FROM fila_salida f
    JOIN vehiculos v ON v.id = f."vehiculoId"
    JOIN sesiones_operativas s ON s.id = f."sesionId" AND s.estado = 'activa'
    LEFT JOIN grupo_vehiculo_miembros m ON m."vehiculoId" = f."vehiculoId"
    LEFT JOIN grupos_vehiculo g ON g.id = m."grupoId" AND g.estado = 'activo'
    WHERE f."puntoControlId" = ${puntoControlId} AND f.fecha = ${dia}::date AND f.estado = 'en_fila'
  `;
  const [meta] = await tx.$queryRaw<{ baseMin: number | null; ultimaSalidaTs: Date | null }[]>`
    SELECT pc."frecuenciaSalidaMin" AS "baseMin",
           (SELECT max(f."salidaTs") FROM fila_salida f
            WHERE f."puntoControlId" = pc.id AND f.fecha = ${dia}::date AND f.estado = 'salio') AS "ultimaSalidaTs"
    FROM puntos_control pc WHERE pc.id = ${puntoControlId}
  `;
  const reglasDb = await tx.frecuenciaRegla.findMany({
    where: { puntoControlId, fecha, anuladaEn: null },
  });
  const reglas: ReglaFrecuenciaCalculo[] = reglasDb.map((r) => ({
    alcance: r.alcance as ReglaFrecuenciaCalculo['alcance'],
    grupoId: r.grupoId,
    vehiculoId: r.vehiculoId,
    minutos: r.minutos,
    desdeMin: r.desdeMin,
    hastaMin: r.hastaMin,
    creadaEn: r.creadaEn,
    anuladaEn: r.anuladaEn,
  }));
  const baseMin = meta?.baseMin ?? null;
  const posiciones = calcularFilaSalida({
    enFila: filas.map((f) => ({
      id: f.id,
      vehiculoId: f.vehiculoId,
      grupoId: f.grupoId,
      llegadaTs: f.llegadaTs,
      ordenTs: f.ordenTs,
    })),
    ultimaSalidaTs: meta?.ultimaSalidaTs ?? null,
    reglas,
    baseMin,
    ahora,
  });
  return { baseMin, filas, posiciones };
}

export function salidasRecientes(tx: Tx, puntoControlId: string, fecha: Date, limite: number) {
  return tx.$queryRaw<SalidaRecienteDb[]>`
    SELECT f.id, f."vehiculoId", v.placa, f."llegadaTs", f."salidaTs", f."salidaOrigen", f.anticipada
    FROM fila_salida f JOIN vehiculos v ON v.id = f."vehiculoId"
    WHERE f."puntoControlId" = ${puntoControlId} AND f.fecha = ${diaStr(fecha)}::date AND f.estado = 'salio'
    ORDER BY f."salidaTs" DESC
    LIMIT ${limite}
  `;
}
