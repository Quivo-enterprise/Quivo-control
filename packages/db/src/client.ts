import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { resolvePoolConfig } from './pool-config.js';

/**
 * Carga `.env` acá mismo (no confiar en que quien importe este paquete ya lo haya
 * hecho): `apps/api` usa `@nestjs/config` (`ConfigModule.forRoot()`), pero ese `forRoot()`
 * recién corre dentro del cuerpo de `AppModule` — y todos los imports de `AppModule`
 * (incluido este paquete, vía AuthModule) se resuelven *antes* de que ese cuerpo se
 * ejecute. Sin esta carga propia, `process.env.DATABASE_URL` está `undefined` cuando se
 * construye el adapter de abajo. `config()` no pisa variables ya seteadas (por el shell,
 * Docker, etc.), así que es seguro correrlo dos veces.
 */
config();

/**
 * Singleton reusado por toda la app — evita agotar el pool de conexiones de Postgres
 * con hot-reload en dev (cada `tsx watch` reload crearía un `PrismaClient` nuevo si no
 * se reusara una instancia global).
 *
 * Prisma 7 ya no acepta la URL de conexión en `schema.prisma` (ver prisma.config.ts) ni
 * en el constructor de `PrismaClient` directamente — el cliente en runtime se conecta
 * vía un driver adapter (`@prisma/adapter-pg`, sobre `pg`), no el motor Rust embebido.
 *
 * `RUNTIME_DATABASE_URL` (rol `quivo_app`, sin superuser/BYPASSRLS) es intencionalmente
 * distinto de `DATABASE_URL` (rol de migraciones, dueño de las tablas): Postgres ignora
 * RLS para superusers/roles con BYPASSRLS sin importar `FORCE ROW LEVEL SECURITY` (QUI-218,
 * ver la migración `20260730152500_rls_multi_tenant`) — si este cliente usara el mismo rol
 * que las migraciones, las políticas RLS serían un no-op silencioso.
 *
 * Por eso, fuera de `development`, la ausencia de `RUNTIME_DATABASE_URL` es un error fatal
 * y no un fallback silencioso: degradar en silencio a `DATABASE_URL` fue justo lo que
 * disfrazó una variable de entorno faltante como "12 tests de RLS en rojo" en vez de "la
 * conexión está mal configurada" (ver `turbo.json`, `env` de la tarea `test` — Turbo en
 * `envMode: strict` borra del proceso cualquier variable no declarada). En `development` sí
 * se permite el fallback, pero avisando por `console.warn`: en ese modo no hay tests de
 * aislamiento corriendo, así que degradar no genera una señal falsa.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const runtimeDatabaseUrl = process.env.RUNTIME_DATABASE_URL;
const nodeEnv = process.env.NODE_ENV;

let resolvedDatabaseUrl: string;

if (runtimeDatabaseUrl) {
  resolvedDatabaseUrl = runtimeDatabaseUrl;
} else if (nodeEnv === 'development') {
  console.warn(
    '[@quivo/db] RUNTIME_DATABASE_URL no está seteada: usando DATABASE_URL (rol de migraciones, ' +
      'con BYPASSRLS) como fallback de desarrollo. El aislamiento multi-tenant (RLS) queda ' +
      'desactivado con este fallback — no representa el comportamiento de producción. Seteá ' +
      'RUNTIME_DATABASE_URL para probar el aislamiento real.',
  );
  resolvedDatabaseUrl = process.env.DATABASE_URL ?? '';
} else {
  throw new Error(
    `RUNTIME_DATABASE_URL no está seteada (NODE_ENV=${nodeEnv ?? 'sin definir'}). Esta variable ` +
      'conecta con el rol "quivo_app" (sin BYPASSRLS), la única barrera real de aislamiento ' +
      'multi-tenant entre sindicatos (RLS, QUI-218, migración 20260730152500_rls_multi_tenant). ' +
      'Sin ella este cliente caería en silencio a DATABASE_URL, el rol de migraciones con ' +
      'BYPASSRLS, y cualquier sindicato podría leer o escribir filas de otro. Seteá ' +
      'RUNTIME_DATABASE_URL antes de arrancar (o corré con NODE_ENV=development si es un entorno ' +
      'local sin esa variable todavía configurada).',
  );
}

// Pool acotado con timeouts (DB_POOL_MAX / DB_CONNECTION_TIMEOUT_MS / DB_STATEMENT_TIMEOUT_MS,
// ver pool-config.ts); `statement_timeout` viaja como parámetro de arranque de cada conexión.
const adapter = new PrismaPg({
  connectionString: resolvedDatabaseUrl,
  ...resolvePoolConfig(process.env),
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
