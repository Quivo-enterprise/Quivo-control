# Handoff — QUIVO Control

> Documento vivo de traspaso. Se actualiza al cierre de cada iteración/PR.
> Última actualización: **2026-07-31** (M2 completo. M4: QUI-248, QUI-244 y QUI-245 cerrados. Repaso M1-M4 hecho — ver sección propia. Quedan QUI-246/247/249, bloqueados por M3.)

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
| Repo / monorepo           | ✅ Repo creado (2026-07-19): [Quivo-enterprise/quivo-control](https://github.com/Quivo-enterprise/quivo-control) (privado) — rama `qui-227-web-nextjs-scaffold` (QUI-211..219, QUI-227) **pusheada** (2026-07-30); PR hacia `main` abierto, pendiente de review/merge |
| Fase 0 / Cycle 12         | ✅ QUI-211/212/213/214/215 implementados y verificados en local; QUI-216 con código listo, ejecución física pendiente (ver `docs/spike-gps.md`)                                                                                     |
| M1 kickoff — QUI-227      | ✅ `apps/web` scaffold Next.js completo: login, layout por rol, guard de rutas, demo CRUD de 8 módulos, dashboard con gráficos — ver sección "QUI-227 + QUI-219" abajo                                                                        |
| QUI-219 — auth real       | ✅ Login/refresh real (Better-Auth + Prisma) implementado y **verificado end-to-end** (backend + browser), reemplaza el bypass de desarrollo                                                                                                |
| QUI-217 — schema núcleo   | ✅ Modelos Prisma sindicatos/socios/vehículos/conductores/líneas/rutas+geometría/audit_log, migración + seeds — ver sección abajo                                                                                                             |
| QUI-218 — RLS multi-tenant| ✅ Rol `quivo_app` sin bypass, políticas por tabla, contexto por request, **9 tests cross-tenant pasando** — ver sección abajo                                                                                                                |
| QUI-220 — CRUD sindicatos | ✅ `/v1/sindicatos` real (solo `admin_quivo`), guard JWT + rol, auditoría en `audit_log`, **verificado end-to-end** (curl con y sin permiso) — ver sección abajo                                                                             |
| QUI-221..224 — CRUD M1    | ✅ `/v1/socios`, `/v1/vehiculos`, `/v1/conductores`, `/v1/lineas` — mismo patrón que sindicatos, tenant-scoping real (`admin_sindicato`/`operador` forzados a su propio sindicato), **55 tests de integración pasando** — ver sección abajo   |
| QUI-225/226 — geometría   | ✅ `/v1/lineas/:id/rutas`, `/v1/rutas/:id/variantes`, `/v1/rutas/:id/paradas`, `/v1/rutas/:id/puntos-control` — GEOGRAPHY vía SQL crudo, GeoJSON in/out, validación de geometría y de cercanía (ST_DWithin) — ver sección abajo                |
| QUI-228 — web conectada   | ✅ Sindicatos/socios/vehículos/conductores/líneas de `apps/web` contra el API real (ya no `demo-data.ts`) — **verificado en browser real** (crear/editar sindicato, crear socio con selector de tenant) — ver sección abajo                  |
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

## QUI-227 (web admin) + QUI-219 (auth real) — cerrado 2026-07-30

`apps/web`: scaffold Next.js 15 App Router consumiendo `@quivo/design-system` (repo hermano
`~/Proyectos/Web/Design_System_QUIVO`, symlink `link:`). Incluye login, layout con sidebar
filtrado por rol, refresh de sesión JWT (`src/lib/auth/jwt.ts` + `auth-context.tsx`), guard de
rutas por rol (`isRouteAllowedForRole`), demo CRUD navegable de los 8 módulos M1 (Sindicatos,
Socios, Vehículos, Conductores, Líneas, Rutas, Rotaciones, Reglas) sobre datos en memoria, y
dashboard con KPIs y gráficos de flota/socios. Detalle del patrón CRUD demo en `apps/web/README.md`.

`apps/api`+`packages/db`: `POST /v1/auth/login` y `/v1/auth/refresh` reales vía Better-Auth +
Prisma (reemplazan el bypass `NEXT_PUBLIC_DEV_BYPASS_AUTH` que solo debería usarse en dev local).
Usuarios seed (`packages/db/prisma/seed.ts`): `admin@quivo.local` (rol `admin_quivo`) y
`admin@sindicato.local` (rol `admin_sindicato`, `sindicatoId` fijo), password `Quivo123!` para
ambos — solo para desarrollo, nunca en producción.

**Verificado end-to-end (2026-07-30):** login/refresh real contra Postgres, rechazo de password
incorrecta (401), y el guard de rutas por rol funcionando con una sesión **real** (no solo el
bypass simulado) — `admin_sindicato` es redirigido fuera de `/sindicatos` igual que con el bypass.

## QUI-217 (schema núcleo) + QUI-218 (RLS) + QUI-220 (CRUD sindicatos) — cerrado 2026-07-30

QUI-220 dependía de QUI-217/218, que en Linear seguían en "Todo" sin implementar (QUI-219 se
había adelantado fuera de orden porque solo necesitaba las tablas de Better-Auth) — se hicieron
los tres en orden en la misma sesión.

**QUI-217 — `packages/db/prisma/schema.prisma`:** modelos `Sindicato`, `Socio`, `Vehiculo`,
`Conductor`, `Linea`, `Ruta`/`Variante`/`Parada`/`PuntoControl` (columnas `GEOGRAPHY` vía
`Unsupported(...)`, sin CRUD todavía — llega con QUI-225/226) y `AuditLog`. `estado` queda
como `String` libre en Prisma a propósito: la única fuente de verdad del enum es
`EstadoXSchema` en `@quivo/shared`, no un enum nativo de Postgres. Seeds (`prisma/seed.ts`):
2 sindicatos demo con IDs fijos (`11111111-...`/`22222222-...`, los mismos que ya usaba el
usuario `admin@sindicato.local` de QUI-219) + un socio/vehículo/conductor/línea de prueba
por sindicato.

**QUI-218 — RLS multi-tenant:** gotcha central de Postgres — **los superusers (y cualquier
rol con BYPASSRLS) ignoran las políticas RLS sin importar `FORCE ROW LEVEL SECURITY`**, y el
rol `quivo` de `docker-compose.yml`/CI es superuser. Se creó un rol de runtime separado
`quivo_app` (`NOSUPERUSER NOBYPASSRLS`, migración `20260730152500_rls_multi_tenant`) que es
el que de verdad usa `apps/api` (`RUNTIME_DATABASE_URL`, distinto de `DATABASE_URL` que sigue
siendo el rol de migraciones). Contexto por request vía `withTenantContext` en
`packages/db/src/tenant-context.ts` (`SELECT set_config('app.rol'/'app.sindicato_id', $1,
true)` dentro de una transacción — el `true` final es `SET LOCAL`, se descarta solo al
terminar esa transacción). Políticas con bypass explícito para `admin_quivo` en `sindicatos`,
`socios`, `vehiculos`, `conductores`, `lineas` y `audit_log`. **Deliberadamente sin RLS:**
tablas de Better-Auth (login necesita leer `user` por email antes de conocer su
`sindicato_id` — meterle RLS complica ese flujo sin ganancia real de aislamiento) y
`rutas`/`variantes`/`paradas`/`puntos_control` (heredan `sindicato_id` transitivamente vía
`lineaId`, sin API todavía). Test cross-tenant real (`packages/db/src/rls.integration.test.ts`,
9 casos) corre en CI vía `pnpm test` — crea dos sindicatos temporales, prueba que ninguno lea
ni escriba datos del otro, y que `admin_quivo` sí ve ambos.

**QUI-220 — `POST/GET/PATCH /v1/sindicatos`:** `JwtAuthGuard` (verifica el access token corto
vía `auth.api.verifyJWT`, stateless) + `RolesGuard`/`@Roles('admin_quivo')` — los sindicatos
son el tenant, `admin_sindicato` no tiene acceso a este endpoint en absoluto. Auditoría directa
en `audit_log` por acción (el interceptor genérico llega con QUI-230). Verificado con curl real:
sin token → 401, `admin_quivo` → 200/201, `admin_sindicato` → 403.

**Bug de configuración encontrado armando esto:** sin `BETTER_AUTH_URL`, el plugin `jwt` de
Better-Auth firma `iss`/`aud` vacíos (`""`), y su propio `verifyJWT` interno rechaza cualquier
payload con `aud` falsy — **incluso un token recién emitido y válido**. Sin esto, ningún
endpoint protegido con `JwtAuthGuard` puede autenticar nada. Se agregó `BETTER_AUTH_URL` a
`.env.example`/CI/los `.env` locales, y un test de integración contra Better-Auth real (no
mockeado) para que este bug no vuelva a pasar en silencio — el test con `verifyJWT` mockeado
no lo detecta porque nunca llega a firmar un JWT real.

## QUI-221..226 — resto del núcleo administrativo (M1) — cerrado 2026-07-30

Mismo día que QUI-217/218/220, se completó el resto de M1 en el mismo PR: **QUI-221**
(`/v1/socios`), **QUI-222** (`/v1/vehiculos`), **QUI-223** (`/v1/conductores`), **QUI-224**
(`/v1/lineas`), **QUI-225** (`/v1/lineas/:id/rutas` + variantes + paradas, con geometría
PostGIS) y **QUI-226** (`/v1/rutas/:id/puntos-control`). 55 tests de integración corriendo
contra Postgres real (con RLS activo donde aplica).

**Tenant-scoping real (no solo `admin_quivo`):** a diferencia de sindicatos (QUI-220, único
módulo restringido a `admin_quivo`), socios/vehículos/conductores/líneas los usan también
`admin_sindicato`/`operador`. Cada service resuelve `sindicatoId`: si el actor tiene uno
propio, se lo fuerza sin importar qué mande el body (nunca confiar en el cliente para elegir
de qué tenant es un alta — verificado con test: mandar el `sindicatoId` de otro sindicato en
el body no cuela); si es `admin_quivo` (sin tenant propio), lo toma del body o rechaza con 400.

**QUI-222 — máquina de transiciones de estado para vehículos:** `activo` puede ir a
cualquier otro estado; `inactivo`/`suspendido`/`mantenimiento` solo pueden volver a
`activo` (sin transiciones directas entre esos tres). **Asunción no confirmada por
Producto** — el doc técnico solo lista los 4 estados posibles, no las transiciones válidas;
ajustar en `vehiculos.service.ts` si Producto define otra cosa. También se agregó
`credencialHash` (nullable) al modelo `Vehiculo` para el login por vehículo de M3 (QUI-235)
— solo el campo, sin lógica de login, nunca expuesto en las respuestas del API.

**QUI-225/226 — geometría PostGIS vía SQL crudo:** las columnas `GEOGRAPHY` (`rutas.geometria`,
`paradas.coord`, `puntos_control.coord`) son `Unsupported(...)` en Prisma — el Client normal
ni siquiera expone esos campos, así que todo el CRUD de geometría usa `$queryRaw`/`$executeRaw`
con `ST_GeomFromGeoJSON`/`ST_AsGeoJSON` (GeoJSON in/out por la API, nunca WKT). Dos
validaciones geoespaciales: `ST_IsValid` antes de grabar la geometría de una ruta, y
`ST_DWithin` (100m, **asunción no confirmada por Producto**, en
`common/geo/proximidad-ruta.ts`) para que paradas y puntos de control no puedan crearse lejos
de la geometría de su ruta.

**Tenant-scoping sin RLS propia para rutas/variantes/paradas/puntos_control:** estas tablas
no tienen columna `sindicatoId` directa (la heredan transitivamente vía `lineaId` →
`linea.sindicatoId`), así que QUI-218 deliberadamente no les puso políticas RLS (ver esa
migración). La barrera de tenant vive en el código: `common/geo/tenant-checks.ts` resuelve
toda operación hacia arriba hasta `linea` (que sí tiene RLS) — si no es visible para el
actor, se trata como inexistente (**404, nunca 403** — no revela que el recurso existe en
otro tenant). Variantes y paradas viven dentro de `RutasModule` (no son módulos Nest propios,
así lo agrupaba ya el esqueleto de QUI-214 bajo RF-24..33); `control-points` sí es su propio
módulo (RF-34..39/QUI-226, issue separada).

## QUI-228 — apps/web conectada al API real — cerrado 2026-07-30

Sindicatos, socios, vehículos, conductores y líneas ya no usan `demo-data.ts` — pegan contra
`apps/api` de verdad. Rutas (editor de mapa, QUI-229), rotaciones, reglas y auditoría siguen
en modo demo (sin API real todavía para lo que necesitan). `ModuleTablePage` ahora soporta un
prop `dataSource` opcional (`list`/`create`/`update`) que activa el modo real; sin `dataSource`
sigue funcionando exactamente como antes (`useState` local), así que las páginas que siguen en
demo no cambiaron. **Sin botón de borrar en modo real** — ningún endpoint de M1 expone
`DELETE` (las entidades se desactivan vía `estado`, nunca se borran de la DB).

Los formularios muestran exactamente los campos del contrato real de `@quivo/shared` — se
sacaron los campos inventados de la demo (`ciudad`, conteos de `socios`/`vehiculos` en
sindicatos, nombre de sindicato como texto libre en vez de FK) que no existen en la API.
`admin_quivo` elige el sindicato desde un `<Select>` poblado con `/v1/sindicatos`
(`src/lib/api/use-sindicato-options.ts`, que además resuelve `sindicatoId → nombre` para las
columnas de tabla); `admin_sindicato`/`operador` no ven ese selector — el service ya los
fuerza a su propio tenant sin importar qué mande el formulario.

**Bug real encontrado y arreglado armando esto:** la config de CORS de `apps/api`
(`app.enableCors({ origin })`, sin `methods` explícito) solo dejaba pasar `GET,HEAD,POST` en
`Access-Control-Allow-Methods` — **todo PATCH quedaba bloqueado por el browser** con
`Failed to fetch`, aunque el preflight (OPTIONS) respondiera 204 igual. `curl` nunca lo sufrió
(CORS es una restricción del browser, no del server) por eso pasó desapercibido durante todo
QUI-220..226 hasta que `apps/web` hizo el primer PATCH real desde un browser de verdad. Se
agregó `methods: ['GET','POST','PATCH','PUT','DELETE']` explícito en `main.ts`.

**Verificado en browser real** (Chrome vía automatización, sesión inyectada con un login real
de `admin@quivo.local`, `NEXT_PUBLIC_DEV_BYPASS_AUTH=false` temporalmente): crear y editar un
sindicato, crear un socio con el selector de tenant, y carga correcta de vehículos/
conductores/líneas con el nombre de sindicato resuelto. Nota: durante esta sesión quedaron
sindicatos de prueba huérfanos en la DB local (de corridas de test interrumpidas) que había
que limpiar a mano — si aparecen filas raras tipo "Rutas Test A"/"Paradas Test B" etc. en la
DB local, son de eso, no de datos reales.

## QUI-229 — editor de rutas sobre mapa — cerrado 2026-07-31

M1 (núcleo administrativo) queda **completo de punta a punta**. Reutiliza `RouteMap` del
design system (`~/Proyectos/Web/Design_System_QUIVO`) — que usa **Leaflet, no MapLibre**
(la decisión original del doc técnico §1 nunca se implementó así; se decidió no duplicar
ese trabajo construyendo un componente MapLibre nuevo desde cero cuando uno funcional ya
existía). Se le agregó un prop `zones` (commit aparte en ese repo, **no pusheado
todavía** — solo local) para dibujar círculos a escala real en metros (radio de tolerancia
de un punto de control), distinto de los `stops` (radio fijo en píxeles).

Flujo: elegir línea real → ver/crear rutas de esa línea dibujando la geometría con clicks
sucesivos sobre el mapa → sobre una ruta seleccionada, agregar paradas y puntos de control
con un click + formulario mínimo → variantes como lista simple (sin geometría propia).
Todo contra los endpoints reales de QUI-225/226. **Verificado en browser real**: dibujar y
guardar una ruta de 3 puntos, agregar una parada, y un punto de control — la primera vez
rechazado por "lejos de la ruta" (ST_DWithin del backend funcionando en vivo), aceptado al
clickear más cerca, con el círculo de 30m visible en el mapa.

## QUI-230 (interceptor de auditoría genérico) + QUI-231 (schema rotaciones/asignaciones) — cerrado 2026-07-31

Arranca M2 (Rotaciones, RF-51..57). Plan completo: QUI-230 → QUI-231 → QUI-232 → QUI-233 → QUI-234.

**QUI-230 — `AuditInterceptor` global reemplaza los `auditar()` manuales de QUI-220..226:**
interceptor único (`APP_INTERCEPTOR`) + decorador `@Auditable('entidad')` por método de
controller. Usa `concatMap` (no `tap`) para que el `await` a `audit_log` bloquee la respuesta
— si la auditoría falla, la request falla (fail-loud, no fire-and-forget). Resolución de
`sindicatoId` en el log: el de la propia entidad devuelta → el propio `id` si `entidad ===
'sindicato'` → el del actor como fallback (imprecisión documentada para los 4 módulos de
geometría sin `sindicatoId` propio). Se sumó `GET /v1/auditoria` (`auditoria.service.ts`) con
filtros `entidad`/`accion`/`desde`/`hasta`, protegido por `@Roles('admin_quivo',
'admin_sindicato')` y RLS existente — sin lógica de tenant-scoping propia, RLS ya lo resuelve.

**QUI-231 — `Rotacion` + `Asignacion` (`packages/db/prisma/schema.prisma`):** el constraint
`@@unique([vehiculoId, fecha, horario])` en `asignaciones` es la barrera real contra el riesgo
#12 del doc técnico ("conflicto operativo real en la calle") — un vehículo no puede tener dos
asignaciones el mismo día en el mismo horario sin importar la rotación. `conductorId` nullable
(la rotación puede publicarse con el vehículo asignado y el conductor por confirmar después).
`TurnoSchema` nuevo en `@quivo/shared` (`manana`/`tarde`/`noche` — asunción no confirmada por
Producto, el doc técnico deja `horario` como texto libre). Migración escrita a mano
(`20260731060000_rotaciones_asignaciones`, mismo patrón que el resto de la sesión — `prisma
migrate dev` sigue roto por el gap de PostGIS en la shadow DB desde que existe la primera
columna `Unsupported("geography(...)")`). RLS agregada a `rotaciones` (tiene `sindicatoId`
propio, mismo patrón que socios/vehículos/conductores/líneas); `asignaciones` queda sin RLS
propia a propósito — no tiene `sindicatoId` directo (lo hereda vía `rotacionId →
rotacion.sindicatoId`), mismo caso que rutas/paradas, el tenant-check en código llega con
QUI-232. Test de integración contra Postgres real (`packages/db/src/asignaciones-constraint.test.ts`)
prueba que el constraint rechaza la segunda asignación en conflicto y permite variaciones
válidas (mismo vehículo, mismo día, horario distinto). Seed extendido con una ruta + rotación +
2 asignaciones demo para el Sindicato 1º de Mayo.

## QUI-232 — API de rotaciones (generar/editar/publicar/anular) — cerrado 2026-07-31

`POST /v1/rotaciones` genera un borrador repartiendo **round-robin** los vehículos y
conductores activos del sindicato entre las rutas/fechas/horarios pedidos (`GenerarRotacionSchema`)
— "regla de reparto" no está detallada en el doc técnico más allá de mencionarla, así que
round-robin con mejor esfuerzo es una asunción de este equipo: si el vehículo que le toca en
el turno ya está ocupado esa fecha/horario (por cualquier rotación), se prueba con el
siguiente; si se agotan todos, el slot queda sin cubrir en vez de abortar el resto de la
generación. **Gotcha real encontrado armando esto:** el chequeo de disponibilidad tiene que
ser en memoria *antes* de insertar, no capturando el error del constraint único — Postgres
aborta la transacción completa apenas falla un statement (`25P02: current transaction is
aborted`), así que intentar seguir insertando después de un `23505` capturado dentro de la
misma transacción de `withTenantContext` no funciona (a diferencia de
`crearAsignacion`/`actualizarAsignacion`, que sí pueden traducir ese error a un 409 porque
cada una corre en su propia transacción y no necesita seguir haciendo más inserts después).

`POST /v1/rotaciones/:id/publicar` y `/anular` son transiciones de estado atómicas
(`borrador` ⇄ `publicada`) — atómicas porque viven dentro de la misma transacción que ya arma
`withTenantContext`, no por lógica extra. "Anular" es una asunción de este equipo: vuelve la
rotación a `borrador` para poder corregirla antes de que la app móvil la consuma, no es un
estado nuevo (`EstadoRotacionSchema` sigue siendo solo `borrador`/`publicada`). Edición manual
de asignaciones (alta/edición/borrado, `POST`/`PATCH`/`DELETE /v1/rotaciones/:id/asignaciones`)
solo mientras la rotación está en `borrador`.

**Extensión al interceptor de auditoría (QUI-230):** `@Auditable('entidad', 'accion')` ahora
acepta un override opcional — `publicar` y `anular` son ambos `POST` por contrato de API
(`docs/documento-tecnico-cto.md` §8) pero no son un alta; sin el override, el interceptor
genérico los etiquetaba como `crear` en `audit_log` (inferido solo del método HTTP), lo cual
es justo lo que pedía el ticket evitar ("Auditoría de publicar/anular"). Verificado en
`audit.interceptor.test.ts`.

Roles con acceso: `admin_quivo`/`admin_sindicato` (no `operador` — asunción de este equipo,
rotaciones es una función de planificación, no de operación diaria, a diferencia del resto de
M1 que sí incluye `operador`). Verificado end-to-end contra el API real (curl): generar un
borrador de 4 asignaciones, publicar, intentar publicar de nuevo (400), anular, y confirmar
en `GET /v1/auditoria?entidad=rotacion` que las 3 acciones (`crear`/`publicar`/`anular`)
quedan bien etiquetadas.

## QUI-233 — web admin: UI de rotaciones — cerrado 2026-07-31

`/rotaciones` deja de ser demo (`useState` local) y pasa a consumir el API real de QUI-232.
Layout igual al de `/rutas` (QUI-229): panel izquierdo con selector de sindicato
(`admin_quivo` únicamente, mismo patrón de `useSindicatoOptions` que socios/vehículos) +
formulario de generación (periodo, rango desde/hasta que se expande a la lista de días,
checkboxes de horarios y de rutas) + lista de rotaciones existentes; panel derecho con la
**grilla vehículo × fecha/horario** que pide el ticket — filas y columnas se derivan de las
asignaciones reales de la rotación seleccionada (no de un catálogo completo de vehículos),
cada celda clickeable abre un `Modal` de edición (ruta/conductor/horario + botón "Quitar")
mientras la rotación esté en `borrador`; publicar/anular usan `ConfirmDialog`. El error 409
de doble-asignación se muestra dentro del modal con el mensaje tal cual lo devuelve el
service (`"Ese vehículo ya tiene una asignación en esa fecha y horario"` — ya es lenguaje
llano de por sí, no necesitó traducción adicional en el frontend, que era el criterio de
aceptación del ticket).

**Bug real encontrado y arreglado armando esto:** `apiFetch` (cliente HTTP compartido,
`apps/web/src/lib/api/client.ts`) mandaba `Content-Type: application/json` en **toda**
request, incluidos los `POST /v1/rotaciones/:id/publicar`/`/anular` que no llevan body —
Fastify rechaza esa combinación con 400 (`"Body cannot be empty when content-type is set to
'application/json'"`). No había aparecido antes porque QUI-228/229 solo hicieron `POST`s con
body real. Fix: el header solo se manda si `init.body` está definido — afecta a cualquier
futuro endpoint sin body, no solo a rotaciones.

**Verificado en browser real** (mismo método que QUI-228/229: `next build && next start`
para que `NODE_ENV=production` desactive el bypass de dev automáticamente, sesión real de
`admin@quivo.local`): generar un borrador de 4 asignaciones (1 vehículo × 2 fechas × 2
horarios), editar una celda a un horario ya ocupado por el mismo vehículo y ver el error 409
en línea, publicar (badge cambia a verde "publicada", desaparecen los controles de edición),
y anular (vuelve a "borrador").

## QUI-234 — vencimiento de asignaciones por jornada (RF-57) — cerrado 2026-07-31, M2 completo

Job **BullMQ repeatable** (cada 5 min, `upsertJobScheduler` — idempotente entre reinicios,
no acumula schedulers duplicados) que marca `vencida` toda asignación `vigente` cuya
`venceAt` ya pasó. Nueva columna `Asignacion.estado` (`vigente`/`vencida`, default
`vigente`) + índice `(estado, venceAt)` para esa query.

**Bug real encontrado escribiendo los tests de borde de zona horaria que pedía el ticket:**
`venceAt` (QUI-232) se calculaba como `23:59:59 UTC` del mismo `fecha` — pero Bolivia es
**UTC-4 sin horario de verano** (único mercado del MVP), así que eso vencía una asignación
a las 19:59:59 hora local, **4 horas antes de lo real**. Nuevo helper
`apps/api/src/common/tiempo/jornada.ts` (`finDeJornadaBolivia`) calcula el instante UTC
correcto (03:59:59 del día siguiente al `fecha`) — 5 tests de borde (cambio de mes, de año,
29 de febrero de un bisiesto, "sin DST") lo verifican.

**Redis local desbloqueado:** el puerto 6379 lo tenía tomado otro proyecto de esta máquina
(`quivo-control-redis-1` no podía publicar su puerto) — bloqueo que venía arrastrándose
desde el plan inicial de M2. Redis de este proyecto ahora corre en el puerto host **6380**
(`docker-compose.yml`, `.env.example`, `.env` local), mismo patrón que el 5434 de Postgres.
De paso, `pnpm-workspace.yaml` necesitó aprobar el build script de `msgpackr-extract`
(dependencia nativa opcional de `bullmq`/`ioredis`) que pnpm empezó a ignorar por default.

**Fuera de alcance (documentado, no una decisión de Producto):** "API de consulta solo
devuelve vigentes" del ticket se refiere al futuro `GET /v1/mobile/asignacion-del-dia`
(RF-73, módulos `tracking`/`sync`, M3, QUI-240/241) — no existe todavía, así que no hay nada
que filtrar hoy. Los endpoints admin (`GET /v1/rotaciones*`, QUI-232/233) siguen devolviendo
**todas** las asignaciones con su `estado` visible en la respuesta — la UI de rotaciones
necesita ver el historial completo para poder editar/republicar, no solo lo vigente; filtrar
ahí habría roto esa pantalla. Verificado en vivo: la API arranca con Redis en 6380
(`"redis":"up"` en `/v1/health`) y el job corre al boot sin errores.

**M2 — Rotaciones (RF-51..57) queda completo:** QUI-230 (interceptor de auditoría genérico)
→ QUI-231 (schema + constraint anti doble-asignación) → QUI-232 (API generar/editar/
publicar/anular) → QUI-233 (UI web, grilla vehículo×fecha) → QUI-234 (vencimiento, este).

## M4 — dashboard/reglas/reportes: arrancado 2026-07-31

M3 (app móvil + offline + sync, RF-58..73) sigue bloqueado por recursos físicos que nadie
consiguió todavía (licencia Transistorsoft + Android real de gama baja, QUI-216). M4 no
depende de eso, así que se sigue por ahí: QUI-248 (auditoría) → QUI-244 (reglas/sanciones,
modelo+API) → QUI-245 (UI reglas/sanciones). QUI-246/247/249 (dashboard de cumplimiento,
reconstrucción de recorridos, reportes operativos) sí necesitan datos reales de
`gps_points`/sesiones que solo existen una vez que M3 esté armado — quedan para después.

## QUI-248 — web admin: auditoría con filtros — cerrado 2026-07-31

`/auditoria` deja de ser demo y consume `GET /v1/auditoria` (QUI-230) de verdad. Filtros por
entidad/acción/usuario/rango de fecha (se sumó `usuarioId` al `AuditoriaQuerySchema` y al
service — QUI-230 solo tenía entidad/acción/fecha). Tabla vía el componente `AuditLog` del
design system; cada fila tiene un botón "Ver diff" que abre un `Modal` con el diff completo
formateado (JSON pretty-printed) — alcanza para "legible" sin necesitar reconstruir un
`{antes, cambios}` estructurado (mismo criterio de simplicidad que QUI-230 ya había asumido).
Verificado en browser real: filas reales de `audit_log` cargando, modal de diff abriendo con
el contenido correcto (incluida una fila vieja pre-QUI-230 con el shape `{antes, cambios}`
de cuando la auditoría todavía era manual en cada service — se muestra tal cual está en la
DB, sin normalizar formatos históricos).

## QUI-244 — reglas y sanciones: modelo + API + transiciones — cerrado 2026-07-31

`Regla` (estatutos: nombre/tipo/gravedad/aplicaA/descripcion/estado) y `Sancion` (sujeto
polimórfico `vehiculo`/`conductor`/`socio` sin FK — mismo patrón que `AuditLog.entidadId`).
El doc técnico deja el modelo muy comprimido (`estatutos/reglas(id, sindicato_id, tipo,
gravedad, aplica_a, relacion)`) — se agregaron `nombre`/`descripcion` por usabilidad admin y
`gravedad` (`leve`/`grave`/`gravisima`) como asunciones de este equipo, no confirmadas por
Producto. RLS en ambas tablas (tienen `sindicatoId` propio, mismo patrón que rotaciones).

**Máquina de transiciones de `Sancion`** (el doc técnico solo lista los 5 estados —
`pendiente`/`aplicada`/`anulada`/`apelada`/`pagada` — sin definir las transiciones válidas
entre ellos, así que esto es una asunción de este equipo, mismo criterio que las
transiciones de vehículos de QUI-222):

```
pendiente → aplicada | anulada
aplicada  → apelada | pagada | anulada
apelada   → aplicada | anulada
pagada, anulada → (terminales)
```

Endpoints dedicados `POST /v1/sanciones/:id/{aplicar,anular,apelar,pagar}` (no un PATCH de
estado genérico), todos auditados con el override de acción de `@Auditable` (mismo mecanismo
de QUI-232). Edición (`PATCH /v1/sanciones/:id`) restringida a `motivo`/`evidenciaRef` y solo
mientras está `pendiente`.

**Límite conocido, documentado:** "evidencia = datos de recorrido auto-vinculados" (doc
técnico §15.5) necesita tracking real (M3: sesiones, `gps_points`, `cumplimientos_pc`), que
esta sesión no llegó a construir — `evidenciaRef` queda como texto libre que carga quien
registra la sanción, sin auto-vinculación todavía.

**Nota de consistencia de API:** `CrearReglaSchema`/`CrearSancionSchema` exigen `sindicatoId`
en el body (no opcional) — se alinearon con el patrón mayoritario de
vehículos/líneas/socios/conductores (el frontend lo autocompleta vía `createDefaults`,
`admin_quivo` lo elige en un `<Select>`), no con el patrón de `GenerarRotacionSchema`
(QUI-232) que lo dejó opcional. Ambos patrones funcionan (el service igual fuerza el tenant
real vía `resolverSindicatoId`), pero para evitar que conviva un tercer estilo, QUI-244 usa
el más extendido en la base de código.

Verificado end-to-end contra el API real (curl): crear regla → crear sanción (`pendiente`) →
aplicar → pagar → confirmar que `pagada` es terminal (`anular` devuelve 400).

## QUI-245 — web admin: UI de reglas y sanciones — cerrado 2026-07-31

`/reglas` deja de ser demo. Dos pestañas (`Tabs` del design system) sobre el mismo layout:
**Reglas** reutiliza `ModuleTablePage` con `dataSource` real (mismo patrón que
vehículos/líneas, QUI-228) — CRUD simple, sin lógica propia. **Sanciones** es una vista a
medida (mismo criterio que rotaciones, QUI-233): filtros por estado/regla, tabla con botones
de transición que cambian según el `estado` actual de cada fila (p. ej. `pendiente` muestra
Aplicar/Anular; `aplicada` muestra Apelar/Marcar pagada/Anular), cada transición con
`ConfirmDialog`, y un modal de alta con selector de sujeto dependiente del `sujetoTipo`
elegido (vehículo/conductor/socio).

**Bug real encontrado y arreglado armando esto:** `fechaHecho` es una fecha "pura" (guardada
como medianoche UTC), pero `toLocaleDateString('es-BO')` sin fijar `timeZone: 'UTC'` usa la
zona horaria del browser para convertir — en cualquier navegador al oeste de UTC (incluida
Bolivia, UTC-4) esto corre la fecha mostrada un día para atrás. Se vio en vivo: una sanción
con `fechaHecho: 2026-08-01` se mostraba como "31/7/2026" hasta forzar `timeZone: 'UTC'` en
el formateo. El campo `ts` de auditoría (QUI-248) no tiene este problema — es un timestamp
real, no una fecha pura, así que mostrarlo en hora local del browser es lo correcto ahí.

Verificado en browser real (Chrome, sesión `admin_quivo`): crear una regla con el selector de
sindicato, cambiar a la pestaña Sanciones, crear una sanción, aplicarla (con confirmación), y
confirmar que los botones de acción cambiaron correctamente a los de una sanción `aplicada`.

**M4 sigue así:** QUI-246 (dashboard de cumplimiento), QUI-247 (reconstrucción de
recorridos) y QUI-249 (reportes operativos) necesitan datos reales de `gps_points`/sesiones
que solo van a existir con M3 armado — quedan pendientes hasta que se resuelva el bloqueo de
hardware de QUI-216 (licencia Transistorsoft + Android real).

## Repaso M1-M4 (a pedido explícito, tras cerrar M2 y la parte de M4 sin M3) — 2026-07-31

Con M2 y la parte de M4 independiente de M3 cerradas, se hizo un repaso completo de todo lo
construido buscando huecos en vez de seguir a QUI-251 (que es un gate de pre-release, tiene
más sentido correrlo una sola vez cerca del release real, no ahora). Encontrado y corregido:

- **Bug real: el dashboard (`/`) seguía mostrando datos de `demo-data.ts`** (sindicatos/
  vehículos/conductores/socios de ejemplo) — nadie lo había migrado a las APIs reales al
  cerrar QUI-220..224, a pesar de ser la primera pantalla que ve cualquier admin. Ahora pega
  contra las 4 APIs reales; "sin socio asignado" se calcula de `socioId == null` (no de un
  `estado` que no existe en el modelo real); la tarjeta "Sindicatos activos" queda oculta
  para `admin_sindicato`/`operador` (no pueden llamar `GET /v1/sindicatos`, QUI-220 es
  `admin_quivo`-only). `src/lib/demo-data.ts` quedó huérfano y se borró.
- **Documentación desactualizada** en dos lugares: `apps/api/src/modules/README.md` seguía
  marcando "esqueleto" a 10 módulos que llevan sesiones enteras siendo reales (nunca se
  actualizó módulo por módulo); `apps/web/README.md` describía un modo demo (`ModuleTablePage`
  sin `dataSource`) que ya ninguna página usa. Ambos corregidos para reflejar el estado real.
- **Asimetría de API real: `variantes` (QUI-225) no tenía `GET /v1/variantes/:id`**, a
  diferencia de paradas/puntos-control/rutas que sí lo exponen — agregado
  service+controller+test siguiendo el mismo patrón (tenant-check vía `asegurarRutaVisible`).
- **`seed.ts` no tenía datos de ejemplo de reglas/sanciones** (QUI-244, llegó después del
  último seed) — agregada una regla + una sanción `pendiente` para el Sindicato 1º de Mayo.
- `/reportes` tenía un subtítulo desactualizado ("el dashboard real llega en M4" — ya estamos
  en M4 con partes reales) — corregido para nombrar específicamente QUI-246/249 como lo
  bloqueado, y por qué (necesitan datos de tracking que solo van a existir con M3).

**Encontrado pero deliberadamente NO implementado (para no salirme de "buscar huecos" hacia
"construir features nuevas" sin que se pida):** la mitad de QUI-249 (reportes operativos)
podría hacerse hoy sin M3 — "sanciones por sujeto/estado" ya tiene datos 100% reales
(QUI-244), a diferencia de "recorridos por periodo" que sí necesita tracking. Si se quiere
adelantar esa parte de QUI-249, es una decisión de alcance a tomar explícitamente, no algo
que se coló en este repaso.

## Pendientes de acceso

- **Repo `Design_System_QUIVO` (sibling, `~/Proyectos/Web/Design_System_QUIVO`) tiene 1 commit local sin pushear** (el prop `zones` de `RouteMap`, QUI-229) — funciona igual en este entorno porque `apps/web` lo consume vía symlink `link:`, pero cualquier otra máquina/CI que dependa de ese repo no lo tiene todavía.
- **Push a GitHub:** ✅ resuelto (2026-07-30) — ya no hay bloqueo de credenciales de escritura
  sobre `Quivo-enterprise/quivo-control`. Todo el trabajo de Cycle 12 + QUI-227/219 se pusheó en
  una sola rama (`qui-227-web-nextjs-scaffold`, 13 commits) con un único PR hacia `main`
  (ver "Próximos pasos"). Las 6 ramas individuales del kickoff (`qui-211-monorepo-scaffold`, etc.)
  siguen existiendo localmente como puntos de referencia por issue, pero forman parte de la misma
  cadena lineal de commits — no son ramas divergentes independientes.
- **`gh` CLI:** sigue sin instalar en este entorno (requiere `sudo` interactivo) — el PR de arriba
  se abrió manualmente vía el link que imprime `git push`, no con `gh pr create`. Sigue siendo
  necesario para automatizar branch protection en `main` (QUI-212) — alternativa: ajuste manual en
  GitHub Settings → Branches.
- **Infra cloud real (QUI-213):** Railway/Fly.io sin decidir ni aprovisionar — solo el ADR
  y el `docker-compose.yml` local están listos.
- **Spike GPS físico (QUI-216):** licencia Transistorsoft (~US$400) + dispositivo Android
  real de gama baja, ambos pendientes de que el equipo/usuario los consiga.

## Próximos pasos

1. Revisar y mergear el PR abierto (`qui-227-web-nextjs-scaffold` → `main`, ahora incluye
   todo M1: QUI-217/218/220..226) — dispara el CI (QUI-212) por primera vez contra código
   real, incluidos los 55+ tests de integración (RLS, geometría, tenant-scoping). **Sin
   atribución de IA** en commits/PRs — regla del repo, sobrescribe el comportamiento
   default del agente.
2. Una vez el CI esté en verde y mergeado a `main`, activar branch protection.
3. **M2 — Rotaciones (RF-51..57): ✅ completo** (QUI-230..234). **M4** (elegido sobre M3
   porque M3 sigue bloqueado por hardware que nadie consiguió — licencia Transistorsoft +
   Android real, QUI-216): QUI-248 (auditoría), QUI-244 (reglas/sanciones API) y QUI-245
   (reglas/sanciones UI) ✅ cerrados. QUI-246/247/249 quedan bloqueados hasta que exista M3
   (necesitan datos reales de `gps_points`/sesiones). **Con esto, todo lo que se podía
   avanzar en M4 sin M3 está hecho.** De M5 (hardening), QUI-250 (load test de ingesta) y
   QUI-252 (retención GPS) también dependen de que exista la tabla `gps_points`/el worker de
   ingesta (M3) — solo **QUI-251 (auditoría RLS + security review)** es genuinamente
   independiente, porque audita lo que ya existe (M1/M2/M4). Próximo paso real: decidir con
   el usuario entre conseguir el hardware para desbloquear M3, o adelantar QUI-251 mientras
   tanto.
4. Pushear el commit pendiente de `Design_System_QUIVO` (prop `zones` de `RouteMap`, arriba).
5. Validar con Producto las asunciones que quedaron documentadas sin confirmar: transiciones
   de estado de vehículos (`vehiculos.service.ts`), tolerancia de 100m para paradas/puntos de
   control cerca de una ruta (`common/geo/proximidad-ruta.ts`), taxonomía de `tipo` en
   paradas (`packages/shared/src/entities/parada.ts`).
6. Deploy de `apps/web` en Vercel + CI (parte del criterio de aceptación de QUI-227, aún no hecho).
7. Decidir Railway vs Fly.io (ADR ya redactado) y aprovisionar cuando el usuario confirme.
8. Conseguir licencia Transistorsoft + dispositivo Android de gama baja y correr el
   protocolo de `docs/spike-gps.md` — gate go/no-go real de M3.
9. Ritos Scrum sugeridos: daily corto, review/retro al cierre de cada cycle (cada 2 semanas),
   refinement de M1 durante Cycle 13.

## Fuentes de verdad

- `docs/plan-maestro.md` — plan aprobado (stack, arquitectura, fases, verificación).
- `docs/documento-tecnico-cto.md` — documento técnico completo (modelo de datos, API, sync, riesgos, respuestas al CPO).
- `~/.council/Documents/council-20260719-083140/` — deliberación completa (`viewer.html` para explorar).
- Memoria del proyecto: `~/.claude/projects/-home-jairomgr-Proyectos-QUIVO-Control-quivo-control/memory/`.
