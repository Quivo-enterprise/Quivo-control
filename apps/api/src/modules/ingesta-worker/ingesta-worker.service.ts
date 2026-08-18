import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, withTenantContext } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  resolverTsFix,
  type EventoSync,
  type PayloadGpsPoint,
  type PayloadCumplimientoPuntoControl,
} from '@quivo/shared';
import { COLA_INGESTA_SYNC, type LoteIngestaJob } from '../sync/sync-queue.service.js';

const NOMBRE_COLA_PARTICIONES = 'mantenimiento-particiones-gps';
const NOMBRE_JOB_PARTICIONES = 'crear-particiones-futuras';
const CADA_MS_PARTICIONES = 24 * 60 * 60 * 1000; // diario alcanza — se crean con varios días de margen
const DIAS_ANTICIPACION_PARTICION = 5;
// RF-58..66 (doc técnico §12 riesgo de drift de reloj de dispositivo): sin una cifra fija
// del doc técnico, 5 minutos es una asunción razonable de este equipo — más que el drift
// típico de un reloj de teléfono sin sincronizar, lo bastante chico para detectar un caso
// real (dispositivo con la hora mal puesta a mano, etc.).
const DRIFT_ALERTA_MS = 5 * 60 * 1000;

const CONTEXTO_ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;

type Tx = PrismaTypes.TransactionClient;

/**
 * Worker de ingesta GPS (RF-58..66, QUI-241) — corre en un proceso separado
 * (`apps/api/src/worker.ts`), a diferencia de `VencimientoProcessor` que comparte proceso
 * con la API HTTP. Consume la cola `ingesta-sync` que produce `SyncController` (QUI-240):
 * `gps_point` → `gps_points` (particionada, insert idempotente por `event_id`+`ts`);
 * `cumplimiento_punto_control` → re-validado server-side vía `ST_DWithin` real contra
 * `puntos_control` (fuente de verdad RF-39, `validado_por: 'worker'` — el reporte del app
 * en QUI-239 es solo feedback local, no se descarta, pero tampoco es la verdad auditada);
 * `inicio_recorrido`/`fin_recorrido`/`observacion` → `eventos_operativos` (bitácora
 * genérica, ver comentario en `schema.prisma`). Un evento que falla (FK inexistente, dato
 * corrupto) no aborta el resto del lote — se procesa con transacciones independientes por
 * evento/grupo y el fallo se registra en `sync_errors` (RNF-35, QUI-242), nunca se
 * descarta en silencio.
 */
@Injectable()
export class IngestaWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestaWorkerService.name);
  private readonly connection: Redis;
  private readonly ingestaWorker: Worker<LoteIngestaJob>;
  private readonly ingestaQueueStats: Queue;
  private readonly particionesQueue: Queue;
  private readonly particionesWorker: Worker;

  // `@Inject(ConfigService)` explícito: `tsx`/esbuild (usado por `dev`/`dev:worker`) no
  // emite `design:paramtypes` para clases importadas desde paquetes externos (evanw/esbuild#257)
  // — ver mismo fix en `health/health.service.ts`.
  constructor(@Inject(ConfigService) config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6380';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // Solo para leer profundidad de cola (métrica) — el productor real vive en
    // `SyncQueueService` (QUI-240, otro módulo/proceso).
    this.ingestaQueueStats = new Queue(COLA_INGESTA_SYNC, { connection: this.connection });
    this.ingestaWorker = new Worker<LoteIngestaJob>(
      COLA_INGESTA_SYNC,
      async (job: Job<LoteIngestaJob>) => this.procesarLote(job),
      { connection: this.connection },
    );
    this.ingestaWorker.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.id} de ingesta falló: ${error.message}`, error.stack);
    });

    this.particionesQueue = new Queue(NOMBRE_COLA_PARTICIONES, { connection: this.connection });
    this.particionesWorker = new Worker(
      NOMBRE_COLA_PARTICIONES,
      async () => this.asegurarParticionesFuturas(),
      { connection: this.connection },
    );
  }

  async onModuleInit(): Promise<void> {
    await this.particionesQueue.upsertJobScheduler(
      NOMBRE_JOB_PARTICIONES,
      { every: CADA_MS_PARTICIONES },
      { name: NOMBRE_JOB_PARTICIONES },
    );
    // No esperar al primer disparo programado (hasta 24h) para tener margen de particiones.
    await this.asegurarParticionesFuturas();
  }

  async onModuleDestroy(): Promise<void> {
    await this.ingestaWorker.close();
    await this.ingestaQueueStats.close();
    await this.particionesWorker.close();
    await this.particionesQueue.close();
    this.connection.disconnect();
  }

  /**
   * Una transacción POR DÍA, no una sola para las `DIAS_ANTICIPACION_PARTICION + 1` — así un
   * fallo en un día no aborta a los demás (Postgres aborta la transacción completa apenas
   * falla un statement, `25P02`). Y un error en un día se loguea y NO se propaga: mantenimiento
   * de particiones futuras es best-effort, no debe impedir que el worker arranque y consuma la
   * cola — las particiones de HOY ya existen (bootstrap inicial + corridas previas) y el
   * trabajo urgente es ingerir, no adelantar margen de días. `crear_particion_gps_points` ya es
   * race-safe (`20260817130000_particion_gps_points_idempotente`), así que en el camino normal
   * esto no debería lanzar nunca — este try/catch es defensa en profundidad ante lo
   * inesperado (p. ej. la base caída a mitad de la corrida), no el mecanismo principal de
   * corrección.
   */
  private async asegurarParticionesFuturas(): Promise<void> {
    for (let i = 0; i <= DIAS_ANTICIPACION_PARTICION; i++) {
      try {
        await withTenantContext(CONTEXTO_ADMIN, (tx) =>
          tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + ${i}::int)::date)`,
        );
      } catch (error) {
        this.logger.error(
          `No se pudo asegurar la partición de gps_points para CURRENT_DATE+${i}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  private async procesarLote(job: Job<LoteIngestaJob>): Promise<{ procesados: number; errores: number }> {
    const inicio = Date.now();
    const { sindicatoId, eventos } = job.data;
    this.detectarDriftReloj(eventos);

    let errores = 0;
    const porTipo = agruparPorTipo(eventos);

    if (porTipo.gps_point.length > 0) {
      errores += await this.procesarGpsPoints(sindicatoId, porTipo.gps_point);
    }
    for (const evento of porTipo.cumplimiento_punto_control) {
      errores += await this.procesarCumplimiento(sindicatoId, evento);
    }
    const operativos = [...porTipo.inicio_recorrido, ...porTipo.fin_recorrido, ...porTipo.observacion];
    for (const evento of operativos) {
      errores += await this.procesarEventoOperativo(sindicatoId, evento);
    }

    const latenciaMs = Date.now() - inicio;
    const pendientes = await this.contarPendientesCola();
    this.logger.log(
      `Job ${job.id}: ${eventos.length} eventos (${porTipo.gps_point.length} gps, ` +
        `${porTipo.cumplimiento_punto_control.length} PC, ${operativos.length} operativos), ` +
        `${errores} error(es), ${latenciaMs}ms, cola pendiente=${pendientes}`,
    );
    return { procesados: eventos.length - errores, errores };
  }

  private async contarPendientesCola(): Promise<number> {
    return this.ingestaQueueStats.getWaitingCount();
  }

  private async procesarGpsPoints(sindicatoId: string, eventos: EventoSync[]): Promise<number> {
    try {
      const tsFixDescartados = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarGpsPoints(tx, sindicatoId, eventos),
      );
      if (tsFixDescartados > 0) {
        // El evento traía `tsFix` pero no se pudo usar (formato inesperado del SDK, reloj del
        // dispositivo corrido). Se ingestó con el `ts` de encolado — que es lo correcto, pero
        // NO debe pasar en silencio: significa que esos puntos vuelven a tener la fidelidad
        // temporal degradada que `tsFix` existe para evitar.
        this.logger.warn(
          `${tsFixDescartados} de ${eventos.length} gps_point traían un tsFix inusable: ` +
            `ingestados con el ts de encolado`,
        );
      }
      return 0;
    } catch (error) {
      await Promise.all(eventos.map((evento) => this.registrarErrorSync(sindicatoId, evento, error)));
      return eventos.length;
    }
  }

  private async procesarCumplimiento(sindicatoId: string, evento: EventoSync): Promise<number> {
    try {
      const { tsFixDescartado } = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        procesarCumplimientoEnTx(tx, sindicatoId, evento),
      );
      if (tsFixDescartado) {
        // Mismo criterio que `procesarGpsPoints`: el fallback al `ts` de encolado NUNCA debe
        // pasar en silencio. Acá pesa más — es la hora de paso por un punto de control, el
        // hecho que sustenta una sanción (RF-64..66), no solo un punto suelto del trazado.
        this.logger.warn(
          `Evento ${evento.eventId} (cumplimiento_punto_control) traía un tsFix inusable: ` +
            `ingestado con el ts de encolado`,
        );
      }
      return 0;
    } catch (error) {
      await this.registrarErrorSync(sindicatoId, evento, error);
      return 1;
    }
  }

  private async procesarEventoOperativo(sindicatoId: string, evento: EventoSync): Promise<number> {
    try {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(tx, sindicatoId, evento),
      );
      return 0;
    } catch (error) {
      await this.registrarErrorSync(sindicatoId, evento, error);
      return 1;
    }
  }

  private async registrarErrorSync(sindicatoId: string, evento: EventoSync, error: unknown): Promise<void> {
    this.logger.error(
      `Evento ${evento.eventId} (${evento.tipo}) rechazado: ${error instanceof Error ? error.message : String(error)}`,
    );
    await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.syncError.create({
        data: {
          sindicatoId,
          deviceId: evento.deviceId,
          // Best-effort desde el payload (QUI-242) — no todos los fallos lo tienen (ej. un
          // evento operativo sin sesionId falla precisamente por no traerlo).
          sesionId: extraerSesionId(evento.payload),
          eventId: evento.eventId,
          payload: evento.payload as PrismaTypes.InputJsonValue,
          error: error instanceof Error ? error.message : String(error),
        },
      }),
    );
  }

  private detectarDriftReloj(eventos: EventoSync[]): void {
    const ahora = Date.now();
    for (const evento of eventos) {
      const driftMs = Math.abs(ahora - new Date(evento.ts).getTime());
      if (driftMs > DRIFT_ALERTA_MS) {
        this.logger.warn(
          `Posible drift de reloj: device ${evento.deviceId}, evento ${evento.eventId}, ` +
            `drift ${(driftMs / 1000).toFixed(0)}s`,
        );
      }
    }
  }
}

export interface EventosPorTipo {
  gps_point: EventoSync[];
  cumplimiento_punto_control: EventoSync[];
  inicio_recorrido: EventoSync[];
  fin_recorrido: EventoSync[];
  observacion: EventoSync[];
}

export function agruparPorTipo(eventos: EventoSync[]): EventosPorTipo {
  const grupos: EventosPorTipo = {
    gps_point: [],
    cumplimiento_punto_control: [],
    inicio_recorrido: [],
    fin_recorrido: [],
    observacion: [],
  };
  for (const evento of eventos) {
    grupos[evento.tipo].push(evento);
  }
  return grupos;
}

/**
 * Devuelve cuántos eventos traían `tsFix` en el payload pero NO se pudo usar (formato
 * inesperado, o posterior al encolado): esos caen al `ts` del sobre — correcto, pero el
 * caller lo loguea, porque un fallback silencioso es justamente el modo de fallo que este
 * campo existe para eliminar. Un evento sin `tsFix` (app anterior) no cuenta: ahí el `ts` de
 * encolado es el comportamiento esperado, no una degradación.
 */
export async function insertarGpsPoints(
  tx: Tx,
  sindicatoId: string,
  eventos: EventoSync[],
): Promise<number> {
  let tsFixDescartados = 0;
  const filas = eventos.map((evento) => {
    const payload = evento.payload as unknown as PayloadGpsPoint;
    // El `ts` que se persiste es el del FIX GPS (`payload.tsFix`), no el de encolado del
    // sobre: con el tracking headless (QUI-216) el SDK entrega ubicaciones bufferadas en
    // ráfaga al salir de Doze, y un tramo entero de manejo aterrizaría con timestamps casi
    // idénticos — el recorrido reconstruido (`recorridos.service.ts`, `ORDER BY ts`)
    // quedaría deformado. `resolverTsFix` (contrato en `@quivo/shared`) cae al `ts` de
    // encolado si el evento no trae `tsFix` (app anterior) o si es ilegible: eventos viejos
    // ya encolados en dispositivos siguen ingestando exactamente como antes.
    const ts = resolverTsFix(evento.payload, evento.ts);
    // Comparación por instante, no por string: `resolverTsFix` normaliza a UTC, así que
    // un `tsFix` válido con offset (`...-04:00`) sale distinto como texto pero es el mismo
    // momento. Solo cuenta como descartado si el instante persistido NO es el del fix.
    if (payload.tsFix !== undefined && Date.parse(payload.tsFix) !== Date.parse(ts)) {
      tsFixDescartados += 1;
    }
    // `sindicatoId` (QUI-358): viene del job de la cola (un lote es siempre de un único
    // sindicato, ver `LoteIngestaJob`/`procesarLote`), no del payload del evento — mismo
    // criterio de confianza que `procesarCumplimientoEnTx`/`insertarEventoOperativoEnTx`,
    // que tampoco confían en el cliente para el tenant. Sin esto, la policy de RLS de
    // `gps_points` (`tenant_isolation`) rechazaría el INSERT en cuanto la tabla deje de
    // verse desde `admin_quivo` (bypass explícito, ver `withTenantContext` acá arriba).
    return Prisma.sql`(
      ${evento.eventId}::uuid, ${payload.sesionId}::uuid, ${evento.deviceId},
      ${ts}::timestamptz, ${payload.lat}, ${payload.lng},
      ${payload.accuracy ?? null}, ${payload.speed ?? null}, now(), ${sindicatoId}
    )`;
  });
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
    VALUES ${Prisma.join(filas)}
    ON CONFLICT (event_id, ts) DO NOTHING
  `);
  return tsFixDescartados;
}

export async function procesarCumplimientoEnTx(
  tx: Tx,
  sindicatoId: string,
  evento: EventoSync,
): Promise<{ tsFixDescartado: boolean }> {
  const payload = evento.payload as unknown as PayloadCumplimientoPuntoControl;
  // `puntos_control` no tiene RLS propia (hereda tenant vía rutaId -> linea, QUI-218) — el
  // join contra `lineas."sindicatoId"` es la barrera real acá: sin esto, un evento con un
  // `puntoControlId` de OTRO sindicato igual pasaría (la tabla es legible por cualquier
  // actor `quivo_app`, RLS no aplica). Mismo criterio 404 que `tenant-checks.ts`: no
  // distingue "no existe" de "existe pero es de otro tenant".
  const rows = await tx.$queryRaw<{ cumplido: boolean; distancia_m: number }[]>`
    SELECT
      ST_DWithin(
        pc.coord, ST_SetSRID(ST_MakePoint(${payload.lng}, ${payload.lat}), 4326)::geography, pc."radioToleranciaM"
      ) as cumplido,
      ST_Distance(pc.coord, ST_SetSRID(ST_MakePoint(${payload.lng}, ${payload.lat}), 4326)::geography) as distancia_m
    FROM puntos_control pc
    JOIN rutas r ON r.id = pc."rutaId"
    JOIN lineas l ON l.id = r."lineaId"
    WHERE pc.id = ${payload.puntoControlId} AND l."sindicatoId" = ${sindicatoId}
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`Punto de control ${payload.puntoControlId} no encontrado`);
  }
  // El `ts` que se persiste es el del FIX GPS que disparó la detección del geofence, no el de
  // encolado del sobre — mismo defecto de buffering headless que `gps_point` (ver
  // `insertarGpsPoints`), pero acá la hora de paso por el punto de control es el hecho que
  // sustenta una sanción (RF-64..66). `resolverTsFix` (contrato en `@quivo/shared`) cae al
  // `ts` de encolado si el evento no trae `tsFix` (app anterior) o si es ilegible.
  const ts = resolverTsFix(evento.payload, evento.ts);
  // Idempotencia: `cumplimientos_pc.eventId` es `@unique` SOLO (no compuesto con `ts` como
  // `gps_points.(event_id, ts)`), así que cambiar el `ts` acá no introduce el mismo riesgo —
  // `skipDuplicates` sigue deduplicando por `eventId` sin importar qué `ts` se calculó.
  const tsFixDescartado = payload.tsFix !== undefined && Date.parse(payload.tsFix) !== Date.parse(ts);
  // `createMany` + `skipDuplicates` (ON CONFLICT DO NOTHING sobre el unique de `eventId`),
  // no `create()` — reenviar el mismo lote (comportamiento esperado del cliente ante un
  // timeout, QUI-240) no debe duplicar el cumplimiento. Bug real encontrado en una prueba
  // end-to-end en vivo: `create()` generaba una fila nueva en cada reintento.
  await tx.cumplimientoPc.createMany({
    data: [
      {
        eventId: evento.eventId,
        sindicatoId,
        sesionId: payload.sesionId,
        puntoControlId: payload.puntoControlId,
        ts: new Date(ts),
        distanciaM: row.distancia_m,
        cumplido: row.cumplido,
        validadoPor: 'worker',
      },
    ],
    skipDuplicates: true,
  });
  return { tsFixDescartado };
}

export async function insertarEventoOperativoEnTx(
  tx: Tx,
  sindicatoId: string,
  evento: EventoSync,
): Promise<void> {
  const payload = evento.payload as unknown as { sesionId: string };
  if (!payload.sesionId) {
    throw new Error(`Evento ${evento.eventId} sin sesionId en el payload`);
  }
  await tx.eventoOperativo.createMany({
    data: [
      {
        eventId: evento.eventId,
        sindicatoId,
        sesionId: payload.sesionId,
        deviceId: evento.deviceId,
        tipo: evento.tipo,
        ts: new Date(evento.ts),
        payload: evento.payload as PrismaTypes.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
}

function extraerSesionId(payload: EventoSync['payload']): string | null {
  const valor = (payload as { sesionId?: unknown }).sesionId;
  return typeof valor === 'string' ? valor : null;
}
