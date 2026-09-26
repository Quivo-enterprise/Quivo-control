#!/usr/bin/env bash
# Corre el recompute completo de `gps_sesion_resumen` (docs/runbooks/retencion-gps.md,
# sección "gps_sesion_resumen — recompute obligatorio tras el despliegue del worker nuevo")
# dentro de la VPC de producción, usando el mismo Cloud Run Job de migraciones
# (`quivo-migraciones`) que scripts/deploy-gcp.sh — Cloud SQL en prod es de IP privada
# únicamente (--no-assign-ip), así que no hay forma de correr SQL contra ella desde fuera de
# la VPC (ni psql local, ni una GitHub Action llegan a la IP privada).
#
# El SQL en sí vive en scripts/sql/recompute-gps-sesion-resumen.sql (fuente única, ver ese
# archivo) — este script solo lo empaqueta para pasarlo por `gcloud run jobs execute --args`.
#
# Cuándo correr: UNA VEZ, apenas el worker nuevo (el que hace upsert a `gps_sesion_resumen`
# en el mismo statement que la evidencia, ver docs/plan-en-vivo-resumen-sesion.md) esté en
# vivo en producción. Es seguro correrlo más de una vez — el SQL es un recompute completo
# (no incremental) acotado a HOY y AYER, así que es idempotente.
#
# Uso:
#   scripts/recompute-resumen-gps.sh              # ejecuta de verdad contra prod
#   scripts/recompute-resumen-gps.sh --dry-run     # solo imprime qué se ejecutaría
#
# Override de infra por variable de entorno (default = mismos valores que deploy-gcp.sh):
#   PROJECT=quivo-control-prod REGION=southamerica-west1 JOB=quivo-migraciones \
#     scripts/recompute-resumen-gps.sh
set -euo pipefail

# ---------- logging (mismo estilo que scripts/deploy-gcp.sh) ----------
info() {
  printf '\033[1;36m[RECOMPUTE-GPS]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[RECOMPUTE-GPS]\033[0m %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Falta '$1'. Instálalo antes de continuar."
}

# Misma guarda que scripts/deploy-gcp.sh (ver el comentario grande arriba de ROTATE_JS ahí):
# `gcloud run jobs execute --args=...` soporta un delimitador alternativo (`^%%^val1%%val2`)
# para esquivar el bug real de producción donde gcloud parte el valor por comas. Ese
# delimitador alternativo solo es seguro si NINGÚN valor real contiene literalmente `%%` —
# se define localmente acá (este script no sourcea deploy-gcp.sh) con la misma lógica.
fail_if_delimiter_collision() {
  local nombre="$1" valor="$2"
  case "$valor" in
    *'%%'*)
      fail "El valor de '$nombre' contiene literalmente '%%', el delimitador alternativo usado para pasárselo a gcloud (\`^%%^...\`) en vez de coma. Si se pasa así tal cual, gcloud lo va a partir en el lugar equivocado. Cambiar el delimitador en este script y volver a correrlo."
      ;;
  esac
}

require_command gcloud
require_command base64
require_command grep

# ---------- parseo de argumentos ----------
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      fail "Argumento inesperado: '$arg'. Uso: scripts/recompute-resumen-gps.sh [--dry-run]"
      ;;
  esac
done

# ---------- infra (override por env var, mismos defaults que deploy-gcp.sh) ----------
PROJECT="${PROJECT:-quivo-control-prod}"
REGION="${REGION:-southamerica-west1}"
JOB="${JOB:-quivo-migraciones}"

# ---------- el .sql (ruta relativa al directorio del script, no al cwd del caller) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/sql/recompute-gps-sesion-resumen.sql"
[[ -f "$SQL_FILE" ]] || fail "No se encontró '$SQL_FILE'."

# base64 sin saltos de línea (-w0): el alfabeto base64 (A-Za-z0-9+/=) no tiene comas, no
# tiene comillas y no tiene '%%', así que viaja sin escapar ni por el delimitador alternativo
# de gcloud (ver fail_if_delimiter_collision arriba) ni dentro del `printf %s ... | base64 -d`
# que lo decodifica adentro del contenedor.
SQL_B64="$(base64 -w0 "$SQL_FILE")"

# JS que corre adentro del contenedor (node:22-alpine, confirmado en scripts/deploy-gcp.sh
# que trae `pg` resoluble desde /app/packages/db y NO trae psql). Mismo patrón que ROTATE_JS
# en deploy-gcp.sh: heredoc con delimitador ENTRECOMILLADO ('JS_EOF') para que bash no
# expanda nada adentro, aplanado a una sola línea después. A propósito, este JS usa SOLO
# comillas dobles (nunca comillas simples) porque termina envuelto en comillas simples de
# shell (`node -e '...'`, más abajo) — cualquier comilla simple adentro rompería ese quoting,
# por eso el guard de más abajo aborta si aparece una.
#
# `client.query(sql)` sin params corre el archivo completo como un simple query de Postgres
# (protocolo simple, no extendido) — eso es lo que permite múltiples statements separados por
# ';' en un solo round-trip, incluyendo el BEGIN/COMMIT propios del .sql. `pg` devuelve un
# array de resultados (uno por statement) cuando el query tiene más de un statement, así que
# se normaliza con Array.isArray antes de loguear `command`/`rowCount` de cada uno.
#
# En error: el .sql ya abre su propia transacción (BEGIN ... COMMIT), así que si algún
# statement falla a mitad de camino Postgres la deja abierta y abortada — se manda un
# ROLLBACK best-effort (envuelto en su propio try/catch: si la conexión ya se cayó, ese
# ROLLBACK también va a fallar, y no debe tapar el error original) antes de salir con
# exit(1), para no dejar una transacción colgada en la sesión del Job.
read -r -d '' NODE_JS <<'JS_EOF' || true
const fs=require("fs");
const {Client}=require("pg");
const client=new Client({connectionString:process.env.DATABASE_URL});
(async()=>{
  const sql=fs.readFileSync("/tmp/recompute.sql","utf8");
  await client.connect();
  try{
    const res=await client.query(sql);
    const results=Array.isArray(res)?res:[res];
    for(const r of results){
      console.log((r.command||"?")+" rowCount="+r.rowCount);
    }
    await client.end();
  }catch(e){
    console.error(e);
    try{
      await client.query("ROLLBACK");
    }catch(e2){
      console.error("ROLLBACK best-effort fallo (probablemente la conexion ya se cayo):",e2.message);
    }
    try{
      await client.end();
    }catch(e3){}
    process.exit(1);
  }
})().catch((e)=>{console.error(e);process.exit(1);});
JS_EOF
NODE_JS="$(printf '%s' "$NODE_JS" | tr '\n' ' ')"

case "$NODE_JS" in
  *"'"*)
    fail "El JS del recompute contiene una comilla simple, lo cual rompe el 'node -e ...' de más abajo (va envuelto en comillas simples de shell). Revisar NODE_JS en este script."
    ;;
esac

# Script que corre /bin/sh -c adentro del contenedor: decodifica el .sql a /tmp/recompute.sql
# y lo corre con el JS de arriba. Mismo delimitador alternativo (`^%%^-c%%...`) que
# deploy-gcp.sh para el --args de gcloud (ver fail_if_delimiter_collision arriba).
CONTAINER_SCRIPT="cd /app/packages/db && printf %s ${SQL_B64} | base64 -d > /tmp/recompute.sql && node -e '${NODE_JS}'"
fail_if_delimiter_collision "CONTAINER_SCRIPT" "$CONTAINER_SCRIPT"

GCLOUD_CMD=(gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait
  "--args=^%%^-c%%${CONTAINER_SCRIPT}")

if [[ "$DRY_RUN" == true ]]; then
  info "--dry-run: no se ejecuta nada. Esto es lo que correría:"
  echo
  info "Script del contenedor (decodificado):"
  printf '%s\n' "$CONTAINER_SCRIPT"
  echo
  info "Comando de gcloud:"
  printf '%q ' "${GCLOUD_CMD[@]}"
  echo
  exit 0
fi

info "Ejecutando el recompute de gps_sesion_resumen dentro de la VPC (job '$JOB', proyecto '$PROJECT', región '$REGION')..."
set +e
EXECUTE_OUTPUT="$("${GCLOUD_CMD[@]}" 2>&1)"
EXECUTE_STATUS=$?
set -e
printf '%s\n' "$EXECUTE_OUTPUT"

# Intenta sacar el nombre de la ejecución (p. ej. "quivo-migraciones-abcde") del output de
# `gcloud run jobs execute` para poder filtrar los logs por
# labels."run.googleapis.com/execution_name" en vez de traer las últimas N líneas del Job
# entero (que pueden ser de otra ejecución, p. ej. una migración corrida en paralelo). Si el
# formato del output cambia y no matchea, cae al filtro genérico por job (ver abajo) — no es
# fatal, solo menos preciso.
EXECUTION_NAME="$(printf '%s' "$EXECUTE_OUTPUT" | grep -oE "${JOB}-[a-z0-9]+" | head -1 || true)"

info "Para leer los logs de esta ejecución:"
if [[ -n "$EXECUTION_NAME" ]]; then
  printf '  gcloud logging read '\''resource.type="cloud_run_job" AND resource.labels.job_name="%s" AND labels."run.googleapis.com/execution_name"="%s"'\'' --project=%s --limit=50 --order=asc\n' \
    "$JOB" "$EXECUTION_NAME" "$PROJECT"
else
  printf '  gcloud logging read '\''resource.type="cloud_run_job" AND resource.labels.job_name="%s"'\'' --project=%s --limit=50 --order=asc\n' \
    "$JOB" "$PROJECT"
fi

if [[ $EXECUTE_STATUS -ne 0 ]]; then
  fail "La ejecución del job de recompute falló (status $EXECUTE_STATUS). Ver el output y los logs de arriba."
fi

info "Recompute de gps_sesion_resumen terminado OK."
