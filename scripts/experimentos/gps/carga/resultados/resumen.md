# Resumen — prueba de carga GPS local (paso B, docs/plan-experimento-puntos-gps.md)

2026-09-21/22. Todo LOCAL con Docker (`postgis/postgis:16-3.4-alpine`, contenedor
`quivo-carga-pg`, volumen `quivo-carga-pgdata`, red `quivo-carga-net`, puerto
`127.0.0.1:55432` — nunca se tocó `quivo-control-postgres-1`/`quivo-pg` ni producción/GCP).

## 0. Hardware del host (declarar límites)

- `nproc` = 16 cores.
- `free -h`: **13GiB de RAM total** (no físicos "de verdad" verificables desde acá — probable
  VM/entorno con memoria acotada), de los cuales solo **~5GiB estaban disponibles** en el
  momento de correr (compartidos con `quivo-pg`, `quivo-redis`, el stack de Supabase local y
  otros contenedores del proyecto que NO se tocaron).
- Disco: `/dev/nvme0n1p4` sobre NVMe local (`WD PC SN740`, SSD), 296G, 119G libres al
  terminar. **No es PD-SSD de Cloud SQL**: sin la latencia de red VPC, sin el modelo de IOPS
  provisionadas de GCP.
- **Consecuencia dura en la matriz:** los perfiles `c4` (4cpu/15GB) y `c8` (8cpu/30GB)
  **NO son físicamente posibles en este host** — 15GB y 30GB superan la RAM total de la
  máquina (13GiB). Solo se corrieron `c1` (1cpu/3.75GB, nominal real) y `c2` (2cpu, memoria
  **forzada a 4GB** en vez del nominal 7.5GB por falta de RAM disponible — ver
  `QUIVO_CARGA_MEM=4096m` en `levantar.sh`). Esto es una desviación declarada, no un default
  silencioso.

## 1. Corrección de metodología a mitad de camino (hallazgos de revisión — IMPORTANTE)

La primera corrida de la matriz combinada (escritura + K=20 lecturas, perfil c1, objetivos
300/500/1000) dio latencias de lote **cuantizadas en múltiplos de ~100-300ms** (p50≈300ms,
p95≈598ms, p99≈698-700ms) y un techo de throughput **idéntico (~42-47 pts/s) sin importar el
objetivo** (300 vs 500 vs 1000). Se investigó si era un bug del harness (`generador.mjs`)
antes de confiar en el número. Esos 3 resultados quedaron en `resultados/invalidos/`
(no se borraron, para que quede la evidencia).

**Causa raíz encontrada (no era un sleep fijo en el código):**

1. Corrida de control: `generador.mjs` **solo escritura** (sin `lecturas.mjs`), mismo
   objetivo=300, mismo código exacto → `p50=6.6ms`, `sostenido=true`, `throughput=100%`.
   Sin quantización. Esto descarta un `setTimeout`/poll fijo en el camino de escritura.
2. Corrida de control: el mismo `generador.mjs` **con** `lecturas.mjs` (K=20) corriendo en
   paralelo, mismo objetivo=300, 60s → la cuantización **reaparece** (`p50=399.9ms`,
   `p95=602.6ms`), `cpuPromedioPct=101.6`, `cpuMaxPct=110.9` (el único vCPU de `c1` saturado).
   Ver `resultados/diag-c1-con-lecturas-60s.json`.
3. `EXPLAIN (ANALYZE, BUFFERS)` de las 3 queries de `en-vivo.service.ts` contra el volumen
   precargado (6.7M+ filas históricas, 1000 sesiones) SIN ninguna contención:
   - `listarHoy` (`apps/api/src/modules/reportes/en-vivo.service.ts:231-259`): **10.65s**.
     El plan hace un `LEFT JOIN LATERAL` que se ejecuta **1000 veces** (`loops=1000`, una vez
     por sesión operativa visible) contra `gps_points`, sumando ~408.000 buffer hits. Es un
     patrón N+1 a nivel de plan de ejecución, no una query mal indexada — el índice
     `gps_points_sesion_id_ts_idx`/`sindicato_id_ts_idx` SÍ se usa, pero el costo escala
     linealmente con el número de sesiones visibles, no es O(1).
   - `obtenerPosiciones` (`en-vivo.service.ts:316-354`): **10.49s**, mismo patrón
     (`loops=1000`). Además: usa `count(*) OVER ()` / `max(received_at) OVER ()` dentro del
     LATERAL con `ORDER BY ts DESC LIMIT 1` — la ventana fuerza escanear **todas** las filas
     del rango por sesión (hasta ~1920/día) para calcular el agregado, en vez de poder cortar
     en el primer resultado del índice. Es un segundo motivo de costo, específico de esta
     query, independiente del N+1 de arriba.
   - `obtenerTraza` (`en-vivo.service.ts:445-491`, una sola sesión, no hay N+1): **159.6ms**.
     Barata — el costo está concentrado en las otras dos.

**Conclusión sobre el hallazgo 1 pedido:** NO es un bug del harness. `esperarJob()`/la cola
en memoria no tienen ningún sleep fijo (revisado línea por línea, confirmado por la corrida
de control #1). Es contención de CPU real: con K=20 monitores pollenado dos queries que
tardan >10s cada una **por sesión visible** (1000 sesiones sembradas), en un contenedor de
**1 solo vCPU**, el único core queda saturado (100-111%) y el conector de escritura (que sin
contención tarda 6.6ms) queda esperando turno de CPU detrás de esas queries — de ahí la
cuantización en ventanas de ~100-300ms (consistente con el período de CFS del cgroup de
Docker, `--cpus=1` ⇒ `cfs_period_us=100000`). **Esto es en sí mismo un hallazgo del
experimento, no un artefacto a esconder:** al día de hoy, si `apps/web` alguna vez empieza a
consumir `GET /reportes/en-vivo/posiciones` (ver §3) o si un sindicato con ~1000 sesiones
activas abre 20 pestañas del mapa en vivo, esas dos queries por sí solas saturan un Postgres
de 1 vCPU sin que ningún GPS worker esté corriendo.

**Decisión de metodología (post-hallazgo):** se separó la medición en dos fases, como pidió
la revisión:
- **Fase A (esta matriz): capacidad de INSERT pura** (`K=0`, sin lecturas) — responde
  directamente a la pregunta original del experimento (H-tier: ¿cuánto sostiene Postgres el
  patrón de escritura del worker?).
- **Fase B (diagnóstico aparte, no matriz):** costo de las 3 queries de lectura documentado
  por separado con `EXPLAIN ANALYZE` + una corrida corta combinada — como hallazgo de
  producto, no mezclado en el número de throughput de escritura.

## 2. Concurrencia real del worker (verificada en código)

`apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts:62-66`:
```ts
this.ingestaWorker = new Worker<LoteIngestaJob>(
  COLA_INGESTA_SYNC,
  async (job: Job<LoteIngestaJob>) => this.procesarLote(job),
  { connection: this.connection },
);
```
Sin opción `concurrency` ⇒ **default de BullMQ = 1** (un lote a la vez, serializado).
Producción además corre `quivo-worker` como Worker Pool de **1 sola instancia fija**
(`docs/costos-gcp-por-escala.md:40`, `scalingMode: manual`). Por fidelidad, el default de
`generador.mjs` es `concurrencia=1`.

**Diagnóstico de dimensionamiento pedido:** el mismo `objetivo=2000` que **falla** en `c1`
con `concurrencia=1` (88% del throughput, backlog creciente — ver §3) **pasa limpio** con
`concurrencia=4` en el MISMO contenedor `c1` (100% throughput, p95=4.6ms, backlog=0 —
`resultados/diag-c1-obj2000-concurrencia4.json`). **Esto es un hallazgo importante para
`docs/costos-gcp-2000.md` (paso C, fuera de este alcance):** en el punto de quiebre de `c1`,
el cuello no es capacidad de Postgres — es la serialización de BullMQ concurrency=1. Subir la
concurrencia del worker (o correr más instancias del Worker Pool) es una palanca de costo
mucho más barata que subir el tier de Cloud SQL, **si** el patrón de escritura lo permite
(un lote por dispositivo es independiente de los demás, no hay dependencia de orden entre
lotes de dispositivos distintos — subir concurrencia no debería romper nada funcional, pero
no se verificó acá porque es cambio de código de producción, fuera del alcance de "solo
medir").

## 3. Matriz — capacidad de INSERT pura (K=0), sync=15s, 5 min medición + 60s calentamiento

| Perfil | Objetivo pts/s | Resultado | Throughput logrado | % objetivo | p50 lote | p95 lote | p99 lote | CPU prom | CPU max | Backlog al cierre |
|---|---|---|---|---|---|---|---|---|---|---|
| c1 (1cpu/3.75GB) | 300  | **PASA** | 300.0 | 100.0% | 9.2ms | 11.1ms | 12.6ms | 11.3% | 43.4% | 0 |
| c1 (1cpu/3.75GB) | 500  | **PASA** | 500.0 | 100.0% | 8.9ms | 10.6ms | 11.7ms | 18.5% | 66.4% | 0 |
| c1 (1cpu/3.75GB) | 1000 | **PASA** | 1000.0 | 100.0% | 8.6ms | 10.0ms | 10.8ms | 35.3% | 73.1% | 0 |
| c1 (1cpu/3.75GB) | 2000 | **FALLA** | 1757.9 | 87.9% | 8.5ms | 9.7ms | 10.4ms | 63.3% | 99.0% | 5754 lotes sin drenar |
| c2 (2cpu/**4GB**, capado) | 1000 | **PASA** | 1000.0 | 100.0% | 8.5ms | 9.9ms | 10.5ms | 34.6% | 54.5% | 0 |
| c2 (2cpu/**4GB**, capado) | 2000 | **PASA** | 2000.0 | 100.0% | 3.1ms | 4.2ms | 5.0ms | 29.7% | 66.6% | 0 |
| c2 (2cpu/**4GB**, capado) | 3000 | **PASA** | 3000.0 | 100.0% | 2.5ms | 3.8ms | 4.3ms | 34.1% | 39.9% | 0 |
| c2 (2cpu/**4GB**, capado, 3min) | 5000 | **FALLA*** | 5000.0 | 100.0% | 2.3ms | 3.0ms | 3.6ms | 49.8% | 67.2% | 4 lotes (marginal) |

\* El punto de 5000 pts/s en `c2` es un **fallo marginal por criterio estricto**: throughput
logrado 99.999% del objetivo, p95=3.0ms (excelente), pero cierra con 4 lotes sin drenar (de
varios miles enviados) — el criterio automático de "backlog al cierre > 0 ⇒ FALLA" lo marca
así, pero no es un backlog CRECIENTE como el de `c1@2000` (5754 lotes, throughput real 88%).
Con más margen de tiempo se recomienda repetir este punto con duración completa de 5 min para
confirmar si 5000 pts/s es un PASA real en `c2` — quedó solo como sondeo de 3 min por límite
de tiempo de esta sesión.

**Criterio de falla aplicado (igual en todos los puntos):** throughput < 95% del objetivo, O
p95 del lote > 1500ms, O filas perdidas > 0, O el backlog no drena al cierre de la ventana
medida (criterio agregado en esta sesión, más estricto que "≥95% throughput" solo — un
backlog que crece durante la ventana medida significa que la tasa NO se sostiene aunque el
throughput instantáneo todavía luzca cerca del objetivo).

**0 filas perdidas en todos los puntos** (`ON CONFLICT DO NOTHING` nunca descartó nada real —
`event_id` es `randomUUID()` por fila, sin colisiones).

## 4. Lectura del mapa en vivo — costo real (diagnóstico separado, NO forma parte del PASA/FALLA de escritura de arriba)

Con el volumen precargado (1000 sesiones activas, partición de "hoy" con datos reales de las
corridas de escritura) y **sin ninguna otra carga**:

| Query | Archivo:línea | Tiempo (EXPLAIN ANALYZE, sin contención) | Motivo del costo |
|---|---|---|---|
| `listarHoy` | `en-vivo.service.ts:231-259` | **10.65s** | `LEFT JOIN LATERAL` ejecutado 1000 veces (una por sesión visible) |
| `obtenerPosiciones` | `en-vivo.service.ts:316-354` | **10.49s** | mismo patrón N+1 de plan + `count(*) OVER()`/`max() OVER()` que fuerza escanear todo el rango por sesión pese al `LIMIT 1` |
| `obtenerTraza` | `en-vivo.service.ts:445-491` | **0.16s** | una sola sesión, sin N+1 — barata |

Con K=20 monitores pollenado estas 3 queries en `c1` (1 vCPU), 60s medidos:
`resultados/diag-c1-con-lecturas-60s.json` — `listarHoy` p50=38.4s / p95=67.9s,
`obtenerPosiciones` p50=61.7s / p95=63.2s, `obtenerTraza` p50=42.5s / p95=68.5s (la traza
también se degrada por contención de CPU, aunque su propio costo aislado es bajo). CPU del
contenedor: 101-111% (saturado).

**Intervalos de polling usados** (ver comentarios de `lecturas.mjs`, con cita de archivo):
- `listarHoy`: 30.000ms — confirmado en `apps/web/src/lib/en-vivo/use-en-vivo.ts:34`
  (`useSesionesEnVivo`, `refetchInterval: 30_000`).
- `obtenerTraza`: 10.000ms — confirmado en `apps/web/src/lib/en-vivo/traza.ts:27`
  (`INTERVALO_POLL_MS`), usado por `useTrazaEnVivo` (`use-en-vivo.ts:84`,
  `refetchInterval: (query) => intervaloPoll(...)`; el modo rápido de 1s de
  `traza.ts:30`/`234` no se simuló — es un régimen de ráfaga corta, no el estado estable).
- `obtenerPosiciones`: **NO tiene ningún hook/call-site en `apps/web` hoy** —
  `grep -rn "obtenerPosiciones" apps/` solo encuentra el service y el controller
  (`en-vivo.controller.ts:48-50`, `GET /reportes/en-vivo/posiciones`), ningún consumidor real
  del lado web. Se poll-eó igual (a 10.000ms, mismo ritmo que la traza) porque el harness lo
  pedía explícito — es una **asunción declarada, no un intervalo confirmado**.

**Esto es un hallazgo de producto, no del harness:** si algún día `apps/web` conecta
`obtenerPosiciones` a un mapa con pines de flota completa (el propósito obvio del endpoint,
hoy sin usar), o si un sindicato con cientos de sesiones abre varias pestañas del mapa en
vivo, estas dos queries N+1-por-sesión son un riesgo real de saturar CPU en un Postgres chico
— independiente de cuánto GPS se esté ingiriendo al mismo tiempo. Recomendación (no aplicada
acá, es cambio de código de producto): reescribir `listarHoy`/`obtenerPosiciones` para que el
`LATERAL` deje de ejecutarse por fila (p. ej. con un `DISTINCT ON` + índice
`(sesion_id, ts DESC)` resuelto en una sola pasada, o agregando en el lado de
`gps_points`/`sesiones_operativas` con una sola query set-based en vez de N subqueries).

## 5. Qué se replicó fielmente y qué no

**Fiel:**
- Imagen exacta (`postgis/postgis:16-3.4-alpine`, `docker-compose.yml:3`).
- Migraciones reales de `packages/db` vía `prisma migrate deploy` contra el contenedor local
  (33 migraciones, particiones diarias, `FORCE ROW LEVEL SECURITY`, rol `quivo_app` real).
- El INSERT multi-fila `ON CONFLICT (event_id, ts) DO NOTHING` de
  `insertarGpsPoints` (`ingesta-worker.service.ts:305-345`), columna por columna, mismo orden.
- `withTenantContext` (`packages/db/src/tenant-context.ts:20-28`): `SELECT set_config(...)`
  con `is_local=true`, rol `admin_quivo`, `sindicatoId` del lote — nunca del payload.
- Rol de conexión: `quivo_app` (no el rol admin/dueño de tablas) — RLS FORCE se evalúa de
  verdad, verificado (`SELECT count(*) FROM sesiones_operativas` sin `set_config` da 0 filas).
- Concurrencia BullMQ=1 (verificada en código, `ingesta-worker.service.ts:62-66`).
- Las 3 queries de `en-vivo.service.ts` textualmente iguales (columnas, joins, `LATERAL`).
- `LOTE_MAXIMO=500` del outbox móvil (`sync-outbox.ts:16`) — a 1pt/s y sync≤60s nunca se
  alcanza (máx. 60 filas/lote), no hizo falta partir lotes.

**NO fiel (desviaciones declaradas):**
- **Tasa por trufi = 1 pt/s** (asunción propia, no medida contra datos reales — el
  experimento A de simplificación, que sí usa una sesión real de ~6000 puntos/día, es el que
  puede validar o corregir este número).
- El número de "trufis simulados" (M) se hizo **igual al objetivo pts/s** (M=objetivo), no un
  número de flota fijo — cuando M supera las 1000 sesiones sembradas, se reusan sesiones en
  round-robin (2+ "trufis" lógicos comparten `sesion_id`/`device_id` real).
- **Precarga histórica:** 500 sesiones × 7 días × 1920 pts/sesión/día (~8h operativas a
  1pt/15s) = 6.720.000 filas, insertadas en 430s (~15.600 filas/s) **con el rol admin**
  (bypassa RLS) e INSERT multi-fila grande — no reproduce el INSERT del worker, solo genera
  volumen realista para que los índices no estén vacíos. Se declara **7 días, no 30**, por
  límite de tiempo de esta sesión (instrucción explícita: "si es muy grande, al menos 7 días
  y declarar el límite").
- El mismo volumen precargado (una sola vez) se **reusó entre `c1` y `c2`** en vez de
  re-precargar por perfil (ahorra ~7min por perfil, a costa de que la partición de "hoy"
  termina acumulando datos de varias corridas de matriz encima de la precarga — infla algo el
  tamaño de la partición del día actual respecto a un día real, lo cual si acaso hace las
  queries de lectura *más* caras, no menos — sesgo conservador).
- Perfiles `c4`/`c8` no corridos — RAM del host insuficiente (§0).
- `c2` corrido con memoria capada a 4GB en vez del nominal 7.5GB (RAM del host insuficiente).
- El punto `c2@5000` corrió 3 min en vez de 5 (sondeo exploratorio fuera de la matriz pedida).
- La carga de lectura concurrente (K=20) se documentó por separado (§4), no como parte del
  PASA/FALLA de la matriz de escritura — ver §1 para el porqué.

## 7. Re-medición con el harness corregido (v2, 2026-09-22 mañana) — cierra la pregunta abierta de `c1@2000`

Tras la revisión de código de esa misma mañana (hallazgos 1-12, ver comentarios fechados
`2026-09-22` en `generador.mjs`/`correr-punto.mjs`/`levantar.sh`), se corrió de nuevo la
matriz completa (`v2-perfil-*`) y, para saldar la duda sobre `c1@2000` (única fila que pasó
de **FALLA** con el harness viejo a **PASA** con el corregido), se repitió ese punto una
tercera vez (`v2-rep-perfil-c1_obj-2000_sync-15`, prefijo `QUIVO_CARGA_PREFIJO=v2-rep-`,
mismo container `c1` relevantado con `./levantar.sh c1`, mismos parámetros: objetivo=2000,
sync=15s, K=20, 300s medición + 60s calentamiento).

### 7.1 Tabla comparativa — OLD (harness pre-fix) vs V2 vs V2-REP

| Punto | Corrida | Veredicto | Throughput logrado | % objetivo | p50 lote | p95 lote | p99 lote | CPU prom | CPU max | Backlog máx |
|---|---|---|---|---|---|---|---|---|---|---|
| c1@300  | OLD | PASA | 300.0 | 100.0% | 9.24ms | 11.14ms | 12.55ms | 11.3% | 43.4% | 1 |
| c1@300  | V2  | PASA | 300.0 | 100.0% | 7.01ms | 11.96ms | 21.76ms | 9.3% | 20.5% | 1 |
| c1@500  | OLD | PASA | 500.0 | 100.0% | 8.94ms | 10.64ms | 11.74ms | 18.5% | 66.4% | 1 |
| c1@500  | V2  | PASA | 499.9 | 99.99% | 5.67ms | 11.11ms | 11.89ms | 14.4% | 32.5% | 3 |
| c1@1000 | OLD | PASA | 999.9 | 99.99% | 8.57ms | 9.96ms | 10.83ms | 35.3% | 73.1% | 12 |
| c1@1000 | V2  | PASA | 1000.0 | 100.00% | 4.93ms | 10.07ms | 11.36ms | 23.8% | 38.4% | 3 |
| **c1@2000** | **OLD** | **FALLA** | 1757.9 | 87.9% | 8.46ms | 9.70ms | 10.43ms | 63.3% | 99.0% | 5737 (no sostenido) |
| **c1@2000** | **V2** | **PASA** | 1999.9 | 100.00% | 3.34ms | 6.92ms | 10.52ms | 37.3% | 65.8% | 5 |
| **c1@2000** | **V2-REP** | **PASA** | 1999.8 | 99.99% | 3.36ms | 6.68ms | 10.55ms | 42.5% | 105.1%* | 461 (drena igual) |
| c2@1000 | OLD | PASA | 1000.0 | 100.0% | 8.52ms | 9.89ms | 10.54ms | 34.6% | 54.5% | 4 |
| c2@1000 | V2  | PASA | 999.9 | 99.99% | 5.04ms | 10.73ms | 11.85ms | 24.0% | 35.8% | 2 |
| c2@2000 | OLD | PASA | 2000.0 | 100.0% | 3.11ms | 4.20ms | 4.99ms | 29.7% | 66.6% | 566 |
| c2@2000 | V2  | PASA | 2000.0 | 100.00% | 3.32ms | 7.27ms | 10.72ms | 36.8% | 53.3% | 6 |
| c2@3000 | OLD | PASA | 3000.0 | 100.0% | 2.54ms | 3.78ms | 4.34ms | 34.1% | 39.9% | 2 |
| c2@3000 | V2  | PASA | 2999.9 | 100.00% | 2.98ms | 5.38ms | 8.08ms | 48.0% | 80.8% | 10 |

\* CPU max de 105.1% en `v2-rep` es una muestra puntual de `docker stats` por encima del
100% nominal de `--cpus=1` — cgroup CFS puede reportar ráfagas cortas de hasta el 100% del
período de contabilidad más algo de ruido de medición; no invalida la corrida (throughput
99.99%, sostenido=true, 0 filas perdidas). `c2` corrió con memoria **forzada a 4096MB**
(`QUIVO_CARGA_MEM=4096m`) en vez del nominal 7680MB por RAM insuficiente del host (§0) — se
repite acá para no perder el contexto al leer esta tabla nueva.

**Veredicto de la repetición:** `c1@2000` **PASA de forma reproducible** — `v2` y `v2-rep`
coinciden dentro de ruido normal en throughput (99.99-100%), p50 (3.34-3.36ms) y p99
(10.52-10.55ms); solo el backlog máximo instantáneo (5 vs 461) y el CPU máximo puntual
(65.8% vs 105.1%) varían fuerte entre las dos corridas — consistente con contención de host
compartido (§0: 16 cores/13GiB compartidos con `quivo-pg`, `quivo-redis`, Supabase local,
etc.), no con un comportamiento distinto del harness. La hipótesis del chairman (carga
cerrada a concurrencia=1: con lotes de 15 filas y latencia de ~3.3-3.4ms el techo teórico de
throughput del CLIENTE es del orden de 1000ms/3.3ms×15 ≈ 4500 pts/s, muy por encima de 2000
— el cliente YA NO es el cuello en `v2`, a diferencia de lo que se infería del número viejo
de 8.46ms, ~1760 pts/s de techo) queda **confirmada como explicación del régimen viejo**: si
el batch tardaba ~8.46ms, el techo cliente-bound con concurrencia=1 era efectivamente
≈1000/8.46×15≈1774 pts/s — coincide casi exactamente con el throughput logrado real de la
corrida OLD (1757.9 pts/s). Es decir, la corrida OLD no falló por falta de capacidad de
Postgres — falló porque el cliente de un solo worker, a esa latencia por lote, físicamente
no podía encolar+confirmar más rápido, y el backlog creció sin límite.

### 7.2 Por qué bajó la latencia de lote (8.46ms → 3.34ms): investigación de causa

Se intentó explicar la caída de p50 comparando el código actual de `generador.mjs`/`lib/`
contra el que generó los resultados OLD. **No es posible un diff real:** `scripts/experimentos/`
está fuera de git (untracked, confirmado con `git status`), así que no existe una versión
anterior del código en el historial — solo quedan los artefactos (`.json`/`.log`) de esas
corridas viejas. Lo que sigue son los datos disponibles, no una reconstrucción inventada:

- **El código actual hace MÁS trabajo por lote que lo que describe el propio comentario del
  archivo sobre la versión vieja.** `generador.mjs:130-172` (`WITH ins AS (INSERT INTO
  gps_points ...) ... INSERT INTO gps_sesion_resumen ... ON CONFLICT (sesion_id, jornada,
  "sindicatoId") DO UPDATE SET ...`) replica la SQL real post-PR #74. El comentario en la
  línea 130-135 dice explícitamente: *"la versión anterior de este harness solo insertaba
  `gps_points` ... Medir con la versión vieja subestima el costo real de escritura (falta el
  CTE de agregación + el upsert)"*. Si eso es literalmente cierto, el código OLD hacía MENOS
  trabajo de Postgres por lote (sin el CTE de agregación ni el upsert a
  `gps_sesion_resumen`) y aun así midió MÁS latencia — va en la dirección contraria a lo que
  explicaría la mejora. Esto **no explica** la caída de latencia; si acaso la vuelve más
  llamativa.
- **Bug de duplicación de productores, documentado como corregido** (`generador.mjs:266-271`):
  *"la versión anterior armaba un `setInterval` nuevo DENTRO de cada disparo del propio
  interval, duplicando la carga en cada tick (1, 2, 4, 8, 16...)"*. Un bug así generaría
  crecimiento exponencial de timers — pero `lotesEnviados` de la corrida OLD (35158 en 300s)
  es coherente con la tasa nominal (2000 trufis × 300s/15s ≈ 40000 lotes esperados), no con
  una explosión exponencial. O el bug no estaba presente todavía en el código que generó los
  resultados OLD, o su efecto para este punto específico fue chico — los números no lo
  confirman ni lo descartan con certeza.
- **CPU de Postgres bajó fuerte en `c1` (63.3%→37.3% prom, 99.0%→65.8% max) pero se mantuvo
  igual o subió en `c2` (29.7%→36.8%, 34.1%→48.0%)** — un patrón que no calza con "el nuevo
  código hace más trabajo" (eso subiría CPU en ambos perfiles) ni con "el bug de duplicación
  se arregló" (eso bajaría CPU en ambos, no solo en `c1`). Calza mejor con **contención de
  CPU del host variable en el tiempo**: la corrida OLD de `c1@2000` fue el 21/22-sep cerca de
  medianoche (00:12), después de la precarga y de varias corridas previas de la misma
  sesión; la corrida V2 fue la mañana siguiente (07:26), con el host presumiblemente más
  descargado. `docker stats --cpus=1` mide el cgroup contra TODO lo demás que compite por ese
  mismo core físico en el host de 16 cores compartido (§0) — no es una medición aislada. **No
  hay logs de carga del host en esas dos ventanas para confirmarlo con certeza.**

**Conclusión: NO EXPLICADO con evidencia concluyente.** El candidato más consistente con los
datos disponibles es contención de CPU del host variable entre las dos ventanas de medición
(no un cambio de código), pero no se puede probar sin telemetría del host en el momento
exacto de la corrida OLD (no capturada en esa sesión). El hallazgo del CTE+upsert siendo
"más trabajo" hace que la explicación de "código más liviano" quede descartada explícitamente
— si algo, el código v2 debería ser más lento por SQL, no más rápido. No se inventa una causa
sin poder sustentarla.

### 7.3 Verificación: `gps_sesion_resumen` sí se escribió (v2-rep + reconciliación global)

`generador.mjs` incluye la sentencia real del worker (líneas 137-172): el `INSERT INTO
gps_points ... RETURNING ...` alimenta un CTE `agregados`/`ultimo_punto` que hace
`INSERT INTO gps_sesion_resumen (...) ... ON CONFLICT (sesion_id, jornada, "sindicatoId")
DO UPDATE SET total_puntos = gps_sesion_resumen.total_puntos + EXCLUDED.total_puntos, ...`
— en la MISMA transacción que el insert de puntos (confirmado leyendo el archivo, no
asumido).

Verificación contra la base (`set_config('app.rol','admin_quivo',false)` antes de consultar,
FORCE RLS respetada aunque el rol `quivo` de este Postgres local es superusuario y hace
bypass igual):

- **Ventana de la corrida `v2-rep`** (≈08:56:30 a 09:02:20 hora local, calentamiento+medición+
  drenado): `681255` filas nuevas en `gps_points` — coherente con
  filasConfirmadas=599940 (fase medida) + ~120000 filas de calentamiento (2000 pts/s × 60s) +
  el backlog drenado, dentro de margen del recorte de ventana aproximado.
- **Reconciliación EXACTA, global, sobre TODA la tabla acumulada (todas las corridas de la
  sesión, no solo v2-rep):**
  ```
  total_gps_points = 11147955
  suma_total_puntos_resumen = 11147955
  diferencia = 0
  grupos (sesion_id, jornada) con mismatch entre COUNT(gps_points) real y
    gps_sesion_resumen.total_puntos = 0
  ```
  Es decir: por cada combinación `(sesion_id, jornada, sindicatoId)`, el conteo real de
  `gps_points` coincide EXACTO con lo que acumuló el upsert de `gps_sesion_resumen` — cero
  desviación, cero grupos huérfanos de un lado o del otro. La escritura del resumen por lote
  está confirmada, no solo asumida por leer el código.

## 8. Limpieza

Pendiente al cerrar esta sesión: `scripts/experimentos/gps/carga/detener.sh --volumen` borra
`quivo-carga-pg` (contenedor), `quivo-carga-pgdata` (volumen) y `quivo-carga-net` (red) — los
tres únicos recursos Docker que creó este experimento. Nada de `quivo-control-postgres-1`,
`quivo-pg`, `quivo-redis` ni ningún otro contenedor del proyecto o del sistema fue tocado
(verificado con `docker ps -a` antes/después).

## 9. Cloud SQL remoto — tier c1 (paso B', `cloudsql/RUNBOOK.md`, 2026-09-22)

Confirmación contra Cloud SQL real (`quivo-carga-temp`, `db-custom-1-3840`, zona
`southamerica-west1`, PD-SSD 50GB, sin backups) — no NVMe local. Pasos del agente: `migrar.sh`
(33 migraciones reales incluida la RLS), `seed.mjs 1000` (1.000 sesiones), `precargar.mjs 500 7
1920` (server-side), matriz de escritura K=0, y `EXPLAIN (ANALYZE, BUFFERS)` de
`listarHoy`/`obtenerPosiciones`. Paso 5 (CPU real vía `metricas.sh`, Cloud Monitoring) y Paso 6
(cambio de tier) son del CTO — no ejecutados en esta corrida del agente; `cpuPromedioPct`/
`cpuMaxPct` quedan `null` en los JSON de este perfil (nota `notaCpu` en cada archivo, no
retro-completados). **Paso 5 y el borrado de la instancia (Paso 8) ya se ejecutaron, por el
CTO, fuera de esta corrida — resultados en §9.6.**

### 9.1 RTT Bolivia → `southamerica-west1`

`SELECT 1` × 20 (closed-loop, conexión ya abierta): **p50 = 36.97ms, p95 = 45.68ms, avg =
37.34ms**. Sirve de piso para interpretar la latencia de lote: el lote real mide
~187-190ms p50 (~5× el RTT puro), lo que indica que cada lote hace varios round-trips
(transacción con `BEGIN`/`INSERT`/`COMMIT`, no una sola sentencia), no que la red en sí sea
más lenta que lo medido.

### 9.2 Seed + precarga

- `seed.mjs 1000`: 1.000 sesiones operativas creadas.
- `precargar.mjs 500 7 1920`: 6.720.000 filas (500 sesiones × 7 días × 1.920 pts/sesión/día)
  en **142s (47.255 filas/s)**, server-side (`INSERT...SELECT...generate_series`).
  `gps_sesion_resumen` recomputada: 3.500 filas en 34s.

### 9.3 Matriz de escritura — resultado por punto

| perfil | objetivo pts/s | concurrencia | resultado | throughput logrado | throughput % | p50/p95 lote (ms) | backlog máx |
|---|---|---|---|---|---|---|---|
| remoto-c1 | 300 | 8 | **PASA** | 300 | 100% | 189.6 / 206.8 | 1 |
| remoto-c1 | 500 | 8 | **PASA** | 500 | 100% | 187.5 / 199.4 | 2 |
| remoto-c1 | 1000 | 8 | FALLA (`throughputInsuficiente`+`backlogNoSostenido`) | 634.2 | 63.4% | 187.5 / 199.3 | 8.721 |
| remoto-c1 | 2000 | 8 | FALLA (`throughputInsuficiente`+`backlogNoSostenido`) | 634.7 | 31.7% | 187.2 / 198.6 | 32.578 |
| remoto-c1-conc16 | 2000 | 16 | FALLA (`throughputInsuficiente`+`backlogNoSostenido`) | 1259.8 | 63.0% | 188.1 / 202.6 | 17.620 |
| remoto-c1-conc40 | 1000 | 40 | **PASA** | 1000 | 100% | 187.1 / 198.4 | 0 |
| remoto-c1-conc40 | 2000 | 40 | **PASA** | 2000 | 100% | 189.7 / 205.3 | 13 |

**Veredicto por punto, concurrencia=8 (config del RUNBOOK):** 300 y 500 pts/s PASAN limpio.
1000 y 2000 pts/s **FALLAN, pero limitados por red/concurrencia del cliente (RTT), NO por
capacidad de Cloud SQL** — la latencia de lote se mantiene CONSTANTE (~187-190ms p50) en los
7 puntos corridos, del más chico al más grande, con o sin backlog: si el cuello de botella
fuera CPU/disco de la instancia, la latencia de lote subiría con la carga. En cambio el
throughput escala linealmente con la concurrencia del generador (634 @8 → 1.260 @16 → 2.000
sostenido @40, ≈ concurrencia × 15 filas / 0.187s), confirmando que el techo es
"conexiones concurrentes disponibles para absorber el RTT cerrado por lote", no la base. **Los
puntos 1000/2000 @concurrencia=8 y el retry @16 quedan marcados como "limitado por red
(RTT)" — no representan un techo de Cloud SQL** (nota del chairman, 2026-09-22: tráfico real
son ~2.000 teléfonos independientes, o sea concurrencia alta es el caso representativo).
Con concurrencia=40 (fórmula `ceil(objetivo/15 × p50_lote_s) × 1.5 ≈ 38` para objetivo=2000,
redondeado a 40; cubre también 1000 con margen), **1000 y 2000 pts/s PASAN al 100% del
objetivo, backlog ~0, cero filas perdidas** — sin cambio de tier. Señal Cloud SQL: no hay CPU
real capturada en esta corrida (Paso 5 es del CTO); el único indicio disponible es indirecto
—la latencia de lote constante en las 7 corridas (incluidas las 3 con backlog creciente) no
muestra degradación server-side, consistente con que el 1 vCPU de `db-custom-1-3840` no
estaba saturado. Confirmación con CPU real queda pendiente del CTO vía `metricas.sh`.
Pool: `generador.mjs` arma `runtimePool(max(concurrencia,2))`, sin tope fijo; `max_connections`
de la instancia = 100, con 25 en uso durante la corrida — concurrencia=40 nunca se acercó al
límite.

Resultados completos: `resultados/perfil-remoto-c1_obj-{300,500,1000,2000}_sync-15.json`,
`resultados/perfil-remoto-c1-conc16_obj-2000_sync-15.json`,
`resultados/perfil-remoto-c1-conc40_obj-{1000,2000}_sync-15.json` (y sus `.generador.json`/
`.lecturas.json` acompañantes).

### 9.4 `EXPLAIN (ANALYZE, BUFFERS)` — `listarHoy` / `obtenerPosiciones` (1.000 sesiones, PD-SSD)

Archivo completo: `resultados/remoto-c1-explain-listarhoy-obtenerposiciones.txt`.

**Desviación del RUNBOOK a favor:** el RUNBOOK asume que estas queries todavía escanean
`gps_points` con el N+1 de §8 (`loops=1000` contra la tabla de puntos). Pero el código actual
(rama `exp/puntos-gps-carga`, PR #74 `perf(en-vivo): resumen por sesión para
listarHoy/obtenerPosiciones`, ya mergeado ANTES de esta corrida) reemplazó ese `LEFT JOIN
LATERAL` para que lea `gps_sesion_resumen` por PK `(sesion_id, jornada, sindicatoId)` en vez
de agregar `gps_points` en vivo. El plan confirma **`loops=1000` se sostiene** (una sesión
visible = una evaluación del LATERAL — eso sigue siendo cierto), pero cada loop ahora es un
**Index Scan sobre `gps_sesion_resumen_pkey`** (lookup por PK), no un escaneo/agregación de
`gps_points`. Confirmar esto en PD-SSD real era el objetivo del paso — lo confirma, con el
resultado invertido: el N+1 de §8 YA NO EXISTE en el código actual, en local o remoto.

- **`listarHoy`**: `Execution Time: 19.650 ms`. `Buffers: shared hit=11908 read=141
  dirtied=2` (top nivel `Limit`). El `Index Scan using gps_sesion_resumen_pkey` interno hace
  `loops=1000`, `Buffers: shared hit=3000` (3 buffers/loop, consistente con un lookup de PK
  angosto, no un escaneo).
- **`obtenerPosiciones`**: `Execution Time: 18.059 ms`. `Buffers: shared hit=14541` (sin
  `read` — todo en caché tras `listarHoy`). El LATERAL interno (`WindowAgg` +
  `Index Scan using gps_sesion_resumen_pkey`, `jornada IN (hoy, ayer)`) también hace
  `loops=1000`, `Buffers: shared hit=5503` (~5.5 buffers/loop, algo más caro por el `WindowAgg`
  + `Sort` internos, pero sigue siendo un lookup por PK, no un scan).

**Latencias de lectura standalone** (20 repeticiones cronometradas, transacción con RLS
activa, SIN carga de escritura concurrente corriendo — el RUNBOOK no define un punto K>0 para
`remoto-c1`, así que esto es un agregado fuera de la matriz para completar el reporte pedido):
`resultados/remoto-c1-lecturas-standalone.json`.

| query | p50 (ms) | p95 (ms) |
|---|---|---|
| listarHoy | 59.94 | 102.55 |
| obtenerPosiciones | 70.19 | 130.53 |

Consistente con RTT (~37ms) + tiempo de ejecución de la query (~18-20ms) + overhead de
protocolo — nada indica contención server-side.

### 9.5 Desviaciones del RUNBOOK en esta corrida

1. **Retry a concurrencia=16 para el punto 2000** (contingencia ya prevista en el RUNBOOK):
   también FALLA — throughput 1.259,8 pts/s (63,0% del objetivo), mismo patrón de latencia de
   lote plana.
2. **Retry adicional a concurrencia=40, puntos 1000 y 2000** (NO estaba en el RUNBOOK original;
   instrucción del chairman a mitad de corrida, dado que el tráfico real son ~2.000 dispositivos
   concurrentes independientes): ambos PASAN al 100%. Fórmula usada: `concurrencia ≥
   ceil(objetivo/15 × p50_lote_s) × 1.5` (p50_lote_s tomado de las corridas @8, ~0.187s) ⇒ ~38
   para objetivo=2000, redondeado a 40 (cubre también 1000 con margen).
3. **Lecturas standalone p50/p95** (sección 9.4): agregado fuera del RUNBOOK para completar el
   reporte — el RUNBOOK no define un punto K>0 para `remoto-c1`.
4. **Paso 5 (CPU real, `metricas.sh`) y Paso 6 (cambio de tier)**: no ejecutados por el agente
   (son del CTO, `gcloud`). `cpuPromedioPct`/`cpuMaxPct` quedan `null` en todos los JSON de
   este perfil. **Paso 5 se ejecutó después, por el CTO — ver §9.6.** Paso 6 (cambio de tier a
   `remoto-c2`) se descartó a propósito, no se ejecutó (§9.6).
5. **Paso 8 (borrado de la instancia)**: NO ejecutado por el agente al cierre de esta sesión —
   pendiente, es del CTO. La instancia `quivo-carga-temp` seguía corriendo (costo por hora) al
   cierre de esta sesión del agente. **Ya se ejecutó, por el CTO — ver §9.6** (instancia
   borrada, verificado con `gcloud sql instances list`).

### 9.6 CPU/memoria real (Cloud Monitoring, `metricas.sh`, corrida del CTO, 2026-09-22) — cierra Paso 5 y Paso 8

Paso 5 (CPU/memoria real vía Cloud Monitoring) y Paso 8 (borrado de la instancia) quedaron
pendientes del CTO al cierre de la sesión del agente (§9.5, puntos 4 y 5). **Ambos ya se
ejecutaron:** `metricas.sh` corrió contra `quivo-carga-temp` cubriendo la ventana completa de
la matriz §9.3, y la instancia se borró al terminar (`gcloud sql instances list` verificado:
solo queda `quivo-db` de producción).

`cpu`/`memory` son `utilization` de Cloud Monitoring
(`cloudsql.googleapis.com/database/cpu/utilization` y `.../memory/utilization`), rango 0-1.

| Fase | Ventana (hora local) | CPU (utilización) | Memoria (utilización) |
|---|---|---|---|
| Precarga 6,72M filas (§9.2) | 13:34-13:37 | 0,48-0,91 | — |
| Matriz conc8, 300/500/1000/2000 obj (§9.3, logrado ≤634,7 pts/s) | 13:43-14:02 | 0,11-0,20 | 0,58-0,65 |
| conc16 @2000 obj (1.259,8 pts/s, FALLA por red) | 14:05-14:09 | 0,25-0,27 | 0,58-0,65 |
| conc40 @1000 obj (1.000 pts/s, **PASA**) | 14:12-14:16 | 0,22-0,24 | 0,58-0,65 |
| conc40 @2000 obj (2.000 pts/s, **PASA**) | 14:17-14:22 | 0,31-0,50 (máx. 0,496) | 0,58-0,65 (máx. 0,648 a las 14:22) |
| idle baseline | — | ~0,05-0,06 | — |

(Memoria reportada como un solo rango agregado por `metricas.sh` para toda la ventana
13:30-14:30Z, 0,58-0,65 — no se desglosó por fase en la corrida del CTO; se repite igual en
cada fila de escritura para lectura rápida de la tabla, no son 5 mediciones independientes.)

**Conclusión: 1 vCPU Cloud SQL real sostiene 2.000 pts/s con CPU máx. 50%.** El punto que
realmente representa el pico de 2000 conductores — `conc40 @2000 obj`, PASA al 100% del
objetivo, backlog máx. 13, 0 filas perdidas (§9.3) — corre con CPU entre 31% y 50% (máximo
49,6%) y memoria máx. 64,8%, muy por debajo de saturación. Los puntos que FALLARON
(conc8/conc16 @1000-2000) fallaron por el mismo motivo ya documentado en §9.3 (RTT/concurrencia
del cliente, latencia de lote plana ~187-190ms), no por CPU de la instancia — de hecho corren
con CPU *menor* (11-27%) que el punto que sí pasa, porque mueven menos throughput real pese a
apuntar al mismo objetivo.

**`remoto-c2` (2 vCPU) se descartó a propósito, no por omisión:** el RUNBOOK preveía correr
`db-custom-2-7680` como segundo perfil (plan §10), pero con `remoto-c1` (1 vCPU) sosteniendo
2.000 pts/s al 100% con margen de CPU (máx. 50%), medir un segundo tier de escritura no
aporta nada nuevo — la escritura ya no es la variable que decide el tier a esta escala. El
tier real a 600/2.000 conductores lo deciden la regla de RAM/working-set y el piso de
producción (`docs/plan-experimento-puntos-gps.md` §9.2/§9.3), no la capacidad de escritura
(ver también `docs/costos-gcp-2000.md` §7.2/§7.5) — por lo tanto correr `remoto-c2` no habría
cambiado ninguna cifra en dólares del modelo de costos.
