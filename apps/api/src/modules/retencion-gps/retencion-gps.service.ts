import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Client, type QueryResult } from 'pg';
import {
  GPS_ARCHIVE_CSV_HEADER,
  gpsArchiveObjectKey,
  gpsRowToCsv,
  quoteIdentifier,
  type GpsArchiveRow,
} from './retencion-gps.logic.js';

const QUEUE_NAME = 'retencion-gps';
const JOB_NAME = 'archivar-particiones-gps';
const DEFAULT_SCHEDULE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 10_000;

interface ArchiveCandidate {
  [column: string]: unknown;
  partition_name: string;
  partition_date: Date | string;
}

interface ArchiveFile {
  path: string;
  rowCount: number;
  compressedBytes: number;
  sha256: string;
}

@Injectable()
export class RetencionGpsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetencionGpsService.name);
  private readonly enabled: boolean;
  private readonly connection?: Redis;
  private readonly queue?: Queue;
  private readonly worker?: Worker;
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  // `@Inject(ConfigService)` explícito: `tsx`/esbuild (usado por `dev`/`dev:worker`) no
  // emite `design:paramtypes` para clases importadas desde paquetes externos (evanw/esbuild#257)
  // — sin esto, `config` llega `undefined` en runtime bajo dev y este constructor explota en
  // el primer `config.get(...)`. Ver detalle completo en `health/health.service.ts`.
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.enabled = config.get<string>('GPS_ARCHIVE_ENABLED') === 'true';
    this.bucket = config.get<string>('GPS_ARCHIVE_BUCKET') ?? '';
    this.prefix = config.get<string>('GPS_ARCHIVE_PREFIX') ?? 'quivo-control';
    this.s3 = new S3Client({
      region: config.get<string>('AWS_REGION') ?? 'auto',
      endpoint: config.get<string>('GPS_ARCHIVE_ENDPOINT') || undefined,
      forcePathStyle: config.get<string>('GPS_ARCHIVE_FORCE_PATH_STYLE') === 'true',
    });

    if (!this.enabled) return;
    if (!this.bucket) throw new Error('GPS_ARCHIVE_BUCKET es requerido al habilitar archivo GPS');

    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6380';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
    this.worker = new Worker(QUEUE_NAME, () => this.archiveEligiblePartitions(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Archivo GPS ${job?.id} falló: ${error.message}`, error.stack);
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      this.logger.log('Archivo GPS deshabilitado (GPS_ARCHIVE_ENABLED != true)');
      return;
    }
    const every = positiveInteger(
      this.config.get<string>('GPS_ARCHIVE_SCHEDULE_MS'),
      DEFAULT_SCHEDULE_MS,
    );
    await this.queue.upsertJobScheduler(JOB_NAME, { every }, { name: JOB_NAME });
    await this.queue.add(JOB_NAME, {}, { removeOnComplete: true, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
    this.s3.destroy();
  }

  async archiveEligiblePartitions(): Promise<{ archived: number }> {
    const databaseUrl =
      this.config.get<string>('RUNTIME_DATABASE_URL') ?? this.config.get<string>('DATABASE_URL');
    if (!databaseUrl) throw new Error('RUNTIME_DATABASE_URL o DATABASE_URL es requerido');

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let archived = 0;
    try {
      const candidates = await this.findCandidates(client);
      for (const candidate of candidates) {
        if (await this.archivePartition(client, candidate)) archived += 1;
      }
    } finally {
      await client.end();
    }
    return { archived };
  }

  private async findCandidates(client: Client): Promise<ArchiveCandidate[]> {
    const retentionMonths = positiveInteger(this.config.get<string>('GPS_RETENTION_MONTHS'), 6);
    const maxPartitions = positiveInteger(
      this.config.get<string>('GPS_ARCHIVE_MAX_PARTITIONS_PER_RUN'),
      1,
    );
    const result = await client.query<ArchiveCandidate>(
      `SELECT child.relname AS partition_name,
              to_date(substring(child.relname from 12 for 8), 'YYYYMMDD') AS partition_date
         FROM pg_inherits
         JOIN pg_class parent ON parent.oid = inhparent
         JOIN pg_class child ON child.oid = inhrelid
        WHERE parent.relname = 'gps_points'
          AND child.relname ~ '^gps_points_[0-9]{8}$'
          AND to_date(substring(child.relname from 12 for 8), 'YYYYMMDD')
                < CURRENT_DATE - make_interval(months => $1::int)
          AND NOT EXISTS (
                SELECT 1 FROM gps_archives archive
                 WHERE archive."partitionName" = child.relname
              )
        ORDER BY partition_date
        LIMIT $2`,
      [retentionMonths, maxPartitions],
    );
    return result.rows;
  }

  private async archivePartition(client: Client, candidate: ArchiveCandidate): Promise<boolean> {
    const partitionName = candidate.partition_name;
    const partitionIdentifier = quoteIdentifier(partitionName);
    const tempDirectory = await mkdtemp(join(tmpdir(), 'quivo-gps-archive-'));
    const filePath = join(tempDirectory, `${partitionName}.csv.gz`);
    let inTransaction = false;

    try {
      await client.query('BEGIN');
      inTransaction = true;
      const lock = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext('quivo-retencion-gps')) AS locked`,
      );
      if (!lock.rows[0]?.locked) {
        await client.query('ROLLBACK');
        inTransaction = false;
        this.logger.warn('Otro proceso de retención GPS está activo; se omite esta ejecución');
        return false;
      }

      // Bloquea únicamente la partición fría. La exportación, carga y verificación ocurren
      // bajo el mismo lock: ninguna llegada tardía puede quedar fuera del objeto archivado.
      await client.query(`LOCK TABLE ${partitionIdentifier} IN ACCESS EXCLUSIVE MODE`);
      const archive = await this.exportPartition(client, partitionIdentifier, filePath);
      const objectKey = gpsArchiveObjectKey(this.prefix, partitionName);
      await this.uploadAndVerify(objectKey, archive);

      await client.query(
        `INSERT INTO gps_archives
          (id, "partitionName", "partitionDate", bucket, "objectKey", "rowCount",
           "compressedBytes", sha256, "archivedAt")
         VALUES ($1, $2, $3::date, $4, $5, $6::bigint, $7::bigint, $8, now())`,
        [
          randomUUID(),
          partitionName,
          candidate.partition_date,
          this.bucket,
          objectKey,
          archive.rowCount,
          archive.compressedBytes,
          archive.sha256,
        ],
      );
      await client.query(`SELECT finalizar_archivo_gps($1)`, [partitionName]);
      await client.query('COMMIT');
      inTransaction = false;
      this.logger.log(
        `${partitionName}: ${archive.rowCount} filas archivadas en s3://${this.bucket}/${objectKey}`,
      );
      return true;
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private async exportPartition(
    client: Client,
    partitionIdentifier: string,
    filePath: string,
  ): Promise<ArchiveFile> {
    // Hallazgo 1 (code-review piloto, previo al lunes): este `client` es un `pg.Client`
    // crudo abierto con RUNTIME_DATABASE_URL — el rol `quivo_app`, NOSUPERUSER y
    // NOBYPASSRLS — y nunca pasa por `withTenantContext` (eso solo existe para el
    // `Prisma.TransactionClient`, ver `packages/db/src/tenant-context.ts`). Desde
    // `20260815120000_gps_points_sindicato_rls`, cada partición de `gps_points` tiene
    // `FORCE ROW LEVEL SECURITY` con la policy `tenant_isolation`. Sin fijar `app.rol` acá,
    // `current_setting('app.rol', true)` da NULL, el `USING` es NULL (=> ninguna fila
    // visible) para TODA la partición, y este método exportaba 0 filas de un día entero de
    // evidencia GPS — que igual se subía, se verificaba contra sí mismo (pasaba) y
    // `finalizar_archivo_gps()` igual hacía DETACH+DROP de la partición real (destrucción
    // silenciosa de evidencia legal).
    //
    // `admin_quivo` es el rol correcto acá (no un `sindicato_id` puntual): este job archiva
    // la partición ENTERA sin importar a qué sindicato pertenece cada fila. `set_config`
    // con `is_local=true` es el equivalente exacto de `SET LOCAL` — se descarta solo al
    // terminar la transacción que abre `archivePartition` (`BEGIN`/`COMMIT` alrededor de
    // esta llamada), nunca queda pegado a la conexión. Se fija ACÁ (no solo en el caller)
    // para que `exportPartition` sea correcto por sí mismo sin depender de que quien lo
    // invoque se acuerde de hacerlo — y así se puede probar en aislamiento (ver
    // `retencion-gps.service.integration.test.ts`).
    await client.query(`SELECT set_config('app.rol', $1, true)`, ['admin_quivo']);
    await client.query(`SELECT set_config('app.sindicato_id', $1, true)`, ['']);

    const gzip = createGzip({ level: 9 });
    const output = createWriteStream(filePath, { flags: 'wx' });
    const completion = pipeline(gzip, output);
    gzip.write(GPS_ARCHIVE_CSV_HEADER);

    let lastTs: Date | null = null;
    let lastEventId: string | null = null;
    let rowCount = 0;
    while (true) {
      const pagination: string = lastTs ? `WHERE (ts, event_id) > ($1::timestamptz, $2::uuid)` : '';
      const params: (Date | string | null)[] = lastTs ? [lastTs, lastEventId] : [];
      const result: QueryResult<GpsArchiveRow> = await client.query<GpsArchiveRow>(
        `SELECT event_id::text, sesion_id::text, device_id, ts, lat, lng,
                accuracy, speed, received_at, "sindicatoId"
           FROM ${partitionIdentifier}
           ${pagination}
          ORDER BY ts, event_id
          LIMIT ${PAGE_SIZE}`,
        params,
      );
      if (result.rows.length === 0) break;
      for (const row of result.rows) {
        if (!gzip.write(gpsRowToCsv(row))) {
          await new Promise<void>((resolve) => gzip.once('drain', resolve));
        }
      }
      rowCount += result.rows.length;
      const last: GpsArchiveRow | undefined = result.rows.at(-1);
      if (!last) break;
      lastTs = new Date(last.ts);
      lastEventId = last.event_id;
    }
    gzip.end();
    await completion;

    // Defensa en profundidad: un archivo vacío nunca es un éxito silencioso. Si el export
    // dio 0 filas, se lo vuelve a preguntar directamente a la partición (misma conexión,
    // mismo contexto admin_quivo recién fijado arriba) — si la partición SÍ tiene al menos
    // una fila, algo distinto de "el día no tuvo tráfico" está pasando (una regresión futura
    // de este mismo `set_config`, un bug de paginación, etc.) y el job debe fallar ruidoso
    // en vez de archivar+DROPear un CSV vacío sobre datos reales.
    if (rowCount === 0) {
      const check = await client.query<{ has_rows: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${partitionIdentifier}) AS has_rows`,
      );
      if (check.rows[0]?.has_rows) {
        throw new Error(
          `${partitionIdentifier}: el export devolvió 0 filas pero la partición SÍ tiene datos — ` +
            'posible pérdida de contexto de tenant (RLS) u otro bug de exportación. Se aborta para ' +
            'no archivar/eliminar evidencia GPS real con un CSV vacío.',
        );
      }
    }

    const fileStat = await stat(filePath);
    return {
      path: filePath,
      rowCount,
      compressedBytes: fileStat.size,
      sha256: await hashFile(filePath),
    };
  }

  private async uploadAndVerify(objectKey: string, archive: ArchiveFile): Promise<void> {
    const uploader = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: objectKey,
        Body: createReadStream(archive.path),
        ContentType: 'text/csv',
        ContentEncoding: 'gzip',
        ContentLength: archive.compressedBytes,
        Metadata: {
          sha256: archive.sha256,
          'row-count': String(archive.rowCount),
          format: 'quivo-gps-v1',
        },
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await uploader.done();

    // No se confía solo en ETag/metadatos (multipart no equivale a MD5): se vuelve a leer
    // el objeto remoto y se compara SHA-256 + bytes antes de retirar la partición.
    const remote = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!remote.Body) throw new Error(`S3/R2 devolvió un objeto sin cuerpo: ${objectKey}`);
    const remoteHash = createHash('sha256');
    let remoteBytes = 0;
    for await (const chunk of remote.Body as AsyncIterable<Uint8Array>) {
      remoteHash.update(chunk);
      remoteBytes += chunk.byteLength;
    }
    const remoteSha256 = remoteHash.digest('hex');
    if (remoteBytes !== archive.compressedBytes || remoteSha256 !== archive.sha256) {
      throw new Error(
        `Integridad inválida para ${objectKey}: local=${archive.compressedBytes}/${archive.sha256}, ` +
          `remoto=${remoteBytes}/${remoteSha256}`,
      );
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Valor entero inválido: ${value}`);
  return parsed;
}
