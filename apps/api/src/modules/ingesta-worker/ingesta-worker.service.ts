import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, withTenantContext } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  PayloadInicioJornadaSchema,
  fechaActualBolivia,
  resolverTsFix,
  type EventoSync,
  type PayloadGpsPoint,
  type PayloadCumplimientoPuntoControl,
} from '@quivo/shared';
import { DRIFT_ALERTA_MS } from './ingesta-drift.js';
import {
  detectarPcOmitidosAlFinRecorrido,
  detectarPcOmitidosPorCumplimiento,
  procesarDesvioSesion,
  type MarcadorRecorridoEntrante,
  type PuntoGpsEntrante,
} from './deteccion-infracciones.js';
import { procesarVueltasSesion, type EntradaVueltasSesion } from './deteccion-vueltas.js';
import { COLA_INGESTA_SYNC, type LoteIngestaJob } from '../sync/sync-queue.service.js';

const NOMBRE_COLA_PARTICIONES = 'mantenimiento-particiones-gps';
const NOMBRE_JOB_PARTICIONES = 'crear-particiones-futuras';
const CADA_MS_PARTICIONES = 24 * 60 * 60 * 1000; // diario alcanza — se crean con varios días de margen
const DIAS_ANTICIPACION_PARTICION = 5;

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
   * falla un statement, `25P02`). El error de cada día se loguea y NO se propaga desde el
   * bucle: mantenimiento de particiones futuras (mañana en adelante) es best-effort, un fallo
   * ahí no debe impedir que el worker arranque y consuma la cola. `crear_particion_gps_points`
   * ya es race-safe (`20260817130000_particion_gps_points_idempotente`), así que en el camino
   * normal esto no debería lanzar nunca — el try/catch del bucle es defensa en profundidad ante
   * lo inesperado (p. ej. la base caída a mitad de la corrida), no el mecanismo principal de
   * corrección.
   *
   * OJO — esto NO cubre el día de HOY: la partición de hoy es la que recibe cada evento GPS
   * que llegue mientras el worker esté arriba, así que su ausencia no es un caso best-effort —
   * es un `INSERT` que va a fallar en CADA fila con "no partition of relation ... found for
   * row" (`procesarGpsPoints` las manda a `sync_errors` una por una, en silencio: el worker
   * parece sano, la cola se vacía, pero la evidencia GPS del día no se persiste en ningún
   * lado). Una versión anterior de este comentario afirmaba que "las particiones de HOY ya
   * existen (bootstrap inicial + corridas previas)" — es falso en general: el bootstrap de
   * `20260802160000_ingesta_gps_worker` creó `CURRENT_DATE-1..+6` relativo a la fecha en que
   * CORRIÓ esa migración (2026-08-02), no relativo al día en que arranca esta instancia del
   * worker, y una instancia nueva de Cloud Run puede arrancar sin que haya corrido nunca antes
   * este método. Por eso, después del bucle best-effort, se verifica una post-condición dura:
   * si la partición de hoy no existe de verdad, se lanza — dejar arrancar al worker sin ella
   * solo logra desviar toda la evidencia GPS del día a `sync_errors` en silencio, que es peor
   * que no arrancar.
   */
  private async asegurarParticionesFuturas(): Promise<void> {
    for (let i = 0; i <= DIAS_ANTICIPACION_PARTICION; i++) {
      try {
        await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
          // Multiple API/worker instances can initialize at the same time. The
          // partition function is idempotent, but the lock also closes the
          // check/create race between concurrent CREATE TABLE statements.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('quivo:gps-partitions', 0))`;
          await tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + ${i}::int)::date)`;
        });
      } catch (error) {
        this.logger.error(
          `No se pudo asegurar la partición de gps_points para CURRENT_DATE+${i}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    const [particionHoy] = await withTenantContext(
      CONTEXTO_ADMIN,
      (tx) =>
        tx.$queryRaw<{ existe: boolean }[]>`
        SELECT to_regclass('public.gps_points_' || to_char(CURRENT_DATE, 'YYYYMMDD')) IS NOT NULL AS existe
      `,
    );
    if (!particionHoy?.existe) {
      throw new Error(
        'No existe la partición de gps_points de hoy: la ingesta GPS no puede persistir evidencia.',
      );
    }
  }

  private async procesarLote(
    job: Job<LoteIngestaJob>,
  ): Promise<{ procesados: number; errores: number }> {
    const inicio = Date.now();
    const { sindicatoId, eventos } = job.data;
    this.detectarDriftReloj(eventos);

    let errores = 0;
    const porTipo = agruparPorTipo(eventos);
    // Entradas de la detección de infracciones: SOLO lo efectivamente persistido en este lote.
    const entradas: EntradasDeteccion = { gps: [], cumplimientos: [], operativos: [] };

    if (porTipo.gps_point.length > 0) {
      const r = await this.procesarGpsPoints(sindicatoId, porTipo.gps_point);
      errores += r.errores;
      if (r.errores === 0) entradas.gps = porTipo.gps_point;
    }
    for (const evento of porTipo.cumplimiento_punto_control) {
      const r = await this.procesarCumplimiento(sindicatoId, evento);
      errores += r.errores;
      if (r.cumplido) entradas.cumplimientos.push({ evento, ts: r.cumplido.ts });
    }
    const operativos = [
      ...porTipo.inicio_recorrido,
      ...porTipo.fin_recorrido,
      ...porTipo.observacion,
      ...porTipo.inicio_jornada,
    ];
    for (const evento of operativos) {
      const r = await this.procesarEventoOperativo(sindicatoId, evento);
      errores += r;
      if (r === 0 && (evento.tipo === 'inicio_recorrido' || evento.tipo === 'fin_recorrido')) {
        entradas.operativos.push(evento);
      }
    }

    // Detección DESPUÉS de persistir toda la evidencia del lote (gps, cumplimientos y eventos
    // operativos): así un `cumplimiento` y el `inicio_recorrido`/`fin_recorrido` del MISMO lote
    // se ven entre sí sin importar el orden en que llegaron. Nunca cuenta como error de ingesta.
    await this.detectarInfracciones(sindicatoId, entradas);
    // Conteo de vueltas (docs/plan-molinos-designacion.md, F1) sobre la misma evidencia ya
    // persistida. Mismo contrato: jamás cuenta como error de ingesta, solo se loguea.
    await this.procesarVueltas(sindicatoId, entradas);

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

  private async procesarGpsPoints(
    sindicatoId: string,
    eventos: EventoSync[],
  ): Promise<{ errores: number }> {
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
    } catch (error) {
      await Promise.all(
        eventos.map((evento) => this.registrarErrorSync(sindicatoId, evento, error)),
      );
      return { errores: eventos.length };
    }
    return { errores: 0 };
  }

  /**
   * Detección de infracciones (docs/plan-en-vivo-alertas.md, PR A) sobre la evidencia YA
   * persistida del lote: por sesión, primero el desvío de ruta (puntos + límites de recorrido) y
   * luego el PC omitido (cumplimientos cumplidos y `fin_recorrido`) en orden de `ts`, cada paso
   * en su propia transacción. Cualquier fallo se LOGUEA (estructurado: sesión + error) y NO se
   * propaga ni va a `sync_errors`: esa tabla es para eventos rechazados, y la evidencia ya
   * quedó guardada.
   */
  private async detectarInfracciones(
    sindicatoId: string,
    entradas: EntradasDeteccion,
  ): Promise<void> {
    const sesiones = new Map<string, EntradaSesion>();
    const de = (sesionId: string): EntradaSesion => {
      const e = sesiones.get(sesionId) ?? { puntos: [], marcadores: [], pcs: [] };
      sesiones.set(sesionId, e);
      return e;
    };
    for (const evento of entradas.gps) {
      const payload = evento.payload as unknown as PayloadGpsPoint;
      if (typeof payload.sesionId !== 'string') continue;
      de(payload.sesionId).puntos.push({
        ts: new Date(resolverTsFix(evento.payload, evento.ts)),
        lat: payload.lat,
        lng: payload.lng,
        accuracy: typeof payload.accuracy === 'number' ? payload.accuracy : null,
      });
    }
    for (const { evento, ts } of entradas.cumplimientos) {
      const payload = evento.payload as unknown as PayloadCumplimientoPuntoControl;
      if (typeof payload.sesionId !== 'string') continue;
      de(payload.sesionId).pcs.push({
        tipo: 'cumplimiento',
        ts: new Date(ts),
        puntoControlId: payload.puntoControlId,
      });
    }
    for (const evento of entradas.operativos) {
      const sesionId = extraerSesionId(evento.payload);
      if (!sesionId) continue;
      const e = de(sesionId);
      const ts = new Date(evento.ts);
      e.marcadores.push({ tipo: evento.tipo === 'inicio_recorrido' ? 'inicio' : 'fin', ts });
      if (evento.tipo === 'fin_recorrido') e.pcs.push({ tipo: 'fin', ts });
    }

    for (const [sesionId, e] of sesiones) {
      if (e.puntos.length > 0 || e.marcadores.length > 0) {
        try {
          const { abiertas, cerradas } = await withTenantContext(
            { rol: 'admin_quivo', sindicatoId },
            (tx) => procesarDesvioSesion(tx, sindicatoId, sesionId, e.puntos, e.marcadores),
          );
          if (abiertas > 0 || cerradas > 0) {
            this.logger.log(
              `Desvío de ruta, sesión ${sesionId}: ${abiertas} abierta(s), ${cerradas} cerrada(s)`,
            );
          }
        } catch (error) {
          this.registrarFalloDeteccion(sindicatoId, sesionId, 'desvio_ruta', error);
        }
      }
      // Orden de `ts` (estable; ante empate el cumplimiento va antes que el fin).
      const pcs = [...e.pcs].sort(
        (a, b) => a.ts.getTime() - b.ts.getTime() || (a.tipo === b.tipo ? 0 : a.tipo === 'cumplimiento' ? -1 : 1),
      );
      for (const pc of pcs) {
        try {
          await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
            pc.tipo === 'cumplimiento'
              ? detectarPcOmitidosPorCumplimiento(tx, sindicatoId, sesionId, pc.puntoControlId, pc.ts)
              : detectarPcOmitidosAlFinRecorrido(tx, sindicatoId, sesionId, pc.ts),
          );
        } catch (error) {
          this.registrarFalloDeteccion(sindicatoId, sesionId, 'pc_omitido', error);
        }
      }
    }
  }

  /**
   * Vueltas por sesión (`deteccion-vueltas.ts`), una transacción por sesión con el lock de la
   * máquina. Se corre para toda sesión con evidencia en el lote (también solo GPS: resuelve la
   * salida del punto de espera). Los fallos se loguean y NO se propagan.
   */
  private async procesarVueltas(sindicatoId: string, entradas: EntradasDeteccion): Promise<void> {
    const sesiones = new Map<string, EntradaVueltasSesion>();
    const de = (sesionId: string): EntradaVueltasSesion => {
      const e = sesiones.get(sesionId) ?? {
        cumplimientos: [],
        inicios: [],
        fines: [],
        hayGps: false,
        ultimoTs: null,
      };
      sesiones.set(sesionId, e);
      return e;
    };
    // `ts` más reciente del lote por sesión (referencia de antigüedad de las esperas pendientes).
    const tocar = (e: EntradaVueltasSesion, ts: Date) => {
      if (Number.isFinite(ts.getTime()) && (e.ultimoTs === null || ts > e.ultimoTs)) e.ultimoTs = ts;
    };
    for (const evento of entradas.gps) {
      const sesionId = extraerSesionId(evento.payload);
      if (!sesionId) continue;
      const e = de(sesionId);
      e.hayGps = true;
      // Mismo `ts` con el que se persiste el fix en `gps_points`.
      tocar(e, new Date(resolverTsFix(evento.payload, evento.ts)));
    }
    for (const { evento, ts } of entradas.cumplimientos) {
      const payload = evento.payload as unknown as PayloadCumplimientoPuntoControl;
      if (typeof payload.sesionId !== 'string') continue;
      tocar(de(payload.sesionId), new Date(ts));
      de(payload.sesionId).cumplimientos.push({
        ts: new Date(ts),
        puntoControlId: payload.puntoControlId,
        lat: payload.lat,
        lng: payload.lng,
      });
    }
    for (const evento of entradas.operativos) {
      const sesionId = extraerSesionId(evento.payload);
      if (!sesionId) continue;
      tocar(de(sesionId), new Date(evento.ts));
      (evento.tipo === 'inicio_recorrido' ? de(sesionId).inicios : de(sesionId).fines).push(
        new Date(evento.ts),
      );
    }
    for (const [sesionId, entrada] of sesiones) {
      try {
        const r = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
          procesarVueltasSesion(tx, sindicatoId, sesionId, entrada),
        );
        if (r.abiertas > 0 || r.cerradas > 0 || r.infracciones > 0) {
          this.logger.log(
            `Vueltas, sesión ${sesionId}: ${r.abiertas} abierta(s), ${r.cerradas} cerrada(s), ` +
              `${r.infracciones} infracción(es)`,
          );
        }
      } catch (error) {
        this.registrarFalloDeteccion(sindicatoId, sesionId, 'vueltas', error);
      }
    }
  }

  /** Falla de la detección: solo log estructurado (sesión + error). No va a `sync_errors`. */
  private registrarFalloDeteccion(
    sindicatoId: string,
    sesionId: string,
    detector: 'desvio_ruta' | 'pc_omitido' | 'vueltas',
    error: unknown,
  ): void {
    this.logger.error(
      {
        mensaje: 'Falló la detección de infracciones',
        detector,
        sindicatoId,
        sesionId,
        error: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error.stack : undefined,
    );
  }

  private async procesarCumplimiento(
    sindicatoId: string,
    evento: EventoSync,
  ): Promise<{ errores: number; cumplido?: { ts: string } }> {
    try {
      const { tsFixDescartado, cumplido, ts } = await withTenantContext(
        { rol: 'admin_quivo', sindicatoId },
        (tx) => procesarCumplimientoEnTx(tx, sindicatoId, evento),
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
      return cumplido ? { errores: 0, cumplido: { ts } } : { errores: 0 };
    } catch (error) {
      await this.registrarErrorSync(sindicatoId, evento, error);
      return { errores: 1 };
    }
  }

  private async procesarEventoOperativo(sindicatoId: string, evento: EventoSync): Promise<number> {
    try {
      const { recorridoEstadoOmitidoPorDriftFuturo, driftFuturoMs } = await withTenantContext(
        { rol: 'admin_quivo', sindicatoId },
        (tx) => insertarEventoOperativoEnTx(tx, sindicatoId, evento),
      );
      if (recorridoEstadoOmitidoPorDriftFuturo) {
        // Mismo criterio que `procesarGpsPoints`/`procesarCumplimiento`: esto NUNCA debe
        // pasar en silencio — es la señal de un reloj de dispositivo corrido lo bastante
        // como para haber dejado atascado el estado derivado del recorrido de no ser por
        // este guard (ver el comentario en `insertarEventoOperativoEnTx`).
        this.logger.warn(
          `Evento ${evento.eventId} (${evento.tipo}) con ts futuro: sesión ` +
            `${extraerSesionId(evento.payload) ?? '?'}, device ${evento.deviceId}, ` +
            `drift +${((driftFuturoMs ?? 0) / 1000).toFixed(0)}s — recorridoEstado NO actualizado`,
        );
      }
      return 0;
    } catch (error) {
      await this.registrarErrorSync(sindicatoId, evento, error);
      return 1;
    }
  }

  private async registrarErrorSync(
    sindicatoId: string,
    evento: EventoSync,
    error: unknown,
  ): Promise<void> {
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

interface EntradaSesion {
  puntos: PuntoGpsEntrante[];
  marcadores: MarcadorRecorridoEntrante[];
  pcs: ({ tipo: 'cumplimiento'; ts: Date; puntoControlId: string } | { tipo: 'fin'; ts: Date })[];
}

interface EntradasDeteccion {
  gps: EventoSync[];
  cumplimientos: { evento: EventoSync; ts: string }[];
  operativos: EventoSync[];
}

export interface EventosPorTipo {
  gps_point: EventoSync[];
  cumplimiento_punto_control: EventoSync[];
  inicio_recorrido: EventoSync[];
  fin_recorrido: EventoSync[];
  observacion: EventoSync[];
  inicio_jornada: EventoSync[];
}

export function agruparPorTipo(eventos: EventoSync[]): EventosPorTipo {
  const grupos: EventosPorTipo = {
    gps_point: [],
    cumplimiento_punto_control: [],
    inicio_recorrido: [],
    fin_recorrido: [],
    observacion: [],
    inicio_jornada: [],
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
  // `gps_sesion_resumen` (docs/plan-en-vivo-resumen-sesion.md) se mantiene en el MISMO
  // statement que la evidencia, vía `WITH ins AS (INSERT ... RETURNING) INSERT ... SELECT`,
  // no con un trigger ni un job aparte — atómico con `gps_points`: si esto falla, no queda
  // evidencia insertada sin su resumen, ni viceversa.
  //
  // `ins` sale del `RETURNING` del INSERT con `ON CONFLICT DO NOTHING`: por eso solo trae
  // las filas EFECTIVAMENTE insertadas (un reenvío idempotente, RF-72, no aporta filas a
  // `ins`) — es justo lo que evita que `total_puntos` se infle con reenvíos.
  //
  // `jornada` se calcula bit a bit igual que `fechaActualBolivia`
  // (apps/api/src/common/tiempo/jornada.ts:13-16, Bolivia = UTC-4 fijo): la fecha calendario
  // de `ts - 4h` en UTC. Un mismo lote puede traer puntos de 2 jornadas distintas (sesión que
  // cruza medianoche boliviana) — el `GROUP BY` de `agregados`/`ultimo_punto` los separa en
  // grupos distintos, así que el upsert de abajo puede tocar 2 filas de resumen para la misma
  // sesión en una sola corrida, cada una con su propia PK `(sesion_id, jornada, sindicatoId)`.
  //
  // `ts AT TIME ZONE 'UTC'` ANTES de restar el intervalo y castear a `date` (code-review
  // MEDIUM): `ts` es `timestamptz`, y castear un `timestamptz` a `date` directamente
  // convierte primero al **TimeZone de la sesión/conexión** — que esta transacción de
  // ingesta NO fija a `UTC` en ningún punto (a diferencia de `crear_particion_gps_points`,
  // que sí lo hace). Si el pool de conexiones alguna vez trae una sesión con otro TimeZone
  // (config del servidor, una `SET TimeZone` pegada de una conexión reusada, etc.), esta
  // expresión calcularía una jornada distinta de `fechaActualBolivia` (aritmética pura en
  // UTC, sin TimeZone de sesión de por medio) — silenciosamente, sin error. `ts AT TIME ZONE
  // 'UTC'` convierte primero a un `timestamp` sin zona que representa la hora de pared UTC;
  // restarle el intervalo y castear ESE resultado a `date` es aritmética pura, sin ninguna
  // conversión de zona horaria, sin importar el TimeZone de la sesión.
  //
  // `agregados` resuelve el total y los `max()` de ingesta/fix SOLO sobre lo nuevo de este
  // lote; `ultimo_punto` (DISTINCT ON, con la misma tripleta de expresiones repetida en el
  // ORDER BY — Postgres exige que arranque igual que el DISTINCT ON) trae lat/lng/accuracy/
  // speed de la fila con el `ts` más reciente DE ESTE LOTE, para compararla en el
  // `ON CONFLICT DO UPDATE` contra lo que ya había. `"sindicatoId"` entra también en el
  // `DISTINCT ON`/`GROUP BY`/join (code-review MEDIUM, cross-tenant poisoning): un lote es
  // siempre de un único sindicato en la práctica (mismo motivo que el comentario de `filas`
  // más arriba), pero dejarlo explícito en la agrupación evita que dos tenants
  // distintos puedan colisionar jamás en la misma fila si esa invariante alguna vez se
  // rompe — la PK de 3 columnas de `gps_sesion_resumen` ya no lo permitiría de todos modos,
  // pero el join/agrupación tienen que ser consistentes con esa PK.
  //
  // `ORDER BY a.sesion_id, a.jornada, a."sindicatoId"` (code-review LOW — deadlock): dos
  // batches concurrentes que tocan las mismas filas de resumen (dos dispositivos de la
  // misma sesión, o el mismo dispositivo reintentando en paralelo) podrían, sin un orden
  // determinista, bloquear filas en órdenes cruzados y deadlockear en el `ON CONFLICT DO
  // UPDATE`. Ordenar la fuente del upsert por la PK completa asegura que CUALQUIER batch
  // concurrente adquiere los locks de fila en el mismo orden.
  //
  // El `DO UPDATE`: `total_puntos` SUMA (nunca reemplaza — cada corrida aporta puntos NUEVOS,
  // ya filtrados por el `ON CONFLICT DO NOTHING` de arriba); `ultimo_ingreso_ts` es GREATEST
  // (la ingesta más reciente, sin importar qué tan viejo sea el `ts` del punto que la
  // disparó — un punto tardío del outbox SÍ actualiza "cuándo se supo de la sesión por
  // última vez"); lat/lng/accuracy/speed/`ultimo_fix_ts` SOLO se pisan si el fix de este lote
  // es más nuevo que el que ya estaba guardado — así un punto tardío (`ts` viejo, típico del
  // outbox móvil reenviando tras estar offline) nunca pisa la última posición conocida.
  // `"sindicatoId"` NUNCA se toca en el `SET` — es parte de la PK, no hay fila existente con
  // otro valor con la que pueda entrar en conflicto.
  await tx.$executeRaw(Prisma.sql`
    WITH ins AS (
      INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
      VALUES ${Prisma.join(filas)}
      ON CONFLICT (event_id, ts) DO NOTHING
      RETURNING sesion_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId"
    ),
    agregados AS (
      SELECT
        sesion_id,
        ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
        "sindicatoId",
        count(*)::int AS total_puntos,
        max(ts) AS ultimo_fix_ts,
        max(received_at) AS ultimo_ingreso_ts
      FROM ins
      GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
    ),
    ultimo_punto AS (
      SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
        sesion_id,
        ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
        "sindicatoId",
        lat, lng, accuracy, speed
      FROM ins
      ORDER BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId", ts DESC
    )
    INSERT INTO gps_sesion_resumen
      (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
    SELECT
      a.sesion_id, a.jornada, a."sindicatoId", a.total_puntos, a.ultimo_fix_ts, a.ultimo_ingreso_ts,
      u.lat, u.lng, u.accuracy, u.speed, now()
    FROM agregados a
    JOIN ultimo_punto u ON u.sesion_id = a.sesion_id AND u.jornada = a.jornada AND u."sindicatoId" = a."sindicatoId"
    ORDER BY a.sesion_id, a.jornada, a."sindicatoId"
    ON CONFLICT (sesion_id, jornada, "sindicatoId") DO UPDATE SET
      total_puntos = gps_sesion_resumen.total_puntos + EXCLUDED.total_puntos,
      ultimo_ingreso_ts = GREATEST(gps_sesion_resumen.ultimo_ingreso_ts, EXCLUDED.ultimo_ingreso_ts),
      lat = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.lat ELSE gps_sesion_resumen.lat END,
      lng = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.lng ELSE gps_sesion_resumen.lng END,
      accuracy = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.accuracy ELSE gps_sesion_resumen.accuracy END,
      speed = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.speed ELSE gps_sesion_resumen.speed END,
      ultimo_fix_ts = GREATEST(gps_sesion_resumen.ultimo_fix_ts, EXCLUDED.ultimo_fix_ts),
      updated_at = now()
  `);
  return tsFixDescartados;
}

export async function procesarCumplimientoEnTx(
  tx: Tx,
  sindicatoId: string,
  evento: EventoSync,
): Promise<{ tsFixDescartado: boolean; cumplido: boolean; ts: string }> {
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
  const tsFixDescartado =
    payload.tsFix !== undefined && Date.parse(payload.tsFix) !== Date.parse(ts);
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
        // Multi-vuelta (plan §2.3): `pasada` es OPCIONAL en el payload (APKs anteriores a
        // este cambio nunca lo mandan) — `?? null` en vez de dejarlo `undefined` para que
        // Prisma persista explícitamente NULL, no que omita la columna del INSERT (con
        // `createMany` un campo `undefined` se trata igual que ausente, que es el
        // comportamiento correcto acá de todos modos, pero `?? null` lo deja inequívoco).
        // NUNCA se usa `pasada` como parte de una clave de idempotencia — sigue siendo
        // `eventId` solamente (`skipDuplicates` de abajo), ver el comentario de la
        // migración `20260817140000_cumplimientos_pc_pasada` sobre por qué un UNIQUE
        // compuesto acá sería peligroso.
        //
        // Hallazgo de revisión (medio): `PayloadCumplimientoPuntoControlSchema` (que declara
        // `pasada: z.number().int().positive().optional()`) NUNCA se corre contra el payload
        // real — `EventoSyncSchema.payload` (único schema que valida `SyncController`, vía
        // `SyncBatchSchema`) es `z.record(z.unknown())`, así que `payload.pasada` llega acá
        // sin validar pese a lo que decía este comentario antes. Un valor no entero o fuera
        // de rango de INT4 (p. ej. `"3"` de un cliente con un bug, o un número gigante) hace
        // que `createMany` lance una excepción de Postgres; `procesarCumplimiento` la atrapa
        // como `syncError`, y como el evento ya fue acusado al dispositivo (y purgado de su
        // outbox), ese cumplimiento se pierde para siempre. Coerciona en vez de confiar: un
        // `pasada` inválido se persiste como NULL (falla segura) en lugar de tirar el insert.
        pasada:
          typeof payload.pasada === 'number' &&
          Number.isInteger(payload.pasada) &&
          payload.pasada > 0 &&
          payload.pasada <= 2147483647
            ? payload.pasada
            : null,
      },
    ],
    skipDuplicates: true,
  });
  // `cumplido`/`ts` los usa el llamador para la detección de PC omitido (transacción aparte,
  // `detectarPcOmitidosPorCumplimiento`), no dentro de esta tx.
  return { tsFixDescartado, cumplido: row.cumplido, ts };
}

/**
 * `tipo` → `SesionOperativa.recorridoEstado` que le corresponde. Solo `inicio_recorrido` y
 * `fin_recorrido` mueven el estado derivado (Fase A, docs/plan-ubicacion-fluida.md);
 * `observacion` no participa — no representa un cambio de estado del recorrido.
 */
const RECORRIDO_ESTADO_POR_TIPO: Partial<Record<EventoSync['tipo'], 'en_curso' | 'finalizado'>> = {
  inicio_recorrido: 'en_curso',
  fin_recorrido: 'finalizado',
};

/**
 * Release 13 — `inicio_jornada` declara "hoy trabajo" para un vehículo, así que `sesionId`
 * tiene que ser una sesión de ESTE dispositivo y de ESTE sindicato: `evento.deviceId` y
 * `sindicatoId` son los AUTENTICADOS (ver el comentario del UPDATE de `recorridoEstado` en
 * `insertarEventoOperativoEnTx`), a diferencia de `payload.sesionId`, que controla el
 * dispositivo. Si no coincide (o la sesión no existe) se lanza: el llamador
 * (`procesarEventoOperativo`) lo registra en `sync_errors` y NO se inserta nada.
 *
 * Por ahora solo se aplica a `inicio_jornada` para no cambiar el comportamiento de los
 * demás eventos. La misma brecha existe en el resto de los tipos operativos y en gps
 * (`sesionId` del payload sin cruzar contra `deviceId`) — pendiente, saneamiento Fase 2.
 */
async function validarSesionDelDispositivo(
  tx: Tx,
  sindicatoId: string,
  evento: EventoSync,
): Promise<void> {
  const parsed = PayloadInicioJornadaSchema.safeParse(evento.payload);
  if (!parsed.success) {
    throw new Error(`Evento ${evento.eventId} (inicio_jornada) con payload inválido`);
  }
  const sesion = await tx.sesionOperativa.findFirst({
    where: { id: parsed.data.sesionId, sindicatoId, deviceId: evento.deviceId },
    select: { id: true, asignacion: { select: { fecha: true } } },
  });
  if (!sesion) {
    throw new Error(
      `Evento ${evento.eventId} (inicio_jornada): la sesión ${parsed.data.sesionId} no existe ` +
        `o no pertenece al dispositivo ${evento.deviceId} de este sindicato`,
    );
  }
  // La declaración "hoy trabajo" tiene que corresponder al día de la asignación de la
  // sesión (jornada boliviana del `ts` del evento). NO se exige que la sesión siga activa:
  // los eventos del outbox offline llegan legítimamente después del logout.
  const diaEvento = fechaActualBolivia(new Date(evento.ts));
  if (sesion.asignacion.fecha.getTime() !== diaEvento.getTime()) {
    throw new Error(
      `Evento ${evento.eventId} (inicio_jornada): el día del evento ` +
        `(${diaEvento.toISOString().slice(0, 10)}) no coincide con la fecha de la asignación ` +
        `de la sesión (${sesion.asignacion.fecha.toISOString().slice(0, 10)})`,
    );
  }
}

/**
 * `insertarEventoOperativoEnTx` devuelve esto en vez de loguear ella misma (es una función
 * standalone, sin `this.logger` — mismo patrón que `tsFixDescartado` en
 * `insertarGpsPoints`/`procesarCumplimientoEnTx`: la función de negocio señaliza, el método
 * de la clase que la llama logea).
 */
export interface ResultadoEventoOperativo {
  /** `true` cuando el evento traía un `ts` tan adelantado (> `DRIFT_ALERTA_MS` respecto del
   * reloj del server) que NO se tocó `recorridoEstado`/`recorridoEstadoTs` — el evento igual
   * quedó guardado en `eventos_operativos` (bitácora, ver el `createMany` de arriba). */
  recorridoEstadoOmitidoPorDriftFuturo: boolean;
  /** Solo con `recorridoEstadoOmitidoPorDriftFuturo: true` — cuántos ms adelantado venía
   * `evento.ts` respecto de `Date.now()`, para el warn del llamador. */
  driftFuturoMs?: number;
}

export async function insertarEventoOperativoEnTx(
  tx: Tx,
  sindicatoId: string,
  evento: EventoSync,
): Promise<ResultadoEventoOperativo> {
  const payload = evento.payload as unknown as { sesionId: string };
  if (!payload.sesionId) {
    throw new Error(`Evento ${evento.eventId} sin sesionId en el payload`);
  }
  if (evento.tipo === 'inicio_jornada') {
    await validarSesionDelDispositivo(tx, sindicatoId, evento);
  }
  const insertado = await tx.eventoOperativo.createMany({
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

  // Fase A (docs/plan-ubicacion-fluida.md) — estado DERIVADO del recorrido, en la MISMA
  // transacción que el `createMany` de arriba: el evento en `eventos_operativos` (bitácora)
  // y el estado resumido en `sesiones_operativas` quedan atómicos, mismo commit. NUNCA toca
  // `fin`/`estado` de `SesionOperativa` — esos son de la sesión de LOGIN (solo `logout` en
  // auth-movil los cambia). `sindicatoId` es el parámetro de esta función — el tenant
  // AUTENTICADO del lote (`LoteIngestaJob.sindicatoId`, resuelto en `SyncController` desde
  // la sesión móvil verificada, `sesion.sindicatoId` — `sync.controller.ts`), nunca un valor
  // leído del `payload` del evento (que el dispositivo controla).
  //
  // `insertado.count === 1` (decisión del chairman sobre un hallazgo de Codex): un
  // `eventId` DUPLICADO (`skipDuplicates` lo saltea, `count` sale 0) no debe tocar el estado
  // — defensa en profundidad además del guard por `ts` de abajo, para no depender solo de
  // ese guard ante un reenvío. Guard `"recorridoEstadoTs" IS NULL OR "recorridoEstadoTs" <
  // $ts` (no `<=`): tolera sync fuera de orden — un lote viejo que llega tarde (outbox,
  // reconexión) nunca pisa un estado más nuevo que ya se aplicó. `ts` es el del SOBRE del
  // evento (`EventoSync.ts`), no un `tsFix`: `inicio_recorrido`/`fin_recorrido` no tienen
  // payload de fix GPS (a diferencia de `gps_point`/`cumplimiento_punto_control`), así que
  // no hay nada que resolver acá.
  const recorridoEstado = RECORRIDO_ESTADO_POR_TIPO[evento.tipo];
  if (recorridoEstado && insertado.count === 1) {
    // FIX revisión (Fase A) — watermark del `ts` del DISPOSITIVO, sin cota: un `fin_recorrido`
    // con el reloj del teléfono muy adelantado (hora mal puesta, GPS con clock roto) escribía
    // un `recorridoEstadoTs` en el futuro. El guard `"recorridoEstadoTs" < $ts` de abajo es
    // monótono creciente, así que ESE watermark quedaba más alto que cualquier `ts` real
    // futuro — la sesión se atascaba en ese estado (`finalizado`/`en_curso`) sin que ningún
    // evento posterior, con reloj correcto, pudiera volver a actualizarla. Mismo umbral que
    // ya usa `detectarDriftReloj` (`DRIFT_ALERTA_MS`, definida arriba en este archivo) para no
    // introducir una segunda constante de drift que pueda divergir de esa. El evento SIGUE
    // guardándose como bitácora (`createMany` de arriba, ya ejecutado) — solo se omite el
    // UPDATE del estado derivado.
    const driftFuturoMs = new Date(evento.ts).getTime() - Date.now();
    if (driftFuturoMs > DRIFT_ALERTA_MS) {
      return { recorridoEstadoOmitidoPorDriftFuturo: true, driftFuturoMs };
    }
    // `AND "deviceId" = evento.deviceId` (hallazgo de Codex/code-review, además del guard
    // por `sindicatoId`): `evento.deviceId` es AUTENTICADO, no un valor libre del payload —
    // `SyncController.recibirLote` (apps/api/src/modules/sync/sync.controller.ts) rechaza
    // con 400 el lote ENTERO si algún evento trae un `deviceId` distinto del de la sesión
    // móvil verificada por `AuthMovilGuard` (`sesion.deviceId`), así que para cuando este
    // código corre ya está garantizado que `evento.deviceId === sesion.deviceId`. El guard
    // exige además que la sesión pertenezca a ESE dispositivo: sin él, un `sesionId` del
    // payload que en realidad pertenece a OTRO dispositivo del MISMO sindicato (payload
    // corrupto, o dos sesiones simultáneas del mismo vehículo en dos teléfonos — caso real,
    // ver el comentario de `SesionEnVivoResumenSchema` en `@quivo/shared`) dejaría que el
    // dispositivo A marque como `finalizado`/`en_curso` el recorrido de la sesión del
    // dispositivo B.
    await tx.$executeRaw`
      UPDATE sesiones_operativas
      SET "recorridoEstado" = ${recorridoEstado}, "recorridoEstadoTs" = ${new Date(evento.ts)}
      WHERE id = ${payload.sesionId} AND "sindicatoId" = ${sindicatoId}
        AND "deviceId" = ${evento.deviceId}
        AND ("recorridoEstadoTs" IS NULL OR "recorridoEstadoTs" < ${new Date(evento.ts)})
    `;
  }
  return { recorridoEstadoOmitidoPorDriftFuturo: false };
}

function extraerSesionId(payload: EventoSync['payload']): string | null {
  const valor = (payload as { sesionId?: unknown }).sesionId;
  return typeof valor === 'string' ? valor : null;
}
