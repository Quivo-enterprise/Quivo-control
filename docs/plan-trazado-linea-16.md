# Plan — trazado de la línea 16 por calles y polilínea de navegación

Pedido del CTO 2026-10-14 (02:15), bloquea el próximo APK.

## Problema

1. **Retorno por la calzada equivocada.** `scripts/cargar-linea-16.ts` arma la geometría con el
   boceto KML de Google My Maps (dibujado a mano, `scripts/data/linea-16/FUENTE.md`):
   `principal (v0..v150) + principal.slice(43, 92).reverse() + ramal Putucu`. El regreso v91→v43
   es la polilínea de ida invertida, así que en avenidas de doble calzada (ej. rotonda Libertador
   Bolívar / Atahuallpa) la ruta de retorno se dibuja sobre la calzada de ida y el bus aparece
   "del otro lado". Ningún tramo respeta sentido ni calzada: son vértices a mano.
2. **Polilínea de navegación (mobile).** `apps/mobile/src/features/mapa/route-map.tsx`
   (`RutaPolylines`) dibuja con `estilo-ruta.ts`: naranja `#FE9B0B`, 5.5 px fijos. Se ve delgada
   e irregular (el serrucho viene del boceto a mano, no del render). El CTO la quiere azul Quivo,
   del ancho del carril y escalando con el zoom, uniforme como Google Maps.

## Decisión (CTO, 2026-10-14)

Ruteo con **Google Routes API** (`computeRoutes`), no OSRM/OSM ni waypoints a mano.
- Habilitada `routes.googleapis.com` en `quivo-control-prod`.
- Key de servidor restringida a Routes API en Secret Manager: `google-routes-server-key`.
  Uso local: `GOOGLE_ROUTES_API_KEY=$(gcloud secrets versions access latest --secret=google-routes-server-key --project=quivo-control-prod)`.

## Fix 1 — trazado por calles (PR `fix/linea-16-trazado-calzadas`, solo scripts/datos)

- Cada tramo del boceto (ida v0..v150, regreso v91→v43, conector v43→ramal, ramal) se ajusta a
  calles por separado: se remuestrea cada ~250 m y cada muestra va como waypoint `via: true` con
  `heading` = rumbo del boceto **en el sentido de circulación del tramo**. El heading obliga a
  Routes a elegir la calzada de ese sentido; el regreso invertido cae en la calzada de vuelta.
- Máx. 25 waypoints intermedios por request: se encadenan requests (fin de uno = inicio del otro).
- `polylineQuality: HIGH_QUALITY`, `routingPreference: TRAFFIC_UNAWARE`, `travelMode: DRIVE`.
- Validación antes de aceptar: desvío máximo trazado↔boceto por tramo y ratio de longitud;
  si se pasa de umbral, falla con el tramo y la coordenada (no se carga basura).
- El resultado se versiona en `scripts/data/linea-16/` (reproducible, `--apply` no vuelve a llamar
  a Google). Regenerar es explícito (`--recalcular-trazado`).
- Vista previa boceto vs. trazado para que el CTO apruebe antes de `--apply`.
- `--apply` sigue requiriendo ok del CTO (y revisar asignaciones de la ruta `460c9015…`).
- **Ampliación 2026-10-14 (03:00):** el CTO confirma que el ramal Putucu "suben y bajan por la
  misma calle". Faltaban dos tramos que se dibujaban sobre la ida: `bajada` (Molinos → v43, ramal
  invertido) y `salomon` (v43 → v0, regreso directo a Salomón Romero). Geometría final =
  circuito cerrado continuo `ida, regreso, conector, ramal, bajada, salomon` (v0 → v0). Los 4
  tramos ya revisados se conservan byte-idénticos; solo se trazan los 2 nuevos
  (`--recalcular-trazado=bajada,salomon`).
- Rotonda Libertador/Atahuallpa (captura del CTO) verificada en datos: `regreso` va ~40 m al
  este de `ida` (calzada derecha subiendo al norte).
- Hallazgos de `/code-review high` (10) aplicados en la misma rama: detector de rulos por exceso
  de recorrido local, regla 2 sin salto, tope de hueco entre tramos, `--excepciones-revisadas`
  obligatorio para `--apply`, volcado de trazados rechazados, etc.

- **Error del regreso al norte de la rotonda (reporte CTO 03:00):** tras subir por Atahuallpa el
  trazado se metía al NO por otra calle, salía a Circunvalación por la calzada de ida y hacía una U
  (la "excepción" de 138 m lo escondía). Causa: waypoint de la muestra 6 sobre la calzada de ida.
  Corregido con `OMITIR_MUESTRAS`: sube por Atahuallpa hasta Circunvalación y gira al oeste directo
  por la calzada norte (11-16 m de la ida). Verificado sobre teselas OSM. Detector nuevo
  `detectarVueltasU` (>150° en ≤40 m no dibujado en el boceto); `podarEspolones` quitó 2 espolones
  de la ida. Excepciones: de 3 a 1 zona (terminal Salomón Romero, radio 700 m, tope 170 m).
- **Abierto (2026-10-14 03:10): zona terminal (Salancachi / Encanto Pampa / Calle Potosí /
  U.E. Montecillos).** Calles probablemente de un solo sentido; Google no sigue el boceto:
  ida va por una calle paralela al oeste, baja por Calle Potosí y rodea la manzana de U.E.
  Montecillos (v20-v21-v23); el regreso a Salomón sube por Calle Potosí hasta Los Tajibos y vuelve
  al sur por v12-v13 (lazo ~670 m). Pregunta al CTO cómo circula el bus ahí; no se cierra la
  zona sin su respuesta.
- **Resuelto (CTO, 2026-10-14 03:40): zona terminal = variante "sindicato tramo a tramo".** Causa
  real: no son sentidos únicos (OSM sin `oneway`; rutas punto a punto idénticas en ambos sentidos)
  sino 2 tramos sin calle transitable en Google: v10→v11 (Calle Los Tajibos) y v18→v19 (Calle Aguas
  Potables Norte). `ZONAS_TRAMO_A_TRAMO` (v8..v24, `ida` y `salomon`) rutea par a par de vértices
  del boceto; `HUECOS_SIN_CALLE` usa la geometría OSM de esas calles (ODbL, en `FUENTE.md`).
  `EXCEPCIONES_DESVIO` vacía. ⚠ No verificado: que esas 2 calles sean transitables para el trufi
  (confirmar con el sindicato / en terreno).
- **`/code-review` ronda 2 (10 hallazgos + cabecera), aplicados:** U no detectadas cerca de los
  extremos del boceto; `podarEspolones` exige ida-y-vuelta real (no borra rotondas); culpables del
  reintento por problema; reintento evalúa contra el boceto entero; salto entre pares de la zona
  ≤ 20 m; dry-run/`--apply` nunca escriben archivos (abortan si la poda cambiaría algo);
  `--recalcular-*` exige `--solo-trazado`; la zona se excluye del conteo de problemas del tramo;
  volcado de rechazados con `--recalcular-zonas`; sin retrocesos globales de abscisa; dedupe.
  Tests 40/40. Geometría versionada intacta (sha `ebb8fcdd…`); dry-run en prod: 1 PATCH, 1425
  vértices, 32,80 km, PCs a ≤ 18,3 m.

## Fix 2 — polilínea de navegación (mobile, después de F1-mobile por `route-map.tsx`)

- Color: primario Quivo `#3226B4` (`quivo-theme.ts` `primary`) con borde más oscuro debajo
  (casing, como Google) para separarla del mapa.
- Ancho por zoom: `anchoDp = metros / (156543.03 · cos(lat) / 2^zoom)`, metros ≈ ancho de
  calzada de un sentido (~6 m), con mínimo/máximo; zoom cuantizado (pasos de 0.25) para no
  re-renderizar a 30 Hz desde `zoomActualRef`.
- La uniformidad viene sobre todo del Fix 1 (geometría pegada a la calle).
- Actualizar `estilo-ruta.test.ts`.

## Verificación

- Fix 1: tests de las funciones puras (remuestreo, rumbo, troceo, decodificación, desvío);
  vista previa revisada por el CTO; tras `--apply`, captura en la app en la rotonda del reporte.
- Fix 2: typecheck/tests mobile; captura en dispositivo a zoom 16–18 en navegación.

## Pendiente fuera de alcance

- **Vecinos delante/detrás (API) se rompen con solapes.** `apps/api/src/modules/tracking/vecinos-ruta.service.ts`
  usa `ST_LineLocatePoint` global (sin continuidad ni rumbo) y `vecinos-ruta.util.ts` compara
  `frac` sin distancia circular. Con ida/regreso sobre la misma calle (ya pasaba antes de este fix
  con v91→v43; ahora también v0..v43 y el ramal) el orden y la distancia salen mal. Arreglo:
  proyectar con continuidad por sesión (último `frac`, `ST_LineSubstring` de ventana) o por
  progreso de vuelta, y distancia circular en rutas cerradas.
- El snap visual mobile (`snap-ruta.ts`) usa ventana ±15 segmentos/300 m + rumbo (±60° a ≥2 m/s):
  aguanta el solape en movimiento; parado/primer fix sin rumbo puede caer en la pasada equivocada.
  Candidato a tests en `snap-ruta.test.ts`. El "Se encuentra a X km" es haversine en línea recta,
  no distancia por la ruta.

- El "recorrido inverso" del editor web (`use-route-drawing.ts` `empezarRecorridoInverso`) tiene el
  mismo defecto (invierte la polilínea). Candidato a usar el mismo ajuste por calles.
