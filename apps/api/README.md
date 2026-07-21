# @quivo/api

Esqueleto NestJS (adapter Fastify) — monolito modular por dominio (doc técnico §2, §3).

## Correr en local

```bash
docker compose up -d           # Postgres+PostGIS (puerto 5434) + Redis, desde la raíz del repo
cp .env.example .env           # y ajustar DATABASE_URL al puerto 5434 si difiere
pnpm --filter @quivo/api build
pnpm --filter @quivo/api start  # node dist/main.js
```

> El script `dev` (`tsx watch`) sirve para las apps `web`/`mobile`, pero **no** para `api`:
> `tsx`/esbuild no emiten metadata de decoradores TypeScript, y NestJS la necesita para
> inyección de dependencias por tipo. Para iterar en la API, compilar con `tsc` (o `tsc --watch`)
> y correr el JS emitido con `node`/`node --watch`.

## Endpoints

- `GET /v1/_internal/ping` — liveness simple, sin tocar DB/Redis.
- `GET /v1/health` — readiness: verifica Postgres y Redis, 200 si ambos están `up`, 503 si no.
  Se sirve bajo `/v1` (no como `/health` sin versionar): `setGlobalPrefix(..., { exclude })`
  rompe el hook de logging de `nestjs-pino` sobre Fastify para las rutas excluidas — se
  prefirió mantener logging consistente en todas las rutas sobre la convención de un
  health-check sin prefijo.
- `POST /v1/_internal/validate-demo` — endpoint de diagnóstico: valida el body contra
  `CrearSindicatoSchema` de `@quivo/shared` usando el pipe global de Zod. Se retira cuando
  el módulo `sindicatos` real (QUI-220) exponga su propio CRUD.

## Estructura

Ver `src/modules/README.md` para la convención de módulos de dominio (un módulo por
carpeta, comunicación solo vía `index.ts`).

## Logging, salud y observabilidad

- `nestjs-pino`: JSON estructurado, `request_id` (UUID, generado por Fastify) en cada línea
  de request completada.
- Sentry se inicializa en `main.ts` si `SENTRY_DSN` está seteado (no falla si está vacío).
