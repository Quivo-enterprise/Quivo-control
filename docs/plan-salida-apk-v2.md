# Plan de salida — APK v2 del conductor

> **Estado:** en ejecución desde el 2026-08-18. Código cerrado en el PR #34; falta la secuencia
> de despliegue de abajo.
>
> **Qué es esto.** El plan de la v2 —qué había que construir y por qué— vive en
> [`plan-v2-app-y-mapa-en-vivo.md`](plan-v2-app-y-mapa-en-vivo.md). Este documento es sólo la
> **secuencia de salida a producción**: en qué orden desplegar para que el APK nuevo sirva de
> algo el día que el conductor lo abra. El orden importa y no es intercambiable.

## Por qué el orden importa

El APK v2 manda `pasada` en cada cumplimiento de punto de control. Esa columna hoy **no existe
en producción** y el worker que ingiere los eventos corre `api:v3`, que no la conoce. Si se saca
el APK primero:

- el worker v3 ignora `pasada` en silencio (es nullable, no falla), y
- se pierde exactamente lo que el sindicato pidió: contar todas las vueltas del día.

No rompe nada, pero mide mal — que es el modo de falla más caro, porque parece que funciona.

## Secuencia

| # | Paso | Verificación |
|---|---|---|
| 1 | Mergear el PR #34 con CI en verde | `main` contiene las dos migraciones nuevas |
| 2 | Aplicar migraciones en producción | `20260817150000_…` aparece en `_prisma_migrations` |
| 3 | Construir y publicar `api:v4` | la imagen existe en Artifact Registry |
| 4 | Redesplegar worker y API con `api:v4` | el worker loguea "escuchando la cola de sync" |
| 5 | Cerrar las 8 sesiones operativas colgadas | `count(*) where estado='activa'` = 0 |
| 6 | Build 7 del APK, perfil `production` | `versionCode` 7 > 6, misma firma |
| 7 | Instalar encima en el S25 y probar en calle | llegan filas a `gps_points` |

### 1 — Mergear el PR #34

Rama `feat/v2-multivuelta-sesion-guiado`. Contiene la Entrega 2 completa del plan v2 más los 11
hallazgos de `/code-review high` ya aplicados.

### 2 — Migraciones

Dos migraciones nuevas, ambas aditivas y sin backfill:

- `20260817140000_cumplimientos_pc_pasada` — `ADD COLUMN pasada INTEGER` (nullable) + índice
  `(sesionId, puntoControlId, ts)`.
- `20260817150000_sesiones_operativas_vehiculo_estado_idx` — `@@index([vehiculoId, estado])`,
  que el `OR` del login necesita para no hacer seq scan.

La última migración aplicada en producción es `20260817130000_particion_gps_points_idempotente`
(2026-08-18 01:28 UTC). Se aplican con el túnel de Cloud SQL levantado:

```bash
cloud-sql-proxy --port 5433 quivo-piloto:southamerica-west1:quivo-control-db
```

**Ojo con el rol.** `migrate deploy` necesita el rol dueño del esquema (`database-url`), no el
runtime con RLS (`runtime-database-url`). Son secretos distintos en Secret Manager.

### 3 y 4 — `api:v4` y redespliegue

El worker corre hoy `api:v3`. Hay que reconstruir la imagen con el `ingesta-worker.service.ts`
nuevo y redesplegar **los dos** servicios:

```bash
gcloud beta run worker-pools update quivo-worker \
  --region=southamerica-west1 --image=.../api:v4
gcloud run deploy quivo-api --region=southamerica-west1 --image=.../api:v4
```

Config actual del worker, que no hay que perder en el update: `scalingMode: manual`,
`manualInstanceCount: 1`, `RUNTIME_DATABASE_URL` por secreto (**no** `DATABASE_URL`, que es
`BYPASSRLS` y rompería el aislamiento), `REDIS_URL=redis://10.182.113.243:6379`, VPC connector y
Cloud SQL adjuntos.

**No confiar en el estado del servicio.** `ioredis` está configurado con
`maxRetriesPerRequest: null` (`ingesta-worker.service.ts:57`): si no llega a Redis reintenta para
siempre en silencio y el servicio igual figura `Ready`. La verificación real es el log
`Worker de ingesta QUIVO listo — escuchando la cola de sync.` más filas nuevas en `gps_points`.

### 5 — Sesiones colgadas

Quedaron **8 sesiones en `estado: 'activa'`** del vehículo `…0014`, entre el 2026-08-16 16:47 y
el 2026-08-17 10:31, porque nada las cerraba. El login del APK v2 cierra las del mismo vehículo
al entrar, así que el problema no se repite — pero las 8 viejas hay que cerrarlas a mano, o la
primera pantalla del panel muestra ocho recorridos abiertos que nunca existieron.

### 6 — Build del APK

```bash
cd apps/mobile && npx eas-cli build --platform android --profile production
```

El último build exitoso es el **6** (`2f4aaa9`, 2026-08-16). Los builds 4 y 5 fallaron y nunca se
hizo el 7: **los fixes del commit `fbfbd56` jamás se compilaron**, así que el APK que hoy está en
el teléfono sigue siendo el del día 1, con el bug de `expo-sqlite`. `appVersionSource: remote` +
`autoIncrement` suben el `versionCode` solos.

Se instala **encima** del 6: misma firma (keystore gestionado por EAS), y las dos bases SQLite
sobreviven. Sólo desinstalar o "Borrar datos" las destruye.

### 7 — Prueba en calle

El gate de aceptación del piloto **no tenía ningún ítem que verificara que `gps_points` recibe
filas** — sólo miraba `/health/ready`, que reporta Postgres y Redis "up" a nivel de conexión. Por
eso el día 1 pasó el gate y no midió nada. La verificación que vale es:

```sql
SELECT count(*), max(ts) FROM gps_points;
```

Hoy: **0 filas**. Cualquier número mayor a cero después de una jornada es la primera evidencia
real de que la cadena completa funciona.

## Estado de producción al 2026-08-18

| Ítem | Estado |
|---|---|
| Asignación de hoy | ✅ existe, rotación `86d20fcf-…` publicada, apunta a `3333…0011` |
| Circuito Z12 | ✅ aplicado — 1255 vértices, 40,7 km, 26 puntos de control activos |
| Worker de ingesta | ✅ desplegado, `api:v3`, escuchando la cola |
| `gps_points` | ❌ 0 filas |
| Migración `pasada` | ❌ sin aplicar |
| Sesiones colgadas | ❌ 8 activas |
| APK en el teléfono | ❌ build 6, con el bug del día 1 |
| Datos reales | ❌ `Sindicato Piloto — PLACEHOLDER`, placa `1111AAA` |

## Lo que queda fuera de esta salida

- **Datos reales** de sindicato, conductor, socio y vehículo. Decisión del CTO, no bloquea el
  APK. **Cambiar la placa cambia la credencial de login del conductor** (`1111AAA` / PIN
  `76179397`): si se cargan, hay que avisarle antes de que salga a la calle.
- **Entrega 3, el mapa en vivo** `/en-vivo`. Va después: sin puntos en `gps_points` la pantalla
  sería correcta y vacía.
- **Política de Redis.** El log del worker avisa
  `Eviction policy is volatile-lru. It should be "noeviction"`. Con un solo vehículo no importa;
  con la flota, Redis puede desalojar jobs de BullMQ bajo presión de memoria y eso es pérdida
  silenciosa de eventos.
- **Rescate del día 1 por el SDK.** Descartado por decisión del CTO: los dos GPX de Geo Tracker
  del 17 de agosto (1505 y 1397 puntos) ya son la traza de esa jornada, y de ellos salió el
  circuito real que hoy está cargado.
