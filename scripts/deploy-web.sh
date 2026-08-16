#!/usr/bin/env bash
# Despliega apps/web (panel admin) a Cloud Run: build+push de la imagen, verificación
# local de que no quedó rota, `gcloud run deploy`, y apertura de CORS en quivo-api con
# verificación de que el API sigue sano. QUI-354/ADR-0002.
#
# Por qué el panel NO necesita Cloud SQL ni VPC connector (a diferencia de quivo-api):
# apps/web es un SPA con cáscara Next — todo `page`/`layout` salvo app/layout.tsx es
# 'use client', y apps/web/package.json no incluye better-auth, @quivo/db ni
# @prisma/client (ver Dockerfile de apps/web). El navegador pega directo contra el API
# con `Authorization: Bearer` y la sesión vive en localStorage, no en cookies. El
# servicio de Cloud Run del panel solo sirve el bundle estático/SSR de Next: no toca la
# base de datos ni Redis, así que no lleva `--add-cloudsql-instances` ni
# `--vpc-connector` ni secretos.
#
# Uso:
#   scripts/deploy-web.sh [tag]        # ej.: scripts/deploy-web.sh v2
#   TAG=v2 scripts/deploy-web.sh       # equivalente, vía variable de entorno
# Sin argumento ni $TAG, usa "v1".
set -Eeuo pipefail

# ---------- logging (mismo estilo que scripts/dev-all.sh y scripts/setup-osrm.sh) ----------
info() {
  printf '\033[1;36m[DEPLOY-WEB]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[DEPLOY-WEB]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[DEPLOY-WEB]\033[0m %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Falta '$1'. Instálalo antes de continuar."
}

require_command git
require_command docker
require_command gcloud
require_command curl

docker buildx version >/dev/null 2>&1 || fail "Falta 'docker buildx' (necesario para --platform linux/amd64 --push)."

# ---------- variables ----------
readonly PROJECT="quivo-piloto"
readonly PROJECT_NUMBER="424426714260"
readonly REGION="southamerica-west1"
readonly API_URL="https://quivo-api-424426714260.southamerica-west1.run.app"
readonly SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Tag de la imagen: primer argumento posicional, si no la variable de entorno TAG, si no "v1".
readonly TAG="${1:-${TAG:-v1}}"
readonly IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/quivo/web:${TAG}"

# El Dockerfile de apps/web asume que el contexto de build es la raíz del repo (usa
# `turbo prune` sobre el monorepo completo) — el script tiene que funcionar sin importar
# desde qué directorio lo invoquen, así que resolvemos la raíz real con git en vez de
# asumir el cwd.
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)" \
  || fail "No se pudo resolver la raíz del repo con git rev-parse. ¿Estás dentro del repo?"
readonly REPO_ROOT
cd "$REPO_ROOT"

info "Repo: $REPO_ROOT"
info "Imagen: $IMAGE"

# ---------- limpieza del contenedor de verificación (paso 2), pase lo que pase ----------
CONTAINER_NAME=""
cleanup_container() {
  if [[ -n "$CONTAINER_NAME" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup_container EXIT

# ============================================================================
# Paso 1/4 — Build + push de la imagen
# ============================================================================
info "Paso 1/4: build y push de la imagen ($IMAGE)..."

# NEXT_PUBLIC_API_URL va SIN /v1: apps/web/src/lib/api/client.ts:36 concatena el
# prefijo en cada llamada (`${API_URL}/v1${path}`). Si acá se pusiera con /v1, todas
# las rutas del panel quedarían como /v1/v1/... y el panel fallaría entero.
#
# NEXT_PUBLIC_API_URL va como --build-arg y NO como variable de entorno de Cloud Run:
# las NEXT_PUBLIC_* de Next se inlinean en el bundle del cliente en build time (ver
# apps/web/Dockerfile:53-63) — configurarla en el servicio de Cloud Run después del
# deploy no tiene ningún efecto sobre el HTML/JS ya compilado. Si falta acá, el código
# cae al fallback 'http://localhost:3000' (client.ts:1) y el panel sale roto sin
# ningún error visible hasta que alguien lo prueba a mano.
docker buildx build --platform linux/amd64 \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL="$API_URL" \
  --build-arg NEXT_PUBLIC_DEV_BYPASS_AUTH=false \
  -t "$IMAGE" --push .

info "Imagen publicada en Artifact Registry."

# ============================================================================
# Paso 2/4 — Verificar la imagen antes de desplegar
# ============================================================================
info "Paso 2/4: verificando la imagen localmente antes de desplegar..."

# `docker buildx build --push` (paso 1) publica la imagen al registry pero NO la carga
# en el daemon local (build de una sola plataforma en modo push-only, sin --load) — hay
# que traerla del registry para poder correrla acá y confirmar que el build-arg de
# arriba quedó bien horneado.
docker pull "$IMAGE"

CONTAINER_NAME="quivo-web-verify-$$"
# -P mapea el puerto expuesto (8080, ver apps/web/Dockerfile) a un puerto libre del
# host elegido por Docker, para no chocar con los puertos fijos que usa dev-all.sh
# (3100 web, 3001 backend, 8081 Expo).
docker run -d --rm -P -e PORT=8080 --name "$CONTAINER_NAME" "$IMAGE" >/dev/null

LOCAL_PORT="$(docker port "$CONTAINER_NAME" 8080/tcp | head -n1 | cut -d: -f2)"
[[ -n "$LOCAL_PORT" ]] || fail "No se pudo determinar el puerto local del contenedor de verificación."

# --- 2a: el contenedor arranca y responde ---------------------------------
# Chequeo separado del de la URL horneada (2b) a propósito: si esto falla, el problema
# es que Next standalone no levanta (imagen rota, CMD roto, etc.); si falla 2b, el
# problema es un --build-arg mal pasado en el paso 1. Son causas y fixes distintos —
# mezclar los dos mensajes hace perder tiempo diagnosticando lo que no es.
READY=0
for _ in $(seq 1 15); do
  if curl -fsS --max-time 5 -o /dev/null "http://localhost:${LOCAL_PORT}"; then
    READY=1
    break
  fi
  sleep 1
done
(( READY == 1 )) || fail "El contenedor de verificación ($IMAGE) no respondió tras 15 intentos (¿arrancó Next standalone?). Revisar 'docker logs $CONTAINER_NAME' (ya se limpió) o correrlo a mano."

# --- 2b: la URL del API quedó bien horneada en el bundle --------------------
# OJO: esta verificación mira los CHUNKS de JS compilados (.next/static), NO el HTML
# servido por `curl http://localhost:$LOCAL_PORT`. Dos motivos, confirmados corriendo
# esta misma imagen a mano — no es una elección estética, es la única forma que
# funciona:
#   1. `/` redirige a `/login` del lado del cliente.
#   2. Next inlinea las NEXT_PUBLIC_* en los chunks de JS en build time (ver
#      apps/web/Dockerfile:53-63), NO en el HTML que el servidor devuelve. El HTML de
#      cualquier ruta del panel jamás va a contener la URL del API ni "localhost:3000",
#      así que grepear el HTML SIEMPRE da falso negativo y aborta un deploy sano.
# Ruta real de los estáticos dentro de la imagen (confirmada con `docker exec ... ls`,
# no asumida): /app/apps/web/.next/static — sale de WORKDIR /app (Dockerfile:69) +
# `COPY .../.next/static ./apps/web/.next/static` (Dockerfile:80); el WORKDIR cambia a
# /app/apps/web recién en la línea 84, después de las COPY, así que no afecta esta ruta.
readonly STATIC_DIR="/app/apps/web/.next/static"

if docker exec "$CONTAINER_NAME" sh -c "grep -rqF 'http://localhost:3000' '$STATIC_DIR'"; then
  fail "La imagen $IMAGE tiene 'http://localhost:3000' horneado en sus chunks de JS ($STATIC_DIR): el --build-arg NEXT_PUBLIC_API_URL del paso 1 no se pasó o no se aplicó. Desplegar esta imagen publicaría un panel roto — abortando antes de tocar Cloud Run."
fi

if ! docker exec "$CONTAINER_NAME" sh -c "grep -rqF '$API_URL' '$STATIC_DIR'"; then
  fail "Los chunks de JS de la imagen ($STATIC_DIR) no contienen la URL del API ($API_URL). Abortando antes de desplegar — revisar el build-arg del paso 1."
fi

info "Verificación OK: el contenedor responde y sus chunks de JS tienen la URL del API correcta, sin caer al fallback localhost."

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
CONTAINER_NAME=""

# ============================================================================
# Paso 3/4 — Deploy a Cloud Run
# ============================================================================
info "Paso 3/4: desplegando quivo-web en Cloud Run ($REGION)..."

# Sin --add-cloudsql-instances, sin --vpc-connector, sin secretos: el panel no toca la
# base de datos (ver comentario de cabecera). min-instances 0 porque el panel tolera
# arranque en frío; quivo-api queda en su propio mínimo, sin tocar acá.
gcloud run deploy quivo-web \
  --project "$PROJECT" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 --max-instances 3 \
  --service-account "$SERVICE_ACCOUNT"

info "quivo-web desplegado."

# ============================================================================
# Paso 4/4 — Abrir CORS en el API y verificar que no se rompió
# ============================================================================
info "Paso 4/4: leyendo la URL real del panel y abriendo CORS en quivo-api..."

PANEL_URL="$(gcloud run services describe quivo-web --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
[[ -n "$PANEL_URL" ]] || fail "No se pudo leer la URL del servicio quivo-web recién desplegado."
# Sin barra final: ver por qué más abajo, antes del gcloud run services update.
PANEL_URL="${PANEL_URL%/}"
info "URL real del panel: $PANEL_URL"

# Capturar la revisión actual de quivo-api ANTES de tocarlo, para poder imprimir el
# comando de rollback ya completo si la verificación de más abajo falla. Si esto falla,
# abortamos sin tocar quivo-api: no vale la pena arriesgar el API de producción (del que
# depende el APK del conductor) sin tener ya en mano a qué revisión volver.
PREV_API_REVISION="$(gcloud run services describe quivo-api --project "$PROJECT" --region "$REGION" --format='value(status.latestReadyRevisionName)')"
[[ -n "$PREV_API_REVISION" ]] || fail "No se pudo capturar la revisión actual de quivo-api antes de modificarlo. Abortando para no quedar sin un rollback conocido."
info "Revisión actual de quivo-api (rollback si algo sale mal): $PREV_API_REVISION"

# CORS_ORIGIN tiene que ser la URL EXACTA del panel, sin barra final: apps/api/src/main.ts:51-54
# usa `origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000'` — un string único, no un
# array ni una regex — y la comparación de origen que hace el navegador es exacta. Un solo
# carácter de más (barra final, protocolo distinto, subdominio distinto) rompe el preflight y
# el panel no puede ni loguear.
gcloud run services update quivo-api \
  --project "$PROJECT" \
  --region "$REGION" \
  --update-env-vars "CORS_ORIGIN=${PANEL_URL}"

info "CORS_ORIGIN actualizado. Esto crea una revisión nueva de quivo-api — verificando que siga sano..."

HEALTH_READY=0
for _ in $(seq 1 10); do
  if HEALTH_BODY="$(curl -fsS --max-time 5 "${API_URL}/v1/health/ready")"; then
    if echo "$HEALTH_BODY" | grep -q '"status":"ok"' \
      && echo "$HEALTH_BODY" | grep -q '"db":"up"' \
      && echo "$HEALTH_BODY" | grep -q '"redis":"up"'; then
      HEALTH_READY=1
      break
    fi
  fi
  sleep 2
done

if (( HEALTH_READY == 0 )); then
  warn "══════════════════════════════════════════════════════════════════"
  warn "  quivo-api NO responde sano tras el cambio de CORS_ORIGIN."
  warn "  /v1/health/ready no devolvió {\"status\":\"ok\",\"db\":\"up\",\"redis\":\"up\"}"
  warn "  tras 10 intentos (20s). El APK del conductor depende de este servicio."
  warn "══════════════════════════════════════════════════════════════════"
  warn "  ROLLBACK — correr esto ahora mismo:"
  warn ""
  printf '  gcloud run services update-traffic quivo-api --project "%s" --region "%s" --to-revisions=%s=100\n' \
    "$PROJECT" "$REGION" "$PREV_API_REVISION" >&2
  warn ""
  fail "quivo-web quedó desplegado, pero quivo-api quedó en un estado no verificado. Ejecutar el rollback de arriba antes de dar el deploy por bueno."
fi

info "quivo-api sigue respondiendo OK tras el cambio de CORS."
info "Deploy completo. Panel: $PANEL_URL"
info "Falta la verificación end-to-end manual (login real + Playwright) — no la hace este script."
