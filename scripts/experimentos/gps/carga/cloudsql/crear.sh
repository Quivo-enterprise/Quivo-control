#!/usr/bin/env bash
# Crea la instancia Cloud SQL TEMPORAL para la confirmación paso B'
# (docs/plan-experimento-puntos-gps.md §10, aprobado por el CTO 2026-09-22).
#
# NUNCA toca la base de producción: instancia nueva, nombre HARDCODEADO
# (`quivo-carga-temp`), sin relación con ninguna instancia existente. Este script CORRE
# `gcloud` — el agente tiene prohibido ejecutarlo (el clasificador de permisos bloquea
# operaciones sobre `quivo-control-prod`); lo corre el CTO, ver RUNBOOK.md.
#
# Requiere: gcloud autenticado contra `quivo-control-prod`, `psql`, `curl`, `openssl`.
# Uso: ./crear.sh
set -euo pipefail

PROYECTO="quivo-control-prod"
REGION="southamerica-west1"
NOMBRE="quivo-carga-temp"
DB_NOMBRE="quivo_carga"
ENV_FILE="${HOME}/.quivo-carga-temp.env"

echo "== 1/6: verificar que '$NOMBRE' NO exista ya (abortar si existe) =="
if gcloud sql instances describe "$NOMBRE" --project="$PROYECTO" >/dev/null 2>&1; then
  echo "ABORTADO: la instancia '$NOMBRE' ya existe en '$PROYECTO'." >&2
  echo "Si es de una corrida anterior sin borrar, correr primero ./borrar.sh" >&2
  exit 1
fi
echo "OK: '$NOMBRE' no existe todavía."

echo "== 2/6: detectar la IP pública actual (para --authorized-networks) =="
IP_PUBLICA="$(curl -fsS https://api.ipify.org)"
if [[ -z "$IP_PUBLICA" ]]; then
  echo "ABORTADO: no se pudo detectar la IP pública actual con curl (api.ipify.org)." >&2
  exit 1
fi
echo "IP pública detectada: ${IP_PUBLICA} -> se autoriza ${IP_PUBLICA}/32"

echo "== 3/6: generar contraseña aleatoria para el rol 'postgres' =="
# hex (solo [0-9a-f]) a propósito: nunca necesita URL-encoding en el DATABASE_URL de abajo,
# a diferencia de base64 (que puede traer '+', '/', '=').
PASSWORD="$(openssl rand -hex 24)"
echo "Contraseña generada (no se imprime; queda en $ENV_FILE al final)."

echo "== 4/6: crear la instancia (bloquea hasta que esté RUNNABLE; puede tardar varios minutos) =="
gcloud sql instances create "$NOMBRE" \
  --project="$PROYECTO" \
  --region="$REGION" \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-custom-1-3840 \
  --storage-type=SSD \
  --storage-size=50 \
  --availability-type=zonal \
  --no-backup \
  --ssl-mode=ENCRYPTED_ONLY \
  --authorized-networks="${IP_PUBLICA}/32" \
  --root-password="$PASSWORD"

IP_INSTANCIA="$(gcloud sql instances describe "$NOMBRE" --project="$PROYECTO" --format='value(ipAddresses[0].ipAddress)')"
if [[ -z "$IP_INSTANCIA" ]]; then
  echo "ABORTADO: no se pudo leer la IP pública de la instancia recién creada." >&2
  exit 1
fi
echo "IP de la instancia: $IP_INSTANCIA"

echo "== 5/6: crear la base '$DB_NOMBRE' =="
gcloud sql databases create "$DB_NOMBRE" --instance="$NOMBRE" --project="$PROYECTO"

echo "== 6/6: habilitar postgis en '$DB_NOMBRE' =="
# psql real (libpq): sslmode=require SÍ tiene ahí su semántica estándar (cifra, no verifica
# CA) sin necesitar ningún parámetro extra — a diferencia del driver `pg` de Node que usan
# los scripts .mjs (ver la nota en lib/pg.mjs sobre `uselibpqcompat`).
PGPASSWORD="$PASSWORD" PGSSLMODE=require psql -h "$IP_INSTANCIA" -U postgres -d "$DB_NOMBRE" \
  -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
echo "postgis habilitado en '$DB_NOMBRE'."

# DATABASE_URL literal con `sslmode=require` (lo que pide el runbook: "SSL obligatorio").
# Hallazgo 10 de revisión (2026-09-22): este env file NO exporta un `DATABASE_URL` genérico
# — solo `QUIVO_CARGA_DATABASE_URL` (+ las `QUIVO_CARGA_TEMP_*`). Antes de este fix, un
# `source ~/.quivo-carga-temp.env` en la shell interactiva del CTO dejaba `DATABASE_URL`
# seteada ahí, y CUALQUIER otro comando de esa misma sesión que confiara en `DATABASE_URL`
# (p.ej. `pnpm --filter @quivo/db ...`, o abrir `apps/api` a mano) apuntaría en silencio a la
# instancia temporal `quivo-carga-temp` en vez de a lo que ese comando esperaba — sin ningún
# error, solo resultados contra la base equivocada. `migrar.sh` arma `DATABASE_URL` SOLO para
# el subproceso de `prisma`, a partir de `QUIVO_CARGA_DATABASE_URL` (ver ese script); los
# scripts .mjs ya leen `QUIVO_CARGA_DATABASE_URL` directo (`lib/pg.mjs`).
DATABASE_URL="postgresql://postgres:${PASSWORD}@${IP_INSTANCIA}:5432/${DB_NOMBRE}?sslmode=require"

umask 177
cat > "$ENV_FILE" <<EOF
# Generado por crear.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ) — instancia temporal $NOMBRE.
# NUNCA commitear este archivo (vive fuera del repo, en \$HOME, chmod 600).
# \`export\` (no solo asignación) a propósito: \`source\` este archivo debe dejar las vars en
# el entorno para que los \`node ...\`/\`./migrar.sh\` que se corren DESPUÉS, en la misma shell
# interactiva, las hereden — una asignación sin export quedaría solo como variable de shell.
# Deliberadamente NO se exporta un \`DATABASE_URL\` genérico acá (hallazgo 10 de revisión,
# 2026-09-22) — ver el comentario de arriba, en crear.sh.
export QUIVO_CARGA_TEMP_INSTANCIA=$NOMBRE
export QUIVO_CARGA_TEMP_PROYECTO=$PROYECTO
export QUIVO_CARGA_TEMP_REGION=$REGION
export QUIVO_CARGA_TEMP_IP=$IP_INSTANCIA
export QUIVO_CARGA_TEMP_DB=$DB_NOMBRE
export QUIVO_CARGA_TEMP_ROOT_PASSWORD=$PASSWORD
export QUIVO_CARGA_DATABASE_URL=$DATABASE_URL
EOF
chmod 600 "$ENV_FILE"

echo ""
echo "Listo. Credenciales guardadas en $ENV_FILE (chmod 600, fuera del repo)."
echo "Siguiente paso: source $ENV_FILE && ./migrar.sh"
