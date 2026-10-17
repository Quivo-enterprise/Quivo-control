# Plan — Trazo y cámara del mapa web como en la app (en vivo + ver recorrido)

> **Estado (2026-10-17): implementado** en #173 (`ee352ee`). Desvíos respecto de este plan: el solape largo (75 min) va
> cada 6 polls y no en todos; Douglas–Peucker se aplica a todos los segmentos; la animación del marcador conserva el
> reparto del intervalo de poll (no usa `duracionAnimacionMs`); el encuadre de "Ver recorrido" sale solo de los
> segmentos (puntos válidos). Deploy `r18-20261017`.

## Contexto
Prueba piloto del **miércoles 14/10** (L16, ruta `460c9015…`; el CTO creía que era el jueves, pero el 15/10 no
tiene datos en prod). En el panel web el recorrido se dibujó **sobre las casas**, **incompleto**, y el vehículo
**se salía del mapa**. El mapa de la app móvil funciona muy bien. Objetivo: llevar sus técnicas a la web.

**Datos (API de prod, sin topes ni muestreo):**
- PIB `f43f1a8c`: 1639 puntos, precisión mediana 2,2 m, un punto cada 3 s, 2 huecos de más de 2 min (máx 400 s).
- PIL `445cd1f5`: GPS malo. Precisión mediana 27 m (16 % peor que 50 m), 45 saltos de más de 100 m (uno de
  3128 m) y 12,5 % de puntos a más de 50 m de la ruta.

**Causas en el código web:**
- **Sobre las casas.** El trazo es GPS crudo unido con rectas:
  - `apps/web/app/(dashboard)/en-vivo/map-builders.ts:13-33`, `reportes/recorridos/[id]/page.tsx:372-393`.
  - Sin filtrar por precisión ni saltos, sin pegarse a la ruta, y con huecos dibujados como rectas.
  - El trazo además va corrido 2 px (`offsetRutaParalela`, `route-map-shared.ts:225`) y tapa la ruta planificada.
  - El marcador interpola en línea recta y con el fix crudo.
- **Incompleto.** Por topes no es (los conteos coinciden). Las causas son:
  - huecos de captura dibujados como rectas;
  - Douglas–Peucker a 3 m arriba de 1500 puntos;
  - puntos que llegan más de 15 min tarde: el solape del cursor es de 15 min y el p95 de demora de ingesta es de
    ~12–14 min (máx 71 min). Esos puntos se pierden hasta que dispara la recarga.
- **Se sale del mapa:**
  - la cámara sigue al último punto del trazo, que llega cada 10 s, mientras el marcador se anima cada 2 s;
  - solo hace `panTo` cuando sale del 60 % central del contenedor **entero**, sin restar el HUD ni el panel;
  - en "Ver recorrido", un punto disparado hace que `fitBounds` se aleje de más.

**Decisiones del CTO (2026-10-17):**
- **Trazo híbrido pegado a la ruta**, con los desvíos reales visibles.
- **Cámara norte arriba**, sin que el HUD o el panel tapen el vehículo.
- **Alcance:** `/en-vivo` y "Ver recorrido".

## Enfoque
El móvil no dibuja el rastro: ajusta el marcador a la ruta (`snap-ruta.ts`) y lo anima a lo largo de la calle.
Esa matemática es TS puro y tiene tests. Se **mueve a `packages/shared`** y la web la usa para tres cosas:
1. armar el trazo;
2. animar el marcador;
3. la cámara.

Sin servicios nuevos: nada de Roads API. Se ajusta a nuestra propia geometría, que ya está trazada por calles.

## Cambios

### 1. Shared — mover el snap (sin cambiar comportamiento)
- Mover a `packages/shared/src/snap-ruta.ts` estos helpers, con sus tests:
  - de `apps/mobile/src/features/operacion/movimiento/snap-ruta.ts`: `prepararRutaSnap`, `snapARuta`,
    `puntoEnDistancia`, `interpolarSobreRuta`, `debeInterpolarPorRuta`;
  - de `movimiento/geo.ts`, los que hagan falta: `distanciaMetros`, `calcularBearing`, `interpolarLatLng`,
    `interpolarAngulo`, `duracionAnimacionMs`.
- El móvil pasa a importarlos desde `@quivo/shared`. Es un cambio solo de imports, pero **igual exige APK u OTA**
  para que llegue a los teléfonos; no hace falta publicarlo ya, porque el comportamiento no cambia.
- Agregar `tramoDeRuta(ruta, desdeDist, hastaDist): {lat,lng}[]`: devuelve los vértices de la ruta entre dos
  distancias acumuladas, con wrap en circuito cerrado. Se construye con lo que ya expone `RutaSnap`, con test.

### 2. Shared — `trazaParaDibujo` (función pura nueva, con tests)
Firma: `trazaParaDibujo(puntos: PuntoTrazaGps[], rutas: RutaSnap[]): SegmentoTraza[]`, donde
`SegmentoTraza = { tipo: 'ruta' | 'libre', coords }`. Recorre los puntos en orden de `ts`:
- **Descarta** los puntos con `accuracy > 50 m` y los que implican más de 120 km/h desde el último punto válido.
- **Ajusta** cada punto con `snapARuta`:
  - usa la histéresis del snap anterior, el rumbo calculado entre puntos y el umbral `max(25, min(accuracy, 40))`;
  - prueba la base primero y después el tramo de la variante ("Vía Molinos").
- **Si dos puntos seguidos quedan ajustados** a la misma ruta y `debeInterpolarPorRuta` lo permite, se une con
  `tramoDeRuta`: sigue la calle y no corta la esquina.
- **Si un punto no ajusta** (desvío real), el segmento es `libre` y lleva las coordenadas crudas.
- **Corte de hueco:** con más de 120 s **o** más de 300 m entre puntos válidos se abre un segmento nuevo. No se
  dibuja la recta del hueco; queda el espacio vacío.
- Douglas–Peucker (`simplificar-traza.ts`) se aplica solo a los segmentos `libre` y solo si superan el umbral
  actual.

### 3. Web — dibujar los segmentos
- **`map-builders.ts` (`construirRutas`) y `recorridos/[id]/page.tsx`:**
  - cada segmento es una ruta del mapa: `ruta` en azul sólido y `libre` en color de alerta, más fino;
  - la ruta planificada sigue punteada debajo.
- **Contexto:** sumar la geometría del tramo de la variante.
  - `ContextoEnVivo` hoy trae solo la base (`en-vivo.service.ts:~679`). Agregar las variantes activas de la ruta
    (`id`, `geometria`) y extender el schema en `packages/shared`.
  - "Ver recorrido" ya trae `ruta.geometria`; se suma igual el tramo.
- **Offset:** los segmentos de traza no se desplazan (offset 0). `offsetRutaParalela` queda solo para rutas
  planificadas paralelas.
- `prepararRutaSnap` se memoiza por firma de geometría, igual que en el móvil (`firmaGeometria`).

### 4. Web — marcador del vehículo seleccionado
- En `page.tsx` (`animatedVehicle`) y en `packages/design-system/src/ui/vehicle-marker-animation.ts`, el punto del
  vehículo seleccionado se ajusta a la ruta con `snapARuta`.
- Entre fixes ajustados interpola con `interpolarSobreRuta` y la duración de `duracionAnimacionMs`, como el
  móvil. Si un fix no ajusta, se muestra crudo con la animación recta actual.
- El resto de la flota queda como está, con interpolación lineal. Son muchos marcadores y no es lo que se mira
  de cerca.

### 5. Web — cámara de `/en-vivo` (norte arriba, sin taparse)
- **Objetivo del seguimiento:** el punto **animado** del marcador, no `datos.puntos.at(-1)`.
- **`route-map-google.tsx` (`followPoint`, ~:1220-1250):**
  - aceptar `followPadding {top, right, bottom, left}` en px;
  - el chequeo del 60 % central se hace sobre el rectángulo visible, restando el padding;
  - el `panTo` centra en ese rectángulo, con el mismo offset que ya usa "Ver en mapa".
- **`page.tsx`:** pasa como padding la altura medida del HUD (`--qv-hud-top-h`) y la del panel inferior o lateral.
- Sin cambios de zoom ni de rumbo. La salida a "libre" con un gesto queda igual.

### 6. Web — "Ver recorrido"
El encuadre se hace con la ruta planificada más los puntos **válidos** (los que no descartó `trazaParaDibujo`),
así un fix disparado no aleja el mapa.

### 7. Puntos tardíos (incompleto)
- Subir `SOLAPE_CURSOR_MS` (`apps/web/src/lib/en-vivo/traza.ts`) de 15 a 75 min, para cubrir el máximo observado
  de demora de ingesta (71 min). El costo es repetir hasta 75 min de puntos en cada poll del vehículo
  seleccionado (unos 1500 puntos a uno cada 3 s), y `fusionarTraza` deduplica.
- Comentario `shortcut:` con el límite: si la demora pasa los 75 min, el siguiente paso es un cursor por hora de
  ingesta en la API.

## Reparto
- Chairman Opus: este plan, la revisión y la verificación.
- Sonnet A: pasos 1 y 2, shared y tests.
- Sonnet B: pasos 3 a 7, web y API. Arranca cuando A termina, porque usa la función compartida.
- Los hallazgos de las revisiones los aplica un Sonnet nuevo.
- Es un arreglo de comportamiento del mapa, no una dirección visual nueva: va por camino único (regla 7.c), sin
  bake-off.

## Verificación
- **Unit:**
  - tests movidos del snap, todos en verde;
  - `tramoDeRuta`;
  - `trazaParaDibujo` con casos de esquina (ajusta y sigue la calle), desvío real (segmento `libre`), punto de
    precisión 100 m (descartado), salto de 3 km (descartado), hueco de 400 s (corte) y circuito cerrado (wrap).
- **Replay con datos reales:**
  - Playwright contra `next start` con la API simulada, alimentado con los CSV del 14/10 que están en
    `/tmp/claude-1000/-home-shadowfreak-Documents-Quivo-App-Quivo-control/9f1c31f3-d83e-4d32-bb44-1a2ab7a193fa/scratchpad/piloto-jueves/`
    (`pts_1616PIB_f43f1a8c.csv`, `pts_1616PIL_445cd1f5.csv`) y con la geometría real de la ruta (`rec_*.json`);
  - capturas antes y después en `/en-vivo` y en "Ver recorrido", a zoom 16–18 en esquinas y en el tramo de PIL
    con GPS malo;
  - en `/en-vivo`, avanzar los puntos en el tiempo y comprobar que el marcador nunca queda detrás del HUD ni del
    panel.
- **Tipos y CI:** `tsc` en shared, web, mobile y api; tests de shared, web y mobile; CI `ci` + `acceptance`.
- **Gates:** `/code-review` + `/ponytail-review` + `web-design-guidelines`. También `/security-review`, porque
  cambia `ContextoEnVivo` en la API. Codex si hay cuota (no hay hasta el 16/11).
- **Deploy:** api + web. El móvil no hace falta ahora, porque el cambio ahí es solo de imports.
- **Calle:** el CTO mira en `/en-vivo` un recorrido de L16 completo.

## Riesgos y límites
- Un desvío de menos de 25–40 m (umbral del snap) no se ve como desvío en el mapa. Las alertas de desvío del
  worker no cambian: siguen con el GPS crudo.
- Calles de ida y regreso compartidas: lo resuelven la histéresis y el filtro de rumbo del snap (±60°). En las
  vueltas en U puede haber algún punto mal asignado, que se ve como un tramo corto de más.
- Los huecos quedan visibles como espacios, que es lo honesto: el teléfono no capturó. Arreglar la captura es
  otro trabajo (`docs/issues-pendientes-gps.md`, Issue 2).
