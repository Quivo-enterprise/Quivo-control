# Plan: ubicación fluida del conductor (tipo Google Maps) + estado "Finalizado" en el panel + pruebas en calle

Se persiste a `docs/plan-ubicacion-fluida.md` con puntero en `docs/handoff.md` antes de tocar código (regla 8).

## Contexto

Prueba en casa con el RC del build 11 (versionCode 12):
- La flecha casi no giró y no siguió la orientación del celular.
- Tras "Finalizar", `/en-vivo` seguía en verde "Reportando" y el contador "hace N min" seguía subiendo.

Causas verificadas en el código:

1. **Flecha y posición.**
   - `route-map-html.ts:935-954`: el marcador salta con `setLatLng`, sin interpolación.
   - El ícono se reconstruye en cada fix con `setIcon`. El nodo del DOM se reemplaza, así que la transición CSS de rotación no se aplica.
   - El rumbo es el bearing entre los dos últimos fixes (`calcHeading`). Ignora `coords.heading` (rumbo GPS por Doppler), que el SDK ya entrega.
   - La cámara hace `flyTo` (alejar y acercar) en cada fix.
   - Solo llegan fixes cada 15 m (`distanceFilter: 15`) o en el heartbeat de 60 s. Caminando en casa casi no hay fixes. En vehículo, a velocidad urbana, llega uno cada ~1–4 s.
   - La flecha nunca usa la brújula.
   - `route-map-view.tsx:96-102`: en cada fix reenvía todo el estado, incluidas las coordenadas de `ruta-calculada`.
2. **Panel.**
   - `clasificarFrescura` (`en-vivo.service.ts:161-175`) mira solo la antigüedad del fix y de la ingesta.
   - `fin_recorrido` llega al servidor, pero `ingesta-worker.service.ts:550-573` lo guarda solo como bitácora (`eventos_operativos`) y nadie lo lee.
   - `SesionOperativa` es la sesión de login: su `fin` solo cambia con logout.
   - Resultado: el panel muestra "Reportando", luego "Detenido" y a los 15 min "Sin señal" (rojo). Un cierre correcto aparece como falla.

Decisiones del CTO en esta sesión:
- **Rumbo:** rumbo GPS con histéresis; detenido, se mantiene el último rumbo. Sin brújula.
- **Mapa heading-up:** sí le gusta. Preguntó si conviene pasarse entero a Google Maps.

Respuesta verificada:
- Maps SDK for Android (Mobile Native Dynamic Maps) es de uso gratis e ilimitado.
- Estar en GCP no cambia nada: es otro producto facturado aparte.
- Navigation SDK y Routes sí se cobran y no hacen falta: seguimos con OSRM.

Qué se gana al pasar a Google nativo:
- Heading-up y animaciones nativas, fluidas y baratas.
- Sin WebView.

Qué se paga:
- Reescribir la capa de mapa. Hoy son ~1000 líneas de HTML y 1536 líneas de tests que quedarían obsoletas.
- Una dependencia nativa nueva (`react-native-maps`).
- Una API key restringida por paquete y SHA-1.
- Depende de Google Play Services.
- Offline: no hay descarga de mosaicos para terceros, solo caché.

Por eso la elección de motor pasa por un spike con criterios medibles (Fase C). No se decide a ciegas.

## Límites honestos (no vamos a igualar Google 1:1)

- Google fusiona FLP a menos de 1 s con su Fused Orientation Provider. Nosotros mostramos una estimación interpolada entre fixes reales: hay ~1 s de retraso visible y las curvas se ven suavizadas.
- No habrá snap-to-road en esta entrega.
  - Las líneas de trufi van y vuelven por la misma calle o por calles paralelas: el snap puede pegar el punto al sentido o a la calle equivocada.
  - Se reevalúa solo si la ronda 2 en calle muestra deriva fuera de la vía.
- No habrá dead reckoning (extrapolar sin fix): deriva en curvas.
- La evidencia no cambia: `distanceFilter: 15` sigue igual. Lo visual es un canal aparte y no puede inflar `gps_points`.

---

## Fase A: estado "Finalizado" en el panel (servidor + web, sin APK)

Va primero. Sirve también para el build 11 en manos de los conductores, porque la app ya envía `fin_recorrido` (`use-gps-operativo.ts:1388`).

**Modelo.** Migración aditiva en `sesiones_operativas`:
- `recorrido_estado text NULL`, con valores `'en_curso' | 'finalizado'`.
- `recorrido_estado_ts timestamptz NULL`.

Backfill en la misma migración: último evento `inicio_recorrido`/`fin_recorrido` por sesión, con `DISTINCT ON (sesion_id) ORDER BY ts DESC`.
- Se usan columnas desnormalizadas en lugar de un LATERAL sobre `eventos_operativos` porque `obtenerPosiciones` corre cada 5 s con hasta 500 sesiones. El LATERAL exigiría un índice nuevo sobre una tabla que crece.
- No se toca `fin`/`estado` (esos son del login).

**Worker** (`ingesta-worker.service.ts`, en la misma tx que `insertarEventoOperativoEnTx`), si el tipo es inicio o fin:

```sql
UPDATE sesiones_operativas SET recorrido_estado = $1, recorrido_estado_ts = $ts
WHERE id = $sesionId AND sindicato_id = $sid
  AND (recorrido_estado_ts IS NULL OR recorrido_estado_ts < $ts)
```

El guard por `ts` es idempotente y aguanta sync fuera de orden.

**API** (`en-vivo.service.ts`):
- `listarHoy`, `obtenerPosiciones` y `obtenerTraza` seleccionan las dos columnas.
- `derivarFrescura` devuelve `'finalizado'` si se cumplen las dos condiciones:
  - `recorrido_estado = 'finalizado'`;
  - `ultimoFixTs` es nulo o `ultimoFixTs <= recorrido_estado_ts + 5 s`.
- Si hay fixes posteriores al fin, se clasifica como hoy (defensivo: algo sigue grabando).
- Se expone `recorridoFinTs`.
- Un `inicio_recorrido` posterior vuelve la sesión a vivo.

**Shared:** agregar `'finalizado'` a `EstadoFrescura` y el campo `recorridoFinTs?: string | null`.

**Web:**
- `PRESENTACION_FRESCURA` (`traza.ts:255-281`) suma "Recorrido finalizado": neutro, `esFalla: false`.
- `panel-frescura.tsx` muestra "Finalizó hace X".
- `intervaloPoll`: con `finalizado` primero termina de traer las páginas pendientes (`hayMas`) y después consulta cada 60 s. No corta el poll, para detectar un `inicio_recorrido` nuevo en la misma sesión de login. (Cambio respecto del diseño original, a raíz de la revisión.)
- En el mapa, el marcador pasa a gris.

**Trampa de deploy:**
- Si la API emite `'finalizado'` antes de que la web lo conozca y la web valida la respuesta con zod, falla.
- Verificar el orden en `scripts/deploy-gcp.sh`.
- **HECHO:** la web tolera estados desconocidos (`presentacionFrescura` cae a `sin_datos`; el sprite del mapa cae a `detenido`).
- **Orden obligatorio de ESTE deploy:** 1) `scripts/deploy-gcp.sh --solo web` (la web nueva funciona contra la api vieja); 2) `scripts/deploy-gcp.sh` completo (migración con backfill, api, worker). Al revés, el bundle web viejo, que no conoce `finalizado`, rompe `/en-vivo` durante la ventana del deploy.
- **Otras defensas del worker:** actualiza el estado solo si el evento se insertó (un duplicado no lo toca), atado a `sindicatoId` + `deviceId` autenticados, y omite el UPDATE si el `ts` del evento viene del futuro por encima de `DRIFT_ALERTA_MS`.
- **Deuda (fuera de alcance):** la API acepta eventos operativos con un `payload.sesionId` que no valida contra el dispositivo; solo el estado derivado está protegido.

**Tests:**
- `en-vivo.service.test.ts`: casos finalizado, re-inicio, fix posterior al fin, sesión sin eventos.
- Test del worker: guard fuera de orden e idempotencia.
- `traza.test.ts`: presentación e `intervaloPoll`.
- `en-vivo.resumen-equivalencia.test.ts` sigue verde.

**Cierre:**
- `/code-review` + `/security-review` (toca ingesta, RLS y API) + `/codex-debug verify-fix`.
- PR, CI, merge.
- El CTO despliega con `deploy-gcp.sh` y la migración va por el Job.

## Fase B: núcleo de movimiento (TS puro, independiente del motor de mapa)

Módulo nuevo, p. ej. `apps/mobile/src/features/operacion/movimiento/`, con funciones puras y testeadas:

- **`seleccionarRumbo(fix, previo)`:**
  - Usa `coords.heading` si `heading >= 0` y `heading_accuracy` no supera 45° (cuando viene).
  - Histéresis: entra al rumbo de curso con speed ≥ 2.0 m/s y sale por debajo de 1.0 m/s.
  - Fallback: bearing de dos puntos si el desplazamiento supera `max(10 m, accuracy)`.
  - Si no, conserva el último rumbo.
  - Sin rumbo válido aún: `null`, y se dibuja un punto sin flecha.
- **Anti-jitter:** con speed < 0.5 m/s y desplazamiento menor que `accuracy`, la posición mostrada no se mueve.
- **Interpolación:**
  - Duración = Δt entre fixes, acotado a 300–2500 ms. Si el hueco supera 5 s, 500 ms.
  - El ángulo gira por el arco más corto (cruzando ±180°).
- **Staleness:** sin fix visual por más de 15 s, el marcador se atenúa (como el punto gris de Google).
- **Halo de precisión:** círculo con radio igual a `accuracy`.

**Canal visual** (condicionado al spike S1):
- `BackgroundGeolocation.watchPosition({ interval: 1000, persist: false, extras: { fuente: 'visual' } })`.
- Solo con `AppState === 'active'` y tracking activo. Se detiene al ir a segundo plano y en `detener()`. El SDK advierte que watchPosition mantiene viva la app en background.
- En `onLocation` (`use-gps-operativo.ts:290`), si `location.extras?.fuente === 'visual'`: se alimenta solo el store visual y se hace `return`, antes de `registrarPuntoGps`.
  - Es crítico: hoy todo fix se vuelve un `gps_point` sin filtro (`location-task.ts:181-215`).
- Store visual: un emisor mínimo o `useSyncExternalStore`, consumido solo por el mapa, para que `operation-screen` no se re-renderice a 1 Hz.
- Los fixes de evidencia también alimentan el store.

**Spike S1** (dev build: el SDK de Transistorsoft es gratis en DEBUG, no requiere la licencia paga). Verificar con logs:
- (a) los fixes de watch llegan a `onLocation` con `extras`;
- (b) `BackgroundGeolocation.getCount()` no sube;
- (c) los `gps_point` del outbox no suben;
- (d) la cadencia de evidencia no cambia;
- (e) delta de batería en 30 min.

Si (a) falla o (b)/(c) suben: **plan B**, sin watchPosition. Se interpola solo entre fixes de evidencia; en vehículo llegan cada ~1–4 s y es suficiente. Esto se documenta.

Si el motor sigue siendo Leaflet: en `route-map-view.tsx`, `position` va en su propio efecto y `ruta-calculada`/`tracking`/`proximoPuntoControl` solo cuando cambian.

## Fase C: motor de mapa y heading-up (gate con spike S2)

**Spike S2** (1–2 días, rama descartable, dev build): `react-native-maps` con `PROVIDER_GOOGLE`. Criterios medidos contra el Leaflet actual:

1. **Offline:** empezar con datos, pasar a modo avión y ver si los mosaicos de la zona recorrida siguen visibles. Comparar igual con Leaflet; verificar primero qué proveedor de tiles y qué caché usa hoy.
2. **Fluidez:** FPS y fluidez de `animateCamera({ center, heading })` y de la animación del marcador en el teléfono más barato del piloto.
3. **API key:** restringida a `com.quivotech.conductor.app` + SHA-1 del keystore de EAS. Hay que obtener el SHA-1; hoy solo tenemos el SHA-256 `c6f5…894e`.
4. **Play Services:** confirmar que los equipos del piloto lo tienen.
5. **Costo:** el SKU Mobile Native Dynamic Maps en $0, verificado en la facturación de Cloud tras el spike.
6. **Punto azul nativo:** evaluar `showsUserLocation`, que usa el FLP de Google aparte de la evidencia y evitaría el canal visual de la Fase B. Su haz usa brújula, que el CTO descartó en vehículo; se evalúa igual.

**Decisión** del CTO con los datos. Recomendación previa: C1 si iguala a Leaflet en offline.

- **C1, Google nativo:**
  - Componente `RouteMapNative` que reemplaza `RouteMapView` detrás de un flag `EXPO_PUBLIC_MAPA_MOTOR`, para poder volver atrás.
  - Portar ruta, puntos de control, resaltado OSRM, recentrar y estilos de tracking.
  - Cámara heading-up que sigue al marcador. Un pan manual corta el seguimiento, como hoy con `seguimientoActivo`, y el botón recentrar lo restaura.
  - Marcador animado con el núcleo B.
  - El panel web sigue en Leaflet.
- **C2, Leaflet:**
  - Marcador persistente, rotando el nodo interno sin `setIcon`.
  - Bucle `requestAnimationFrame`.
  - `panTo` sin animación por frame en lugar de `flyTo`.
  - `leaflet-rotate` inline, generado como `leaflet-inline.generated.ts` (script `generar-leaflet-inline.mjs`), con `setBearing`.
  - Extender los tests de `route-map-html.test.ts` (harness `new Function` + fake timers).

**Licencia:** el APK release (build 12, versionCode 13) exige la licencia paga de Transistorsoft (trial vence el 2026-10-25, grace 0). Comprar antes del build release. El desarrollo y los spikes no la necesitan.

## Fase D: pruebas en calle (trasladadas del paso 7 del build 11)

**Prerrequisito:** extender las asignaciones de rotación más allá del 2026-09-29 antes del 30/09. Las pruebas van hasta el 10-10.

**Ronda 1: RC build 11 instalado (gate de distribución del build 11, paso 8)**
1. Pantalla apagada 10 min en movimiento: el marcador avanza en `/en-vivo` y la traza no tiene huecos.
2. Anuncio de punto de control a ~40 m, una sola vez y sin doble sonido.
3. Modo avión 5 min en movimiento: graba; al volver la red, sincroniza y la traza llena el hueco.
4. Sesión revocada desde el panel (Entrega 28): la app sale limpia.
5. Finalizar: tras desplegar la Fase A, el panel muestra "Recorrido finalizado" dentro de ~30 s. Antes de desplegarla, anotar el comportamiento actual como línea base.
6. **Línea base visual:** flecha y movimiento en vehículo con el build actual, para comparar en la ronda 2. Anotar: saltos cada cuántos segundos, rumbo en curvas y comportamiento al detenerse. Anotar también batería al inicio y al final.

**Ronda 2: build 12 (dev build para iterar; release con licencia para cerrar)**
1. Lado a lado con Google Maps en otro teléfono, en trufi.
2. Retraso fix→marcador de ~1.5 s o menos.
3. Rumbo en recta dentro de ~20° de lo real.
4. La flecha no gira sola en semáforos y paradas.
5. En curvas, el rumbo se corrige en ≤2 s.
6. Heading-up estable y sin mareo.
7. Batería en 60 min: delta frente a la ronda 1 dentro de un margen a acordar tras medir.
8. **Evidencia no inflada:** `gps_points` por km del mismo orden que el build 11. SQL de solo lectura por sesión.
9. Repetir los puntos 1–5 de la ronda 1 (regresión).

## Archivos críticos

- **Fase A:**
  - `packages/db/prisma/schema.prisma` + migración nueva
  - `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts`
  - `apps/api/src/modules/reportes/en-vivo.service.ts` y su test
  - `packages/shared` (`EstadoFrescura`)
  - `apps/web/src/lib/en-vivo/traza.ts`
  - `apps/web/app/(dashboard)/en-vivo/panel-frescura.tsx`
  - marcador del mapa web
- **Fase B:**
  - `apps/mobile/src/features/operacion/use-gps-operativo.ts` (`onLocation`, `detener`, montaje)
  - módulo nuevo `movimiento/`
  - `route-map-protocol.ts`: el mensaje `position` suma `heading`, `speed`, `accuracy` y `ts`
- **Fase C:**
  - `route-map-view.tsx`, `route-map-html.ts`
  - o, con C1, componente nativo nuevo + `app.config.ts` (API key vía env de EAS, nunca en el repo) + `package.json`

## Orden y entregables

1. PR docs: persistir este plan y el handoff.
2. PR A (fix del panel). El CTO despliega.
3. Ronda 1 en calle.
4. PR B, núcleo puro con tests.
5. S1 y S2 en dev build; se presentan los datos al CTO.
6. El CTO decide C1 o C2.
7. PR C.
8. Dev build y ronda 2.
9. Licencia y build release 12.

Cada PR sigue el ciclo: Sonnet implementa, se revisa, CI y merge; luego se actualiza el handoff.

## Verificación

- **Fase A:**
  - `pnpm --filter api test`, tests de web, `tsc` y CI.
  - Tras el deploy: Finalizar en el teléfono y ver "Recorrido finalizado" en `/en-vivo`.
  - SQL de solo lectura en `sesiones_operativas.recorrido_estado`.
- **Fase B:**
  - Tests unitarios del núcleo: histéresis, arco corto, anti-jitter, acotado de duración y filtro `fuente: 'visual'` en `onLocation`.
  - Test de que un fix visual no produce `encolarEvento`.
- **Fase C:**
  - Emulador con reproducción de GPX (MCP `mobile` / `adb emu geo`) y grabación de pantalla.
  - Revisión visual del CTO.
  - Ronda 2 con las métricas de arriba.
