#!/usr/bin/env bash
set -euo pipefail

for required_name in MOBILE_ACCESS_TOKEN SESSION_ID DEVICE_ID; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "Falta la variable requerida: ${required_name}" >&2
    exit 2
  fi
done

if ! command -v k6 >/dev/null 2>&1; then
  echo 'k6 no está instalado o no está en PATH' >&2
  exit 2
fi

run_started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
run_temp_dir="$(mktemp -d -t quivo-k6-XXXXXX)"
summary_path="${run_temp_dir}/summary.json"
queue_path="${run_temp_dir}/queue.json"
monitor_pid=''

cleanup() {
  if [[ -n "${monitor_pid}" ]] && kill -0 "${monitor_pid}" 2>/dev/null; then
    kill -TERM "${monitor_pid}" 2>/dev/null || true
    wait "${monitor_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${run_temp_dir}"
}
trap cleanup EXIT

pnpm --filter @quivo/api exec node ../../tests/load/k6/monitor-queue.mjs "${queue_path}" &
monitor_pid="$!"

k6 run --summary-export "${summary_path}" tests/load/k6/sync-ingestion.js

kill -TERM "${monitor_pid}"
wait "${monitor_pid}"
monitor_pid=''

pnpm --filter @quivo/api exec node ../../tests/load/k6/verify-ingestion.mjs \
  "${summary_path}" "${queue_path}" "${run_started_at}"
