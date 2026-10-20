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

## 3b. Ensayo del día D (30 conductores reales, login real)

Receta completa (el CTO corre lo de GCP):

```bash
scripts/carga-efimera.sh alta --api-min-instances 3        # 3 instancias de API (default: las de prod)
scripts/carga-efimera.sh migrar
eval "$(scripts/carga-efimera.sh url-seed)"
cd scripts/experimentos/gps/carga
node seed-conductores-reales.mjs --conductores 30         # tokens, placa y PIN en carga-tokens.local.json (0600)
API="$(../../../carga-efimera.sh url-api)"
# 0) misma placa, con la API en EXACTAMENTE 1 instancia (el throttle del login es en memoria por instancia:
#    con varias, los 6 intentos se reparten y el 6.º no da 429). Después de los 6 intentos hace un login con el
#    PIN bueno (≥ 61 s tras el 6.º: el throttler bloquea 60 s desde ese intento) que resetea los fallos.
#    Si el reseteo falla: login manual con el PIN correcto de 9999MSM (en carga-tokens.local.json) pasados
#    > 60 s del último intento, o baja + alta completa (el seed no re-ejecuta y `fallos` no decae solo).
../../../carga-efimera.sh api-instancias 1
node conductores-reales.mjs --base-url "$API" --conductores 1 --admins 0 --minutos 1 --probar-misma-placa
../../../carga-efimera.sh api-instancias 3   # fija min=max=3 a propósito: peor caso de conexiones Cloud SQL
                                             # (criterio < 35 con 3 instancias); no restaura el autoscaling de prod
# 1) 30 con login real (ráfaga de 60 s desde esta IP = CGNAT) + escenario offline (min 10 a 15)
node conductores-reales.mjs --base-url "$API" --conductores 30 --admins 3 --minutos 30 \
  --login-real --offline-desde 10 --offline-minutos 5 --salida resultados/ensayo-30.json
# 2) en otra terminal, a mitad de la corrida (p.ej. minuto 20): pausar el worker 3-5 min y reanudarlo
../../../carga-efimera.sh worker-pausa ; sleep 240 ; ../../../carga-efimera.sh worker-reanuda
# 3) al terminar: enviados vs ingeridos (espera a que el conteo deje de cambiar)
node verificar-ingesta.mjs --resultado resultados/ensayo-30.json
# 4) repetir con 60 (baja + alta + seed --conductores 60), y por último: baja
```

`verificar-ingesta.mjs` lee `gps_points` por `sesion_id` con la URL de `url-seed` (solo lectura);
no hay endpoint admin con conteos exactos por sesión, así que no se agregó ninguno.
Con `--login-real`, un 429 en cualquiera de los N logins (`POST /v1/mobile/auth/sesion`) es una
línea `FAIL` y exit 1. La placa `9999MSM` queda reservada para `--probar-misma-placa` (5x401 y el
6.º 429 del throttle, sin `retryAfterSeconds`; si ya hay fallos de una corrida anterior sin reseteo
imprime `lockoutPrevio`; arreglo: login manual con el PIN correcto de 9999MSM pasados > 60 s del último
intento, o baja + alta; ni re-seed ni esperar sirven). Si se combina con `--login-real` arranca ≥ 61 s después
del último login (comparte el cubo `ip` de 60/min con los N). Un 401 durante la corrida rota con
`/mobile/auth/refresh` (el access dura ~15 min; single-flight por conductor; si el refresh falla la
sesión se da por muerta, cuenta como error y la corrida sale con exit 1; el refresh responde 201 y solo un 401
suyo mata la sesión: red, timeout, 5xx y 429 se reintentan en el próximo 401). Los puntos que sigan en la cola
al final (`pendientes`) son FAIL y exit 1, y `verificar-ingesta` los cuenta como perdidos.

Criterios de aprobación:

- 0 logins 429 entre los 30.
- Misma placa (con la API en 1 instancia): el 6.º intento es 429 (throttle, no lockout).
- p95 de la API < 500 ms.
- Conexiones Cloud SQL (`num_backends`) < 35 con 3 instancias de API.
- 0 puntos perdidos tras pausar el worker (`verificar-ingesta` PASS).
- Redis plano (memoria y clientes sin crecimiento sostenido).
- Cola `waiting` vuelve a 0 tras el volcado offline y tras `worker-reanuda`.

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
