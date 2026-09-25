#!/usr/bin/env bash
# Corre las migraciones reales de packages/db (`prisma migrate deploy`) contra el
# DATABASE_URL de la instancia temporal (docs/plan-experimento-puntos-gps.md §10: "migraciones
# reales de packages/db, RLS activa" — mismo requisito que la matriz local).
#
# No usa el DATABASE_URL de packages/db/.env: arma un DATABASE_URL a partir de
# QUIVO_CARGA_DATABASE_URL (~/.quivo-carga-temp.env, creado por ./crear.sh) y lo pasa SOLO al
# subproceso de `prisma` (hallazgo 10 de revisión, 2026-09-22) — nunca lo exporta a esta shell
# ni queda seteado más allá de esa invocación puntual. `crear.sh` deliberadamente NO exporta
# un `DATABASE_URL` genérico en el env file (mismo motivo): que quede en la shell interactiva
# del CTO haría que cualquier otro comando de esa sesión que confíe en `DATABASE_URL` apunte
# en silencio a la instancia temporal en vez de a lo que esperaba.
#
# Uso: ./migrar.sh
set -euo pipefail

ENV_FILE="${HOME}/.quivo-carga-temp.env"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
PAQUETE_DB="${REPO_ROOT}/packages/db"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ABORTADO: no existe $ENV_FILE — correr ./crear.sh primero." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${QUIVO_CARGA_DATABASE_URL:-}" ]]; then
  echo "ABORTADO: $ENV_FILE no define QUIVO_CARGA_DATABASE_URL." >&2
  exit 1
fi

if [[ ! -d "$PAQUETE_DB" ]]; then
  echo "ABORTADO: no se encontró packages/db en $PAQUETE_DB (¿se movió este script?)." >&2
  exit 1
fi

echo "Corriendo 'prisma migrate deploy' contra ${QUIVO_CARGA_TEMP_INSTANCIA:-instancia temporal} (${QUIVO_CARGA_TEMP_IP:-?})..."
(
  cd "$PAQUETE_DB"
  DATABASE_URL="$QUIVO_CARGA_DATABASE_URL" pnpm exec prisma migrate deploy
)

echo ""
echo "Migraciones aplicadas. Rol 'quivo_app' creado por la migración RLS con password"
echo "'quivo_app_dev' (hardcodeada en el SQL, no configurable) — los scripts .mjs del harness"
echo "la usan solos (lib/pg.mjs), no hace falta anotarla acá."
echo ""
echo "Siguiente paso: node ../seed.mjs 500 (QUIVO_CARGA_DATABASE_URL ya está exportada en esta shell)."
