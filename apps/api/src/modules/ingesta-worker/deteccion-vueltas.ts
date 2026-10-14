import type { Prisma as PrismaTypes } from '@quivo/db';
import {
  fechaActualBolivia,
  type EstadoVuelta,
  type RolPuntoControl,
} from '@quivo/shared';
import { contextoDeSesion, resolverGravedad } from './deteccion-infracciones.js';
import { DRIFT_ALERTA_MS } from './ingesta-drift.js';
import { descartarFuturos } from './infracciones.logic.js';
import {
  avanzarVueltas,
  resolverEspera,
  type EventoVuelta,
  type FilaVuelta,
  type FixEspera,
  type InfraccionVuelta,
} from './vueltas.js';

/**
 * Integración del conteo de vueltas con la base (docs/plan-molinos-designacion.md, F1): carga la
 * última vuelta de la sesión, corre la máquina pura (`vueltas.ts`) con los eventos nuevos del
 * lote y persiste el resultado + las infracciones `molinos_omitido`/`espera_corta`. Corre DESPUÉS
 * de que la evidencia del lote ya está persistida, en su transacción PROPIA (un fallo acá nunca
 * revierte ni bloquea la ingesta; el llamador lo atrapa y lo registra).
 */

type Tx = PrismaTypes.TransactionClient;

/** Eventos del lote que afectan a UNA sesión (ya persistidos). */
export interface EntradaVueltasSesion {
  cumplimientos: { ts: Date; puntoControlId: string; lat: number; lng: number }[];
  inicios: Date[];
  fines: Date[];
  /** El lote trajo fixes GPS de la sesión: hay que re-evaluar la salida del punto de espera. */
  hayGps: boolean;
}

interface FilaPuntoControlRol {
  id: string;
  rol: string | null;
  esperaMin: number | null;
  radioToleranciaM: number;
}

interface FilaVueltaDb {
  id: string;
  numero: number;
  inicioTs: Date;
  finTs: Date | null;
  estado: string;
  pasoRetornoTs: Date | null;
  varianteId: string | null;
  puntoEsperaId: string | null;
  esperaLlegadaTs: Date | null;
  esperaSalidaTs: Date | null;
}

export interface ResultadoVueltasSesion {
  abiertas: number;
  cerradas: number;
  infracciones: number;
}

const NADA: ResultadoVueltasSesion = { abiertas: 0, cerradas: 0, infracciones: 0 };
/** Tope de fixes GPS leídos para resolver una espera (30 min de espera a ~1 fix cada pocos s). */
const LIMITE_FIXES_ESPERA = 5_000;

export async function procesarVueltasSesion(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  entrada: EntradaVueltasSesion,
  ahora: Date = new Date(),
): Promise<ResultadoVueltasSesion> {
  // `contextoDeSesion` filtra por `sindicatoId`: es la barrera de tenant (el `sesionId` viene del
  // payload que controla el dispositivo); una sesión ajena devuelve null.
  const ctx = await contextoDeSesion(tx, sindicatoId, sesionId);
  if (!ctx) return NADA;

  const pcs = await tx.$queryRaw<FilaPuntoControlRol[]>`
    SELECT id, rol, "esperaMin", "radioToleranciaM"
    FROM puntos_control WHERE "rutaId" = ${ctx.rutaId} AND estado = 'activo'
  `;
  // Las rutas sin ningún PC `terminal` no cuentan vueltas (p. ej. la troncal 120 hoy): sin un
  // cierre definido, cada recorrido sería una "vuelta" eternamente abierta.
  if (!pcs.some((pc) => pc.rol === 'terminal')) return NADA;
  const pcPorId = new Map(pcs.map((pc) => [pc.id, pc]));

  // Serializa los lotes de la MISMA sesión (también cuando todavía no hay fila que bloquear: dos
  // lotes concurrentes con la primera vuelta chocarían en el unique `(sesionId, numero)`).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vueltas:${sesionId}`}, 0))`;

  // Última vuelta con `FOR UPDATE`: una designación concurrente (`UPDATE ... WHERE
  // espera_llegada_ts IS NULL`) espera a que este lote termine y re-evalúa su condición.
  const [ultimaDb] = await tx.$queryRaw<FilaVueltaDb[]>`
    SELECT v.id, v.numero, v."inicioTs", v."finTs", v.estado, v."pasoRetornoTs", v."varianteId",
           va."puntoEsperaId", v."esperaLlegadaTs", v."esperaSalidaTs"
    FROM vueltas v
    LEFT JOIN variantes va ON va.id = v."varianteId"
    WHERE v."sesionId" = ${sesionId} AND v."sindicatoId" = ${sindicatoId}
    ORDER BY v.numero DESC
    LIMIT 1
    FOR UPDATE OF v
  `;
  const ultima: FilaVuelta | null = ultimaDb
    ? { ...ultimaDb, estado: ultimaDb.estado as EstadoVuelta }
    : null;

  // Lo fechado en el futuro (> ahora + drift) se descarta: un reloj adelantado abriría vueltas
  // "en el futuro" y bloquearía, por orden de `ts`, los eventos reales posteriores.
  const eventos: EventoVuelta[] = [
    ...descartarFuturos(
      entrada.cumplimientos.map((c) => ({
        clase: 'cumplimiento' as const,
        ts: c.ts,
        puntoControlId: c.puntoControlId,
        rol: (pcPorId.get(c.puntoControlId)?.rol ?? null) as RolPuntoControl | null,
        lat: c.lat,
        lng: c.lng,
      })),
      ahora.getTime(),
      DRIFT_ALERTA_MS,
    ),
    ...descartarFuturos(
      entrada.inicios.map((ts) => ({ clase: 'inicio' as const, ts })),
      ahora.getTime(),
      DRIFT_ALERTA_MS,
    ),
    ...descartarFuturos(
      entrada.fines.map((ts) => ({ clase: 'fin' as const, ts })),
      ahora.getTime(),
      DRIFT_ALERTA_MS,
    ),
  ];

  const { cambios, infracciones } = avanzarVueltas(ultima, eventos);
  const filas = new Map<string, FilaVuelta>(cambios.map((c) => [c.fila.id, c.fila]));
  const nuevas = new Set(cambios.filter((c) => c.nueva).map((c) => c.fila.id));

  // Esperas por resolver: vueltas designadas con llegada y sin salida (las tocadas en este lote
  // y la última aunque el lote solo traiga GPS).
  const candidatas = new Map<string, FilaVuelta>(filas);
  if (ultima && !candidatas.has(ultima.id)) candidatas.set(ultima.id, ultima);
  const todasInfracciones: InfraccionVuelta[] = [...infracciones];
  for (const fila of candidatas.values()) {
    if (fila.varianteId === null || fila.esperaLlegadaTs === null || fila.esperaSalidaTs !== null) continue;
    const pcEspera = fila.puntoEsperaId ? pcPorId.get(fila.puntoEsperaId) : undefined;
    if (!pcEspera?.esperaMin || !fila.puntoEsperaId) continue;
    const hasta = fila.finTs ?? new Date(ahora.getTime() + DRIFT_ALERTA_MS);
    const fixes = await tx.$queryRaw<FixEspera[]>`
      SELECT gp.ts, gp.lat, gp.lng, gp.accuracy,
             ST_Distance(ST_SetSRID(ST_MakePoint(gp.lng, gp.lat), 4326)::geography, pc.coord) AS "distanciaM"
      FROM gps_points gp
      CROSS JOIN puntos_control pc
      WHERE pc.id = ${fila.puntoEsperaId}
        AND gp.sesion_id = ${sesionId}::uuid AND gp."sindicatoId" = ${sindicatoId}
        AND gp.ts > ${fila.esperaLlegadaTs} AND gp.ts <= ${hasta}
      ORDER BY gp.ts
      LIMIT ${LIMITE_FIXES_ESPERA}
    `;
    const salida = resolverEspera(fila, fixes, {
      radioM: pcEspera.radioToleranciaM,
      esperaMin: pcEspera.esperaMin,
      hastaTs: fila.finTs,
    });
    if (!salida) continue;
    fila.esperaSalidaTs = salida.esperaSalidaTs;
    filas.set(fila.id, fila);
    if (salida.infraccion) todasInfracciones.push(salida.infraccion);
  }

  // Persistencia. El orden de `filas` respeta "cerrar la vuelta anterior antes de abrir la
  // siguiente" (índice parcial único de una sola vuelta `en_curso` por sesión).
  for (const fila of filas.values()) {
    if (nuevas.has(fila.id)) {
      await tx.vuelta.create({
        data: {
          id: fila.id,
          sindicatoId,
          sesionId,
          vehiculoId: ctx.vehiculoId,
          conductorId: ctx.conductorId,
          lineaId: ctx.lineaId,
          rutaId: ctx.rutaId,
          fecha: fechaActualBolivia(fila.inicioTs),
          numero: fila.numero,
          inicioTs: fila.inicioTs,
          finTs: fila.finTs,
          estado: fila.estado,
          pasoRetornoTs: fila.pasoRetornoTs,
          esperaLlegadaTs: fila.esperaLlegadaTs,
          esperaSalidaTs: fila.esperaSalidaTs,
        },
      });
    } else {
      // Solo columnas de la máquina: la designación (`varianteId`/`designada*`/`acuseEn`) es de
      // la web y de la app, y no se pisa con una lectura vieja.
      await tx.vuelta.updateMany({
        where: { id: fila.id, sindicatoId },
        data: {
          finTs: fila.finTs,
          estado: fila.estado,
          pasoRetornoTs: fila.pasoRetornoTs,
          esperaLlegadaTs: fila.esperaLlegadaTs,
          esperaSalidaTs: fila.esperaSalidaTs,
        },
      });
    }
  }

  let registradas = 0;
  for (const inf of todasInfracciones) {
    const { gravedad, reglaId } = await resolverGravedad(tx, sindicatoId, inf.tipo);
    const r = await tx.infraccion.createMany({
      data: [
        {
          sindicatoId,
          sesionId,
          vehiculoId: ctx.vehiculoId,
          conductorId: ctx.conductorId,
          lineaId: ctx.lineaId,
          rutaId: ctx.rutaId,
          tipo: inf.tipo,
          gravedad,
          reglaId,
          estado: 'abierta',
          inicioTs: inf.inicioTs,
          lat: inf.lat,
          lng: inf.lng,
          detalle: inf.detalle as PrismaTypes.InputJsonValue,
          dedupeKey: inf.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    registradas += r.count;
  }

  return {
    abiertas: nuevas.size,
    cerradas: [...filas.values()].filter((f) => f.estado !== 'en_curso' && !nuevas.has(f.id)).length,
    infracciones: registradas,
  };
}

