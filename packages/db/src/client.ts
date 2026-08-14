import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

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
 * que las migraciones, las políticas RLS serían un no-op silencioso. Cae a `DATABASE_URL`
 * si no está seteada para no romper entornos que todavía no la configuraron, pero en ese
 * caso RLS no se está probando de verdad.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg(process.env.RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL ?? '');

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
