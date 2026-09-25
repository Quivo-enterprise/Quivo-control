#!/usr/bin/env bash
# Limpieza del experimento: detiene y borra SOLO los recursos `quivo-carga-*` creados por
# levantar.sh. Nunca toca contenedores/volúmenes/redes del proyecto (quivo-control-postgres-1,
# quivo-pg, quivo-redis, etc).
set -euo pipefail

NOMBRE="quivo-carga-pg"
VOLUMEN="quivo-carga-pgdata"
RED="quivo-carga-net"

echo "Deteniendo/borrando contenedor $NOMBRE (si existe)..."
docker rm -f "$NOMBRE" >/dev/null 2>&1 || true

if [ "${1:-}" == "--volumen" ]; then
  echo "Borrando volumen $VOLUMEN..."
  docker volume rm "$VOLUMEN" >/dev/null 2>&1 || true
else
  echo "Volumen $VOLUMEN conservado (pasar --volumen para borrarlo también)."
fi

echo "Borrando red $RED (si existe)..."
docker network rm "$RED" >/dev/null 2>&1 || true

echo "Recursos quivo-carga-* restantes (debería estar vacío):"
docker ps -a --filter "name=quivo-carga-" --format '{{.Names}}'
docker volume ls --filter "name=quivo-carga-" --format '{{.Name}}'
docker network ls --filter "name=quivo-carga-" --format '{{.Name}}'
