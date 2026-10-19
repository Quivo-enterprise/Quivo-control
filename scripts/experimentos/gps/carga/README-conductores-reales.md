# Carga con conductores reales (Fase 0, plan-escalabilidad-30)

Mide la pila completa (API -> Redis/BullMQ -> worker -> Cloud SQL) con la cadencia real de la
app: sync cada 3 s (1-3 puntos), vuelta-actual 20 s, vecinos-ruta 30 s, perfil 60 s,
ruta-a-punto 15 s, y pestañas del panel (posiciones 2 s, molinos 15 s, jornadas 30 s).
Prod no se toca (solo lecturas de describe). Todo lo creado termina en `-carga`.

Requisitos: `gcloud` autenticado en `quivo-control-prod`, `node` >= 22, `pnpm install` hecho
(el seed usa `pg` y `better-auth` del repo), `psql`.

## 1. Alta (CTO, ~10-15 min)

Infra NUEVA y vacía (no es clon de prod, sin datos reales). Cloud SQL con la misma versión,
tier y edición que `quivo-db` (leídas), disco 10 GB, IP privada en la VPC `default` más IP
pública autorizada solo a tu IP /32 con SSL obligatorio.

```bash
scripts/carga-efimera.sh alta                    # detecta tu IP; o: alta --mi-ip A.B.C.D
scripts/carga-efimera.sh estado
```

## 2. Migrar y sembrar

```bash
scripts/carga-efimera.sh migrar     # prisma migrate deploy desde tu laptop, rota quivo_app y relanza api/worker
eval "$(scripts/carga-efimera.sh url-seed)"     # exporta QUIVO_CARGA_DATABASE_URL y QUIVO_CARGA_TEMP_IP
cd scripts/experimentos/gps/carga
node seed-conductores-reales.mjs --conductores 60
# genera carga-tokens.local.json (0600, gitignored): tokens de 60 sesiones + admin del panel
```

`migrar` necesita `pnpm` y `psql`. El seed se niega si el host no es exactamente la IP
pública de `quivo-db-carga` según `gcloud` (o es privada), o si el sindicato `carga` ya existe
(re-hacer baja + alta).

## 3. Escalones (30 y luego 60, 30 min cada uno)

```bash
API="$(scripts/carga-efimera.sh url-api)"
node conductores-reales.mjs --base-url "$API" --conductores 30 --admins 3 --minutos 30 --salida resultados/real-30.json
node conductores-reales.mjs --base-url "$API" --conductores 60 --admins 3 --minutos 30 --salida resultados/real-60.json
```

Imprime una línea por minuto (requests, 429, 5xx, errores de red) y al final una tabla por
endpoint con n, p50/p95/p99 y histograma de estados. Entre escalones esperá que la cola
`waiting` vuelva a ~0.

Criterios en 60 (plan): p95 API < 500 ms, 0 5xx/429, `waiting` < 100 y estable, CPU Cloud SQL
< 60 %, conexiones < 70 % del máximo, Redis estable entre el minuto 10 y el 30.

## 4. Qué mirar durante la corrida

Cloud Monitoring (Metrics Explorer, proyecto `quivo-control-prod`, filtrar por la instancia
`quivo-db-carga` / `quivo-redis-carga`):

| Qué | Métrica |
|---|---|
| CPU Cloud SQL | `cloudsql.googleapis.com/database/cpu/utilization` |
| Conexiones | `cloudsql.googleapis.com/database/postgresql/num_backends` |
| Memoria Redis | `redis.googleapis.com/stats/memory/usage_ratio` (y `.../memory/usage`) |
| Conexiones Redis | `redis.googleapis.com/clients/connected` |
| Cloud Run | `run.googleapis.com/container/cpu/utilizations`, `request_latencies`, `instance_count` (servicio `quivo-api-carga`) |

`max_connections` (mismo tier que prod, debería dar el mismo valor):

```bash
eval "$(scripts/carga-efimera.sh url-seed)"
psql "$QUIVO_CARGA_DATABASE_URL" -c 'SHOW max_connections;' \
  -c "SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC;"
```

Profundidad de la cola BullMQ: `redis-cli` no llega desde afuera (IP privada); usar los logs
del worker (`quivo-worker-carga`) o el log de duración por job de la Fase 1.

## 5. Baja (SIEMPRE al terminar; se cobra por hora)

```bash
scripts/carga-efimera.sh baja          # pide y/N
scripts/carga-efimera.sh baja --si     # sin confirmación
scripts/carga-efimera.sh estado        # debe quedar vacío
rm scripts/experimentos/gps/carga/carga-tokens.local.json
```

## Limitaciones conocidas

- `ruta-a-punto` pega a OSRM: si OSRM no está desplegado en el entorno, mide el camino de
  fallback, no el ruteo real.
- La base es nueva y sintética: no reproduce el tamaño ni la distribución de datos de prod
  (tablas chicas, `gps_points` sin historia). Mide throughput/concurrencia, no el efecto de
  años de datos.
- El generador corre desde una sola IP/conexión de origen: mide la API, no el reparto de
  CGNAT de los teléfonos. Las pestañas admin comparten un token (login limitado a 5/min).
