# Plan — Experimento de puntos GPS + prueba de carga de la base (2026-09-21)

Rama: `exp/puntos-gps-carga`. Origen: el CTO preguntó si hace falta guardar ~6.000 puntos/trufi/día
y cómo bajar costos sin romper el producto. Decisión del CTO (2026-09-21): "arranca con el
experimento y la prueba de carga". Publicación de la escalera v2, página de finanzas y comentario
en ClickUp `86e34jkb2` quedan **congelados** hasta tener estos números.

## 1. Hipótesis a falsar

1. **H-tier:** la tabla `SQL_TIERS` de `scripts/costos/modelo-costos.mjs` sobredimensiona Cloud SQL
   sobre 600 trufis (duplica vCPU/RAM por cada duplicación de pts/s, sin medición). Si 1–4 vCPU
   sostienen 500–1000 pts/s con INSERT multi-fila, el costo a 2000 cae fuerte sin tocar el producto.
2. **H-simplificación:** simplificar la traza antes de persistir (Douglas-Peucker a 5–10 m, con
   puntos protegidos cerca de los puntos de control) reduce los puntos guardados de forma material
   **sin cambiar ningún cumplimiento de punto de control** ni la forma del replay.
3. **H-captura:** bajar la captura en el celular (distanceFilter 30/50/80 m) sí hace perder pasadas
   por puntos de control — confirma que la precisión se mantiene en captura y se recorta en
   persistencia.

## 2. Pasos

### A. Experimento de simplificación (datos reales, solo lectura)
1. Script de export (Sonnet) que corre dentro del Job `quivo-migraciones` vía `--args` override:
   solo `SELECT` + `set_config('app.rol','admin_quivo', false)`. Exporta la sesión real completa
   (la de ~6.000 puntos, 2026-09-09/10), sus `puntos_control` (lat/lng/radio) y sus
   `cumplimientos_pc`. Salida CSV por stdout (logs de Cloud Run).
2. **La ejecución contra prod la corre el chairman**, tras revisar el comando completo
   (riesgo: `--args` mal armado dispara `prisma migrate deploy`; ver plan-costos-2000 §10.1).
3. Script local de análisis (Sonnet): variantes DP 0/2/5/10/20 m con y sin zona protegida;
   submuestreo por distancia 30/50/80 m (simula captura); por tiempo 15/30/60 s. Métricas: % puntos
   guardados, desviación máxima y p95 vs traza cruda, km recorridos, pasadas por punto de control
   recalculadas (misma lógica de histéresis que `apps/mobile/src/gps/geofence.ts`) vs baseline y vs
   `cumplimientos_pc` guardados.

### B. Prueba de carga de la base (local, NO producción)
- **Por qué no prod:** k6 contra prod inserta puntos falsos en `gps_points` (tabla de evidencia,
  "nunca se borra evidencia", RNF-37) y probar tiers chicos exige redimensionar la base de prod.
- Postgres `postgis:16-3.4-alpine` en Docker con `--cpus` 1/2/4 y memoria 3.75/7.5/15 GB
  (≈ `db-custom-1-3840`, `-2-7680`, `-4-15360`), migraciones reales de `packages/db`, RLS activa.
- Generador Node que replica el INSERT multi-fila `ON CONFLICT DO NOTHING` del worker
  (`ingesta-worker.service.ts:305-345`) con `set_config` de tenant, a 150/300/500/1000/2000 pts/s,
  lotes de sync 15 s y 60 s, con lecturas concurrentes del mapa en vivo (SQL de
  `en-vivo.service.ts`) a ritmo de polling real.
- Métricas: throughput sostenido, p50/p95/p99 del INSERT, CPU, backlog; punto de quiebre por tier.
- **Límites a declarar:** disco local ≠ PD-SSD (IOPS/latencia), sin latencia de red VPC, sin
  bloat de meses. El resultado acota, no reemplaza, una confirmación en Cloud SQL real.
- Confirmación opcional en instancia Cloud SQL temporal (proyecto aparte): **requiere OK del CTO**
  (costo).

### C. Cierre
- Recalibrar `SQL_TIERS` y/o `puntosPorConductorDia` con los resultados (Sonnet), regenerar
  `docs/costos-gcp-2000.md`, luego actualizar escalera v2 + finanzas y recién ahí publicar/comentar.

## 3. Archivos críticos
- `scripts/experimentos/gps/` (nuevo): export, análisis, harness de carga, resultados.
- `scripts/costos/modelo-costos.mjs` (solo en paso C).
- Lectura: `apps/mobile/src/gps/geofence.ts`, `apps/mobile/src/gps/background-geolocation.config.ts`,
  `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts`,
  `apps/api/src/modules/reportes/en-vivo.service.ts`, `packages/db/prisma/migrations/`.

## 4. Trampas
- Script para `node -e` dentro del job: sin comillas simples, sin `$(`, sin `//`, sin `%%`.
- `FORCE ROW LEVEL SECURITY`: sin el `set_config` el export devuelve 0 filas.
- n=1: una sola jornada real. El experimento A mide reducción en ESA ruta; no generaliza sin piloto.
- No modificar `docs/costos-gcp-por-escala.md` (histórico).

## 5. Criterios de verificación
- A: el script de export no contiene statements mutantes (grep del chairman); ejecución exit 0;
  conteo exportado = conteo en `gps_points` para esa sesión.
- A: variante elegida con 0 pasadas perdidas vs baseline.
- B: cada corrida reporta throughput logrado vs objetivo; ningún tier "pasa" si pierde filas o
  el p95 del lote supera 1500 ms.

## 6. Estado
- 2026-09-21: plan escrito, rama creada. A y B en implementación (Sonnet).

## 7. Resultados paso A (2026-09-21, ejecución `quivo-migraciones-b57kk`, solo SELECT)

Sesión `982a4a79…` (2026-09-10, 8,7 h, 5.635 puntos, 110,65 km, 26 puntos de control, 132
cumplimientos). **Sanity check: pasadas recalculadas = `cumplimientos_pc` reales en los 26 PC (0
diferencias)** — la réplica de `geofence.ts` es fiel.

| Variante | % puntos | p95 desv. | Pasadas perdidas (de 132) | Pts/día | 600 actual/opt | 2000 actual/opt |
|---|---:|---:|---:|---:|---:|---:|
| crudo (15 m) | 100 | 0 | 0 | 6.000 | 1.402,83 / 929,76 | 2.926,66–5.135,35 / 1.945,74–3.602,25 |
| captura 30 m | 49,5 | 2,5 m | 0 | 2.972 | 811,16 / 493,35 | 1.686,59 † / 1.040,27 † |
| captura 50 m | 32,0 | 6,7 m | 1 | 1.920 | 521,26 / 277,61 | 1.639,39 / 1.013,73 |
| DP 2 m + zona protegida | 63,3 | 1,2 m | 0 | 3.799 | 821,14 / 498,14 | 2.828,28 / 1.890,40 |
| DP 20 m + zona protegida | 53,3 | 8,9 m | 0 | 3.196 | 813,24 / 493,69 | 2.800,79 / 1.874,97 |
| DP 5 m sin zona | 12,8 | 3,7 m | 28 | 774 | — | — |
| tiempo 60 s | 6,5 | 55,3 m | 36 | 390 | — | — |

† 2000 con captura 30 m = 245,2 pts/s, a 0,9% del borde 247,5 → rango hasta el tier siguiente.

Nota 2026-09-22: filas DP recalculadas tras corregir `douglasPeucker` (medía distancia a la recta infinita, no al segmento; hallazgo de Codex). Cambios ≤0,3 m y ≤1 pasada; DP+zona sigue en 0 pasadas perdidas. Las columnas de costo de esta tabla usan el dimensionamiento DESCARTADO (§9); las cifras vigentes están en `docs/costos-gcp-2000.md`.

Lectura: DP sin zona protegida pierde pasadas (descartado para evidencia). Zona protegida
(radio+50 m) retiene >50% porque 26 PC cubren gran parte de la ruta — probar zona mínima (solo
radio). Captura 30 m = −50% sin pasadas perdidas en esta sesión. A 2000 los ahorros de DP+zona
se diluyen porque caen igual en el tier grande: el tier table (paso B) domina.
Límites: n=1 sesión, 1 ruta, 1 dispositivo; submuestrear puntos a 15 m ≠ capturar a 30 m con el SDK.

## 8. Resultados paso B (2026-09-22, local, Docker, NVMe)

Detalle: `scripts/experimentos/gps/carga/resultados/resumen.md`. Corridas combinadas iniciales
(latencia cuantizada ~300 ms) en `resultados/invalidos/`.

**Escritura sola (INSERT multi-fila real del worker, RLS FORCE, 6,72 M filas precargadas, 0 filas perdidas):**

| Perfil | Pasa | Falla | CPU en el máximo que pasa |
|---|---|---|---:|
| 1 vCPU / 3,75 GB | 300, 500, 1.000 pts/s (p95 lote 10-11 ms) | 2.000 (87,9%, backlog creciente, CPU 99%) | 35-73% |
| 2 vCPU / 4 GB (capado por RAM del host) | 1.000, 2.000, 3.000 pts/s (p95 4-10 ms) | 5.000 marginal (99,999%) | 40-67% |

Con worker concurrencia 4, 2.000 pts/s pasa en 1 vCPU. **H-tier confirmada para escritura:** el
pico del modelo a 2000 trufis (495 pts/s) entra en 1 vCPU con margen; `SQL_TIERS` (que asigna
`db-custom-32-122880` a esa carga) está sobredimensionada ~30× en vCPU por escritura.

**Lectura — el dimensionador real es el mapa en vivo:** `EXPLAIN (ANALYZE, BUFFERS)` con 1.000
sesiones, sin contención: `listarHoy` (`en-vivo.service.ts:231-259`) 10,65 s y
`obtenerPosiciones` (`:316-354`) 10,49 s — `LEFT JOIN LATERAL` con `loops=1000` (N+1 en el
plan) y ventanas `count(*) OVER()` que escanean todo el rango. `obtenerTraza` 0,16 s.
`listarHoy` lo consume la web cada 30 s por pestaña (`apps/web/src/lib/en-vivo/use-en-vivo.ts:34`);
el `obtenerPosiciones` de flota no tiene consumidor hoy. Con 1 vCPU, 20 monitores saturan la CPU.

**Worker:** `ingesta-worker.service.ts:62-66` sin `concurrency` ⇒ 1 (default BullMQ).
Techo ~1.700 pts/s en 1 vCPU; subir concurrencia es más barato que subir tier.

**Límites:** NVMe local ≠ PD-SSD; sin red VPC; 7 días precargados (no 6 meses); c4/c8 no
corridos (RAM del host 13 GiB); 1 pt/s por trufi asumido en el generador.

**Implicancias (chairman):**
1. El costo a 2000 NO lo manda la ingesta. Recalibrar `SQL_TIERS` por lectura + RAM de working set,
   no por pts/s de escritura (paso C).
2. Arreglar `listarHoy`/`obtenerPosiciones` (N+1) es prerequisito de escala, independiente del costo.
3. Confirmar en una instancia Cloud SQL real temporal antes de fijar cifras para finanzas (OK del CTO).

## 9. Paso C — especificación de recalibración (chairman, 2026-09-22)

**Regla dura:** `SQL_TIERS` y el test de regresión contra agosto NO se tocan (reproducen el
documento de agosto). Se agrega un dimensionamiento nuevo, `SQL_TIERS_MEDIDOS`, usado SOLO por la
proyección con `SUPUESTOS_MEDIDOS`.

1. **Escritura (medido):** techo de diseño = 50% de lo medido que pasa. 1 vCPU → 500 pts/s,
   2 vCPU → 1.500 pts/s, 4 vCPU → 3.000 pts/s (este último extrapolado, marcado).
2. **Memoria (working set):** medir bytes de índice por fila de `gps_points`
   (`pg_indexes_size` / filas) en el Postgres local con las migraciones reales y ≥1 M filas. Regla:
   el tier debe tener RAM ≥ 4 × (índices de 2 días de la flota) — las lecturas en vivo tocan hoy/24 h;
   ×4 porque Cloud SQL dedica ~1/3 de la RAM a shared_buffers y hay que dejar margen.
3. **Piso de producción:** `db-custom-2-7680` desde 100 trufis efectivos (lecturas del mapa en vivo +
   autovacuum + margen); por debajo, la tabla de agosto.
4. Tier elegido = el mayor de (1), (2), (3). Tabla explícita en el código con cita a este §.
5. **Prerequisito declarado:** las cifras asumen corregido el N+1 de `listarHoy`/`obtenerPosiciones`.
   Sin ese fix, ningún tier resuelve el problema (es una query single-thread de ~10 s a 1.000 sesiones).
6. **Escenario de captura 30 m:** nuevo juego `SUPUESTOS_MEDIDOS_30M` = medidos con
   `puntosPorConductorDia: 2972` (§7, 0 pasadas perdidas).
7. Regenerar `docs/costos-gcp-2000.md` con: escalera medida (15 m) y 30 m, ambas arquitecturas,
   escenarios A/B/C; sección nueva "Capacidad medida" con §8; límites (local ≠ Cloud SQL).
   Mantener el viejo dimensionamiento solo como referencia histórica con su cifra, marcado "descartado".

## 10. Paso B' — confirmación en Cloud SQL real (aprobado por el CTO 2026-09-22)

- Instancia **temporal** `quivo-carga-temp` en `quivo-control-prod` (misma región
  `southamerica-west1`, sin relación con la base de producción): POSTGRES_16, ENTERPRISE, PD-SSD
  50 GB, zonal, sin backups, IP pública **restringida a la IP /32 del CTO**, SSL obligatorio,
  contraseña aleatoria fuera del repo. Perfiles: `db-custom-1-3840` y luego `db-custom-2-7680`
  (patch de tier). **Se borra al terminar** (`gcloud sql instances delete`), verificado con `list`.
- Precarga server-side (`INSERT ... SELECT generate_series`), no por red.
- Generador local contra la instancia: la latencia Bolivia→Santiago limita cada lote; compensar con
  concurrencia 8-16 y medir **CPU de la instancia en Cloud Monitoring**
  (`cloudsql.googleapis.com/database/cpu/utilization`) como métrica principal, junto con throughput.
- Lecturas: `EXPLAIN (ANALYZE, BUFFERS)` de `listarHoy`/`obtenerPosiciones` sobre PD-SSD con 1.000
  sesiones (confirmar el N+1 fuera del NVMe local).
- Los comandos `gcloud` los ejecuta el CTO (el clasificador de permisos bloquea operaciones sobre
  el proyecto de producción desde el agente). Runbook en `scripts/experimentos/gps/carga/cloudsql/`.

**Estado: HECHO (2026-09-22).** Corrida completa contra `quivo-carga-temp`
(`db-custom-1-3840`, POSTGRES_16 ENTERPRISE, `southamerica-west1-b`, PD-SSD 50GB): 33
migraciones, 1.000 sesiones sembradas, 6,72M filas precargadas (142s). RTT Bolivia→región
`SELECT 1` p50 36,97ms; latencia de lote p50 ~187-190ms (plana, todo rate). Matriz: conc8
300/500 PASA, 1000/2000 FALLA (limitado por RTT/concurrencia del cliente, ~634 pts/s); conc16
@2000 también FALLA (1.259,8 pts/s, mismo motivo); **conc40: 1000 y 2000 pts/s PASAN al 100%,
backlog máx. 13, 0 filas perdidas.** CPU real de la instancia (Cloud Monitoring, corrida del
CTO): en el punto que pasa a 2000 pts/s, CPU 31-50% (máx. 49,6%), memoria 58-65%. Lecturas
(`listarHoy`/`obtenerPosiciones`, EXPLAIN + standalone) confirmadas sin N+1 sobre PD-SSD.
Instancia temporal borrada al cerrar (verificado: solo queda `quivo-db` de producción).
Detalle completo: `scripts/experimentos/gps/carga/resultados/resumen.md` §9 (matriz §9.3,
lecturas §9.4, CPU/memoria y conclusión §9.6). `remoto-c2` (2 vCPU) no se corrió a propósito
(§9.6 del resumen: 1 vCPU ya sostiene el pico con margen; el tier lo decide RAM/piso, no
escritura) — las cifras de `docs/costos-gcp-2000.md` no cambian.
