# Plan — cargar el recorrido real de la Z12

> **Estado:** propuesto, pendiente de confirmación del CTO y de datos del sindicato.
> **Ventana de ejecución:** después de que termine la jornada del lunes 17 de agosto y antes
> de las 05:00 del martes 18.
> **Escrito:** 2026-08-17, madrugada, con los datos que el sindicato mandó el 16 por la noche.

Este documento reemplaza la descripción de la operación Z12 que quedó en
[`handoff.md`](handoff.md) §"Cómo opera Z12 de verdad" — esa versión **está equivocada** en su
punto central. Ver §1.

---

## 1. Qué cambió respecto de lo que creíamos

El handoff del 16 daba por cerrado que *"Salomón Romero es solo punto de partida de la primera
salida de la mañana, no un destino de retorno"* y que *"a partir de ahí el circuito termina en
Univalle"*. El dato nuevo del sindicato dice otra cosa:

| | Handoff del 16 (obsoleto) | Confirmado el 17 |
|---|---|---|
| Salida | grupo 1 desde Salomón, grupo 2 desde Villa | el vehículo del piloto sale de **Villa Armonía, entre 5 y 7 AM** |
| Vuelta 1 | Salomón → Univalle, una vez al día | **Villa → Salomón** (pasa por Univalle sin quedarse) → **Salomón → Villa** sin pasar por Univalle |
| Vueltas 2+ | circuito terminando en Univalle | **Villa ⇄ Univalle**, ya no vuelven a Salomón |

**La consecuencia de fondo:** la vuelta 1 tiene un recorrido **distinto** de las vueltas 2+, no
solo un punto de partida distinto. El tramo Univalle↔Salomón se recorre exactamente una vez por
día en cada sentido.

Esto convierte a **QUI-384 ("las vueltas no existen")** de deuda post-piloto en un problema de
modelo activo: el sistema asigna una ruta fija por jornada y no puede representar que la vuelta 1
sea diferente.

## 2. Los 14 puntos de control reales del sindicato

Resueltos desde los enlaces de Google Maps que mandó el sindicato (16 enlaces, 2 duplicados).
Validados por distancia contra las polilíneas cargadas en producción y contra OpenStreetMap.

**Sentido Salomón → Villa Armonía** (se recorre en la vuelta 1, de bajada):

| id | lat, lng | referencia | dist. a ruta `ida` |
|---|---|---|---|
| A1 | -17.321834, -66.224869 | Tienda Richi — **punto fucsia de reingreso** tras el desvío | 8.8 m |
| A2 | -17.332932, -66.219535 | — | 0.25 m |
| A3 | -17.368164, -66.164155 | Av. Simón López | 0.61 m |
| A4 | -17.392085, -66.155501 | — | 7.7 m |
| A6 | -17.416780, -66.151783 | Av. República | 2.3 m |
| A7 | -17.421730, -66.154836 | — | 0.41 m |

**Sentido Villa Armonía → Salomón** (se recorre en la vuelta 1, de subida):

| id | lat, lng | referencia | dist. a ruta `vuelta` |
|---|---|---|---|
| B1 | -17.429071, -66.153948 | Villa Armonía | 1.0 m |
| B3 | -17.409815, -66.149841 | usm motos suc 2 | 10.7 m |
| B4 | -17.390904, -66.150122 | — | 2.5 m |
| B5 | -17.391749, -66.154522 | Av. Heroínas & San Martín | 0.88 m |
| B6 | -17.368093, -66.163986 | — | 3.7 m |
| B7 | -17.340934, -66.214290 | — | 6.9 m |
| B8 | -17.333925, -66.226251 | **Univalle — punto doble, ingreso y salida** | 3.2 m |
| B9 | -17.318958, -66.228020 | **parada temporal de Salomón** | 130 m ❌ |

**El orden que mandó el sindicato es el correcto.** Verificado contra OSM: saliendo de Villa,
B4 se cruza a los 6 685 m de recorrido y B5 a los 7 166 m. No reordenar por latitud.

**A3 y B6 son el mismo cruce físico** (19.6 m entre sí), uno por sentido. Son dos puntos, no un
error de captura: OSM confirma que ese corredor tiene calles de un solo sentido.

**B9 es el único que no se puede cargar hoy.** Está a 130 m de la ruta `ida` y a 137 m del
corredor de OSM; el API rechaza cualquier punto a más de 100 m de la geometría de su ruta
(`apps/api/src/common/geo/proximidad-ruta.ts`). No es un error de captura — la parada temporal
está genuinamente fuera de la calle por donde corre la Z12, que es exactamente por qué existe un
desvío hacia ella. Se resuelve metiendo B9 como vértice de la geometría, nunca bajando la
tolerancia.

### Los dos desvíos temporales

1. **Parada de Salomón corrida** (oficina en reparación). Salen del trazado, van por la calle
   marcada en amarillo hasta **B9**, y retoman la ruta en el punto fucsia = **A1**. Separación
   B9 → A1: **463 m**.
2. **Una cuadra alternativa en Villa Armonía** (~100 m). **Irrelevante para la medición**: el
   desvío es menor que el radio de tolerancia de 150 m de los puntos de control, así que no puede
   cambiar ninguna detección. Solo afecta cómo se dibuja la línea.

## 3. Estado real de la geometría cargada

Verificado contra producción el 17 de agosto.

| Ruta | id | Vértices | Qué es en realidad |
|---|---|---|---|
| `ida` | `3333…0011` | 117 | **Salomón → Villa. Correcta y completa.** Vértice 0 a 3 m de la Parada Salomón Romero real |
| `vuelta` | `813c6130-…` | 138 | **Villa → Univalle → +1 174 m de regreso.** Su vértice 124 está a **9.1 m** de la Parada Univalle |

**Corrección de un error de análisis previo:** se creyó que la ruta `vuelta` se cortaba 778 m
antes de Univalle. Falso — esa medición era contra su *último* vértice. La ruta **pasa por
Univalle** (vértice 124) y después sigue 1 174 m de regreso antes de cortarse. B8 (el punto de
Univalle del sindicato) está a 3.3 m de ese vértice 124.

**Lo que falta de geometría:** el tramo **Univalle → Salomón** (~2.4 km), incluido el desvío a la
parada temporal. Es justo el tramo que solo se recorre en la vuelta 1.

### OpenStreetMap como respaldo

La Z12 está mapeada en OSM por el propio sindicato, en 4 relaciones completas y sin huecos:

| Relación OSM | Vértices | Largo |
|---|---|---|
| `16769583` Salomón → Villa | 626 | 20 896 m |
| `16769606` Villa → Salomón | 646 | 20 299 m |
| `9373042` Univalle → Villa | 576 | 18 923 m |
| `9373675` Villa → Univalle | 594 | 18 176 m |

Los cuatro sentidos son trazados distintos, no espejos — hay calles de un solo sentido. Eso
confirma de forma independiente el dato del sindicato de que al bajar de Salomón **no** se pasa
por Univalle.

**Discrepancia sin resolver:** OSM ubica B8 a 10.7 m del corredor Univalle↔Villa pero a **619 m**
del corredor Villa→Salomón. El sindicato mandó B8 en la lista Villa→Salomón. Se explica si el
trufi usa el corredor de Univalle para llegar a Salomón —lo que coincide con "pasan por Univalle
pero no se quedan"— y entonces el Villa→Salomón mapeado en OSM no es el que ellos manejan.
**Lo resuelve la traza del día 17**, no una discusión.

## 4. Decisión de modelo: una sola ruta circuito

**Restricción que decide:** el paquete del día trae los puntos de control de la **única** `rutaId`
de la asignación (`apps/api/src/modules/tracking/paquete-dia.service.ts:61-68`). Si los 14 puntos
no cuelgan de la misma ruta, el teléfono nunca los ve.

**Decisión:** una sola ruta cuya geometría es el circuito completo del día, editada **en el lugar**
sobre `3333…0011` — la ruta a la que ya apunta la asignación publicada.

```
vuelta[0..124]  (Villa → Univalle)
  + conector nuevo (~2.4 km: Univalle → B9 parada temporal → A1 punto fucsia)
  + ida[0..116]  (Salomón → Villa)
```

Editar en el lugar es lo que evita el único punto de no retorno del plan: **no hay que anular ni
republicar la rotación**. `PATCH /v1/rutas/:id` no pasa por `asegurarRotacionEditable`, y el login
móvil exige `rotacion.estado = 'publicada'` (`auth-movil.service.ts:429`). Cualquier plan que
pase por `anular` abre una ventana en la que el conductor **no puede loguearse**.

**Alternativas descartadas:**

- *Dos rutas + dos asignaciones*: obliga a republicar la rotación y hace que el conductor elija en
  una pantalla que nunca vio, a las 5 AM. Además la sesión queda atada a una asignación, así que
  cambiar de paquete exigiría re-loguear a mitad de día.
- *`Variante`*: el modelo existe pero **no tiene columna de geometría** y `paquete-dia` no lo
  consulta. Exige migración + código + deploy la víspera.
- *Dejar dos rutas y apuntar a la que más cubre*: mide media jornada.

**Detalle de UX que sí importa:** `orden` no se usa para detección, pero sí alimenta el indicador
"próximo punto" del conductor (`proximo-punto-control.ts:9`). Hay que numerar en el sentido real
de marcha (Villa → Univalle → Salomón → Villa). Efecto esperado, **avisar al acompañante**: al
terminar la vuelta 1 todos los puntos quedan completados y el indicador muestra "sin próximo
punto" el resto del día. No es una falla.

## 5. Qué se hace con los 24 puntos de medición interpolados

**Conviven con los reales, con poda por proximidad. Nada se borra.**

Como cada punto se detecta **una sola vez por sesión** (§6), el universo de medición del día es
"una oportunidad por punto". Bajo esa regla, sacar los interpolados reduce la muestra justo en el
único día en que hay muestra. Además responden preguntas distintas: los interpolados miden
*"¿el sistema detecta?"* (son uniformes, caen a 0 m de la polilínea); los reales miden
*"¿detecta donde al sindicato le importa?"*.

**La redundancia sí molesta:** dos puntos a 54 m con radio 150 m disparan del mismo fix GPS. No
aportan medición nueva, inflan el denominador y descuadran la planilla del acompañante, que ve un
paso donde el sistema registra tres.

**Regla de poda:** tras cargar los 14 reales, todo punto **no real** que quede a menos de 150 m
(un radio) de un punto real → `estado: inactivo`. El real siempre gana. Con radio 150 m, la traza
que pasa cerca del interpolado también cae dentro del real: no se pierde medición.

Con los datos actuales eso alcanza al menos a los 2 vecinos de B8 (42 m y 54 m).

**Los ~12 interpolados que hoy cuelgan de `vuelta` hay que recrearlos** sobre la ruta fusionada,
con las mismas coordenadas para preservar comparabilidad con el día 17. Quedan con **ids nuevos** —
guardar el mapeo `id_viejo → id_nuevo` para cualquier análisis que cruce los dos días.

**No agregar puntos de medición nuevos sobre el conector aproximado**: se estaría midiendo contra
una recta inventada.

Conteo final estimado: ~22 interpolados + 14 reales ≈ **36 activos**.

## 6. La detección una-vez-por-sesión

**Hecho verificado:** `apps/mobile/src/gps/geofence.ts:47-49` filtra contra un set `yaDetectados`
scopeado por `sesionId`, que dura todo el turno y nunca se vacía. **Solo se mide la primera
pasada. Las vueltas 2+ no generan cumplimientos.**

La detección **no** depende del `orden` (`geofence.ts:16-24` mapea todos los puntos por
proximidad), así que recorrer la ruta al revés no rompe nada. El worker tampoco usa orden
(`ingesta-worker.service.ts:309-319`, solo `ST_DWithin`).

**Decisión: no tocar el APK. Recuperar las vueltas por replay SQL sobre `gps_points`.**

1. **El replay no es un consuelo, es mejor dato.** `gps_points` tiene `sesion_id, ts, lat, lng,
   accuracy, speed`, particionada por día, índice `(sesion_id, ts)`. Reconstruye cada pasada de
   cada punto en cada vuelta, con hora, y barre los radios 30/50/100/150 en la misma query — que
   es el replay que ya estaba planeado igual. El fix en el APK produce información **estrictamente
   contenida** en lo que ya se graba.
2. **El riesgo es asimétrico.** El fix toca `location-task.ts` / `geofence.ts`, que son el camino
   que escribe la evidencia. Una regresión ahí no degrada la medición: borra el día.
3. **El workaround de re-loguear por vuelta es peor que no hacer nada.** Funciona técnicamente
   (el re-login emite `sesionId` nuevo y los puntos vuelven a medirse), pero: exige red en cada
   terminal; y entre el logout y el siguiente `iniciar()`, `headless-task.ts:98-104` llama
   `BackgroundGeolocation.stop()`, que **desactiva `startOnBoot`**. Si el conductor re-loguea y no
   aprieta "Iniciar", se pierde la traza cruda del resto del día — o sea, pone en riesgo el
   activo que hace que la opción 1 funcione.

### El replay, escrito antes de necesitarlo

```sql
WITH radios(r) AS (VALUES (30),(50),(100),(150)),
pts AS (
  SELECT g.sesion_id, g.ts,
         ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography AS p
  FROM gps_points g
  WHERE g.ts >= '2026-08-18 04:00Z' AND g.ts < '2026-08-19 04:00Z'
),
hits AS (
  SELECT r.r AS radio_m, pc.id AS punto_control_id, pc.orden, pc.obligatorio,
         pts.sesion_id, pts.ts, ST_Distance(pts.p, pc.coord) AS dist_m
  FROM pts
  CROSS JOIN radios r
  JOIN puntos_control pc
    ON pc."rutaId" = '33333333-3333-4333-8333-000000000011'
   AND pc.estado = 'activo'
   AND ST_DWithin(pts.p, pc.coord, r.r)
),
sesionizado AS (   -- una "pasada" nueva cuando hay > 5 min de hueco en el mismo punto
  SELECT *, CASE WHEN ts - LAG(ts) OVER w > interval '5 minutes' OR LAG(ts) OVER w IS NULL
                 THEN 1 ELSE 0 END AS nueva_pasada
  FROM hits
  WINDOW w AS (PARTITION BY radio_m, punto_control_id, sesion_id ORDER BY ts)
)
SELECT radio_m, punto_control_id, orden, obligatorio,
       SUM(nueva_pasada) AS pasadas, MIN(ts) AS primera, MAX(ts) AS ultima
FROM sesionizado GROUP BY 1,2,3,4 ORDER BY radio_m, orden;
```

Da, por radio: cuántas vueltas pisó cada punto, a qué hora, y por diferencia el headway real.

### Si algún día se hace el fix (post-piloto, no mañana)

- `geofence.ts`: cambiar el `Set<string>` por un `Map<string, { dentro: boolean; ultimoTsFix }>`
  y emitir cuando `cumplido && !previo.dentro`. **La histéresis es obligatoria** — marcar
  `dentro = false` solo cuando `distanciaM > radioToleranciaM * 1.5`; sin eso, un vehículo
  detenido dentro del radio emite en cada fix.
- `location-task.ts`: `clavesCumplimientoDesdePayloads` debe sembrar `dentro = true` **solo** para
  payloads con `tsFix` dentro de una ventana corta (~5 min). Si sigue siendo permanente, suprime
  todas las vueltas y el fix no hace nada.
- Server-side no hace falta tocar nada: `CumplimientoPc` deduplica por `eventId`, no por
  `(sesionId, puntoControlId)`. **Pero** revisar `reportes/cumplimiento.service.ts`: cuenta filas
  de `cumplimientos_pc`, así que N pasadas cambian la semántica del porcentaje de "cobertura de
  puntos" a "cobertura de pasadas". Decidir cuál se quiere **antes** de mergear.

## 7. La ventana 5–7 AM

**Dejarlo como está. No regenerar la rotación.**

- `configHorarios` solo actúa en la **generación** (`rotaciones.service.ts:127`). No hay endpoint
  que la aplique a una rotación ya generada: usarla exige rotación nueva y asignaciones nuevas del
  18 al 31.
- Con **un solo vehículo** no genera nada útil: el `@@unique([vehiculoId, fecha, horario])` permite
  una sola asignación por vehículo/fecha/horario, así que los sub-slots extra caen en
  `sinCobertura`.
- `horaSalida` / `horaPresentacion` **no las lee nadie**: cero referencias en `apps/web` y
  `apps/mobile`, y no viajan en `PaqueteDiaSchema`.
- **Nada bloquea una salida a las 5 AM.** El login filtra por fecha calendario boliviana +
  `estado: 'vigente'` + `venceAt > ahora`; `finDeJornadaBolivia` pone `venceAt` a las 23:59:59
  local. A las 05:00 del 18, `fechaActualBolivia()` ya devuelve el 18.

La hora real de salida se obtiene mejor del dato: primer `gps_point` de la sesión, o el evento
`inicio_recorrido`. Un `horaSalida` planificado que nadie lee no es evidencia.

## 8. Pasos, con verificación y reversibilidad

**Ventana:** después de que el conductor termine el lunes 17 y antes de las 05:00 del martes 18.
`usePaqueteDia` re-descarga el paquete **en cada montaje** de la pantalla de operación
(`use-paquete-dia.ts:56-60`): parchear la ruta mientras el conductor sigue operando le cambia el
set de puntos a mitad de turno y mezcla dos universos de medición en el día 17.

| # | Paso | Toca prod | Reversible | Verificación |
|---|---|---|---|---|
| 0 | `GET` de ambas geometrías, ambos sets de puntos y la rotación. Guardar los JSON | No | — | `coordinates.length` = 117 y 138 |
| 1 | Armar el circuito localmente. Medir offline los 14 reales contra la nueva `LineString` | No | — | Los 14 dan < 100 m (B9 da 0, es vértice) |
| 2 | `PATCH /v1/rutas/3333…0011` con `geometria` + `sentido: "circuito"` | **Sí** | Sí, re-`PATCH` con el JSON del paso 0 | `GET` devuelve ~260 vértices |
| 3 | `POST …/puntos-control` ×12: recrear los interpolados de `vuelta`, mismas coords, radio 150 | **Sí** | Sí (`estado: inactivo`) | 201 c/u; guardar mapeo de ids |
| 4 | `POST …/puntos-control` ×14: los reales, `obligatorio: true`, radio 150, `orden` en sentido de marcha | **Sí** | Sí (`estado: inactivo`) | 14 × 201. Un 400 = punto a >100 m ⇒ **arreglar la geometría, nunca el validador** |
| 5 | `PATCH /v1/puntos-control/:id { "estado": "inactivo" }` en los no-reales a <150 m de un real | **Sí** | Sí | Cero pares real↔no-real bajo 150 m |
| 6 | E2E como conductor **con un `deviceId` de prueba** | **Sí** (crea fila de sesión) | N/A | El paquete trae la geometría nueva y ~36 puntos |

**No hay punto de no retorno**, y esa es la razón de elegir este diseño. Todo es `PATCH`
reversible o `estado: inactivo`. La ruta `vuelta` **no se toca** y queda como respaldo.

Sobre el paso 6: el cierre de sesiones previas está **scopeado por `deviceId`**, así que un
`deviceId` inventado no le cierra la sesión al conductor — con el real, **sí**. Y como la
asignación del 17 y la del 18 apuntan al mismo `rutaId`, el E2E se puede correr esa misma noche
sin esperar a las 00:00.

**Rollback (< 5 min):** re-`PATCH` de la geometría original con `sentido: "ida"`,
`estado: inactivo` en los ~26 puntos creados, `estado: activo` en los desactivados en el paso 5.

**Riesgo residual, en orden:**
1. Que el conductor arranque **sin señal** y caiga al paquete local del 17, ya vencido → sin puntos
   de control. La traza cruda **sí** se sigue grabando. Mitigación: pedirle que abra la app con
   datos antes de salir.
2. Que el conector aproximado lo desoriente en el mapa. Mitigación: avisarle que ese tramo se
   dibuja recto (OSRM no está desplegado, ya dibuja rectas de todas formas).
3. Que el "36/36 completado" en la vuelta 1 se lea como falla. Mitigación: nota en la planilla.

## 9. Qué NO hacer

1. **No recompilar el APK.** Council unánime; el beneficio del fix lo cubre el replay SQL.
2. **No `anular` la rotación publicada.** Es el único estado del que no se sale solo antes de las
   5 AM. Todo el diseño de §4 existe para no necesitarlo.
3. **No crear una segunda asignación para el 18.** Dispara `seleccion_requerida` y una pantalla
   que el conductor nunca vio, en el peor momento.
4. **No usar `Variante`.** Sin geometría y sin lectura en `paquete-dia`.
5. **No subir `RUTA_PROXIMIDAD_TOLERANCIA_METROS` de 100 a 500 "para que entre B9".** Es cambio de
   código + deploy, y desactiva el guardarraíl para todo el dominio, de forma permanente. Si un
   punto no entra, se corrige la geometría.
6. **No bajar el radio de 150 m porque "ahora los puntos son reales".** El radio se decide **con**
   el replay. Errar por ancho da un falso positivo medible; errar por angosto pierde la pasada para
   siempre — el worker no hace backfill.
7. **No borrar nada.** El dominio es soft-delete por diseño y `SesionOperativa.asignacion` es
   `onDelete: Restrict`.
8. **No regenerar la rotación con `configHorarios`.** Ver §7.
9. **No interpolar puntos nuevos sobre el conector aproximado.**
10. **No tocar `apps/mobile` "ya que estamos".** Un commit ahí invita a recompilar.
11. **No correr el E2E con el `deviceId` real del conductor.** Le cierra la sesión.

**Footgun de formato:** los 14 puntos vienen como `lat,lng`; GeoJSON es `[lon, lat]`
(`packages/shared/src/geo.ts`). Invertirlos deja los puntos en otro continente y el `ST_DWithin`
rechaza todo. No hacerlo a mano a las 2 AM.

## 10. Datos que faltan

| Qué | Quién lo tiene | Bloquea |
|---|---|---|
| Polilínea real del tramo Univalle → Salomón (~2.4 km) con el desvío a B9 | **La traza GPS del día 17** — o el sindicato | El conector de §4. Sin él se va al fallback |
| Confirmación de que B8 = Univalle y B9 = parada temporal de Salomón | Sindicato | El etiquetado; la geometría no |
| Si hay puntos de control entre Univalle y Salomón además de B9 | Sindicato | Ese tramo queda sin cubrir |
| Desde dónde sale el vehículo el martes 18 | Sindicato / conductor | Solo el `orden`, no la geometría |

**La mejor fuente del conector es la traza del lunes 17**, no OSM ni el KML. El vehículo va a
recorrer hoy el trazado real completo —incluido el desvío amarillo y la cuadra celeste— con fixes
cada 100-150 m. Eso responde de forma medida lo que hoy hay que suponer: qué corredor usan para
llegar a Salomón, cómo es el desvío exacto, y dónde empalman al salir de Univalle.

**Fallback si la traza del 17 no sirve:** cadena de 4-5 vértices
`fin_de_Univalle → B8 → B9 → A1`. Es una poligonal que corta manzanas, pero el mapa del conductor
ya dibuja rectas (OSRM no está desplegado), no hay detector de desvío corriendo, y la traza cruda
sigue siendo la fuente de verdad. El costo es cosmético y de un día.

---

## Referencias de código

| Qué | Dónde |
|---|---|
| El paquete trae los puntos de una sola `rutaId`, filtrando `estado` | `apps/api/src/modules/tracking/paquete-dia.service.ts:61-68` |
| `PATCH` de geometría y su única validación (`ST_IsValid`) | `apps/api/src/modules/rutas/rutas.service.ts:107-114` |
| Guardarraíl de 100 m | `apps/api/src/common/geo/proximidad-ruta.ts` |
| El login exige rotación `publicada`; cierre de sesión scopeado por `deviceId` | `apps/api/src/modules/auth-movil/auth-movil.service.ts:429` |
| Detección por proximidad, sin `orden` | `apps/mobile/src/gps/geofence.ts:16-24` |
| Detección una sola vez por sesión | `apps/mobile/src/gps/geofence.ts:47-49` |
| `stop()` desactiva `startOnBoot` | `apps/mobile/src/gps/headless-task.ts:98-104` |
| El paquete se re-descarga en cada montaje | `apps/mobile/src/features/operacion/use-paquete-dia.ts:56-60` |
| `orden` alimenta solo el indicador "próximo punto" | `apps/mobile/src/features/operacion/proximo-punto-control.ts:9` |
| El worker revalida por distancia, no por orden | `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts:309-319` |
