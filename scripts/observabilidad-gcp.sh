#!/usr/bin/env bash
# Observabilidad de producción en GCP (proyecto quivo-control-prod): canal de email, uptime
# check, políticas de alerta, presupuesto de facturación y PITR de Cloud SQL. Los errores de
# aplicación van por Sentry (secreto SENTRY_DSN_API, ver scripts/deploy-gcp.sh); esto cubre
# la infraestructura.
#
# Idempotente: cada recurso se busca por nombre visible y solo se crea si falta; correrlo dos
# veces no duplica nada. DRY-RUN por defecto: imprime qué crearía sin escribir en GCP. Las
# consultas de existencia (list/describe) son de solo lectura y corren también en dry-run.
#
# Uso:
#   ALERT_EMAIL=ops@ejemplo.com BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX BUDGET_USD=100 \
#     scripts/observabilidad-gcp.sh [--apply] [--con-reinicio]
#
#   --apply         escribe de verdad (sin esto, solo imprime).
#   --con-reinicio  autoriza el paso de PITR, que REINICIA la base (ver abajo). Sin este flag
#                   el paso se omite con una advertencia.
#
# Variables:
#   ALERT_EMAIL      (obligatoria) destino de las alertas.
#   BILLING_ACCOUNT  cuenta de facturación; sin ella se omite el presupuesto.
#   BUDGET_USD       monto mensual del presupuesto en USD; sin él se omite el presupuesto.
#                    La moneda de la cuenta de facturación debe ser USD.
#   PROJECT, REGION, SQL_INSTANCE, REDIS_INSTANCE: por defecto se leen de scripts/deploy-gcp.sh
#                    (misma fuente de verdad); se pueden pisar por entorno.
#
# PITR: la doc de Cloud SQL dice "Enabling and deactivating PITR requires restarting the
# database" (docs.cloud.google.com/sql/docs/postgres/backup-recovery/restore). Por eso exige
# --con-reinicio: correrlo fuera de horario (los choferes mandan GPS todo el día). Si ya está
# activo no hace nada ni reinicia.
#
# Permisos necesarios (sesión de gcloud del CTO): Monitoring Editor, Cloud SQL Admin y
# Billing Budgets Admin. Probalo primero sin --apply.
set -Eeuo pipefail

info() { printf '\033[1;36m[OBSERVABILIDAD]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[OBSERVABILIDAD]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[OBSERVABILIDAD]\033[0m %s\n' "$*" >&2; exit 1; }

APPLY=false
CON_REINICIO=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --con-reinicio) CON_REINICIO=true ;;
    -h|--help) sed -n '2,33p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) fail "Argumento desconocido: $arg (usá --apply, --con-reinicio o --help)." ;;
  esac
done

command -v gcloud >/dev/null 2>&1 || fail "Falta 'gcloud'. Instalalo antes de continuar."
[[ -n "${ALERT_EMAIL:-}" ]] || fail "Falta ALERT_EMAIL (destino de las alertas). Ej: ALERT_EMAIL=ops@ejemplo.com $0"

# Misma fuente de verdad que el deploy: se leen sus constantes `readonly X="..."`.
DEPLOY_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/deploy-gcp.sh"
leer_constante() {
  local valor
  valor="$(sed -n "s/^readonly $1=\"\([^\"]*\)\"\$/\1/p" "$DEPLOY_SCRIPT" | head -n1)"
  [[ -n "$valor" ]] || fail "No pude leer $1 de $DEPLOY_SCRIPT. Definilo por entorno."
  printf '%s' "$valor"
}
PROJECT="${PROJECT:-$(leer_constante PROJECT)}"
PROJECT_NUMBER="${PROJECT_NUMBER:-$(leer_constante PROJECT_NUMBER)}"
REGION="${REGION:-$(leer_constante REGION)}"
SQL_INSTANCE="${SQL_INSTANCE:-$(leer_constante SQL_INSTANCE)}"
readonly PROJECT PROJECT_NUMBER REGION SQL_INSTANCE

if [[ "$APPLY" == true ]]; then
  info "Modo --apply: se ESCRIBE en $PROJECT."
else
  info "Modo dry-run (sin --apply): no se escribe nada en $PROJECT."
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Ejecuta (o solo imprime en dry-run) un comando de escritura.
escribir() {
  if [[ "$APPLY" == true ]]; then
    "$@"
  else
    info "  [dry-run] $*"
  fi
}

# ---------- 1. Canal de notificación por email ----------
# `channels` no está en el track GA de gcloud: se usa beta.
CANAL_NOMBRE="Quivo alertas email"
buscar_canal() {
  gcloud beta monitoring channels list --project="$PROJECT" \
    --filter="displayName=\"$CANAL_NOMBRE\"" --format='value(name)' 2>/dev/null | head -n1 || true
}
CANAL_ID="$(buscar_canal)"
if [[ -n "$CANAL_ID" ]]; then
  info "Canal '$CANAL_NOMBRE' ya existe — OK."
else
  info "Creando canal de email '$CANAL_NOMBRE' → $ALERT_EMAIL"
  escribir gcloud beta monitoring channels create --project="$PROJECT" \
    --display-name="$CANAL_NOMBRE" --type=email --channel-labels="email_address=$ALERT_EMAIL"
  if [[ "$APPLY" == true ]]; then
    CANAL_ID="$(buscar_canal)"
    [[ -n "$CANAL_ID" ]] || fail "El canal se creó pero no se pudo leer su id."
  else
    CANAL_ID="projects/$PROJECT/notificationChannels/<id-del-canal>"
  fi
fi

# ---------- helpers de políticas ----------
# crear_politica "nombre" archivo.json — salta si ya existe una con ese displayName.
crear_politica() {
  local nombre="$1" archivo="$2" existente
  existente="$(gcloud monitoring policies list --project="$PROJECT" \
    --filter="displayName=\"$nombre\"" --format='value(name)' 2>/dev/null | head -n1 || true)"
  if [[ -n "$existente" ]]; then
    info "Política '$nombre' ya existe — OK."
  else
    info "Creando política '$nombre'"
    escribir gcloud monitoring policies create --project="$PROJECT" --policy-from-file="$archivo"
  fi
}

# politica_umbral nombre filtro duracion periodo alineador umbral [reductor agrupar]
# Política de umbral (GT) sobre una serie. El filtro llega con las comillas ya escapadas (\").
politica_umbral() {
  local nombre="$1" filtro="$2" duracion="$3" periodo="$4" alineador="$5" umbral="$6"
  local reductor="${7:-}" agrupar="${8:-}" cross=""
  local archivo="$TMP_DIR/${nombre//[^A-Za-z0-9]/_}.json"
  if [[ -n "$reductor" ]]; then
    cross=", \"crossSeriesReducer\": \"$reductor\""
    [[ -n "$agrupar" ]] && cross+=", \"groupByFields\": [\"$agrupar\"]"
  fi
  cat >"$archivo" <<JSON
{
  "displayName": "$nombre",
  "combiner": "OR",
  "notificationChannels": ["$CANAL_ID"],
  "conditions": [{
    "displayName": "$nombre",
    "conditionThreshold": {
      "filter": "$filtro",
      "comparison": "COMPARISON_GT",
      "thresholdValue": $umbral,
      "duration": "$duracion",
      "aggregations": [{"alignmentPeriod": "$periodo", "perSeriesAligner": "$alineador"$cross}]
    }
  }]
}
JSON
  crear_politica "$nombre" "$archivo"
}

# ---------- 2. Uptime check + política ----------
API_URL="$(gcloud run services describe quivo-api --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)' 2>/dev/null || true)"
if [[ -z "$API_URL" ]]; then
  warn "No pude leer la URL de quivo-api (¿sin sesión de gcloud o servicio no desplegado?) — se omite el uptime check."
else
  API_HOST="${API_URL#https://}"
  UPTIME_NOMBRE="quivo-api health ready"
  buscar_uptime() {
    gcloud monitoring uptime list-configs --project="$PROJECT" \
      --filter="displayName=\"$UPTIME_NOMBRE\"" --format='value(name)' 2>/dev/null | head -n1 || true
  }
  UPTIME_ID="$(buscar_uptime)"
  if [[ -n "$UPTIME_ID" ]]; then
    info "Uptime check '$UPTIME_NOMBRE' ya existe — OK."
  else
    info "Creando uptime check '$UPTIME_NOMBRE' → https://$API_HOST/v1/health/ready"
    escribir gcloud monitoring uptime create "$UPTIME_NOMBRE" --project="$PROJECT" \
      --resource-type=uptime-url --resource-labels="host=$API_HOST,project_id=$PROJECT" \
      --protocol=https --path=/v1/health/ready --status-classes=2xx --period=5 --timeout=10
    if [[ "$APPLY" == true ]]; then
      UPTIME_ID="$(buscar_uptime)"
      [[ -n "$UPTIME_ID" ]] || fail "El uptime check se creó pero no se pudo leer su id."
    fi
  fi
  UPTIME_ID="${UPTIME_ID##*/}"
  : "${UPTIME_ID:=<id-del-uptime>}"
  # Receta estándar de la doc de Cloud Monitoring: dispara si >1 ubicación reporta
  # check_passed=false. `period=5` es en minutos; la ventana de 1200s es la de la receta.
  UPTIME_POL="Quivo API caida (uptime)"
  cat >"$TMP_DIR/uptime.json" <<JSON
{
  "displayName": "$UPTIME_POL",
  "combiner": "OR",
  "notificationChannels": ["$CANAL_ID"],
  "conditions": [{
    "displayName": "$UPTIME_POL",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"$UPTIME_ID\" AND resource.type=\"uptime_url\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "0s",
      "aggregations": [{"alignmentPeriod": "1200s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.host"]}]
    }
  }]
}
JSON
  crear_politica "$UPTIME_POL" "$TMP_DIR/uptime.json"
fi

# ---------- 3. Políticas de alerta ----------
# Tipos de métrica verificados en docs.cloud.google.com/monitoring/api/metrics_gcp_c (Cloud SQL),
# metrics_gcp_p_z (Cloud Run, Redis) y /monitoring/api/resources (labels de recursos).
Q='\"'  # comilla escapada para incrustar filtros en JSON
SQL_RES="resource.type=${Q}cloudsql_database${Q} AND resource.labels.database_id=${Q}${PROJECT}:${SQL_INSTANCE}${Q}"

politica_umbral "Quivo API 5xx altos" \
  "metric.type=${Q}run.googleapis.com/request_count${Q} AND resource.type=${Q}cloud_run_revision${Q} AND resource.labels.service_name=${Q}quivo-api${Q} AND metric.labels.response_code_class=${Q}5xx${Q}" \
  0s 300s ALIGN_DELTA 5 REDUCE_SUM

# cpu/utilization y disk/utilization son fracciones 0-1 (0.8 = 80%).
politica_umbral "Quivo Cloud SQL CPU alta" \
  "metric.type=${Q}cloudsql.googleapis.com/database/cpu/utilization${Q} AND ${SQL_RES}" \
  600s 60s ALIGN_MEAN 0.8

# max_connections=50 en db-g1-small → 40 = 80%.
politica_umbral "Quivo Cloud SQL conexiones altas" \
  "metric.type=${Q}cloudsql.googleapis.com/database/postgresql/num_backends${Q} AND ${SQL_RES}" \
  300s 60s ALIGN_MEAN 40 REDUCE_SUM resource.label.database_id

politica_umbral "Quivo Cloud SQL disco alto" \
  "metric.type=${Q}cloudsql.googleapis.com/database/disk/utilization${Q} AND ${SQL_RES}" \
  300s 60s ALIGN_MEAN 0.8

# Un solo Redis en el proyecto: se filtra por tipo de recurso, sin label de instancia.
politica_umbral "Quivo Redis memoria alta" \
  "metric.type=${Q}redis.googleapis.com/stats/memory/usage_ratio${Q} AND resource.type=${Q}redis_instance${Q}" \
  300s 60s ALIGN_MEAN 0.7

# Worker pool: container/instance_count existe para cloud_run_worker_pool (doc de métricas).
# Se alerta por AUSENCIA de la serie (0 instancias no reportan puntos) durante 5 min.
WORKER_POL="Quivo worker sin instancias"
cat >"$TMP_DIR/worker.json" <<JSON
{
  "displayName": "$WORKER_POL",
  "combiner": "OR",
  "notificationChannels": ["$CANAL_ID"],
  "conditions": [{
    "displayName": "$WORKER_POL",
    "conditionAbsent": {
      "filter": "metric.type=${Q}run.googleapis.com/container/instance_count${Q} AND resource.type=${Q}cloud_run_worker_pool${Q} AND resource.labels.worker_pool_name=${Q}quivo-worker${Q}",
      "duration": "300s",
      "aggregations": [{"alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_MEAN", "crossSeriesReducer": "REDUCE_SUM"}]
    }
  }]
}
JSON
crear_politica "$WORKER_POL" "$TMP_DIR/worker.json"

# Omitido a propósito: métrica log-based del backlog de ingesta. El worker solo loguea
# "cola pendiente=N" al terminar cada job (ingesta-worker.service.ts): si el worker se traba,
# deja de loguear y la alerta nunca dispararía. La caída del worker ya la cubre la política
# de arriba.
info "Omitido: alerta de backlog de la cola de ingesta (el worker solo loguea la cola al completar un job; ver comentario)."

# ---------- 4. Presupuesto de facturación ----------
if [[ -z "${BILLING_ACCOUNT:-}" || -z "${BUDGET_USD:-}" ]]; then
  warn "Falta BILLING_ACCOUNT y/o BUDGET_USD — se omite el presupuesto."
else
  [[ "$BUDGET_USD" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail "BUDGET_USD debe ser un número (ej: 100)."
  BUDGET_NOMBRE="Quivo mensual"
  existente="$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
    --filter="displayName=\"$BUDGET_NOMBRE\"" --format='value(name)' 2>/dev/null | head -n1 || true)"
  if [[ -n "$existente" ]]; then
    info "Presupuesto '$BUDGET_NOMBRE' ya existe — OK."
  else
    info "Creando presupuesto '$BUDGET_NOMBRE' (${BUDGET_USD} USD/mes, alertas 50/90/100%)"
    escribir gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
      --display-name="$BUDGET_NOMBRE" --budget-amount="${BUDGET_USD}USD" \
      --filter-projects="projects/$PROJECT_NUMBER" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
      --notifications-rule-monitoring-notification-channels="$CANAL_ID"
  fi
fi

# ---------- 5. PITR de Cloud SQL ----------
# Un solo describe: si falla o viene vacío el estado es desconocido y NUNCA se parchea (evita pisar backups).
estado_sql="$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT" \
  --format='value(settings.backupConfiguration.pointInTimeRecoveryEnabled,settings.backupConfiguration.enabled)' 2>/dev/null)" \
  || estado_sql=""
if [[ -z "${estado_sql//[[:space:]]/}" ]]; then
  if [[ "$APPLY" == true ]]; then
    fail "No se pudo leer el estado de PITR/backups de '$SQL_INSTANCE' (¿sesión de gcloud vencida, falta de permisos o instancia incorrecta?). No se aplica nada."
  fi
  warn "No se pudo leer el estado de PITR/backups de '$SQL_INSTANCE'. Se omite el paso de PITR."
  pitr_activo="omitir"
else
  # read con IFS=tab colapsaría un primer campo vacío; se separa por expansión.
  pitr_activo="${estado_sql%%$'\t'*}"
  backup_activo="${estado_sql#*$'\t'}"
fi
if [[ "$pitr_activo" == "omitir" ]]; then
  :
elif [[ "${pitr_activo,,}" == "true" ]]; then
  info "PITR ya está activo en '$SQL_INSTANCE' — OK."
elif [[ "$CON_REINICIO" != true ]]; then
  warn "PITR NO activo en '$SQL_INSTANCE'. Habilitarlo REINICIA la base: correlo fuera de horario con --con-reinicio. Se omite."
else
  warn "Habilitar PITR REINICIA '$SQL_INSTANCE' (la API y el worker pierden la conexión unos minutos). Corré esto fuera de horario."
  # Backups automáticos son prerrequisito del PITR; 07:00 UTC = 03:00 en Bolivia.
  backup_flags=()
  [[ "${backup_activo,,}" == "true" ]] || backup_flags=(--backup --backup-start-time=07:00)
  info "Habilitando PITR en '$SQL_INSTANCE'"
  escribir gcloud sql instances patch "$SQL_INSTANCE" --project="$PROJECT" --quiet \
    --enable-point-in-time-recovery ${backup_flags[@]+"${backup_flags[@]}"}
fi

info "Listo."
[[ "$APPLY" == true ]] || info "Fue un dry-run: repetí con --apply para crear lo que falta."
