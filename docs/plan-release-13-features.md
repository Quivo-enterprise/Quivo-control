# Plan — Release 13: "Empezar día", vecinos de ruta (delante/detrás) y modo navegación (Google, sin Leaflet)

> **Estado:** aprobado por el CTO el 2026-10-10. PR 0 mergeado (#110). En curso: PR 1+2 (shared + API A, juntos: ver nota en la secuencia) y móvil C1.

> El plan de saneamiento anterior ya vive en `docs/plan-saneamiento.md`. Este archivo pasa a ser el plan de features del release.

## Contexto

El CTO quiere 3 features para el próximo APK antes de portar el fix #109 al spike y compilar:

- **A. Empezar día.** Un botón previo a "COMENZAR RUTA" (en la UI se llama así, no "Iniciar recorrido"). El chofer declara que hoy trabaja, a cualquier hora. El delegado ve quién empezó. Recién después aparece COMENZAR RUTA.
- **B. Delante/detrás.** Muestra qué vehículo va delante y cuál detrás en mi ruta, con placa.
- **C. Modo navegación.** Al tocar COMENZAR RUTA, la vista pasa a navegación estilo Google Maps: heading-up, inclinada, siguiendo al vehículo y con zoom.

**Decisiones del CTO (2026-10-10):**
- Delegado = cuenta `admin_sindicato` en el panel web. No hay rol nuevo.
- "Empezar día" guarda **solo la declaración y la hora**. Sin ubicación y sin tocar el GPS.
- **El motor Google (react-native-maps) pasa a producción y Leaflet se borra por completo del móvil.** Esto cierra la decisión S2.
- **Sin foto de vehículo en v1.** Se dibuja una silueta con el color y el modelo que ya existen en `Vehiculo`.

**Objeciones registradas (regla 0, dichas una vez):**
1. Esto toca el núcleo móvil (flujo de recorrido, outbox, mapa) antes de validar release 12 en calle. La licencia de Transistorsoft vence el 2026-10-25. Mitigación: no se modifica `use-gps-operativo.ts`; las features se montan encima.
2. **Borrar Leaflet elimina el respaldo para teléfonos sin Google Play Services** (Huawei y otros sin GMS): en ellos el mapa queda en blanco. Hay que verificar que **todos** los teléfonos del piloto tengan GMS antes del release.
3. Un "delante/detrás" basado en posición en vivo hereda el desfase de ingesta (p95 ~12 min) y puede estar viejo. Por eso la UI siempre muestra "hace N min" y oculta datos más viejos que el umbral.

## Hallazgos de la exploración que fijan el diseño

- **Eventos.**
  - `packages/shared/src/sync/evento.ts` define `TipoEventoSyncSchema`, que es un enum cerrado.
  - En el worker, `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts` tiene `agruparPorTipo` (:316) con claves fijas.
  - `inicio_recorrido`, `fin_recorrido` y `observacion` caen en `insertarEventoOperativoEnTx` (:588) y se guardan en `eventos_operativos`.
  - `RECORRIDO_ESTADO_POR_TIPO` (:567) mapea el tipo de evento a `recorridoEstado`.
- **Hueco existente.** El worker no verifica que `payload.sesionId` pertenezca al dispositivo autenticado.
- **No hay cálculo de progreso sobre la ruta** (no se usa `ST_LineLocatePoint`). Las posiciones están en `gps_sesion_resumen`. El endpoint en vivo solo es para staff (`@Roles('admin_quivo','admin_sindicato')`).
- **`Asignacion.orden` no es orden de salida.** Ese dato es `horaSalida`, y es opcional.
- **Móvil.**
  - El estado del recorrido es el booleano `tracking` de `useGpsOperativo`.
  - Los botones están en `next-control-sheet.tsx:107-128`; `canStart` se calcula en `operation-screen.tsx:475`.
  - `DriverRouteCard` está definido dentro de `operation-screen.tsx` (:630).
  - El flanco de `tracking` ya existe en `operation-screen.tsx:177`.
- **Spike (`origin/spike/ubicacion-fluida`).**
  - `route-map-native.tsx` (553 líneas) usa la misma interfaz `RouteMapViewProps` y cámara heading-up con `animateCamera`. Le falta `pitch`.
  - `movimiento/camara-seguimiento.ts` tiene `ZOOM_SEGUIMIENTO = 17`.
  - La API key `GOOGLE_MAPS_ANDROID_API_KEY` solo está en el entorno EAS `preview`.
- **Leaflet en el móvil:**
  - archivos: `route-map-html.ts` (997), `route-map-html.test.ts` (1536), `leaflet-inline.generated.ts`, `route-map-view.tsx`, `route-map-protocol.ts`, `reconexion-detector.ts`;
  - script `scripts/generar-leaflet-inline.mjs`;
  - dependencias `leaflet` y `react-native-webview`, que solo usa el mapa.
- El panel web ya usa MapLibre. Lo único que menciona Leaflet ahí es un comentario viejo en `packages/design-system/src/ui/RouteMap.tsx:10`.
- **Helper de jornada boliviana:** `apps/api/src/common/tiempo/jornada.ts`, solo del lado API.
- El panel no tiene rol delegado ni foto de vehículo. La única subida de imagen es el logo de línea, guardado en disco efímero.

## Arquitectura (DRY y por feature)

```
packages/shared/src/
  tiempo/jornada.ts            ← NUEVO: jornada America/La_Paz (movido desde api; api re-exporta) — Fase 3.1 adelantada, solo lo necesario
  sync/evento.ts               + 'inicio_jornada' + PayloadInicioJornadaSchema {sesionId}
  sync/vecinos-ruta.ts         ← NUEVO: VecinosRutaQuerySchema (lat/lng con rangos), VecinoRutaSchema, VecinosRutaSchema
  entities/jornada.ts          ← NUEVO: EstadoJornadaSchema ('sin_iniciar'|'dia_iniciado'|'en_recorrido'|'finalizado'), JornadaVehiculoSchema
apps/api/src/modules/
  ingesta-worker/              + rama inicio_jornada (reusa insertarEventoOperativoEnTx; NO toca recorridoEstado)
  reportes/jornadas.service.ts + jornadas.controller.ts   (no engordar en-vivo.service.ts)
  tracking/vecinos-ruta.service.ts + vecinos-ruta.controller.ts   (junto a paquete-dia/ruteo, endpoints móviles)
apps/web/
  app/(dashboard)/en-vivo/panel-jornada.tsx       ← NUEVO (al lado de panel-frescura.tsx)
  src/lib/en-vivo/use-jornadas.ts + src/lib/api/en-vivo.ts (+jornadasApi)
apps/mobile/src/
  features/jornada/            fase-control.ts (puro) · jornada-store.ts · use-jornada.ts · *.test.ts
  features/vecinos-ruta/       use-vecinos-ruta.ts · vecinos-ruta-card.tsx · silueta-vehiculo.tsx · color-vehiculo.ts (puro) · tests
  features/mapa/               route-map.tsx (motor Google, único) · modo-camara.ts (máquina de estados pura) · camara.ts (puro) · estado-punto-control.ts (puro) · tipos.ts · tests
  features/operacion/          driver-route-card.tsx (extraído de operation-screen) ; operation-screen solo compone
  shared/api/vecinos-ruta-api.ts
```

**Reglas:**
- Los contratos viven en `shared` y se validan con Zod en los dos lados.
- La lógica va en funciones puras con test, y los hooks quedan finos.
- `operation-screen.tsx` no crece: solo compone.
- `use-gps-operativo.ts` y `outbox.ts` no se modifican; solo se consume `tracking` y se usa `encolarEvento`.
- `movimiento/` no se mueve: es núcleo y moverlo sería churn.

## Diseño por feature

### A — Empezar día
- **Evento `inicio_jornada`** con payload `{sesionId}`, encolado con `encolarEvento` y `generarEventId`. Funciona offline gracias al outbox.
- **Worker:**
  - Agrega la rama a `agruparPorTipo` y a `operativos`.
  - **Valida que `sesion.deviceId === evento.deviceId`** para este tipo; si no coincide, va a `sync_errors`.
  - No toca `RECORRIDO_ESTADO_POR_TIPO`.
- **Persistencia en servidor:** se reutiliza `eventos_operativos`, sin tabla nueva. La migración solo agrega el índice `(sindicatoId, tipo, ts)`.
- **Lectura:** `GET /v1/reportes/jornadas?fecha=` con `admin_quivo` y `admin_sindicato`.
  - Toma las asignaciones del día (Bolivia) y les une la última declaración de cada vehículo más el `recorridoEstado` de la sesión.
  - Devuelve `estado` (`sin_iniciar` / `dia_iniciado` / `en_recorrido` / `finalizado`), `inicioJornadaTs`, placa, número interno, conductor, línea, sentido y `horaSalida`.
  - RLS por `sindicatoId`. Las declaraciones duplicadas se resuelven con `DISTINCT ON`.
- **Web `/en-vivo`:** panel "Jornada de hoy" en el HUD, colapsable, agrupado por estado, con "empezó hace X". Respeta el filtro de línea existente y refresca cada 30 s.
- **Móvil:**
  - `jornada-store` persiste `{vehiculoId, conductorId, jornada, ts}` en un almacenamiento clave-valor local. Antes de implementar hay que verificar cuál existe (AsyncStorage o una tabla kv en el SQLite). Si no hay ninguno, se crea un módulo `db/estado-local.ts` aparte que use la misma DB, sin tocar `outbox.ts`.
  - La función pura `faseControl({jornadaIniciada, tracking})` devuelve `'jornada' | 'listo' | 'recorrido'`. **`tracking` manda:** si ya hay un recorrido re-enganchado sin declaración (sesiones de antes de la actualización), se muestra FINALIZAR.
  - `next-control-sheet.tsx` recibe `fase` en vez de solo `tracking`. "EMPEZAR DÍA" no depende de `canStart` (no necesita permiso de GPS).
- **Reinstalar la app el mismo día** hace reaparecer el botón. Volver a declarar es inocuo porque el servidor deduplica. Que el paquete del día traiga la jornada ya iniciada queda para una versión 2.

### B — Delante/detrás (sin foto)
- **Criterio:** posición en vivo a lo largo de la ruta.
  - Solo cuentan los vehículos con el mismo `rutaId`, es decir el mismo sentido. El `rutaId` sale de la asignación de la sesión, nunca del cliente.
  - La sesión tiene que estar en `recorridoEstado='en_curso'`.
  - El último fix tiene que tener como máximo `UMBRAL_VECINO_FRESCO` (10 min, constante en `shared`).
- **Endpoint:** `GET /v1/mobile/vecinos-ruta?lat&lng` con `AuthMovilGuard` y throttle.
  - `lat`/`lng` son opcionales, con rangos validados en Zod (evita el bug de `Number('')`). Son mi posición en vivo; si no vienen, se usa mi fila de `gps_sesion_resumen`.
  - SQL:
    - `ST_LineLocatePoint(ruta.geometria::geometry, punto)` para cada vehículo del mismo `rutaId`.
    - **delante** = el menor `frac` que sea mayor que el mío; **detrás** = el mayor `frac` que sea menor que el mío.
    - `distanciaM = Δfrac × ST_Length(geometria::geography)`.
  - **Caché en memoria por `rutaId`** de 15 s con las fracciones de toda la ruta. Cada request solo elige los vecinos de esa lista, así hay una consulta por ruta y no una por request.
- **Privacidad:** el endpoint **no devuelve lat/lng ni el nombre del conductor de los pares**. Solo placa, número interno, tipo, marca, modelo, color, color secundario, `distanciaM` y `edadFixS`.
- **Limitación documentada:** en rutas circulares, donde inicio ≈ fin o la línea se cruza consigo misma, `ST_LineLocatePoint` puede proyectar al tramo equivocado. Lleva tests con fixtures. En v2 se puede desempatar con el último punto de control cumplido.
- **Móvil:**
  - `use-vecinos-ruta` consulta cada 30 s solo con `tracking` activo y la app en primer plano. Se pausa offline y muestra el último dato con su edad.
  - La tarjeta tiene dos filas: "▲ Delante · 1234-ABC · #12 · 850 m · hace 1 min" y "▼ Detrás …". Si no hay nadie, dice "Nadie delante en tu ruta".
  - `silueta-vehiculo.tsx` usa `react-native-svg` (ya instalado) con el color de `color-vehiculo.ts`, que mapea nombre a hex con un default.

### C — Modo navegación + motor Google único
1. **Promover el motor:**
   - Del spike se traen `route-map-native.tsx` (pasa a `features/mapa/route-map.tsx`), `camara-seguimiento.ts` (se integra en `features/mapa/camara.ts`), `react-native-maps@1.20.1`, `config.googleMaps.apiKey` en `app.config.ts` y `env-publico-literal.test.ts`.
   - **No se traen:** `spike-motor-mapa.ts`, el FAB de cambio de motor, `SpikeMetricsOverlay` ni el plugin `withAndroidSpikeDebugEmbed`.
   - El tipo `PosicionMapaProtocolo` pasa a `features/mapa/tipos.ts`.
2. **Matriz de paridad, antes de borrar nada.** Cada comportamiento de `route-map-html.ts` se marca como portado, cubierto por el SDK o descartado (con su motivo):
   - colores de ruta en espera y en seguimiento;
   - puntos de control numerados y su estado pasado (se extrae `isPassed` a `estado-punto-control.ts`, puro, con test);
   - resaltado de `proximoPuntoControl`;
   - tramo OSRM (`rutaCalculada`);
   - encuadre inicial de la ruta (`fitToCoordinates`, que reemplaza a `fitBounds`);
   - recentrar;
   - halo de precisión;
   - atenuado cuando el fix está `obsoleto`;
   - flecha o punto según haya rumbo;
   - reconexión (`reconexion-detector.ts`: si solo servía para recargar los tiles del WebView, se borra).
   - Los tests de `route-map-html.test.ts` que expresan reglas de negocio se portan como tests de funciones puras; el resto muere con el HTML.
3. **Modo navegación.**
   - `modo-camara.ts` es un reducer puro con tests.
     - Estados: `general` (encuadre de la ruta, norte arriba, pitch 0), `navegacion` y `libre`.
     - Eventos: `iniciarRecorrido`, `finalizarRecorrido`, `panUsuario`, `recentrar`.
     - Entra a `navegacion` en el flanco false→true de `tracking`. Con un pan pasa a `libre` y aparece el FAB "Recentrar". Al finalizar vuelve a `general`.
   - `camara.ts` construye `{center, heading, pitch: 55, zoom: 18}`. El vehículo queda en el tercio inferior, con `mapPadding` inferior igual a la altura del sheet o un centro desplazado hacia adelante según el rumbo.
   - Mientras `navegacion` está activo, el sheet se colapsa a `snapOffset` y la tarjeta del conductor se compacta, para que el mapa ocupe la pantalla.
4. **Fluidez.** La navegación necesita el canal visual a 1 Hz, así que se activa `EXPO_PUBLIC_GPS_CANAL_VISUAL=1` en el perfil `production`.
   - **Gate:** el fix #109 tiene que estar verificado en teléfono antes. Hoy está **no verificado**.
5. **Borrar Leaflet:**
   - archivos `route-map-html.ts` y su test, `leaflet-inline.generated.ts`, `route-map-view.tsx` y `route-map-protocol.ts`;
   - el script `generar-leaflet-inline.mjs` y el comando `generar:leaflet-inline` de `package.json`;
   - las dependencias `leaflet` y `react-native-webview`, tras un grep que confirme que no tienen otro uso;
   - el comentario viejo del design-system.
   - Después del merge, la rama del spike queda reemplazada. Su perfil EAS `spike` se borra en un PR posterior.
6. **Infra (cara afuera; el CTO confirma antes):**
   - `GOOGLE_MAPS_ANDROID_API_KEY` en el entorno EAS `production`.
   - Restringir la key al paquete y al SHA-1 del keystore de producción.
   - Verificar en la consola de facturación que la carga de mapas dinámicos del SDK nativo de Android es $0. Está **no verificado**.
   - Verificar que todos los teléfonos del piloto tengan GMS.

#### C2 — decisiones de implementación (2026-10-11)

- **El estado vive en la pantalla, no en el mapa.** `use-modo-camara.ts` (hook fino sobre el reducer puro `modo-camara.ts`) se usa en `operation-screen.tsx`, porque la pantalla necesita el modo para el FAB y para el sheet. `RouteMap` recibe `camara` (`{modo, accion, seq}`) y `onPanUsuario`, y reemplaza a `recenterTick`.
- **Reducer.** El estado es `{modo, accion, seq}`. `seq` sube solo cuando hay que mover la cámara. Si un evento no cambia nada, el reducer devuelve **la misma referencia**, así `onPanDrag` (que dispara muchas veces por gesto) no re-renderiza.

  | Estado + evento | Resultado | Acción de cámara |
  |---|---|---|
  | `general`/`libre` + `iniciarRecorrido` | `navegacion` | `seguir` |
  | cualquiera + `finalizarRecorrido` | `general` | `encuadrar` |
  | `navegacion` + `panUsuario` | `libre` | ninguna |
  | `libre` o `navegacion` + `recentrar` | `navegacion` | `seguir` |
  | `general` + `recentrar` | `general` | `encuadrar` |

  El estado inicial sale de `tracking` al montar: un remount en pleno recorrido arranca en `navegacion`.
- **Encuadre de `general`:** ruta + posición del vehículo, si se conoce (antes el vehículo podía quedar fuera del encuadre al estar lejos del inicio). `fitToCoordinates` (`newLatLngBounds`) ya deja norte arriba y pitch 0; un `setCamera` previo solo agregaba un salto.
- **Cámara de navegación:** `{center, heading, pitch: 55, zoom: 18}` en **cada** actualización. Cualquier gesto pasa a `libre` (`onPanDrag`, y además `onRegionChangeStart` con `isGesture`, porque en Android el pinch y el doble toque no disparan `onPanDrag`), así que no hay pinch que respetar y desaparece `zoomPendienteRef`.
- **Vehículo en el tercio inferior** con `mapPadding`, calculado por la función pura `paddingNavegacion({alto, insetSuperior, insetInferior})`. El objetivo de cámara cae a 2/3 de la banda visible entre la tarjeta superior y el sheet colapsado. El padding se aplica en `navegacion` y en `libre`; en `general` vale cero, porque `fitToCoordinates` ya usa `PADDING_ENCUADRE_RUTA`.
- **Desfase entre el easing de Google y la interpolación lineal (diferido de C1).** En `navegacion`, la cámara deja de usar `animateCamera` por fix: se mueve con `setCamera` **en el mismo tick del RAF** que publica el marcador, con la misma coordenada y el mismo rumbo interpolados, a ~30 Hz, y por eso no puede haber desfase.
  - La entrada a `navegacion` y el recentrar usan `animateCamera` (700 y 400 ms). Durante esa ventana se suspende el `setCamera` por frame. Puede quedar un salto chico al terminar la ventana, igual a lo que avanzó el vehículo en ese tiempo.
  - Un cambio de `mapPadding` (Android hace `moveCamera`) cancela la animación de entrada. Por eso, tras cada cambio de padding y al vencer la ventana, la cámara se re-sincroniza con la posición mostrada.
  - **Riesgo:** `newArchEnabled: false`. Cada frame manda por el bridge el marcador y la cámara, y cada `moveCamera` devuelve `onRegionChangeStart`/`onRegionChange`/`onRegionChangeComplete`: unos 3 a 5 mensajes por frame a ~30 Hz. Hay que medirlo en un teléfono gama baja del piloto. **No verificado en dispositivo.**
- **Sheet colapsado:** fuera de `general` (navegación y libre), `NextControlSheet` se colapsa a `snapOffset` (prop controlada `colapsado`), y el chofer lo puede expandir a mano. Se corrige el closure viejo de `minimized` dentro del `PanResponder`, que se crea una sola vez.
- **FAB de cámara:** oculto en `navegacion`. En `libre` dice "Recentrar" y vuelve a navegación; en `general` dice "Ver ruta completa" y encuadra.
- **Fuera de C2:** la tarjeta del conductor compacta durante la navegación va con A (PR 8), junto con la extracción de `DriverRouteCard` y la pill del comp A.

### UI (reglas 7 y 12)
- **Un solo bake-off móvil**, no tres, que cubre los estados de `operation-screen`:
  1. día sin iniciar (EMPEZAR DÍA);
  2. listo (COMENZAR RUTA);
  3. navegación con la tarjeta de vecinos;
  4. sin vecinos.
- Hay 2 comps HTML en marco de teléfono: A = taste-skill (`redesign-existing-projects`), B = `impeccable`. Se publican como Artifacts y elige el CTO.
- **Decisión del CTO (2026-10-10): comp A.** Referencia versionada en
  [`docs/diseno/release-13-comp-a-operacion.html`](diseno/release-13-comp-a-operacion.html).
  Al implementarlo en RN se toman de A:
  - la tarjeta de vidrio, la píldora "Día iniciado HH:MM" y COMENZAR RUTA bloqueado con candado
    en el estado 1;
  - el panel de vecinos arriba, con chevron, silueta teñida, placa y `#nn`, la distancia en
    Oxanium y la antigüedad;
  - la tira compacta con FINALIZAR RUTA en contorno.

  Hay dos ajustes respecto del comp:
  - en navegación, el próximo control tiene que verse sobre el mapa y no quedar tapado por el
    panel de vecinos;
  - la nota "comp:" junto a Recentrar no va en la app.
- El panel web de jornada va por camino único (`impeccable shape`), con verificación en Playwright y el gate `web-design-guidelines`.

## Secuencia de PRs (cada uno: Sonnet implementa, el chairman revisa y verifica, gates, CI, merge, handoff)

| # | PR | Gates extra |
|---|---|---|
| 0 | docs: este plan en `docs/plan-release-13-features.md` + ADR "motor de mapa: Google, Leaflet retirado" (cierra S2) + puntero en el handoff | solo docs |
| 1 | shared (va junto con el PR 2: agregar `inicio_jornada` al enum sin el worker hace que la API acepte y confirme eventos que nunca persiste): `tiempo/jornada.ts` (la API re-exporta), `inicio_jornada` + payload, schemas de vecinos y jornada + tests | `/code-review` |
| 2 | API A: rama del worker + chequeo de dispositivo + migración del índice + endpoint de jornadas + tests | `/security-review` |
| 3 | API B: endpoint de vecinos + caché + tests SQL con fixtures (lineal, circular, sin pares, fix viejo) | `/security-review` |
| — | **Deploy de la API** (antes de cualquier APK: un worker o controller viejo rechaza el lote entero por el enum de Zod y **traba el outbox**) | CTO confirma el deploy |
| 4 | Web A: `panel-jornada` en `/en-vivo` | Playwright + `web-design-guidelines` |
| 5 | Bake-off de comps móviles, el CTO elige | — |
| 6 | Móvil C1: motor Google único + matriz de paridad + borrado de Leaflet y WebView | `/code-review`, dispositivo |
| 7 | Móvil C2: `modo-camara` + `camara` + layout de navegación | dispositivo |
| 8 | Móvil A: `features/jornada` + fase del sheet + extracción de `DriverRouteCard` | dispositivo |
| 9 | Móvil B: `features/vecinos-ruta` + tarjeta y silueta | dispositivo |
| — | Changelog al CTO (memoria apk-build-11), el CTO decide, recién ahí build EAS `production` (consume créditos; se pregunta antes) | — |

El orden C antes que A y B en el móvil es a propósito: el borrado de Leaflet cambia la pantalla donde viven las otras dos, y así se evita hacer rebase dos veces.

## Trampas

- **Orden de deploy: primero la API, después el APK.** Un APK nuevo contra una API vieja manda `inicio_jornada`, recibe 400 y el outbox queda bloqueado.
- **`agruparPorTipo` tiene claves fijas.** Si falta la clave, TypeScript avisa, pero hay que cubrirlo con un test del worker.
- **Fecha de la jornada:** se usa el helper IANA de `shared` en los dos lados. Nada de `new Date().toDateString()`.
- **react-native-maps en Android:** `tracksViewChanges` en los marcadores, ya resuelto en el spike con `useTracksViewChanges`; hay que conservarlo.
- **`onPanDrag` solo se dispara con gestos del usuario.** Es la base para pasar de `navegacion` a `libre`; `animateCamera` no lo dispara.
- **El canal visual de producción depende de #109.** Sin verificación en teléfono no se activa el flag y la navegación usa los fixes de evidencia (menos fluida, pero sin crash).
- **El pin del Maps SDK al keystore:** si el SHA-1 de la key no coincide con el de producción, el mapa sale en blanco y sin error visible. Se verifica en el primer APK.
- **No meter features en el spike.** Todo sale de `main`.

## Verificación

- **Por PR:** `pnpm turbo run typecheck test lint --filter=<paquete>`, más CI verde (ci + acceptance).
- **Shared:** tests de Zod de los payloads y de la query (rangos, `''` rechazado).
- **API:**
  - test del worker: `inicio_jornada` cae en `eventos_operativos`, no cambia `recorridoEstado`, y un `deviceId` ajeno va a `sync_errors`;
  - tests SQL de vecinos con fixtures en la DB de CI;
  - `curl` del endpoint con un token móvil, verificando que no viajan lat/lng de los pares.
- **Web:** Playwright sobre `/en-vivo` con una jornada sembrada, y captura para el CTO.
- **Móvil (MCP `mobile`, dispositivo o emulador con Play Services):**
  - flujo EMPEZAR DÍA → COMENZAR RUTA → la cámara entra en navegación (heading-up y pitch visibles) → pan → Recentrar → FINALIZAR → vuelve a `general`;
  - mandar a segundo plano con el recorrido activo, sin crash (regresión #109).
- **Calle:** `9001TST` y `9004TST` asignadas a la **misma ruta y sentido**. Cada una tiene que ver a la otra delante o detrás con la distancia coherente. El panel tiene que mostrar las dos como "día iniciado" y luego "en recorrido".
- Todo lo que no se verifique en teléfono se reporta como **no verificado**.

## Backlog v2 (fuera del release 13)

- **Picture-in-Picture en navegación** (pedido del CTO, 2026-10-11): al salir de la app con el recorrido activo, el mapa queda en una ventana flotante, como Google Maps. Es una mejora de UX (el chofer ve la ruta mientras usa otra app), no un fix: la captura en segundo plano ya la cubre Transistorsoft. Requiere:
  - `supportsPictureInPicture` + entrada en `onUserLeaveHint` / `setAutoEnterEnabled` (config plugin + módulo nativo);
  - un layout PiP propio (solo el mapa y el próximo punto de control);
  - revisar el canal visual. Hipótesis no verificada: RN reporta `AppState` `background` en PiP y el canal visual se apagaría.
- **Desempate en rutas circulares** para vecinos (último punto de control cumplido).
- **Jornada ya iniciada en el paquete del día** (que reinstalar la app no vuelva a pedir EMPEZAR DÍA).
