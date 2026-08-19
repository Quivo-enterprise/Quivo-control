# Issues pendientes — GPS y sesión operativa (2026-08-19)

El workspace de Linear excedió el límite del plan gratuito y no se pudieron crear los
issues directamente. Este documento deja los cuatro issues redactados y listos para
copiar y pegar en Linear en cuanto haya cupo. Cada sección `##` es un issue completo
(título, prioridad, estimación, descripción, evidencia, causa raíz, qué hacer y
criterio de aceptación) pensado para pegarse tal cual, sin edición previa.

Orden: de mayor a menor prioridad.

---

## Issue 1 — La sesión operativa no se cierra al finalizar el recorrido

**Prioridad sugerida:** Urgente
**Estimación sugerida:** ~3 pts

### Descripción del problema

El botón "Finalizar recorrido" registra el evento `fin_recorrido` en el outbox local,
pero no cierra la `sesion_operativa` en el backend: la sesión queda `activa` con
`fin` en `NULL` para siempre, aunque el conductor haya confirmado el fin del turno.

### Evidencia

Jornada del 2026-08-18, consultada en producción: la sesión
`0b14f656-1352-48ee-984e-65ff82c2af06` tiene un evento `fin_recorrido` a las 23:21:41
hora local, y sigue `activa` con `fin` en `NULL`. La conductora sí presionó el botón.
Al cierre de la jornada quedaron 2 sesiones activas, una por vehículo.

### Causa raíz

Hay dos conceptos de sesión desconectados entre sí:

- El botón "Finalizar recorrido" (`apps/mobile/src/features/operacion/operation-screen.tsx:499`,
  dentro del `onConfirm` del diálogo de confirmación en las líneas 489-501) llama a
  `gps.detener()`.
- `detener()` (`apps/mobile/src/features/operacion/use-gps-operativo.ts:603`) para el
  tracking nativo y encola el evento `fin_recorrido` en el outbox — pero no toca la
  `sesion_operativa`.
- La `sesion_operativa` solo se cierra en tres lugares de
  `apps/api/src/modules/auth-movil/auth-movil.service.ts`:
  - `logout()` (líneas 336-347).
  - El reset de PIN admin, vía `establecerPin()` (líneas 371-419, que cierra las
    sesiones activas del vehículo/conductor al resetear la credencial).
  - El cierre automático cuando entra un login nuevo del mismo vehículo/dispositivo
    (líneas 223-231, dentro del flujo de canje de desafío).

Terminar un recorrido no dispara ninguno de los tres.

### Por qué importa

Las 8 sesiones colgadas del 2026-08-16/17 (documentadas en
`docs/plan-salida-apk-v2.md:94-99`) tienen esta misma causa de fondo. El fix de
entonces —cerrar las sesiones viejas en el próximo login del mismo vehículo— tapa el
síntoma, no la causa: si un vehículo no vuelve a loguearse (se rompe el teléfono, se
da de baja, termina la temporada), la sesión queda activa indefinidamente porque no
hay timeout server-side. Además, el mapa en vivo va a listar vehículos a partir de
sesiones activas: sin este fix va a mostrar vehículos fantasma que ya terminaron su
turno.

### Qué hay que hacer

1. Que `detener()` (o el evento `fin_recorrido` al llegar al backend) cierre la
   `sesion_operativa` correspondiente (`estado: 'cerrada'`, `fin`, `revokedAt` o el
   campo que corresponda), con el mismo patrón que ya usan `logout()` y
   `establecerPin()`.
2. Agregar un cierre por inactividad como red de seguridad server-side (p. ej. un job
   o un check en el próximo request que cierre sesiones `activa` sin actividad más
   allá de un umbral razonable), para no depender de que el cliente avise.
3. Cerrar a mano las 2 sesiones abiertas detectadas en la jornada del 2026-08-18:
   `07d24b22-034e-4b9d-9412-423fab0e2375` y `0b14f656-1352-48ee-984e-65ff82c2af06`.

### Criterio de aceptación

- Al presionar "Finalizar recorrido" y confirmar, la `sesion_operativa` asociada
  queda `estado: 'cerrada'` con `fin` seteado, verificable con una consulta SQL
  inmediatamente después del flujo.
- Una sesión sin actividad por más del umbral definido se cierra sola, sin depender
  de un nuevo login.
- Las 2 sesiones de la jornada del 2026-08-18 quedan cerradas en producción.

---

## Issue 2 — La captura de GPS se apaga con el vehículo detenido

**Prioridad sugerida:** Alta
**Estimación sugerida:** ~5 pts

### Descripción del problema

Con el vehículo detenido (paradas largas en punto de espera), el plugin de
geolocalización deja de capturar puntos casi por completo. No es un problema de
envío al backend (ver Issue 3): la captura local se detiene.

### Evidencia

Huecos de 56, 22, 17 y 11 minutos sin un solo punto, todos ubicados en los dos puntos
de espera de la línea (Univalle y terminal sur). Durante el hueco de 56 minutos se
registró **1 solo punto** en toda la ventana. En movimiento, en cambio, el muestreo es
sano: mediana de 81-103 m entre puntos consecutivos.

### Causa raíz

**Primera causa**, documentada en el wiki oficial de Transistorsoft
(https://github.com/transistorsoft/react-native-background-geolocation/wiki/Philosophy-of-Operation):
el plugin alterna entre estados *moving* y *stationary*. Al detectar quietud arranca
un timer de `stopTimeout` — en nuestra config, 5 minutos
(`apps/mobile/src/gps/background-geolocation.config.ts:49`, `stopTimeout: 5`) — y al
expirar **apaga los servicios de ubicación**. Solo los vuelve a encender si detecta
movimiento o si el dispositivo sale de una **geocerca de 200 m** alrededor de la
última posición registrada. Un vehículo esperando en una terminal no sale de esos
200 m.

**Segunda causa:** `allowIdenticalLocations` no está seteado en
`apps/mobile/src/gps/background-geolocation.config.ts` (confirmado: no aparece en el
bloque `geolocation` del archivo). Su default en Android es `false`, así que el
plugin **descarta los fixes idénticos** — justo los que genera un vehículo parado.

### Trampa a documentar (importante para quien lo implemente)

Activar `heartbeatInterval` **no alcanza por sí solo** para resolver esto. La
documentación de `onHeartbeat`
(https://transistorsoft.github.io/react-native-background-geolocation-android/classes/backgroundgeolocation.html)
dice que el evento entrega **solo la última posición conocida** y **no enciende los
servicios de ubicación**. Sin llamar a `getCurrentPosition()` dentro del handler, se
reciben horas del mismo punto viejo repetido. En Android, el mínimo del
`heartbeatInterval` es 60 segundos.

### Qué hay que hacer

1. Setear `allowIdenticalLocations: true`.
2. Setear `heartbeatInterval: 60` **más** un handler `onHeartbeat` que llame
   explícitamente a `getCurrentPosition({samples: 1, persist: true, timeout: 30,
   extras: {trigger: 'heartbeat'}})`. Registrar el `trigger` en el punto persistido
   para poder distinguir en la base los puntos de heartbeat de los de movimiento
   normal.
3. Mantener `stopTimeout` en 3-5 minutos (subirlo deja el GPS a full todo el tiempo:
   es la opción cara en batería).
4. Evaluar `disableElasticity: true` para que la mediana de 81-103 m entre puntos sea
   estable y no dependa de la velocidad del vehículo.
5. Dejar `disableStopDetection: true` como plan B (fidelidad total, el GPS nunca se
   apaga, pero es la opción más cara en batería) — usarla solo si se confirma que los
   conductores cargan el teléfono en el vehículo durante todo el turno.

### Contexto de industria (para no reinventar la rueda)

Los SDK de telemática comercial hacen exactamente lo mismo — apagan el GPS con el
vehículo detenido — porque el GPS continuo a 1 Hz cuesta 5-10% de batería por hora.
La fidelidad con el vehículo detenido es una decisión de producto, no un límite
técnico del plugin. La telemática seria (Samsara, Geotab) resuelve el estacionado con
hardware OBD-II dedicado, no con el teléfono del conductor.

### Criterio de aceptación

- En una jornada real con paradas largas en punto de espera, no hay huecos sin puntos
  mayores a `heartbeatInterval` + margen razonable (p. ej. < 3 minutos).
- Los puntos generados durante una parada quedan marcados con `trigger: 'heartbeat'`
  y son distinguibles en la base de los puntos de movimiento.
- La mediana de distancia entre puntos en movimiento se mantiene estable tras el
  cambio (no empeora respecto a la línea base de 81-103 m).

---

## Issue 3 — El outbox no se drena con la app en background

**Prioridad sugerida:** Alta
**Estimación sugerida:** ~5 pts

### Descripción del problema

Los puntos GPS capturados tardan demasiado en llegar al servidor cuando la app está
en segundo plano, y llegan en ráfagas en vez de un flujo constante.

### Evidencia

El lag entre el momento de captura (`ts`) y la llegada al servidor (`received_at`)
tiene mediana de 153-166 s, p95 de 684-814 s, y un máximo de 4275 s (71 minutos). Los
puntos llegan agrupados: se registraron hasta 77 puntos en un mismo minuto de
`received_at`.

### Causa raíz

La captura escribe directo a SQLite local sin depender de la red
(`apps/mobile/src/gps/headless-task.ts:141-191`, función `registrarPuntoGps` /
`registrarPuntoGpsInterno`), pero el envío al backend es un pipeline aparte
(`apps/mobile/src/features/operacion/sync-outbox.ts`) que se dispara solo por:

- (a) Cambios de conectividad de NetInfo
  (`apps/mobile/src/features/operacion/sync-outbox.ts:178-182`, el listener
  `NetInfo.addEventListener`), que solo actúa en la transición de estado, no de forma
  periódica.
- (b) Un `setInterval` de 15 segundos
  (`apps/mobile/src/features/operacion/use-sync-status.ts:177-208`, `REFRESCO_MS =
  15_000` en la línea 8) que **vive dentro de un hook de una pantalla montada**.

`apps/mobile/src/gps/headless-task.ts` **nunca importa** el cliente de
sincronización (confirmado: sus imports son Sentry, SQLite, BackgroundGeolocation,
geofence, outbox local y sesión-movil-store — ninguno de `sync-outbox.ts` ni de
`use-sync-status.ts`). Así que con la app en background y sin cambios de
conectividad, nadie drena el outbox: los puntos se acumulan hasta que el usuario
vuelve a abrir la pantalla de operación (que remonta el hook y su `setInterval`), y
ahí es cuando llegan en ráfaga.

### Qué hay que hacer

Mover la sincronización fuera del ciclo de vida de la pantalla, de modo que corra
también con la app en background (p. ej. integrarla al propio headless task, o a un
mecanismo de background fetch/task nativo independiente del hook de React). Verificar
las rutas citadas arriba contra el estado del código al momento de implementar, ya
que el pipeline de sync puede haber cambiado.

### Criterio de aceptación

El p95 del lag entre `ts` y `received_at` baja a menos de 60 segundos en una jornada
real de piloto.

---

## Issue 4 — Onboarding de exención de batería en Android

**Prioridad sugerida:** Media
**Estimación sugerida:** ~3 pts

### Descripción del problema

La app no le pide al conductor ninguna exención de optimización de batería, lo que
en fabricantes agresivos (Samsung, que es el hardware del piloto) puede matar el
tracking en segundo plano sin que nadie se entere hasta revisar los datos.

### Contexto

Samsung tiene la peor calificación (5/5, la más agresiva) en
https://dontkillmyapp.com/samsung, con mecanismos como "Sleeping apps", "Deep
sleeping apps" y Adaptive Battery. Además, Samsung **reañade apps a esas listas
después de actualizaciones de firmware**, así que configurar la exención una sola vez
no alcanza: hay que poder re-verificar periódicamente.

### Estado actual (verificado en el repo)

- `apps/mobile/app.config.ts` no declara el permiso
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (confirmado: no aparece en la lista de
  `permissions` del archivo, líneas 42-56, que sí incluye `ACCESS_FINE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` y
  `POST_NOTIFICATIONS`).
- El SDK de Transistorsoft ya expone `DeviceSettings.showIgnoreBatteryOptimizations()`
  y `DeviceSettings.showPowerManager()`, pero no hay ningún punto de la app que los
  invoque.
- No hay pantalla de onboarding que explique al conductor los pasos manuales
  necesarios en fabricantes agresivos.

### Qué hay que hacer

1. Declarar el permiso `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` en
   `apps/mobile/app.config.ts`.
2. Agregar una pantalla de onboarding (o un paso dentro del flujo existente de
   permisos) que dispare `DeviceSettings.showIgnoreBatteryOptimizations()` y
   `DeviceSettings.showPowerManager()`, y un re-chequeo periódico (p. ej. al abrir la
   app, o con un recordatorio cada cierto número de jornadas).
3. Documentar para el conductor, en la propia pantalla o en material aparte:
   - Sacar la app de "Apps en suspensión" y "Apps en suspensión profunda".
   - Poner la app en "Sin restricciones" de batería.
   - Ubicación en "Permitir todo el tiempo".
   - Re-verificar estos tres puntos después de cada actualización de firmware del
     teléfono.
   - Nota operativa: con el teléfono enchufado al cargador del vehículo, Doze ni
     siquiera entra en juego — recomendarlo como mitigación adicional.
4. Verificar que el manifest de Android generado para builds de Android 14+ declare
   `foregroundServiceType="location"` en el servicio del foreground service. **Nota
   de verificación:** el proyecto es Expo y no tiene un `AndroidManifest.xml` estático
   en el repo (se genera en el prebuild); hoy solo está confirmado que
   `apps/mobile/app.config.ts:47` declara el permiso `FOREGROUND_SERVICE_LOCATION`.
   Falta confirmar en un build/prebuild real que el plugin de
   `react-native-background-geolocation` efectivamente emite el atributo
   `foregroundServiceType="location"` en el manifest generado.

### Criterio de aceptación

- Un dispositivo Samsung recién instalado, al completar el onboarding, queda con la
  app fuera de las listas de suspensión y con la exención de batería activa
  (verificable a mano en Ajustes → Batería → esa app).
- El manifest generado del build de Android confirma
  `foregroundServiceType="location"` en el servicio correspondiente.

---

## Cómo se diagnosticó

Las mediciones de los issues 1-3 salen de cruzar datos de producción. Para reproducir
la medición en la próxima jornada:

**Trampa de RLS:** las tablas tienen Row-Level Security. Sin abrir la sesión con el
rol admin, cualquier `SELECT` devuelve 0 filas **sin error** (no hay excepción que
avise del problema). Antes de correr cualquiera de las consultas de abajo:

```sql
SET app.rol = 'admin_quivo';
```

**Lag entre captura y llegada al servidor** (Issue 3):

```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (received_at - ts))) AS mediana_seg,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (received_at - ts))) AS p95_seg,
  MAX(EXTRACT(EPOCH FROM (received_at - ts))) AS max_seg
FROM gps_points
WHERE sesion_id = '<sesion_id>';
```

**Ráfagas de llegada** (Issue 3, evidencia de las 77 llegadas en un mismo minuto):

```sql
SELECT date_trunc('minute', received_at) AS minuto, COUNT(*) AS puntos
FROM gps_points
WHERE sesion_id = '<sesion_id>'
GROUP BY 1
ORDER BY puntos DESC
LIMIT 10;
```

**Distancia entre puntos consecutivos** (Issue 2, mediana de 81-103 m en movimiento).
`gps_points` no tiene columna `geom`: construir el punto al vuelo desde `lat`/`lng`
(la base corre sobre PostGIS, confirmado en el comentario de la migración que crea la
tabla):

```sql
SELECT
  ts,
  ST_Distance(
    ST_MakePoint(lng, lat)::geography,
    LAG(ST_MakePoint(lng, lat)) OVER (PARTITION BY sesion_id ORDER BY ts)::geography
  ) AS distancia_m
FROM gps_points
WHERE sesion_id = '<sesion_id>'
ORDER BY ts;
```

**Huecos temporales por sesión** (Issue 2, los huecos de 56/22/17/11 minutos):

```sql
SELECT
  ts,
  ts - LAG(ts) OVER (PARTITION BY sesion_id ORDER BY ts) AS hueco
FROM gps_points
WHERE sesion_id = '<sesion_id>'
ORDER BY hueco DESC
LIMIT 20;
```

**Cruce de `eventos_operativos` contra `sesiones_operativas`** (Issue 1, la sesión con
`fin_recorrido` que sigue activa). Ojo con el casing: a diferencia de `gps_points`
(tabla creada a mano en SQL crudo, columnas `snake_case`), estas dos tablas las
maneja Prisma sin `@map` por campo, así que sus columnas quedaron en `camelCase` y
hay que citarlas entre comillas dobles:

```sql
SELECT
  s.id AS sesion_id,
  s.estado,
  s.fin,
  e.tipo,
  e.ts AS evento_ts
FROM sesiones_operativas s
JOIN eventos_operativos e ON e."sesionId" = s.id
WHERE e.tipo = 'fin_recorrido'
  AND s.estado = 'activa'
  AND s.fin IS NULL;
```

Ajustar nombres de tabla/columna exactos contra el esquema real si cambiaron desde
esta redacción (2026-08-19) — la fuente de verdad es
`packages/db/prisma/schema.prisma`.
