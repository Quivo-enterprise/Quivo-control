#!/usr/bin/env bash
# Borra la instancia Cloud SQL TEMPORAL `quivo-carga-temp` (docs/plan-experimento-puntos-gps.md
# §10: "Se borra al terminar"). Nombre HARDCODEADO, sin argumento — no puede borrar ninguna
# otra instancia por error de tipeo. Borrado OBLIGATORIO al cerrar la confirmación (RUNBOOK.md).
#
# Uso: ./borrar.sh
set -euo pipefail

PROYECTO="quivo-control-prod"
NOMBRE="quivo-carga-temp"
ENV_FILE="${HOME}/.quivo-carga-temp.env"

echo "== Borrando '$NOMBRE' en '$PROYECTO' =="
if gcloud sql instances describe "$NOMBRE" --project="$PROYECTO" >/dev/null 2>&1; then
  gcloud sql instances delete "$NOMBRE" --project="$PROYECTO" --quiet
  echo "Borrada."
else
  echo "'$NOMBRE' no existe (ya estaba borrada, o nunca se creó)."
fi

echo ""
echo "== Verificación: instancias restantes en '$PROYECTO' =="
gcloud sql instances list --project="$PROYECTO"
echo ""
echo "Confirmar arriba que '$NOMBRE' NO aparece en la lista."

if [[ -f "$ENV_FILE" ]]; then
  rm -f "$ENV_FILE"
  echo "Borrado $ENV_FILE."
else
  echo "$ENV_FILE no existía."
fi
