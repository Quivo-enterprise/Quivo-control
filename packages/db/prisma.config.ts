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
    // migraciones desde cero contra ella. `20260730151939_core_entities` (la primera) usa
    // `geography(...)` sin que ninguna migración haya corrido `CREATE EXTENSION postgis`
    // antes (la extensión está pre-instalada en `quivo_control` vía la imagen Docker
    // `postgis/postgis`, no vía migración) — la shadow DB efímera arranca sin la extensión y
    // el replay falla con "type geography does not exist" (documentado en docs/handoff.md,
    // sección QUI-231: "migrate dev sigue roto por el gap de PostGIS en la shadow DB").
    // `initShadowDb` corre DESPUÉS de que Prisma resetea la shadow DB (`DROP SCHEMA public
    // CASCADE; CREATE SCHEMA public;`, que se lleva puesta cualquier extensión ya instalada
    // ahí) pero ANTES de reproducir la historia de migraciones — el lugar correcto para
    // dejarla lista otra vez. Sólo `postgis`: ninguna migración usa funciones de
    // `fuzzystrmatch` (grep sobre migrations/*.sql sin resultados), aunque esa extensión
    // también esté instalada en `quivo_control` — no hace falta en la shadow DB.
    initShadowDb: 'CREATE EXTENSION IF NOT EXISTS postgis;',
  },
});
