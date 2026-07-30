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
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg(process.env.DATABASE_URL ?? '');

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
