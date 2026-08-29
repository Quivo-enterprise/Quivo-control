import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, withTenantContext } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { EventoSync } from '@quivo/shared';
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

  private async asegurarParticionesFuturas(): Promise<void> {
    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      // Multiple API/worker instances can initialize at the same time. The
      // partition function is idempotent, but the lock also closes the
      // check/create race between concurrent CREATE TABLE statements.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('quivo:gps-partitions', 0))`;
      for (let i = 0; i <= DIAS_ANTICIPACION_PARTICION; i++) {
        await tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + ${i}::int)::date)`;
      }
    });
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
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) => insertarGpsPoints(tx, eventos));
      return 0;
    } catch (error) {
      await Promise.all(eventos.map((evento) => this.registrarErrorSync(sindicatoId, evento, error)));
      return eventos.length;
    }
  }

  private async procesarCumplimiento(sindicatoId: string, evento: EventoSync): Promise<number> {
    try {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        procesarCumplimientoEnTx(tx, sindicatoId, evento),
      );
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

interface PayloadGpsPoint {
  sesionId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
}

export async function insertarGpsPoints(tx: Tx, eventos: EventoSync[]): Promise<void> {
  const filas = eventos.map((evento) => {
    const payload = evento.payload as unknown as PayloadGpsPoint;
    return Prisma.sql`(
      ${evento.eventId}::uuid, ${payload.sesionId}::uuid, ${evento.deviceId},
      ${evento.ts}::timestamptz, ${payload.lat}, ${payload.lng},
      ${payload.accuracy ?? null}, ${payload.speed ?? null}, now()
    )`;
  });
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at)
    VALUES ${Prisma.join(filas)}
    ON CONFLICT (event_id, ts) DO NOTHING
  `);
}

interface PayloadCumplimiento {
  sesionId: string;
  puntoControlId: string;
  lat: number;
  lng: number;
}

export async function procesarCumplimientoEnTx(
  tx: Tx,
  sindicatoId: string,
  evento: EventoSync,
): Promise<void> {
  const payload = evento.payload as unknown as PayloadCumplimiento;
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
        ts: new Date(evento.ts),
        distanciaM: row.distancia_m,
        cumplido: row.cumplido,
        validadoPor: 'worker',
      },
    ],
    skipDuplicates: true,
  });
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
