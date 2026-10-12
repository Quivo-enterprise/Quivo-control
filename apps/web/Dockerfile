# syntax=docker/dockerfile:1.7

# QUI-213 — Imagen propia para @quivo/web (panel admin, Next.js App Router). Cloud Run no
# tiene región sudamericana en Firebase App Hosting, así que el panel se despliega como
# servicio de Cloud Run igual que @quivo/api: DOS Dockerfiles, uno por app (ver el
# Dockerfile de la raíz para @quivo/api) — NO una imagen con dos CMD, porque acá no
# comparten el mismo código compilado (sí comparten @quivo/shared vía workspace:*).
#
# Mismo patrón que el Dockerfile raíz: multi-stage con `turbo prune` para que el contexto
# de build de esta imagen incluya sólo @quivo/web y sus dependencias workspace:* reales
# (@quivo/shared, @quivo/design-system) — no apps/api ni apps/mobile.
#
# @quivo/design-system está vendorizado en packages/design-system (dejó de ser un symlink
# `link:` al repo hermano Design_System_QUIVO, ver next.config.ts) pero sigue siendo un
# paquete de workspace normal — `workspace:*` en package.json, listado en
# pnpm-workspace.yaml bajo `packages/*` igual que @quivo/shared. `turbo prune` lo detecta
# solo por el grafo de dependencias, sin tratamiento especial. Next además lo transpila
# (`transpilePackages` en next.config.ts) y en modo standalone termina bundleado dentro de
# .next/server — no queda como entrada de node_modules en el output final.

FROM node:22-alpine AS base
RUN corepack enable

# ---------- pruner: recorta el monorepo a @quivo/web + sus deps workspace:* ----------
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@2.10.5
COPY . .
RUN turbo prune @quivo/web --docker

# ---------- builder: instala y compila (next build, output: 'standalone') ----------
FROM base AS builder
WORKDIR /app
RUN corepack prepare pnpm@11.3.0 --activate

# Prisma 7: `packages/db/prisma.config.ts` resuelve `DATABASE_URL` vía `env()` al CARGAR el
# config file. Por la misma trampa de root-devDependency explicada más abajo (@quivo/db
# termina en el grafo de @quivo/web pese a que apps/web no la usa), `pnpm turbo run build
# --filter=@quivo/web...` incluye a @quivo/db en el scope y corre su script `build`
# (`prisma generate && tsc`), que carga ese config file igual que el `postinstall`. Sin esta
# variable revienta con "PrismaConfigEnvError: Cannot resolve environment variable:
# DATABASE_URL" antes de compilar nada — mismo síntoma, mismo fix que /Dockerfile:28-40
# (stage `builder` de @quivo/api). Valor dummy, sólo de build-time, sólo en este stage
# `builder` — el stage `runner` arranca de `node:22-alpine` de nuevo (no hereda `ENV` de
# `builder`), así que esta URL no existe en la imagen final ni se usa para conectar a nada
# real (apps/web tampoco tiene runtime DB access).
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DATABASE_URL=${DATABASE_URL}

# Sólo los package.json podados primero — capa de `pnpm install` cacheable por Docker que
# no se invalida por cambios en el código fuente (sólo por cambios de dependencias).
COPY --from=pruner /app/out/json/ .

# Trampa de `turbo prune`: el `package.json` de la RAÍZ (2e710e3, QUI-340) agregó
# "@quivo/db": "workspace:*" a sus devDependencies porque los specs de aceptación de
# Playwright lo necesitan para limpiar datos vía Prisma tras cada test — no porque @quivo/web
# use la base de datos. `turbo prune @quivo/web --docker` SIEMPRE incluye el package.json de
# la raíz en el grafo podado, así que packages/db entra igual, y su `postinstall`
# (`prisma generate`, packages/db/package.json:10) corre durante el `pnpm install` de abajo.
# `out/json/` sólo trae package.json — sin el schema real, ese postinstall revienta con
# "Could not find Prisma Schema that is required for this command". Se copia acá, antes del
# install, para no perder el cacheo por capas del paso de arriba salvo que el schema/las
# migraciones cambien. Mismo fix que /Dockerfile:50 (stage `builder` de @quivo/api, que sí
# usa Prisma de entrada).
COPY --from=pruner /app/out/full/packages/db/prisma ./packages/db/prisma

RUN pnpm install --frozen-lockfile --filter=@quivo/web...

# Fuente completa podada (@quivo/web + @quivo/shared + @quivo/design-system).
COPY --from=pruner /app/out/full/ .

# Trampa de `turbo prune`: sólo copia paquetes del grafo (package.json + su código) más
# turbo.json/pnpm-workspace.yaml/.gitignore — NO arrastra config compartida en la raíz que
# esos paquetes referencian por ruta relativa. @quivo/design-system y @quivo/shared
# extienden "../../tsconfig.base.json" (ver packages/*/tsconfig.json) y `out/full/` no lo
# trae, así que sin esta copia el build de design-system revienta con TS5083 ("Cannot read
# file tsconfig.base.json") y en cascada pierde esModuleInterop (TS1259 en los .d.ts de
# react-leaflet). Se copia desde el checkout completo del stage `pruner` (antes de podar).
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

# NEXT_PUBLIC_* se inlinea en el bundle del cliente durante `next build` — NO es
# configurable en runtime vía `docker run -e` / variables de entorno de Cloud Run (eso
# sólo sirve para código que corre en el servidor). Para que apps/web hable con la API
# real hay que pasarlas como --build-arg en el paso de build de la imagen (Cloud Build),
# una vez por entorno. Sin build-arg, cae al fallback hardcodeado en el código fuente
# (src/lib/api/client.ts y src/lib/auth/api-client.ts: 'http://localhost:3000') — sólo
# vale para smoke tests locales, nunca para el piloto.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG NEXT_PUBLIC_DEV_BYPASS_AUTH=false
ENV NEXT_PUBLIC_DEV_BYPASS_AUTH=${NEXT_PUBLIC_DEV_BYPASS_AUTH}
# Google Maps (mapa de /en-vivo). La key es de navegador (restringida por referrer), no un secreto
# del servidor; igual no se versiona: el deploy la lee de Secret Manager y la pasa como build-arg.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
ENV NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=${NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID}

RUN pnpm turbo run build --filter=@quivo/web...

# ---------- runner: sólo el output standalone de Next + estáticos + public ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S quivo && adduser -S quivo -G quivo

# `output: 'standalone'` en un monorepo pnpm genera un árbol que refleja la ruta del
# workspace: .next/standalone/ (raíz podada: package.json + node_modules/.pnpm con sólo
# los paquetes realmente usados, vía Next file tracing) y
# .next/standalone/apps/web/ (server.js autocontenido + .next/ del build). Next NO copia
# .next/static ni public/ al standalone — hay que copiarlos aparte (docs oficiales de Next).
COPY --from=builder --chown=quivo:quivo /app/apps/web/.next/standalone ./
COPY --from=builder --chown=quivo:quivo /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=quivo:quivo /app/apps/web/public ./apps/web/public

USER quivo
WORKDIR /app/apps/web

# Cloud Run inyecta PORT en runtime (no fijarlo a 3000) — server.js (generado por Next en
# modo standalone) ya lee process.env.PORT y escucha en 0.0.0.0 por default. El valor de
# ENV acá es sólo un default local para `docker run` sin -e PORT; Cloud Run lo pisa.
ENV PORT=8080

# server.js (generado por Next standalone) hace `const hostname = process.env.HOSTNAME ||
# '0.0.0.0'`. Esta ENV es sólo el default para un `docker run` liso sin -e HOSTNAME (o sin
# hostname propio de Docker) — NO alcanza sola: Cloud Run inyecta su propio HOSTNAME=
# localhost al arrancar el contenedor, y una variable de entorno pasada en runtime
# (equivalente a `-e HOSTNAME=...`) SIEMPRE pisa el ENV horneado en la imagen — confirmado
# con `docker run -e HOSTNAME=localhost`: el server igual bindeaba a localhost pese a este
# ENV. El fix real está en el CMD de abajo, que reasigna HOSTNAME para ese único proceso.
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

# No usar `CMD ["node", "server.js"]` (forma exec): con eso, cualquier HOSTNAME que el
# entorno de ejecución inyecte (Cloud Run setea `localhost`; Docker sin -e setea el id del
# contenedor) llega intacto a process.env y pisa el ENV de arriba, porque una env var de
# runtime siempre gana sobre el ENV horneado en la imagen. Forma shell + reasignación
# inline: `HOSTNAME=0.0.0.0 exec node server.js` fija HOSTNAME sólo para ESTE proceso hijo,
# lo cual gana sobre cualquier HOSTNAME heredado del entorno del contenedor — así el server
# bindea a 0.0.0.0 sin importar qué inyecte Cloud Run. `exec` reemplaza el shell por el
# proceso node (no queda un shell intermedio) para que siga recibiendo SIGTERM directo.
CMD ["/bin/sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
