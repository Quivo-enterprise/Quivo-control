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

- El "recorrido inverso" del editor web (`use-route-drawing.ts` `empezarRecorridoInverso`) tiene el
  mismo defecto (invierte la polilínea). Candidato a usar el mismo ajuste por calles.
