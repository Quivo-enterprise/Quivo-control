# syntax=docker/dockerfile:1.7

# QUI-354 — Imagen única para @quivo/api: el servidor HTTP (apps/api/src/main.ts) y su
# worker de ingesta/GPS (apps/api/src/worker.ts) son el mismo código compilado, con dos
# entrypoints distintos. Un solo Dockerfile, NO dos imágenes: Cloud Run corre dos
# *servicios* desde esta misma imagen, cada uno con su propio *command override* — ver el
# bloque de CMD al final del stage `runner`.
#
# Multi-stage con `turbo prune` (recomendado por Turborepo para monorepos pnpm) para que el
# contexto de build de esta imagen incluya sólo @quivo/api y sus dependencias workspace:*
# reales (@quivo/db, @quivo/shared) — no apps/web ni apps/mobile.

FROM node:22-alpine AS base
RUN corepack enable

# ---------- pruner: recorta el monorepo a @quivo/api + sus deps workspace:* ----------
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@2.10.5
COPY . .
RUN turbo prune @quivo/api --docker

# ---------- builder: instala (dispara postinstall -> prisma generate) y compila ----------
FROM base AS builder
WORKDIR /app
RUN corepack prepare pnpm@11.3.0 --activate

# Prisma 7: `packages/db/prisma.config.ts` resuelve `DATABASE_URL` vía `env()` al CARGAR el
# config file — lo necesita tanto el `postinstall` (`prisma generate`) del `pnpm install`
# de abajo como el script `build` de @quivo/db que corre turbo más adelante (`prisma
# generate && tsc`), aunque `generate` nunca abre una conexión real a la base (sólo lee
# schema.prisma). Sin esta variable el config revienta al cargarse con
# "PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL" antes de llegar
# a compilar nada. Valor dummy, sólo de build-time, sólo en esta stage `builder` — el stage
# `runner` arranca de `node:22-alpine` de nuevo (no hereda `ENV` de `builder`) y sólo copia
# archivos vía `COPY --from=builder`, así que esta URL no existe en la imagen final ni se
# usa para conectar a nada real. En Cloud Run la URL real (`DATABASE_URL`/
# `RUNTIME_DATABASE_URL`) llega en runtime por Secret Manager — ver packages/db/src/client.ts.
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DATABASE_URL=${DATABASE_URL}

# Sólo los package.json podados primero — capa de `pnpm install` cacheable por Docker que
# no se invalida por cambios en el código fuente (sólo por cambios de dependencias).
COPY --from=pruner /app/out/json/ .

# `out/json/` sólo trae package.json — el `postinstall` de packages/db (`prisma generate`)
# necesita el schema real, si no falla con "Could not find Prisma Schema". Se copia acá,
# antes del install, para no perder el cacheo por capas del paso de arriba salvo que el
# schema/las migraciones cambien.
COPY --from=pruner /app/out/full/packages/db/prisma ./packages/db/prisma

RUN pnpm install --frozen-lockfile --filter=@quivo/api...

# Fuente completa podada (incluye packages/db/prisma/schema.prisma, necesario para el
# `prisma generate` del postinstall de arriba y para el build de abajo).
COPY --from=pruner /app/out/full/ .

# Trampa de `turbo prune`: sólo copia paquetes del grafo (package.json + su código) más
# turbo.json/pnpm-workspace.yaml/.gitignore — NO arrastra config compartida en la raíz que
# esos paquetes referencian por ruta relativa. packages/db, packages/shared y apps/api
# extienden "../../tsconfig.base.json" (ver sus tsconfig.json) y `out/full/` no lo trae, así
# que sin esta copia el build revienta con TS5083 ("Cannot read file tsconfig.base.json") y
# en cascada pierde esModuleInterop y opciones de módulo (TS2307/TS1501/TS2737 en cascada).
# Mismo fix que apps/web/Dockerfile. Se copia desde el checkout completo del stage `pruner`
# (antes de podar).
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

# Prisma: el cliente NUNCA se declara como `outputs` de la task `build` en turbo.json —
# hacerlo permitiría que la caché de Turbo restaure un cliente Prisma stale (trampa ya
# documentada en este repo). Se genera vía el `postinstall` de packages/db/package.json,
# que ya corrió en el `pnpm install` de arriba — no depende de esta build de Turbo ni de si
# da cache hit (mismo razonamiento que el step "Install dependencies" de .github/workflows/ci.yml).
RUN pnpm turbo run build --filter=@quivo/api...

# ---------- runner: sólo lo necesario para correr node dist/*.js ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S quivo && adduser -S quivo -G quivo
COPY --from=builder /app .
USER quivo

EXPOSE 3000

# QUI-354: una sola imagen, dos comandos posibles (API vs worker) — NO dos imágenes.
# Default de esta imagen = API (servidor HTTP, escucha en $PORT — 3000 por default local,
# Cloud Run inyecta el suyo propio en runtime — liveness/readiness bajo /v1/health/live y
# /v1/health/ready). Los dos comandos posibles son:
#   CMD (api):    node apps/api/dist/main.js
#   CMD (worker): node apps/api/dist/worker.js
#
# El worker (apps/api/src/worker.ts) usa NestFactory.createApplicationContext — NO levanta
# servidor HTTP, no escucha en ningún puerto. Por eso NO se despliega como Cloud Run
# *service* normal (`gcloud run deploy` con --command/--args): todo service debe escuchar
# en $PORT dentro del startup timeout o el deploy falla con "container failed to start and
# listen on the port" — y aunque se le agregara un listener HTTP fake, un service normal
# escala a cero sin tráfico HTTP entrante y mataría al worker a mitad de consumir la cola
# (mismo razonamiento que llevó a QUI-213 a rescopearse, ver docs/adr/0002-gcp.md).
#
# QUI-213 / ADR 0002: el worker se despliega como **Cloud Run Worker Pool** (GA desde abril
# 2026, confirmado corriendo en southamerica-west1) — el recurso pensado para consumidores
# de cola: instancias persistentes sin modelo de request/respuesta, sin escalado a cero por
# falta de tráfico HTTP. Apunta a la MISMA imagen que la API, overrideando el comando:
#   gcloud run worker-pools deploy quivo-worker --image <esta-imagen> \
#     --region southamerica-west1 --command=node --args=apps/api/dist/worker.js \
#     --instances=1
# (o el equivalente en Terraform — recurso google_cloud_run_v2_worker_pool). Verificar los
# flags exactos contra la doc de Cloud Run Worker Pools al momento de desplegar.
CMD ["node", "apps/api/dist/main.js"]
