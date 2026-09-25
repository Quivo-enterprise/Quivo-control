#!/usr/bin/env bash
# CPU y memoria REALES de la instancia temporal durante la ventana medida — el criterio
# principal de "pasa/falla" en remoto (docs/plan-experimento-puntos-gps.md §10: "medir CPU
# de la instancia en Cloud Monitoring como métrica principal, junto con throughput"), ya que
# en remoto no hay `docker stats` (ver la nota de correr-punto.mjs).
#
# `gcloud monitoring time-series list` NO EXISTE en el CLI instalado (verificado: el grupo
# `gcloud monitoring` solo trae `dashboards`/`policies`/`snoozes`/`uptime`, nada de
# time-series). Se llama en cambio directo a la API REST v3 `projects.timeSeries.list`
# (https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list) por
# `curl`, autenticado con el access token de `gcloud auth print-access-token` — mismas
# credenciales que ya usa el resto del runbook, sin depender de un subcomando que no existe.
#
# Uso: ./metricas.sh <desde:RFC3339> <hasta:RFC3339>
#   ej: ./metricas.sh 2026-09-23T14:00:00Z 2026-09-23T14:10:00Z
# Salida: CSV por stdout, columnas: timestamp,metrica,valor
set -euo pipefail

PROYECTO="quivo-control-prod"
NOMBRE="quivo-carga-temp"
DESDE="${1:-}"
HASTA="${2:-}"

if [[ -z "$DESDE" || -z "$HASTA" ]]; then
  echo "Uso: $0 <desde:RFC3339> <hasta:RFC3339>" >&2
  echo "  ej: $0 2026-09-23T14:00:00Z 2026-09-23T14:10:00Z" >&2
  exit 1
fi

TOKEN="$(gcloud auth print-access-token)"
RECURSO_FILTRO="resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${PROYECTO}:${NOMBRE}\""

TMPDIR_METRICAS="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_METRICAS"' EXIT

echo "timestamp,metrica,valor"

for METRICA in cpu/utilization memory/utilization; do
  NOMBRE_METRICA="cloudsql.googleapis.com/database/${METRICA}"
  FILTRO="metric.type=\"${NOMBRE_METRICA}\" AND ${RECURSO_FILTRO}"
  PREFIJO_PAGINA="${TMPDIR_METRICAS}/${METRICA//\//_}"

  # Paginar: la API devuelve `nextPageToken` mientras haya más resultados. Cada página se
  # guarda en su propio archivo (no en líneas de un mismo archivo) porque la respuesta viene
  # con JSON "pretty" (saltos de línea reales) salvo que se pida lo contrario — un archivo
  # por página evita tener que parsear eso.
  PAGE_TOKEN=""
  IDX=0
  while true; do
    ARGS=(
      -sS --fail-with-body -G
      -H "Authorization: Bearer ${TOKEN}"
      --data-urlencode "filter=${FILTRO}"
      --data-urlencode "interval.startTime=${DESDE}"
      --data-urlencode "interval.endTime=${HASTA}"
    )
    if [[ -n "$PAGE_TOKEN" ]]; then
      ARGS+=(--data-urlencode "pageToken=${PAGE_TOKEN}")
    fi
    PAGINA="${PREFIJO_PAGINA}.${IDX}.json"
    if ! curl "${ARGS[@]}" "https://monitoring.googleapis.com/v3/projects/${PROYECTO}/timeSeries" -o "$PAGINA"; then
      echo "ERROR: la llamada a Cloud Monitoring falló (metrica=${METRICA}), ver ${PAGINA}" >&2
      cat "$PAGINA" >&2 2>/dev/null || true
      exit 1
    fi
    PAGE_TOKEN="$(python3 -c "
import json
with open('${PAGINA}') as fh:
    data = json.load(fh)
if 'error' in data:
    raise SystemExit(f\"Cloud Monitoring error: {data['error']}\")
print(data.get('nextPageToken', ''))
")"
    IDX=$((IDX + 1))
    [[ -z "$PAGE_TOKEN" ]] && break
  done

  python3 -c "
import glob, json, sys

etiqueta = '${METRICA}'.split('/')[0]
filas = []
for ruta in glob.glob('${PREFIJO_PAGINA}.*.json'):
    with open(ruta) as fh:
        data = json.load(fh)
    for serie in data.get('timeSeries', []):
        for punto in serie.get('points', []):
            ts = punto.get('interval', {}).get('endTime', '')
            valor = punto.get('value', {}).get('doubleValue')
            if valor is None:
                continue
            filas.append((ts, etiqueta, valor))
filas.sort(key=lambda f: f[0])
for ts, etiqueta_fila, valor in filas:
    print(f'{ts},{etiqueta_fila},{valor}')
"
done
