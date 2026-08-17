# Piloto Z12 — rescate del día 1, v2 de la app, y mapa en vivo

## Context

El pedido original fue: *que la web app visualice en vivo, en un mapa, el recorrido del auto del
piloto de hoy*. Al inspeccionar producción para diseñar esa pantalla se descubrió que **el piloto
no registró un solo punto GPS en todo el día 1** (lunes 2026-08-17) y que la app guiaba al conductor
al extremo equivocado de la ruta. Un mapa en vivo no puede mostrar datos que no existen, así que el
trabajo se reordenó en tres entregas con relojes distintos.

El piloto está cerrando, así que las correcciones van como **v2 completa de la app** en vez de
parches a mitad de jornada. Lo único que no espera es el rescate: `maxDaysToPersist` del SDK está
en 1 día, así que los puntos grabados hoy a las 06:00 se podan solos mañana a las 06:00.

### Hallazgos verificados en producción

| Hallazgo | Evidencia |
|---|---|
| **Ningún punto GPS ingerido en el día 1** | 0 `POST /v1/sync/batches` en los logs de Cloud Run; 3 sesiones activas con 0 puntos / 0 cumplimientos / 0 eventos |
| **Causa: regresión de `expo-sqlite@16.0.10`** | Sentry `QUIVO-CONTROL-CONDUCTOR-1`: `Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: java.lang.NullPointerException`, `code: ERR_UNEXPECTED` |
| **El worker de ingesta nunca se desplegó** | Solo existen los servicios `quivo-api` y `quivo-web`. Cero jobs, cero worker pools |
| **La ruta asignada arranca 20 km del punto real de salida** | Breadcrumbs: `GET /v1/mobile/ruta-a-punto?...&destinoLat=-17.3174191&destinoLng=-66.2285535` cada ~12 s = el PC `orden=0` de la ruta `…0011` (Salomón Romero). La app mostraba "A 15.0 km" |
| **Solo se mide la primera vuelta** | El supresor de cumplimientos es durable: se reconstruye del outbox, que nunca se poda |
| **Datos reales nunca cargados** | La app muestra "Sindicato Piloto — PLACEHOLDER", "PLACEHOLDER — conductor p...", "1111AAA - PLACEHOLDER PLACEHOLDER" |
| **3 sesiones abiertas sin cerrar** | `ae54707f` 04:59Z, `1ea1e3c9` 10:12Z, `bb19ce18` 10:31Z, todas `fin: null` |

Dato tranquilizador: los `origenLat` de los breadcrumbs van de `-17.3859` a `-17.3759` subiendo, o
sea **el trufi andaba normal de Villa hacia Univalle**. El GPS del dispositivo funcionaba; lo único
roto era la escritura local.

Mitigación en curso: el acompañante fue a bordo con la planilla manual, que es la única medición
confiable del día 1.

### Hipótesis descartadas (para no volver sobre ellas)
- **Drift de esquema `synced` → `estado`** (commit `d8b7d00` sin migración). Reproducido en
  laboratorio y **real como defecto latente** del repo, pero **no es lo que pasó**: el APK del S25 es
  el build 6, instalado ayer, primera instalación. Se arregla igual en la v2.
- **DDL multi-sentencia.** Refutado: `execAsync` mapea 1:1 a `sqlite3_exec()`, que por diseño itera
  sentencias separadas por `;`; no hay camino distinto en el nativo. Correlacionaba con el eje real
  (frecuencia de apertura) por casualidad. Partir el DDL habría duplicado las llamadas contra el
  handle muerto.
- **Corrupción del archivo, disco lleno, permisos.** La otra base (`quivo-paquete-dia.db`) escribió
  bien todo el día en el mismo dispositivo.
- **Error de SQL.** Sería `ERR_INTERNAL_SQLITE_ERROR` (`SQLExceptions.kt:21-22`), no `ERR_UNEXPECTED`.
- **Concurrencia / `SQLITE_BUSY`.** Daría `InvalidSharedObjectIdException` o
  `UsingReleasedSharedObjectException`. Los pares de errores a 18 ms son dos call sites golpeando un
  handle que ya estaba muerto.

### Decisiones del CTO
1. **Tres entregas separadas**: build de rescate ya · v2 de la app · mapa en vivo después.
2. **v2 con los cuatro bloques**: persistencia e instrumentación · multi-vuelta completo · sesión,
   arranque y datos reales · guiado correcto y eficiencia.
3. El conductor **puede** cerrar sesión y reentrar, pero ver la advertencia del §1.4.
4. Mapa en vivo: polling 10 s incremental, página nueva `/en-vivo`.

---

# ENTREGA 1 — Build de rescate (hoy, vence en ~24 h)

Objetivo: recuperar el recorrido del día 1 antes de que el SDK lo pode, y de paso dejar la app
persistiendo. Mínimo posible, riesgo mínimo.

## 1.1 Por qué el dato existe todavía
Con `autoSync: false` (`background-geolocation.config.ts:56-59`), el SDK de Transistorsoft persiste
**cada** ubicación en su propia SQLite, independiente del outbox roto. Verificado: `persist: true` y
`persistMode: PERSIST_MODE_ALL` (defaults, no se tocan), `maxRecordsToPersist: -1` (sin límite), y
**cero llamadas** en toda la app a `sync()`, `getLocations()`, `getCount()` o `destroyLocations()`.
La base nunca se drenó ni se leyó.

🔴 `maxDaysToPersist` está en su default de **1 día** y la config no lo sobreescribe.

## 1.2 Contenido del build
1. **El fix de persistencia** (§2.1) — singleton de la conexión. Va acá porque sin él el rescate
   extrae el pasado pero el presente sigue perdiéndose.
2. **Pantalla/botón de rescate**: `BackgroundGeolocation.getCount()` primero (solo lectura, dice si
   hay algo antes de invertir en el resto), después `getLocations()`, y subir el JSON.
   Cada `location` trae `uuid`, `timestamp`, `coords.{latitude,longitude,accuracy,speed}` — todo lo
   que `PayloadGpsPointSchema` necesita. Mapear a eventos `gps_point` con `tsFix = location.timestamp`
   y encolarlos por la vía normal (`encolarEvento`), así el dedupe por `eventId` del worker aplica.
3. **`Sentry.captureException` en el catch de foreground** (§2.2) — barato y cierra el bucle.
4. **No** llamar `destroyLocations()` hasta confirmar que los puntos están en `gps_points`.

## 1.3 Build y despliegue
```bash
cd apps/mobile && npx eas-cli build --platform android --profile production
```
Verificado que esto es seguro: el keystore lo gestiona EAS en remoto, así que el build 7 sale con
**la misma firma** que el build 6 que está instalado; `appVersionSource: "remote"` +
`autoIncrement: true` suben el `versionCode` a 7 > 6, que es lo que Android exige para el update
in-place. El perfil `production` ya apunta a la API de Cloud Run y trae el DSN de Sentry.

**Se instala ENCIMA. Las dos bases sobreviven.** Solo desinstalar o "Borrar datos" las destruye.

## 1.4 Instrucciones para el teléfono — destructivas si se ignoran
**Antes de extraer, prohibido:** desinstalar · "Borrar datos"/"Borrar almacenamiento" ·
**cerrar sesión** — el logout hace que el próximo tick headless llame `detenerTrackingNativo()`
(`headless-task.ts:96-104`), que además desactiva `startOnBoot`.

⚠️ Esto **invalida la vía "logout + login"** para recargar la ruta mientras el rescate esté
pendiente. Recargar el paquete se hace **matando la app y reabriéndola**: el restore de sesión
re-pide el paquete sin PIN y sin tocar el tracking.

"Finalizar recorrido" no borra lo grabado pero corta la captura de lo que falte.

En el S25: Ajustes → Batería → sacar QUIVO de "Apps en suspensión", y en la ficha de la app,
Batería → **Sin restricciones**. En Samsung es el asesino clásico del background.

## 1.5 Orden de ejecución
1. Build 7 → instalar encima → `getCount()` → confirmar que hay puntos.
2. Extraer con `getLocations()` → encolar → **desplegar el worker (Entrega 2, §2.5) para que se
   ingieran** → verificar en `gps_points`.
3. Recién ahí, borrón y cuenta nueva si se quiere (desinstalar/reinstalar limpio ya es seguro).

---

# ENTREGA 2 — v2 de la app móvil

## 2.1 Persistencia (el bloque no negociable)

### El fix: singleton con promesa cacheada — `apps/mobile/src/db/outbox.ts`
~25 líneas, un archivo. Reemplaza `abrirOutbox()` por una promesa cacheada a nivel de módulo.
**La referencia de módulo es parte del fix, no una optimización**: mantiene vivo el único objeto JS
registrado, así que el GC de Hermes nunca tiene un objeto viejo que colectar.

```ts
let outboxPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function abrirOutbox(): Promise<SQLite.SQLiteDatabase> {
  outboxPromise ??= abrirOutboxNueva(false).catch((error) => {
    outboxPromise = null;        // no cachear un rechazo: el próximo fix reintenta
    throw error;
  });
  return outboxPromise;
}

/** Escape hatch: el cache de Kotlin sirve la instancia muerta para siempre; `useNewConnection`
 *  es la ÚNICA forma de saltearlo (el predicado de SQLiteModule.kt:110 exige !useNewConnection). */
export function reabrirOutboxTrasFalloNativo(): Promise<SQLite.SQLiteDatabase> { /* forzar true */ }
```

Reglas verificadas contra el nativo:
- **No** usar `useNewConnection: true` en el camino normal: con el singleton no aporta y arriesga una
  segunda conexión al archivo (`SQLITE_BUSY`). Solo en el retry, donde el cache está envenenado.
- **Nada de `closeAsync` en el retry**: sobre un handle muerto también lanza NPE, porque
  `closeDatabase` (`SQLiteModule.kt:513-521`) hace `sqlite3_finalize_all_statement()` por JNI.
- El DDL queda **dentro** de la promesa cacheada → corre una vez por proceso, fuera del path de
  escritura. Sale gratis con el singleton.
- El singleton no rompe el headless task: ese contexto JS tiene su propio `SQLiteModule` y obtiene su
  propio singleton; si RN reusa el contexto vivo, comparte el mismo, que es lo deseable.
- **Mismo patrón en `paquete-dia.ts`** por profilaxis: hoy sobrevive solo porque se abre una vez.

### Respaldo para que un fallo de SQLite nunca descarte un punto
`AsyncStorage` 2.2.0 ya es dependencia y es un módulo nativo independiente de expo-sqlite.
- **Una clave por evento**, nunca un array compartido: `quivo-outbox-fallback:<uuidv7>`. Un `setItem`
  por evento, sin read-modify-write, sin carrera entre `onLocation` y el headless.
- Engancharlo en `encolarEvento`: si el `INSERT` lanza, escribir al respaldo y **resolver ok** — el
  punto quedó persistido, el turno sigue.
- **Drenado** al arrancar y en el tick de 15 s: `getAllKeys()` → filtrar prefijo → reinsertar →
  `multiRemove`. El `eventId` se acuña al respaldar, así que el dedupe del worker cubre un drenado
  doble.
- Límite: ~6 MB de default en Android ÷ ~300 B por punto ≈ 20k puntos de colchón. Reportar a Sentry
  si las claves pasan de ~500 (señal de que SQLite lleva mucho roto).

### Migración del outbox (el defecto latente)
`PRAGMA user_version` + detectar el esquema viejo (`synced`) y migrar con `ALTER TABLE` + backfill de
`estado`. Sin esto, cualquier teléfono con un build anterior al 3 de agosto pierde la evidencia en
silencio, y el próximo cambio de esquema repite la historia.

### Poda del outbox
`purgarAcusadosAntesDe` (`outbox.ts:182`) **no tiene un solo call site** en producción. Llamarla, o
filtrar por `sesionId` en `obtenerPayloadsPorTipo` (`outbox.ts:105-122`, hoy lee la tabla entera sin
filtro). Con N pasadas × 36 puntos × todos los días sin purga, esto crece sin techo.

## 2.2 Instrumentación (por qué tardamos un día en ver el fallo)
1. **`Sentry.captureException` en el catch de foreground** (`use-gps-operativo.ts:80-88`): hoy solo
   hace `console.error`, y nadie lee la consola del teléfono de un conductor en ruta. Los únicos
   `captureException` de la app están en el headless (`headless-task.ts:164,224,239`). Agregar tags
   `{ contexto: 'gps-foreground', paso: 'encolar-punto' }` y extra con el `code` y el contador.
2. **El `code` como señal de primera clase**: `ERR_UNEXPECTED` vs `ERR_INTERNAL_SQLITE_ERROR` vs
   `ERR_ACCESS_CLOSED_RESOURCE` distinguen handle muerto de SQL roto de base cerrada en un campo.
   Loguearlo siempre, y usarlo como trigger: si es `ERR_UNEXPECTED` → `reabrirOutboxTrasFalloNativo()`
   y reintentar una vez.
3. **Renderizar `errorSync`** (`operation-screen.tsx:37`): se destructura y no aparece en ningún JSX.
   Variable muerta — por eso el fallo de sync fue invisible toda la jornada.
4. **Rechazos no manejados** (el `mechanism: onunhandledrejection` de Sentry):
   `use-sync-status.ts:183` tiene `await actualizarPendientes()` **fuera** del try/catch de las líneas
   167-181 — un rechazo cada 15 s, que es exactamente la cadencia vista en los breadcrumbs, y que
   además impide que `iniciarSyncAutomatico` se registre (el motor de sync **nunca existió**). Igual
   en `:140`. Y `operation-screen.tsx:116-132` usa `try/finally` **sin `catch`**: una observación que
   no se puede guardar se pierde con un rechazo suelto.
5. **Contadores de salud**: breadcrumb en cada apertura de base con `{ path, esPrimeraApertura }`.
   Un "apertura #847 de quivo-outbox.db" habría gritado la causa raíz en el primer minuto.

## 2.3 Multi-vuelta (contar todas las pasadas)

**El servidor ya lo soporta hoy, sin migración.** El único UNIQUE de `cumplimientos_pc` es `eventId`
(UUIDv7 por evento); **no existe** constraint sobre `(sesionId, puntoControlId)`. El worker revalida
con `ST_DWithin` puro (`ingesta-worker.service.ts:309-319`) e inserta con `skipDuplicates`. **El bug
es 100% del móvil.**

**El supresor es durable**, no un Set en memoria: `filtrarNuevosCumplimientos`
(`geofence.ts:42-50`) filtra contra un Set que se reconstruye del outbox en cada arranque
(`use-gps-operativo.ts:175-176`), leyendo la tabla entera sin filtro. Sobrevive al headless, al kill
y al reboot. No hay grieta por donde se cuele una segunda vuelta.

**No alcanza con quitarlo**: `detectarPuntosControlCercanos` no tiene noción de entrada/salida, solo
"estoy cerca ahora". Un layover en la terminal Univalle emitiría 6 eventos por minuto de espera —
60 filas falsas por una sola pasada.

### Máquina de estados con histéresis
`Set<string>` → `Map<string, EstadoPuntoControl>` con `{ dentro: boolean, ultimoEmitidoMs: number }`,
misma clave `${sesionId}:${puntoControlId}`.

| Estado | Condición | Acción |
|---|---|---|
| `dentro: false` | `distanciaM <= radio` **y** `tsFix - ultimoEmitido >= PASADA_MIN_MS` | **emitir**, `dentro = true` |
| `dentro: true` | `distanciaM <= radio * 1.5` | nada (misma pasada) |
| `dentro: true` | `distanciaM > radio * 1.5` | `dentro = false` (re-arma, no emite) |

**Re-armar a 225 m (radio × 1.5), no al radio**: con precisión urbana de 10-30 m, un vehículo
detenido a 145 m del punto entraría y saldría con el jitter de cada fix. Y 225 m se cubren en ~40 s
a 20 km/h (2-4 fixes), así que re-arma mucho antes de la vuelta siguiente.

**Piso de 2 min sobre `tsFix`, no `Date.now()`**: el re-armado por distancia ya resuelve el layover;
el piso cubre el salto de GPS (túnel, cambio de torre). No 5 min como el replay SQL: a 20 km/h un
punto a 1 km de la terminal se pisa de ida y de vuelta con ~6 min de separación, y con tráfico menos
— 5 min borraría esa pasada genuina. Y con `Date.now()`, una ráfaga de salida de Doze colapsaría 20
fixes de minutos distintos en una sola pasada.

### La trampa que haría inútil todo el fix
Si `clavesCumplimientoDesdePayloads` (`location-task.ts:168-178`) solo cambia de `Set` a `Map` con
`dentro: true`, **sigue suprimiendo todas las vueltas**. Tiene que agrupar por clave, tomar el
`max(tsFix)` y derivar `dentro` como **función del tiempo**: última emisión hace 3 h ⇒ ya salió,
`dentro: false`; hace 40 s ⇒ sigue dentro. Eso además cierra el hueco de duplicación por reciclado
del contexto JS que `headless-task.ts:140-143` describe.

### Aditivo en el servidor
- **`cumplimientos_pc.pasada INT NULL`** + campo en `PayloadCumplimientoPuntoControlSchema`
  (`evento.ts:72-78`) leído en `procesarCumplimientoEnTx:338-352`. Nullable para APKs viejos. Sin
  esto no se distingue "no pasó en la vuelta 3" de "pasó y se perdió el evento".
- **`@@index([sesionId, puntoControlId, ts])`**: hoy los índices son separados y la consulta natural
  del nuevo mundo no tiene ninguno que la sirva.
- **NUNCA un UNIQUE sobre `(sesionId, puntoControlId, pasada)`.** Si la semilla falla, el contador
  reinicia en 1 y el UNIQUE **descarta una pasada real en silencio**. Un constraint que borra
  evidencia es peor que un duplicado detectable.
- `vuelta` materializada: diferir. Se deriva por SQL con función de ventana (`LAG` + umbral de 2 min)
  y un ancla elegida a mano — para Z12 **no sirve el `orden` mínimo**, porque ese tramo se recorre
  una sola vez al día; el ancla es la Parada Univalle.

### Consumidores a corregir
- `reportes/page.tsx:176-180` y `:226-229`: relabelar. El denominador **no** es el total de puntos de
  la ruta sino el total de filas, así que el % **no** pasa de 100 — pero un supervisor leería
  **"180 / 180 puntos de control"** en una ruta de 36. Cambio de string.
- `exportes.service.ts:81-85,168-172`: headers del CSV, mismo problema, agravado por `SUM()`.
- `recorridos/[id]/page.tsx:113`: `.find()` → `.filter()`, mostrar `"N pasadas · última a Xm"`. Hoy
  se queda con la pasada más temprana y descarta las N-1 en silencio.
- `construirTimeline` (`:130-146`) **no se toca**: ya mapea todos los cumplimientos y **mejora** con
  N pasadas — pasa a ser la bitácora del día, que es justo lo que hay que cruzar con la planilla.
- `reglas/` y `sanciones/`: no se rompe nada, no hay motor de evaluación (`tipo` es texto libre y el
  servicio es CRUD puro).

**La planilla del acompañante ya está en el modelo correcto**: tiene columna `Vuelta` y 20 filas de
"cada paso" (`docs/piloto/planilla-acompanante.md:31,54`), y pide "total de pasos" como denominador.
Hoy el cruce es estructuralmente imposible: ella trae ~20 pasos y el sistema una sola vuelta.

## 2.4 Sesión, arranque y datos reales
1. **El 401 del refresh** (`use-auth-movil.ts:107-118`): un 401 con red OK no es `kind: 'network'` →
   `borrarSesionMovil()` + vuelta a la pantalla de vehículo → se desmonta `GpsProvider` → se remueve
   la suscripción `onLocation` (el SDK sigue grabando, pero nadie copia al outbox), y habilita el
   `stop()` headless irreversible. **Explica los 3 logins y las 3 sesiones sin cerrar.** Decidir el
   comportamiento correcto: reintento con backoff, o mantener la sesión local y degradar a offline.
2. **Orden en `iniciar()`** (`use-gps-operativo.ts:165` vs `:180`): abre el outbox **antes** de
   `BackgroundGeolocation.start()`, así que un fallo de SQLite impide arrancar el GPS y muestra
   "Revisa permisos y licencia del módulo nativo" — mandando el diagnóstico al lugar equivocado.
   Arrancar el tracking primero.
3. **`setTracking(true)` antes de encolar `inicio_recorrido`** (`:179-184`): si el encolado falla, la
   UI dice "EN LÍNEA" mientras el catch ya removió la suscripción.
4. **El Set se muta antes de confirmar la escritura** (`location-task.ts:123-126`): un fallo de
   outbox marca el punto como emitido y suprime su reemisión.
5. **Sesiones colgadas**: nada cierra una `sesion_operativa` salvo `detener()`, que encola
   `fin_recorrido`. Definir vencimiento por `venceAt` en el servidor o cierre al detectar un login
   nuevo del mismo vehículo.
6. **Cargar los datos reales** de sindicato, conductor, socio y vehículo en producción: hoy siguen en
   PLACEHOLDER y se ven en la primera pantalla de la app.

## 2.5 Guiado correcto y eficiencia

### Reapuntar la ruta del día
Los dos extremos reales de las geometrías de la Z12, leídos de producción:

| Ruta | `sentido` | v0 (arranque) | vN | PCs activos | `orden=0` |
|---|---|---|---|---|---|
| `…0011` **(asignada)** | ida | `-17.3175, -66.2285` Salomón Romero | `-17.4385, -66.1508` Villa Armonía | 14 | Salomón |
| `813c6130-…` | vuelta | `-17.4385, -66.1508` **Villa Armonía** | `-17.3388, -66.2210` Univalle | 14 | **Villa Armonía** |

`813c6130` cubre Villa → Univalle (la vuelta 1 casi entera y **todas** las 2+) y ya tiene sus 14
puntos ordenados desde Villa. Es la ruta correcta.

`ActualizarAsignacionSchema` acepta `rutaId` (`asignacion.ts:45`) pero `actualizarAsignacion` pasa
por `asegurarRotacionEditable` (`rotaciones.service.ts:313-318`), que exige `borrador`. Secuencia,
**sin pausa entre pasos**:
1. `POST /v1/rotaciones/86d20fcf-…/anular`
2. `PATCH /v1/rotaciones/86d20fcf-…/asignaciones/a4ceff01-…` con
   `{"rutaId":"813c6130-2c30-46e4-b533-e3ca2ba17cd2"}`
3. `POST /v1/rotaciones/86d20fcf-…/publicar`
4. Verificar con `GET` que quedó `publicada` y con el `rutaId` nuevo.

Mientras está en `borrador`, `buscarAsignaciones` exige `rotacion: { estado: 'publicada' }`
(`auth-movil.service.ts:429`) y **cualquier login nuevo** falla. La sesión ya activa **no** se corta
(ni `obtenerContexto` ni `asignacion-del-dia` miran el estado de la rotación, y `anular()` no toca la
fila de `asignacion`). Costo de datos: **nulo**, no hay cumplimientos ni puntos que reatribuir.

Alternativa más barata si no se quiere tocar la rotación: renumerar el `orden` de los 14 puntos de
`…0011` con `PATCH /v1/puntos-control/:id`, que **no** pasa por `asegurarRotacionEditable`. Se
descarta porque deja la geometría describiendo un tramo que no se recorre y sin Univalle.

### Desplegar el worker de ingesta
Sin esto, `POST /v1/sync/batches` encola en BullMQ y **nada consume la cola**: `gps_points` queda
vacía y ni el rescate ni el mapa sirven. `sync_errors` está en 0 porque el único que escribe ahí es
el worker.

Verificado: `apps/api/src/worker.ts:18` usa `createApplicationContext` (no escucha puerto ⇒ tiene que
ser **Worker Pool**, no un service); `:25` llama `enableShutdownHooks()`; y **la imagen `api:v3` ya
contiene `apps/api/dist/worker.js`** (comprobado corriéndola: 1535 B, junto a `main.js` de 4716 B,
Node v22.23.2). **No hace falta rebuild.** `Dockerfile:86-109` documenta este despliegue.

```bash
gcloud run worker-pools deploy quivo-worker \
  --project quivo-piloto --region southamerica-west1 \
  --image southamerica-west1-docker.pkg.dev/quivo-piloto/quivo/api:v3 \
  --command=node --args=apps/api/dist/worker.js --instances=1 \
  --service-account 424426714260-compute@developer.gserviceaccount.com \
  --vpc-egress private-ranges-only --vpc-connector quivo-connector \
  --add-cloudsql-instances quivo-piloto:southamerica-west1:quivo-control-db \
  --set-env-vars NODE_ENV=production,REDIS_URL=redis://10.182.113.243:6379 \
  --set-secrets RUNTIME_DATABASE_URL=runtime-database-url:latest
```
Requiere `gcloud components install beta`. El worker necesita **solo 3** env, no las 7 del API: no
usa `JWT_SECRET`, `DATABASE_URL`, `BETTER_AUTH_URL` ni `CORS_ORIGIN`. **Ojo**: usar `DATABASE_URL`
por error funcionaría pero rompería el aislamiento RLS (ese rol es `BYPASSRLS`).

**Trampa**: `ioredis` se crea con `maxRetriesPerRequest: null`
(`ingesta-worker.service.ts:57`) — si no llega al Redis privado **no tira error, reintenta para
siempre en silencio**. Un worker "corriendo" sin red parece sano. Verificar por logs de conexión y
por el conteo de `gps_points`, no por el estado del servicio.

Verificar particiones antes: el bootstrap de `20260802160000_ingesta_gps_worker/migration.sql:57-64`
creó `CURRENT_DATE-1..+6` al aplicarse, y esa ventana **no se extiende sola** sin el worker. Al
desplegarlo, `onModuleInit` corre `asegurarParticionesFuturas()` de inmediato
(`ingesta-worker.service.ts:86`) y suma 5 días. Un `INSERT` fuera de partición aborta el lote entero
y manda los N eventos a `sync_errors` con `no partition of relation "gps_points" found for row`.

### Eficiencia y UX
- **`ruta-a-punto` una vez por fix GPS** (~12 s, siempre al mismo destino): cachear por punto destino
  e invalidar solo al cambiar de objetivo.
- **Reset del "próximo punto" por vuelta** (`operation-screen.tsx:43-57`): `completados` solo crece,
  así que al terminar la vuelta 1 muestra "sin próximo punto" el resto del día. Quitar el supresor
  **no** lo arregla — re-detectar un punto ya completado es un no-op en el Set.
- Ya funciona bien para N pasadas y no hay que tocarlo: el aviso por voz compara contra
  `ultimoHablado` (`gps-provider.tsx:38-40`), así que A→B→A vuelve a avisar.

## 2.6 Verificación de la v2
```bash
pnpm --filter @quivo/shared build && pnpm typecheck && pnpm lint
pnpm --filter @quivo/mobile test    # geofence.test.ts, location-task.test.ts
```
`geofence.ts` y `location-task.ts` son puros y ya tienen suite, así que la máquina de estados se
testea en Node sin dispositivo. Casos nuevos obligatorios: dwell largo dentro del radio (**1** sola
emisión) · salida a 200 m y regreso (**sin** segunda emisión, la histéresis funciona) · salida a
300 m y regreso (**sí** segunda emisión) · jitter de 1 fix a 400 m (sin emisión, por el piso de
2 min) · siembra desde outbox con `tsFix` viejo (**no** suprime).

Estos dos archivos son el camino que escribe la evidencia legal (RF-67..73): una regresión ahí no
degrada la medición, **borra el día**.

En dispositivo: correr una jornada de prueba y confirmar en Sentry que el breadcrumb de apertura dice
**una** apertura por proceso, no cientos.

---

# ENTREGA 3 — Mapa en vivo en el panel (`/en-vivo`)

Va después de la v2: sin puntos en `gps_points` la pantalla es correcta pero vacía.

**Ajuste obligado por lo aprendido**: hoy hubo **3 sesiones activas simultáneas** del mismo vehículo
en dos dispositivos. El diseño no puede asumir "la sesión activa" en singular — lista todas, elige
por defecto la de **último fix** (no la más reciente por `inicio`) y muestra `deviceId` para
distinguir los teléfonos.

## 3.1 Contratos Zod — `packages/shared/src/entities/en-vivo.ts`
Convenciones del paquete: zod v3, timestamps `z.string()` (no `.datetime()`), `uuidSchema` de
`../primitives.js`, GeoJSON de `../geo.js`, query params con `z.coerce`. Reusar
`PuntoTrazaGpsSchema`, `CumplimientoRecorridoSchema` y `PuntoControlRecorridoSchema` de
`entities/recorrido.ts:25,37,57`. Export en `entities/index.ts`.

- **`SesionEnVivoResumenSchema`** (`GET /v1/reportes/en-vivo`): + `deviceId`, `activa`,
  `ultimoFixTs`, `ultimoIngresoTs`, `totalPuntos`, `servidorTs`. `ultimoFixTs` (=`max(ts)`) vs
  `ultimoIngresoTs` (=`max(received_at)`) distinguen "el celular no sincroniza" de "sincroniza fixes
  viejos" — distinción que hoy vale oro.
- **`ContextoEnVivoSchema`** (`/:sesionId/contexto`): sesión, vehículo, conductor, línea, ruta con
  geometría, puntos de control. Se pide una vez (`staleTime: Infinity`) — la geometría de la Z12 son
  cientos de vértices y reenviarla cada 10 s es ~90 % del payload y 0 % de información nueva.
- **`TrazaEnVivoQuerySchema`/`TrazaEnVivoSchema`** (`/:sesionId/posiciones`): `desde`, `limite`;
  respuesta con `puntos`, `cursor`, `hayMas`, `totalPuntos`, `cumplimientos`, `servidorTs`.

## 3.2 API — `apps/api/src/modules/reportes/en-vivo.{service,controller}.ts`
Endpoints nuevos, no params sobre los existentes: `RecorridoDetalleSchema` y
`RecorridosService.obtener` los consumen la página del histórico y 6 aserciones de su test.

`listarHoy(actor, ahora = new Date())` — ventana del día con `fechaActualBolivia` +
`inicioDeJornadaBolivia`/`inicioDeJornadaSiguienteBolivia` (`common/tiempo/jornada.ts:13,21,35`), y
cotas **constantes** para la traza (partition pruning en tiempo de plan). `$queryRaw` con
`LEFT JOIN LATERAL` a `gps_points` para `max(ts)`, `max(received_at)`, `count(*)::int`.
`ORDER BY (so.fin IS NULL) DESC, fix."ultimoFixTs" DESC NULLS LAST, so.inicio DESC`. `WHERE` con dos
ramas: iniciadas hoy **OR** `fin IS NULL AND estado='activa'` (cubre las que quedan abiertas, que hoy
sabemos que pasa).

Dos detalles no negociables: `gp.sesion_id = so.id::uuid` (`sesiones_operativas.id` es `text` y
`gps_points.sesion_id` es `uuid`; castear del otro lado mata el índice) y `count(*)::int` (sin el
cast, Fastify tira `Do not know how to serialize a BigInt`).

`obtenerContexto` — copia la primera mitad de `RecorridosService.obtener` (`:91-124`) sin
traza/cumplimientos. `findUnique` **primero** (es el tenant-check real de RLS). Puntos de control
**filtrando `estado='activo'`**, como `tracking/paquete-dia.service.ts:67` (commit `9a0e472`).

`obtenerTraza` — ventana anclada a `sesion.inicio` (no al día calendario, para no cortar una sesión
que cruza medianoche): `piso = inicio - 60s`, `techo = min((fin ?? ahora) + 2h, inicio + 36h)`,
`desde = max(query.desde ?? piso, piso)` — el cursor del cliente solo puede recortar. Delta con
`LIMIT limite+1` para `hayMas`.

Controller: misma pila que `recorridos.controller.ts` + **`@Throttle({ limit: 300, ttl: 60_000 })`**
(el global es 100 req/min/IP, compartido con el resto del panel).

## 3.3 Design system — `route-map-impl.tsx`
Cuatro props **opcionales** (back-compat total con los 2 consumidores actuales):
`fitMode?: 'auto'|'once'|'off'` (default `'auto'` = comportamiento actual), `fitKey?`,
`followPoint?`, `onUserPan?`. Tres hijos nuevos dentro del `LeafletProvider`: `FitBoundsOnce`,
`FollowPoint` (solo `panTo`, y **solo si el punto salió del 60 % central** para que no vibre con el
ruido GPS estando parado), `UserGestureWatcher`.

**`MapCanvas` (líneas 108-147) no se toca**: existe porque `<MapContainer>` de react-leaflet 4.2.1 no
sobrevive el doble montaje de Strict Mode. No hace falta marcador nuevo (`pinType: 'pulse'` existe) ni
círculos (`zones` con `radiusMeters` ya se renderiza, `:235`). Sin heading: `gps_points` no tiene esa
columna.

## 3.4 Cliente y página
**TanStack Query** (ya instalado, provider montado en `app/providers.tsx`, sería el primer consumidor
real): `refetchInterval` variable por estado, pausa con pestaña oculta + catch-up al volver el foco,
backoff por `retry`, y **dedupe por queryKey** — que acá no es cosmético, porque `apiFetch` no acepta
`AbortSignal` y sin dedupe dos polls solapados podrían aplicarse fuera de orden.

Merge del delta **contra la cache** (`qc.getQueryData` en el `queryFn`), no contra un `useState`
aparte: una sola fuente de verdad, sobrevive remounts, idempotente frente al doble render de Strict
Mode. Dedupe por `ts|lat|lng`, `structuralSharing: false`.

**Solape de 2 min en el cursor + auto-heal**: `gps_points.ts` es el timestamp del **fix**, no de la
ingesta, y al salir de Doze llegan ráfagas con `ts` viejos — un cursor exclusivo los pierde para
siempre. Pedir `desde = cursor - 120_000`, y si el acumulado queda bajo `totalPuntos`, recargar
entero **una** vez.

`refetchInterval`: `hayMas` → 1 s · sesión con `fin` +5 min → `false` (se corta solo) · normal →
**10 s**.

Página `/en-vivo` `'use client'`. **Antigüedad medida contra el reloj del server**
(`offset = servidorTs - dataUpdatedAt`): un navegador con el reloj corrido mostraría "sin datos hace
3 h" con el trufi andando. Frescura: **<90 s verde · 90 s-5 min ámbar · >5 min rojo**, justificado por
`distanceFilter: 50` + `locationUpdateInterval: 10_000` + backoff 2 s→60 s + worker.

Estados: cargando · **cero sesiones** (`Alert info`, sin mapa roto) · contexto cargando · **sesión
activa con 0 puntos** (ruta y PCs dibujados + "Esperando el primer punto GPS") · atrasado · sin datos
(con **las dos** métricas) · finalizada (+ link al histórico) · error con data previa (la traza sigue
en pantalla) · error sin data (+ "Reintentar") · traza incompleta (+ "Recargar") · selector de sesión.

Nav: `{ id: 'en-vivo', label: 'En vivo', href: '/en-vivo', roles: ['admin_quivo','admin_sindicato'] }`
como **segundo** ítem de `NAV_ITEMS`. `isRouteAllowedForRole` ya gatea la URL directa.

## 3.5 Seguridad y performance
`findUnique` primero ⇒ cross-tenant recibe **404**. `gps_points` tiene RLS propia en el padre **y en
cada partición** (`20260815120000_gps_points_sindicato_rls`): consultar **siempre la tabla padre**,
nunca `gps_points_YYYYMMDD`. `rutas`/`puntos_control` **no tienen RLS**: se leen solo con el `rutaId`
derivado de una fila ya filtrada. `desde` clampeado en el server. Los GET del poll no escriben en
`audit_log` (el interceptor solo actúa con `@Auditable`) — si no, ~500 filas basura por hora.

Índice `gps_points_sesion_ts_idx`: range scan para el delta, index-only para los agregados. Día
completo ≈ 4.300 puntos ≈ 250 KB en la carga inicial; en régimen el delta son 1-2 puntos. ≈8 req/min
por pestaña. Verificar el plan con `EXPLAIN (ANALYZE, BUFFERS)`: debe haber **una** sola partición en
el `Append`.

## 3.6 Verificación
Datos de prueba: **REGLA DURA — nunca insertar puntos de prueba en el sindicato piloto
`33333333-3333-4333-8333-333333333333`.** Usar el tenant demo (`1001ABC`), que el seed ya deja con
asignación de hoy (`seed.ts:349-388`): `crear_particion_gps_points(CURRENT_DATE)` → sesión activa →
fixes con `ST_LineInterpolatePoint`, y un loop que agrega uno cada 5 s para ver el marcador moverse.

**En local hay que levantar el worker aparte** (`pnpm --filter @quivo/api start:worker`):
`scripts/dev-all.sh` no lo arranca — el mismo olvido que tumbó producción. **CORS**: el default de la
API es `:3000` y `dev-all` sirve la web en `:3100`.

Navegador (`playwright` + `puppeteer`): `.../posiciones?desde=…` con el `desde` **avanzando** y
`contexto` **una sola vez** · consola sin `Map container is already initialized` · pestaña en
background sin requests y una inmediata al volver · `browser_drag` apaga "Seguir" y el mapa no salta ·
`admin@aislamiento.local` recibe **404** en la sesión del piloto · smoke de no-regresión en `/rutas` y
`/reportes/recorridos/[id]`.

---

# Cierre

Rama nueva **desde `main`** por entrega (la actual `docs/ruta-real-z12` tiene un commit de docs sin
mergear; no mezclar). Por cada una: `/code-review` + `/security-review` cuando toque endpoints, RLS o
roles → aplicar hallazgos con un subagente nuevo → commit → push → PR → CI → merge → borrar rama →
actualizar `docs/handoff.md`.

**No commitear `docs/Credenciales demo day QUIVO CONTROL`** (untracked, credenciales en texto plano
con PINs del vehículo y del conductor).

**Issue upstream a abrir en expo/expo** — la regresión de #27748 y los defectos vecinos:
`sharedObjectDidRelease` cierra el binding sin chequear refcount · no quita la instancia de
`cachedDatabases`, así que el zombi se sirve indefinidamente · TOCTOU en el `Constructor`
(`SQLiteModule.kt:110-132`) · `removeAllCachedDatabases()` devuelve la misma referencia que después
`clear()`ea, así que el `OnDestroy` nunca cierra nada · `NativeDatabaseBinding.cpp:84` declara
`char *error;` sin inicializar y lo lee si `db` es null (UB) · lecturas sin sincronizar de `pairs` en
`SharedObjectRegistry.kt:96-99,128-132`.

Tickets nuevos: worker fuera de IaC (sumar a QUI-370) · **ítem de checklist que verifique que
`gps_points` recibe filas** — el gate actual solo mira `/health/ready`, que reporta Postgres y Redis
"up" a nivel de conexión y por eso no detectó nada · datos reales en PLACEHOLDER · sesiones que
quedan `activa` para siempre · `puntos_control` sin campo de nombre · denominador honesto del % de
cumplimiento (hoy el worker revalida con las mismas coordenadas que mandó el teléfono, así que la
métrica se mide contra sí misma).

## Fuera de alcance
ETAs · map matching / OSRM · tiles propias / MapLibre · heading del marcador · migrar el resto del
panel a TanStack Query · dibujar ruta/PCs antes de que exista sesión · `vuelta` materializada.
