# Plan de corrección post-piloto — 2026-09-09

## Contexto

El 2026-09-09 salieron 5 conductores en 2 líneas (Zona 12 y Línea 120), todos desde Univalle
Tiquipaya, en distintos horarios y autos. 2 usaron el APK anterior, 3 el nuevo (commit `04b14ed`,
`distanceFilter` 15 m constante).

El piloto **funcionó como fuente de evidencia** y falló como demo. El panel en vivo mostró 2 iconos
por un momento y ninguno más, aunque los 5 figuraban "reportando". El combo del mapa listó ~20
entradas con vehículos repetidos y sufijos de dispositivos que no genera la app. Los avisos de punto
de control cantaron "alcanzado" a más de una cuadra de distancia, con 8 decimales, y a una conductora
no le sonó nunca. La app no acumula los puntos ya cumplidos. Una conductora del APK viejo tenía que
cerrar y reabrir la app para que se moviera su posición.

Este plan corrige todo eso. Está cortado en **entregas atómicas**: cada una es un PR mergeable que
deja el sistema consistente y desplegable por sí solo, con ámbito acotado (móvil / API / web / datos)
para que un bug se atribuya rápido a un despliegue concreto.

**Principio rector (decidido por el CTO en esta sesión):**

> La app nunca miente sobre si está **registrando**; solo calla sobre si ya **envió**.

| Categoría | Ejemplo | El chofer ve |
|---|---|---|
| Fallas de **captura** | GPS apagado, permiso revocado, batería matando el servicio, disco lleno, sesión muerta | **Sí** — aviso claro, en su idioma, con botón al ajuste |
| Fallas de **transporte** | Sin cobertura, 5xx, timeout, cola, 429, backlog | **No** — "Registrando", y nada más |

Consecuencia dura: **detección de puntos de control, anuncios y navegación en ruta no pueden tocar la
red.** El paquete del día debe estar cacheado completo para una jornada entera offline.

---

## Diagnóstico verificado

### Los 134 m de Anghel no eran un bug

Producción tiene Z12 **y** Línea 120 a **150 m**, no 100:

| Fuente | Radio | Qué es |
|---|---|---|
| `scripts/data/z12-circuito/puntos-control.json` | **150** (×26 puntos) | Lo que corrió en producción |
| `scripts/cargar-linea-120.ts:269` | **150** | Lo que corrió en producción |
| `packages/db/prisma/seed.ts:315+` | 100 | Solo seed de desarrollo local |

El comentario `apps/mobile/src/gps/geofence.ts:113` que dice "Z12 = 100 m" cita `seed.ts`, o sea el
lado equivocado. Con radio 150 y muestreo cada 15 m, el primer fix dentro del círculo cae entre 104 y
150 m según la distancia perpendicular de paso. **Los 104 m y los 134 m son geometría determinista, no
un defecto.**

El defecto real es de producto: **anuncio == detección**. El chofer oye "alcanzado" en el borde del
círculo.

### Por qué 10 m es estructuralmente imposible

`RUTA_PROXIMIDAD_TOLERANCIA_METROS = 100` (`apps/api/src/common/geo/proximidad-ruta.ts:9`) permite
crear puntos de control hasta **100 m fuera** de la línea de la ruta. Si un punto está plantado a 70 m
de su propia ruta, **todo radio ≤70 m lo pierde siempre, en toda pasada, para siempre**, sin importar
la calidad del GPS. El error dominante no es la precisión del teléfono (~10 m σ) sino esa distancia
de plantado. La Entrega 15 la mide punto por punto.

Y la pérdida es irreversible: el worker no hace backfill (`docs/handoff.md:1481`) y `sync_errors` no
tiene reproceso (`docs/handoff.md:2886`). **Errar por ancho es reversible; errar por angosto no.**

### Causas raíz de los síntomas

| # | Síntoma reportado | Causa raíz verificada |
|---|---|---|
| 1 | Solo 2 iconos, y por un momento | `en-vivo/page.tsx:294-302`: `<select>` de selección única, **una sesión dibujada a la vez** |
| 2 | ~20 entradas, `9004TST` con 3 conductores | Colisión humana de credenciales + `auth-movil.service.ts:954-962` (cada login cierra la sesión previa de esa placa) |
| 3 | Sufijos `verif-fi` / `test-ver` | No los genera la app. `sesion-movil-store.ts:57-64` siempre emite `android:${uuid}`. Son sesiones de scripts contra producción |
| 4 | "100 metros antes", "134 metros antes" | Radio 150 m configurado. Geometría, no bug |
| 5 | Voz con 8 decimales | `gps-provider.tsx:51` interpola `distanciaM` crudo. `format-distancia.ts` ya existe y **no se usa** |
| 6 | "Sin sonido" (Rosa) | `gps-provider.tsx` es componente React. **App en background = árbol desmontado = sin voz, sin sonido, sin toast** |
| 7 | No lista los puntos ya cumplidos | `operation-screen.tsx:67` mantiene `completados` en `useState`, se resetea con `gps.tracking` (`:103-105`) y no se siembra del outbox |
| 8 | "Tengo que cerrar la app para que se actualice" | `headless-task.ts` **no importa** `sync-outbox.ts`. El único drenado es un `setInterval` dentro de un hook de pantalla (`use-sync-status.ts:177-208`) |
| 9 | Sentido de ruta invertido | Dato cargado mal en la rotación. `Ruta.sentido` es texto libre (`schema.prisma:338`), sin detección automática |
| 10 | Polyline naranja sobre las casas, 2 s | Probable: la polyline se dibuja antes de que carguen los tiles del CDN (`route-map-view.tsx:150`), o cruce `[lat,lng]` de Leaflet con `[lng,lat]` de GeoJSON. Entrega 25 |
| 11 | "Se sale cada rato" | `control-feedback-toast.tsx:37-40` no deduplica por `{puntoControlId, pasada}`; voz y sonido **sí** lo hacen |
| 12 | Errores en `/sync-errores` | Sin reproceso: "lo que cae ahí es pérdida definitiva" |
| 13 | 3 de 5 no operaron su credencial | Publicar 6 credenciales en un grupo de WhatsApp. `9001TST`+PIN de Gonzalo, typo `705953`, Nico terminó en `9006TST` |

**El round-robin de rotaciones no puede funcionar.** `Conductor` (`schema.prisma:235-256`) **no tiene
`lineaId` ni relación con `Linea`**. `rotaciones.service.ts:43-101` trae todos los conductores del
sindicato ordenados por nombre y los reparte cíclicamente contra las rutas. El sistema **no sabe** que
Betty es de la 120. Es imposible por modelo de datos, no por lógica.

---

## Camino crítico para el video

El CTO graba esta noche o mañana temprano. Mínimo para que se vea profesional:

**Operativo, sin código (~1 h):** Entregas 0a, 0b, 0c
**Un solo APK:** Entregas 1, 2, 5, 6, 7, 8, 25, 26
**Un solo deploy API:** Entregas 10, 12
**Un solo deploy web:** Entregas 13, 14

Si el tiempo aprieta y hay que cortar: **0a/0b/0c + 5 + 7 + 8 + 25** (APK) y **10 + 13 + 14**
(web/API). La Entrega 2 (drenado en background) es la que hace que el marcador se mueva con la
pantalla apagada — sin ella el video muestra vehículos congelados. La Entrega 25 (mapa offline) es
la que evita que la pantalla del chofer quede gris si el trayecto pasa por una zona sin cobertura —
riesgo real de arruinar la toma.

**Si hay que grabar esta noche, mínimo absoluto:** 0a/0b/0c + 5 + 13 + 14. Es lo que evita que el
video muestre los defectos más visibles.

---

# ENTREGAS

## Bloque 0 — Operativo, sin código (P0, antes de grabar)

### Entrega 0a — Backup del estado de siembra y rescate de evidencia
**P0 · Ámbito: ops · ~15 min · Sin dependencias**

`scripts/sembrar-piloto-produccion.ts:163-171` advierte: si se pierde
`scripts/.estado-siembra-produccion.json`, la próxima corrida **duplica filas que no se pueden
borrar** (no hay endpoints DELETE). No está versionado.

- Copiar ese archivo fuera del repo, hoy.
- Rescatar la evidencia que quedó en los teléfonos antes de que se purgue: outbox purga a 7 días
  (`sync-outbox.ts:37`), el SDK persiste 14 (`background-geolocation.config.ts:109`). Por el bug de
  la Entrega 2, la traza del 09-09 en el servidor está **incompleta**.

**Verificación:** el archivo existe fuera del repo; los teléfonos drenaron (contar `gps_points` del
09-09 antes y después).
**Rollback:** N/A.

---

### Entrega 0b — Limpiar sesiones fantasma y colgadas en producción
**P0 · Ámbito: datos · ~30 min · Depende de: 0a**

```sql
UPDATE sesiones_operativas
   SET fin = now(), estado = 'cerrada_administrativamente'
 WHERE "deviceId" NOT LIKE 'android:%';
```

**NO usar DELETE** — hay `gps_points` y `cumplimientos_pc` colgando de esos `sesionId` sin FK.
Cerrarlas las saca del `WHERE (so.fin IS NULL AND so.estado='activa')` de
`en-vivo.service.ts:201-202`, que es todo lo que hace falta.

Cerrar también las sesiones abiertas de días previos sin fix reciente.

Antes de correr, censar formatos existentes (insumo de la Entrega 12):
```sql
SELECT DISTINCT split_part("deviceId", ':', 1), count(*) FROM sesiones_operativas GROUP BY 1;
```

**Verificación:** `/en-vivo` muestra solo sesiones reales; el combo baja de ~20 a ≤6.
**Rollback:** las filas conservan sus datos; revertir `estado`/`fin` es un UPDATE inverso.

---

### Entrega 0c — Rotación del video a mano y credenciales en papel
**P0 · Ámbito: ops · ~30 min · Depende de: 0b**

- **No usar `POST /v1/rotaciones`** — es `generar()` con round-robin destructivo que no puede
  emparejar línea con conductor (ver Entrega 17). Crear las asignaciones con `POST /v1/asignaciones`
  (`{vehiculoId, conductorId, rutaId, fecha, horario}`). `@@unique([vehiculoId, fecha, horario])`
  sigue protegiendo contra doble asignación.
- **Verificar `sentido` explícitamente** en cada ruta asignada — es la causa del síntoma 9.
- **Un papel por chofer**, sin grupo de WhatsApp: `PLACA / PIN / LÍNEA / TU NOMBRE`.
- Antes de arrancar: entrar a `/vehiculos` y confirmar que la sesión activa de cada placa tiene el
  conductor correcto.

**Verificación:** query de asignaciones del día; cada placa con su conductor y sentido correctos.
**Rollback:** borrar las asignaciones creadas.

---

## Bloque 1 — Móvil, integridad de la evidencia (P0, un APK)

### Entrega 1 — `revertirAPendiente` con guarda de estado
**P0 · Ámbito: móvil · ~30 min · Sin dependencias · Bug en producción**

`apps/mobile/src/db/outbox.ts:408-413` llama a `actualizarEstado(db, eventIds, 'pendiente')`, que hace
`UPDATE outbox SET estado = ? WHERE event_id IN (...)` (`:475-488`) **sin filtrar por estado actual**.

Camino de fallo: `sincronizarPendientes` (`sync-outbox.ts:103-131`) marca el lote `enviado`, envía, y
en el `catch` revierte **el lote entero**. Si el POST llegó y se procesó (202) pero la respuesta se
perdió (timeout de 20 s, `sync-api.ts:7`), el servidor los tiene y el cliente los reenvía para siempre.

**Fix:** función dedicada con predicado de transición:
```sql
UPDATE outbox SET estado = 'pendiente' WHERE event_id IN (...) AND estado = 'enviado'
```
`acusado` es terminal. Extraer el SQL a función pura para testear sin módulo nativo — hay precedente
exacto en `construirPurgaAcusados` (`outbox.ts:426`).

**Verificación:** test en `outbox.test.ts` — sembrar 3, acusar 1, revertir los 3, assert que el
acusado sigue `acusado`.
**Rollback:** revert directo, sin migración.

---

### Entrega 2 — Drenado del outbox en background
**P0 · Ámbito: móvil · ~4 h · Depende de: 1 · Causa raíz del síntoma 8**

`apps/mobile/src/gps/headless-task.ts` importa `outbox`, `paquete-dia`, `sesion-movil-store`,
`location-task` y `geofence` — **no importa `sync-outbox.ts`**. Con la app en background la tarea
headless escribe al outbox y nadie lo vacía.

Respetar el diseño ya escrito en `docs/handoff.md:109-131` (no rediseñar):

- Nuevo `apps/mobile/src/features/operacion/drenaje-oportunista.ts`:
  `intentarDrenarOportunista(obtenerAccessToken)` con mutex + lease, piso de 10 s entre intentos,
  backoff con `Date.now()` (**no `setTimeout`** — en headless el timer JS muere con el contexto).
- Llamarla desde **ambos** caminos, colgada del evento de ubicación:
  - `headless-task.ts`, al final de `tareaHeadlessUbicacion`, **con `await`** (el SDK termina la tarea
    al ejecutar la última línea).
  - `use-gps-operativo.ts:181`, tras el `registrarPuntoGps` del `onLocation` de foreground.
- **El mutex debe cruzar contextos JS.** Headless y foreground pueden ser contextos distintos en
  Android; un `let` de módulo no los cubre. Usar una fila de lease en la propia SQLite del outbox
  (`sync_lease(id, owner, expira_at)`) — ya hay conexión abierta y `conReintentoSiHandleMuerto` maneja
  el handle zombi de `expo-sqlite@16.0.10` documentado en `outbox.ts:52+`.
- **Token en headless:** leerlo de `sesion-movil-store.ts` (ya importado en `headless-task.ts:15`). Si
  está vencido hace falta refrescar — por eso esta entrega y la 3 se resuelven juntas o la 3 va
  inmediatamente después.
- Agregar el handler `onHeartbeat` que `background-geolocation.config.ts:140-153` deja declarado sin
  suscribir (`heartbeatInterval: 60`). Da un segundo punto de enganche: drenado garantizado cada 60 s
  aunque el vehículo esté quieto y no haya evento `location`. Es el mismo call site — hacerlo acá.

**Descartado explícitamente:** `BackgroundGeolocation.sync()` nativo (`http.autoSync` está en `false`,
`:112-113`). Saltearía el outbox y perdería la idempotencia por `eventId` y los eventos de cumplimiento.

**Verificación:** iniciar recorrido, **apagar la pantalla**, dar una vuelta de 20 min, mirar `/en-vivo`
sin tocar el teléfono. Éxito = el marcador se mueve. Vara formal: p95 de acuse ≤5 min
(`docs/piloto/checklist-aceptacion-e2e.md:169-200`); proyección documentada p50 ~6 s.
**Rollback:** revert. Riesgo: un drenado demasiado agresivo puede pegarle al throttle de 60/min por
dispositivo — el piso de 10 s lo cubre.

---

### Entrega 3 — Circuit breaker del refresh 401
**P0 · Ámbito: móvil · ~2 h · Depende de: 2**

`docs/handoff.md:734-736, 3369-3380` lo marca como "el defecto más serio abierto": 42 min, 29
intentos, 0 éxitos, sin avisar. Parcialmente cerrado en PR #53.

Bajo el principio rector:
- **El chofer no ve nada.** Sigue detectando, anunciando y acumulando en el outbox.
- Circuit breaker en `apps/mobile/src/shared/api/http-client.ts`: N fallos consecutivos → abrir,
  dejar de reintentar, backoff a minutos. No hay razón para 29 intentos.
- El chofer solo ve algo si el circuito lleva abierto >X minutos **y** la sesión ya no es recuperable
  — y ahí un banner discreto "Reconectando", nunca "error": la evidencia sigue a salvo localmente.
- El evento ruidoso va a **Sentry**, no a la pantalla.

Relacionado: `logout` responde 204 sin cerrar la sesión del servidor si el refresh ya era inválido
(`docs/handoff.md:3382-3385`) — deja sesiones colgadas, que es lo que ensucia el combo. Cerrarlo acá.

**Verificación:** simular 401 permanente; assert que los intentos se detienen y que el outbox sigue
creciendo sin UI degradada.
**Rollback:** revert.

---

### Entrega 4 — Purgar estados degradados de la UI del chofer
**P0 · Ámbito: móvil · ~2 h · Depende de: 3**

- `use-gps-operativo.ts:212` — el string *"La evidencia de esos puntos se perdió"* **no puede**
  aparecerle a un chofer. Va a Sentry (ya va), sale del `setErrorGps`.
- `offline-banner.tsx` — bajo el principio rector, "sin conexión" es el estado **normal**, no
  degradado. Si sobrevive, que sea un ícono pasivo.
- `use-sync-status.ts` — sacar de pantalla cualquier "N pendientes / error de sincronización". Los
  pendientes son la evidencia haciendo su trabajo.

**Regla para el equipo, a escribir en `CLAUDE.md` o `docs/`:** *la pantalla del chofer no tiene ningún
widget cuyo valor dependa de la red.*

**Verificación:** modo avión durante un recorrido completo — la pantalla no debe cambiar en nada.
**Rollback:** revert.

---

## Bloque 2 — Móvil, puntos de control (P0, mismo APK)

### Entrega 5 — Redondear la distancia de la voz
**P0 · Ámbito: móvil · ~5 min · Sin dependencias**

`gps-provider.tsx:51` interpola `distanciaM` crudo de `haversineMetros` (`geofence.ts:49`).
`apps/mobile/src/features/operacion/format-distancia.ts` **ya tiene** `formatearDistancia()` con
`Math.round` y no se usa acá. Usarla, y redondear a múltiplos de 10 para la voz ("a 130 metros" suena
a instrucción; "a 134 metros" suena a bug).

**Verificación:** escuchar el anuncio.
**Rollback:** revert.

---

### Entrega 6 — Separar anuncio de detección
**P0 · Ámbito: móvil · ~3 h · Depende de: 5 · El corazón del arreglo**

Tres conceptos que hoy son uno:

| Concepto | Radio | Qué hace |
|---|---|---|
| **Detección (evidencia)** | `pc.radioToleranciaM` (150) | Marca el paso, encola el evento, arma la histéresis. **No cambia** |
| **Aviso de aproximación** | `RADIO_AVISO_M` ≈150 | Voz: *"Punto de control 16 a 150 metros"* — informativa |
| **Confirmación de paso** | `RADIO_CONFIRMACION_M` ≈40, o mínimo local | Sonido + toast + tacha en la lista: *"Punto 16 registrado"* |

- `geofence.ts` — `detectarPuntosControlCercanos` (`:38-61`) ya devuelve `distanciaM` para **todos**
  los puntos, no solo los cumplidos. Alcanza para el aviso sin tocar la máquina de estados. Agregar
  `fase: 'aproximacion' | 'confirmado'` a `DeteccionPuntoControl`.
- `location-task.ts:119-217` — la emisión del evento **no cambia** (radio ancho, histéresis con
  `FACTOR_REARME_RADIO=1.5`, `FIXES_REARME_CONSECUTIVOS=2`, `PASADA_MIN_MS=2min`). Cambia el payload:
  agregar `distanciaMinAproximacionM`.
- `gps-provider.tsx:42-79` — dos efectos separados: aproximación → voz; confirmación → sonido + toast.

**Distancia mínima de aproximación.** Hoy se registra la distancia de *entrada* (la peor). Emitir en
el **mínimo local** (cuando la distancia empieza a crecer): el payload lleva `distanciaEntradaM` y
`distanciaMinAproximacionM`, la evidencia mejora, y el chofer oye la confirmación *cuando pasa por el
punto*. Cuesta un fix de latencia (~15 m), imperceptible.

**Sin cambio server-side:** `procesarCumplimientoEnTx` (`ingesta-worker.service.ts:347-430`) revalida
con `ST_DWithin` contra `radioToleranciaM`; el mínimo siempre está dentro del radio.

**Cuidado:** `PASADA_MIN_MS` opera sobre `tsFix` — revisar `geofence.test.ts`.
**Verificación:** recorrido real; el aviso llega antes, la confirmación encima del punto. Vara formal:
"0 detecciones sin paso anotado" no debe romperse.
**Rollback:** revert. Riesgo medio: toca la máquina de estados del geofence.

---

### Entrega 7 — Anuncio desde headless (arregla "sin sonido")
**P0 · Ámbito: móvil · ~3 h · Depende de: 6 · Probablemente el arreglo más importante**

`gps-provider.tsx` es un componente React. **Si el árbol no está montado no hay voz, ni sonido, ni
toast.** Un chofer manejando no tiene la app en primer plano — o sea, el anuncio hoy funciona solo en
la condición que no ocurre. Encaja exacto con el reporte de Rosa: "marcó el punto... sin sonido".

- Mover el disparo a una **notificación local Android** (`expo-notifications` con sonido custom) desde
  `headless-task.ts`. Dejar `Speech.speak` del provider solo para foreground.
- Disparar también `Vibration.vibrate(100)` desde headless — hoy solo sale si el toast se renderiza
  (`control-feedback-toast.tsx:55`). Es el canal más robusto: no depende de audio.
- Instrumentar: `Sentry.captureException` en los tres `catch` de `confirmacion-sonido.ts` — hoy son
  invisibles por diseño (`:61`), lo cual está bien para el chofer y mal para nosotros.

**Hipótesis secundarias a descartar de paso:**
- El `.wav` no se bundleó en release (`confirmacion-sonido.ts:3`). Verificar:
  `unzip -l app-release.apk | grep -i chime`.
- Volumen del stream de media en 0 — `interruptionMode: 'duckOthers'` no ayuda si está mudo.

**Verificación:** pantalla apagada, pasar por un punto de control, confirmar sonido + vibración +
notificación.
**Rollback:** revert.

---

### Entrega 8 — Lista acumulada de puntos cumplidos
**P0 · Ámbito: móvil · ~3 h · Depende de: 7 · Síntoma 7**

`operation-screen.tsx:67` mantiene `completados` en `useState`, poblado solo desde
`gps.ultimaDeteccion` (`:89-102`), usado solo para calcular el *próximo* punto (`:106-109`). No hay UI
que liste los cumplidos — el único feedback es un toast de 2500 ms. Peor: se **resetea** cuando
`gps.tracking` cambia (`:103-105`) y **no se siembra del outbox**. Si el chofer mata y reabre la app a
mitad de turno, la app "olvida" todo.

**Local-first puro — la lista no consulta la red jamás:**
- Leer los `cumplimiento_punto_control` de la sesión activa desde el outbox
  (`obtenerEventosPorTipo` ya existe y ya se importa en `headless-task.ts:13`), **sin importar su
  estado de sync**: `pendiente`, `enviado` y `acusado` cuentan igual — para el chofer todos son
  "cumplido".
- Sembrar `completados` al montar con el patrón `semillaPromise` de `use-gps-operativo.ts:176-180`. No
  resetear en el cambio de `gps.tracking`.
- **UI nueva:** panel scrollable con los 26 puntos por `orden`, cada uno `pendiente` / `cumplido HH:MM`
  / `pasada N`. Expandir `next-control-sheet.tsx` de "próximo punto" a "próximo + lista".
- Contador grande: **"12 / 26 puntos"**.

**Cuidado:** `completadosTrasDeteccion` (`proximo-punto-control.ts:31-38`) resetea el Set al completar
la vuelta. Correcto para "cuál es el próximo", **incorrecto** para "qué cumplí hoy". Hacen falta dos
estructuras: Set de vuelta actual (existente) e historial de jornada (nuevo, desde el outbox).

**Verificación:** cumplir 3 puntos, matar la app, reabrir — los 3 siguen tachados. Modo avión todo el
tiempo.
**Rollback:** revert.

---

### Entrega 9 — Deduplicar el toast de confirmación
**P1 · Ámbito: móvil · ~20 min · Depende de: 8 · Síntoma 11**

`control-feedback-toast.tsx:37-40` pushea a la cola cada vez que cambia la referencia de
`ultimaDeteccion`, sin deduplicar por `{puntoControlId, pasada}` — a diferencia de la voz y el sonido,
que **sí** deduplican (`gps-provider.tsx:44-46, :70-72`). Aplicar el mismo ref `ultimoMostrado`.

**Verificación:** una sola aparición por paso.
**Rollback:** revert.

---

## Bloque 3 — API (P0, un deploy)

### Entrega 10 — Endpoint de últimas posiciones de todos los vehículos
**P0 · Ámbito: API · ~4 h · Sin dependencias · Habilita las Entregas 13 y 14**

**N trazas simultáneas está descartado por costo:** `obtenerTraza` (`en-vivo.service.ts:293-380`) es
por sesión, con `limite` default 8000. Con 5 sesiones y poll de 10 s son 30 req/min; con el poll
rápido de 1 s cuando `hayMas`, **300 req/min con 5 vehículos** — el techo exacto del throttle de
`en-vivo.controller.ts:31`. Con 20 vehículos revienta.

`GET /reportes/en-vivo/posiciones` (plural, sin `sesionId`). Es una extensión pequeña de `listarHoy`
(`en-vivo.service.ts:171-223`), que **ya tiene** el `LEFT JOIN LATERAL` a `gps_points` y **ya joinea**
`rutas r` y `lineas l`:

1. En el `LATERAL`, traer `lat`, `lng`, `accuracy`, `speed` del último fix además de los `max()`
   actuales. Columnas confirmadas en `ingesta-worker.service.ts:338-341`.
2. Agregar `l.id AS "lineaId"` — habilita el filtro por línea sin round-trip extra. Sale gratis, el
   join ya está.
3. Agregar `r.sentido` — hace visible el bug del síntoma 9 de un vistazo.

**Una query sin importar cuántos vehículos haya.** Las cotas de partición de `listarHoy`
(`trazaDesde`/`trazaHasta`, jornada boliviana) se conservan, así que el planner sigue podando.

**Poll, no SSE.** Con lag de ingesta mediana 153-166 s y p95 684-814 s
(`packages/shared/src/entities/en-vivo.ts:20-30`), un canal push que entrega en 200 ms un dato de 2.5
minutos de antigüedad no agrega información. El cuello es la ingesta, no el transporte. SSE es la
optimización correcta **después** de la Entrega 2. Cadencia: 5 s (12 req/min, un vigésimo del
throttle, independiente de N).

**Verificación:** `curl` con 6 sesiones activas; assert una sola query en el log; comparar contra
`/en-vivo` actual.
**Rollback:** endpoint nuevo, no toca los existentes — revert sin impacto.

---

### Entrega 11 — Guard de `deviceId` en producción
**P0 · Ámbito: API · ~2 h · Depende de: 0b**

`packages/shared/src/auth/mobile.ts:11-16` (`DeviceIdMovilSchema`: `min(8).max(128)`,
`/^[A-Za-z0-9._:-]+$/`) acepta cualquier cosa. Schema estricto:
```
/^(android|ios):[0-9a-f-]{36}$/
```

- **Verificar compatibilidad antes de desplegar** con el censo de la Entrega 0b. Si hubo APKs con otro
  formato, este guard bloquea a esos choferes.
- Condicionado al entorno: en `production` rechaza (400); en `development`/`staging` solo loguea.
- Punto de aplicación: **el login móvil** (`auth-movil.service.ts`), no el sync — un `deviceId` malo
  debe morir en el login, no dejar eventos huérfanos.

**Verificación:** test de contrato con `verif-fi` → 400 en prod, warning en dev. Login real desde el
APK actual → 200.
**Rollback:** revert. **Riesgo alto si el censo se saltea** — podría dejar choferes afuera.

---

### Entrega 12 — Commitear el throttler por dispositivo
**P0 · Ámbito: API · ~30 min · Sin dependencias**

`apps/api/src/modules/sync/sync-device-throttler.guard.ts` está **sin commitear** (`??` en git
status), junto con `sync.controller.ts` y `sync.module.ts` modificados. Resuelve un problema real
(CGNAT boliviano: choferes del mismo operador saturándose entre sí) y hoy vive solo en el working
tree. **Un `git stash` accidental lo borra.**

Su caveat propio (`:43-47`: storage en memoria por instancia → con N réplicas de Cloud Run el techo
real es N×60/min) es aceptable — documentarlo como deuda.

**Verificación:** el test que ya existe (`sync-device-throttler.guard.test.ts`, también sin commitear).
**Rollback:** revert.

---

## Bloque 4 — Web (P0, un deploy)

### Entrega 13 — Mapa: todos los vehículos + filtro por línea
**P0 · Ámbito: web · ~5 h · Depende de: 10 · Síntomas 1, 2, 3**

Cambio de paradigma pedido por el CTO.

- `en-vivo/page.tsx:54-627`: `sesionId` deja de gobernar el mapa. Pasa a `sesionSeleccionada` = "cuál
  abrió su detalle", nullable por default.
- El `<select>` de `:294-302` se reemplaza por el `<Select>` de línea. **El combo de 20 entradas
  desaparece**, y con él los síntomas 2 y 3 y el `slice(0,8)` que siempre devuelve `"android:"`
  (`map-builders.ts:11-18`).
- Se dibujan **todos** los vehículos del filtro. Click en marcador → detalle → recién ahí se piden
  `contexto` y `traza` de esa sesión (los hooks de `use-en-vivo.ts:29-153` sirven tal cual). Como solo
  hay un detalle abierto a la vez, el problema de escalado del poll se arregla solo.
- **Reusar** el patrón de filtro de `vehiculos/page.tsx:249-260` (`<Select aria-label="Filtrar por
  línea">` + `useLineaOptions()` de `:46` + filtrado client-side `:77, :104`). El endpoint trae todo;
  el select filtra en memoria.

**Verificación:** MCP `playwright` con 6 sesiones activas — los 6 marcadores visibles, el filtro
alterna Todas/120/Z12, click abre traza. Screenshot con `puppeteer` para el CTO.
**Rollback:** revert. Riesgo medio: reescribe la página principal del demo.

---

### Entrega 14 — Iconografía: vehículo distinto de punto de control
**P0 · Ámbito: web/design-system · ~2 h · Depende de: 13**

`packages/design-system/src/ui/route-map-impl.tsx:749-761`: **una sola capa** `quivo-marker-points`
sirve a todos los `pinType`, distinguiéndolos solo por
`circle-radius: match(pinType,'node',11,'pulse',11,'stop',7,8)` y `circle-color`. Vehículo (radio 11)
y punto de control (radio 7) son **el mismo círculo con 4 px de diferencia**. Con 26 puntos de control
Z12 y 5 vehículos, son indistinguibles.

- **Restringir** `quivo-marker-points` con `filter: ['!=', ['get','pinType'], 'pulse']`.
- **Nueva capa** `quivo-vehicle-symbols`, `type: 'symbol'`, misma fuente `quivo-markers`,
  `filter: ['==', ['get','pinType'], 'pulse']`:
  - `icon-image: ['concat','quivo-bus-',['get','estadoFrescura']]` — tres sprites. **La forma cambia,
    no solo el color:** silueta sólida / contorno punteado / gris con interrogación.
  - `icon-allow-overlap: true`, `icon-ignore-placement: true` — con 20 vehículos no querés que
    MapLibre esconda unos por colisión. Los puntos de control **sí** deben poder colisionar.
  - `text-field: ['get','placa']`, `text-offset: [0,1.4]`, `text-halo-width: 2`. La placa al lado del
    ícono es lo que hace que el video se entienda sin narración.
- `quivo-marker-pulse` (`:740-748`): condicionar a
  `['all',['==',['get','pinType'],'pulse'],['==',['get','estadoFrescura'],'reportando']]`.
  **Un vehículo perdido no debe pulsar.**
- **Cambio no obvio, presupuestarlo:** `ID_MARCADOR_VEHICULO` (`map-builders.ts:116`) es un id estable
  único. Con N vehículos pasa a `vehiculo:${sesionId}`, y `vehicle-marker-animation.ts` debe animar por
  id, no asumir uno solo.
- Actualizar los comentarios de `map-builders.ts:84-88, :124-129` que hablan de `buildDivIcon`/Leaflet
  — el motor ya es MapLibre GL.

**Fallback si los sprites agregan fricción:** mantener `circle` con `circle-radius: 14` +
`circle-stroke-width: 4` blanco, más una capa `symbol` solo con la placa. Visualmente suficiente, una
hora.

**Verificación:** screenshot con `puppeteer`; un tercero debe distinguir vehículo de punto de control
sin que se lo expliquen.
**Rollback:** revert.

---

### Entrega 15 — Umbrales de frescura: una sola fuente
**P1 · Ámbito: web/shared · ~1 h · Sin dependencias**

Tres juegos en conflicto:

| Fuente | Umbrales | Estado |
|---|---|---|
| Spec original | verde <90 s / ámbar / rojo >5 min | **DESCARTADO** (`handoff.md:814-821`, con medición) |
| `en-vivo.service.ts:79-80` | 15 min / 15 min → 4 estados semánticos | **VIGENTE**, es el que corre |
| `docs/categorizacion-colores-y-estados.md:33,50,68` | 15 s / 60 s / 180 s | **HUÉRFANO**, contradice a ambos |

- Mover `UMBRAL_INGESTA_VIVA_MS` y `UMBRAL_FIX_EN_MOVIMIENTO_MS` a
  `packages/shared/src/entities/en-vivo.ts`, junto a `EstadoFrescuraSchema`. Un número, importable
  desde web, API y docs.
- Marcar el doc huérfano con `> DESCARTADO 2026-09-09` + link. **No borrarlo** — borrarlo hace que el
  conflicto reaparezca cuando alguien lo reescriba de memoria.

**Verificación:** `tsc` + grep de que no queden literales duplicados.
**Rollback:** revert.

---

### Entrega 16 — Representación honesta de frescura
**P1 · Ámbito: web · ~3 h · Depende de: 13, 15**

La incertidumbre se comunica con **texto y forma**, no solo con color. Tres cosas que hoy se colapsan
en un badge:

| Concepto | Dato (ya existe) | Cómo mostrarlo |
|---|---|---|
| **Watermark** — "tengo datos completos hasta acá" | `ultimoIngresoTs` | **"Datos completos hasta las 17:34 (hace 3 min)"** — la afirmación más fuerte y honesta posible |
| **Posición** — "el último punto que reportó" | `ultimoFixTs` + lat/lng | **"Última posición: 17:31 (hace 6 min)"**. Nunca implicar que el ícono es "dónde está ahora" |
| **Ausencia** | `sin_datos` vs `perdido` | Ícono **distinto**, no color distinto (Entrega 14) |

- `traza.ts:255-281` (`PRESENTACION_FRESCURA`): agregar `frase` con la redacción de watermark. Las
  descripciones actuales ya son buenas — el problema es que están enterradas.
- **Regla dura:** un vehículo con último fix de >45 min **no se dibuja como posición actual**; se
  dibuja como "última posición conocida" en estilo fantasma. Dibujar un ícono sólido sobre una
  posición de hace una hora es la mentira más cara del panel.
- Eliminar `en-vivo/panel-frescura.tsx` (código muerto, sin imports) o convertirlo en el componente
  real que reemplaza al `FrescuraBadgeCompact` inline de `page.tsx:629-667`. Dos implementaciones de la
  misma lógica, una muerta, es cómo el conflicto de umbrales se volvió tripartito.

**Verificación:** `playwright` sobre una sesión vieja — debe decir la hora exacta, no solo un color.
**Rollback:** revert.

---

## Bloque 5 — Datos e integridad estructural (P1)

### Entrega 17 — `lineaId` en `Conductor` y arreglo del round-robin
**P1 · Ámbito: API + DB · ~4 h · Depende de: 0c · Causa raíz del síntoma 2**

`Conductor` (`schema.prisma:235-256`) **no tiene `lineaId` ni relación con `Linea`**.
`rotaciones.service.ts:43-101` trae todos los conductores del sindicato ordenados por nombre y los
reparte cíclicamente contra `rutaIds`. El emparejamiento correcto es **estructuralmente imposible**.

- Migración: `lineaId String?` en `Conductor` (nullable, no rompe filas existentes).
- Filtrar en `rotaciones.service.ts:45` por `lineaId ∈ líneas de rutaIds`.
- **`POST /v1/rotaciones` debe devolver un preview** (`dryRun: true`) que el admin confirma, en vez de
  escribir directo. Un humano mirando "Betty → Zona 12" lo cacha en un segundo.
- Alternativa descartada por ahora: tabla `ConductorLinea` N:M — más correcta si un chofer rota entre
  líneas, más cara. **Decisión del CTO.**

**Verificación:** test de que generar una rotación con conductores de 2 líneas no cruza; preview
manual en el panel.
**Rollback:** la columna es nullable — revert de código sin revert de migración.

---

### Entrega 18 — Replay SQL para elegir el radio con datos
**P1 · Ámbito: datos · ~3 h · Depende de: 0a · Insumo de decisión del CTO**

Prometido en `docs/handoff.md:1491-1492`, nunca hecho. `scripts/replay-radios.sql`.

**Query 1 — detectabilidad por radio** (10/20/30/50/100/150) por línea, contando cuántos puntos de
control habrían sido detectados con la traza cruda real del 09-09.

**Query 2 — la que decide el debate:** distancia de cada punto de control a **su propia ruta**
(`ST_Distance(pc.coord, r.geometria)`). Si `max` da 70 m, entonces **todo radio ≤70 m pierde ese punto
siempre, en toda pasada, para siempre**. Ese único número es la respuesta al pedido de "10 metros".

**Query 3:** distancia del primer fix dentro del radio (lo que hoy dice la voz) vs. `d_min` (lo que
diría con la Entrega 6). Muestra que el mismo radio de 150 m puede anunciar a 15 m del punto.

**Caveats a documentar en el script:** (i) el replay usa "mínima distancia alguna vez" → es **cota
superior** de detectabilidad, no modela la histéresis ni `PASADA_MIN_MS`; (ii) solo ve lo que llegó al
servidor, y por el bug de la Entrega 2 la traza del 09-09 está incompleta — **correr después del
rescate de la Entrega 0a** o los números salen sesgados a la baja.

**Verificación:** la tabla de salida es el entregable.
**Rollback:** N/A, solo lectura.

---

### Entrega 19 — Cierre automático de sesiones colgadas
**P1 · Ámbito: API · ~2 h · Depende de: 10**

`en-vivo.service.ts:201-202` incluye sesiones abiertas de días previos porque la app no cierra la
sesión al "Finalizar recorrido" — solo registra un evento (comentario `:165-170`). Combinado con
`auth-movil.service.ts:954-962`, cada placa acumula sesiones muertas hasta el próximo login.

- Job que cierre sesiones sin fix en >12 h con `estado = 'cerrada_por_inactividad'` — **distinto de
  `'finalizada'`**, para no mentir en los reportes. Ubicarlo en el worker, junto a
  `asegurarParticionesFuturas` (`ingesta-worker.service.ts:123-152`), que ya corre periódicamente.
- Cambiar el `LIMIT 100` de `listarHoy` por un filtro semántico (`so.inicio` dentro de 24 h) más
  `LIMIT 500`. Con 100 sesiones colgadas ordenadas antes, las vivas no aparecen.
- Trampa `ORDER BY NULLS LAST` pendiente (`handoff.md:3320-3324`) — cerrarla acá.

**Verificación:** sembrar una sesión colgada de hace 2 días; assert que el job la cierra y desaparece
del listado.
**Rollback:** revert; el `estado` nuevo es distinguible para revertir por SQL.

---

### Entrega 20 — Validación post-hoc del sentido de ruta
**P1 · Ámbito: API · ~3 h · Depende de: 10 · Síntoma 9**

Una vez que hay traza, el sentido es verificable: comparar contra
`ST_LineLocatePoint(r.geometria, punto)` a lo largo del tiempo. Si la fracción **decrece**
monótonamente, la ruta asignada es la contraria.

Alerta post-hoc en el panel ("esta sesión parece ir en sentido contrario a su ruta asignada"), **no un
bloqueo**. Sitio: `apps/api/src/modules/reportes/`.

Prevención complementaria: en `POST /v1/rotaciones`, si dos rutas de la misma línea tienen sentidos
distintos, alternarlas coherentemente por horario en vez de ciclarlas (`construirSubSlots`,
`rotaciones.service.ts:340-357`, hoy `rutaIds[i % rutaIds.length]`).

**Verificación:** correr contra la traza del 09-09 — debe marcar la sesión de Rosa.
**Rollback:** revert; es solo lectura.

---

### Entrega 21 — Reproceso de `sync_errors`
**P1 · Ámbito: API · ~3 h · Depende de: 12**

Hoy "lo que cae ahí es pérdida definitiva" (`handoff.md:2886`). `SyncError`
(`schema.prisma:709-727`) guarda el `payload` completo, y la ingesta es idempotente por `eventId`
(`ON CONFLICT (event_id, ts) DO NOTHING`; `createMany({skipDuplicates:true})` sobre `eventId @unique`).
**Reprocesar es seguro por construcción** — solo falta el botón.

- `POST /sync-errores/:id/reprocesar` → re-encola el `payload` en `ingesta-sync`.
- `POST /sync-errores/reprocesar-lote` con los mismos filtros de `sync-errores.service.ts:16-36`.
- Columna `reprocesadoAt DateTime?` para no reprocesar en loop.

Convierte "pérdida definitiva" en "reintentable" — cambio de categoría de riesgo, no mejora incremental.

**Verificación:** inyectar un error, reprocesar, assert que el `gps_point` aparece.
**Rollback:** revert; la columna es nullable.

---

### Entrega 22 — Salud de ingesta
**P0 parcial · Ámbito: API · ~1 h el mínimo, ~4 h el panel · Sin dependencias**

`docs/deuda-abierta.md:200-203`: "Hoy nadie se enteraría de un worker trabado hasta que el
administrador reclame". Con `sync_errors` sin reproceso, un worker trabado durante el video es pérdida
irrecuperable.

**P0 (1 h):** `GET /admin/salud-ingesta` que devuelva profundidad de la cola `ingesta-sync`,
`max(received_at)` global de `gps_points`, count de `sync_errors` de la última hora, y si existe la
partición de mañana. Los datos ya están; falta la query. **Mirarlo a ojo antes de grabar.**

**P1:** panel `/observabilidad` reusando el patrón de KPIs de `sync-errores/page.tsx:124-284`; alerta
si `now() - max(received_at) > 15 min` en horario operativo; asegurar que la excepción dura de
`asegurarParticionesFuturas` (`ingesta-worker.service.ts:142-151`) sea **alerta**, no solo log.

**Verificación:** `curl` al endpoint con el worker corriendo y detenido.
**Rollback:** endpoint nuevo, revert sin impacto.

---

### Entrega 23 — Limpieza de scripts y restos de siembra
**P2 · Ámbito: datos/docs · ~2 h · Depende de: 0a**

- Borrar `scripts/crear-credenciales-piloto.ts` (obsoleto según `docs/plan-siembra-produccion.md:207-209`).
- Actualizar `docs/plan-unicidad-placa.md:3`, que dice "sin implementar" cuando PR #56 / commit
  `878e078` ya está en main.
- Restos conocidos sin endpoint DELETE (`PILOTO001`, `L1-PILOTO`, 73 asignaciones viejas sobre
  `9001TST`/`9004TST` — `handoff.md:538-550, :174-178`): SQL directo, documentando qué se borró.
- **Divergencia dev/prod:** `seed.ts` siembra radio 100 m y producción tiene 150 m. Unificar o
  documentar explícitamente — hoy es una trampa para debugging futuro.
- **P2:** aceptar `id` propio o `Idempotency-Key` en los endpoints de creación, para que la siembra sea
  idempotente de verdad sin depender de un archivo local.

**Verificación:** correr la siembra dos veces en staging sin duplicar.
**Rollback:** N/A.

---

### Entrega 24 — Confirmación de identidad en el login móvil
**P1 · Ámbito: móvil + API · ~2 h · Depende de: 11 · Síntoma 13**

El login es `placa + PIN`, y el PIN es del **conductor** (`Conductor.credencialHash`,
`schema.prisma:245`), no del vehículo. Un typo de PIN loguea a otra persona — exactamente lo que pasó
hoy. Que la pantalla **muestre el nombre del conductor** que resolvió el PIN y pida confirmación
("¿Sos Betty?"). Costo trivial, elimina la clase entera de errores.

**Verificación:** login con PIN cruzado — debe mostrar el nombre equivocado y permitir cancelar.
**Rollback:** revert.

---

### Entrega 25 — Mapa offline en la app
**P0 · Ámbito: móvil · ~6 h · Sin dependencias · Viola el principio rector**

**Hallazgo de la auditoría offline — dependencia dura de red en la navegación:**

```
route-map-view.tsx:105   <link href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
route-map-view.tsx:147   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js">
route-map-view.tsx:150   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
```

**Sin cobertura, el mapa de navegación es una pantalla gris** — y sin el `.js` de Leaflet ni
siquiera se inicializa. Contradice directamente el requisito del CTO de que la navegación en ruta
no toque la red. También es la sospecha principal del síntoma 10 (polyline naranja 2 s: un frame
donde la LineString se dibuja antes de que carguen los tiles).

Dos pasos, mismo PR:
1. **Bundlear Leaflet** (`.css` + `.js`) como asset local. Elimina el 90% del fallo con el mínimo
   esfuerzo. Bundle +~150 KB.
2. **Tiles**, en orden de costo:
   - **(b) primero, como red de seguridad:** sin tiles, dibujar polyline de la ruta + puntos de
     control + posición sobre fondo liso. **La navegación funcional se conserva** — el chofer ve
     dónde está respecto de su ruta. **Nunca una pantalla gris.**
   - **(a) después:** cache-first de tiles. La ruta es fija y conocida → pre-descargar el bounding
     box al bajar el paquete del día.
   - (c) MBTiles offline completo: fuera de alcance P0.
3. Auditar el orden de render de la polyline para el síntoma 10. **Ojo: Leaflet usa `[lat, lng]`,
   GeoJSON usa `[lng, lat]`.** Un cruce entre los dos produce exactamente ese síntoma.

**Verificación:** MCP `mobile`, modo avión, abrir operación → screenshot con la ruta visible. Grep
de que no queda ningún `https://` en el HTML del WebView.
**Rollback:** revert. **Riesgo medio:** si el bundle de Leaflet falla, el mapa muere en todos lados,
no solo offline. **Probar con red y sin red antes de mergear.**

---

### Entrega 26 — Preflight de captura y arranque local-first
**P0 · Ámbito: móvil · ~8 h · Depende de: 3 · Implementa la regla del CTO**

De las 6 fallas de captura, **solo 2 están cubiertas**. `apps/mobile/src/gps/permiso-ubicacion.ts`
ya tiene una máquina pura y testeada (`decidirPermisoGps`) que devuelve
`{estado, bloqueante, titulo, mensaje, accion}`. **Reusar esa forma, no inventar otra.**

| Falla | Detección | ¿Bloquea? | Copy |
|---|---|---|---|
| Permiso revocado / "solo mientras se usa" | `decidirPermisoGps` (**ya existe**) | Sí | *"QUIVO necesita ver tu ubicación todo el tiempo, también con la pantalla apagada."* |
| GPS del sistema apagado | `getProviderState()` (**ya existe**) | Sí | *"El GPS del teléfono está apagado."* |
| Optimización de batería | `deviceSettings.isIgnoringBatteryOptimizations()` | No, advierte | *"Tu teléfono puede apagar QUIVO para ahorrar batería."* → `showIgnoreBatteryOptimizations()`; `showPowerManager()` para Xiaomi/Huawei/Samsung |
| Almacenamiento lleno | Escritura canaria a `quivo-outbox.db`; `SQLITE_FULL` en runtime | Sí | *"El teléfono no tiene espacio. QUIVO no puede guardar tu recorrido."* |
| Sesión expirada sin refresh | Circuit breaker de la Entrega 3 abierto | Sí | *"Tenés que volver a ingresar tu placa y PIN."* |
| **Paquete del día ausente** | `obtenerPaqueteDiaLocal() === null` o `puntosControl.length === 0` | **Sí** | *"No tenemos los puntos de control de tu ruta. Conectate un momento para bajarlos."* |
| Notificaciones no concedidas (Android 13+) | Estado expuesto por la Entrega 7b (`POST_NOTIFICATIONS`) | No, advierte | *"Activá las notificaciones para escuchar los avisos de puntos de control con la pantalla apagada."* Si se niega, vibración y voz siguen |
| Reconocimiento de actividad | `ACTIVITY_RECOGNITION` `not_granted` (visto en el evento de Sentry del 10-09) | No, advierte | Sin este permiso el SDK de GPS detecta peor cuándo el vehículo está detenido o en movimiento: más huecos o más consumo. Pedirlo en runtime |

**La última es el hallazgo más grave del plan.** `headless-task.ts:358` hace
`puntosControl: paqueteLocal?.paquete.puntosControl ?? []`. Con el paquete ausente o de otra
asignación, el headless registra `gps_point` **con cero puntos de control**: sin detección, sin
anuncio, sin error, sin rastro. **El chofer termina la jornada creyendo que marcó todo.** Es
exactamente la falla de captura invisible que motivó la regla del CTO. Además del bloqueo en el
preflight, el headless debe emitir **notificación persistente** si detecta
`puntosControl.length === 0` con sesión vigente.

**Monitoreo continuo, no solo preflight.** Android degrada el permiso a "solo mientras se usa" tras
días sin uso, y puede matar el servicio a mitad de jornada. Suscribir
`BackgroundGeolocation.onProviderChange` y re-evaluar; si algo se rompe **durante** el recorrido,
notificación persistente de alta prioridad.

**Arranque local-first (parte de esta entrega).** `operation-screen.tsx:417-421` exige
`!paqueteDia.cargando`, y `use-paquete-dia.ts:33-38` hace fetch **primero** con
`REQUEST_TIMEOUT_MS = 12_000` (`http-client.ts:1`). **En zona muerta el chofer mira un botón
deshabilitado 12 segundos** antes de que caiga al caché local que ya tenía. **Invertir el orden:**
leer el caché primero y habilitar "Iniciar" de inmediato si el paquete local es válido; la descarga
corre en background y refresca si llega.

**Nuevo:** `apps/mobile/src/gps/preflight-captura.ts` — lógica pura, testeable en Node, mismo patrón
que `geofence.ts`.

**Verificación:** unit exhaustivo de la matriz 6 estados × Android/iOS × `permisoYaSolicitado`. MCP
`mobile`: revocar permiso con `adb`, abrir la app → assert del copy y del botón. Modo avión →
"Iniciar recorrido" habilitado en <1 s.
**Rollback:** revert. **Riesgo medio: bloquear a un chofer que sí podía trabajar.** Cada bloqueo
lleva escape ("Continuar igual") **excepto** GPS apagado y paquete ausente, donde continuar es
garantía de pérdida total de evidencia.

**Nota para la Entrega 4:** el string de `use-gps-operativo.ts:212` ("la evidencia de esos puntos se
perdió") es una falla de **CAPTURA** (escritura a SQLite), no de transporte. **No se oculta: se
reemplaza** por el aviso accionable de almacenamiento de esta entrega. El `Sentry.captureException`
de `:199-210` se conserva.

---

### Entrega 27 — Precarga del paquete al crearse la rotación
**P0 · Ámbito: móvil + API + shared · ~8 h · Depende de: 26 · Pedido del CTO**

**Problema.** `use-paquete-dia.ts` documenta su propio disparador: *"Descarga el paquete del día
(QUI-236) **al entrar a la pantalla de operación**"*. Es el peor momento posible: el chofer ya está
en el vehículo, por arrancar, quizá sin señal. `paquete-dia-api.ts` solo expone
`GET /v1/mobile/asignacion-del-dia` (`paquete-dia.controller.ts:11`) — **solo hoy, bajo demanda**.

**Objetivo:** cuando el admin crea la rotación en el panel, el teléfono ya tiene todo lo que
necesita para operar sin red **antes** de llegar al vehículo.

**Restricción verificada: no hay infraestructura de push.** Ni `expo-notifications`, ni FCM, ni
`background-fetch` en `apps/mobile/package.json`. "Recibir" la rotación por push exige agregar FCM
(credenciales, canal Android, emisión desde el backend) — **P1, ver abajo**. Esta entrega usa
precarga *pull* oportunista, que cubre el caso sin esa dependencia.

**Disparadores de precarga (en orden de valor):**
1. **Al finalizar recorrido** (evento `fin_recorrido`) — el mejor: el chofer está en la terminal,
   con la app abierta y cobertura. Baja la asignación siguiente.
2. **Al abrir la app / login** — barrer las asignaciones próximas (7 días) que falten.
3. **Durante el recorrido, en el `onHeartbeat`** de la Entrega 2 — la cobertura urbana en
   movimiento es mejor que en la terminal. Costo marginal cero: el enganche ya existe.
4. **Al reconectar** (`NetInfo`), reusando el mismo mutex de la Entrega 2.

**API nueva:** `GET /v1/mobile/asignaciones-proximas?dias=7` → lista de paquetes completos
(geometría de ruta + puntos de control + metadatos), no solo ids. Extiende
`paquete-dia.controller.ts`; el shape del paquete ya existe (`PaqueteDiaSchema`).

**Almacenamiento:** `db/paquete-dia.ts` guarda hoy **una** fila. Pasa a N filas indexadas por
`asignacionId`, con purga de las vencidas. `obtenerPaqueteDiaLocal` ya valida que la fila pertenezca
a la asignación de la sesión guardada (Hallazgo 1 documentado en el propio archivo) — **conservar esa
validación**, es la que evita servir la ruta de otro turno.

🔴 **Invalidación — riesgo que la precarga introduce.** Si el admin edita la rotación, la ruta o los
puntos de control **después** de que el teléfono precargó, el chofer sale con datos viejos y nadie se
entera. **Una precarga sin invalidación es peor que no precargar**, porque hoy al menos baja fresco.
Cierre obligatorio en esta misma entrega:
- Agregar `actualizadoEn` (o `version`) al `PaqueteDiaSchema`, derivado del `updatedAt` de la
  asignación + ruta + puntos de control.
- Chequeo barato al iniciar recorrido: `GET .../asignacion-del-dia?siVersionDistinta=<v>` → 304 si
  no cambió, paquete completo si cambió. Con red, refresca en un round-trip liviano; sin red, usa el
  precargado (que es el comportamiento correcto).
- El preflight de la Entrega 26 muestra la fecha de la última actualización del paquete que va a
  usar, para que un dato viejo sea visible y no silencioso.

**Tiles (junto con la Entrega 25):** al precargar el paquete, precargar también los tiles del
bounding box de la ruta. La ruta es fija y conocida — es el momento natural para hacerlo, y es lo que
convierte el mapa offline de "fondo liso" a "mapa real sin red".

**Verificación:** MCP `mobile` — crear una rotación para mañana en el panel, abrir la app con red,
cerrarla, activar modo avión, y arrancar el recorrido del día siguiente: debe funcionar completo sin
red, con ruta y puntos de control. Test de invalidación: precargar, editar la ruta en el panel,
reconectar → el teléfono toma la versión nueva.
**Rollback:** revert. **Riesgo medio:** N paquetes en SQLite crecen el almacenamiento local (mitigado
con purga); un `asignacionId` mal resuelto serviría la ruta equivocada (mitigado por la validación
existente, que **no hay que tocar**).

**P1 asociado — push real (FCM).** Con `expo-notifications` ya agregado por la Entrega 7, sumar FCM
permite que el panel empuje *"tu rotación cambió"* y el teléfono precargue en el momento, sin esperar
a que el chofer abra la app. Es el pedido literal del CTO ("al recibir su rotación"); esta entrega lo
aproxima con pull y lo deja preparado.

---

### Entrega 28 — Sesión desplazada: causa raíz del `refresh-agotado`
**P0 · Ámbito: API + móvil · ~6 h · Depende de: 3, 24 · Evidencia: Sentry `QUIVO-CONTROL-CONDUCTOR-2`**

**Evidencia (Sentry, proyecto `quivo-control-conductor`).** Tres eventos
`AuthMovilApiError: Sesión móvil inválida o expirada`, todos con `paso: refresh-agotado` y
`reintentos: 3`:

| Cuándo (UTC) | Dispositivo (`user.id`) | Build | Contexto |
|---|---|---|---|
| 2026-08-23 16:19 | `948f…` | 7 | QA |
| 2026-09-09 20:54 | `948f…` | 10 | **16:54 en Bolivia: arranque de los recorridos del piloto**, con credenciales cruzadas y cambio de APK en curso |
| 2026-09-10 14:44 | `680a…` | 10 | Reprueba pedida por el CTO. **48 s después de abrir la app**, en primer plano, online, Galaxy A71, Android 13 |

**Patrón:** siempre al **empezar** a usar la app, nunca a mitad de recorrido. La Entrega 3 (circuit
breaker) acota los reintentos, pero **no explica por qué el servidor rechaza un refresh a los 48 s**.

**Hipótesis, en orden de probabilidad:**
- **(a) Sesión desplazada.** `auth-movil.service.ts` cierra la sesión viva de la placa en cada login
  (un vehículo admite una sola `SesionOperativa`). Si otro teléfono entra con la misma placa
  (credenciales cruzadas como en el piloto, reinstalación o cambio de APK), el refresh del primero
  se rechaza **con el mismo 401 genérico que un token vencido**, y la app lo trata como transitorio.
- **(b) Carrera de rotación del refresh token.** Dos refresh concurrentes (arranque de la app más
  el primer sync): el segundo usa un token que el primero ya rotó.

**Paso 1 — diagnóstico antes de codear.** Logs de Cloud Run de las llamadas de refresh y login móvil
a las 20:54Z del 09-09 y a las 14:44Z del 10-09, más el historial de `sesiones_operativas` de esos
vehículos: ¿hubo un login de la misma placa desde otro `deviceId` segundos antes? Requiere que el CTO
reautentique `gcloud` (`gcloud auth login`). **No implementar el fix sin confirmar la causa.**

**Paso 2 — fix según la causa confirmada:**
- **Si es (a):** la API devuelve un error distinguible (`SESION_DESPLAZADA`, con placa y hora) en vez
  del genérico, y guarda el motivo de cierre de la sesión (p. ej. `cerradaPor: 'nuevo_login'`). La app
  lo trata como falla de **CAPTURA**: sin reintentos y con un mensaje en lenguaje de chofer, del estilo
  *"Otra persona inició sesión con este vehículo. Si sos vos, volvé a ingresar."*. Junto con la
  Entrega 24 (confirmar "¿Sos Betty?" al loguear) cierra la clase de error del piloto.
- **Si es (b):** refresh *single-flight* en el cliente (una sola promesa de refresh compartida) y, en
  el servidor, tolerancia de reuso del refresh anterior durante una ventana corta.

**Verificación:** test de API: dos logins de la misma placa desde dos `deviceId` → el refresh del
primero devuelve `SESION_DESPLAZADA`, no el 401 genérico. Test de cliente del *single-flight* si
aplica (b). Reproducción manual con dos teléfonos.
**Rollback:** revert. El código de error nuevo es compatible hacia atrás: un APK viejo lo ve como 401.

---

### Entrega 7b — Pedir `POST_NOTIFICATIONS` en runtime
**P0 · Ámbito: móvil · ~2 h · Depende de: 7 · Evidencia: Sentry `QUIVO-CONTROL-CONDUCTOR-2`**

El evento de Sentry del 10-09 (Android 13) reporta `POST_NOTIFICATIONS: not_granted` con el permiso
**declarado** en `app.config.ts`. En Android 13+ es permiso de runtime y hoy nadie lo pide, así que
**la notificación del anuncio de la Entrega 7 no se muestra en campo**. Pedirlo con la app en primer
plano antes de iniciar el recorrido. Fail-open: si se niega, vibración y voz siguen. Exponer el estado
para el preflight de la Entrega 26.

---

## Auditoría offline — qué ya cumple el principio rector

| Camino | ¿Toca la red? | Evidencia |
|---|---|---|
| Detección de puntos de control | **No** | `headless-task.ts:278, 358` lee de SQLite local, cero fetch |
| Caché del paquete del día | **Completo** | `db/paquete-dia.ts` — payload entero en SQLite, validado con `PaqueteDiaSchema` |
| Acumulación de estado (histéresis) | **No** | `asegurarSemillaCumplimientos` siembra desde el outbox local |
| Anuncio voz/sonido | **No**, pero solo en foreground | Entrega 7 |
| Lista de cumplidos | **No existe** | Entrega 8 |
| **Navegación (mapa)** | **Sí — dependencia dura** | Entrega 25 |
| **Arranque del recorrido** | **Sí — spinner de 12 s** | Entrega 26 |
| **Momento de bajar el paquete** | **Sí — al entrar a la pantalla de operación** | Entrega 27 |

La arquitectura offline de la **evidencia** ya está bien construida. Lo que falta es el mapa, el
arranque, el anuncio fuera de React, la lista acumulada, y hacer visibles las fallas de captura.

---

## Grafo de dependencias

```
OPERATIVO (hoy, serial)
  0a ──► 0b ──► 0c

MÓVIL — un APK (tres cadenas paralelas, archivos distintos)
  1 ──► 2 ──► 3 ──► 4 ◄── 26        (sync/outbox/sesión)
  5 ──► 6 ──► 7 ──► 8 ──► 9         (geofence/anuncio/lista)
  25 ─────────────► 27              (mapa offline ──► precarga de tiles)
  3 ──► 26 ───────► 27              (preflight ──► precarga del paquete)

API (paralelo entre sí)
  10 ──────────────► (habilita 13, 19, 20)
  11 (necesita censo de 0b)
  12 ──────────────► 21
  22 (independiente)

WEB (serial, misma página)
  10 ──► 13 ──► 14
         13 ──► 16 ◄── 15

DATOS (P1)
  0a ──► 18
  0c ──► 17
  11 ──► 24
  0a ──► 23
```

**Se pueden paralelizar en subagentes distintos:**
- Tres cadenas móviles independientes por archivo: **1→4+26** (sync/outbox/sesión), **5→9**
  (geofence/anuncio/lista), **25** (mapa offline). **Tres subagentes Sonnet en paralelo**, merge al
  final en un APK.
- Entregas 10, 12, 22 son independientes entre sí → **tres subagentes**.
- Entrega 15 no depende de nada → paralela a todo.
- Entregas 14 y 16 se pueden desarrollar contra un mock de la 10 y mergear después.

**No separables (además de 13+14):**
- Entrega 15 toca `shared` + API + web en un PR: mover una constante compartida sin actualizar a sus
  consumidores rompe el build.
- Entregas 11 y 10 tocan `shared` + API: cambian schemas Zod compartidos.
- Entregas 17 y 21 llevan migración Prisma + el código que la usa en el mismo PR.
- Entregas 6, 7 y 8 salen en **un solo APK** (no un solo PR): un APK con 6 sin 7 anuncia en el
  mínimo local pero sigue sin sonar en background.

**Serial obligatorio:** 10 antes de 13; 13 antes de 14 y 16; 0b antes de 11 (el censo).

**No separables:** 13 y 14 comparten `map-builders.ts` y el cambio de `ID_MARCADOR_VEHICULO` a id por
sesión — si sale 13 sin 14, el mapa muestra N vehículos indistinguibles de los puntos de control.

---

## Decisiones abiertas del CTO

| # | Decisión | Recomendación | Insumo |
|---|---|---|---|
| **1** | **Radio de detección** | Mantener **150 m para detección**; `RADIO_CONFIRMACION_M = 40` para el anuncio. El pedido de "10 m" se satisface en la **experiencia**, no en la detección | Entrega 18, Query 2. `RUTA_PROXIMIDAD_TOLERANCIA_METROS = 100` permite puntos a 100 m de su ruta: todo radio menor los pierde siempre |
| **2** | **Dónde suena el anuncio** | Notificación local Android desde headless, no desde el árbol React | Entrega 7. Es la diferencia entre "suena a veces" y "suena siempre" |
| **3** | **`lineaId` en `Conductor`** | Columna simple nullable. N:M solo si un chofer rota entre líneas | Entrega 17. Sin esto el round-robin **no puede** emparejar bien |
| **4** | **Guard de `deviceId`** | Sí, con censo previo obligatorio | Entrega 11. Riesgo de dejar choferes afuera si se saltea |
| **5** | **SSE vs poll** | Poll a 5 s. SSE recién después de la Entrega 2 | Entrega 10. Hoy el cuello es la ingesta, no el transporte |
| **6** | **Vehículo perdido en el mapa** | >45 min sin fix → estilo fantasma, "última posición conocida" | Entrega 16. La decisión de honestidad más visible del panel |
| **7** | **Radios configurables** | `packages/shared` para P0; mover al paquete del día en P1 (cambiar sin APK nuevo) | Entrega 6 |
| **8** | **Push (FCM) para la rotación** | Pull oportunista ahora (Entrega 27); FCM en P1, apoyado en el `expo-notifications` que agrega la Entrega 7 | No existe infra de push hoy: ni FCM ni `expo-notifications` en `apps/mobile/package.json` |
| **9** | **Ventana de precarga** | 7 días de asignaciones próximas | Cubre fin de semana y feriados sin inflar SQLite |
| **10** | **Sesión desplazada** | Confirmar la causa con los logs del servidor antes de codear; si es desplazamiento por otro login, error distinguible y tratarlo como falla de captura sin reintentos | Entrega 28. Los 3 eventos de Sentry son `refresh-agotado` al arrancar la app |

---

## Verificación contra la vara formal

No inventar criterios: `docs/piloto/checklist-aceptacion-e2e.md:169-200` ya tiene A1-A7. Los tres que
este plan mueve:

- **≥90% de pasos anotados detectados** → Entrega 18 (replay) + Entrega 8 (lista acumulada, evidencia
  visible en el teléfono).
- **0 detecciones sin paso anotado** → la histéresis multi-vuelta ya lo protege; verificar que la
  Entrega 6 (emitir en el mínimo local) no lo rompa.
- **p95 de acuse ≤5 min** → es la métrica que la Entrega 2 tiene que mover. Proyección documentada:
  p50 ~6 s.

---

## Fuentes de la investigación local-first

- [Local-First Software: You Own Your Data, in spite of the Cloud](https://www.inkandswitch.com/essay/local-first/local-first.pdf) — Kleppmann et al., Ink & Switch. Los siete ideales; los cuatro primeros aplican acá.
- [Local-First Software: Origins and Evolution](https://powersync.com/blog/local-first-software-origins-and-evolution) — PowerSync. Los cuatro componentes del patrón: copia primaria en el dispositivo, toda acción es transacción local, sync en background que observa la DB local.
- [Watermarks and Triggers in Stream Processing](https://www.conduktor.io/glossary/watermarks-and-triggers-in-stream-processing) — sustenta la representación de watermark de la Entrega 16.
- [Understanding Apache Flink Event Time and Watermarks](https://www.decodable.co/blog/understanding-apache-flink-event-time-and-watermarks) — `ts` (event time) vs `received_at` (processing time) son dos ejes distintos: exactamente lo que `clasificarFrescura` ya cruza.
- [What is Stale Data? Causes, Detection, Freshness SLAs](https://tacnode.io/post/what-is-stale-data) — el caso del badge "stale" que los usuarios aprenden a ignorar. Sustenta usar texto y forma, no solo color.
- [Phi Accrual Failure Detection](https://doc.akka.io/libraries/akka-core/current/typed/failure-detector.html) — sospecha en escala continua vs binaria. Argumento formal contra los umbrales de 90 s de la spec original.
- [MapLibre Style Spec — Layers](https://maplibre.org/maplibre-style-spec/layers/) — `symbol` con `icon-image` conserva la animación por `setData()`, requisito duro de la Entrega 14.
- Context7 `/websites/transistorsoft_github_io_react-native-background-geolocation` — `registerHeadlessTask` (la función debe ser `async` y hay que `await` todo el trabajo; la tarea termina al ejecutar la última línea — crítico para la Entrega 2); `onHeartbeat` (mínimo 60 s en Android).

**Nota de arquitectura — no hacen falta CRDTs.** Todos los eventos son observaciones inmutables
append-only con `eventId` UUIDv7 (`packages/shared/src/sync/evento.ts:22-29`), ingeridas
idempotentemente. No hay dos escritores del mismo hecho, así que no hay conflicto que resolver: el
merge es unión de conjuntos (un G-Set, el CRDT trivial). **La convergencia ya está.** Lo que falta no
es resolución de conflictos, es entrega (Entrega 2) y representación de incompletitud (Entrega 16). No
agregar Automerge/Yjs.
