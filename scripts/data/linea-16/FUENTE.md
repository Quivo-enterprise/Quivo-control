# Fuente de datos — Línea 16

- Google My Maps del Sindicato Mixto de Transporte(istas) Tiquipaya:
  https://www.google.com/maps/d/viewer?mid=1eU_70-dOsPLnzSXFvEQt_bdBtwraQC8
- KML descargado el **2026-10-12** con:
  `curl -sL "https://www.google.com/maps/d/kml?mid=1eU_70-dOsPLnzSXFvEQt_bdBtwraQC8&forcekml=1" -o linea-16-my-maps.kml`
- Es un boceto dibujado a mano (no traza GPS). Lo consume `scripts/cargar-linea-16.ts`.

## Trazado por calles (`trazado-calles.json`, `trazado-vista-previa.geojson`)

El boceto no se carga tal cual: `cargar-linea-16.ts` lo ajusta a calles con la Google Routes API
(`computeRoutes`), tramo por tramo (ida, regreso, conector, ramal), usando como `heading` el rumbo
del boceto en el sentido de cada tramo para caer en la calzada correcta.

- `trazado-calles.json`: resultado versionado (coords por tramo + fecha, sha256 del KML y parámetros).
  Mientras el sha256 del KML coincida, el script lo usa sin llamar a Google.
- `trazado-vista-previa.geojson`: boceto vs. trazado por tramo (`properties.tramo`, `properties.fuente`
  = `boceto` | `calles`), para revisarlo en geojson.io / QGIS.
- Regenerar (si cambia el KML o se quiere recalcular):
  ```
  GOOGLE_ROUTES_API_KEY=$(gcloud secrets versions access latest --secret=google-routes-server-key --project=quivo-control-prod) \
    packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --solo-trazado --recalcular-trazado
  ```
  `--solo-trazado` no toca la API de Quivo. La key no se imprime ni se commitea.
