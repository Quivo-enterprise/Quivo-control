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
  /** `ts` del fix más viejo del lote (acota la ventana de fixes de la salida); `null` sin GPS. */
  gpsDesdeTs: Date | null;
}

interface FilaPuntoControlRol {
  id: string;
  rol: string | null;
  esperaMin: number | null;
  radioToleranciaM: number;
  lat: number;
  lng: number;
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
  ultimoPcTs: Date | null;
}

export interface ResultadoVueltasSesion {
  abiertas: number;
  cerradas: number;
  infracciones: number;
}

const NADA: ResultadoVueltasSesion = { abiertas: 0, cerradas: 0, infracciones: 0 };
/** Tope de fixes GPS por página al resolver una espera (30 min de espera a ~1 fix cada pocos s). */
const LIMITE_FIXES_ESPERA = 5_000;
/** Páginas máximas por espera: tope duro de seguridad (se pagina hacia adelante en el tiempo). */
const MAX_PAGINAS_FIXES_ESPERA = 10;
/**
 * Margen hacia atrás de la ventana de fixes de la salida: la salida exige
 * `ESPERA_SALIDA_PUNTOS_CONSECUTIVOS` fixes fuera del radio seguidos, y el primero de la racha
 * pudo llegar en el lote anterior.
 */
const MARGEN_VENTANA_SALIDA_MS = 2 * 60_000;

export async function procesarVueltasSesion(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  entrada: EntradaVueltasSesion,
  ahora: Date = new Date(),
): Promise<ResultadoVueltasSesion> {
  // Sin eventos de vuelta ni GPS no hay nada que re-evaluar. Con SOLO GPS el único trabajo posible
  // es resolver la salida de una espera pendiente: se comprueba con una lectura barata (índice
  // `(sesionId, numero)`) ANTES de cargar el contexto de la sesión o tomar locks.
  const hayEventos =
    entrada.cumplimientos.length > 0 || entrada.inicios.length > 0 || entrada.fines.length > 0;
  if (!hayEventos) {
    if (!entrada.hayGps) return NADA;
    const pendiente = await tx.$queryRaw<{ uno: number }[]>`
      SELECT 1 AS uno FROM vueltas
      WHERE "sesionId" = ${sesionId} AND "sindicatoId" = ${sindicatoId}
        AND "esperaLlegadaTs" IS NOT NULL AND "esperaSalidaTs" IS NULL
      LIMIT 1
    `;
    if (pendiente.length === 0) return NADA;
  }

  // PRIMER lock: la fila de la sesión con `FOR SHARE`, ANTES de cualquier `FOR UPDATE` sobre
  // `vueltas` (orden de locks: sesión → vuelta; el cierre hace UPDATE de la sesión y luego el
  // trigger `vueltas_cerrar_con_sesion` toca las vueltas, el mismo orden: sin deadlock). Bajo
  // READ COMMITTED el `FOR SHARE` choca con el row lock del UPDATE que cierra la sesión, así que:
  // o el cierre espera a este lote y su trigger ve la vuelta N+1 que abrimos, o este lote espera
  // y relee la sesión ya cerrada. Con la sesión no activa no se abre, cierra ni muta ninguna
  // vuelta: lo que quedó en curso lo resolvió el trigger. Filtra por `sindicatoId` (barrera de
  // tenant: el `sesionId` viene del payload que controla el dispositivo).
  const [sesionFila] = await tx.$queryRaw<{ estado: string }[]>`
    SELECT estado FROM sesiones_operativas
    WHERE id = ${sesionId} AND "sindicatoId" = ${sindicatoId}
    FOR SHARE
  `;
  if (!sesionFila || sesionFila.estado !== 'activa') return NADA;

  // `contextoDeSesion` filtra por `sindicatoId`: una sesión ajena devuelve null.
  const ctx = await contextoDeSesion(tx, sindicatoId, sesionId);
  if (!ctx) return NADA;

  const pcs = await tx.$queryRaw<FilaPuntoControlRol[]>`
    SELECT id, rol, "esperaMin", "radioToleranciaM",
           ST_Y(coord::geometry) AS lat, ST_X(coord::geometry) AS lng
    FROM puntos_control WHERE "rutaId" = ${ctx.rutaId} AND estado = 'activo'
  `;
  // Las rutas sin ningún PC `terminal` no cuentan vueltas (p. ej. la troncal 120 hoy): sin un
  // cierre definido, cada recorrido sería una "vuelta" eternamente abierta.
  const terminal = pcs.find((pc) => pc.rol === 'terminal');
  if (!terminal) return NADA;
  const pcPorId = new Map(pcs.map((pc) => [pc.id, pc]));

  // Serializa los lotes de la MISMA sesión (también cuando todavía no hay fila que bloquear: dos
  // lotes concurrentes con la primera vuelta chocarían en el unique `(sesionId, numero)`).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vueltas:${sesionId}`}, 0))`;

  // Última vuelta con `FOR UPDATE`: una designación concurrente (`UPDATE ... WHERE
  // espera_llegada_ts IS NULL`) espera a que este lote termine y re-evalúa su condición.
  const [ultimaDb] = await tx.$queryRaw<FilaVueltaDb[]>`
    SELECT v.id, v.numero, v."inicioTs", v."finTs", v.estado, v."pasoRetornoTs", v."varianteId",
           va."puntoEsperaId", v."esperaLlegadaTs", v."esperaSalidaTs", v."ultimoPcTs"
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
  const eliminadas = new Set(cambios.filter((c) => c.eliminada).map((c) => c.fila.id));

  // Esperas por resolver: TODA vuelta designada de la sesión con llegada y sin salida (también ya
  // cerrada: si los fixes de la salida llegan en un lote posterior, `espera_corta` se evalúa
  // igual), más las tocadas en este lote.
  const pendientesDb = await tx.$queryRaw<FilaVueltaDb[]>`
    SELECT v.id, v.numero, v."inicioTs", v."finTs", v.estado, v."pasoRetornoTs", v."varianteId",
           va."puntoEsperaId", v."esperaLlegadaTs", v."esperaSalidaTs", v."ultimoPcTs"
    FROM vueltas v
    JOIN variantes va ON va.id = v."varianteId"
    WHERE v."sesionId" = ${sesionId} AND v."sindicatoId" = ${sindicatoId}
      AND v."esperaLlegadaTs" IS NOT NULL AND v."esperaSalidaTs" IS NULL
  `;
  const yaPendientes = new Set(pendientesDb.map((f) => f.id));
  const candidatas = new Map<string, FilaVuelta>(
    pendientesDb.map((f) => [f.id, { ...f, estado: f.estado as EstadoVuelta }]),
  );
  for (const [id, fila] of filas) candidatas.set(id, fila);
  const todasInfracciones: InfraccionVuelta[] = [...infracciones];
  for (const fila of candidatas.values()) {
    if (eliminadas.has(fila.id)) continue;
    if (fila.varianteId === null || fila.esperaLlegadaTs === null || fila.esperaSalidaTs !== null) continue;
    const pcEspera = fila.puntoEsperaId ? pcPorId.get(fila.puntoEsperaId) : undefined;
    if (!pcEspera?.esperaMin || !fila.puntoEsperaId) continue;
    // Ventana de fixes: desde la llegada si ésta se registró en ESTE lote (los fixes pudieron
    // llegar antes que el cumplimiento); si ya estaba pendiente, solo lo que trajo el lote
    // (menos un margen para la histéresis de fixes consecutivos): lo anterior ya se evaluó.
    let desde = fila.esperaLlegadaTs;
    if (yaPendientes.has(fila.id)) {
      if (entrada.gpsDesdeTs === null) continue;
      desde = new Date(
        Math.max(desde.getTime(), entrada.gpsDesdeTs.getTime() - MARGEN_VENTANA_SALIDA_MS),
      );
    }
    const hasta = fila.finTs ?? new Date(ahora.getTime() + DRIFT_ALERTA_MS);
    if (desde.getTime() > hasta.getTime()) continue;
    // Se pagina hacia adelante en el tiempo: una página llena de fixes dentro del radio no puede
    // esconder una salida posterior (el tope por página es solo de seguridad).
    const fixes: FixEspera[] = [];
    let cursor = desde;
    for (let pagina = 0; pagina < MAX_PAGINAS_FIXES_ESPERA; pagina += 1) {
      const lote = await tx.$queryRaw<FixEspera[]>`
        SELECT gp.ts, gp.lat, gp.lng, gp.accuracy,
               ST_Distance(ST_SetSRID(ST_MakePoint(gp.lng, gp.lat), 4326)::geography, pc.coord) AS "distanciaM"
        FROM gps_points gp
        CROSS JOIN puntos_control pc
        WHERE pc.id = ${fila.puntoEsperaId}
          AND gp.sesion_id = ${sesionId}::uuid AND gp."sindicatoId" = ${sindicatoId}
          AND gp.ts > ${cursor} AND gp.ts > ${fila.esperaLlegadaTs} AND gp.ts <= ${hasta}
        ORDER BY gp.ts
        LIMIT ${LIMITE_FIXES_ESPERA}
      `;
      fixes.push(...lote);
      if (lote.length < LIMITE_FIXES_ESPERA) break;
      cursor = lote[lote.length - 1]!.ts;
    }
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

  // Persistencia. El orden de `filas` respeta "cerrar/eliminar la vuelta anterior antes de abrir
  // la siguiente" (índice parcial único de una sola vuelta `en_curso` por sesión, y unique
  // `(sesionId, numero)` cuando el número de una vuelta vacía eliminada se reutiliza).
  for (const fila of filas.values()) {
    if (eliminadas.has(fila.id)) {
      // Vuelta vacía (sin PC ni designación): una `nueva` ni siquiera se inserta. `varianteId:
      // null` en el filtro: una designación que se coló nunca se pierde.
      if (!nuevas.has(fila.id)) {
        await tx.vuelta.deleteMany({ where: { id: fila.id, sindicatoId, varianteId: null } });
      }
      continue;
    }
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
          ultimoPcTs: fila.ultimoPcTs,
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
          ultimoPcTs: fila.ultimoPcTs,
        },
      });
    }
  }

  let registradas = 0;
  for (const inf of todasInfracciones) {
    // La máquina no tiene posición para los cierres por `fin_recorrido`/`inicio_recorrido`: se
    // toma el último fix de la sesión hasta ese instante y, sin fixes, la terminal de la ruta.
    let { lat, lng } = inf;
    if (lat === null || lng === null) {
      const [fix] = await tx.$queryRaw<{ lat: number; lng: number }[]>`
        SELECT lat, lng FROM gps_points
        WHERE sesion_id = ${sesionId}::uuid AND "sindicatoId" = ${sindicatoId} AND ts <= ${inf.inicioTs}
        ORDER BY ts DESC
        LIMIT 1
      `;
      lat = fix?.lat ?? terminal.lat;
      lng = fix?.lng ?? terminal.lng;
    }
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
          lat,
          lng,
          detalle: inf.detalle as PrismaTypes.InputJsonValue,
          dedupeKey: inf.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    registradas += r.count;
  }

  return {
    abiertas: nuevas.size - [...nuevas].filter((id) => eliminadas.has(id)).length,
    cerradas: [...filas.values()].filter(
      (f) => f.estado !== 'en_curso' && !nuevas.has(f.id) && !eliminadas.has(f.id),
    ).length,
    infracciones: registradas,
  };
}
