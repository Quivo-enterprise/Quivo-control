#!/usr/bin/env bash
# Despliega Quivo Control completo (quivo-api, quivo-web, quivo-worker) al proyecto GCP
# `quivo-control-prod`. Reemplaza a scripts/deploy-web.sh (apuntaba al proyecto borrado
# `quivo-piloto` y solo cubría el panel). Ver docs/adr/0002-gcp.md para el porqué de cada
# servicio.
#
# Infra asumida YA CREADA (este script NO la aprovisiona, solo la usa):
#   - Proyecto quivo-control-prod, región southamerica-west1.
#   - Artifact Registry: repo docker "quivo" en southamerica-west1.
#   - Cloud SQL "quivo-db" (PG16, IP privada únicamente) con la base "quivo_control" ya
#     creada y el usuario "postgres" con password ya seteado.
#   - Memorystore Redis "quivo-redis" (BASIC, 1GB, AUTH habilitado).
#   - Serverless VPC connector "quivo-conector", en la red "default" (southamerica-west1,
#     subred "default", 10.194.0.0/20). Lo usan el job de migraciones (paso 2) y quivo-api
#     (paso 3) — quivo-worker (paso 6) NO lo usa: `gcloud run worker-pools deploy` no
#     soporta `--vpc-connector` (ver el comentario grande en el paso 6 para el porqué), así
#     que llega a la misma red/subred por Direct VPC egress en vez del conector.
#   (El paso 0 SÍ gestiona el rol roles/cloudsql.client del service account de cómputo
#   sobre este proyecto — no está asumido de antemano, ver paso 0 más abajo.)
#
# Uso:
#   scripts/deploy-gcp.sh [tag] [--solo api|web|worker]
#   TAG=v2 scripts/deploy-gcp.sh --solo web      # equivalente a: scripts/deploy-gcp.sh v2 --solo web
# Sin argumento ni $TAG, usa "v1". Sin --solo, despliega las tres cargas de trabajo.
#
# Orden de ejecución (fijo, no reordenar — ver comentarios de cada paso para el porqué):
#   0. Preflight: valida secretos de Secret Manager (crea los que se pueden derivar/generar
#      solos; falla con instrucciones si falta uno que no se puede inventar) y otorga
#      roles/cloudsql.client al service account de cómputo (lo necesita el conector de
#      Cloud SQL de Cloud Run para el job de migraciones y quivo-api).
#   1. Build + push de la imagen compartida API/worker (si --solo no es "web").
#   2. Job de migraciones + rotación de password de "quivo_app" (si --solo no es "web").
#   3. Deploy de quivo-api (si --solo es "" o "api"), con verificación de que el binding IAM
#      de --allow-unauthenticated quedó puesto de verdad (ver verify_allow_unauthenticated).
#   4. Build + push + verificación local + deploy de quivo-web (si --solo es "" o "web"),
#      con la misma verificación de --allow-unauthenticated que el paso 3.
#   5. Actualizar CORS_ORIGIN en quivo-api con la URL real del panel (si se desplegó web).
#   6. Deploy de quivo-worker (Worker Pool) (si --solo es "" o "worker").
#   7. Verificación final de /v1/health/ready (si se tocó quivo-api en este run).
#
# Verificación manual pendiente (este script NO la automatiza — ejecutar una vez tras el
# primer deploy, conectando desde dentro de la VPC, p. ej. con el mismo Cloud Run Job de
# migraciones cambiando el comando por un cliente psql/node ad hoc):
#   1. Confirmar que RLS sigue activo:
#        SELECT relname, relrowsecurity, relforcerowsecurity
#        FROM pg_class WHERE relname IN ('sindicatos','socios') ;
#      relrowsecurity y relforcerowsecurity deben ser "t" en ambas filas.
#   2. Confirmar que quivo_app NO es superusuario ni tiene bypass de RLS:
#        SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'quivo_app';
#      rolsuper y rolbypassrls deben ser "f" (false).
#   3. Confirmar que la password rotada por este script es la que quedó activa: conectar
#      con el valor guardado en el secreto RUNTIME_DATABASE_URL y correr "SELECT 1".
set -Eeuo pipefail

# ---------- logging (mismo estilo que scripts/dev-all.sh y el viejo deploy-web.sh) ----------
info() {
  printf '\033[1;36m[DEPLOY-GCP]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[DEPLOY-GCP]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[DEPLOY-GCP]\033[0m %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Falta '$1'. Instálalo antes de continuar."
}

# Guarda contra el delimitador alternativo `%%` que este script usa para esquivar el bug de
# gcloud que separa `--args`/`--set-env-vars`/`--update-env-vars` por comas (ver el
# comentario grande arriba de ROTATE_JS, más abajo, para el bug real de producción que lo
# originó). Ese delimitador alternativo (`^%%^valor1%%valor2`) sólo es seguro si NINGÚN
# valor real contiene literalmente `%%` — si algún día aparece, gcloud lo va a partir en el
# punto equivocado, exactamente el mismo bug de la coma pero con otro carácter y sin ningún
# aviso. Hoy esa garantía dependía nada más de un grep manual documentado en un comentario
# — el mismo mecanismo que dejó dormida la bomba de la coma hasta que explotó en
# producción. Esta función lo verifica en código antes de cada uso, para fallar ruidoso acá
# y no adentro de un contenedor de Cloud Run.
fail_if_delimiter_collision() {
  local nombre="$1" valor="$2"
  case "$valor" in
    *'%%'*)
      fail "El valor de '$nombre' contiene literalmente '%%', que es el delimitador alternativo usado para pasárselo a gcloud (\`^%%^...\`) en vez de coma. Si se pasa así tal cual, gcloud lo va a partir en el lugar equivocado — el mismo bug de la coma que rompió el deploy, sólo que con otro carácter. Solución: cambiar el delimitador (por ejemplo a '%%%' o cualquier secuencia que no aparezca en '$nombre') en el lugar donde se arma ese --args/--set-env-vars/--update-env-vars, y volver a correr el script."
      ;;
  esac
}

require_command git
require_command docker
require_command gcloud
require_command curl
require_command openssl
require_command python3

docker buildx version >/dev/null 2>&1 || fail "Falta 'docker buildx' (necesario para --platform linux/amd64 --push)."

# ============================================================================
# Parseo de argumentos: [tag] posicional + --solo api|web|worker (en cualquier orden)
# ============================================================================
TARGET="full"
POSITIONAL_TAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --solo)
      TARGET="${2:-}"
      shift 2
      ;;
    --solo=*)
      TARGET="${1#--solo=}"
      shift
      ;;
    -h|--help)
      # Imprime el bloque de cabecera (líneas 2..N, todas comentario) hasta la primera
      # línea que no empieza con "#" (la línea en blanco antes de `set -Eeuo pipefail`).
      # Rango dinámico a propósito: si se agregan/quitan líneas al comentario de arriba,
      # este --help no vuelve a cortarse a mitad de camino.
      sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "$POSITIONAL_TAG" ]]; then
        POSITIONAL_TAG="$1"
      else
        fail "Argumento inesperado: '$1'. Uso: scripts/deploy-gcp.sh [tag] [--solo api|web|worker]"
      fi
      shift
      ;;
  esac
done

case "$TARGET" in
  full|api|web|worker) ;;
  *) fail "--solo debe ser 'api', 'web' o 'worker' (recibido: '$TARGET')." ;;
esac

readonly TAG="${POSITIONAL_TAG:-${TAG:-v1}}"
readonly TARGET

# Qué pasos corren según --solo. api/worker comparten la misma imagen y ambos dependen de
# la base (necesitan el job de migraciones/rotación); web es standalone (ver cabecera de
# deploy-web.sh original, subsumida arriba, sobre por qué el panel no toca la DB).
NEEDS_SHARED_IMAGE=false
NEEDS_DB_SETUP=false
NEEDS_API_DEPLOY=false
NEEDS_WEB_DEPLOY=false
NEEDS_WORKER_DEPLOY=false
case "$TARGET" in
  full)
    NEEDS_SHARED_IMAGE=true; NEEDS_DB_SETUP=true
    NEEDS_API_DEPLOY=true; NEEDS_WEB_DEPLOY=true; NEEDS_WORKER_DEPLOY=true
    ;;
  api)
    NEEDS_SHARED_IMAGE=true; NEEDS_DB_SETUP=true; NEEDS_API_DEPLOY=true
    ;;
  web)
    NEEDS_WEB_DEPLOY=true
    ;;
  worker)
    NEEDS_SHARED_IMAGE=true; NEEDS_DB_SETUP=true; NEEDS_WORKER_DEPLOY=true
    ;;
esac
readonly NEEDS_SHARED_IMAGE NEEDS_DB_SETUP NEEDS_API_DEPLOY NEEDS_WEB_DEPLOY NEEDS_WORKER_DEPLOY

# ---------- variables de infra ----------
readonly PROJECT="quivo-control-prod"
readonly PROJECT_NUMBER="741758083365"
readonly REGION="southamerica-west1"
readonly SQL_INSTANCE="quivo-db"
readonly DB_NAME="quivo_control"
readonly REDIS_INSTANCE="quivo-redis"
readonly VPC_CONNECTOR="quivo-conector"
# Red/subred del conector de arriba (verificado con `gcloud compute networks vpc-access
# connectors describe quivo-conector ... --format='value(network,ipCidrRange,subnet.name)'`
# → red "default", 10.8.0.0/28; y la subred de esa red en southamerica-west1 es la única que
# existe: "default", 10.194.0.0/20). quivo-worker (paso 6) las usa directo por Direct VPC
# egress, sin pasar por el conector — ver el comentario grande del paso 6 para el porqué.
readonly VPC_NETWORK="default"
readonly VPC_SUBNET="default"
# Bucket de media (logos de línea, fotos de vehículos): acceso uniforme, objetos legibles por
# URL pública, y la service account de abajo con objectAdmin. Se crea una vez fuera de este script.
readonly MEDIA_BUCKET="${PROJECT}-media"
readonly SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
readonly AR_PREFIX="${REGION}-docker.pkg.dev/${PROJECT}/quivo"
readonly API_IMAGE="${AR_PREFIX}/api:${TAG}"
readonly WEB_IMAGE="${AR_PREFIX}/web:${TAG}"
readonly MIGRATIONS_JOB="quivo-migraciones"
# URL propia de quivo-api, para BETTER_AUTH_URL (paso 3). Better-Auth toma `baseURL` de esta
# env var cuando `betterAuth({...})` no la pasa explícita (packages/db/src/auth.ts:148) y la
# usa para firmar `iss`/`aud` en los access tokens que emite. Sin ella, `iss`/`aud` salen
# vacíos y `apps/api/src/common/auth/jwt-auth.guard.ts:29` (que verifica con
# `auth.api.verifyJWT`) rechaza todo con 401 — pasó de verdad en producción: login OK, panel
# inusable porque cada llamada autenticada devolvía 401. Mitigado a mano una vez con
# `gcloud run services update quivo-api --update-env-vars=BETTER_AUTH_URL=...`; este bloque
# lo hace permanente para que el próximo deploy no lo vuelva a romper.
#
# Igual que WEB_URL_PROJECT_NUMBER del paso 5 (más abajo), Cloud Run expone cada servicio en
# DOS URLs válidas: la basada en hash (`status.url`, sólo se conoce DESPUÉS del primer
# deploy) y esta, basada en el número de proyecto, calculable de antemano con constantes que
# ya existen (PROJECT_NUMBER, REGION). Se usa la de número de proyecto — no la de hash — a
# propósito, para no repetir acá el problema de orden que fuerza a CORS_ORIGIN a un segundo
# `gcloud run services update` posterior al deploy: BETTER_AUTH_URL es puramente
# autoreferencial (Better-Auth firma Y verifica los tokens con la misma instancia, dentro del
# mismo servicio; ningún cliente externo necesita que esta URL sea la que efectivamente usa
# el browser, a diferencia de CORS_ORIGIN) y las dos formas de URL resuelven al mismo
# servicio, así que cualquiera de las dos es funcionalmente correcta. Con esto,
# BETTER_AUTH_URL queda disponible desde el PRIMER deploy de quivo-api (incluido el primero
# de todos, cuando el servicio ni siquiera existe todavía y `status.url` no se puede leer),
# en vez de depender de un segundo update que alguien podría olvidar correr o saltear con
# `--solo api` en un entorno nuevo.
readonly API_URL_PROJECT_NUMBER="https://quivo-api-${PROJECT_NUMBER}.${REGION}.run.app"

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)" \
  || fail "No se pudo resolver la raíz del repo con git rev-parse. ¿Estás dentro del repo?"
readonly REPO_ROOT
cd "$REPO_ROOT"

info "Proyecto: $PROJECT · región: $REGION · tag: $TAG · alcance: $TARGET"

# ---------- limpieza del contenedor de verificación del paso web, pase lo que pase ----------
CONTAINER_NAME=""
cleanup_container() {
  if [[ -n "$CONTAINER_NAME" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup_container EXIT

# ============================================================================
# Helpers de Secret Manager
# ============================================================================
secret_exists() {
  gcloud secrets describe "$1" --project="$PROJECT" >/dev/null 2>&1
}

# Crea un secreto con el valor dado SOLO si no existe. Nunca pisa un secreto existente
# (idempotencia) y nunca imprime el valor de uno que ya existía.
create_secret_if_missing() {
  local name="$1" value="$2" motivo="$3"
  if secret_exists "$name"; then
    info "Secreto '$name' ya existe — no se toca (idempotente)."
    return 0
  fi
  printf '%s' "$value" | gcloud secrets create "$name" \
    --project="$PROJECT" \
    --replication-policy=automatic \
    --data-file=- >/dev/null
  info "Secreto '$name' creado ($motivo). Valor NO impreso."
}

read_secret_value() {
  gcloud secrets versions access latest --secret="$1" --project="$PROJECT"
}

# Cloud Run valida el acceso al secreto en tiempo de deploy y falla si el permiso no está
# (ver docs/adr/0002-gcp.md, "secretAccessor se otorga antes del primer deploy") — se
# otorga acá, antes de cualquier `gcloud run deploy`/`jobs execute`, e idempotente: pedirlo
# dos veces no duplica el binding.
grant_secret_access() {
  local name="$1"
  gcloud secrets add-iam-policy-binding "$name" \
    --project="$PROJECT" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null
}

# ============================================================================
# Paso 0/7 — Preflight: derivar connectionName/host de Redis y asegurar secretos
# ============================================================================
CONNECTION_NAME=""
REDIS_HOST=""
REDIS_PORT=""

if [[ "$NEEDS_DB_SETUP" == true ]]; then
  info "Paso 0/7: preflight — derivando datos de infra y asegurando secretos..."

  # No hardcodear el connection name (puede cambiar si se recrea la instancia) — se deriva
  # en runtime, como pide el brief.
  CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT" \
    --format='value(connectionName)')"
  [[ -n "$CONNECTION_NAME" ]] || fail "No se pudo derivar el connectionName de Cloud SQL ('$SQL_INSTANCE'). ¿Existe la instancia en el proyecto '$PROJECT'?"
  info "Cloud SQL connectionName: $CONNECTION_NAME"

  REDIS_HOST="$(gcloud redis instances describe "$REDIS_INSTANCE" --project="$PROJECT" \
    --region="$REGION" --format='value(host)')"
  [[ -n "$REDIS_HOST" ]] || fail "No se pudo derivar el host de Redis ('$REDIS_INSTANCE'). ¿Existe la instancia en '$REGION'?"
  REDIS_PORT="$(gcloud redis instances describe "$REDIS_INSTANCE" --project="$PROJECT" \
    --region="$REGION" --format='value(port)')"
  [[ -n "$REDIS_PORT" ]] || REDIS_PORT="6379"
  info "Memorystore Redis: ${REDIS_HOST}:${REDIS_PORT}"

  readonly CONNECTION_NAME REDIS_HOST REDIS_PORT

  # --- DATABASE_URL (rol "postgres", dueño de las tablas) ---------------------------
  # Password YA SETEADO fuera de este script (Cloud SQL, usuario "postgres" — provisto al
  # crear la instancia). Este script NUNCA inventa esta password: hacerlo rompería contra
  # el usuario real. Si el secreto no existe, se falla con el comando exacto para crearlo
  # a mano, y se aborta ANTES de construir ninguna imagen.
  if ! secret_exists DATABASE_URL; then
    fail "$(cat <<EOF
Falta el secreto 'DATABASE_URL' en Secret Manager y este script NO puede inventarlo (la
password del usuario 'postgres' de Cloud SQL ya está seteada fuera de este flujo). Creá el
secreto a mano con la password real y volvé a correr el script:

  printf 'postgresql://postgres:TU_PASSWORD_REAL@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}&schema=public' \\
    | gcloud secrets create DATABASE_URL --project=${PROJECT} --replication-policy=automatic --data-file=-
EOF
)"
  fi
  info "Secreto 'DATABASE_URL' ya existe — OK."

  # --- JWT_SECRET: secreto puro, se genera si falta -----------------------------------
  if ! secret_exists JWT_SECRET; then
    JWT_SECRET_VALUE="$(openssl rand -base64 48)"
    create_secret_if_missing JWT_SECRET "$JWT_SECRET_VALUE" "generado con openssl rand -base64 48"
    unset JWT_SECRET_VALUE
  else
    info "Secreto 'JWT_SECRET' ya existe — OK."
  fi

  # --- QUIVO_APP_PASSWORD: password rotada del rol de runtime "quivo_app" -------------
  # packages/db/prisma/migrations/20260730152500_rls_multi_tenant/migration.sql crea el
  # rol "quivo_app" con `CREATE ROLE quivo_app LOGIN PASSWORD 'quivo_app_dev' ...` — esa
  # password está en el repo (dev-only) y sería un secreto de producción público si se
  # usara tal cual. Ese archivo usa `IF NOT EXISTS` alrededor del CREATE ROLE (no vuelve a
  # ejecutarlo si el rol ya existe), así que reaplicar la migración NUNCA revierte la
  # rotación de password que hace este script más abajo (paso 2) vía `ALTER ROLE`. Este
  # secreto sólo guarda la password en texto plano (sin el resto de la URL) porque el paso
  # 2 la necesita sola, como env var, para pasarla al `ALTER ROLE` dentro del job.
  if ! secret_exists QUIVO_APP_PASSWORD; then
    QUIVO_APP_PASSWORD_VALUE="$(openssl rand -hex 24)"
    create_secret_if_missing QUIVO_APP_PASSWORD "$QUIVO_APP_PASSWORD_VALUE" "generado con openssl rand -hex 24"
    unset QUIVO_APP_PASSWORD_VALUE
  else
    info "Secreto 'QUIVO_APP_PASSWORD' ya existe — se reusa (NO se regenera; ver REQUISITO 2)."
  fi

  # --- RUNTIME_DATABASE_URL (rol "quivo_app", sin superuser/BYPASSRLS) ----------------
  # Se construye a partir de QUIVO_APP_PASSWORD — nunca se imprime ninguno de los dos.
  if ! secret_exists RUNTIME_DATABASE_URL; then
    QUIVO_APP_PASSWORD_VALUE="$(read_secret_value QUIVO_APP_PASSWORD)"
    RUNTIME_URL="postgresql://quivo_app:${QUIVO_APP_PASSWORD_VALUE}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}&schema=public"
    create_secret_if_missing RUNTIME_DATABASE_URL "$RUNTIME_URL" "derivado de QUIVO_APP_PASSWORD"
    unset QUIVO_APP_PASSWORD_VALUE RUNTIME_URL
  else
    info "Secreto 'RUNTIME_DATABASE_URL' ya existe — OK."
  fi

  # --- REDIS_URL: AUTH habilitado en quivo-redis, la auth string se lee en runtime ----
  # `get-auth-string` nunca se imprime — se captura directo en una variable y se descarta
  # apenas se arma la URL. Se URL-encodea por las dudas (una auth string con un carácter
  # reservado tipo '@' o ':' rompería el parseo de la connection string de ioredis).
  if ! secret_exists REDIS_URL; then
    REDIS_AUTH_STRING="$(gcloud redis instances get-auth-string "$REDIS_INSTANCE" \
      --project="$PROJECT" --region="$REGION" --format='value(authString)')"
    [[ -n "$REDIS_AUTH_STRING" ]] || fail "get-auth-string devolvió vacío para '$REDIS_INSTANCE' — ¿el AUTH está realmente habilitado en la instancia?"
    REDIS_AUTH_ENCODED="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$REDIS_AUTH_STRING")"
    REDIS_URL_VALUE="redis://:${REDIS_AUTH_ENCODED}@${REDIS_HOST}:${REDIS_PORT}"
    create_secret_if_missing REDIS_URL "$REDIS_URL_VALUE" "derivado de get-auth-string + host/port de Memorystore"
    unset REDIS_AUTH_STRING REDIS_AUTH_ENCODED REDIS_URL_VALUE
  else
    info "Secreto 'REDIS_URL' ya existe — OK."
  fi

  # secretAccessor para todo lo que usan quivo-api/quivo-worker/el job de migraciones,
  # todos corriendo bajo el mismo service account.
  for s in DATABASE_URL JWT_SECRET QUIVO_APP_PASSWORD RUNTIME_DATABASE_URL REDIS_URL; do
    grant_secret_access "$s"
  done
  info "roles/secretmanager.secretAccessor otorgado (idempotente) sobre los 5 secretos a $SERVICE_ACCOUNT."

  # El conector de Cloud SQL que usa Cloud Run (job de migraciones y quivo-api) necesita
  # `cloudsql.instances.get` para abrir el socket a la instancia — sin roles/cloudsql.client
  # el job muere con `Error 403: boss::NOT_AUTHORIZED ... missing permission
  # cloudsql.instances.get on resource instances/quivo-db` y Prisma lo reporta como P1001
  # ("Can't reach database server"). Se otorga a nivel proyecto, antes de cualquier
  # `gcloud run jobs execute`/`gcloud run deploy`, e idempotente: pedirlo dos veces no
  # duplica el binding. `add-iam-policy-binding` a nivel proyecto imprime la política
  # entera por stdout — se descarta como en grant_secret_access.
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/cloudsql.client" \
    --condition=None \
    >/dev/null
  info "roles/cloudsql.client otorgado (idempotente) a $SERVICE_ACCOUNT sobre el proyecto."
fi

# ----------------------------------------------------------------------------
# Paso 0/7 (panel) — Preflight de Google Maps para /en-vivo
# ----------------------------------------------------------------------------
# NEXT_PUBLIC_* se hornea en build time. La key de navegador sale de Secret Manager
# (`google-maps-web-key`); el Map ID viene de la variable de entorno GOOGLE_MAPS_MAP_ID (no es
# secreto). Se valida acá, ANTES de migraciones y del deploy de la API, para que un faltante no
# aborte el deploy a medias (API ya desplegada con el panel viejo). Se distingue "el secreto no
# existe" de "no hay permiso / falló gcloud" mostrando el stderr real de gcloud.
GOOGLE_MAPS_WEB_KEY=""
if [[ "$NEEDS_WEB_DEPLOY" == true ]]; then
  info "Paso 0/7: preflight del panel — verificando la key y el Map ID de Google Maps..."
  [[ -n "${GOOGLE_MAPS_MAP_ID:-}" ]] || fail "Falta la variable de entorno GOOGLE_MAPS_MAP_ID (Map ID vectorial de Google Maps para /en-vivo). Exportala antes de correr el deploy del panel."

  gmaps_err_file="$(mktemp)"
  if ! gcloud secrets describe google-maps-web-key --project="$PROJECT" >/dev/null 2>"$gmaps_err_file"; then
    gmaps_err="$(cat "$gmaps_err_file")"
    rm -f "$gmaps_err_file"
    if grep -qiE 'NOT_FOUND|not found' <<<"$gmaps_err"; then
      fail "El secreto 'google-maps-web-key' no existe en Secret Manager (proyecto $PROJECT). Crealo antes de desplegar el panel: lo necesita /en-vivo."
    fi
    fail "No se pudo consultar el secreto 'google-maps-web-key' (¿permisos o sesión de gcloud?). gcloud dijo: ${gmaps_err}"
  fi
  if ! GOOGLE_MAPS_WEB_KEY="$(gcloud secrets versions access latest --secret=google-maps-web-key --project="$PROJECT" 2>"$gmaps_err_file")"; then
    gmaps_err="$(cat "$gmaps_err_file")"
    rm -f "$gmaps_err_file"
    fail "El secreto 'google-maps-web-key' existe pero no se pudo leer su última versión (sin versión, o sin permiso secretmanager.versions.access). gcloud dijo: ${gmaps_err}"
  fi
  rm -f "$gmaps_err_file"
  [[ -n "$GOOGLE_MAPS_WEB_KEY" ]] || fail "El secreto 'google-maps-web-key' está vacío. Agregá una versión con la key de navegador de Google Maps."
  readonly GOOGLE_MAPS_WEB_KEY
  info "Google Maps: key (Secret Manager) y Map ID OK."
fi

# ============================================================================
# Paso 1/7 — Build + push de la imagen compartida API/worker
# ============================================================================
if [[ "$NEEDS_SHARED_IMAGE" == true ]]; then
  info "Paso 1/7: build y push de la imagen compartida API/worker ($API_IMAGE)..."
  # Dockerfile de la raíz: una sola imagen, dos CMD posibles (api/worker) — ver su cabecera
  # (QUI-354). Comando por defecto de la imagen = node apps/api/dist/main.js (API); el
  # worker pisa el comando en su propio deploy (paso 6), no acá.
  docker buildx build --platform linux/amd64 \
    -f Dockerfile \
    -t "$API_IMAGE" --push .
  info "Imagen $API_IMAGE publicada en Artifact Registry."
fi

# ============================================================================
# Paso 2/7 — Job de migraciones + rotación de password de quivo_app
# ============================================================================
# La instancia de Cloud SQL es de IP privada únicamente (--no-assign-ip): no hay forma de
# correr `prisma migrate deploy` desde fuera de la VPC (ni cloud-sql-proxy local, ni una
# GitHub Action, llegan a 10.60.0.3). Tiene que correr DENTRO de la VPC — de ahí este Cloud
# Run Job, con el mismo --vpc-connector/--add-cloudsql-instances que quivo-api.
#
# Se reusa el MISMO recurso de Job para migrar y para rotar la password (en vez de dos
# Jobs separados): las dos tareas necesitan exactamente la misma red (VPC connector +
# Cloud SQL) y la misma imagen — crear un segundo Job duplicaría esos flags sin ganar nada,
# ya que nunca corren en paralelo (la rotación depende de que la migración haya terminado).
# Lo único que cambia entre una ejecución y otra es el argumento pasado a `/bin/sh -c`, y
# `gcloud run jobs execute --args=...` permite overridearlo por ejecución sin tocar el
# recurso del Job — así que el Job se crea/actualiza UNA vez con --command=/bin/sh y ambos
# secretos montados, y se ejecuta dos veces con --args distintos. Los cuatro `--args` de
# este bloque van con delimitador alternativo (`^%%^...%%...`), NO coma — el porqué
# (bug real de producción) está en el comentario grande arriba de ROTATE_JS, más abajo.
if [[ "$NEEDS_DB_SETUP" == true ]]; then
  info "Paso 2/7: asegurando el Cloud Run Job de migraciones ($MIGRATIONS_JOB)..."

  # Comando de migración: confirmado leyendo packages/db/package.json
  # ("prisma:migrate:deploy": "prisma migrate deploy") y packages/db/prisma.config.ts
  # (schema relativo a "prisma/schema.prisma", resuelto contra el cwd del proceso que
  # invoca el CLI de Prisma). El stage `runner` del Dockerfile copia /app completo desde
  # `builder` (`COPY --from=builder /app .`), que incluye node_modules instalado con
  # `pnpm install --frozen-lockfile --filter=@quivo/api...` — SIN --prod, así que las
  # devDependencies de @quivo/db (incluido el CLI de "prisma") sí quedan instaladas. pnpm
  # symlinkea cualquier dependencia directa de un workspace dentro del node_modules de ESE
  # paquete sin importar el hoisting global, así que
  # packages/db/node_modules/prisma/build/index.js (bin real de "prisma", confirmado con
  # `cat packages/db/node_modules/prisma/package.json` en este repo) existe siempre en la
  # imagen, sin depender de dónde haya quedado hoisteado el resto. Se invoca con `node`
  # directo (no vía el shim de .bin) para no depender del bit +x sobreviviendo el COPY.
  #
  # OJO con estas dos variables: `gcloud run jobs execute --args=...` fija el argv del
  # contenedor DIRECTO (como el modo exec de Docker) — no hay un shell intermedio que
  # desescape nada antes de que `/bin/sh -c` reciba el segundo argumento. Por eso el texto
  # de abajo es EXACTAMENTE el script que /bin/sh va a parsear, ni una capa más: cero
  # backslashes falsos por "escapar para un shell exterior" que no existe.
  MIGRATE_SCRIPT='cd /app/packages/db && node node_modules/prisma/build/index.js migrate deploy'

  # Rotación de password de quivo_app (REQUISITO 2 del CTO): corre DESPUÉS de que la
  # migración de arriba haya creado el rol (si todavía no existía) con la password
  # hardcodeada 'quivo_app_dev' del migration.sql. `postgres` en Cloud SQL es
  # cloudsqlsuperuser con CREATEROLE (ver docs/adr/0002-gcp.md), suficiente para
  # ALTER ROLE sobre un rol NOSUPERUSER como quivo_app sin ser superuser real.
  #
  # El JS se arma en un heredoc con delimitador ENTRECOMILLADO ('JS_EOF'): eso apaga TODA
  # expansión de bash dentro (ninguna variable, ninguna backtick, ningún backslash se
  # procesa) — el contenido queda carácter por carácter tal cual se escribió, así se puede
  # escribir JS/SQL normal sin pelearse con el quoting de bash. Se usa `pg` (dependencia
  # directa de @quivo/db, mismo razonamiento de symlink que arriba) en vez de invocar un
  # cliente `psql` que la imagen no tiene instalado (node:22-alpine no trae el paquete
  # postgresql-client). El literal SQL de la password usa dollar-quoting de Postgres
  # (`$$...$$`, equivalente a comillas simples pero sin el caracter `'`) justamente para no
  # necesitar NINGUNA comilla simple dentro del JS — así el JS entero puede ir envuelto en
  # comillas simples de shell (`node -e '...'`, ver más abajo) sin conflicto de anidado.
  # Password generada en el paso 0 con `openssl rand -hex 24` (SOLO hex: 0-9a-f) a
  # propósito, así el regex de abajo puede rechazar cualquier otra cosa por las dudas (si
  # algún día cambia el generador) sin abrir una inyección SQL.
  #
  # BUG DE PRODUCCIÓN CONFIRMADO (logs reales, 2026-09): `gcloud run jobs ... --args=...`
  # separa el valor por COMAS, igual que cualquier flag de lista de gcloud
  # (`--args=a,b,c` son TRES argumentos, no un string con comas adentro). El mensaje de
  # error de arriba ("...con caracteres inesperados, abortando por seguridad") tiene una
  # coma adentro del string de JS — al pasarlo como `--args="-c,${ROTATE_SCRIPT}"` gcloud
  # lo partió en dos argumentos de `/bin/sh -c`, que murió con
  # "unterminated quoted string" dentro del contenedor real (Container called exit(2)).
  # `MIGRATE_SCRIPT` se salvó de casualidad porque hoy no tiene ninguna coma — es la misma
  # bomba, sin activar. Por eso los cuatro usos de `--args` de este bloque (jobs create,
  # jobs update, y los dos jobs execute de más abajo) usan la sintaxis de delimitador
  # alternativo de gcloud (`--args=^%%^valor1%%valor2`) en vez de comas. Se eligió `%%`
  # como delimitador — no `,` por el bug de arriba, no `|` porque el JS usa `||` en
  # `process.env.QUIVO_APP_NEW_PASSWORD||""` — verificando (grep) que `%%` no aparece en
  # ningún lado de `ROTATE_JS` ni de `MIGRATE_SCRIPT`. NO volver a coma "para simplificar":
  # es exactamente el bug que se comió el deploy la última vez.
  read -r -d '' ROTATE_JS <<'JS_EOF' || true
const {Client}=require("pg");
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL});
  await c.connect();
  const p=process.env.QUIVO_APP_NEW_PASSWORD||"";
  if(!/^[0-9a-f]+$/i.test(p)){
    throw new Error("QUIVO_APP_NEW_PASSWORD con caracteres inesperados, abortando por seguridad");
  }
  await c.query("ALTER ROLE quivo_app PASSWORD $$"+p+"$$");
  await c.end();
  console.log("quivo_app: password rotada OK");
})().catch((e)=>{console.error(e);process.exit(1);});
JS_EOF
  # Aplanado a una sola línea (los saltos de línea del heredoc se cambian por espacios):
  # el JS ya usa ";" en cada statement, así que no depende de las líneas para nada, y esto
  # evita cualquier duda sobre cómo gcloud serializa un valor de --args con saltos de línea
  # embebidos (no se pudo probar contra un proyecto real — ver el reporte final).
  ROTATE_JS="$(printf '%s' "$ROTATE_JS" | tr '\n' ' ')"
  ROTATE_SCRIPT="cd /app/packages/db && node -e '${ROTATE_JS}'"

  JOB_SECRETS="DATABASE_URL=DATABASE_URL:latest,QUIVO_APP_NEW_PASSWORD=QUIVO_APP_PASSWORD:latest"
  JOB_COMMON_FLAGS=(
    --project="$PROJECT"
    --region="$REGION"
    --image="$API_IMAGE"
    --service-account="$SERVICE_ACCOUNT"
    --vpc-connector="$VPC_CONNECTOR"
    --set-cloudsql-instances="$CONNECTION_NAME"
    --set-secrets="$JOB_SECRETS"
    --command=/bin/sh
    --max-retries=0
    --tasks=1
    # El backfill de la migración 20260922100000_gps_sesion_resumen escanea toda
    # gps_points: el default de Cloud Run Job (600s) puede matar la tarea a mitad de
    # camino y Prisma la marca como fallida (P3009), bloqueando deploys futuros.
    --task-timeout=1800
  )

  # Delimitador alternativo `^%%^...%%...` en vez de coma en los 4 `--args` de este bloque:
  # ver el comentario grande arriba de ROTATE_JS — es el bug real que partió el deploy.
  # Guarda (fix del bug de la coma, versión "%%"): si alguna vez alguno de los dos scripts
  # llega a contener literalmente "%%", fallar acá y no adentro del contenedor.
  fail_if_delimiter_collision "MIGRATE_SCRIPT" "$MIGRATE_SCRIPT"
  fail_if_delimiter_collision "ROTATE_SCRIPT" "$ROTATE_SCRIPT"
  if gcloud run jobs describe "$MIGRATIONS_JOB" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
    gcloud run jobs update "$MIGRATIONS_JOB" "${JOB_COMMON_FLAGS[@]}" --args="^%%^-c%%${MIGRATE_SCRIPT}" >/dev/null
  else
    gcloud run jobs create "$MIGRATIONS_JOB" "${JOB_COMMON_FLAGS[@]}" --args="^%%^-c%%${MIGRATE_SCRIPT}" >/dev/null
  fi
  info "Job '$MIGRATIONS_JOB' listo con la imagen recién publicada."

  info "Ejecutando 'prisma migrate deploy' dentro de la VPC (puede tardar)..."
  if ! gcloud run jobs execute "$MIGRATIONS_JOB" --project="$PROJECT" --region="$REGION" \
      --args="^%%^-c%%${MIGRATE_SCRIPT}" --wait; then
    fail "El job de migraciones falló. Revisar logs con:
  gcloud run jobs executions list --job=$MIGRATIONS_JOB --project=$PROJECT --region=$REGION
Abortando ANTES de tocar quivo-api/quivo-web/quivo-worker — no se desplegó nada."
  fi
  info "Migraciones aplicadas OK."

  info "Rotando la password de quivo_app (reemplaza el valor dev hardcodeado en la migración)..."
  if ! gcloud run jobs execute "$MIGRATIONS_JOB" --project="$PROJECT" --region="$REGION" \
      --args="^%%^-c%%${ROTATE_SCRIPT}" --wait; then
    fail "La rotación de password de 'quivo_app' falló. Revisar logs con:
  gcloud run jobs executions list --job=$MIGRATIONS_JOB --project=$PROJECT --region=$REGION
Abortando — RUNTIME_DATABASE_URL ya tiene la password nueva en Secret Manager pero el rol
de Postgres puede haber quedado con la vieja ('quivo_app_dev') o a mitad de camino. No
desplegar quivo-api/quivo-worker con ese desfase: fallarían el health check (db down) o,
peor, funcionarían por casualidad contra la password dev. Diagnosticar antes de reintentar."
  fi
  info "Password de quivo_app rotada OK."
fi

# Lee el CORS_ORIGIN actualmente seteado en quivo-api (o imprime nada). Nunca aborta: ni
# porque el servicio no exista todavía (primer deploy de la vida — `describe` falla,
# `2>/dev/null` lo traga) ni porque exista pero no tenga esa env var seteada (`describe`
# funciona pero el filtro de python no encuentra la entrada, y no imprime nada tampoco).
# Se usa `--format=json` en vez de un `--format='value(...)'` con filtro embebido porque el
# formato de proyección de gcloud no soporta filtrar la lista `env[]` por `name` de forma
# confiable — se resuelve con python3 (ya es dependencia dura del script, ver
# `require_command python3` arriba) en vez de inventar un one-liner de `grep`/`sed` frágil
# contra JSON.
get_current_cors_origin() {
  local json
  json="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" \
    --format=json 2>/dev/null)" || return 0
  printf '%s' "$json" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    for env in data["spec"]["template"]["spec"]["containers"][0].get("env", []):
        if env.get("name") == "CORS_ORIGIN":
            print(env.get("value", ""))
            break
except Exception:
    pass
'
}

# Verifica que un servicio desplegado con --allow-unauthenticated haya quedado REALMENTE
# accesible sin autenticación, y falla ruidoso si no. Compartida por los pasos 3 y 4 (mismo
# problema en quivo-api y quivo-web).
#
# Por qué hace falta: gcloud reporta la falla de "Setting IAM Policy" (el paso interno que
# --allow-unauthenticated dispara) como WARNING, no como error — `gcloud run deploy` sigue
# con exit 0 igual. Pasó de verdad en un deploy a este proyecto:
#   Setting IAM Policy...............warning
#   Completed with warnings:
#     Setting IAM policy failed, try "gcloud beta run services add-iam-policy-binding ..."
# El script (versión vieja, sin esta función) seguía como si nada, anunciaba "desplegado:
# https://..." y esa URL devolvía 403 — la app quedó arriba e inalcanzable sin que nadie se
# enterara. Causa típica: la política de organización
# constraints/iam.allowedPolicyMemberDomains prohíbe agregar "allUsers" a cualquier IAM
# binding.
#
# Dos capas, a propósito:
#   (a) GATE DURO — leer el IAM policy real del servicio (`get-iam-policy --format=json`,
#       parseado con python3, mismo patrón que get_current_cors_origin arriba) y confirmar
#       que existe el binding allUsers + roles/run.invoker. Prueba la CAUSA (el permiso), es
#       determinista, y es la única señal que decide si este chequeo hace fail().
#   (b) diagnóstico informativo — un curl a la URL real, SOLO para loguear una segunda señal
#       humana en el mensaje de fail (o confirmar que todo está bien). Nunca decide el
#       resultado por sí solo: un 403 sin (a) es un falso negativo posible (servicio
#       arrancando, 503 transitorio, o la app respondiendo 404 en "/" de forma legítima) —
#       basarse en curl solo habría reproducido el mismo tipo de bug que este fix corrige,
#       nomás con otro código HTTP.
verify_allow_unauthenticated() {
  local svc="$1" url="$2"
  local policy_json has_all_users curl_status

  info "Verificando que '$svc' quedó accesible sin autenticación (--allow-unauthenticated)..."

  policy_json="$(gcloud run services get-iam-policy "$svc" --project "$PROJECT" --region "$REGION" \
    --format=json 2>/dev/null)" || policy_json=""

  has_all_users="$(printf '%s' "$policy_json" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    for b in data.get("bindings", []):
        if b.get("role") == "roles/run.invoker" and "allUsers" in b.get("members", []):
            print("yes")
            break
except Exception:
    pass
')"

  # (b) diagnóstico informativo — nunca decide el resultado, ver comentario grande arriba.
  curl_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)" || curl_status="sin-respuesta"
  info "  Diagnóstico informativo (no es el gate): curl a $url devolvió HTTP $curl_status."

  if [[ "$has_all_users" != "yes" ]]; then
    local iam_error
    iam_error="$(gcloud run services get-iam-policy "$svc" --project "$PROJECT" --region "$REGION" \
      --format=json 2>&1 >/dev/null)"
    fail "'$svc' se desplegó pero el binding IAM allUsers/roles/run.invoker NO está presente \
(gcloud run services get-iam-policy $svc no lo devolvió${iam_error:+ — gcloud dijo: \"$iam_error\"}). \
--allow-unauthenticated probablemente falló como WARNING silencioso durante el deploy (gcloud lo \
reporta como 'Setting IAM Policy...............warning' y sigue con exit 0 igual) — la causa más \
común es una política de organización que prohíbe agregar 'allUsers' a un IAM binding:
  constraints/iam.allowedPolicyMemberDomains

Diagnosticar con:
  gcloud resource-manager org-policies describe constraints/iam.allowedPolicyMemberDomains --project=$PROJECT --effective

Si la política bloquea 'allUsers' y de verdad se necesita este servicio público, hay que
resolverla a nivel organización/carpeta (fuera del alcance de este script) y recién después
otorgar el binding a mano:
  gcloud run services add-iam-policy-binding $svc --project=$PROJECT --region=$REGION --member=allUsers --role=roles/run.invoker

(Diagnóstico informativo: curl a $url devolvió HTTP $curl_status — es el efecto, no la causa;
no te quedes ahí a diagnosticar.)"
  fi

  info "'$svc' tiene el binding allUsers/roles/run.invoker — accesible sin autenticación."
}

# ============================================================================
# Paso 3/7 — Deploy de quivo-api
# ============================================================================
API_URL=""
PREV_API_REVISION=""

if [[ "$NEEDS_API_DEPLOY" == true ]]; then
  info "Paso 3/7: desplegando quivo-api en Cloud Run ($REGION)..."

  # Capturar la revisión previa ANTES de tocar quivo-api — para CUALQUIER run que despliegue
  # la API, no sólo cuando también se despliega el panel (D2 de la auditoría de este
  # script). Antes, PREV_API_REVISION sólo se capturaba dentro del paso 5 (update de
  # CORS_ORIGIN), que corre nada más si este run también desplegó quivo-web — con
  # `--solo api`, el health check del paso 7 podía fallar sin que el script tuviera ningún
  # rollback que imprimir, justo con producción caída y menos tiempo para buscar uno a mano.
  #
  # Caso especial: en el PRIMER deploy de todos, `quivo-api` todavía no existe y `describe`
  # falla — eso NO debe abortar el script (no hay nada en producción a lo que volver
  # todavía, así que no hay rollback que perder). Se detecta con el `describe` silencioso de
  # abajo antes de pedir el campo real, en vez de dejar que `set -e` mate el script con el
  # primer `describe --format=...` que devuelva vacío.
  if gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" >/dev/null 2>&1; then
    PREV_API_REVISION="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" \
      --format='value(status.latestReadyRevisionName)')"
    if [[ -n "$PREV_API_REVISION" ]]; then
      info "Revisión actual de quivo-api (rollback si el health check del paso 7 falla): $PREV_API_REVISION"
    else
      warn "quivo-api existe pero no devolvió una revisión Ready (¿deploy previo incompleto?). Sin rollback conocido para este run."
    fi
  else
    info "quivo-api todavía no existe en '$PROJECT' — primer deploy, no hay revisión previa a la que volver."
  fi

  # CORS_ORIGIN: --set-env-vars REEMPLAZA el mapa entero de env vars (a diferencia de
  # --update-env-vars, que mergea) — así que un `gcloud run deploy quivo-api` con
  # --set-env-vars a secas BORRA cualquier CORS_ORIGIN que el paso 5 de un run anterior
  # haya dejado puesto. En un run `full` no se nota (el paso 5 de ESTE MISMO run la vuelve
  # a poner después), pero con `scripts/deploy-gcp.sh --solo api` el paso 5 no corre
  # (NEEDS_WEB_DEPLOY=false) y CORS_ORIGIN queda borrado para siempre: apps/api/src/main.ts
  # cae al default 'http://localhost:3000' y el panel real queda bloqueado por CORS. Bug
  # real encontrado en la revisión de este script (mismo tipo de bug que el de la coma en
  # --args: un flag que hace más de lo que el autor original tuvo en cuenta).
  #
  # Se resuelve leyendo el CORS_ORIGIN actual ANTES de este deploy (tolerando que no exista
  # — primer deploy de la vida, o un `full` que corre paso 3 antes que paso 5 alguna vez —
  # ver get_current_cors_origin arriba) y re-incluyéndolo en el MISMO --set-env-vars, para
  # que la revisión nueva nazca con el valor viejo en vez de nacer sin CORS_ORIGIN y
  # depender de que un paso 5 posterior la repare.
  #
  # Se prefirió esta opción (leer + re-setear en el mismo comando) por sobre usar
  # --update-env-vars acá: --update-env-vars nunca borra nada, así que cualquier env var
  # vieja seteada a mano fuera de este script (o de un despliegue anterior con otro juego
  # de variables) quedaría pegada para siempre sin que nadie se dé cuenta. --set-env-vars
  # mantiene la propiedad de que ESTE SCRIPT es la única fuente de verdad de las env vars
  # de quivo-api — el precio es tener que re-incluir CORS_ORIGIN a mano, que es justo lo
  # que hace este bloque.
  #
  # OJO: CORS_ORIGIN_EXISTENTE puede traer una coma adentro (paso 5 setea DOS URLs
  # separadas por coma — panel + su alias por número de proyecto). No se puede meter tal
  # cual en un --set-env-vars separado por comas (partiría la lista en el lugar
  # equivocado — el mismo bug de la coma, otra vez). Por eso todo este --set-env-vars usa
  # el delimitador alternativo `^%%^` (ver el comentario grande arriba de ROTATE_JS, más
  # arriba en el script, para el bug real de producción que originó este patrón) en vez de
  # coma, igual que el resto del script.
  CORS_ORIGIN_EXISTENTE="$(get_current_cors_origin)"
  fail_if_delimiter_collision "CORS_ORIGIN_EXISTENTE (leído de quivo-api antes del deploy)" "$CORS_ORIGIN_EXISTENTE"
  # BETTER_AUTH_URL: ver el comentario grande arriba de API_URL_PROJECT_NUMBER (sección
  # "variables de infra") para el porqué hace falta y por qué se usa la URL de
  # número-de-proyecto en vez de esperar a `status.url`. Se incluye siempre, no sólo cuando
  # ya existe una previa (a diferencia de CORS_ORIGIN_EXISTENTE arriba) porque su valor es
  # una constante calculada, no algo que un run anterior pudo haber seteado distinto.
  # Pool de DB (packages/db/src/pool-config.ts). Presupuesto de conexiones (max_connections=50):
  # régimen estable 3x6 + 5 (worker) + 1 (retención) = 24. En un rolling deploy pueden solaparse
  # revisiones viejas y nuevas (hasta 6x6 + 2x5 + 1 = 47) y Cloud SQL reserva 3 slots de superuser:
  # justo solo durante un deploy a escala plena, por eso los deploys se congelan el día de la prueba.
  API_SET_ENV_VARS="NODE_ENV=production%%MOBILE_LEGACY_AUTH_ENABLED=false%%JWT_ACCESS_TTL=15m%%JWT_REFRESH_TTL=7d%%BETTER_AUTH_URL=${API_URL_PROJECT_NUMBER}%%GCS_MEDIA_BUCKET=${MEDIA_BUCKET}%%DB_POOL_MAX=6%%DB_CONNECTION_TIMEOUT_MS=5000%%DB_STATEMENT_TIMEOUT_MS=10000"
  if [[ -n "$CORS_ORIGIN_EXISTENTE" ]]; then
    API_SET_ENV_VARS="${API_SET_ENV_VARS}%%CORS_ORIGIN=${CORS_ORIGIN_EXISTENTE}"
    info "CORS_ORIGIN existente detectado ('$CORS_ORIGIN_EXISTENTE') — se re-incluye en este deploy para no perderlo."
  else
    info "Sin CORS_ORIGIN existente en quivo-api (primer deploy, o el paso 5 todavía no corrió nunca) — no hay nada que preservar."
  fi
  #
  # MOBILE_LEGACY_AUTH_ENABLED=false explícito (no pisar con "true", instrucción del
  # brief): apps/api/src/modules/auth-movil/auth-movil.service.ts:1129 hace
  # `!== 'false'`, es decir el default SIN esta variable es "habilitado". Esta misma rama
  # (feat/login-movil-un-paso) está reemplazando el login legado de vehículo/RUT por el
  # login móvil de un paso — el deploy de producción debe arrancar con el legado apagado,
  # no heredarlo prendido por omisión.
  #
  # JWT_ACCESS_TTL/JWT_REFRESH_TTL: confirmados leyendo packages/db/src/auth.ts:162,168
  # (Better-Auth, no apps/api/src — por eso no aparecían en un grep acotado a apps/api). Se
  # fijan acá explícitos con los mismos valores que ya son default en el código (15m/7d,
  # ver también .env.example) para que sean ajustables sin rebuildear la imagen.
  #
  # API_PUBLIC_URL NO se incluye: se buscó en todo apps/api/src y el único consumidor real
  # es packages/db/prisma/seed.ts (el seed, no el runtime de la API/worker) — no hace falta
  # en ninguno de los tres servicios que despliega este script.
  #
  # DATABASE_URL NO se monta acá a propósito (D1 de la auditoría de este script). Es el rol
  # "postgres" de Cloud SQL: dueño de las tablas y cloudsqlsuperuser, capaz de un
  # `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` sobre todo el modelo multi-tenant. Ningún
  # código de runtime la usa — packages/db/src/client.ts:41-66 conecta con
  # RUNTIME_DATABASE_URL (rol "quivo_app", sin BYPASSRLS) fuera de development, y el otro
  # consumidor (apps/api/src/modules/retencion-gps/retencion-gps.service.ts) hace
  # `RUNTIME_DATABASE_URL ?? DATABASE_URL`, así que con RUNTIME_DATABASE_URL seteada tampoco
  # la toca (el health check usa el cliente Prisma compartido). apps/api/src/main.ts (validateRuntimeConfig) exige RUNTIME_DATABASE_URL, no
  # DATABASE_URL — así que este --set-secrets ya no necesita cargarla para pasar ese gate.
  # quivo-api corre con --allow-unauthenticated (expuesto a internet): montarle igual la
  # credencial dueña de las tablas sería darle a un servicio público más blast radius del
  # que necesita. DATABASE_URL SÍ sigue viva en Secret Manager y montada en el Job de
  # migraciones (paso 2) — es el único lugar del script que la necesita de verdad.
  gcloud run deploy quivo-api \
    --project "$PROJECT" \
    --region "$REGION" \
    --image "$API_IMAGE" \
    --platform managed \
    --allow-unauthenticated \
    --cpu 1 --memory 1Gi \
    --min-instances 1 --max-instances 3 \
    --service-account "$SERVICE_ACCOUNT" \
    --vpc-connector "$VPC_CONNECTOR" \
    --add-cloudsql-instances "$CONNECTION_NAME" \
    --set-secrets "RUNTIME_DATABASE_URL=RUNTIME_DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,REDIS_URL=REDIS_URL:latest" \
    --set-env-vars "^%%^${API_SET_ENV_VARS}"

  API_URL="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)')"
  [[ -n "$API_URL" ]] || fail "quivo-api se desplegó pero no se pudo leer su URL."
  info "quivo-api desplegado: $API_URL"

  # Ver verify_allow_unauthenticated arriba: si esto falla (fail() aborta con exit 1), los
  # pasos 5 y 7 no llegan a correr — a propósito, no tiene sentido setear CORS ni esperar el
  # health check de un servicio que nadie puede alcanzar.
  verify_allow_unauthenticated "quivo-api" "$API_URL"
fi

# ============================================================================
# Paso 4/7 — Build + verificación local + deploy de quivo-web
# ============================================================================
WEB_URL=""

if [[ "$NEEDS_WEB_DEPLOY" == true ]]; then
  # Si este run no desplegó quivo-api (p. ej. --solo web), la URL tiene que venir de un
  # deploy previo — igual que el viejo deploy-web.sh, que siempre asumía a quivo-api ya
  # desplegado.
  if [[ -z "$API_URL" ]]; then
    API_URL="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" \
      --format='value(status.url)' 2>/dev/null || true)"
    [[ -n "$API_URL" ]] || fail "quivo-api no está desplegado todavía (o no se pudo leer su URL) y --solo web lo necesita para hornear NEXT_PUBLIC_API_URL. Corré primero 'scripts/deploy-gcp.sh --solo api' (o un deploy completo)."
    info "Reusando quivo-api ya desplegado: $API_URL"
  fi

  # Google Maps (/en-vivo): la key y el Map ID ya se validaron en el preflight (Paso 0/7), antes
  # de migraciones y del deploy de la API: GOOGLE_MAPS_WEB_KEY / GOOGLE_MAPS_MAP_ID se hornean abajo.

  info "Paso 4/7: build y push de la imagen del panel ($WEB_IMAGE)..."
  # NEXT_PUBLIC_API_URL va SIN /v1 (apps/web/src/lib/api/client.ts concatena el prefijo en
  # cada llamada) y como --build-arg, no como env var de Cloud Run (se hornea en build
  # time en los chunks de JS — ver comentario largo del Dockerfile de apps/web y el que
  # sigue en el paso de verificación de abajo).
  docker buildx build --platform linux/amd64 \
    -f apps/web/Dockerfile \
    --build-arg NEXT_PUBLIC_API_URL="$API_URL" \
    --build-arg NEXT_PUBLIC_DEV_BYPASS_AUTH=false \
    --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_WEB_KEY" \
    --build-arg NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID="$GOOGLE_MAPS_MAP_ID" \
    -t "$WEB_IMAGE" --push .
  info "Imagen $WEB_IMAGE publicada en Artifact Registry."

  info "Verificando la imagen del panel localmente antes de desplegar..."
  # Mismo procedimiento que el viejo deploy-web.sh (pasos 2a/2b), conservado tal cual:
  # arranca el contenedor recién publicado, confirma que responde, y grepea los chunks de
  # JS (no el HTML — "/" redirige a "/login" del lado del cliente y las NEXT_PUBLIC_* se
  # inlinean en el JS, nunca en el HTML servido) por la URL del API horneada.
  docker pull "$WEB_IMAGE"

  CONTAINER_NAME="quivo-web-verify-$$"
  docker run -d --rm -P -e PORT=8080 --name "$CONTAINER_NAME" "$WEB_IMAGE" >/dev/null

  LOCAL_PORT="$(docker port "$CONTAINER_NAME" 8080/tcp | head -n1 | cut -d: -f2)"
  [[ -n "$LOCAL_PORT" ]] || fail "No se pudo determinar el puerto local del contenedor de verificación."

  READY=0
  for _ in $(seq 1 15); do
    if curl -fsS --max-time 5 -o /dev/null "http://localhost:${LOCAL_PORT}"; then
      READY=1
      break
    fi
    sleep 1
  done
  (( READY == 1 )) || fail "El contenedor de verificación ($WEB_IMAGE) no respondió tras 15 intentos. Revisar 'docker logs $CONTAINER_NAME' (ya se limpió) o correrlo a mano."

  readonly STATIC_DIR="/app/apps/web/.next/static"

  if docker exec "$CONTAINER_NAME" sh -c "grep -rqF 'http://localhost:3000' '$STATIC_DIR'"; then
    fail "La imagen $WEB_IMAGE tiene 'http://localhost:3000' horneado en sus chunks de JS: el --build-arg NEXT_PUBLIC_API_URL no se aplicó. Abortando antes de tocar Cloud Run."
  fi
  if ! docker exec "$CONTAINER_NAME" sh -c "grep -rqF '$API_URL' '$STATIC_DIR'"; then
    fail "Los chunks de JS de la imagen no contienen la URL del API ($API_URL). Abortando antes de desplegar."
  fi
  info "Verificación OK: el contenedor responde y sus chunks de JS tienen la URL del API correcta."

  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  CONTAINER_NAME=""

  info "Desplegando quivo-web en Cloud Run..."
  # Sin --vpc-connector, sin --add-cloudsql-instances, sin secretos: el panel no toca la
  # DB ni Redis (ver cabecera del script y docs/adr/0002-gcp.md — apps/web es un SPA con
  # cáscara Next, el browser pega directo contra la API).
  gcloud run deploy quivo-web \
    --project "$PROJECT" \
    --region "$REGION" \
    --image "$WEB_IMAGE" \
    --platform managed \
    --allow-unauthenticated \
    --cpu 1 --memory 512Mi \
    --min-instances 0 --max-instances 3 \
    --port 8080 \
    --service-account "$SERVICE_ACCOUNT"

  WEB_URL="$(gcloud run services describe quivo-web --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)')"
  [[ -n "$WEB_URL" ]] || fail "quivo-web se desplegó pero no se pudo leer su URL."
  WEB_URL="${WEB_URL%/}"
  info "quivo-web desplegado: $WEB_URL"

  # Ver verify_allow_unauthenticated arriba (misma verificación que quivo-api en el paso 3).
  verify_allow_unauthenticated "quivo-web" "$WEB_URL"
fi

# ============================================================================
# Paso 5/7 — CORS_ORIGIN en quivo-api con la URL real del panel
# ============================================================================
if [[ -n "$WEB_URL" ]]; then
  # Cloud Run expone cada servicio en DOS URLs válidas y distintas: la basada en hash que
  # devuelve `status.url` (la que lee $WEB_URL arriba) y una segunda basada en el número de
  # proyecto, con forma `https://<servicio>-<project-number>.<región>.run.app`. Las dos
  # resuelven al mismo servicio. Esto ya mordió a este proyecto una vez (docs/handoff.md,
  # entrada "La trampa de CORS que se esquivó", PR #23/#49): `status.url` devolvía
  # `https://quivo-web-3mrviblcia-tl.a.run.app` mientras `CORS_ORIGIN` había quedado en la
  # URL de número-de-proyecto, y como en ese momento main.ts comparaba un string único
  # exacto, cualquiera con el panel abierto en la otra URL se quedaba sin login. Hoy
  # main.ts:56-58 sí soporta una lista separada por comas — así que se setean las DOS acá,
  # en vez de repetir el bug con una URL "sin usar" bloqueada.
  WEB_URL_PROJECT_NUMBER="https://quivo-web-${PROJECT_NUMBER}.${REGION}.run.app"
  CORS_ORIGIN_VALUE="${WEB_URL},${WEB_URL_PROJECT_NUMBER}"
  # CORS_ORIGIN_VALUE SIEMPRE tiene una coma adentro (las dos URLs de arriba, a propósito —
  # ver el comentario de arriba sobre por qué son dos). `--update-env-vars` es un ArgDict de
  # gcloud que separa por coma antes que nada, así que pasarlo tal cual como
  # `--update-env-vars "CORS_ORIGIN=${CORS_ORIGIN_VALUE}"` lo parte en dos argumentos —
  # gcloud entiende que hay una SEGUNDA entrada de env var sin "=" (la mitad después de la
  # coma) y falla con `Bad syntax for dict arg`. Es el mismo bug de la coma que ya se arregló
  # en el bloque de migraciones más arriba (ver el comentario grande arriba de ROTATE_JS) —
  # acá vuelve a aparecer porque `--update-env-vars` es del mismo tipo ArgDict que `--args`,
  # no un caso aislado de este flag. Se resuelve igual: delimitador alternativo `^%%^` en vez
  # de coma.
  fail_if_delimiter_collision "CORS_ORIGIN_VALUE" "$CORS_ORIGIN_VALUE"
  info "Paso 5/7: actualizando CORS_ORIGIN en quivo-api → $CORS_ORIGIN_VALUE"

  # PREV_API_REVISION ya se captura AL INICIO del paso 3 (antes de este script tocar
  # quivo-api de cualquier forma) para cualquier run que despliegue la API — ver el
  # comentario largo ahí. Ese valor es el correcto: la revisión previa a TODO este run, no
  # sólo a este update de CORS_ORIGIN. Si este run corrió con `--solo web` (NEEDS_API_DEPLOY
  # en false), el paso 3 no corrió y PREV_API_REVISION sigue vacío acá — recién en ese caso
  # se captura, porque este `services update` es la primera mutación de quivo-api en el run.
  if [[ -z "$PREV_API_REVISION" ]]; then
    PREV_API_REVISION="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" \
      --format='value(status.latestReadyRevisionName)')"
    [[ -n "$PREV_API_REVISION" ]] || fail "No se pudo capturar la revisión actual de quivo-api antes de modificarlo. Abortando para no quedar sin un rollback conocido."
    info "Revisión actual de quivo-api (rollback si algo sale mal): $PREV_API_REVISION"
  fi

  # Cada entrada tiene que ser la URL EXACTA (sin barra final) — apps/api/src/main.ts hace
  # `.split(',').map(trim)` y la comparación de origen del browser contra cada entrada es
  # exacta (no regex, no wildcard).
  gcloud run services update quivo-api \
    --project "$PROJECT" \
    --region "$REGION" \
    --update-env-vars "^%%^CORS_ORIGIN=${CORS_ORIGIN_VALUE}"
  info "CORS_ORIGIN actualizado. Esto crea una revisión nueva de quivo-api."
else
  # Verdad desde que el paso 3 preserva CORS_ORIGIN (lee el valor existente y lo re-incluye
  # en su propio --set-env-vars — ver el comentario largo ahí): si el paso 3 corrió en este
  # run, CORS_ORIGIN efectivamente queda como estaba. Si ni el paso 3 ni el paso 5 corrieron
  # (p. ej. --solo worker), quivo-api ni se toca, así que también queda como estaba.
  info "Paso 5/7: omitido (no se desplegó quivo-web en este run — CORS_ORIGIN queda como estaba; si el paso 3 corrió, lo preservó explícitamente)."
fi

# ============================================================================
# Paso 6/7 — Deploy de quivo-worker (Cloud Run Worker Pool)
# ============================================================================
if [[ "$NEEDS_WORKER_DEPLOY" == true ]]; then
  info "Paso 6/7: desplegando quivo-worker (Worker Pool) en Cloud Run..."
  # MISMA imagen que quivo-api, override de comando (ver cabecera del Dockerfile raíz,
  # bloque QUI-354): el worker (apps/api/src/worker.ts) usa
  # NestFactory.createApplicationContext, no escucha HTTP — por eso Worker Pool y no un
  # service normal (un service escalaría a cero sin tráfico HTTP y mataría al worker a
  # mitad de consumir la cola de BullMQ).
  #
  # DATABASE_URL NO se monta acá, mismo motivo que el paso 3 (deploy de quivo-api) arriba:
  # el worker sólo usa RUNTIME_DATABASE_URL (packages/db/src/client.ts) y
  # RUNTIME_DATABASE_URL ?? DATABASE_URL en retencion-gps.service.ts — nunca DATABASE_URL
  # sola. Cargarle igual el rol dueño de las tablas a un proceso que sólo necesita el rol de
  # runtime es exactamente el mismo exceso de privilegio que en quivo-api, sin ni siquiera
  # la excusa de un gate de arranque que la exija.
  #
  # SIN --vpc-connector acá, a propósito — NO es un descuido ni una inconsistencia con los
  # pasos 2 y 3 (job de migraciones y quivo-api), que sí lo usan. Es una limitación real de
  # `gcloud run worker-pools deploy`: no tiene ese flag. Confirmado contra producción, deploy
  # real fallido:
  #   ERROR: (gcloud.run.worker-pools.deploy) unrecognized arguments:
  #     --vpc-connector (did you mean '--container'?)
  #     quivo-conector
  # y confirmado también leyendo el SYNOPSIS de `gcloud run worker-pools deploy --help` en la
  # versión instalada del SDK: los worker pools sólo soportan Direct VPC egress
  # (--network/--subnet/--vpc-egress), no conectores. Se llega a la MISMA red/subred que usa
  # el conector (`$VPC_NETWORK`/`$VPC_SUBNET`, ver el comentario junto a esas constantes)
  # así que el worker sigue alcanzando Cloud SQL (10.60.0.3) y Memorystore Redis
  # (10.51.123.11:6379) por el mismo peering de private services access sobre la red
  # "default" — cambia el mecanismo de salida, no el destino.
  #
  # --vpc-egress=private-ranges-only (el default del flag, pero se deja explícito para que
  # quede documentada la elección): el worker sólo necesita salir a rangos privados RFC1918
  # (Cloud SQL y Redis, los dos IPs 10.x.x.x de arriba) — no necesita ni debe salir a
  # internet por la VPC. La otra opción, `all-traffic`, mandaría TODO el tráfico saliente
  # (incluida cualquier llamada a una API externa) por la VPC, lo que exigiría tener un
  # Cloud NAT configurado para no romper esa salida — infra que no existe y que este script
  # no aprovisiona. `private-ranges-only` no la necesita.
  gcloud run worker-pools deploy quivo-worker \
    --project "$PROJECT" \
    --region "$REGION" \
    --image "$API_IMAGE" \
    --command=node --args=apps/api/dist/worker.js \
    --instances=1 \
    --service-account "$SERVICE_ACCOUNT" \
    --network "$VPC_NETWORK" \
    --subnet "$VPC_SUBNET" \
    --vpc-egress=private-ranges-only \
    --add-cloudsql-instances "$CONNECTION_NAME" \
    --set-secrets "RUNTIME_DATABASE_URL=RUNTIME_DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,REDIS_URL=REDIS_URL:latest" \
    --set-env-vars "NODE_ENV=production,MOBILE_LEGACY_AUTH_ENABLED=false,JWT_ACCESS_TTL=15m,JWT_REFRESH_TTL=7d,DB_POOL_MAX=5,DB_CONNECTION_TIMEOUT_MS=5000,DB_STATEMENT_TIMEOUT_MS=60000"
  info "quivo-worker desplegado (Worker Pool, 1 instancia)."
fi

# ============================================================================
# Paso 7/7 — Verificación final de /v1/health/ready
# ============================================================================
# Corre si este run tocó quivo-api de cualquier forma (deploy directo o sólo el CORS
# update, que también crea una revisión nueva). Si sólo se corrió --solo worker, no hay
# nada que verificar acá (el worker no expone HTTP) — se avisa por qué se omite.
#
# Nota: esto NO diagnostica permisos de IAM — eso ya lo cubre (y hace fallar duro si falta)
# verify_allow_unauthenticated en el paso 3, antes de llegar acá. Si algún día este health
# check falla con la app devolviendo 403, NO es este bloque el que hay que mirar: es que el
# paso 3 no atajó el caso (o alguien tocó el IAM binding a mano después del deploy). No
# duplicar acá ese diagnóstico — este bloque asume que el acceso público ya está resuelto y
# sólo mide si la app arrancó sana (DB/Redis).
if [[ "$NEEDS_API_DEPLOY" == true || -n "$WEB_URL" ]]; then
  info "Paso 7/7: verificando /v1/health/ready de quivo-api..."

  if [[ -z "$API_URL" ]]; then
    API_URL="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" \
      --format='value(status.url)')"
  fi

  # Forma de la respuesta de /health (apps/api/src/health, HealthStatus):
  # {"status":"ok"|"degraded","db":"up"|"down","redis":"up"|"down"}.
  #
  # Presupuesto: 45 intentos × 4s = 180s (3 min) de espera entre reintentos, más hasta 5s de
  # --max-time por intento fallido (peor caso ~225s). Antes eran 10×2s=20s — ajustado para un
  # deploy nuevo (D3 de la auditoría de este script): es el primer arranque en frío de una
  # app Nest con Prisma, conectando a Cloud SQL por socket unix y a Redis por VPC connector,
  # y 20s alcanzaba a disparar todo el bloque de rollback de abajo con producción en
  # realidad sana, nomás lenta para arrancar. El mensaje de cada intento imprime cuánto
  # lleva esperando, para que quien mira la terminal no crea que el script se colgó.
  readonly HEALTH_MAX_ATTEMPTS=45
  readonly HEALTH_SLEEP_SECONDS=4
  HEALTH_READY=0
  for attempt in $(seq 1 "$HEALTH_MAX_ATTEMPTS"); do
    if HEALTH_BODY="$(curl -fsS --max-time 5 "${API_URL}/v1/health/ready")"; then
      if echo "$HEALTH_BODY" | grep -q '"status":"ok"' \
        && echo "$HEALTH_BODY" | grep -q '"db":"up"' \
        && echo "$HEALTH_BODY" | grep -q '"redis":"up"'; then
        HEALTH_READY=1
        break
      fi
    fi
    ELAPSED_SECONDS=$(( (attempt - 1) * HEALTH_SLEEP_SECONDS ))
    info "  ...esperando arranque de quivo-api (intento $attempt/$HEALTH_MAX_ATTEMPTS, ${ELAPSED_SECONDS}s transcurridos)"
    sleep "$HEALTH_SLEEP_SECONDS"
  done

  if (( HEALTH_READY == 0 )); then
    TOTAL_WAIT_SECONDS=$(( HEALTH_MAX_ATTEMPTS * HEALTH_SLEEP_SECONDS ))
    warn "══════════════════════════════════════════════════════════════════"
    warn "  quivo-api NO respondió sano tras este deploy."
    warn "  /v1/health/ready no devolvió {\"status\":\"ok\",\"db\":\"up\",\"redis\":\"up\"}"
    warn "  tras $HEALTH_MAX_ATTEMPTS intentos (~${TOTAL_WAIT_SECONDS}s)."
    warn "══════════════════════════════════════════════════════════════════"
    if [[ -n "$PREV_API_REVISION" ]]; then
      warn "  ROLLBACK — correr esto ahora mismo:"
      warn ""
      printf '  gcloud run services update-traffic quivo-api --project "%s" --region "%s" --to-revisions=%s=100\n' \
        "$PROJECT" "$REGION" "$PREV_API_REVISION" >&2
      warn ""
    else
      warn "  No se capturó una revisión previa en este run (era el primer deploy de quivo-api —"
      warn "  no había nada en producción antes de este run a lo que volver)."
      warn "  Ver revisiones con: gcloud run revisions list --service=quivo-api --project=$PROJECT --region=$REGION"
    fi
    fail "Deploy incompleto: quivo-api quedó en un estado no verificado."
  fi

  info "quivo-api responde sano (status=ok, db=up, redis=up)."
else
  info "Paso 7/7: omitido (--solo worker no toca quivo-api — verificar el worker con 'gcloud run worker-pools describe quivo-worker' y los logs de Cloud Logging)."
fi

info "Deploy completo."
[[ -n "$API_URL" ]] && info "API:   $API_URL"
[[ -n "$WEB_URL" ]] && info "Panel: $WEB_URL"
info "Falta la verificación end-to-end manual (login real + Playwright) — no la hace este script."
