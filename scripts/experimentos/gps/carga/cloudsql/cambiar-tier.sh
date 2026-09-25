#!/usr/bin/env bash
# Cambia el tier de la instancia TEMPORAL `quivo-carga-temp` (docs/plan-experimento-puntos-gps.md
# §10: perfiles `db-custom-1-3840` y luego `db-custom-2-7680`). Whitelist estricta — cualquier
# otro valor aborta, para no terminar cambiando el tier de una instancia real por typo.
#
# Uso: ./cambiar-tier.sh <db-custom-1-3840|db-custom-2-7680>
set -euo pipefail

PROYECTO="quivo-control-prod"
NOMBRE="quivo-carga-temp"
TIER="${1:-}"

case "$TIER" in
  db-custom-1-3840|db-custom-2-7680) ;;
  *)
    echo "Uso: $0 {db-custom-1-3840|db-custom-2-7680}" >&2
    echo "Tier '$TIER' no está en la whitelist — abortado." >&2
    exit 1
    ;;
esac

if ! gcloud sql instances describe "$NOMBRE" --project="$PROYECTO" >/dev/null 2>&1; then
  echo "ABORTADO: la instancia '$NOMBRE' no existe en '$PROYECTO' — correr ./crear.sh primero." >&2
  exit 1
fi

echo "Cambiando tier de '$NOMBRE' a '$TIER' (bloquea hasta terminar el patch)..."
gcloud sql instances patch "$NOMBRE" --project="$PROYECTO" --tier="$TIER" --quiet

echo "Tier actual tras el patch:"
gcloud sql instances describe "$NOMBRE" --project="$PROYECTO" --format='value(settings.tier)'
