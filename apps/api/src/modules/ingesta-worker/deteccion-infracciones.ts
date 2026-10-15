import { Prisma } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import type { GravedadRegla, RolPuntoControl, TipoInfraccion } from '@quivo/shared';
import {
  ESTADO_DESVIO_INICIAL,
  avanzarDesvio,
  type EstadoDesvio,
  type MarcadorDesvio,
  type PuntoDesvio,
} from './desvio.js';
import { DRIFT_ALERTA_MS } from './ingesta-drift.js';
import {
  construirRecorridos,
  dedupeKeyDesvio,
  dedupeKeyPcOmitido,
  descartarFuturos,
  recorridoCerradoEn,
  recorridoDeInstante,
  recorridoIniciadoEn,
  REGLA_TIPO_POR_INFRACCION,
  resolverGravedadInfraccion,
  cumplimientoDisparaPcOmitido,
  seleccionarPcOmitidos,
  type PuntoControlCandidato,
  type Recorrido,
} from './infracciones.logic.js';

/**
 * Detección de infracciones del worker de ingesta (docs/plan-en-vivo-alertas.md, PR A):
 * desvío de ruta y punto de control omitido. Todo lo que está acá corre DESPUÉS de que la
 * evidencia (gps_points / cumplimientos_pc / eventos_operativos) ya se persistió, en una
 * transacción PROPIA: un fallo de la detección nunca revierte ni bloquea la evidencia (el
 * llamador lo atrapa y lo registra).
 *
 * Variantes de ruta: `Asignacion` solo apunta a `rutaId`. Una `Variante` puede traer el TRAMO
 * ADICIONAL (`variantes.geometria`, p. ej. la subida a Molinos) y la vuelta puede estar
 * designada a ella (docs/plan-molinos-designacion.md): para los puntos que caen en una vuelta
 * designada el desvío se mide contra LEAST(ruta base, tramo de la variante). Sin designación se
 * mide solo contra `rutas.geometria` (subir a Molinos sin que lo hayan designado SÍ cuenta como
 * desvío, si la ruta tiene el desvío habilitado).
 */

type Tx = PrismaTypes.TransactionClient;

export interface ContextoSesion {
  vehiculoId: string;
  conductorId: string;
  rutaId: string;
  lineaId: string;
  /** `rutas.desvioHabilitado`: solo geometrías trazadas con GPS admiten detección de desvío. */
  desvioHabilitado: boolean;
}

/** `inicio_recorrido` / `fin_recorrido` del lote (ya persistidos), para la máquina de desvío. */
export interface MarcadorRecorridoEntrante {
  tipo: 'inicio' | 'fin';
  ts: Date;
}

export interface PuntoGpsEntrante {
  ts: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
}

export async function resolverGravedad(
  tx: Tx,
  sindicatoId: string,
  tipo: TipoInfraccion,
): Promise<{ gravedad: GravedadRegla; reglaId: string | null }> {
  const reglas = await tx.regla.findMany({
    where: { sindicatoId, tipo: REGLA_TIPO_POR_INFRACCION[tipo], estado: 'activo' },
    select: { id: true, tipo: true, gravedad: true, estado: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  });
  return resolverGravedadInfraccion(tipo, reglas);
}

export async function contextoDeSesion(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
): Promise<ContextoSesion | null> {
  const sesion = await tx.sesionOperativa.findFirst({
    where: { id: sesionId, sindicatoId },
    select: {
      vehiculoId: true,
      conductorId: true,
      asignacion: {
        select: { rutaId: true, ruta: { select: { lineaId: true, desvioHabilitado: true } } },
      },
    },
  });
  if (!sesion) return null;
  return {
    vehiculoId: sesion.vehiculoId,
    conductorId: sesion.conductorId,
    rutaId: sesion.asignacion.rutaId,
    lineaId: sesion.asignacion.ruta.lineaId,
    desvioHabilitado: sesion.asignacion.ruta.desvioHabilitado,
  };
}

/**
 * Recorridos de la sesión reconstruidos de `eventos_operativos` (la evidencia del lote ya está
 * persistida cuando corre la detección). Se ignoran eventos fechados más allá de `ahora` +
 * `DRIFT_ALERTA_MS`: un reloj adelantado no puede abrir recorridos "en el futuro".
 * (`recorridoEstado`/`recorridoEstadoTs` de `sesiones_operativas` solo guardan el estado ACTUAL
 * y no sirven para clasificar puntos históricos o tardíos del outbox.)
 */
export async function cargarRecorridos(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  ahora: Date,
): Promise<Recorrido[]> {
  const eventos = await tx.eventoOperativo.findMany({
    where: {
      sindicatoId,
      sesionId,
      tipo: { in: ['inicio_recorrido', 'fin_recorrido'] },
      ts: { lte: new Date(ahora.getTime() + DRIFT_ALERTA_MS) },
    },
    select: { tipo: true, ts: true },
    orderBy: { ts: 'asc' },
  });
  return construirRecorridos(
    eventos.map((e) => ({ tipo: e.tipo as 'inicio_recorrido' | 'fin_recorrido', ts: e.ts })),
  );
}

interface FilaEstadoDesvio {
  fuera_desde_ts: Date | null;
  puntos_fuera: number;
  dentro_consecutivos: number;
  recorrido_inicio_ts: Date | null;
  ultimo_ts: Date | null;
  infraccion_id: string | null;
  distancia_max_m: number;
  lat_inicio: number | null;
  lng_inicio: number | null;
}

/**
 * Desvío de ruta de UNA sesión con los puntos y los límites de recorrido nuevos del lote. Solo
 * corre si la ruta de la sesión tiene `desvioHabilitado` y solo evalúa puntos DENTRO de un
 * recorrido (ver `desvio.ts`). Una consulta SQL calcula `ST_Distance(punto, rutas.geometria)`
 * para los puntos en recorrido; el estado de `sesion_desvio_estado` se bloquea `FOR UPDATE` para
 * que dos lotes concurrentes de la misma sesión no pisen la racha. Devuelve cuántas infracciones
 * se abrieron/cerraron (para el log).
 *
 * `puntos` puede incluir reenvíos idempotentes o tardíos: la máquina ignora todo `ts <=
 * ultimo_ts`, así que reprocesar el mismo lote es inocuo. Lo fechado en el futuro (> `ahora` +
 * `DRIFT_ALERTA_MS`) se descarta para que `ultimo_ts` no salte al futuro.
 */
export async function procesarDesvioSesion(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  puntos: readonly PuntoGpsEntrante[],
  marcadores: readonly MarcadorRecorridoEntrante[] = [],
  ahora: Date = new Date(),
): Promise<{ abiertas: number; cerradas: number }> {
  const nada = { abiertas: 0, cerradas: 0 };
  // `contextoDeSesion` filtra por `sindicatoId`: es la barrera de tenant (el `sesionId` viene
  // del payload que controla el dispositivo); una sesión ajena devuelve null.
  const ctx = await contextoDeSesion(tx, sindicatoId, sesionId);
  if (!ctx || !ctx.desvioHabilitado) return nada;

  const candidatos = descartarFuturos(
    puntos.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    ahora.getTime(),
    DRIFT_ALERTA_MS,
  );
  const marcadoresVigentes = descartarFuturos(marcadores, ahora.getTime(), DRIFT_ALERTA_MS);
  if (candidatos.length === 0 && marcadoresVigentes.length === 0) return nada;

  const recorridos = await cargarRecorridos(tx, sindicatoId, sesionId, ahora);
  const marcadoresDesvio: MarcadorDesvio[] = [];
  for (const m of marcadoresVigentes) {
    const rec =
      m.tipo === 'inicio' ? recorridoIniciadoEn(recorridos, m.ts) : recorridoCerradoEn(recorridos, m.ts);
    if (rec) marcadoresDesvio.push({ tipo: m.tipo, ts: m.ts, recorridoTs: rec.inicioTs });
  }
  // Solo puntos dentro de un recorrido: el resto (traslado en vacío) no mueve la máquina.
  const enRecorrido = candidatos
    .map((p) => ({ p, rec: recorridoDeInstante(recorridos, p.ts) }))
    .filter((x): x is { p: PuntoGpsEntrante; rec: Recorrido } => x.rec !== null);
  if (enRecorrido.length === 0 && marcadoresDesvio.length === 0) return nada;

  // Vueltas designadas a una variante con tramo propio: los puntos que caen en ellas se miden
  // también contra ese tramo (el punto sigue en ruta si está sobre la base O sobre el tramo).
  const designadas = await tx.$queryRaw<{ inicioTs: Date; finTs: Date | null; varianteId: string }[]>`
    SELECT v."inicioTs", v."finTs", v."varianteId"
    FROM vueltas v
    JOIN variantes va ON va.id = v."varianteId"
    WHERE v."sesionId" = ${sesionId} AND v."sindicatoId" = ${sindicatoId}
      AND v."varianteId" IS NOT NULL AND va.geometria IS NOT NULL
  `;
  const varianteDelPunto = (ts: Date): string | null =>
    designadas.find(
      (d) => d.inicioTs.getTime() <= ts.getTime() && (d.finTs === null || ts.getTime() < d.finTs.getTime()),
    )?.varianteId ?? null;

  // Una sola query por sesión: distancia de cada punto a la geometría de SU ruta (y, si la
  // vuelta está designada, al tramo de la variante). La precisión (`accuracy`) NO se filtra acá
  // sino en la máquina pura (`avanzarDesvio`, única fuente).
  const puntosDesvio: PuntoDesvio[] = [];
  if (enRecorrido.length > 0) {
    const valores = enRecorrido.map(
      ({ p }, i) =>
        Prisma.sql`(${i}::int, ${p.lat}::float8, ${p.lng}::float8, ${varianteDelPunto(p.ts)}::text)`,
    );
    const filas = await tx.$queryRaw<{ ord: number; distancia_m: number }[]>(Prisma.sql`
      SELECT p.ord,
             LEAST(
               ST_Distance(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, r.geometria),
               COALESCE(ST_Distance(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, va.geometria),
                        'Infinity'::float8)
             ) AS distancia_m
      FROM (VALUES ${Prisma.join(valores)}) AS p(ord, lat, lng, variante_id)
      JOIN rutas r ON r.id = ${ctx.rutaId}
      LEFT JOIN variantes va ON va.id = p.variante_id AND va."rutaId" = r.id
      ORDER BY p.ord
    `);
    for (const f of filas) {
      const item = enRecorrido[Number(f.ord)];
      if (!item || f.distancia_m === null || !Number.isFinite(Number(f.distancia_m))) continue;
      puntosDesvio.push({
        ts: item.p.ts,
        lat: item.p.lat,
        lng: item.p.lng,
        accuracy: item.p.accuracy,
        distanciaM: Number(f.distancia_m),
        recorridoTs: item.rec.inicioTs,
      });
    }
  }

  const leerEstado = () =>
    tx.$queryRaw<FilaEstadoDesvio[]>`
      SELECT fuera_desde_ts, puntos_fuera, dentro_consecutivos, recorrido_inicio_ts, ultimo_ts,
             infraccion_id, distancia_max_m, lat_inicio, lng_inicio
      FROM sesion_desvio_estado
      WHERE sesion_id = ${sesionId} AND "sindicatoId" = ${sindicatoId}
      FOR UPDATE
    `;
  let fila = (await leerEstado())[0];
  if (!fila) {
    await tx.$executeRaw`
      INSERT INTO sesion_desvio_estado (sesion_id, "sindicatoId") VALUES (${sesionId}, ${sindicatoId})
      ON CONFLICT (sesion_id) DO NOTHING
    `;
    fila = (await leerEstado())[0];
    // La fila existe pero es de otro tenant (PK solo por sesion_id): no tocarla.
    if (!fila) return nada;
  }

  const previo: EstadoDesvio = {
    ...ESTADO_DESVIO_INICIAL,
    fueraDesdeTs: fila.fuera_desde_ts,
    puntosFuera: fila.puntos_fuera,
    dentroConsecutivos: fila.dentro_consecutivos,
    recorridoTs: fila.recorrido_inicio_ts,
    ultimoTs: fila.ultimo_ts,
    abierta: fila.infraccion_id !== null,
    distanciaMaxM: fila.distancia_max_m,
    latInicio: fila.lat_inicio,
    lngInicio: fila.lng_inicio,
  };
  const { estado, acciones } = avanzarDesvio(previo, puntosDesvio, marcadoresDesvio);

  let infraccionId = fila.infraccion_id;
  let abiertas = 0;
  let cerradas = 0;
  for (const accion of acciones) {
    if (accion.tipo === 'abrir') {
      const { gravedad, reglaId } = await resolverGravedad(tx, sindicatoId, 'desvio_ruta');
      const dedupeKey = dedupeKeyDesvio(sesionId, accion.inicioTs);
      await tx.infraccion.createMany({
        data: [
          {
            sindicatoId,
            sesionId,
            vehiculoId: ctx.vehiculoId,
            conductorId: ctx.conductorId,
            lineaId: ctx.lineaId,
            rutaId: ctx.rutaId,
            tipo: 'desvio_ruta',
            gravedad,
            reglaId,
            estado: 'abierta',
            inicioTs: accion.inicioTs,
            lat: accion.lat,
            lng: accion.lng,
            detalle: accion.detalle as unknown as PrismaTypes.InputJsonValue,
            dedupeKey,
          },
        ],
        skipDuplicates: true,
      });
      const existente = await tx.infraccion.findUnique({ where: { dedupeKey }, select: { id: true } });
      infraccionId = existente?.id ?? null;
      abiertas += 1;
    } else if (accion.tipo === 'actualizar') {
      if (infraccionId) {
        await tx.infraccion.update({
          where: { id: infraccionId },
          data: { detalle: accion.detalle as unknown as PrismaTypes.InputJsonValue },
        });
      }
    } else {
      if (infraccionId) {
        await tx.infraccion.update({
          where: { id: infraccionId },
          data: { finTs: accion.finTs, detalle: accion.detalle as unknown as PrismaTypes.InputJsonValue },
        });
      }
      infraccionId = null;
      cerradas += 1;
    }
  }

  // Si la máquina quedó "abierta" pero no hay id (insert idempotente que no devolvió fila,
  // imposible en la práctica), se baja a no-abierta para no atascar la sesión.
  const sigueAbierta = estado.abierta && infraccionId !== null;
  await tx.$executeRaw`
    UPDATE sesion_desvio_estado SET
      fuera_desde_ts = ${estado.fueraDesdeTs},
      puntos_fuera = ${estado.puntosFuera},
      dentro_consecutivos = ${estado.dentroConsecutivos},
      recorrido_inicio_ts = ${estado.recorridoTs},
      ultimo_ts = ${estado.ultimoTs},
      infraccion_id = ${sigueAbierta ? infraccionId : null},
      distancia_max_m = ${estado.distanciaMaxM},
      lat_inicio = ${estado.latInicio},
      lng_inicio = ${estado.lngInicio},
      updated_at = now()
    WHERE sesion_id = ${sesionId} AND "sindicatoId" = ${sindicatoId}
  `;
  return { abiertas, cerradas };
}

interface FilaPuntoControl {
  id: string;
  orden: number;
  obligatorio: boolean;
  estado: string;
  lat: number;
  lng: number;
}

async function registrarPcOmitidos(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  ctx: ContextoSesion,
  recorrido: Recorrido,
  refTs: Date,
  ordenLimite: number,
  puntoControlCumplidoId?: string,
): Promise<number> {
  const pcs = await tx.$queryRaw<FilaPuntoControl[]>`
    SELECT id, orden, obligatorio, estado,
           ST_Y(coord::geometry) AS lat, ST_X(coord::geometry) AS lng
    FROM puntos_control WHERE "rutaId" = ${ctx.rutaId}
  `;
  const cumplidos = await tx.cumplimientoPc.findMany({
    // Ventana del recorrido: [desde, refTs]. El límite superior (`refTs`, el cumplimiento o el
    // fin que dispara la detección) impide que cumplimientos de un recorrido POSTERIOR den por
    // cumplido un PC del anterior (el `desde` de un recorrido nunca retrocede más allá del cierre
    // del anterior; ver `construirRecorridos`).
    where: { sindicatoId, sesionId, cumplido: true, ts: { gte: recorrido.desde, lte: refTs } },
    select: { puntoControlId: true },
  });
  const omitidos = seleccionarPcOmitidos(
    pcs as PuntoControlCandidato[],
    new Set(cumplidos.map((c) => c.puntoControlId)),
    ordenLimite,
    puntoControlCumplidoId,
  );
  if (omitidos.length === 0) return 0;
  const { gravedad, reglaId } = await resolverGravedad(tx, sindicatoId, 'pc_omitido');
  const insertados = await tx.infraccion.createMany({
    data: omitidos.map((pc) => ({
      sindicatoId,
      sesionId,
      vehiculoId: ctx.vehiculoId,
      conductorId: ctx.conductorId,
      lineaId: ctx.lineaId,
      rutaId: ctx.rutaId,
      tipo: 'pc_omitido',
      gravedad,
      reglaId,
      estado: 'abierta',
      inicioTs: refTs,
      lat: pc.lat,
      lng: pc.lng,
      // `puntos_control` no tiene columna `nombre`: el detalle identifica el PC por id y orden.
      detalle: { puntoControlId: pc.id, orden: pc.orden, nombre: null },
      dedupeKey: dedupeKeyPcOmitido(sesionId, pc.id, recorrido.inicioTs),
    })),
    skipDuplicates: true,
  });
  return insertados.count;
}

/**
 * PC omitido "en vivo": llegó un cumplimiento `cumplido` del PC de orden k → cada PC
 * obligatorio y activo de la ruta con orden < k, sin cumplimiento `cumplido` en la ventana del
 * recorrido que contiene al cumplimiento, pasa a infracción `pc_omitido`. Corre DESPUÉS de
 * persistir toda la evidencia del lote (incluidos los `inicio_recorrido`/`fin_recorrido`), con
 * las entradas en orden de `ts`. Limitaciones documentadas: si el cumplimiento no cae en ningún
 * recorrido (sin `inicio_recorrido`, o posterior al fin) no se detecta nada; un cumplimiento
 * tardío del outbox (después de que el de un PC posterior ya disparó la detección) deja la
 * infracción abierta para descarte manual; el cumplimiento de un PC inactivo o de un opcional
 * sin `rol` SOLO en rutas con un PC `retorno` activo (`cumplimientoDisparaPcOmitido`) no dispara
 * nada, así que ahí un obligatorio saltado se detecta con el siguiente PC con rol/obligatorio o
 * al `fin_recorrido`; en las demás rutas cualquier PC activo cumplido dispara.
 */
export async function detectarPcOmitidosPorCumplimiento(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  puntoControlId: string,
  tsCumplimiento: Date,
  ahora: Date = new Date(),
): Promise<number> {
  const [pc] = await tx.$queryRaw<
    {
      rutaId: string;
      orden: number;
      rol: RolPuntoControl | null;
      obligatorio: boolean;
      estado: string;
      rutaConRetorno: boolean;
    }[]
  >`
    SELECT pc."rutaId", pc.orden, pc.rol, pc.obligatorio, pc.estado,
           EXISTS (
             SELECT 1 FROM puntos_control r
             WHERE r."rutaId" = pc."rutaId" AND r.rol = 'retorno' AND r.estado = 'activo'
           ) AS "rutaConRetorno"
    FROM puntos_control pc WHERE pc.id = ${puntoControlId}
  `;
  // Un PC inactivo no dispara la omisión en vivo; en rutas con retorno tampoco un opcional sin rol.
  if (!pc || !cumplimientoDisparaPcOmitido(pc)) return 0;
  const ctx = await contextoDeSesion(tx, sindicatoId, sesionId);
  if (!ctx) return 0;
  // Un PC de otra ruta no dice nada sobre los PC de la ruta de esta sesión.
  if (pc.rutaId !== ctx.rutaId) return 0;
  const recorrido = recorridoDeInstante(
    await cargarRecorridos(tx, sindicatoId, sesionId, ahora),
    tsCumplimiento,
  );
  if (!recorrido) return 0;
  return registrarPcOmitidos(
    tx,
    sindicatoId,
    sesionId,
    ctx,
    recorrido,
    tsCumplimiento,
    pc.orden,
    puntoControlId,
  );
}

/**
 * PC omitido al `fin_recorrido`: todos los PC obligatorios activos sin cumplir en la ventana del
 * recorrido que ese fin cerró (`null` → fin huérfano, sin inicio: no se detecta nada).
 */
export async function detectarPcOmitidosAlFinRecorrido(
  tx: Tx,
  sindicatoId: string,
  sesionId: string,
  tsFin: Date,
  ahora: Date = new Date(),
): Promise<number> {
  const ctx = await contextoDeSesion(tx, sindicatoId, sesionId);
  if (!ctx) return 0;
  const recorrido = recorridoCerradoEn(await cargarRecorridos(tx, sindicatoId, sesionId, ahora), tsFin);
  if (!recorrido) return 0;
  return registrarPcOmitidos(tx, sindicatoId, sesionId, ctx, recorrido, tsFin, Number.POSITIVE_INFINITY);
}
