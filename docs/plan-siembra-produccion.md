# Plan — sembrar `quivo-control-prod` desde cero

> **Estado:** ejecutado 2026-09-09. Producción sembrada y los seis conductores autentican. Reemplaza la idea inicial de correr
> `packages/db/prisma/seed.ts` contra producción, que quedó descartada (ver "Por qué no el seed").
>
> **Este documento no contiene credenciales.** Los PIN de los conductores de prueba y la
> contraseña del admin viven en el gestor de contraseñas del CTO y en Secret Manager, nunca acá.
> Escribirlos en el repo sería el mismo error que este plan corrige.

## Situación

La base de producción está **vacía**: `user=0 sindicatos=0 socios=0 rutas=0 vehiculos=0
conductores=0 rotaciones=0 asignaciones=0`. Solo las 33 migraciones aplicadas, más las 9 filas de
`mobility_cities` que inserta la propia migración `20260819100000_mobility_city_scope`.

El APK build 9 abre en el teléfono y apunta a `quivo-api` de producción, que responde
`{"status":"ok","db":"up","redis":"up"}`. El login no puede funcionar porque no hay nada del otro
lado, no porque la app falle.

## Por qué no el seed

`packages/db/prisma/seed.ts` es monolítico, sin flag para excluir la parte de demo, y sembraría en
producción dos cosas inaceptables:

1. **`SEED_PASSWORD = 'Quivo123!'`** (`seed.ts:34`) para los tres usuarios que crea, incluido el
   `admin_quivo` — rol sin `sindicatoId`, es decir con visibilidad sobre todos los sindicatos.
2. Peor: **`seedRotaciones` (`seed.ts:862-916`) crea una asignación con la fecha de hoy,
   `estado='vigente'`, sobre una rotación forzada a `'publicada'`**, para un vehículo cuyo
   conductor tiene el PIN `SEED_PIN_CONDUCTOR = '135790'` (`seed.ts:36`). Correr ese seed contra
   producción no deja "datos de ejemplo": deja **una credencial móvil real y funcionando con el PIN
   publicado en el repo**.

Ambas cosas son deuda a corregir en un PR aparte (guarda fail-closed espejando
`packages/db/src/client.ts:41-66`), pero este plan simplemente no usa el seed.

## La idea central

Escribir en la base no requiere tocar la imagen del contenedor. El panel web habla con la API, la
API vive dentro de la VPC y llega a Cloud SQL. **Todo el catálogo se crea desde el panel**, lo que
además ejercita el camino real en vez de un atajo por script.

El único bloqueo es el arranque: no existe usuario para entrar al panel, y el signup público **no
está expuesto** (verificado: `apps/api/src/modules/auth/auth.controller.ts` solo registra `login`,
`refresh`, `logout`, `admin/users` y `admin/reset-password`; no hay `@All()` ni montaje del handler
de Better-Auth). Crear ese primer usuario es la **única** operación privilegiada del plan.

### Lo que se creía bloqueante y no lo es

- **La geometría real de las rutas entra por la API.** `POST /v1/lineas/:lineaId/rutas` recibe
  `geometria` como GeoJSON (`packages/shared/src/entities/ruta.ts:14`) y el servicio la inserta con
  `ST_GeomFromGeoJSON` (`rutas.service.ts:56-66`). El `bodyLimit` de Fastify es 3 MB
  (`apps/api/src/main.ts:32`); la Z12 son 1255 vértices (~45 KB). Lo que vive dentro de
  `scripts/cargar-circuito-z12.ts` y `cargar-linea-120.ts` no es el acceso sino la
  **transformación** de los archivos de `scripts/data/`, y eso corre en la máquina del CTO.
  Beneficio extra: el camino por API valida con `ST_IsValid` (`rutas.service.ts:111-120`); el
  script no.
- **Los PIN se pueden fijar, no solo generar.** `PUT /v1/mobile/credenciales/conductores/:id`
  acepta `{ pin }` (`credenciales-moviles.controller.ts:28`), así que se reusan los que el CTO ya
  tiene anotados.
- **No hace falta reconstruir la imagen**, y por lo tanto no se toca el servicio `quivo-api` que el
  APK ya está usando.

## Acceso a producción

Cloud SQL `quivo-db` **no tiene IP pública** (`ipv4Enabled: False`, IP privada `10.60.0.3`) — no la
alcanza `cloud-sql-proxy` desde una laptop. El único acceso directo es el Cloud Run Job
`quivo-migraciones` (`southamerica-west1`), que corre con `--vpc-connector=quivo-conector`, imagen
`api:v1`, y admite override de argumentos por ejecución.

**Verificado en esa imagen:** existen `/app/packages/db/dist/auth.js` y `better-auth`; existe
`/app/packages/db/prisma/seed.ts`. **No existe `/app/scripts`** — el `Dockerfile` usa
`turbo prune @quivo/api --docker` y `scripts/` no es un workspace.

**Trampa de `gcloud`:** `--args` parte por coma, así que cualquier JS inline necesita el
delimitador alternativo `^%%^` (precedente en `scripts/deploy-gcp.sh:441-452`). Y Prisma 7 exige
driver adapter: `new PrismaClient({ adapter: new PrismaPg(url) })` — un `new PrismaClient()` pelado
falla en runtime.

## Fase 1 — el usuario admin (único paso por el Job)

El rol se pasa **dentro del signup**, no se actualiza después: `packages/db/src/auth.ts:169-175`
declara `rol` y `sindicatoId` como `additionalFields`, y `seedUsuarios` los manda en el body de
`auth.api.signUpEmail`. El `admin_quivo` va con `sindicatoId: null`.

Importar `dist/auth.js` con `NODE_ENV=production` dispara dos guardas duras que exigen
`RUNTIME_DATABASE_URL` (`client.ts:56-65`) y `JWT_SECRET` (`auth.ts:78-86`). Ambos secretos ya
existen; el Job hoy solo monta `DATABASE_URL` y `QUIVO_APP_NEW_PASSWORD`, así que hay que agregarlos
con `gcloud run jobs update --update-secrets` (merge, **no** `--set-secrets`, que reemplaza).

Las tablas de Better-Auth no tienen RLS y `quivo_app` tiene DML sobre todo `public`, así que correr
con `RUNTIME_DATABASE_URL` es suficiente y correcto: no hace falta el rol de migraciones.

Pasos: crear el secreto `SEED_ADMIN_PASSWORD` con una contraseña aleatoria (`openssl rand`) → darle
acceso a la service account → montar los tres secretos en el Job → ejecutar `auth.api.signUpEmail`
vía `node -e`. Verificación: `POST /v1/auth/login` devuelve token. Ojo con
`@Throttle({ limit: 5, ttl: 60_000 })` en el login: no probarlo en loop.

> **`scripts/deploy-gcp.sh` pisa el Job**: su Paso 2 hace `--set-secrets` y restaura los `--args` de
> migración (`:497-501`). Cualquier deploy posterior borra estos montajes. Si hay que re-ejecutar el
> bootstrap, repetir el paso de montaje.

## Fase 2 — el catálogo, desde el panel

Orden obligatorio: sindicato → socios → líneas → rutas (con geometría) → puntos de control →
vehículos → **activarlos** → conductores → PIN → rotación → asignaciones → **publicar**.

Dos trampas que fuerzan ese orden:

- **Los vehículos nacen en `pendiente`** (`CrearVehiculoSchema` fuerza
  `estado: z.literal('pendiente')`, `packages/shared/src/entities/vehiculo.ts:210`) y el login
  filtra `estado: 'activo'` (`auth-movil.service.ts:687`). Hay que activarlos con
  `PATCH /v1/vehiculos/:id/estado`.
- **Una rotación publicada no admite asignaciones nuevas** (`asegurarRotacionEditable`,
  `rotaciones.service.ts:221,249`), y publicar exige al menos una (`:196-199`). Extender la
  cobertura más adelante significa **crear una rotación nueva en borrador**, no editar la vigente.

### Los datos de prueba

Dos vehículos y seis conductores (uno chofer, cinco pasantes), tres por vehículo: los primeros tres
en la ruta Z12, los otros tres en la 120. Eso calza con el **máximo estructural**: `TurnoSchema` es
`['manana','tarde','noche']` y `Asignacion` tiene `@@unique([vehiculoId, fecha, horario])`
(`schema.prisma:486`), o sea exactamente 3 conductores por vehículo por día.

Detalles que importan al cargarlos:

- Los PIN son **strings**, algunos con cero a la izquierda. Si viajan como número, pierden el cero y
  fallan el regex de 6 dígitos.
- Los seis PIN deben ser **distintos entre sí**: si dos conductores del mismo vehículo comparten
  PIN, la verificación encuentra dos candidatos válidos y devuelve 401 a ambos
  (`auth-movil.service.ts:297-301`).
- `NombrePersonaSchema` rechaza dígitos y paréntesis, así que los nombres tienen que leerse como
  personas reales (`"PILOTO — Chofer 01 (Z12)"` daría 400).
- Los documentos de identidad usan un rango reservado como **marcador de limpieza**, para poder
  identificar estas filas después.
- El `credencialHash` del vehículo queda en NULL: el login de un paso solo verifica el PIN del
  conductor.
- **El turno `noche` vence a las 23:59:59 hora Bolivia** del mismo día calendario
  (`venceAt = finDeJornadaBolivia(fecha)`). Ese conductor no puede loguearse pasada la medianoche.


## Resultado de la ejecución (2026-09-09)

Sembrado y verificado contra la API de producción: 1 sindicato, 2 socios, 2 líneas, 2 rutas con
geometría real (Z12 con 1255 vértices, 120 con 146), 38 puntos de control, 2 vehículos activos,
6 conductores con PIN, 126 asignaciones y la rotación **publicada**. Los seis conductores
autentican por `POST /v1/mobile/auth/sesion`.

Lo hizo `scripts/sembrar-piloto-produccion.ts --apply`. Cuatro cosas que salieron distinto de lo
planeado y quedaron resueltas:

1. **`BETTER_AUTH_URL` no estaba en producción** — bug preexistente que hacía que la API emitiera
   tokens con `iss`/`aud` vacíos y su propio guard los rechazara con 401. El panel nunca había
   funcionado; se descubrió al entrar por primera vez. Arreglado en el servicio y en
   `scripts/deploy-gcp.sh`.
2. **`POST /v1/rotaciones` es `generar()`, no "crear borrador vacío"**: auto-asigna round-robin y
   emparejó mal (el vehículo de Z12 con un conductor de la 120). Hay que borrar lo que genera
   antes de cargar las asignaciones reales.
3. **El rate limit son 100 peticiones por minuto.** Las 126 asignaciones no entran de una; el
   script se corta con 429 y hay que reanudarlo tras esperar la ventana. El estado local
   (`scripts/.estado-siembra-produccion.json`) hace que la reanudación no duplique nada.
4. **`DELETE` sin cuerpo con `content-type: application/json`** da 400 en Fastify. Era un bug del
   script, ya corregido.

**Nota sobre `QUIVO_API_URL`:** el default del script no incluye el prefijo `/v1`, así que hay que
pasarlo explícito.

### Puntos de control omitidos a propósito

De los 16 de la línea 120, se cargaron 12. Los otros cuatro (`A2`, `A3`, `C2`, `C3`) pertenecen a
ramales que este plan no crea y quedan a más de 1 km de la ruta troncal; el servidor rechaza con
400 cualquier punto a más de 100 m (`RUTA_PROXIMIDAD_TOLERANCIA_METROS`, `proximidad-ruta.ts:9`).

## Fase 3 — dar de baja las credenciales

**No hay endpoint DELETE** para vehículos ni conductores, y `SesionOperativa` y `Asignacion` los
referencian con `onDelete: Restrict`. El dominio es soft-delete por diseño.

Corte más limpio, de una sola llamada: `POST /v1/rotaciones/:id/anular` devuelve la rotación a
`borrador` (`rotaciones.service.ts:208-213`) y con eso **ninguna asignación autentica**, porque el
login exige `rotacion.estado='publicada'`. Después, conductores a `inactivo` y vehículos a
`inactivo` (`PATCH /v1/vehiculos/:id/estado`), lo que además **libera las placas**: el índice único
de `placaNormalizada` es parcial, `WHERE estado <> 'inactivo'` (`schema.prisma:173`).

Lo que queda para siempre: las filas apagadas, sus asignaciones y cualquier recorrido/GPS generado.

## Fase 4 — vaciar la base

Se puede, y hoy es barato porque no hay nada real que preservar. `TRUNCATE ... RESTART IDENTITY
CASCADE` sobre las tablas de datos, vía el Job, conservando esquema, migraciones y
`mobility_cities`. **Antes de correrlo hay que listar las tablas reales**
(`SELECT tablename FROM pg_tables WHERE schemaname='public'`) en vez de confiar en una lista escrita
a mano, y tener en cuenta que `gps_points` está particionada. Truncar `"user"` borra el admin: hay
que rehacer la Fase 1 después.

## Riesgos

1. **Estas credenciales son reales y viven en internet.** `quivo-api` es público; el lockout es por
   vehículo, no por IP. Mientras existan, quien adivine placa + 6 dígitos entra como conductor.
   Mitigación: cobertura corta y ejecutar la Fase 3 apenas se termine de grabar. No hay alerta
   automática de "credencial de prueba sigue viva".
2. **Se hace a mano contra producción, sin dry-run.** Cada `POST` commitea; no hay `--apply` como en
   los scripts. Un error de tipeo deja una fila que ya no se puede borrar.
3. **`deploy-gcp.sh` pisa los secretos montados en el Job** (ver Fase 1).
4. **"El panel lleno" es parcial:** sindicatos, líneas, rutas, vehículos, conductores y rotaciones
   se ven poblados; `en-vivo`, `reportes` y `auditoría` quedan **vacíos** hasta que alguien maneje
   con el APK y genere GPS real. No hay atajo por API.
5. **`scripts/crear-credenciales-piloto.ts` queda obsoleto**: es 1:1 (6 vehículos) y exige ids fijos
   de sindicato y rutas que este plan no crea (los genera la API). Correrlo aborta en su Paso 1
   (`:441-458`) — comportamiento seguro, pero conviene que nadie lo intente.

## Lo que este plan no cubre

- El tracking GPS en background: los 4 criterios GO/NO-GO de `docs/spike-gps.md:88-101` siguen sin
  medirse con la app propia.
- El borrado físico de nada (soft-delete por diseño); la única vía a una base limpia es la Fase 4.
- La deuda de `seed.ts` descrita arriba, que va en PR aparte.
