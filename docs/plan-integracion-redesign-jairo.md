# Plan — Integración del rediseño de Jairo a `main`

Rama de trabajo: `integracion/redesign-jairo` (creada desde `feat/reestructurar-admin-panel`, HEAD `8950ebb`).
Autor del trabajo original: jg012119. Fecha de la integración: 2026-09-06.

## Objetivo

Traer a `main` las cuatro entregas que Jairo acumuló en su rama, entendiendo antes qué cambia y
qué riesgo tiene cada parte. La rama está **0 commits detrás de `main`**, así que no hay
conflictos: es un merge limpio.

## Qué trae la rama

298 archivos, +41.581 / −7.586. No es solo UI/UX; son cuatro entregas mezcladas:

| Entrega | Alcance |
|---|---|
| Rediseño del panel web | `apps/web` (73 archivos), `packages/design-system` (10) |
| Rediseño de la app móvil | `apps/mobile` (24), `apps/mobile-mockup` (38, prototipo nuevo) |
| Backend de pasajeros y movilidad pública | `apps/api` (58), `packages/db` (16, 13 migraciones), `packages/shared` (13) |
| Landing pública | `apps/landing` (60 archivos, app nueva) |

### Web y design system

- Ninguna ruta nueva ni eliminada; las 12 existentes se rediseñan.
- `/lineas` gana flujo de publicación (borrador/publicado) y subida de logo — **cambio de
  comportamiento**, no solo visual. Backend correspondiente en la misma rama.
- `/en-vivo` se conserva, pero sale del layout con sidebar: shell full-screen
  (`apps/web/app/(dashboard)/layout.tsx:76-78`) que abre en pestaña nueva.
- `/rutas`, `/vehiculos`, `/reglas`, `/rotaciones`: refactor (extracción de hooks y modales) +
  rediseño; la funcionalidad ya existía en `main`.
- Motor de mapa: Leaflet → **MapLibre GL** (`maplibre-gl ^5.24.0`), con tiles de
  `tiles.openfreemap.org`. `RouteMapProps` queda compatible; todas las props nuevas opcionales.
- Paleta de marca cambiada: `--qv-color-primary` `#4338ca` → `#3226b4`,
  `--qv-color-accent` `#f97316` → `#fd9e15` (`packages/design-system/src/tokens.css:21,24`).
- Sin breaking changes de API en el design system: todo lo agregado es opcional.

### Móvil

- Login de vehículo y mapa rediseñados según Figma; `driver-login-screen.tsx` eliminado.
- "Login de un solo paso": la UI es de un paso, pero `use-auth-movil.ts:229-256` sigue llamando
  los dos endpoints, el segundo con credenciales demo fijas. **Intencional** (decisión del CTO,
  2026-09-06): lo mockeado a propósito no bloquea el merge.
- Velocímetro en km/h en la barra de operación. No hay alerta por umbral de velocidad.
- `apps/mobile-mockup`: prototipo standalone (Expo 52 / RN 0.76.9, `App.tsx` de 2075 líneas),
  excluido del pipeline quitándole los scripts de su `package.json`. **Intencional.**

### Backend

- 13 migraciones nuevas. 12 aditivas; `20260829180000_reconciliar_gps_points_sindicato_rls`
  contiene un `DELETE`.
- Módulos nuevos: `demo-requests`, `media`, `notificaciones`, `pasajeros`, `pasajeros-datos`,
  `planes`, `public-mobility`.
- Endpoints públicos: `POST /v1/public/demo-request` (honeypot + throttle 5/min) y
  `/v1/public/mobility/*` (solo filas con `publicStatus=publicado`).
- Tablas nuevas de pasajero con RLS por `userId`; `mobility_cities`, `passenger_plans`,
  `passenger_plan_features` y `demo_requests` sin RLS por diseño (catálogos / no tenant-scoped).
- `main.ts:99-121` agrega `validateRuntimeConfig()`: endurece el arranque (falla sin
  `DATABASE_URL`/`JWT_SECRET`, y en producción rechaza `CORS_ORIGIN: *` o secreto corto).
- Sin breaking changes de contrato para los consumidores actuales.

### Landing

- Next 15.5.22, una sola ruta, pública, apunta a `control.myquivo.com`.
- Consume del design system solo tokens + `RouteMap`; reimplementa el resto (3271 líneas de CSS
  propio).
- Se despliega **a mano** por cPanel/FTP con export estático — no hay Vercel ni Docker para ella.
- Duplica ~5,5 MB de assets ya presentes en `apps/web` y `apps/api`.

## Verificación hecha antes de abrir el PR

Corrida en un worktree aislado, sin tocar `main`:

| Check | Resultado |
|---|---|
| `turbo typecheck` | 10/10 OK |
| `turbo lint` | 10/10 OK |
| tests web / mobile / shared / design-system | 63 / 116 / 53 / 8 pasan |
| tests api | 82 pasan; el resto requiere Postgres (`P1000`), no es defecto de la rama |
| tests db | requieren Postgres + `RUNTIME_DATABASE_URL` |

El suite completo solo lo cierra CI, que levanta Postgres y Redis.

## Trampas y decisiones

### A resolver antes de mergear

1. **Orden de migraciones.** 4 migraciones tienen timestamp anterior a la última aplicada en
   `main` (`20260817150000`): `20260815120000_linea_branding`,
   `20260815143000_line_identity_markers`, `20260815160000_linea_cartel_editor`,
   `20260817120000_public_mobility_publication`. `migrate deploy` las aplica igual, pero
   `migrate dev`/`diff` reporta historial fuera de orden. Renombrarlas con timestamp
   posterior a `20260906120000`.
2. **`module-table-page.tsx:119`** renombró `subtitle` a `_subtitle` y dejó de renderizarlo.
   Cinco páginas siguen pasándolo y desaparece sin error de compilación: `conductores:135`,
   `reglas:169` y `:309`, `sindicatos:52`, `socios:118`.
3. **`secret-box.ts:35-44`** cae a `JWT_SECRET` como clave de cifrado de push tokens si falta
   `NOTIFICATION_TOKEN_ENCRYPTION_KEY`. El gate de `main.ts:109-114` solo aplica con
   `NODE_ENV === 'production'` literal, así que staging queda con el fallback.
4. **`cerrar-sesion-dialog.tsx`**: el rediseño reemplazó el aviso de que cerrar sesión corta el
   GPS de forma irreversible (hallazgo ALTO de la auditoría post-piloto día 1) por un texto
   genérico que no lo menciona.

### A verificar contra datos de producción (decisión del CTO)

5. `20260829180000` corre `DELETE FROM gps_points WHERE "sindicatoId" IS NULL`. Contar esas
   filas antes: `SELECT count(*) FROM gps_points WHERE "sindicatoId" IS NULL`.
6. `20260819100000_mobility_city_scope` asigna `cityId='cochabamba'` por default a todas las
   líneas existentes. Confirmar que es correcto para los datos reales.

### Deuda aceptada (no bloquea)

- Credenciales demo del chofer en el cliente móvil y `apps/mobile-mockup`: **intencionales**.
- Assets duplicados entre `apps/landing`, `apps/web` y `apps/api` (~5,5 MB).
- CSS muerto de Leaflet en `apps/web/app/globals.css`; +188 `!important` en web, +67 en el
  design system.
- `route-map-view.tsx:85`: prop `vehiculo` sin usar.
- `/auditoria:139-142`: los `MetricCard` cuentan solo las 200 filas cargadas.
- La landing no tiene cobertura E2E ni pipeline de deploy.

## Criterios de verificación para cerrar

- CI verde en el PR (incluido el job `acceptance` de Playwright).
- Los cuatro puntos de "a resolver antes de mergear" aplicados y re-verificados.
- Los dos puntos de datos de producción confirmados por el CTO.
- `docs/handoff.md` actualizado tras el merge.

---

## Corrección de alcance del CTO (2026-09-07): fuera todo Quivo Rutas

Decisión textual del CTO: *"no necesitamos NADA de quivo rutas, nada, solo estamos con
quivo control"*. Jairo confundió producto: Quivo Rutas (app de pasajeros) es un producto
aparte con su propio repo. Nada relacionado con pasajeros se queda en este repo.

Decisión complementaria sobre el flujo de publicación: **"dejarlo entero"** — se conservan
las columnas `publicStatus`/`publishedAt`, el endpoint `PATCH /v1/mobility-publications` y
el botón de publicar en `/lineas` y `/rutas`. Lo único que se corta ahí es la llamada a
`NotificacionesService`.

### Qué se elimina

| Área | Rutas |
|---|---|
| API — módulos | `apps/api/src/modules/pasajeros/`, `pasajeros-datos/`, `planes/`, `notificaciones/` |
| API — cripto | `apps/api/src/common/crypto/secret-box.ts` (solo lo usaba `notificaciones`) |
| API — lectura pública | `public-mobility/public-mobility.controller.ts`, `public-mobility.service.ts`, `journey.service.ts` |
| API — auth | endpoint `passenger/register` |
| Shared | `packages/shared/src/passenger.ts` y los esquemas de pasajero dentro de `login.ts` |
| Prisma | los 13 modelos `Passenger*` y el campo `Vehiculo.publicQrToken` |
| Migraciones | `20260818123000_public_vehicle_qr_token`, `20260818150000_passenger_identity`, `20260818153000_passenger_experience`, `20260818160000_passenger_saved_data`, `20260818164500_gps_partition_idempotency` |

### Qué se queda (y por qué)

- `public-mobility/mobility-publication.{controller,service}.ts` — es **Control**: lo consumen
  `apps/web/src/lib/api/mobility-publications.ts` y `use-rutas-data.ts`.
- `20260819100000_mobility_city_scope` — `lineas.service.ts:71` hace
  `tx.mobilityCity.findUnique(...)` y `:42` escribe `cityId` al crear línea. Sin la tabla,
  crear una línea en Control revienta con 500.
- `20260818163000_public_mobility_indexes` y `20260829180000_reconciliar_gps_points_sindicato_rls`.
- El miembro `'pasajero'` de `RolSchema`. Quitarlo haría fallar con 500 cualquier login de un
  usuario pasajero existente, porque `auth.service.ts:317` hace `RolSchema.parse(user.rol)`.

### Riesgo mayor identificado por el análisis de Opus

**Nunca quitar `20260829180000_reconciliar_gps_points_sindicato_rls` dejando
`20260818164500_gps_partition_idempotency`**: esa combinación rompe en silencio el RLS
multi-tenant de `gps_points`. Aquí se hace lo inverso (se va la 164500, se queda la
20260829180000), y por eso la verificación en base virgen es obligatoria, no opcional.

### Criterio de verificación (base virgen, obligatorio)

1. `prisma migrate deploy` + seed sobre una Postgres vacía (`postgis/postgis:16-3.4-alpine`).
2. `prisma migrate diff` entre las migraciones y `schema.prisma`: **cero drift**.
3. RLS de `gps_points` sigue activo y con la política por `app.sindicato_id`.
4. `pnpm typecheck`, `pnpm lint`, `pnpm build`, tests de API y web.

### Pendientes que no bloquean el merge (decisión del CTO antes de desplegar)

- `20260829180000` corre `DELETE FROM gps_points WHERE "sindicatoId" IS NULL` — contar filas antes.
- `20260819100000` asigna `cityId='cochabamba'` a TODAS las líneas existentes.
