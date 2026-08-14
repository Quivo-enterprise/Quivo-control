#!/usr/bin/env bash
# Descarga el extracto vial de Bolivia (Geofabrik) y lo procesa para OSRM (motor de ruteo
# self-hosted, sin API key) — se corre una sola vez (o cuando se quiera actualizar el mapa
# vial). `docker compose up osrm` después de esto ya sirve rutas reales sobre calles.
set -Eeuo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DATA_DIR="$REPO_ROOT/osrm-data"
readonly PBF_URL="https://download.geofabrik.de/south-america/bolivia-latest.osm.pbf"
readonly PBF_FILE="$DATA_DIR/bolivia-latest.osm.pbf"
readonly OSRM_BASE="$DATA_DIR/bolivia-latest.osrm"
readonly OSRM_IMAGE="osrm/osrm-backend"

info() { printf '\033[1;36m[OSRM]\033[0m %s\n' "$*"; }

mkdir -p "$DATA_DIR"

if [[ -f "${OSRM_BASE}.mldgr" ]]; then
  info "Ya existe un mapa vial procesado en $DATA_DIR (borra ${OSRM_BASE}.mldgr para reprocesar)."
  exit 0
fi

if [[ ! -f "$PBF_FILE" ]]; then
  info "Descargando extracto de Bolivia desde Geofabrik (puede tardar varios minutos)..."
  curl -L --fail -o "$PBF_FILE.tmp" "$PBF_URL"
  mv "$PBF_FILE.tmp" "$PBF_FILE"
else
  info "Extracto ya descargado en $PBF_FILE."
fi

info "Extrayendo red vial (perfil car)..."
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
  osrm-extract -p /opt/car.lua "/data/$(basename "$PBF_FILE")"

info "Particionando (MLD)..."
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
  osrm-partition "/data/$(basename "$OSRM_BASE")"

info "Generando pesos de ruteo..."
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
  osrm-customize "/data/$(basename "$OSRM_BASE")"

info "Listo. Ahora podés levantar el servicio con: docker compose up -d osrm"
