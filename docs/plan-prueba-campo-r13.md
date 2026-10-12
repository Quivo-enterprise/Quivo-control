# Plan — Fixes de la prueba de campo del APK r13 (2026-10-11)

## Context
El CTO probó el APK de producción r13 en la calle. El seguimiento funciona, pero aparecieron estos problemas:
1. El sheet "Próximo Control" se colapsa solo al COMENZAR RUTA y corta FINALIZAR RUTA a la mitad.
2. Después de tocar la brújula (norte arriba) no se puede volver a la vista en primera persona. El botón Centrar no aparece nunca.
3. Aparece "No se pudo registrar una ubicación (código 408)".
4. El vehículo se dibuja sobre las casas o en el carril contrario. Va unos metros atrasado.
5. Debería tener zoom y altura automáticos, como Google Maps.
6. El chime de "punto de control pasado" suena saturado. La voz suena bien.
7. Los puntos de control no avanzan (se queda en "#1" aunque pasó el #5). La regla de vueltas es la de abajo.

### Causas raíz verificadas en la exploración
- **(1)** `operation-screen.tsx:557` define `colapsado={camara.modo !== 'general'}`. Al iniciar el recorrido el sheet baja un `SNAP_OFFSET_SHEET = 70` fijo (`next-control-sheet.tsx:25`), sin tener en cuenta su alto real. Eso tapa unos 38 de los 46 dp del botón.
- **(2)** La columna de FABs está en `bottom: 180` fijo (`operation-screen.tsx:832`). El sheet en recorrido mide más que eso, y Centrar (el último de la columna) queda **detrás del sheet**: en la captura 1 se ve el círculo medio tapado. La brújula es la nativa de Google (`route-map.tsx:762`, `showsCompass`). Pone norte arriba y pasa a `libre`, pero el botón para volver está oculto. Una sola causa explica los dos síntomas.
- **(3)** El 408 **no es HTTP**. Es `LOCATION_TIMEOUT` del SDK Transistorsoft (`use-gps-operativo.ts:659-664`): el GPS no entregó un fix a tiempo. Se muestra como error permanente en el sheet y además le agrega alto.
- **(4)** No hay snap a calle: el marcador es GPS crudo interpolado. El canal visual a 1 Hz está **apagado** en production (`EXPO_PUBLIC_GPS_CANAL_VISUAL` no está en EAS), así que el marcador solo se mueve con los fixes de evidencia cada 15 m o más, y de ahí el atraso. El fix del crash del canal (#109) sigue sin verificar en teléfono. OSRM **no está desplegado en producción** (`docs/plan-saneamiento.md:55`).
- **(5)** `ZOOM_NAVEGACION = 18` y `PITCH = 55` son fijos (`features/mapa/camara.ts`).
- **(6)** `confirmacion-chime.wav` tiene pico de -1 dBFS y un factor de cresta de unos 3,6 dB (casi una onda cuadrada). El problema es el asset. El canal de notificación usa una copia idéntica.
- **(7)** La detección (`gps/geofence.ts`) ya acepta cualquier orden. El bug está en la UI: `proximoPuntoControlPendiente` (`proximo-punto-control.ts:5-11`) devuelve el **menor orden pendiente**. `MiniStepper` pinta según ese índice, no según los completados, y el mapa hace lo mismo (`estado-punto-control.ts:25-27`). Además, `completados` vive en `useState` y solo se alimenta desde foreground. Las detecciones headless y las detecciones múltiples en un mismo tick se pierden en la UI (`location-task.ts:271-283`).

### Decisiones del CTO (esta sesión)
- Sheet: arranca **completo**. Si el conductor lo baja, queda una tira compacta limpia, calculada con el alto real.
- Snap: **solo a la polilínea de la ruta** en este release. Desplegar OSRM en una VM queda como tarea de infra separada.
- Vueltas: pasar por todos los puntos **no es requisito**. Para el chofer es informativo: el punto no pasado se marca **rojo**. La vuelta se cuenta **al volver al punto donde empezó**. Después se reinicia.
- "Próximo Control" = siguiente pendiente en orden circular después del último pasado. Si todavía no pasó ninguno, el pendiente más cercano.
- El contador de vueltas se muestra solo en la app. El servidor y el panel web quedan para después.

## Reglas de proceso
- El chairman es Opus 5.5 y hace el diseño inline. Todo el código lo escriben subagentes `general-purpose` con `model: "sonnet"`, con un PR por bloque.
- UI puntual: un solo camino con `impeccable` y `react-native-patterns`. No se hace bake-off.
- Cada PR pasa por `/code-review`. Los `fix:` además pasan por `/codex-debug verify-fix`. Después: CI, merge y actualización de `docs/handoff.md`.
- Al aprobar el plan: volcarlo a `docs/plan-prueba-campo-r13.md` con un puntero en el handoff (regla 8).
- Antes del build del APK: pasar al CTO el changelog de features y fixes (memoria `apk-build-11-changelog-antes-de-lanzar`).

## PR 1 — `fix(mobile)`: sheet, FABs, brújula y recentrar
- **Sheet** (`next-control-sheet.tsx`, `operation-screen.tsx`):
  - Quitar el auto-colapso (`colapsado` deja de depender de `camara.modo`). Arranca expandido y solo colapsa por arrastre.
  - Offset de colapso = `altoSheet − altoCabecera`, con la cabecera medida por `onLayout`. Se guarda en un ref que lee el `PanResponder`, porque hoy el closure captura el 70.
  - Borrar `SNAP_OFFSET_SHEET` como constante.
  - `insetsNavegacion.inferior` usa el alto visible actual (se actualiza al terminar el snap) para que el vehículo quede siempre por encima del sheet.
- **FABs:** cambiar `bottom` fijo por `altoSheet + MARGEN_INFERIOR_SHEET + 12`. Se mantiene `translateY: sheetPanY`.
- **Recentrar:** pill "Centrar" visible y prominente (estilo Google), abajo a la izquierda por encima del sheet, en `libre`. En `general` se mantiene "Ver ruta completa".
- **Brújula propia:**
  - `showsCompass={false}`.
  - Botón custom en la columna de FABs, con un ícono que rota según el bearing de la cámara.
  - En `navegacion` alterna `orientacion: 'rumbo' | 'norte'` sin salir del seguimiento.
  - En `libre` equivale a recentrar.
  - Cambios: el reducer `modo-camara.ts` gana `orientacion` y el evento `alternarOrientacion`. `construirCamaraNavegacion` recibe la orientación (`'norte'` da heading 0). Agregar tests en `modo-camara.test.ts`.
- **Endurecer la detección de gesto** (`route-map.tsx`): agregar `onTouchMove` en el wrapper del `MapView`, con umbral de unos 8 px o 2 dedos, que llame a `salirANavegacionLibre`. Se suma a `onPanDrag` y `isGesture` y no reacciona a nuestros `setCamera`. Un tap sobre un marcador no saca de navegación.

## PR 2 — `fix(mobile)`: progreso de vuelta en cualquier orden
- **Reducer puro nuevo `features/operacion/progreso-vuelta.ts`, con tests.** Estado: `{ sesionId, vueltasCompletadas, inicioId, pasados[], ultimoId, ultimaVueltaResumen? }`. Al llegar `pasoPunto(id)`:
  - Si `inicioId` es null: `inicioId = id`.
  - Si `id === inicioId` y `pasados.length > 1`: **cierra la vuelta**. Suma 1, guarda el resumen `{n, pasados, total}` y la nueva vuelta arranca con `[id]`.
  - Si `id` ya está en `pasados`: no hace nada.
  - En cualquier otro caso: se agrega a `pasados`.
- **Derivado:** se rota la lista ordenada por `orden` para que `inicioId` quede primero. Estados posibles:
  - `pasado`
  - `omitido` (rojo): pendiente con índice menor al máximo índice pasado
  - `proximo`: primer pendiente después del máximo. Si no queda ninguno, es `inicioId`, para cerrar la vuelta.
  - `pendiente`
  - Si `inicioId` es null, el próximo es el pendiente más cercano.
- **Persistencia:** un único escritor idempotente (por `eventId` o `{puntoId, pasada}`) sobre la capa de almacenamiento que ya usa el outbox, con clave por `sesionId`.
  - Lo invocan tanto el `onLocation` de foreground como la tarea headless (`location-task.ts`).
  - La UI se hidrata al montar y al volver `AppState` a `active`.
  - Este estado reemplaza al `useState` de `completados` y a `completadosTrasDeteccion`.
- **Detecciones múltiples por tick:** `registrarPuntoGps` / `location-task` devuelven un array, sin quedarse con "el último".
- **UI:**
  - `MiniStepper` pinta los puntos en orden rotado: verde pasado, rojo omitido, gris pendiente, resaltado el próximo.
  - Etiqueta "Vuelta N".
  - Toast al cerrar la vuelta: "Vuelta N completada · X/Y puntos".
  - Los marcadores del mapa (`estado-punto-control.ts`) usan el mismo derivado.
  - Revisar que la voz de aproximación no dependa del "menor pendiente".
- **Docs:** reescribir RF-GPS-054 en `docs/srs/04-operacion-gps-sync.md` y definir "vuelta" en `docs/glosario.md`.

## PR 3 — `feat(mobile)`: snap a la ruta, zoom automático y canal visual
- **Módulo puro nuevo `features/mapa/movimiento/snap-ruta.ts`, con tests.**
  - Proyecta el fix sobre el segmento más cercano de la polilínea de la ruta, con proyección equirectangular local.
  - Acepta el snap si la distancia es como mucho `max(25 m, min(accuracy, 40 m))` y, con rumbo conocido y velocidad de 2 m/s o más, si la diferencia de bearing con el segmento es de 60° o menos. Eso resuelve los circuitos que recorren la misma calle en los dos sentidos.
  - Histéresis: busca primero en una ventana cercana al segmento anterior.
  - Con snap, el rumbo es el bearing del segmento (cámara estable) y la interpolación va **a lo largo de la polilínea** (por distancia acumulada), no en línea recta.
  - Fuera de ruta: GPS crudo.
- **Integración** (store visual / `posicionMapaDesde` / `MarcadorConductorAnimado`): solo afecta lo visual. La evidencia, el sync y la geofence siguen con GPS crudo. Con snap se oculta el halo de precisión. Localizar la fuente de la geometría de la ruta (la que alimenta `RutaPolylines`).
- **Zoom automático** (`camara.ts`):
  - Zoom objetivo según velocidad: 15 km/h o menos → 18; 40 → 17,5; 60 → 17; 90 o más → 16.
  - Suavizado exponencial por frame para que no haya saltos.
  - Pitch 55 sin cambios. Vehículo en el tercio inferior (ya existe).
- **Canal visual:** `EXPO_PUBLIC_GPS_CANAL_VISUAL=1` en el entorno EAS production. Requiere verificar #109 en el teléfono: ciclos foreground/background y pantalla apagada durante el recorrido.

## PR 4 — `fix(mobile)`: señal GPS débil y chime
- **408 y 0 (fallos transitorios):**
  - No se muestran en el sheet. Indicador "Señal GPS débil" en la pill de distancia y velocidad, solo si pasan más de 20 s sin un fix válido. Se limpia con el siguiente fix.
  - Los códigos permanentes (1 = denegado, 3 = WhenInUse) muestran un mensaje en español claro, sin el código crudo.
- **Chime:**
  - Regenerarlo con el script existente (`generate-confirmacion-chime.py`): pico a -6 dBFS, parciales senoidales con decaimiento exponencial, factor de cresta de 10 dB o más.
  - Nuevo asset `confirmacion_chime_notificacion_v2.wav` y canal `quivo-anuncio-punto-control-v2`, porque el sonido de un canal Android es inmutable. Borrar el canal v1 al arrancar. Actualizar `app.config.ts`.

## Fuera de alcance (backlog)
- OSRM en una VM de GCP (snap fuera de ruta y ruta real al próximo punto).
- Vueltas en el servidor y en el panel web.
- Google Roads.

## Verificación
- Por PR: `tsc`, los tests del mobile (reducers `modo-camara`, `progreso-vuelta`, `snap-ruta` y zoom), lint, CI verde.
- Emulador con el MCP `mobile`:
  - `mobile_set_location` reproduciendo una secuencia sobre la ruta.
  - Comprobar: sheet completo al iniciar, Centrar visible al hacer pan, alternancia de la brújula, puntos fuera de orden marcados (verde y rojo), cierre de vuelta al volver al inicio, marcador sobre la polilínea.
- Teléfono real (CTO), con el APK build siguiente. Checklist:
  - Sheet y botón FINALIZAR completos.
  - Brújula ida y vuelta.
  - Centrar después de pan y pinch.
  - Avenida doble: el marcador sobre el carril correcto de la ruta.
  - Zoom que cambia con la velocidad.
  - Sin "código 408" en el sheet.
  - El chime limpio.
  - Puntos marcados en cualquier orden y "Vuelta 1" al volver al inicio.
  - Canal visual sin crash al ir a segundo plano (#109).
