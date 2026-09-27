# Plan: mock completo del panel del delegado para el guion de video (E05, E07, E08)

## Contexto
Hoy se graba el video "QUIVO_Control_Guion_Video_Consolidado V3". Revisé el guion contra el panel web y el resultado fue que muchas escenas del delegado no existen:
- novedades;
- tráfico / atascados / desvíos;
- alta demanda y horas pico;
- coordinación de salidas;
- designación de paradas;
- vista 24 h;
- configuración (E08).

El CTO decidió que **todo se mockea**, aunque el guion pida funciones reales. Decisiones ya tomadas:
- **Rotulado en edición:** el panel tiene un modo grabación sin el badge "Modo simulación", y edición pone el rótulo «Demostración».
- **Flota de 8 trufis:** 5 de Z12 y 3 de la Línea 120.
- **Configuración de E08 también mockeada.**
- **Alcance:** solo el panel web. La app del conductor (E06) queda fuera.

Base: copia `~/Downloads/Quivo-control`, rama `mock/sandbox` (commit `fa9c3a2`). Ya existe:
- el mock `/en-vivo` con flag `NEXT_PUBLIC_MOCK_FLOTA`;
- los marcadores con foto, el parpadeo por infracción y la ficha del trufi (parada, acciones ahora/con plazo, WhatsApp);
- el panel de simulación;
- el filtro Todas/Z12/Línea 120;
- `overlayMarkers` y `MapRoute.offsetPx` en el design-system.

## Mapa guion → funcionalidad mock
| Toma | Qué debe verse | Cómo |
|---|---|---|
| E05 02:18 | Panel en PC **y celular** | Responsive a 390 px verificado. La vista mapa y las vistas pasan a bottom sheet |
| E07 03:48 | Cuántos trabajan, dónde, puntos de control por línea | **Franja KPI**: En ruta / En cola / Finalizados / Sin señal / Novedades abiertas, respetando el filtro. En la ficha, **puntos de control X/N** como chips |
| E07 04:03 | Orden de salida, horarios, recorridos registrados en 24 h | Vista **Salidas**: cola por línea con salida programada y real. **Línea de tiempo 00–24 h** con los recorridos del día (historial sembrado desde las 05:00) |
| E07 04:17 | Desvío / fuera de orden / reporte del conductor, y actuar | Vista **Novedades** (bandeja): revisar → ver en el mapa → marcar atendida con nota / crear infracción / WhatsApp |
| E07 04:32 | Atascados, desvíos no autorizados, paradas con alta demanda, horas pico | **En el mapa:** trufi "atascado" con el tramo en rojo punteado; desvío con la traza fuera de la ruta en naranja; paradas con alta demanda pulsando y "~N esperando". Vista **Análisis**: barras por hora de 00 a 24 con los picos marcados |
| E07 04:49 | Coordinar salidas con conductores | En Salidas: *Despachar siguiente*, *Adelantar/atrasar en la cola*, *Avisar al conductor* (WhatsApp con el mensaje armado). Solo un aviso informativo ("Parada X con alta demanda, próxima unidad a 12 min"); **ninguna decisión automática**, como pide el guion |
| E07 05:05 | Historial, horarios, sanciones, designación de paradas | **Pestañas en la ficha del trufi:** Resumen · Recorridos · Horario · Sanciones · Paradas. La de Paradas es la asignación que ya existe |
| E07 (validación) | Delante/detrás | En la ficha: "Adelante: 2345-ABC a 4 min · Atrás: … a 7 min" |
| E08 05:42 / 05:53 | Sin señal: el panel NO avanza; al recuperar la señal, sincroniza | Trufi "sin señal": el marcador queda congelado en gris con "Sin señal · hace m:ss" y los puntos se guardan en un buffer. Al recuperar la señal aparece "Sincronizando N puntos…", el marcador salta y se dibuja el tramo guardado |
| E08 06:01 | Configurar recorrido, horario, parada, punto de control | Vista **Configuración** por línea: horario (inicio, fin, frecuencia), paradas (renombrar, marcar como punto de control, radio de tolerancia). El recorrido se resalta en el mapa. Guardar cambia el estado del mock |
| — | Recorrido finalizado | Estado **Finalizado**: marcador gris con check, deja de contar como "en ruta" |

## Arquitectura (sobre lo existente, todo dentro del mock)
- **Navegación:** un rail de vistas en el HUD superior izquierdo, debajo del filtro: **Mapa · Salidas · Novedades (con badge) · Análisis · Configuración**. Cada vista se abre como un panel grande sobre el mapa (a la izquierda; bottom sheet en celular) y el mapa sigue visible. La ficha del trufi sigue a la derecha.
- **Modo grabación:** `NEXT_PUBLIC_MOCK_GRABACION=true` oculta el badge y **esconde el panel de simulación**. Se muestra y se oculta con la tecla `S`, para disparar un escenario y dejar la toma limpia.
  - Además, se graba con `next build && next start` para que no aparezca el indicador "N" de Next.
- **Estado:** el reducer puro se parte en *slices* dentro de `apps/web/src/lib/mock-flota/estado/`: `flota`, `salidas`, `recorridos`, `novedades`, `senal`, `demanda`, `config`. Todos se combinan en `reducer` y la API pública de `useFlotaMock()` sigue siendo la misma, con acciones nuevas.
  - La aleatoriedad y la hora se inyectan desde el hook, como hoy.
- **Reutilizar del design-system:**
  - `MetricStrip`/`MetricStripItem` para los KPI;
  - `BarTrendChart` para la hora pico, con 24 buckets; si no los soporta, SVG propio con los mismos tokens;
  - `Tabs` para las pestañas de la ficha;
  - `SegmentedControl`, `StatusBadge`, `PlateBadge`, `Card`, `ProgressBar`;
  - el timeline CSS de `vehicle-history-modal.tsx` (`.vehicle-history`);
  - los chips de puntos de control copiados del patrón de `en-vivo/page.tsx` (~L680-722).
- **Capas del mapa:** todo con props que ya existen:
  - tramo atascado y traza del desvío como `MapRoute` extra con `dashed` y color;
  - traza del trufi seleccionado (y el tramo guardado sin señal) como `MapRoute`;
  - paradas con alta demanda y marcador finalizado / sin señal con `overlayMarkers`.
  - **No se toca el design-system.**

## Contrato de datos (lo implementa el subagente A; C1 y C2 programan contra esto)
- **`TRUFIS_MOCK`:** 8 trufis (5 `z12`, 3 `l120`). Los 5 nuevos usan fotos placeholder generadas con ImageMagick, con el mismo estilo que las actuales.
- **`ParadaMock`** suma estos campos: `esPuntoControl: boolean`, `radioToleranciaM: number` y `avance: number` (0..1 sobre la polilínea, precalculado). Son 3-4 puntos de control por línea.
- **`EstadoTrufi`** suma estos campos:
  - `fase: 'en_cola' | 'en_ruta' | 'atascado' | 'desviado' | 'sin_senal' | 'finalizado'`;
  - `vueltaActual`, `ultimaSenalEn`, `bufferPuntos: [lat,lng,ts][]`, `traza: [lat,lng,ts][]` (de la vuelta actual);
  - `cumplimientos: { paradaId, ts }[]` (de la vuelta actual).
- **Salidas:**
  - por línea: `frecuenciaMin`, `horaInicio`, `horaFin` y `cola: trufiId[]`;
  - `SalidaMock { trufiId, programada, real?, fueraDeOrden }`;
  - selectores `colaDe(linea)`, `delanteDetras(trufiId) → { adelante?: { trufiId, minutos }, atras?: … }`.
- **Recorridos:** `RecorridoMock { id, trufiId, lineaId, inicio, fin?, puntosCumplidos, puntosTotal, estado: 'en_curso'|'completo'|'incompleto' }`.
  - Se siembra un historial **desde las 05:00 del día hasta ahora**, determinístico con una semilla.
  - Selector `recorridosDelDia(filtro)`.
- **Novedades:** `NovedadMock { id, tipo: 'desvio'|'fuera_de_orden'|'reporte_conductor'|'atascado'|'sin_senal', subtipo?, trufiId, creadaEn, estado: 'nueva'|'en_revision'|'atendida', nota? }`.
  - Los subtipos de reporte del conductor son: pinchazo, control policial, bloqueo de vía, falla mecánica, incidente con pasajero.
- **Demanda:** `demandaDe(paradaId, hora) → { nivel: 'baja'|'media'|'alta', esperando: number }`. La curva base tiene picos a las 7-9, 12-14 y 18-20, y la simulación puede forzar la hora pico.
  - `movimientoPorHora(linea?) → number[24]`.
- **Acciones nuevas en `useFlotaMock()`:**
  - simulación: `simularAtasco`, `simularDesvio`, `simularFueraDeOrden`, `simularReporteConductor(subtipo?)`, `perderSenal`, `recuperarSenal`, `alternarHoraPico`, `finalizarRecorrido`;
  - coordinación: `despacharSiguiente(linea)`, `moverEnCola(trufiId, ±1)`;
  - novedades: `atenderNovedad(id, nota)`, `revisarNovedad(id)`, `crearInfraccionDesdeNovedad(id, tipoId)`;
  - configuración: `guardarConfigLinea(linea, {frecuenciaMin, horaInicio, horaFin, paradas})`;
  - `reiniciarDemo()`.
  - Todas son "trufi al azar entre los visibles" o reciben `trufiId` opcional.
- **Invariantes:**
  - Desvío, fuera de orden, atasco y sin señal generan una novedad.
  - Un desvío también genera una infracción "Desvío de ruta" (media), así se reutiliza el flujo de acciones.
  - El reducer sigue siendo puro.
  - La ficha y el filtro existentes no se rompen.

## Ejecución (el chairman orquesta; el código lo escribe Sonnet)
1. Guardar este plan en `docs/plan-mock-guion-delegado.md` y agregar el puntero en el handoff.
2. **A (Sonnet):** capa de datos y estado según el contrato, con tests (siembra determinística, cola, delante/detrás, cumplimientos, señal/buffer, invariantes de novedades), más las 5 fotos placeholder.
3. **Al mismo tiempo que A**, el chairman escribe `docs/guion-grabacion-mock.md`: la **lista de tomas** por timecode, con qué clic o tecla da cada toma. Es documentación, no código.
4. **Después de A, en paralelo y con archivos separados:**
   - **C1:** `simulado/vistas/{vista-salidas,vista-analisis,vista-configuracion}.tsx` + `vistas.css`. Cada una es un componente autocontenido que usa `useFlotaMock()` y solo recibe `{ onSeleccionarTrufi, onCerrar }`.
   - **C2:** rail de vistas, franja KPI, `vistas/vista-novedades.tsx`, capas del mapa, pestañas de la ficha y delante/detrás, ampliación del panel de simulación (en secciones colapsables), modo grabación con la tecla `S`, y el cableado en `en-vivo-simulado.tsx`, incluidas las vistas de C1.
   - Antes de escribir la UI, cargan `impeccable` y siguen el lenguaje `qv-live-hud`/glass ya establecido.
5. **Revisión:** `/code-review` + auditoría de pautas de diseño web (subagente). Las correcciones van a un Sonnet nuevo.
6. **Verificación del chairman:** ver abajo. Después commit en `mock/sandbox` y actualizar el handoff.
7. Preguntarle al CTO si actualiza también el repo público `quivo-control-mockup` y la rama `mockup`.

## Verificación
- `pnpm --filter @quivo/web typecheck`, `lint` (sin warnings nuevos) y `test`; `pnpm --filter @quivo/design-system test`, que no debería cambiar.
- `next build && next start -p 3110` con `NEXT_PUBLIC_MOCK_FLOTA=true`, `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` y `NEXT_PUBLIC_MOCK_GRABACION=true`.
  - Chequeo explícito: `NEXT_PUBLIC_DEV_BYPASS_AUTH` está bloqueado cuando `NODE_ENV==='production'`. Si pasa eso, se graba en `next dev` con el indicador de Next desactivado (`devIndicators: false` en `next.config` de la copia).
- Recorrer **cada fila de la tabla guion → mock** con Playwright, a 1440 y 390 px, y sacar una captura por toma en `docs/tomas/`. Revisar además:
  - que en modo grabación no se ven ni el badge ni el panel de simulación, y que `S` los alterna;
  - que en sin señal el marcador no se mueve por más de 10 s, y que al recuperar la señal aparece la sincronización;
  - que el historial de 24 h muestra recorridos desde las 05:00;
  - que el filtro de línea sigue aplicándose a todas las vistas.
