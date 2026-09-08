import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    // `prisma migrate diff --from-migrations` (a diferencia de `migrate dev`, que puede
    // auto-gestionar una shadow DB efímera) exige `shadowDatabaseUrl` seteada explícitamente.
    // `process.env.SHADOW_DATABASE_URL` (NO el helper `env()`, que lanza si falta) — si no
    // está seteada, queda `undefined` y sólo se pierde la posibilidad de correr `migrate
    // diff --from-migrations`; el resto (incluido `migrate dev`) sigue igual.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  // `initShadowDb` (abajo) exige este flag aunque no declaremos ninguna tabla/enum externo —
  // es sólo el gate que expone la opción, no cambia nada del comportamiento normal.
  experimental: { externalTables: true },
  migrations: {
    seed: 'tsx prisma/seed.ts',
    // `prisma migrate dev` recrea una shadow DB efímera y reproduce TODA la historia de
    // migraciones desde cero contra ella. La migración `20260730030000_habilitar_postgis`
    // ya corre `CREATE EXTENSION IF NOT EXISTS postgis;` como primer paso de esa historia
    // (ver su propio comentario) — pero `initShadowDb` (abajo) corre ANTES, porque Prisma
    // lo ejecuta justo DESPUÉS de resetear la shadow DB (`DROP SCHEMA public CASCADE;
    // CREATE SCHEMA public;`, que se lleva puesta cualquier extensión ya instalada ahí) y
    // ANTES de reproducir la historia de migraciones. O sea: `initShadowDb` sigue siendo lo
    // primero que toca la shadow DB en cada corrida, y queda como red de seguridad —
    // `IF NOT EXISTS` en ambos lados (acá y en la migración) hace que sea idempotente sin
    // importar cuál de los dos corra primero. Sólo `postgis`: ninguna migración usa
    // funciones de `fuzzystrmatch` (grep sobre migrations/*.sql sin resultados), aunque esa
    // extensión también esté instalada en `quivo_control` — no hace falta en la shadow DB.
    initShadowDb: 'CREATE EXTENSION IF NOT EXISTS postgis;',
  },
});
