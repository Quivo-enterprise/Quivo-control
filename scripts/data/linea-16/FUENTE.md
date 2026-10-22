# Fuente de datos — Línea 16

- Google My Maps del Sindicato Mixto de Transporte(istas) Tiquipaya:
  https://www.google.com/maps/d/viewer?mid=1eU_70-dOsPLnzSXFvEQt_bdBtwraQC8
- KML descargado el **2026-10-12** con:
  `curl -sL "https://www.google.com/maps/d/kml?mid=1eU_70-dOsPLnzSXFvEQt_bdBtwraQC8&forcekml=1" -o linea-16-my-maps.kml`
- Es un boceto dibujado a mano (no traza GPS). Lo consume `scripts/cargar-linea-16.ts`.

## Trazado por calles (`trazado-calles.json`, `trazado-vista-previa.geojson`)

El boceto no se carga tal cual: `cargar-linea-16.ts` lo ajusta a calles con la Google Routes API
(`computeRoutes`), tramo por tramo (`ida`, `regreso`, `conector`, `ramal`, `bajada` = ramal invertido + v43, `salomon` = v43→v0),
usando como `heading` el rumbo
del boceto en el sentido de cada tramo para caer en la calzada correcta.

- `trazado-calles.json`: resultado versionado (coords por tramo + fecha, sha256 del KML y parámetros). La geometría que se carga se divide en dos:
  la **base** de la ruta = `ida + regreso + salomon` unidos (circuito cerrado v0→v0 que termina en Salomón Romero;
  inicio y fin a <= 50 m, fin a <= 150 m del PC SR) y la geometría de la variante "Vía Molinos" =
  `conector + ramal + bajada` (v43 → Molinos → v43). Hueco máximo entre tramos contiguos: 30 m.
  Mientras el sha256 del KML coincida, el script lo usa sin llamar a Google.
- `trazado-vista-previa.geojson`: boceto vs. trazado por tramo (`properties.tramo`, `properties.fuente`
  = `boceto` | `calles`), para revisarlo en geojson.io / QGIS.
- Regenerar (si cambia el KML o se quiere recalcular):
  ```
  GOOGLE_ROUTES_API_KEY=$(gcloud secrets versions access latest --secret=google-routes-server-key --project=quivo-control-prod) \
    packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --solo-trazado --recalcular-trazado
  ```
  `--solo-trazado` no toca la API de Quivo. La key no se imprime ni se commitea.
- Recalcular solo algunos tramos (el resto se conserva byte a byte del json): `--recalcular-trazado=bajada,salomon`.
  Sin lista recalcula todos. Si un tramo recalculado no pasa la validación, lo calculado queda en
  `trazado-rechazado.json/.kml` (ignorados por git) para diagnosticar sin volver a llamar a Google.
- Validación por tramo: desvío vs. boceto (<= 120 m), sin rulos (3 criterios) ni vueltas en U que el boceto
  no dibuje, longitud trazado/boceto <= 1,25. Los espolones (ir y volver por los mismos vértices) se podan.
- `OMITIR_MUESTRAS` (en `cargar-linea-16.ts`): waypoints del boceto cuyo heading la calle no admite; se
  omiten al trazar el tramo (regreso, salomon).
- `ZONAS_TRAMO_A_TRAMO` (zona terminal Salancachi / Encanto Pampa / U.E. Montecillos, vértices v8..v24 del
  boceto, en `ida` y, invertida, en `salomon`): decisión del CTO 2026-10-14 (variante "SINDICATO B"). Esa
  porción se rutea vértice a vértice (un request de Routes por par de vértices consecutivos, sin waypoints ni
  heading) y se empalma en el tramo existente (el resto del tramo no cambia). `--recalcular-zonas` re-rutea solo
  las zonas sobre el json guardado; `--recalcular-trazado=ida` / `salomon` también las aplica tras trazar el tramo.
  Con esto `EXCEPCIONES_DESVIO` quedó VACÍA (`--excepciones-revisadas` ya no se exige).
- `HUECOS_SIN_CALLE`: v10→v11 (Calle Los Tajibos, ~75 m) y v18→v19 (Calle Aguas Potables Norte / Encanto,
  ~226 m) no tienen calle transitable en Google; esos pares no se piden a Routes y se usa la geometría de la
  calle real copiada a la config (sin dependencia de red; la calle queda a ~16 m de la recta del boceto).
  Fuente de esos vértices: © colaboradores de OpenStreetMap, licencia ODbL (https://www.openstreetmap.org/copyright),
  consulta Overpass del 2026-10-14. Solo se copiaron ~17 vértices de 6 ways; no hay otros datos de OSM en el repo.

## Corrección de la parada Salomón Romero (2026-10-21)

El 21/10/2026 se corrigió la parada SR por decisión del CTO: el KML original la ubicaba mal.
- Parada vieja (KML original): -17.3173451, -66.2280812. Parada oficial nueva: **-17.3188935, -66.2280664**.
- `linea-16-my-maps.kml` se editó SOLO en esa zona: el placemark "PARADA SALOMON ROMERO LINEA 16" y los vértices v0..v18 de
  "Línea 1" (mismos 151 vértices; el resto byte a byte). Ya no es el KML descargado el 2026-10-12 (sha256 anterior
  `a4088382bb2b…`, actual `0b5b080e8493…`).
- Los tramos `ida` (hasta v18) y `salomon` (desde v18) de `trazado-calles.json` se trazaron con las trazas GPS del 21/10
  (sesiones 1616PID/PIB/PIL/PIF, simplificadas a 5 m), no con Google Routes: entrada y salida usan calles distintas entre SR y v18.
  El boceto v0..v18 es una línea media entre ambas. Los demás tramos se conservaron byte a byte; solo cambió `meta.kmlSha256`.
- `ZONAS_TRAMO_A_TRAMO` (v8..v24) y `HUECOS_SIN_CALLE` (v10→v11) ya no describen v8..v17; no correr `--recalcular-zonas` sin revisarlos.

## Plan de PC fijado a prod (2026-10-22)

Tras retrazar SR (PR #233) la base pasó a 29,52 km y el generador de PC daba 16 puntos, pero prod tiene 17 (creados con la
geometría anterior; retorno en orden 8, espera en orden 15). Decisión del CTO: prod manda y no se toca.
- `puntos-control.json` fija el plan de PC a los 17 PC activos de prod (coords exactas, `rol`, `esperaMin`, `obligatorio`);
  `cargar-linea-16.ts` lo lee en lugar de generarlo desde la geometría. Radio: siempre 150 m (`RADIO_TOLERANCIA_M`).
- Para cambiar los PC, editar ese JSON (no hay generador).
