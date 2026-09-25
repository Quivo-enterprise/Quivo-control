# Plan — Resumen por sesión para el mapa en vivo (N+1 de `listarHoy`/`obtenerPosiciones`)

Rama: `perf/en-vivo-resumen-sesion` (worktree `../Quivo-control-envivo`). Aprobado por el CTO
2026-09-22 ("adelante, acepto ambos"). Origen: `docs/plan-experimento-puntos-gps.md` §8 (rama
`exp/puntos-gps-carga`).

## 1. Problema (medido)

`EXPLAIN (ANALYZE, BUFFERS)` con 1.000 sesiones y ~6,7 M filas en `gps_points`, Postgres local sin
contención: `listarHoy` (`apps/api/src/modules/reportes/en-vivo.service.ts:231-259`) **10,65 s**,
`obtenerPosiciones` (`:316-354`) **10,49 s**. `listarHoy` lo pollea la web cada 30 s por pestaña
(`apps/web/src/lib/en-vivo/use-en-vivo.ts:34`). Con 20 monitores, 1 vCPU al 100%.

**Causa raíz:** el `LEFT JOIN LATERAL` por sesión calcula `count(*)` y `max(received_at)` (y en
posiciones `count(*) OVER ()`) sobre TODOS los puntos de la jornada de cada sesión → O(puntos del
día de la flota) por request. Además el `ORDER BY fix."ultimoFixTs"` + `LIMIT` obliga a evaluar el
lateral para todas las sesiones candidatas antes de cortar. `received_at` no está indexado.

## 2. Diseño

Tabla nueva `gps_sesion_resumen`, una fila por **(sesion_id, jornada)**, mantenida por el worker de
ingesta **en la misma sentencia** que inserta los puntos:

| Columna | Tipo | Semántica |
|---|---|---|
| sesion_id | uuid | PK compuesta |
| jornada | date | jornada boliviana del `ts` (UTC−4 fijo, misma regla que `apps/api/src/common/tiempo/jornada.ts:13-16`) — PK compuesta |
| "sindicatoId" | text NOT NULL FK | tenant |
| total_puntos | int | puntos **efectivamente insertados** (no duplicados) en esa jornada |
| ultimo_fix_ts | timestamptz | max(ts) |
| ultimo_ingreso_ts | timestamptz | max(received_at) |
| lat, lng, accuracy, speed | double | del punto con mayor `ts` |
| updated_at | timestamptz | |

- **Escritura** (`insertarGpsPoints`, `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts:305-345`):
  un solo statement `WITH ins AS (INSERT INTO gps_points ... ON CONFLICT (event_id, ts) DO NOTHING
  RETURNING ...) INSERT INTO gps_sesion_resumen SELECT ... GROUP BY sesion_id, jornada ON CONFLICT
  (sesion_id, jornada) DO UPDATE SET total_puntos = total + EXCLUDED, ultimo_ingreso_ts = GREATEST,
  y lat/lng/accuracy/speed/ultimo_fix_ts solo si EXCLUDED.ultimo_fix_ts > actual`. Así: los
  reenvíos idempotentes (RF-72) no inflan el total; los puntos tardíos del outbox (ts viejo) no
  pisan la última posición; atómico con el INSERT de evidencia.
- **Lectura:** `listarHoy` lee la fila `(sesion_id, jornada = hoy)`; `obtenerPosiciones` la fila más
  reciente con `ultimo_fix_ts >= posicionesDesde` entre hoy y ayer. Ambas O(sesiones).
- **RLS:** `ENABLE` + `FORCE ROW LEVEL SECURITY` con la misma policy `tenant_isolation` que
  `gps_points` (`packages/db/prisma/migrations/20260815120000_gps_points_sindicato_rls`), incluido
  el bypass explícito `app.rol = admin_quivo`. No particionada (es chica: filas = sesiones × días).
- **Migración:** crear tabla + policy + backfill desde `gps_points` existente (una agregación).
- **Retención:** el archivado de particiones (`retencion-gps.service.ts`) NO borra filas de resumen
  (evidencia, RNF-37). Anotarlo en el runbook.

## 3. Cambio de semántica (explícito)

- `listarHoy.totalPuntos`: idéntico (puntos de la jornada de hoy).
- `obtenerPosiciones.totalPuntos` pasa de "puntos en ventana rodante 24 h" a "puntos de la jornada
  del último fix". Hoy no tiene consumidor en `apps/web` (grep). Documentarlo en el JSDoc.

## 4. Verificación

1. Test de equivalencia (integración, Postgres real del CI): sembrar sesiones con duplicados
   reenviados, puntos tardíos, sesión que cruza la medianoche boliviana (03:59/04:00 UTC), sesión
   abierta de ayer; comparar salida vieja vs nueva de ambos endpoints campo por campo.
2. Test de RLS: un sindicato no ve filas de resumen de otro; admin_quivo sí.
3. Tests existentes de en-vivo, ingesta y recorridos en verde.
4. `EXPLAIN (ANALYZE)` antes/después con el harness de `scripts/experimentos/gps/carga/`
   (1.000 sesiones): objetivo < 50 ms cada endpoint.
5. Revisión: `/code-review` + `/security-review` (tabla nueva con RLS, SQL crudo) +
   `/codex-debug verify-fix`.

## 5. Trampas

- Jornada en SQL debe coincidir bit a bit con `fechaActualBolivia`; test de borde 04:00 UTC.
- `RETURNING` de un INSERT con `ON CONFLICT DO NOTHING` solo devuelve filas insertadas — es lo que
  queremos para el total.
- Partición inexistente para el `ts` → el INSERT ya falla hoy igual; no cambiar ese comportamiento.
- No usar Redis: la tabla queda en la misma transacción que la evidencia y hereda RLS.
