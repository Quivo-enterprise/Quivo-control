#!/usr/bin/env bash

set -Eeuo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly EXPECTED_NODE_MAJOR=22

declare -a SERVICE_PIDS=()
SHUTTING_DOWN=0
INFRA_STARTED=0

info() {
  printf '\033[1;36m[QUIVO]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[QUIVO]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[QUIVO]\033[0m %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Falta '$1'. Instálalo antes de continuar."
}

require_free_port() {
  local port="$1"
  local service="$2"

  if [[ -n "$(ss -ltnH "sport = :$port" 2>/dev/null)" ]]; then
    fail "El puerto $port ($service) ya está ocupado. Libéralo y vuelve a ejecutar pnpm dev."
  fi
}

detect_lan_ip() {
  local route_info=""
  local detected_ip=""

  if [[ -n "${QUIVO_HOST_IP:-}" ]]; then
    detected_ip="$QUIVO_HOST_IP"
  elif command -v ip >/dev/null 2>&1; then
    route_info="$(ip -4 route get 1.1.1.1 2>/dev/null || true)"
    if [[ "$route_info" =~ src[[:space:]]+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+) ]]; then
      detected_ip="${BASH_REMATCH[1]}"
    fi
  fi

  if [[ ! "$detected_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$detected_ip" == 127.* ]]; then
    fail "No se pudo detectar la IP LAN. Indícala con QUIVO_HOST_IP=192.168.x.x pnpm dev."
  fi

  printf '%s' "$detected_ip"
}

copy_env_if_missing() {
  local source_file="$1"
  local target_file="$2"

  if [[ ! -f "$target_file" ]]; then
    cp "$source_file" "$target_file"
    info "Creado ${target_file#"$REPO_ROOT"/} desde el archivo de ejemplo."
  fi
}

with_api_env() (
  # Prisma 7 no carga .env automáticamente desde prisma.config.ts. El subshell evita
  # propagar PORT=3001 a Next.js y mantiene cada aplicación en su puerto correspondiente.
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/apps/api/.env"
  set +a
  "$@"
)

run_backend_terminal() {
  local compiler_pid=""
  local server_pid=""

  cleanup_backend_terminal() {
    local pid
    for pid in "$compiler_pid" "$server_pid"; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill -TERM -- "-$pid" 2>/dev/null || true
      fi
    done
    wait "$compiler_pid" "$server_pid" 2>/dev/null || true
  }

  trap 'cleanup_backend_terminal; exit 130' INT
  trap 'cleanup_backend_terminal; exit 143' TERM
  trap cleanup_backend_terminal EXIT

  info "Backend disponible en http://localhost:3001"
  if [[ -n "${QUIVO_HOST_IP:-}" ]]; then
    info "Backend para el móvil: http://${QUIVO_HOST_IP}:3001"
  fi
  info "tsc y Node reiniciarán automáticamente al detectar cambios."

  setsid pnpm --filter @quivo/api exec tsc -p tsconfig.json --watch --preserveWatchOutput &
  compiler_pid="$!"
  setsid pnpm --filter @quivo/api exec node --watch dist/main.js &
  server_pid="$!"

  set +e
  wait -n "$compiler_pid" "$server_pid"
  local service_status="$?"
  set -e

  warn "Un proceso del backend terminó (código $service_status)."
  return "$service_status"
}

run_terminal_service() {
  local service="$1"

  cd "$REPO_ROOT"
  printf '\033]0;QUIVO %s\007' "$service"

  case "$service" in
    backend)
      run_backend_terminal
      ;;
    web)
      info "Web disponible en http://localhost:3100"
      exec env NEXT_PUBLIC_DEV_BYPASS_AUTH=false pnpm --filter @quivo/web dev --port 3100
      ;;
    mobile)
      info "Expo/Metro (cliente de desarrollo) disponible en http://localhost:8081"
      info "La app móvil usará ${EXPO_PUBLIC_API_URL:-una URL de API no configurada}"
      info "No abras el QR con Expo Go: usa la app QUIVO Conductor instalada en Android."
      exec pnpm --filter @quivo/mobile start
      ;;
    *)
      fail "Servicio desconocido: $service"
      ;;
  esac
}

open_service_terminal() {
  local service="$1"
  local title="$2"

  if command -v konsole >/dev/null 2>&1; then
    setsid -f konsole --separate --hold --workdir "$REPO_ROOT" \
      -p "tabtitle=$title" \
      -e bash "$REPO_ROOT/scripts/dev-all.sh" --service "$service" \
      </dev/null >/dev/null 2>&1
  elif command -v alacritty >/dev/null 2>&1; then
    setsid -f alacritty --hold --title "$title" --working-directory "$REPO_ROOT" \
      -e bash "$REPO_ROOT/scripts/dev-all.sh" --service "$service" \
      </dev/null >/dev/null 2>&1
  else
    return 1
  fi
}

if [[ "${1:-}" == "--service" ]]; then
  [[ -n "${2:-}" ]] || fail "Falta indicar el servicio."
  run_terminal_service "$2"
  exit $?
fi

start_service() {
  local name="$1"
  shift

  info "Iniciando $name..."
  setsid "$@" &
  SERVICE_PIDS+=("$!")
}

stop_services() {
  local pid

  (( SHUTTING_DOWN == 1 )) && return
  SHUTTING_DOWN=1

  if (( ${#SERVICE_PIDS[@]} > 0 )); then
    info "Deteniendo backend, web y móvil..."

    for pid in "${SERVICE_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM -- "-$pid" 2>/dev/null || true
      fi
    done

    for pid in "${SERVICE_PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  if (( INFRA_STARTED == 1 )); then
    info "PostgreSQL y Redis siguen activos. Para apagarlos: docker compose down"
  fi
}

on_signal() {
  local signal_exit_code="$1"
  stop_services
  exit "$signal_exit_code"
}

trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap stop_services EXIT

cd "$REPO_ROOT"

require_command node
require_command pnpm
require_command docker
require_command setsid
require_command ss

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "$EXPECTED_NODE_MAJOR" ]]; then
  warn "El proyecto requiere Node 22.x; estás usando $(node --version)."
fi

docker compose version >/dev/null 2>&1 || fail "Docker Compose no está disponible."
docker info >/dev/null 2>&1 || fail "Docker no está iniciado."

copy_env_if_missing "$REPO_ROOT/.env.example" "$REPO_ROOT/apps/api/.env"
copy_env_if_missing "$REPO_ROOT/.env.example" "$REPO_ROOT/packages/db/.env"
copy_env_if_missing "$REPO_ROOT/apps/web/.env.example" "$REPO_ROOT/apps/web/.env.local"

QUIVO_HOST_IP="$(detect_lan_ip)"
export QUIVO_HOST_IP
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://${QUIVO_HOST_IP}:3001}"
info "IP LAN detectada: $QUIVO_HOST_IP"
info "La app móvil apuntará a $EXPO_PUBLIC_API_URL"

require_free_port 3100 "web"
require_free_port 3001 "backend"
require_free_port 8081 "Expo/Metro"

if [[ ! -d "$REPO_ROOT/node_modules/.pnpm" ]]; then
  info "Instalando dependencias..."
  pnpm install
fi

info "Levantando PostgreSQL/PostGIS y Redis..."
docker compose up -d --wait
INFRA_STARTED=1

info "Compilando paquetes compartidos y backend..."
with_api_env pnpm --filter '@quivo/api...' build

info "Aplicando migraciones y preparando usuarios demo..."
with_api_env pnpm --filter @quivo/db prisma:migrate:deploy
with_api_env pnpm --filter @quivo/db prisma:seed

if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && [[ "${QUIVO_SINGLE_TERMINAL:-0}" != "1" ]]; then
  info "Abriendo una terminal para cada aplicación..."
  if open_service_terminal backend "QUIVO — Backend" && \
    open_service_terminal web "QUIVO — Web" && \
    open_service_terminal mobile "QUIVO — Móvil (Expo)"; then
    trap - EXIT INT TERM
    info "Backend, web y móvil se abrieron en tres terminales independientes."
    info "Puedes cerrar cada ventana por separado."
    info "PostgreSQL y Redis siguen activos. Para apagarlos: docker compose down"
    exit 0
  fi
  warn "No se pudo abrir un emulador de terminal; se usará esta ventana."
fi

# Nest necesita el JavaScript emitido por tsc para conservar la metadata de decoradores.
# Un watcher recompila y el otro reinicia Node cuando cambia dist/.
start_service "compilador del backend" \
  pnpm --filter @quivo/api exec tsc -p tsconfig.json --watch --preserveWatchOutput
start_service "backend (http://localhost:3001)" \
  pnpm --filter @quivo/api exec node --watch dist/main.js
start_service "web (http://localhost:3100)" \
  env NEXT_PUBLIC_DEV_BYPASS_AUTH=false pnpm --filter @quivo/web dev --port 3100

if [[ -r /dev/tty ]]; then
  info "Iniciando app móvil (Expo)..."
  setsid pnpm --filter @quivo/mobile start < /dev/tty &
  SERVICE_PIDS+=("$!")
else
  start_service "app móvil (Expo)" pnpm --filter @quivo/mobile start
fi

info "Todo está en ejecución. Presiona Ctrl+C para detener las aplicaciones."

set +e
wait -n "${SERVICE_PIDS[@]}"
service_status=$?
set -e

warn "Uno de los procesos terminó (código $service_status); se detendrá el resto."
if (( service_status == 0 )); then
  exit 1
fi
exit "$service_status"
