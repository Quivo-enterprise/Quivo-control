#!/usr/bin/env bash
# Levanta un Postgres/PostGIS LOCAL y AISLADO para el experimento de carga de puntos GPS
# (docs/plan-experimento-puntos-gps.md, paso B). NUNCA toca el docker-compose del proyecto
# (contenedor `quivo-control-postgres-1` / `quivo-pg`) ni sus volúmenes: todo lo que crea
# este script usa el prefijo `quivo-carga-` (contenedor, volumen, red) y el puerto host
# 55432 (libre — el proyecto usa 5434).
#
# Uso: ./levantar.sh <perfil>
#   perfiles: c1 (1 cpu / 3.75g), c2 (2 cpu / 7.5g), c4 (4 cpu / 15g), c8 (8 cpu / 30g)
#   Override de memoria (para hosts con RAM ajustada): QUIVO_CARGA_MEM=5g ./levantar.sh c2
#
# Reusa el volumen `quivo-carga-pgdata` entre perfiles (para no repetir migrate+seed+precarga
# en cada corrida de la matriz) — parar+recrear el contenedor cambia `--cpus`/`--memory` y los
# flags de `shared_buffers` sin perder los datos. Para arrancar de cero: ./detener.sh --volumen.
set -euo pipefail

PERFIL="${1:-}"
IMAGEN="postgis/postgis:16-3.4-alpine"
NOMBRE="quivo-carga-pg"
VOLUMEN="quivo-carga-pgdata"
RED="quivo-carga-net"
PUERTO_HOST="55432"

case "$PERFIL" in
  c1) CPUS=1; MEM_NOMINAL="3840m" ;;   # ≈ db-custom-1-3840
  c2) CPUS=2; MEM_NOMINAL="7680m" ;;   # ≈ db-custom-2-7680
  c4) CPUS=4; MEM_NOMINAL="15360m" ;;  # ≈ db-custom-4-15360
  c8) CPUS=8; MEM_NOMINAL="30720m" ;;  # ≈ db-custom-8-30720
  *)
    echo "Uso: $0 {c1|c2|c4|c8}" >&2
    exit 1
    ;;
esac

MEM="${QUIVO_CARGA_MEM:-$MEM_NOMINAL}"
if [ "$MEM" != "$MEM_NOMINAL" ]; then
  echo "AVISO: memoria de $PERFIL forzada a $MEM (nominal $MEM_NOMINAL) por QUIVO_CARGA_MEM — anotar en resumen.md" >&2
fi

# Hallazgo 11 de revisión (2026-09-22): antes, `sed 's/[a-zA-Z]*$//'` + `[[ "$MEM" == *g ]]`
# solo reconocía el sufijo 'g' en minúscula EXACTA — "5G"/"5Gb"/"5" sin sufijo se colaban
# silenciosamente como si fueran MB (p.ej. "5G" perdía el sufijo, quedaba MEM_MB=5, un
# contenedor de 5 MB en vez de 5 GB) y un valor no numérico (typo) daba un error de bash
# oscuro en la aritmética en vez de un mensaje claro. Ahora se valida contra una regex
# explícita (`<entero><M|m|G|g>`, sufijo obligatorio) y se aborta fuerte si no matchea.
if [[ ! "$MEM" =~ ^([0-9]+)([MmGg])$ ]]; then
  echo "ABORTADO: QUIVO_CARGA_MEM='$MEM' no es un valor de memoria válido." >&2
  echo "  Formato esperado: <entero><sufijo>, sufijo M o G (mayúscula o minúscula) — p.ej. 4096m, 5G, 7680M." >&2
  exit 1
fi
MEM_NUM="${BASH_REMATCH[1]}"
MEM_UNIDAD="$(echo "${BASH_REMATCH[2]}" | tr '[:upper:]' '[:lower:]')"

# shared_buffers ~25% de la memoria del contenedor (regla estándar de Postgres), resto de
# flags: defaults razonables tipo Cloud SQL (WAL/checkpoint suaves, sin exotismos). No es
# la tabla de flags real de Cloud SQL (no pública) — es una aproximación declarada.
MEM_MB="$MEM_NUM"
if [ "$MEM_UNIDAD" = "g" ]; then MEM_MB=$(( MEM_NUM * 1024 )); fi
SHARED_BUFFERS_MB=$(( MEM_MB / 4 ))
EFFECTIVE_CACHE_MB=$(( MEM_MB * 3 / 4 ))
MAINT_WORK_MEM_MB=$(( MEM_MB / 16 ))
if [ "$MAINT_WORK_MEM_MB" -gt 1024 ]; then MAINT_WORK_MEM_MB=1024; fi

echo "== Perfil $PERFIL: --cpus=$CPUS --memory=$MEM | shared_buffers=${SHARED_BUFFERS_MB}MB effective_cache_size=${EFFECTIVE_CACHE_MB}MB maintenance_work_mem=${MAINT_WORK_MEM_MB}MB =="

docker network inspect "$RED" >/dev/null 2>&1 || docker network create "$RED" >/dev/null

if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then
  echo "Deteniendo/removiendo contenedor previo $NOMBRE (se conserva el volumen $VOLUMEN)..."
  docker rm -f "$NOMBRE" >/dev/null
fi

docker run -d \
  --name "$NOMBRE" \
  --network "$RED" \
  --cpus="$CPUS" \
  --memory="$MEM" \
  --memory-swap="$MEM" \
  -p "127.0.0.1:${PUERTO_HOST}:5432" \
  -e POSTGRES_USER=quivo \
  -e POSTGRES_PASSWORD=quivo_dev \
  -e POSTGRES_DB=quivo_control \
  -v "${VOLUMEN}:/var/lib/postgresql/data" \
  "$IMAGEN" \
  -c shared_buffers="${SHARED_BUFFERS_MB}MB" \
  -c effective_cache_size="${EFFECTIVE_CACHE_MB}MB" \
  -c maintenance_work_mem="${MAINT_WORK_MEM_MB}MB" \
  -c work_mem=16MB \
  -c wal_buffers=16MB \
  -c max_wal_size=2GB \
  -c checkpoint_completion_target=0.9 \
  -c random_page_cost=1.1 \
  -c effective_io_concurrency=200 \
  -c max_connections=100 \
  -c synchronous_commit=on \
  >/dev/null

echo "Esperando a que Postgres acepte conexiones en localhost:${PUERTO_HOST}..."
for i in $(seq 1 60); do
  if docker exec "$NOMBRE" pg_isready -h 127.0.0.1 -U quivo -d quivo_control >/dev/null 2>&1; then
    echo "Listo tras ${i}s."
    break
  fi
  sleep 1
done
docker exec "$NOMBRE" pg_isready -h 127.0.0.1 -U quivo -d quivo_control

echo "$NOMBRE arriba. DATABASE_URL=postgresql://quivo:quivo_dev@localhost:${PUERTO_HOST}/quivo_control"
