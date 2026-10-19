#!/usr/bin/env bash
# Entorno EFÍMERO de prueba de carga (docs/plan-escalabilidad-30.md, Fase 0). Infra NUEVA y
# vacía (NO es un clon de prod: no hay datos reales ni PII). Producción solo se LEE: describe
# de quivo-db / quivo-redis / quivo-api para copiar versión, tier, imagen y dimensionamiento.
#
# Uso:
#   scripts/carga-efimera.sh alta [--mi-ip A.B.C.D]  # crea SQL, Redis, secretos y despliega api + worker
#   scripts/carga-efimera.sh migrar                  # prisma migrate deploy desde la laptop + rota quivo_app
#   scripts/carga-efimera.sh url-seed                # `export` para seed-conductores-reales.mjs
#   scripts/carga-efimera.sh url-api                 # URL de quivo-api-carga
#   scripts/carga-efimera.sh estado                  # lista los recursos *-carga
#   scripts/carga-efimera.sh baja [--si]             # borra SOLO recursos cuyo nombre termina en -carga
#
# Recursos (todos terminan en -carga; es lo único que `baja` puede tocar):
#   Cloud SQL quivo-db-carga · Memorystore quivo-redis-carga (BASIC 1GB)
#   Cloud Run quivo-api-carga · Worker Pool quivo-worker-carga
#   Secretos DATABASE_URL-carga (admin, IP pública), RUNTIME_DATABASE_URL-carga (quivo_app, socket),
#            REDIS_URL-carga, JWT_SECRET-carga
#
# Notas:
#   - quivo-api-carga queda con --allow-unauthenticated igual que prod: la app móvil se
#     autentica con su propio Bearer opaco; un invoker IAM chocaría con ese header.
#   - La instancia tiene IP privada (VPC default, como prod, para que Cloud Run conecte igual)
#     Y pública, autorizada solo a tu IP /32 con SSL obligatorio, para migrar y sembrar desde la
#     laptop. Las contraseñas se generan y viven solo en Secret Manager (*-carga).
#   - API con el conector VPC quivo-conector y worker con Direct VPC egress, como deploy-gcp.sh.
#   - INGESTA_WORKER_CONCURRENCY no se setea (default del código).
#   - Imagen: la que corre HOY quivo-api en prod (no construye nada).
set -Eeuo pipefail

readonly PROJECT="quivo-control-prod"
readonly PROJECT_NUMBER="741758083365"
readonly REGION="southamerica-west1"
readonly SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
readonly VPC_CONNECTOR="quivo-conector"
readonly VPC_NETWORK="default"
readonly VPC_SUBNET="default"
readonly DB_NAME="quivo_control"

# Origen (prod, solo lectura)
readonly PROD_SQL="quivo-db"
readonly PROD_REDIS="quivo-redis"
readonly PROD_API="quivo-api"

# Destino (efímero). TODO nombre debe terminar en -carga: lo exige `exigir_sufijo`.
readonly SQL_CARGA="quivo-db-carga"
readonly REDIS_CARGA="quivo-redis-carga"
readonly API_CARGA="quivo-api-carga"
readonly WORKER_CARGA="quivo-worker-carga"
readonly S_ADMIN="DATABASE_URL-carga"
readonly S_RUNTIME="RUNTIME_DATABASE_URL-carga"
readonly S_REDIS="REDIS_URL-carga"
readonly S_JWT="JWT_SECRET-carga"
readonly SECRETOS_CARGA=("$S_ADMIN" "$S_RUNTIME" "$S_REDIS" "$S_JWT")

info() { printf '\033[1;36m[CARGA-EFIMERA]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[CARGA-EFIMERA]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[CARGA-EFIMERA]\033[0m %s\n' "$*" >&2; exit 1; }

for cmd in gcloud python3 openssl curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Falta '$cmd'."
done

# Guarda dura: ninguna escritura/borrado pasa sin esto.
exigir_sufijo() {
  [[ "$1" == *-carga ]] || fail "GUARDA: '$1' no termina en '-carga'. Me niego a tocarlo."
}

nota_costo() {
  cat <<'EOF'
Costo estimado (precio de lista, verificar en southamerica-west1): Cloud SQL db-g1-small ~US$0.03-0.05/h
+ 10 GB SSD, Redis BASIC 1GB ~US$0.05/h, Cloud Run api/worker con min-instances 1 ~US$0.05-0.10/h,
conector VPC compartido (ya existe). Orden de magnitud: US$0.15-0.25/h, o sea menos de US$1-2 por
una sesión de 4-6 h. Se cobra mientras existan: corré `baja` al terminar.
EOF
}

gc() { gcloud --project="$PROJECT" "$@"; }

existe_sql()     { gc sql instances describe "$SQL_CARGA" >/dev/null 2>&1; }
existe_redis()   { gc redis instances describe "$REDIS_CARGA" --region="$REGION" >/dev/null 2>&1; }
existe_api()     { gc run services describe "$API_CARGA" --region="$REGION" >/dev/null 2>&1; }
existe_worker()  { gc run worker-pools describe "$WORKER_CARGA" --region="$REGION" >/dev/null 2>&1; }
existe_secreto() { gc secrets describe "$1" >/dev/null 2>&1; }

secreto_valor() { gc secrets versions access latest --secret="$1"; }

crear_secreto() { # nombre valor
  local nombre="$1" valor="$2"
  exigir_sufijo "$nombre"
  if existe_secreto "$nombre"; then
    info "Secreto '$nombre' ya existe, no se toca."
  else
    printf '%s' "$valor" | gc secrets create "$nombre" --replication-policy=automatic --data-file=- >/dev/null
    info "Secreto '$nombre' creado (valor no impreso)."
  fi
  gc secrets add-iam-policy-binding "$nombre" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" --role="roles/secretmanager.secretAccessor" >/dev/null
}

# IP PRIMARY (pública) de la instancia nueva, leída de gcloud. Es lo único que acepta el seed.
ip_publica_instancia() {
  gc sql instances describe "$SQL_CARGA" --format=json | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(next((i["ipAddress"] for i in d.get("ipAddresses", []) if i.get("type") == "PRIMARY"), ""))'
}

# Config de quivo-api en prod (solo lectura) -> JSON de una línea.
config_prod_api() {
  gc run services describe "$PROD_API" --region="$REGION" --format=json | python3 -c '
import json, sys
d = json.load(sys.stdin)
t = d["spec"]["template"]
ann = t.get("metadata", {}).get("annotations", {})
c = t["spec"]["containers"][0]
lim = c.get("resources", {}).get("limits", {})
print(json.dumps({
  "image": c["image"],
  "cpu": lim.get("cpu", "1"),
  "memory": lim.get("memory", "1Gi"),
  "min": ann.get("autoscaling.knative.dev/minScale", "1"),
  "max": ann.get("autoscaling.knative.dev/maxScale", "3"),
  "concurrency": t["spec"].get("containerConcurrency", 80),
  "timeout": t["spec"].get("timeoutSeconds", 300),
  "cpu_throttling": ann.get("run.googleapis.com/cpu-throttling", "true"),
  "env": {e["name"]: e["value"] for e in c.get("env", []) if "value" in e},
}))'
}

json_get() { python3 -c 'import json,sys; v=json.loads(sys.argv[1])[sys.argv[2]]; print(v if not isinstance(v,(dict,list)) else json.dumps(v))' "$1" "$2"; }

# Env vars planas de prod -> "^%%^k=v%%k=v" (delimitador alternativo, ver deploy-gcp.sh).
# Se descartan SENTRY_* (no ensuciar el Sentry de prod) y CORS_ORIGIN; se pisa BETTER_AUTH_URL.
env_flag() { # json_env url_propia
  python3 -c '
import json, sys
env = json.loads(sys.argv[1]); env["BETTER_AUTH_URL"] = sys.argv[2]
env = {k: v for k, v in env.items() if not k.startswith("SENTRY") and k != "CORS_ORIGIN"}
bad = [k for k, v in env.items() if "%%" in v]
if bad: sys.exit("valor con %% en " + ",".join(bad))
print("^%%^" + "%%".join(f"{k}={v}" for k, v in env.items()))' "$1" "$2"
}

cmd_alta() {
  local mi_ip=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mi-ip) mi_ip="${2:-}"; shift 2 ;;
      *) fail "Argumento desconocido: $1" ;;
    esac
  done
  if [[ -z "$mi_ip" ]]; then
    mi_ip="$(curl -fsS https://api.ipify.org)" || fail "No pude detectar tu IP pública: pasá --mi-ip A.B.C.D."
  fi
  [[ "$mi_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail "IP inválida: '$mi_ip'."
  info "Alta del entorno efímero en $PROJECT ($REGION). IP autorizada: $mi_ip/32"
  nota_costo

  # 1. Cloud SQL nueva: mismos versión/tier/edición que prod (leídos), disco 10 GB
  local ver tier edicion
  ver="$(gc sql instances describe "$PROD_SQL" --format='value(databaseVersion)')"
  tier="$(gc sql instances describe "$PROD_SQL" --format='value(settings.tier)')"
  edicion="$(gc sql instances describe "$PROD_SQL" --format='value(settings.edition)')"
  [[ -n "$ver" && -n "$tier" && -n "$edicion" ]] || fail "No pude leer versión/tier/edición de '$PROD_SQL'."
  if existe_sql; then
    info "Cloud SQL '$SQL_CARGA' ya existe (no se recrea; la password ya está en $S_ADMIN)."
  else
    existe_secreto "$S_ADMIN" && fail "El secreto $S_ADMIN existe pero la instancia no: corré 'baja' antes de 'alta'."
    local pg_pass
    pg_pass="$(openssl rand -hex 24)" # solo hex: no necesita URL-encoding
    info "Creando $SQL_CARGA ($ver, $tier, $edicion, 10 GB; IP privada + pública /32, SSL obligatorio)..."
    exigir_sufijo "$SQL_CARGA"
    gc sql instances create "$SQL_CARGA" --region="$REGION" --database-version="$ver" \
      --edition="$edicion" --tier="$tier" --storage-type=SSD --storage-size=10 \
      --availability-type=zonal --no-backup \
      --network="projects/${PROJECT}/global/networks/${VPC_NETWORK}" --assign-ip \
      --authorized-networks="${mi_ip}/32" --ssl-mode=ENCRYPTED_ONLY \
      --root-password="$pg_pass"
    gc sql databases create "$DB_NAME" --instance="$SQL_CARGA"
    local ip
    ip="$(ip_publica_instancia)"
    [[ -n "$ip" ]] || fail "No pude leer la IP pública de $SQL_CARGA."
    crear_secreto "$S_ADMIN" "postgresql://postgres:${pg_pass}@${ip}:5432/${DB_NAME}?sslmode=require"
    unset pg_pass
  fi
  # Reaplicar la IP autorizada (idempotente; cubre un re-alta desde otra red)
  gc sql instances patch "$SQL_CARGA" --authorized-networks="${mi_ip}/32" --quiet
  local conn
  conn="$(gc sql instances describe "$SQL_CARGA" --format='value(connectionName)')"
  [[ -n "$conn" ]] || fail "No pude leer connectionName de $SQL_CARGA."

  # 2. Redis BASIC 1GB (misma versión/connect-mode que prod, AUTH habilitado)
  if existe_redis; then info "Redis '$REDIS_CARGA' ya existe."; else
    local rver cm
    rver="$(gc redis instances describe "$PROD_REDIS" --region="$REGION" --format='value(redisVersion)')"
    cm="$(gc redis instances describe "$PROD_REDIS" --region="$REGION" --format='value(connectMode)')"
    info "Creando Redis $REDIS_CARGA ($rver, BASIC 1GB, ${cm:-DIRECT_PEERING})..."
    exigir_sufijo "$REDIS_CARGA"
    gc redis instances create "$REDIS_CARGA" --region="$REGION" --tier=basic --size=1 \
      --redis-version="${rver,,}" --network="$VPC_NETWORK" --connect-mode="${cm:-DIRECT_PEERING}" --enable-auth
  fi
  local rhost rport rauth rauth_enc
  rhost="$(gc redis instances describe "$REDIS_CARGA" --region="$REGION" --format='value(host)')"
  rport="$(gc redis instances describe "$REDIS_CARGA" --region="$REGION" --format='value(port)')"
  rauth="$(gc redis instances get-auth-string "$REDIS_CARGA" --region="$REGION" --format='value(authString)')"
  [[ -n "$rhost" && -n "$rauth" ]] || fail "Redis sin host o sin AUTH string."
  rauth_enc="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$rauth")"

  # 3. Secretos restantes. quivo_app nace con la password de la migración ('quivo_app_dev');
  # `migrar` la rota a la que ya está en este secreto.
  crear_secreto "$S_RUNTIME" "postgresql://quivo_app:$(openssl rand -hex 24)@localhost/${DB_NAME}?host=/cloudsql/${conn}&schema=public"
  crear_secreto "$S_REDIS" "redis://:${rauth_enc}@${rhost}:${rport:-6379}"
  crear_secreto "$S_JWT" "$(openssl rand -base64 48)"
  unset rauth rauth_enc

  # 4. API y worker con la imagen y el dimensionamiento de prod (solo lectura)
  local cfg image envjson url_propia envflag
  cfg="$(config_prod_api)"
  image="$(json_get "$cfg" image)"; envjson="$(json_get "$cfg" env)"
  info "Imagen en prod (se reusa tal cual): $image"
  url_propia="https://${API_CARGA}-${PROJECT_NUMBER}.${REGION}.run.app"
  envflag="$(env_flag "$envjson" "$url_propia")"
  local secrets="RUNTIME_DATABASE_URL=${S_RUNTIME}:latest,JWT_SECRET=${S_JWT}:latest,REDIS_URL=${S_REDIS}:latest"
  local throttle_flag=()
  [[ "$(json_get "$cfg" cpu_throttling)" == "false" ]] && throttle_flag=(--no-cpu-throttling)

  info "Desplegando $API_CARGA (cpu/mem/min/max/concurrencia copiados de $PROD_API)..."
  exigir_sufijo "$API_CARGA"
  gc run deploy "$API_CARGA" --region="$REGION" --image="$image" --platform=managed \
    --allow-unauthenticated \
    --cpu="$(json_get "$cfg" cpu)" --memory="$(json_get "$cfg" memory)" \
    --min-instances="$(json_get "$cfg" min)" --max-instances="$(json_get "$cfg" max)" \
    --concurrency="$(json_get "$cfg" concurrency)" --timeout="$(json_get "$cfg" timeout)" \
    "${throttle_flag[@]}" \
    --service-account="$SERVICE_ACCOUNT" --vpc-connector="$VPC_CONNECTOR" \
    --add-cloudsql-instances="$conn" --set-secrets="$secrets" --set-env-vars="$envflag"

  info "Desplegando $WORKER_CARGA (Direct VPC egress, mismo comando que prod)..."
  exigir_sufijo "$WORKER_CARGA"
  gc run worker-pools deploy "$WORKER_CARGA" --region="$REGION" --image="$image" \
    --command=node --args=apps/api/dist/worker.js --instances=1 \
    --service-account="$SERVICE_ACCOUNT" \
    --network="$VPC_NETWORK" --subnet="$VPC_SUBNET" --vpc-egress=private-ranges-only \
    --add-cloudsql-instances="$conn" --set-secrets="$secrets" --set-env-vars="$envflag"

  info "Listo. La base está VACÍA: siguiente paso 'scripts/carga-efimera.sh migrar'."
}

# prisma migrate deploy desde la laptop contra la IP pública + rotación de la password de
# quivo_app a la guardada en RUNTIME_DATABASE_URL-carga (como el job de deploy-gcp.sh).
cmd_migrar() {
  existe_sql || fail "'$SQL_CARGA' no existe: corré 'alta' primero."
  command -v pnpm >/dev/null 2>&1 || fail "Falta 'pnpm'."
  command -v psql >/dev/null 2>&1 || fail "Falta 'psql' (para rotar la password de quivo_app)."
  local admin_url ip repo
  admin_url="$(secreto_valor "$S_ADMIN")"
  ip="$(ip_publica_instancia)"
  [[ "$admin_url" == *"@${ip}:"* ]] || fail "La IP pública actual ($ip) no coincide con $S_ADMIN: me niego a migrar."
  repo="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
  info "prisma migrate deploy contra $SQL_CARGA ($ip)..."
  (cd "$repo" && DATABASE_URL="$admin_url" pnpm --filter @quivo/db prisma:migrate:deploy)

  local nueva
  nueva="$(secreto_valor "$S_RUNTIME" | python3 -c 'import sys,urllib.parse as u; print(u.urlsplit(sys.stdin.read().strip()).password)')"
  [[ "$nueva" =~ ^[0-9a-f]+$ ]] || fail "Password de quivo_app con formato inesperado."
  PGSSLMODE=require psql "$admin_url" -v ON_ERROR_STOP=1 -c "ALTER ROLE quivo_app PASSWORD '${nueva}'" >/dev/null
  unset nueva admin_url
  info "Migraciones aplicadas y quivo_app rotada."

  # Revisión nueva para que api y worker reconecten ya con el esquema y la password finales.
  local marca; marca="$(date +%s)"
  gc run services update "$API_CARGA" --region="$REGION" --update-env-vars="RELANZADO=${marca}" >/dev/null
  gc run worker-pools update "$WORKER_CARGA" --region="$REGION" --update-env-vars="RELANZADO=${marca}" >/dev/null
  local api_url; api_url="$(cmd_url_api)"
  if curl -fsS --max-time 20 "${api_url}/v1/health/ready"; then echo; else warn "health/ready aún no OK; reintentá en un minuto."; fi
  info "Siguiente: seed (README-conductores-reales.md)."
}

cmd_url_seed() {
  existe_sql || fail "'$SQL_CARGA' no existe: corré 'alta' primero."
  local ip url
  ip="$(ip_publica_instancia)"
  url="$(secreto_valor "$S_ADMIN")"
  [[ -n "$ip" && "$url" == *"@${ip}:"* ]] || fail "La IP pública de $SQL_CARGA no coincide con $S_ADMIN."
  printf 'export QUIVO_CARGA_TEMP_IP=%q\n' "$ip"
  printf 'export QUIVO_CARGA_DATABASE_URL=%q\n' "$url"
}

cmd_url_api() {
  existe_api || fail "'$API_CARGA' no existe: corré 'alta' primero."
  gc run services describe "$API_CARGA" --region="$REGION" --format='value(status.url)'
}

cmd_estado() {
  info "Recursos *-carga en $PROJECT:"
  echo "--- Cloud SQL";    gc sql instances list --filter='name~-carga$' --format='table(name,state,databaseVersion,settings.tier)'
  echo "--- Redis";        gc redis instances list --region="$REGION" --filter='name~-carga$' --format='table(name,tier,memorySizeGb,state,host)'
  echo "--- Cloud Run";    gc run services list --region="$REGION" --filter='metadata.name~-carga$' --format='table(metadata.name,status.url)'
  echo "--- Worker pools"; gc run worker-pools list --region="$REGION" --filter='name~-carga$' --format='table(name)' || true
  echo "--- Secretos";     gc secrets list --filter='name~-carga$' --format='table(name)'
  nota_costo
}

borrar() { # etiqueta nombre cmd...
  local etiqueta="$1" nombre="$2"; shift 2
  exigir_sufijo "$nombre"
  info "Borrando $etiqueta '$nombre' ..."
  "$@" || warn "No se pudo borrar $etiqueta '$nombre' (¿ya no existe?)."
}

cmd_baja() {
  local si=false
  [[ "${1:-}" == "--si" ]] && si=true
  local r
  for r in "$SQL_CARGA" "$REDIS_CARGA" "$API_CARGA" "$WORKER_CARGA" "${SECRETOS_CARGA[@]}"; do exigir_sufijo "$r"; done
  cmd_estado
  if [[ "$si" != true ]]; then
    read -r -p "Se borrarán los recursos *-carga listados (irreversible). ¿Continuar? [y/N] " r
    [[ "$r" == "y" || "$r" == "Y" ]] || fail "Cancelado."
  fi
  if existe_worker; then borrar "worker pool" "$WORKER_CARGA" gc run worker-pools delete "$WORKER_CARGA" --region="$REGION" --quiet; fi
  if existe_api; then borrar "servicio Cloud Run" "$API_CARGA" gc run services delete "$API_CARGA" --region="$REGION" --quiet; fi
  if existe_redis; then borrar "Redis" "$REDIS_CARGA" gc redis instances delete "$REDIS_CARGA" --region="$REGION" --quiet; fi
  if existe_sql; then borrar "Cloud SQL" "$SQL_CARGA" gc sql instances delete "$SQL_CARGA" --quiet; fi
  for r in "${SECRETOS_CARGA[@]}"; do
    if existe_secreto "$r"; then borrar "secreto" "$r" gc secrets delete "$r" --quiet; fi
  done
  info "Baja completa. Verificá con: scripts/carga-efimera.sh estado (todo vacío)."
}

case "${1:-}" in
  alta)     shift; cmd_alta "$@" ;;
  migrar)   cmd_migrar ;;
  baja)     shift; cmd_baja "${1:-}" ;;
  estado)   cmd_estado ;;
  url-seed) cmd_url_seed ;;
  url-api)  cmd_url_api ;;
  *)        sed -n '2,/^set /p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
