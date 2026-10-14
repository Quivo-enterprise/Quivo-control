import type { Prisma as PrismaTypes } from '@quivo/db';
import {
  MOLINOS_ESPERA_PENDIENTE_MAX_H,
  fechaActualBolivia,
  type EstadoVuelta,
  type RolPuntoControl,
} from '@quivo/shared';
import { resolverGravedad } from './deteccion-infracciones.js';
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
  /** `ts` más reciente de cualquier evento del lote (referencia de antigüedad de las esperas); `null` si no hay. */
  ultimoTs: Date | null;
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
  /** `vueltas.esperaRevisadaHastaTs`: `ts` del último fix GPS ya evaluado para la salida de la espera. */
  esperaRevisadaHastaTs: Date | null;
}

/** Sesión + contexto leídos con `FOR SHARE` en una sola consulta. */
interface FilaSesionBloqueada {
  estado: string;
  fin: Date | null;
  vehiculoId: string;
  conductorId: string;
  rutaId: string;
  lineaId: string;
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
/** UUID nulo: primer valor del cursor keyset `(ts, event_id)`. */
const ID_NULO = '00000000-0000-0000-0000-000000000000';

export async function procesarVueltasSesion(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  entrada: EntradaVueltasSesion,
  ahora: Date = new Date(),
): Promise<ResultadoVueltasSesion> {
  // Referencia temporal del lote (su `ts` más reciente, acotado a `ahora` + drift: un reloj
  // adelantado no puede declarar viejas las esperas reales). Una espera pendiente solo se
  // re-evalúa si su llegada cae dentro de `MOLINOS_ESPERA_PENDIENTE_MAX_H` de esa referencia.
  const referenciaMs = Math.min(
    entrada.ultimoTs?.getTime() ?? ahora.getTime(),
    ahora.getTime() + DRIFT_ALERTA_MS,
  );
  const llegadaMinima = new Date(referenciaMs - MOLINOS_ESPERA_PENDIENTE_MAX_H * 3_600_000);

  // Sin eventos de vuelta ni GPS no hay nada que re-evaluar. Con SOLO GPS el único trabajo posible
  // es resolver la salida de una espera pendiente RESOLVIBLE (PC de espera todavía activo y llegada
  // reciente): se comprueba con una lectura barata ANTES de tomar locks.
  const hayEventos =
    entrada.cumplimientos.length > 0 || entrada.inicios.length > 0 || entrada.fines.length > 0;
  if (!hayEventos) {
    if (!entrada.hayGps) return NADA;
    const pendiente = await tx.$queryRaw<{ uno: number }[]>`
      SELECT 1 AS uno FROM vueltas v
      JOIN variantes va ON va.id = v."varianteId"
      JOIN puntos_control pe ON pe.id = va."puntoEsperaId" AND pe.estado = 'activo'
      WHERE v."sesionId" = ${sesionId} AND v."sindicatoId" = ${sindicatoId}
        AND v."esperaLlegadaTs" IS NOT NULL AND v."esperaSalidaTs" IS NULL
        AND v."esperaLlegadaTs" >= ${llegadaMinima}
      LIMIT 1
    `;
    if (pendiente.length === 0) return NADA;
  }

  // PRIMER lock: la fila de la sesión con `FOR SHARE`, ANTES de cualquier `FOR UPDATE` sobre
  // `vueltas` (orden de locks: sesión → vuelta; el cierre hace UPDATE de la sesión y luego el
  // trigger `vueltas_cerrar_con_sesion` toca las vueltas, el mismo orden: sin deadlock; la
  // designación solo bloquea la vuelta). Bajo READ COMMITTED el `FOR SHARE` choca con el row lock
  // del UPDATE que cierra la sesión, así que: o el cierre espera a este lote y su trigger ve la
  // vuelta N+1 que abrimos, o este lote espera y relee la sesión ya cerrada. En la MISMA consulta
  // (con el bloqueo) se traen el estado, el cierre y el contexto (vehículo/conductor/ruta/línea):
  // una sola ida a la base. Con la sesión no activa corre en modo "cierre tardío" (ver
  // `avanzarVueltas`). Filtra por `sindicatoId` (barrera de tenant: el `sesionId` viene del
  // payload que controla el dispositivo).
  const [sesion] = await tx.$queryRaw<FilaSesionBloqueada[]>`
    SELECT s.estado, s.fin, s."vehiculoId", s."conductorId", a."rutaId", r."lineaId"
    FROM sesiones_operativas s
    JOIN asignaciones a ON a.id = s."asignacionId"
    JOIN rutas r ON r.id = a."rutaId"
    WHERE s.id = ${sesionId} AND s."sindicatoId" = ${sindicatoId}
    FOR SHARE OF s
  `;
  if (!sesion) return NADA;
  const ctx = sesion;
  const sesionActiva = sesion.estado === 'activa';

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

  // Última vuelta con `FOR UPDATE`: una designación concurrente (que bloquea la misma fila antes
  // de decidir) espera a que este lote termine y re-evalúa su condición.
  const [ultimaDb] = await tx.$queryRaw<FilaVueltaDb[]>`
    SELECT v.id, v.numero, v."inicioTs", v."finTs", v.estado, v."pasoRetornoTs", v."varianteId",
           va."puntoEsperaId", v."esperaLlegadaTs", v."esperaSalidaTs", v."ultimoPcTs",
           v."esperaRevisadaHastaTs"
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
  // "en el futuro" y bloquearía, por orden de `ts`, los eventos reales posteriores. Un
  // cumplimiento de un PC que no es un PC activo de la ruta (inactivo o ajeno) se ignora por
  // completo: no abre, no cierra ni cuenta como progreso de la vuelta.
  const eventos: EventoVuelta[] = [
    ...descartarFuturos(
      entrada.cumplimientos
        .filter((c) => pcPorId.has(c.puntoControlId))
        .map((c) => ({
          clase: 'cumplimiento' as const,
          ts: c.ts,
          puntoControlId: c.puntoControlId,
          rol: (pcPorId.get(c.puntoControlId)!.rol ?? null) as RolPuntoControl | null,
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

  // Sesión cerrada: cierre tardío. El cierre es `sesiones_operativas.fin` (el trigger lo copia a
  // `finTs` de la vuelta); sin él (cierre sin `fin`, el trigger usó now()) vale el `finTs` de la vuelta.
  const cierreTardio = sesionActiva
    ? undefined
    : { cierreTs: sesion.fin ?? ultima?.finTs ?? new Date(0) };

  // ¿Recorrido en curso al empezar el lote? Solo importa sin vuelta previa (un `terminal` abre la
  // primera vuelta únicamente con el recorrido en curso). Se lee el ÚLTIMO `inicio_recorrido` /
  // `fin_recorrido` guardado anterior al primer evento del lote (los del propio lote ya están
  // persistidos y los aplica la máquina; `recorridoEstado` de la sesión puede reflejar eventos
  // posteriores y no sirve). Sin ninguno: en curso.
  let recorridoEnCurso = true;
  if (!ultima && !cierreTardio && eventos.length > 0) {
    const primeroMs = Math.min(...eventos.map((e) => e.ts.getTime()));
    const [marcador] = await tx.$queryRaw<{ tipo: string }[]>`
      SELECT tipo FROM eventos_operativos
      WHERE "sesionId" = ${sesionId} AND "sindicatoId" = ${sindicatoId}
        AND tipo IN ('inicio_recorrido', 'fin_recorrido') AND ts < ${new Date(primeroMs)}
      ORDER BY ts DESC
      LIMIT 1
    `;
    recorridoEnCurso = marcador?.tipo !== 'fin_recorrido';
  }

  const { cambios, infracciones } = avanzarVueltas(ultima, eventos, { recorridoEnCurso, cierreTardio });
  const filas = new Map<string, FilaVuelta>(cambios.map((c) => [c.fila.id, c.fila]));
  const nuevas = new Set(cambios.filter((c) => c.nueva).map((c) => c.fila.id));
  const eliminadas = new Set(cambios.filter((c) => c.eliminada).map((c) => c.fila.id));

  // Esperas por resolver: TODA vuelta designada de la sesión con llegada y sin salida (también ya
  // cerrada: si los fixes de la salida llegan en un lote posterior, `espera_corta` se evalúa
  // igual), más las tocadas en este lote. Solo las RESOLUBLES: el PC de espera sigue activo y la
  // llegada es reciente (`MOLINOS_ESPERA_PENDIENTE_MAX_H`).
  const pendientesDb = await tx.$queryRaw<FilaVueltaDb[]>`
    SELECT v.id, v.numero, v."inicioTs", v."finTs", v.estado, v."pasoRetornoTs", v."varianteId",
           va."puntoEsperaId", v."esperaLlegadaTs", v."esperaSalidaTs", v."ultimoPcTs",
           v."esperaRevisadaHastaTs"
    FROM vueltas v
    JOIN variantes va ON va.id = v."varianteId"
    JOIN puntos_control pe ON pe.id = va."puntoEsperaId" AND pe.estado = 'activo'
    WHERE v."sesionId" = ${sesionId} AND v."sindicatoId" = ${sindicatoId}
      AND v."esperaLlegadaTs" IS NOT NULL AND v."esperaSalidaTs" IS NULL
      AND v."esperaLlegadaTs" >= ${llegadaMinima}
  `;
  const candidatas = new Map<string, FilaVuelta>(
    pendientesDb.map((f) => [f.id, { ...f, estado: f.estado as EstadoVuelta }]),
  );
  // Las tocadas por la máquina (copias de la fila de la base) arrastran su cursor.
  for (const [id, fila] of filas) candidatas.set(id, fila);
  const todasInfracciones: InfraccionVuelta[] = [...infracciones];
  // Cursor de revisión nuevo por vuelta (se persiste en esta MISMA transacción: si falla, no avanza
  // y el próximo lote re-escanea).
  const cursoresNuevos = new Map<string, Date>();
  for (const fila of candidatas.values()) {
    if (eliminadas.has(fila.id)) continue;
    if (fila.varianteId === null || fila.esperaLlegadaTs === null || fila.esperaSalidaTs !== null) continue;
    const pcEspera = fila.puntoEsperaId ? pcPorId.get(fila.puntoEsperaId) : undefined;
    if (!pcEspera?.esperaMin || !fila.puntoEsperaId) continue;
    // Ventana de fixes: desde el cursor de lo ya evaluado (menos un margen para la histéresis de
    // fixes consecutivos: el primero de la racha pudo caer antes) y nunca antes de la llegada. No
    // depende del contenido del lote, así que un lote perdido o fallido se repara solo.
    const llegadaMs = fila.esperaLlegadaTs.getTime();
    const desdeMs = fila.esperaRevisadaHastaTs
      ? Math.max(llegadaMs, fila.esperaRevisadaHastaTs.getTime() - MARGEN_VENTANA_SALIDA_MS)
      : llegadaMs;
    const hasta = fila.finTs ?? new Date(ahora.getTime() + DRIFT_ALERTA_MS);
    if (desdeMs > hasta.getTime()) continue;
    // Paginación por keyset `(ts, event_id)` (la PK de `gps_points` es `(event_id, ts)`): sin
    // saltos ni repetidos en el borde de página, y el cursor viaja como el TEXTO exacto de la base
    // (un `Date` de JS truncaría los microsegundos). Se evalúa página a página y se corta al
    // encontrar la salida; el tope de páginas es solo de seguridad.
    const fixes: FixEspera[] = [];
    const vistos = new Set<string>();
    let cursorTs = new Date(desdeMs).toISOString();
    let cursorId = ID_NULO;
    let ultimoFixTs: Date | null = null;
    let salida: ReturnType<typeof resolverEspera> = null;
    for (let pagina = 0; pagina < MAX_PAGINAS_FIXES_ESPERA; pagina += 1) {
      const lote = await tx.$queryRaw<(FixEspera & { tsTxt: string; eventId: string })[]>`
        SELECT gp.ts, gp.ts::text AS "tsTxt", gp.event_id::text AS "eventId", gp.lat, gp.lng, gp.accuracy,
               ST_Distance(ST_SetSRID(ST_MakePoint(gp.lng, gp.lat), 4326)::geography, pc.coord) AS "distanciaM"
        FROM gps_points gp
        CROSS JOIN puntos_control pc
        WHERE pc.id = ${fila.puntoEsperaId}
          AND gp.sesion_id = ${sesionId}::uuid AND gp."sindicatoId" = ${sindicatoId}
          AND gp.ts > ${fila.esperaLlegadaTs} AND gp.ts <= ${hasta}
          AND (gp.ts, gp.event_id) > (${cursorTs}::timestamptz, ${cursorId}::uuid)
        ORDER BY gp.ts, gp.event_id
        LIMIT ${LIMITE_FIXES_ESPERA}
      `;
      for (const f of lote) {
        if (vistos.has(f.eventId)) continue;
        vistos.add(f.eventId);
        fixes.push(f);
      }
      if (lote.length > 0) {
        const ultimo = lote[lote.length - 1]!;
        cursorTs = ultimo.tsTxt;
        cursorId = ultimo.eventId;
        ultimoFixTs = ultimo.ts;
      }
      salida = resolverEspera(fila, fixes, {
        radioM: pcEspera.radioToleranciaM,
        esperaMin: pcEspera.esperaMin,
        hastaTs: fila.finTs,
      });
      if (salida || lote.length < LIMITE_FIXES_ESPERA) break;
    }
    if (!salida) {
      if (ultimoFixTs) cursoresNuevos.set(fila.id, ultimoFixTs);
      continue;
    }
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

  // Cursor de la revisión de salida: solo avanza (si no hubo fixes nuevos queda como estaba).
  for (const [id, ts] of cursoresNuevos) {
    await tx.vuelta.updateMany({
      where: {
        id,
        sindicatoId,
        OR: [{ esperaRevisadaHastaTs: null }, { esperaRevisadaHastaTs: { lt: ts } }],
      },
      data: { esperaRevisadaHastaTs: ts },
    });
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
