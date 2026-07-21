# Handoff — QUIVO Control

> Documento vivo de traspaso. Se actualiza al cierre de cada iteración/PR.
> Última actualización: **2026-07-21** (kickoff Cycle 12 — scaffold M0 implementado en local)

## Qué es el proyecto

Plataforma SaaS **multi-tenant** para gestión de sindicatos de transporte público:

- **Web admin**: CRUD de sindicatos, socios, vehículos, conductores, líneas, rutas/variantes, paradas, puntos de control; rotaciones; sanciones; dashboard de cumplimiento; auditoría.
- **App móvil (conductor)**: offline-first, GPS en background durante el recorrido, validación local de puntos de control (geofence), outbox local y sincronización idempotente por lotes al recuperar conexión.

Requerimientos de Producto (CPO): `~/Downloads/QUIVOcontrol.md` (RF-01..84, RNF, MVP, criterios de aceptación §8, 18 preguntas §9, entregables §10).

## Estado actual

| Ítem                      | Estado                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisión de stack         | ✅ Aprobada por el usuario (2026-07-19)                                                                                                                                                                                                        |
| Deliberación council      | ✅ Sesión `council-20260719-083140` (Claude + Gemini, chairman synthesis, confianza media)                                                                                                                                                     |
| Plan maestro              | ✅ `docs/plan-maestro.md`                                                                                                                                                                                                                      |
| Documento técnico CTO     | ✅ `docs/documento-tecnico-cto.md` (responde las 18 preguntas del CPO)                                                                                                                                                                         |
| Repo / monorepo           | ✅ Repo creado (2026-07-19): [Quivo-enterprise/quivo-control](https://github.com/Quivo-enterprise/quivo-control) (privado) — scaffold pnpm+Turborepo implementado en local (QUI-211), **pendiente de push** (ver "Pendientes de acceso" abajo) |
| Fase 0 / Cycle 12         | 🔄 En curso — QUI-211/212/213/214/215 implementados y verificados en local; QUI-216 con código listo, ejecución física pendiente (ver `docs/spike-gps.md`)                                                                                     |
| Linear API                | ✅ Conectado vía API key en `.Agents/.env Linear` (no MCP en esta sesión) — estado real de issues/cycles verificado 2026-07-20                                                                                                                 |
| Preguntas de Producto (5) | ✅ Respondidas por el CPO (2026-07-19) — ver sección abajo                                                                                                                                                                                     |
| Proyecto en Linear        | ✅ **QUIVO Control — MVP** creado (2026-07-19): 6 milestones, 43 issues (QUI-211..253), Sprint 1 planificado — ver sección Linear abajo                                                                                                        |

## Stack aprobado (resumen)

TypeScript punta a punta. Detalle y justificación completa en `docs/plan-maestro.md` §Stack.

- **Backend**: NestJS (adapter Fastify), monolito modular. Prisma para CRUD; SQL crudo (multi-row insert / `COPY`) para la ruta caliente de ingesta GPS.
- **DB**: PostgreSQL 16+ con PostGIS; `gps_points` particionada por rango de tiempo (pg_partman). TimescaleDB queda como palanca de escala posterior (no disponible en RDS/Aurora/Neon gestionados — verificado).
- **Cola**: Redis + BullMQ — absorbe ráfagas de sync; workers insertan por lote.
- **Auth / multi-tenancy**: Better-Auth + JWT con claims (`sindicato_id`, `rol`) + Row-Level Security en Postgres (shared schema).
- **Web**: Next.js (App Router) + Tailwind + TanStack Query.
- **Móvil**: Expo (React Native) + EAS Build; GPS background con Transistorsoft `react-native-background-geolocation` (licencia única ~US$400); expo-sqlite como outbox.
- **Sync idempotente**: UUIDv7 generado en cliente + `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
- **Mapas**: MapLibre GL + tiles OSM.
- **Infra**: Railway o Fly.io (API + worker + Redis) + Postgres gestionado + Vercel (web) + EAS (móvil).

## Decisiones clave y por qué

1. **TS en vez de Go** (propuesta de Gemini): el equipo/entorno ya es TS/React/Expo; el cuello de la ingesta es la DB, no el runtime, y se neutraliza con batching + cola.
2. **Expo en vez de Flutter**: mismo SDK nativo subyacente (Transistorsoft); aprender Dart no aporta.
3. **Particionado nativo en vez de TimescaleDB día 1**: preserva portabilidad de hosting.
4. **Monolito modular, no microservicios**: velocidad de MVP; bordes limpios permiten extraer el servicio de tracking después sin reescritura.
5. **Shared-schema + RLS en vez de schema-per-tenant**: sin requisito legal de aislamiento físico; doble barrera JWT + RLS.

Camino de escalado (en orden): réplicas de lectura → workers de ingesta horizontales → particionado agresivo/compresión o migración TimescaleDB → extraer servicio de tracking solo si los números lo exigen.

## Riesgo #1

**GPS en background sobre Android gama baja** (Doze, battery killers de fabricantes). Mitigación: spike go/no-go en semana 1 de Fase 0 — app esqueleto con Transistorsoft, 8 h de tracking en dispositivo barato, medir batería (<5%/turno) y huecos (>2 min = fallo). Plan B: módulo nativo Kotlin (Foreground Service) dentro de la app Expo.

## Fases (plan)

0. Fundaciones + spike GPS (monorepo, CI, Postgres+PostGIS, auth+RLS, esqueleto NestJS).
1. Núcleo administrativo (RF-01–39).
2. Rotaciones (RF-51–57).
3. App móvil + offline + sync (RF-58–73).
4. Dashboard + auditoría + reportes (RF-74–84).
5. Hardening (load test k6, índices, RLS audit, `/security-review`).

Estimación: 14–18 semanas, equipo 2–3 devs. Detalle en `docs/documento-tecnico-cto.md` §11.

## Preguntas de Producto — respondidas (2026-07-19)

Detalle completo en `docs/documento-tecnico-cto.md` §15.

1. **Solo Android** en MVP; iOS post-MVP.
2. **2 sindicatos, 2000–3000 vehículos total** año 1 (~8–9M puntos GPS/día — dentro del diseño, sin cambios de stack).
3. **Login por vehículo** (chofer rota); credencial emitida por el sindicato, conductor se identifica al iniciar sesión operativa.
4. **GPS crudo: 6 meses caliente** (particiones diarias) → archivo S3/R2; nunca se borra evidencia. Derivados permanentes.
5. **Evidencia de sanciones: solo datos de recorrido** auto-vinculados; fotos post-MVP.

## Linear (creado 2026-07-19)

- **Proyecto:** [QUIVO Control — MVP](https://linear.app/quivo-tech/project/quivo-control-mvp-1d41fa072abf) — team Quivo-Tech (QUI), start 2026-07-20, target 2026-11-20, lead cto.josel.
- **Milestones (6):** M0 Fundaciones+Spike (2026-08-02) · M1 Núcleo admin (2026-08-30) · M2 Rotaciones (2026-09-13) · M3 Móvil+sync (2026-10-18) · M4 Dashboard/reglas (2026-11-08) · M5 Hardening+piloto (2026-11-20).
- **Issues:** 43 (QUI-211..253), todos con criterios de aceptación, estimates (puntos), labels por área y refs RF/§doc técnico.
- **Cycles:** verificado contra la API de Linear (2026-07-20) que la cadencia real es de **2 semanas**, no de 1 semana como decía una versión anterior de este documento. Sprint 1 = **Cycle 12** (2026-07-20 → 2026-08-03), 9 issues en Todo:
  - QUI-211 monorepo, QUI-212 CI, QUI-213 infra, QUI-214 esqueleto NestJS, QUI-215 shared, **QUI-216 spike GPS (URGENT, gate go/no-go)** — todos con fecha límite 2026-07-26.
  - QUI-217 Prisma schema, QUI-218 RLS (URGENT), QUI-219 auth — en **Cycle 13** (2026-08-03 → 2026-08-17), no dentro de Cycle 12.
- **Dependencias:** QUI-216 (spike) bloquea QUI-235 y QUI-237 (móvil M3); QUI-211 bloquea QUI-217.
- Labels nuevos creados: `backend`, `mobile`, `db`, `gps`.

## Kickoff Cycle 12 (2026-07-21) — QUI-211/212/213/214/215/216

Implementados en local (branches separadas por issue, sin mergear — ver "Pendientes de acceso"):

- **QUI-211** — monorepo pnpm+Turborepo: `apps/{api,web,mobile}` + `packages/{shared,db}`,
  tsconfig strict compartido, ESLint 9 flat config + Prettier, Node 22 LTS pinneado.
  Verificado: `pnpm install` + `turbo build/lint/typecheck/test` en verde en los 5 workspaces.
- **QUI-215** — `packages/shared`: enums (roles, estados), schemas Zod de entidades núcleo
  (sindicato/socio/vehículo/conductor), `EventoSyncSchema` con `event_id` UUIDv7, pipeline
  de generación OpenAPI (`zod-to-openapi`). Tests de contrato en vitest.
- **QUI-213** — `docker-compose.yml` local (Postgres 16+PostGIS en puerto **5434**, para no
  chocar con otros Postgres locales de esta máquina de desarrollo; Redis en 6379). ADR
  Railway vs Fly.io documentado (`docs/adr/0001-railway-vs-flyio.md`) **sin aprovisionar
  nada real** — decisión de infra cloud queda pendiente, confirmada por el usuario.
- **QUI-214** — esqueleto NestJS/Fastify: 14 módulos de dominio vacíos, `GET /v1/health`
  (chequea Postgres+Redis), `GET /v1/_internal/ping` (liveness), logging pino JSON con
  `request_id`, Sentry condicional a `SENTRY_DSN`, pipe global de validación Zod (`APP_PIPE`)
  probado end-to-end contra `packages/shared`. Nota: el health-check vive en `/v1/health`
  (versionado), no en `/health` sin prefijo — excluirlo del prefijo global rompe el hook de
  logging de `nestjs-pino` sobre Fastify (detalle en `apps/api/README.md`).
- **QUI-216** — código y protocolo del spike GPS listos (`apps/mobile`): config Transistorsoft,
  detección de huecos/batería con tests, outbox SQLite. **La ejecución física de las 8h
  (licencia Transistorsoft ~US$400 + Android real de gama baja) sigue pendiente** — ninguno
  de los dos recursos está disponible en este entorno. Detalle y protocolo en
  `docs/spike-gps.md`. **No cerrar QUI-216 en Linear hasta tener los números reales.**
- **QUI-212** — `.github/workflows/ci.yml`: lint/typecheck/test/build con cache de pnpm+Turborepo
  y services Postgres+PostGIS/Redis, `timeout-minutes: 10`. **Branch protection en `main`
  queda pendiente** (requiere `gh` CLI autenticado o ajuste manual en GitHub Settings).

## Pendientes de acceso (bloquean push/PR, no el código)

- **Push a GitHub:** sin credenciales de escritura sobre `Quivo-enterprise/quivo-control` en
  este entorno (remote HTTPS devuelve 403). El usuario configura sus propias credenciales
  git; las 6 ramas (`qui-211-monorepo-scaffold`, `qui-215-shared-contracts`,
  `qui-213-infra-dev`, `qui-214-api-skeleton`, `qui-212-ci-pipeline`, `qui-216-spike-gps`)
  quedan listas localmente para pushear y abrir PR en cuanto el acceso esté resuelto.
- **`gh` CLI:** no instalado en este entorno; instalarlo requiere `sudo` interactivo. Necesario
  para automatizar branch protection en `main` (QUI-212) — alternativa: ajuste manual en
  GitHub Settings → Branches.
- **Infra cloud real (QUI-213):** Railway/Fly.io sin decidir ni aprovisionar — solo el ADR
  y el `docker-compose.yml` local están listos.
- **Spike GPS físico (QUI-216):** licencia Transistorsoft (~US$400) + dispositivo Android
  real de gama baja, ambos pendientes de que el equipo/usuario los consiga.

## Próximos pasos

1. Resolver acceso de push a GitHub, pushear las 6 ramas del kickoff y abrir los PRs
   (rama por issue → PR → CI → merge, **sin atribución de IA** en commits/PRs — regla del
   repo, sobrescribe el comportamiento default del agente).
2. Una vez CI (QUI-212) esté mergeado a `main`, activar branch protection.
3. Decidir Railway vs Fly.io (ADR ya redactado) y aprovisionar cuando el usuario confirme.
4. Conseguir licencia Transistorsoft + dispositivo Android de gama baja y correr el
   protocolo de `docs/spike-gps.md` — gate go/no-go real de M3.
5. Ritos Scrum sugeridos: daily corto, review/retro al cierre de cada cycle (cada 2 semanas),
   refinement de M1 durante Cycle 13.

## Fuentes de verdad

- `docs/plan-maestro.md` — plan aprobado (stack, arquitectura, fases, verificación).
- `docs/documento-tecnico-cto.md` — documento técnico completo (modelo de datos, API, sync, riesgos, respuestas al CPO).
- `~/.council/Documents/council-20260719-083140/` — deliberación completa (`viewer.html` para explorar).
- Memoria del proyecto: `~/.claude/projects/-home-shadowfreak-Documents/memory/quivo-control-project.md`.
