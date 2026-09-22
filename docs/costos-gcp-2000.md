# Proyección de costos GCP — 10 a 2000 conductores

**Fecha de generación:** 2026-09-22 (script `scripts/costos/generar-tablas.mjs`, salida no editada a mano)
**Autor:** Tecnología / CTO
**Proyecto GCP:** `quivo-control-prod` · **Región:** `southamerica-west1` (Santiago, Tier 2 de GCP)
**Fuente del modelo:** `scripts/costos/modelo-costos.mjs` — extiende `docs/costos-gcp-por-escala.md` (2026-08-26) a 2000 conductores, recalibrado con la medición real de `docs/plan-costos-2000.md` §12 (2026-09-20) y, desde 2026-09-22, con la prueba de carga local de Postgres (Docker, disco NVMe local, no Cloud SQL — confirmada el 2026-09-22 contra una instancia Cloud SQL real, §7.5) de `docs/plan-experimento-puntos-gps.md` §8/§9 (ver §7 de este documento).

> **Este documento NO reemplaza `docs/costos-gcp-por-escala.md`.** Ese archivo es registro histórico y no se modifica. Este documento es la extensión pedida (ClickUp `86e34jkb2`) más la reconciliación con `documento-tecnico-cto.md` §10.

---

## 1. Resumen ejecutivo

Con los supuestos de carga MEDIDOS el 2026-09-20 (plan-costos-2000 §12), captura a 15 m (la actual, sin cambios de producto) y el escenario A (2000 transmitiendo a la vez — la definición más exigente de "2000 trufis"):

| Conductores | Arquitectura actual | Arquitectura optimizada | Tier Cloud SQL (actual) | ¿Supera la escritura medida del tier? (local) |
| ---: | ---: | ---: | :--- | :--- |
| 600 | US$436.53/mes | US$205.03/mes | `db-custom-2-7680` | no (149/1500 pts/s) |
| 2000 | US$1270.15/mes | US$703.35/mes | `db-custom-8-30720` (extrapolado) | no (495/6000 pts/s) (techo extrapolado, no medido — §7.5) |

_Techo de escritura = `SQL_TIERS_MEDIDOS.ptsSMax` (§7.4), 50% de lo que la prueba de carga local (plan-experimento §8) mostró que PASA. Tiers de 4 vCPU o más son EXTRAPOLADOS — no se corrieron en la prueba (RAM del host insuficiente, §7.5)._

El costo por conductor a 2000 (arquitectura optimizada) es US$0.35/mes — sube respecto a los US$0.34/mes de 600 conductores, porque la base fija (Redis, worker, VPC/GCS, Artifact Registry) se sigue repartiendo entre más conductores. **El hallazgo estructural de agosto sigue vigente: el costo no escala con la flota, escala con el dimensionamiento de Cloud SQL** — lo que cambió el 2026-09-22 es QUÉ decide ese dimensionamiento: ya no es una tabla de escritura sin medir, es el máximo de tres reglas medidas/declaradas (escritura, memoria de working set, piso de producción — §7 de este documento).

A 495.0 puntos/s pico (escenario A, 2000 conductores, captura 15 m) el tier elegido es `db-custom-8-30720`, EXTRAPOLADO (sin prueba de carga real a esa capacidad) — decidido por la regla "**ram**" de §9 del plan (§7.2 de este documento). Esto es un cambio estructural frente al dimensionamiento anterior (`SQL_TIERS`, agosto, sin medición de capacidad de escritura): la prueba de carga real (plan-experimento §8) mostró que la ESCRITURA sola de 2000 conductores (495.0 pts/s) entra en `db-custom-1-3840`, cerca del borde (margen 1.0%, dentro de ±2%) — el tier real lo termina decidiendo la memoria de working set o el piso de producción, no el pico de escritura. Detalle completo y cifras del dimensionamiento descartado en §9.

**A 600 conductores, las reglas "ram" y "piso" EMPATAN en `db-custom-2-7680`** (§7.2) — ninguna de las dos domina sola: aunque una cambiara de opinión, la otra igual pediría ese tier. A 2000 conductores la regla ganadora es "**ram**". El multiplicador de RAM (4×, §7.2 regla 2) es una heurística DECLARADA, no medida — se probó 3×/4×/5× programáticamente (tabla completa en §7.6): a 600 conductores el tier **NO cambia** en ese rango (el piso de producción ya fuerza db-custom-2-7680 aunque RAM pidiera menos); a 2000 conductores el tier **SÍ cambia** — ver §2 para la cifra de 2000 como RANGO por este motivo.

---

## 2. Reconciliación con `documento-tecnico-cto.md` §10

`documento-tecnico-cto.md` §10 (2026-07-19) proyectó **US$1.200–2.800/mes para 3000 vehículos**. Ese rango es anterior al relevamiento real con `gcloud` (2026-08-26), a la medición de carga de producción (2026-09-20) y a la prueba de carga real local (Postgres/Docker, no Cloud SQL — 2026-09-22, plan-experimento-puntos-gps.md §8): es una estimación de arquitectura, no de infraestructura desplegada y medida.

| Fuente | Cifra | Escala | Fecha |
| :--- | :--- | :--- | :--- |
| `documento-tecnico-cto.md` §10 | US$1.200 – 2.800/mes | 3000 vehículos | 2026-07-19 |
| `costos-gcp-por-escala.md` | $508.75 actual / $309.54 optimizada | 600 conductores | 2026-08-26 |
| Este documento (medido + carga real, escenario A, captura 15 m) | US$1270.15 actual / US$703.35 optimizada | 2000 conductores | 2026-09-22 |

**La diferencia es real y se explica en tres capas, no en una:**

1. **El rango de julio era arquitectura, no infraestructura desplegada ni medida.** No hubo relevamiento con `gcloud` ni precios de lista aplicados, y mucho menos una prueba de carga real contra la base de datos (ni siquiera local, como la de este documento — la confirmación contra Cloud SQL real se hizo el 2026-09-22, §7.5) — es una estimación previa, del mismo tipo que el ADR 0002 (que estimaba ~$255-290/mes asumiendo una base de datos de 2 vCPU/8 GB que nunca se creó, corregida en `costos-gcp-por-escala.md`).
2. **3000 ≠ 2000.** Este documento no extrapola hasta 3000 (fuera del encargo de la tarea ClickUp `86e34jkb2`, que pide hasta 2000). El rango de julio pesa sobre 1000 vehículos más.
3. **El régimen de costo no es lineal con la flota** (§1, hallazgo de agosto que sigue vigente): a 2000 conductores la base fija (Redis, worker, VPC/GCS, Artifact Registry) sigue siendo una fracción chica del total, y el grueso es Cloud SQL — pero desde 2026-09-22 dimensionado con evidencia de carga real (§7), no solo con un criterio de escritura pico sin medir.

**Conclusión para finanzas:** el rango de julio (US$1.200–2.800 para 3000) y la proyección de este documento para 2000 (US$1270.15 actual / US$703.35 optimizada) NO son directamente comparables — son estimaciones de tres momentos distintos del proyecto, con tres niveles de evidencia distintos.

**La cifra de este documento para 2000 (arquitectura actual) es un RANGO, no un número firme** — no por un empate de borde de escritura (§7.2 regla 1, eso ya no aplica: la regla ganadora es "**ram**"), sino porque el multiplicador de RAM (§7.2 regla 2, heurística DECLARADA, no medida) mueve el tier dentro del rango probado: a 3× el tier es `db-custom-4-15360` (US$994.06/mes); a 4× (el default de este documento) es `db-custom-8-30720` (US$1270.15/mes). **Rango real: US$994.06–US$1270.15/mes.** Ambos tiers (`db-custom-4-15360`, `db-custom-8-30720`) son de 4 vCPU o más — sus capacidades (escritura Y RAM) están EXTRAPOLADAS de la prueba de carga real (§7.1/§7.5: los perfiles `c4`/`c8` no corrieron, RAM del host insuficiente). Tabla de sensibilidad completa (3×/4×/5×, 600 y 2000, 15 m y 30 m, ambas arquitecturas): §7.6.

El número de este documento tiene evidencia real detrás (precios de lista + una prueba de carga real local de Postgres, aunque limitada y no sobre Cloud SQL — ver §7.1); el de julio es una proyección de arquitectura sin verificar contra infraestructura desplegada ni medida.

---

## 3. Metodología (resumen)

- **Factor pico/promedio de Cloud SQL:** `FACTOR_PICO_SOBRE_PROMEDIO = 1.485` (plan-costos-2000 §13.1). El promedio de la jornada (n × puntos/día ÷ jornada en segundos) NO es el pico de escritura que dimensiona el tier de Cloud SQL; agosto dimensionó contra el pico sin escribir la fórmula. Se aplica antes de elegir tier, nunca para el resto de los servicios.
- **Tiers de Cloud SQL — DOS dimensionamientos distintos, usados en momentos distintos (§7.2):** `SQL_TIERS` (agosto, criterio de escritura pico SIN medición de capacidad real, NO se toca — es el ancla del test de regresión) y `SQL_TIERS_MEDIDOS` (2026-09-22, plan-experimento §8/§9, construido sobre una prueba de carga real de Postgres). Este documento usa `SQL_TIERS_MEDIDOS` para toda la proyección con supuestos MEDIDOS (§4-§6); `SQL_TIERS` solo sobrevive para el test de regresión contra agosto y para la referencia histórica de §9.
- **Dimensionamiento MEDIDO de Cloud SQL (§7, plan §9) — el tier elegido es el MAYOR de tres reglas:**
  1. **Escritura:** techo de diseño = 50% de lo que la prueba de carga mostró que PASA. 1 vCPU → 500 pts/s, 2 vCPU → 1.500 pts/s, 4 vCPU → 3.000 pts/s (extrapolado).
  2. **Memoria (working set):** RAM del tier ≥ 4 × (bytes de índice de 2 días de la flota efectiva), con 210.64 B de índice/fila MEDIDOS (§7.1).
  3. **Piso de producción:** `db-custom-2-7680` desde 100 trufis efectivos; por debajo, se delega en `SQL_TIERS` (agosto) — este dimensionamiento medido no inventa un tier chico sin evidencia a esa escala.
- **Instancias de `quivo-worker`:** tabla explícita de umbrales en requests/día (no una fórmula de conductores), anclada en el punto medio entre lo que generan 400 y 500 conductores bajo el ciclo de sync de 15s de agosto (450 conductores × tasa de agosto). Reproduce "1 worker hasta 400, 2 desde 500" (agosto §5) y se extiende a 800-2000 duplicando el mismo umbral, documentado como extrapolación (plan-costos-2000 §13.2).
- **Costo de `quivo-api`:** el componente de CPU activa por request (`cpuSegPorRequestApi`) se calibra por MEJOR AJUSTE de mínimos cuadrados (error en USD) contra los **18 puntos de referencia** publicados en agosto (9 escalones × 2 arquitecturas), no contra un solo escalón (plan-costos-2000 §13.3). El valor resultante es `CPU_SEG_POR_REQUEST_API = 0.048119` vCPU-s/request. **Este parámetro no reproduce bien toda la columna "API" de agosto** — ver §11 para la tabla de residuos completa y por qué.
- **Supuestos de carga:** tres juegos, citados de fuentes distintas. "Agosto" (`SUPUESTOS_AGOSTO`, 240 B/punto, 2500 pts/conductor/día) se usa SOLO para el test de regresión contra el documento de agosto. "Medidos, 15 m" (`SUPUESTOS_MEDIDOS`, 365.6 B/punto, 6000 pts/conductor/día, plan-costos-2000 §12, medición real 2026-09-20) es la captura ACTUAL, sin cambios de producto — arma §4/§6. "Medidos, 30 m" (`SUPUESTOS_MEDIDOS_30M`, 2972 pts/conductor/día, plan-experimento §7/§9.6) asume que se sube el `distanceFilter` del SDK móvil de 15 m a 30 m — arma §5.

---

## 4. Escalones 10 → 2000 conductores (supuestos MEDIDOS 2026-09-20, captura 15 m — la actual, sin cambios de producto)

Tres escenarios de qué significa "2000 trufis" (plan-costos-2000 §4.2/§10 — el CTO pidió modelarlos todos en vez de elegir uno):

- **A · pico concurrente** — 2000 transmitiendo a la vez (el escalón "n" ES el pico concurrente). (factor de concurrencia 1). docs/plan-costos-2000.md §4.2 (~207 pts/s a 2000, consistente con factor 1)
- **B · padrón con 60% activo** — "n" es la flota registrada; ~60% está activa/transmitiendo en el pico. (factor de concurrencia 0.6). docs/plan-costos-2000.md §4.2 ("2000 registrados, ~1200 en pico")
- **C · activos/mes, pico menor** — "n" son conductores distintos activos en el mes; el pico diario es menor porque no todos operan el mismo día (patrón típico de flotas de transporte compartido con turnos). (factor de concurrencia 0.35). docs/plan-costos-2000.md §4.2 (factor marcado "a derivar" en el plan) — NO VERIFICADO, supuesto de producto sin medición de respaldo.

### 4.1 Escenario A · pico concurrente

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 10 | `db-g1-small` | 2.5 | agosto-fallback | 10 GiB | $157.68 | $15.77 |
| 25 | 25 | `db-custom-1-3840` | 6.2 | agosto-fallback | 20 GiB | $194.73 | $7.79 |
| 50 | 50 | `db-custom-2-7680` | 12.4 | agosto-fallback | 30 GiB | $267.92 | $5.36 |
| 100 | 100 | `db-custom-2-7680` | 24.8 | piso | 45 GiB | $276.96 | $2.77 |
| 200 | 200 | `db-custom-2-7680` | 49.5 | piso | 80 GiB | $301.39 | $1.51 |
| 300 | 300 | `db-custom-2-7680` | 74.3 | piso | 115 GiB | $326.26 | $1.09 |
| 400 | 400 | `db-custom-2-7680` | 99.0 | ram+piso | 150 GiB | $351.13 | $0.88 |
| 500 | 500 | `db-custom-2-7680` | 123.8 | ram+piso | 185 GiB | $413.41 | $0.83 |
| 600 | 600 | `db-custom-2-7680` | 148.5 | ram+piso | 215 GiB | $436.53 | $0.73 |
| 800 | 800 | `db-custom-4-15360` * | 198.0 | ram | 285 GiB | $624.31 | $0.78 |
| 1000 | 1000 | `db-custom-4-15360` * | 247.5 | ram | 355 GiB | $711.46 | $0.71 |
| 1200 | 1200 | `db-custom-4-15360` * | 297.0 | ram | 420 GiB | $759.45 | $0.63 |
| 1500 | 1500 | `db-custom-4-15360` * | 371.3 | ram | 525 GiB | $834.06 | $0.56 |
| 1750 | 1750 | `db-custom-8-30720` * | 433.1 | ram | 610 GiB | $1171.44 | $0.67 |
| 2000 | 2000 | `db-custom-8-30720` * | 495.0 | ram | 695 GiB | $1270.15 | $0.64 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 10 | `db-g1-small` | 2.5 | agosto-fallback | 10 GiB | $80.35 | $8.03 |
| 25 | 25 | `db-custom-1-3840` | 6.2 | agosto-fallback | 15 GiB | $98.42 | $3.94 |
| 50 | 50 | `db-custom-2-7680` | 12.4 | agosto-fallback | 20 GiB | $152.46 | $3.05 |
| 100 | 100 | `db-custom-2-7680` | 24.8 | piso | 30 GiB | $157.01 | $1.57 |
| 200 | 200 | `db-custom-2-7680` | 49.5 | piso | 45 GiB | $164.50 | $0.82 |
| 300 | 300 | `db-custom-2-7680` | 74.3 | piso | 65 GiB | $174.08 | $0.58 |
| 400 | 400 | `db-custom-2-7680` | 99.0 | ram+piso | 80 GiB | $183.71 | $0.46 |
| 500 | 500 | `db-custom-2-7680` | 123.8 | ram+piso | 100 GiB | $195.26 | $0.39 |
| 600 | 600 | `db-custom-2-7680` | 148.5 | ram+piso | 115 GiB | $205.03 | $0.34 |
| 800 | 800 | `db-custom-4-15360` * | 198.0 | ram | 150 GiB | $330.26 | $0.41 |
| 1000 | 1000 | `db-custom-4-15360` * | 247.5 | ram | 185 GiB | $352.00 | $0.35 |
| 1200 | 1200 | `db-custom-4-15360` * | 297.0 | ram | 215 GiB | $371.95 | $0.31 |
| 1500 | 1500 | `db-custom-4-15360` * | 371.3 | ram | 270 GiB | $405.44 | $0.27 |
| 1750 | 1750 | `db-custom-8-30720` * | 433.1 | ram | 310 GiB | $638.33 | $0.36 |
| 2000 | 2000 | `db-custom-8-30720` * | 495.0 | ram | 355 GiB | $703.35 | $0.35 |

### 4.2 Escenario B · padrón con 60% activo

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 6 | `db-g1-small` | 1.5 | agosto-fallback | 10 GiB | $157.66 | $15.77 |
| 25 | 15 | `db-g1-small` | 3.7 | agosto-fallback | 20 GiB | $161.43 | $6.46 |
| 50 | 30 | `db-custom-1-3840` | 7.4 | agosto-fallback | 30 GiB | $198.63 | $3.97 |
| 100 | 60 | `db-custom-2-7680` | 14.9 | agosto-fallback | 45 GiB | $274.16 | $2.74 |
| 200 | 120 | `db-custom-2-7680` | 29.7 | piso | 80 GiB | $292.76 | $1.46 |
| 300 | 180 | `db-custom-2-7680` | 44.6 | piso | 115 GiB | $312.90 | $1.04 |
| 400 | 240 | `db-custom-2-7680` | 59.4 | piso | 150 GiB | $333.31 | $0.83 |
| 500 | 300 | `db-custom-2-7680` | 74.3 | piso | 185 GiB | $353.73 | $0.71 |
| 600 | 360 | `db-custom-2-7680` | 89.1 | piso | 215 GiB | $372.39 | $0.62 |
| 800 | 480 | `db-custom-2-7680` | 118.8 | ram+piso | 285 GiB | $450.63 | $0.56 |
| 1000 | 600 | `db-custom-2-7680` | 148.5 | ram+piso | 355 GiB | $491.46 | $0.49 |
| 1200 | 720 | `db-custom-2-7680` | 178.2 | ram+piso | 420 GiB | $530.54 | $0.44 |
| 1500 | 900 | `db-custom-4-15360` * | 222.8 | ram | 525 GiB | $729.83 | $0.49 |
| 1750 | 1050 | `db-custom-4-15360` * | 259.9 | ram | 610 GiB | $817.40 | $0.47 |
| 2000 | 1200 | `db-custom-4-15360` * | 297.0 | ram | 695 GiB | $867.57 | $0.43 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 6 | `db-g1-small` | 1.5 | agosto-fallback | 10 GiB | $80.33 | $8.03 |
| 25 | 15 | `db-g1-small` | 3.7 | agosto-fallback | 15 GiB | $82.37 | $3.29 |
| 50 | 30 | `db-custom-1-3840` | 7.4 | agosto-fallback | 20 GiB | $100.59 | $2.01 |
| 100 | 60 | `db-custom-2-7680` | 14.9 | agosto-fallback | 30 GiB | $156.81 | $1.57 |
| 200 | 120 | `db-custom-2-7680` | 29.7 | piso | 45 GiB | $163.93 | $0.82 |
| 300 | 180 | `db-custom-2-7680` | 44.6 | piso | 65 GiB | $172.90 | $0.58 |
| 400 | 240 | `db-custom-2-7680` | 59.4 | piso | 80 GiB | $180.31 | $0.45 |
| 500 | 300 | `db-custom-2-7680` | 74.3 | piso | 100 GiB | $189.50 | $0.38 |
| 600 | 360 | `db-custom-2-7680` | 89.1 | piso | 115 GiB | $197.94 | $0.33 |
| 800 | 480 | `db-custom-2-7680` | 118.8 | ram+piso | 150 GiB | $216.90 | $0.27 |
| 1000 | 600 | `db-custom-2-7680` | 148.5 | ram+piso | 185 GiB | $235.86 | $0.24 |
| 1200 | 720 | `db-custom-2-7680` | 178.2 | ram+piso | 215 GiB | $253.25 | $0.21 |
| 1500 | 900 | `db-custom-4-15360` * | 222.8 | ram | 270 GiB | $386.48 | $0.26 |
| 1750 | 1050 | `db-custom-4-15360` * | 259.9 | ram | 310 GiB | $409.15 | $0.23 |
| 2000 | 1200 | `db-custom-4-15360` * | 297.0 | ram | 355 GiB | $433.60 | $0.22 |

### 4.3 Escenario C · activos/mes, pico menor

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 4 | `db-g1-small` | 0.9 | agosto-fallback | 10 GiB | $157.65 | $15.77 |
| 25 | 9 | `db-g1-small` | 2.2 | agosto-fallback | 20 GiB | $161.40 | $6.46 |
| 50 | 18 | `db-g1-small` | 4.3 | agosto-fallback | 30 GiB | $165.31 | $3.31 |
| 100 | 35 | `db-custom-1-3840` | 8.7 | agosto-fallback | 45 GiB | $204.65 | $2.05 |
| 200 | 70 | `db-custom-2-7680` | 17.3 | agosto-fallback | 80 GiB | $288.14 | $1.44 |
| 300 | 105 | `db-custom-2-7680` | 26.0 | piso | 115 GiB | $304.94 | $1.02 |
| 400 | 140 | `db-custom-2-7680` | 34.6 | piso | 150 GiB | $322.29 | $0.81 |
| 500 | 175 | `db-custom-2-7680` | 43.3 | piso | 185 GiB | $339.81 | $0.68 |
| 600 | 210 | `db-custom-2-7680` | 52.0 | piso | 215 GiB | $355.69 | $0.59 |
| 800 | 280 | `db-custom-2-7680` | 69.3 | piso | 285 GiB | $390.95 | $0.49 |
| 1000 | 350 | `db-custom-2-7680` | 86.6 | piso | 355 GiB | $426.22 | $0.43 |
| 1200 | 420 | `db-custom-2-7680` | 104.0 | ram+piso | 420 GiB | $459.73 | $0.38 |
| 1500 | 525 | `db-custom-2-7680` | 129.9 | ram+piso | 525 GiB | $550.03 | $0.37 |
| 1750 | 613 | `db-custom-2-7680` | 151.6 | ram+piso | 610 GiB | $593.23 | $0.34 |
| 2000 | 700 | `db-custom-2-7680` | 173.3 | ram+piso | 695 GiB | $636.44 | $0.32 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 4 | `db-g1-small` | 0.9 | agosto-fallback | 10 GiB | $80.31 | $8.03 |
| 25 | 9 | `db-g1-small` | 2.2 | agosto-fallback | 15 GiB | $82.34 | $3.29 |
| 50 | 18 | `db-g1-small` | 4.3 | agosto-fallback | 20 GiB | $84.53 | $1.69 |
| 100 | 35 | `db-custom-1-3840` | 8.7 | agosto-fallback | 30 GiB | $104.92 | $1.05 |
| 200 | 70 | `db-custom-2-7680` | 17.3 | agosto-fallback | 45 GiB | $163.68 | $0.82 |
| 300 | 105 | `db-custom-2-7680` | 26.0 | piso | 65 GiB | $172.45 | $0.57 |
| 400 | 140 | `db-custom-2-7680` | 34.6 | piso | 80 GiB | $179.44 | $0.45 |
| 500 | 175 | `db-custom-2-7680` | 43.3 | piso | 100 GiB | $188.26 | $0.38 |
| 600 | 210 | `db-custom-2-7680` | 52.0 | piso | 115 GiB | $195.43 | $0.33 |
| 800 | 280 | `db-custom-2-7680` | 69.3 | piso | 150 GiB | $211.53 | $0.26 |
| 1000 | 350 | `db-custom-2-7680` | 86.6 | piso | 185 GiB | $228.47 | $0.23 |
| 1200 | 420 | `db-custom-2-7680` | 104.0 | ram+piso | 215 GiB | $244.18 | $0.20 |
| 1500 | 525 | `db-custom-2-7680` | 129.9 | ram+piso | 270 GiB | $271.29 | $0.18 |
| 1750 | 613 | `db-custom-2-7680` | 151.6 | ram+piso | 310 GiB | $291.81 | $0.17 |
| 2000 | 700 | `db-custom-2-7680` | 173.3 | ram+piso | 355 GiB | $314.28 | $0.16 |

\* Tier extrapolado por este modelo — sin evidencia de prueba de carga real a esa capacidad (agosto no dimensionó más allá de 600 conductores; la prueba de carga local de septiembre no corrió los perfiles de 4/8 vCPU, RAM del host insuficiente — §7.1).

Columna "Regla": qué regla de §7.2 decidió el tier de Cloud SQL en ese escalón — `escritura` (pico de INSERT), `ram` (memoria de working set) o `piso` (mínimo de producción desde 100 trufis efectivos). Por debajo de 100 trufis efectivos, este dimensionamiento medido no aplica y se usa la tabla de agosto (`SQL_TIERS`) — la columna muestra `agosto-fallback` en esos escalones.

---

## 5. Escalones 10 → 2000 conductores (supuestos MEDIDOS + captura 30 m — requiere subir `distanceFilter` en el SDK móvil (plan-experimento §7/§9.6))

Tres escenarios de qué significa "2000 trufis" (plan-costos-2000 §4.2/§10 — el CTO pidió modelarlos todos en vez de elegir uno):

- **A · pico concurrente** — 2000 transmitiendo a la vez (el escalón "n" ES el pico concurrente). (factor de concurrencia 1). docs/plan-costos-2000.md §4.2 (~207 pts/s a 2000, consistente con factor 1)
- **B · padrón con 60% activo** — "n" es la flota registrada; ~60% está activa/transmitiendo en el pico. (factor de concurrencia 0.6). docs/plan-costos-2000.md §4.2 ("2000 registrados, ~1200 en pico")
- **C · activos/mes, pico menor** — "n" son conductores distintos activos en el mes; el pico diario es menor porque no todos operan el mismo día (patrón típico de flotas de transporte compartido con turnos). (factor de concurrencia 0.35). docs/plan-costos-2000.md §4.2 (factor marcado "a derivar" en el plan) — NO VERIFICADO, supuesto de producto sin medición de respaldo.

### 5.1 Escenario A · pico concurrente

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 10 | `db-g1-small` | 1.2 | agosto-fallback | 10 GiB | $157.61 | $15.76 |
| 25 | 25 | `db-g1-small` | 3.1 | agosto-fallback | 15 GiB | $159.54 | $6.38 |
| 50 | 50 | `db-custom-1-3840` | 6.1 | agosto-fallback | 20 GiB | $195.03 | $3.90 |
| 100 | 100 | `db-custom-2-7680` | 12.3 | piso | 30 GiB | $270.96 | $2.71 |
| 200 | 200 | `db-custom-2-7680` | 24.5 | piso | 45 GiB | $287.64 | $1.44 |
| 300 | 300 | `db-custom-2-7680` | 36.8 | piso | 65 GiB | $306.51 | $1.02 |
| 400 | 400 | `db-custom-2-7680` | 49.0 | piso | 80 GiB | $323.63 | $0.81 |
| 500 | 500 | `db-custom-2-7680` | 61.3 | piso | 95 GiB | $378.16 | $0.76 |
| 600 | 600 | `db-custom-2-7680` | 73.6 | piso | 115 GiB | $397.03 | $0.66 |
| 800 | 800 | `db-custom-2-7680` | 98.1 | piso | 150 GiB | $433.03 | $0.54 |
| 1000 | 1000 | `db-custom-2-7680` | 122.6 | ram+piso | 180 GiB | $504.67 | $0.50 |
| 1200 | 1200 | `db-custom-2-7680` | 147.1 | ram+piso | 215 GiB | $540.67 | $0.45 |
| 1500 | 1500 | `db-custom-2-7680` | 183.9 | ram+piso | 265 GiB | $593.78 | $0.40 |
| 1750 | 1750 | `db-custom-4-15360` * | 214.5 | ram | 310 GiB | $777.25 | $0.44 |
| 2000 | 2000 | `db-custom-4-15360` * | 245.2 | ram | 350 GiB | $858.33 | $0.43 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 10 | `db-g1-small` | 1.2 | agosto-fallback | 10 GiB | $80.27 | $8.03 |
| 25 | 25 | `db-g1-small` | 3.1 | agosto-fallback | 15 GiB | $82.24 | $3.29 |
| 50 | 50 | `db-custom-1-3840` | 6.1 | agosto-fallback | 15 GiB | $98.54 | $1.97 |
| 100 | 100 | `db-custom-2-7680` | 12.3 | piso | 20 GiB | $152.70 | $1.53 |
| 200 | 200 | `db-custom-2-7680` | 24.5 | piso | 30 GiB | $157.67 | $0.79 |
| 300 | 300 | `db-custom-2-7680` | 36.8 | piso | 40 GiB | $162.94 | $0.54 |
| 400 | 400 | `db-custom-2-7680` | 49.0 | piso | 45 GiB | $168.27 | $0.42 |
| 500 | 500 | `db-custom-2-7680` | 61.3 | piso | 55 GiB | $175.51 | $0.35 |
| 600 | 600 | `db-custom-2-7680` | 73.6 | piso | 65 GiB | $182.76 | $0.30 |
| 800 | 800 | `db-custom-2-7680` | 98.1 | piso | 80 GiB | $195.85 | $0.24 |
| 1000 | 1000 | `db-custom-2-7680` | 122.6 | ram+piso | 95 GiB | $208.97 | $0.21 |
| 1200 | 1200 | `db-custom-2-7680` | 147.1 | ram+piso | 115 GiB | $223.87 | $0.19 |
| 1500 | 1500 | `db-custom-2-7680` | 183.9 | ram+piso | 140 GiB | $244.44 | $0.16 |
| 1750 | 1750 | `db-custom-4-15360` * | 214.5 | ram | 160 GiB | $364.82 | $0.21 |
| 2000 | 2000 | `db-custom-4-15360` * | 245.2 | ram | 180 GiB | $419.08 | $0.21 |

### 5.2 Escenario B · padrón con 60% activo

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 6 | `db-g1-small` | 0.7 | agosto-fallback | 10 GiB | $157.59 | $15.76 |
| 25 | 15 | `db-g1-small` | 1.8 | agosto-fallback | 15 GiB | $159.49 | $6.38 |
| 50 | 30 | `db-g1-small` | 3.7 | agosto-fallback | 20 GiB | $161.50 | $3.23 |
| 100 | 60 | `db-custom-1-3840` | 7.4 | agosto-fallback | 30 GiB | $199.14 | $1.99 |
| 200 | 120 | `db-custom-2-7680` | 14.7 | piso | 45 GiB | $279.01 | $1.40 |
| 300 | 180 | `db-custom-2-7680` | 22.1 | piso | 65 GiB | $293.15 | $0.98 |
| 400 | 240 | `db-custom-2-7680` | 29.4 | piso | 80 GiB | $305.82 | $0.76 |
| 500 | 300 | `db-custom-2-7680` | 36.8 | piso | 95 GiB | $318.48 | $0.64 |
| 600 | 360 | `db-custom-2-7680` | 44.1 | piso | 115 GiB | $332.90 | $0.55 |
| 800 | 480 | `db-custom-2-7680` | 58.8 | piso | 150 GiB | $397.39 | $0.50 |
| 1000 | 600 | `db-custom-2-7680` | 73.6 | piso | 180 GiB | $422.72 | $0.42 |
| 1200 | 720 | `db-custom-2-7680` | 88.3 | piso | 215 GiB | $449.81 | $0.37 |
| 1500 | 900 | `db-custom-2-7680` | 110.3 | ram+piso | 265 GiB | $489.56 | $0.33 |
| 1750 | 1050 | `db-custom-2-7680` | 128.7 | ram+piso | 310 GiB | $561.25 | $0.32 |
| 2000 | 1200 | `db-custom-2-7680` | 147.1 | ram+piso | 350 GiB | $593.80 | $0.30 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 6 | `db-g1-small` | 0.7 | agosto-fallback | 10 GiB | $80.25 | $8.03 |
| 25 | 15 | `db-g1-small` | 1.8 | agosto-fallback | 15 GiB | $82.19 | $3.29 |
| 50 | 30 | `db-g1-small` | 3.7 | agosto-fallback | 15 GiB | $82.44 | $1.65 |
| 100 | 60 | `db-custom-1-3840` | 7.4 | agosto-fallback | 20 GiB | $100.74 | $1.01 |
| 200 | 120 | `db-custom-2-7680` | 14.7 | piso | 30 GiB | $157.09 | $0.79 |
| 300 | 180 | `db-custom-2-7680` | 22.1 | piso | 40 GiB | $161.76 | $0.54 |
| 400 | 240 | `db-custom-2-7680` | 29.4 | piso | 45 GiB | $164.87 | $0.41 |
| 500 | 300 | `db-custom-2-7680` | 36.8 | piso | 55 GiB | $169.75 | $0.34 |
| 600 | 360 | `db-custom-2-7680` | 44.1 | piso | 65 GiB | $175.67 | $0.29 |
| 800 | 480 | `db-custom-2-7680` | 58.8 | piso | 80 GiB | $186.02 | $0.23 |
| 1000 | 600 | `db-custom-2-7680` | 73.6 | piso | 95 GiB | $196.36 | $0.20 |
| 1200 | 720 | `db-custom-2-7680` | 88.3 | piso | 115 GiB | $208.71 | $0.17 |
| 1500 | 900 | `db-custom-2-7680` | 110.3 | ram+piso | 140 GiB | $225.49 | $0.15 |
| 1750 | 1050 | `db-custom-2-7680` | 128.7 | ram+piso | 160 GiB | $239.18 | $0.14 |
| 2000 | 1200 | `db-custom-2-7680` | 147.1 | ram+piso | 180 GiB | $252.86 | $0.13 |

### 5.3 Escenario C · activos/mes, pico menor

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 4 | `db-g1-small` | 0.4 | agosto-fallback | 10 GiB | $157.58 | $15.76 |
| 25 | 9 | `db-g1-small` | 1.1 | agosto-fallback | 15 GiB | $159.46 | $6.38 |
| 50 | 18 | `db-g1-small` | 2.1 | agosto-fallback | 20 GiB | $161.44 | $3.23 |
| 100 | 35 | `db-g1-small` | 4.3 | agosto-fallback | 30 GiB | $165.39 | $1.65 |
| 200 | 70 | `db-custom-1-3840` | 8.6 | agosto-fallback | 45 GiB | $205.37 | $1.03 |
| 300 | 105 | `db-custom-2-7680` | 12.9 | piso | 65 GiB | $285.20 | $0.95 |
| 400 | 140 | `db-custom-2-7680` | 17.2 | piso | 80 GiB | $294.79 | $0.74 |
| 500 | 175 | `db-custom-2-7680` | 21.5 | piso | 95 GiB | $304.56 | $0.61 |
| 600 | 210 | `db-custom-2-7680` | 25.7 | piso | 115 GiB | $316.20 | $0.53 |
| 800 | 280 | `db-custom-2-7680` | 34.3 | piso | 150 GiB | $337.71 | $0.42 |
| 1000 | 350 | `db-custom-2-7680` | 42.9 | piso | 180 GiB | $357.48 | $0.36 |
| 1200 | 420 | `db-custom-2-7680` | 51.5 | piso | 215 GiB | $378.99 | $0.32 |
| 1500 | 525 | `db-custom-2-7680` | 64.4 | piso | 265 GiB | $447.80 | $0.30 |
| 1750 | 613 | `db-custom-2-7680` | 75.1 | piso | 310 GiB | $475.13 | $0.27 |
| 2000 | 700 | `db-custom-2-7680` | 85.8 | piso | 350 GiB | $500.71 | $0.25 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | Regla | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 4 | `db-g1-small` | 0.4 | agosto-fallback | 10 GiB | $80.24 | $8.02 |
| 25 | 9 | `db-g1-small` | 1.1 | agosto-fallback | 15 GiB | $82.15 | $3.29 |
| 50 | 18 | `db-g1-small` | 2.1 | agosto-fallback | 15 GiB | $82.38 | $1.65 |
| 100 | 35 | `db-g1-small` | 4.3 | agosto-fallback | 20 GiB | $84.61 | $0.85 |
| 200 | 70 | `db-custom-1-3840` | 8.6 | agosto-fallback | 30 GiB | $105.08 | $0.53 |
| 300 | 105 | `db-custom-2-7680` | 12.9 | piso | 40 GiB | $161.31 | $0.54 |
| 400 | 140 | `db-custom-2-7680` | 17.2 | piso | 45 GiB | $164.00 | $0.41 |
| 500 | 175 | `db-custom-2-7680` | 21.5 | piso | 55 GiB | $168.52 | $0.34 |
| 600 | 210 | `db-custom-2-7680` | 25.7 | piso | 65 GiB | $173.15 | $0.29 |
| 800 | 280 | `db-custom-2-7680` | 34.3 | piso | 80 GiB | $180.65 | $0.23 |
| 1000 | 350 | `db-custom-2-7680` | 42.9 | piso | 95 GiB | $188.98 | $0.19 |
| 1200 | 420 | `db-custom-2-7680` | 51.5 | piso | 115 GiB | $199.63 | $0.17 |
| 1500 | 525 | `db-custom-2-7680` | 64.4 | piso | 140 GiB | $213.83 | $0.14 |
| 1750 | 613 | `db-custom-2-7680` | 75.1 | piso | 160 GiB | $225.36 | $0.13 |
| 2000 | 700 | `db-custom-2-7680` | 85.8 | piso | 180 GiB | $237.07 | $0.12 |

\* Tier extrapolado por este modelo — sin evidencia de prueba de carga real a esa capacidad (agosto no dimensionó más allá de 600 conductores; la prueba de carga local de septiembre no corrió los perfiles de 4/8 vCPU, RAM del host insuficiente — §7.1).

Columna "Regla": qué regla de §7.2 decidió el tier de Cloud SQL en ese escalón — `escritura` (pico de INSERT), `ram` (memoria de working set) o `piso` (mínimo de producción desde 100 trufis efectivos). Por debajo de 100 trufis efectivos, este dimensionamiento medido no aplica y se usa la tabla de agosto (`SQL_TIERS`) — la columna muestra `agosto-fallback` en esos escalones.

---

## 6. Desglose por servicio — n=600 y n=2000 (escenario A)

### 6.1 Captura 15 m (supuestos medidos, la actual)

**Arquitectura Actual**

| Conductores | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | GCS | Art.Reg. | Egreso | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | $138.04 | $51.17 | $22.96 | $51.10 | $74.10 | $3.00 | $68.55 | $18.40 | $0.00 | $0.30 | $8.90 | **$436.53** |
| 2000 | $552.17 | $165.41 | $76.72 | $51.10 | $223.01 | $10.00 | $143.36 | $18.40 | $0.00 | $0.30 | $29.68 | **$1270.15** |

**Arquitectura Optimizada**

| Conductores | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | GCS | Art.Reg. | Egreso | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | $103.53 | $27.37 | $11.76 | $10.50 | $7.88 | $3.00 | $31.14 | $0.00 | $0.64 | $0.30 | $8.90 | **$205.03** |
| 2000 | $414.13 | $84.49 | $38.64 | $10.50 | $45.07 | $10.00 | $68.55 | $0.00 | $1.99 | $0.30 | $29.68 | **$703.35** |

### 6.2 Captura 30 m (supuestos medidos + captura reducida)

**Arquitectura Actual**

| Conductores | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | GCS | Art.Reg. | Egreso | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | $138.04 | $27.37 | $11.76 | $51.10 | $74.10 | $3.00 | $68.55 | $18.40 | $0.00 | $0.30 | $4.41 | **$397.03** |
| 2000 | $276.09 | $83.30 | $38.08 | $51.10 | $223.01 | $10.00 | $143.36 | $18.40 | $0.00 | $0.30 | $14.70 | **$858.33** |

**Arquitectura Optimizada**

| Conductores | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | GCS | Art.Reg. | Egreso | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | $103.53 | $15.47 | $6.16 | $10.50 | $7.88 | $3.00 | $31.14 | $0.00 | $0.36 | $0.30 | $4.41 | **$182.76** |
| 2000 | $207.06 | $42.84 | $19.04 | $10.50 | $45.07 | $10.00 | $68.55 | $0.00 | $1.01 | $0.30 | $14.70 | **$419.08** |

---

## 7. Capacidad medida de la base — dimensionamiento de Cloud SQL (`SQL_TIERS_MEDIDOS`)

### 7.1 La prueba de carga (resumen de `docs/plan-experimento-puntos-gps.md` §8)

Postgres local (`postgis/postgis:16-3.4-alpine`, Docker, NVMe local), migraciones reales de `packages/db` (34 migraciones), RLS `FORCE`, `gps_points` precargada con ≥1M filas históricas antes de medir. Detalle completo, metodología y las corridas inválidas descartadas: `scripts/experimentos/gps/carga/resultados/resumen.md`.

| Perfil | Objetivo pts/s | Resultado | CPU |
| :--- | ---: | :--- | ---: |
| `c1` (1 vCPU / 3,75 GB) | 300 | PASA (p95 lote 12.0ms) | 9-20% |
| `c1` (1 vCPU / 3,75 GB) | 500 | PASA (p95 lote 11.1ms) | 14-33% |
| `c1` (1 vCPU / 3,75 GB) | 1000 | PASA (p95 lote 10.1ms) | 24-38% |
| `c1` (1 vCPU / 3,75 GB) | 2000 | PASA (p95 lote 6.9ms) | 37-66% |
| `c2` (2 vCPU / 7,5 GB (4 GB en la corrida v1, capado por RAM del host — ver §7.5)) | 1000 | PASA (p95 lote 10.7ms) | 24-36% |
| `c2` (2 vCPU / 7,5 GB (4 GB en la corrida v1, capado por RAM del host — ver §7.5)) | 2000 | PASA (p95 lote 7.3ms) | 37-53% |
| `c2` (2 vCPU / 7,5 GB (4 GB en la corrida v1, capado por RAM del host — ver §7.5)) | 3000 | PASA (p95 lote 5.4ms) | 48-81% |

CPU en el objetivo pts/s más alto que PASA de cada perfil (dato del propio archivo de resultado, no una cita): `c1` 37-66%, `c2` 48-81%.

- **Escritura sola (INSERT multi-fila real del worker):** el pico del modelo a 2.000 trufis (495.0 pts/s, escenario A) entra en `db-custom-1-3840`, cerca del borde (margen 1.0%, dentro de ±2%) — ver `elegirTierSql(495, SQL_TIERS_MEDIDOS)` en el test. Techo de diseño = 50% de lo medido que pasa (§3, regla 1).
- **Concurrencia del worker:** `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts` no fija `concurrency` ⇒ default de BullMQ = 1 (serializado). El mismo objetivo de 2.000 pts/s que FALLA en `c1` con concurrencia=1 PASA limpio con concurrencia=4 en el MISMO contenedor — la palanca de costo más barata antes de subir el tier de Cloud SQL (no aplicada en este documento: es cambio de código de producción, fuera de alcance de "solo medir").
- **Lectura — el dimensionador real ERA el mapa en vivo, no la escritura (ya corregido, PR #74):** ver §8 para el detalle completo y el estado post-fix — el N+1 medido acá (paso prerequisito de este documento) ya no es el estado actual del código, `gps_sesion_resumen` lo reemplaza.

### 7.2 Las tres reglas y por qué gana cada una (plan §9)

| Regla | Umbral/criterio | Fuente |
| :--- | :--- | :--- |
| 1. Escritura | 1 vCPU→500 pts/s · 2 vCPU→1.500 pts/s · 4 vCPU→3.000 pts/s (extrapolado) | plan §9.1, 50% de lo medido que PASA (§7.1) |
| 2. Memoria (working set) | RAM ≥ 4 × (índices de 2 días de la flota efectiva) | plan §9.2, 210.64 B de índice/fila medidos (ver más abajo) |
| 3. Piso de producción | db-custom-2-7680 desde 100 trufis efectivos | plan §9.3 |

**Tier elegido = el MAYOR de las tres (plan §9.4).** Por debajo de 100 trufis efectivos, el piso no aplica y el modelo delega en `SQL_TIERS` (la tabla de agosto) — este dimensionamiento medido no inventa un tier chico sin evidencia a esa escala (columna "Regla" = `agosto-fallback` en §4/§5).

**Decisión propia (no está en la letra del plan §9.2, que no distingue `n` de `nEfectivo`):** la "flota" de la regla de memoria se resuelve como `nEfectivo` (no la flota nominal `n`) — es la misma cantidad que el resto del modelo ya usa para "cuántos trufis generan carga en un día dado" bajo el escenario elegido, y el escenario C define su factor de concurrencia explícitamente como fracción de la flota que opera CADA DÍA, que es la pregunta que el working set de "hoy" necesita responder.

### 7.3 Bytes de índice por fila — medición

**210.64 B/fila** — `pg_indexes_size` sumado sobre la tabla padre + todas las particiones de `gps_points`, dividido por filas totales, con `ANALYZE` corrido antes de medir. Postgres local (mismo entorno que §7.1), migraciones reales, ≥1M filas precargadas. Detalle completo (por partición, heap vs. índices): `scripts/experimentos/gps/carga/resultados/tamanos-indice.json`.

### 7.4 Tabla de tiers (`SQL_TIERS_MEDIDOS`)

| Tier | vCPU | RAM | Techo de escritura (pts/s) | ¿Extrapolado? |
| :--- | ---: | ---: | ---: | :--- |
| `db-custom-1-3840` | 1 | 3.75 GiB | 500 | no |
| `db-custom-2-7680` | 2 | 7.5 GiB | 1500 | no |
| `db-custom-4-15360` | 4 | 15 GiB | 3000 | sí |
| `db-custom-8-30720` | 8 | 30 GiB | 6000 | sí |
| `db-custom-16-61440` | 16 | 60 GiB | 12000 | sí |
| `db-custom-32-122880` | 32 | 120 GiB | 24000 | sí |
| `db-custom-64-245760` | 64 | 240 GiB | ∞ | sí |

### 7.5 Límites de esta prueba de carga (plan §8, no se presentan como más firmes de lo que son)

- **Disco NVMe local ≠ PD-SSD de Cloud SQL.** Sin el modelo de IOPS provisionadas ni la latencia de red VPC de Cloud SQL real — la prueba acota, no reemplaza, una confirmación en una instancia Cloud SQL real.
- **7 días de datos precargados, no 6 meses.** Sin bloat de largo plazo, sin fragmentación de meses de autovacuum.
- **Perfiles `c4` (4 vCPU/15 GB) y `c8` (8 vCPU/30 GB) NO se corrieron** — RAM del host de la prueba (13 GiB total) no alcanza para esos perfiles. El techo de escritura de 4 vCPU en `SQL_TIERS_MEDIDOS` (3.000 pts/s) es EXTRAPOLADO, no medido.
- **`c2` corrió con memoria capada a 4 GB** en vez del nominal 7,5 GB, por RAM insuficiente del host — desviación declarada, no un default silencioso (`QUIVO_CARGA_MEM` en `levantar.sh`).
- **1 pt/s por trufi** es un supuesto del generador de carga, no medido contra datos reales de producción.
- **Confirmación en una instancia Cloud SQL real temporal:** hecha el 2026-09-22 (`db-custom-1-3840`, instancia temporal `quivo-carga-temp`, borrada al cerrar) — plan §10, resultados en `scripts/experimentos/gps/carga/resultados/resumen.md` §9. Con concurrencia de cliente suficiente (40, compensando el RTT de red que limitaba concurrencias menores), 1 vCPU sostuvo 2.000 pts/s al 100% del objetivo, backlog ~0, 0 filas perdidas, con CPU de la instancia entre 31-50% (máx. 49,6%) y memoria 58-65% (Cloud Monitoring, `metricas.sh`). La evidencia medida muestra que 1 vCPU sostiene ≥2.000 pts/s a ≤50% de CPU — el `ptsSMax=500` de `db-custom-1-3840` en `SQL_TIERS_MEDIDOS` (§7.4) queda conservador a propósito: se mantiene así porque la escritura no es la regla que decide el tier a esta escala (§7.2, la regla ganadora es RAM/piso). El perfil `remoto-c2` (2 vCPU) se descartó a propósito: 1 vCPU ya sostiene el pico de 2000 conductores con margen, y el tier a 600/2000 lo decide la regla de RAM/working-set y el piso de producción (§9.2/§9.3 del plan), no la capacidad de escritura — por eso las cifras en dólares de este documento no cambian.

### 7.6 Sensibilidad del multiplicador de RAM (3×/4×/5×) — hallazgo 2 de revisión (2026-09-22)

El multiplicador de RAM (`RAM_MULTIPLICADOR_WORKING_SET = 4`, §7.2 regla 2) es una heurística DECLARADA, no medida contra un working set real de Postgres (§7.1 sí mide el techo de escritura con la prueba de carga; esto no). `ramRequeridaWorkingSetGiB`/`elegirTierSqlMedido` aceptan el multiplicador como parámetro — la tabla de abajo recorre 3×, 4×, 5× programáticamente (`calcularEscalon(..., { ramMultiplicadorWorkingSet })`) para 600 y 2000 conductores, ambas cadencias de captura (15 m y 30 m) y ambas arquitecturas, en vez de afirmar en prosa si el tier cambia.

| n | Cadencia | Arquitectura | Multiplicador | Tier | Regla | Total/mes |  |
| ---: | :--- | :--- | ---: | :--- | :--- | ---: | :--- |
| 600 | 15 m | Actual | 3× | `db-custom-2-7680` | ram+piso | $436.53 |  |
| 600 | 15 m | Actual | 4× | `db-custom-2-7680` | ram+piso | $436.53 |  |
| 600 | 15 m | Actual | 5× | `db-custom-2-7680` | ram+piso | $436.53 | ← tier estable en este grupo |
| 600 | 15 m | Optimizada | 3× | `db-custom-2-7680` | ram+piso | $205.03 |  |
| 600 | 15 m | Optimizada | 4× | `db-custom-2-7680` | ram+piso | $205.03 |  |
| 600 | 15 m | Optimizada | 5× | `db-custom-2-7680` | ram+piso | $205.03 | ← tier estable en este grupo |
| 600 | 30 m | Actual | 3× | `db-custom-2-7680` | piso | $397.03 |  |
| 600 | 30 m | Actual | 4× | `db-custom-2-7680` | piso | $397.03 |  |
| 600 | 30 m | Actual | 5× | `db-custom-2-7680` | piso | $397.03 | ← tier estable en este grupo |
| 600 | 30 m | Optimizada | 3× | `db-custom-2-7680` | piso | $182.76 |  |
| 600 | 30 m | Optimizada | 4× | `db-custom-2-7680` | piso | $182.76 |  |
| 600 | 30 m | Optimizada | 5× | `db-custom-2-7680` | piso | $182.76 | ← tier estable en este grupo |
| 2000 | 15 m | Actual | 3× | `db-custom-4-15360` * | ram | $994.06 |  |
| 2000 | 15 m | Actual | 4× | `db-custom-8-30720` * | ram | $1270.15 |  |
| 2000 | 15 m | Actual | 5× | `db-custom-8-30720` * | ram | $1270.15 | ← tier CAMBIA en este grupo |
| 2000 | 15 m | Optimizada | 3× | `db-custom-4-15360` * | ram | $496.28 |  |
| 2000 | 15 m | Optimizada | 4× | `db-custom-8-30720` * | ram | $703.35 |  |
| 2000 | 15 m | Optimizada | 5× | `db-custom-8-30720` * | ram | $703.35 | ← tier CAMBIA en este grupo |
| 2000 | 30 m | Actual | 3× | `db-custom-2-7680` | ram+piso | $720.29 |  |
| 2000 | 30 m | Actual | 4× | `db-custom-4-15360` * | ram | $858.33 |  |
| 2000 | 30 m | Actual | 5× | `db-custom-4-15360` * | ram | $858.33 | ← tier CAMBIA en este grupo |
| 2000 | 30 m | Optimizada | 3× | `db-custom-2-7680` | ram+piso | $315.54 |  |
| 2000 | 30 m | Optimizada | 4× | `db-custom-4-15360` * | ram | $419.08 |  |
| 2000 | 30 m | Optimizada | 5× | `db-custom-4-15360` * | ram | $419.08 | ← tier CAMBIA en este grupo |

\* Tier extrapolado (§7.1/§7.5: capacidades de 4 vCPU o más sin prueba de carga real — el multiplicador de RAM, al empujar hacia esos tiers, empuja hacia territorio no probado con más frecuencia que la regla de escritura sola).

---

## 8. Prerequisito: N+1 del mapa en vivo (`listarHoy`/`obtenerPosiciones`) — RESUELTO

**Estado (hallazgo 4 de revisión, 2026-09-22): DONE.** El N+1 que motivó esta sección quedó corregido en `perf/en-vivo-resumen-sesion` (PR #74, mergeado a `main`, `docs/handoff.md`) con la tabla nueva `gps_sesion_resumen` — el worker la mantiene en el MISMO statement que inserta `gps_points` (CTE `INSERT ... RETURNING` + upsert, ver `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts`, función `insertarGpsPoints`), y `listarHoy`/`obtenerPosiciones` (`apps/api/src/modules/reportes/en-vivo.service.ts`) leen `gps_sesion_resumen` en vez de agregar `gps_points` por sesión — el costo pasa de O(puntos del día de la flota) a O(sesiones visibles).

**Medición local (EXPLAIN ANALYZE, 1.000 sesiones / 6,7 M filas, `docs/handoff.md`):** `listarHoy` **53 s → 62 ms**, `obtenerPosiciones` **53 s → 72 ms**. El objetivo de <50 ms no se alcanzó — el resto del costo es el join de sesiones/vehículos/rutas, fuera de este cambio. Estas cifras SON las que `scripts/experimentos/gps/carga/resultados/resumen.md` reportaba como el problema (ahí con otra base precargada, ~10 s en vez de 53 s — mismo patrón N+1, volumen de datos distinto).

`listarHoy` lo consume la web cada 30 s por pestaña abierta (`apps/web/src/lib/en-vivo/use-en-vivo.ts:34`, `refetchInterval: 30_000`). `obtenerPosiciones` sigue sin consumidor en `apps/web` (`grep -rn "obtenerPosiciones" apps/` solo encuentra el service y el controller) — es un riesgo latente resuelto por adelantado, no un costo actual, hasta que algo lo conecte a un mapa de flota.

**Paso manual obligatorio tras el deploy a producción (`docs/runbooks/retencion-gps.md`, sección "`gps_sesion_resumen` — recompute obligatorio"):** correr UNA VEZ el recompute completo desde `gps_points` cuando el worker nuevo (el que escribe `gps_sesion_resumen`) esté vivo — cubre los puntos que ingirieron instancias del worker VIEJO entre que corrió el backfill de la migración y que terminó el rollout. Sin este paso, el resumen de esa ventana de gap queda desactualizado hasta que el próximo lote de cada dispositivo lo "arrastre" al valor correcto (puede tardar minutos u horas, y una sesión ya terminada puede quedar corta para siempre).

Este documento (§4-§7) YA asume el fix aplicado — `SQL_TIERS_MEDIDOS` y las cifras de escritura de §7 son sobre la escritura pura del worker, que sigue siendo el mismo costo con o sin este fix (el CTE agrega el upsert a `gps_sesion_resumen` al mismo INSERT, no una segunda escritura — ver `generador.mjs` del harness, que replica esa SQL completa desde el hallazgo 5 de revisión).

---

## 9. Dimensionamiento anterior (descartado) — referencia histórica

**Este dimensionamiento quedó DESCARTADO el 2026-09-22** al recalibrar con la prueba de carga real (§7): usaba `SQL_TIERS` (criterio de agosto, escritura pico SIN medición de capacidad) también para la proyección con supuestos MEDIDOS — el mismo código que hoy solo sobrevive para el test de regresión contra agosto. Se reproduce acá con `calcularEscalon(..., { forzarTierAgosto: true })` (mismo módulo, nada escrito a mano) para dejar la comparación citable.

| Arquitectura | Conductores | Tier (SQL_TIERS, agosto) | Total/mes (descartado) |
| :--- | ---: | :--- | ---: |
| Actual | 600 | `db-custom-16-61440` (extrapolado) | $1402.83 |
| Actual | 2000 | `db-custom-32-122880` (extrapolado) | $2926.66–$5135.35 † |
| Optimizada | 600 | `db-custom-16-61440` (extrapolado) | $929.76 |
| Optimizada | 2000 | `db-custom-32-122880` (extrapolado) | $1945.74–$3602.25 † |

Estas son las cifras que este documento publicó antes de la recalibración (arquitectura actual: 600 → US$1402.83 / 2000 → US$2926.66–US$5135.35 — mismos números de la tabla de arriba, citados también en `docs/plan-experimento-puntos-gps.md` §7). La diferencia frente a §1/§4 es el hallazgo del paso B del experimento (plan §8): la escritura sola no necesita ese tier — el pico de 2000 conductores (495.0 pts/s) entra en `db-custom-1-3840`, cerca del borde (margen 1.0%, dentro de ±2%). `SQL_TIERS` estaba sobredimensionado por no tener una prueba de carga real detrás.

---

## 10. Sensibilidad — edge cases (plan-costos-2000 §4.3, n=600, escenario A, arquitectura actual, captura 15 m)

| Variante | Total/mes | Δ vs. base |
| :--- | ---: | ---: |
| Base (6 vueltas, jornada derivada, bytes medidos, sin HA, Santiago) | $436.53 | — |
| Vueltas diarias: 3 (piso) | $327.76 | -24.9% |
| Jornada operativa: 14 h (en vez de 10 h) | $633.41 | +45.1% |
| Ancho de fila con bloat: 350 B (por debajo de los 365.6 B medidos) | $434.78 | -0.4% |
| Ancho de fila con bloat: 480 B (por encima de los 365.6 B medidos) | $459.28 | +5.2% |
| Alta disponibilidad regional en Cloud SQL: sí | $648.70 | +48.6% |

Nota: los edge cases de "3 vueltas" y "jornada 14h" no son independientes — el modelo deriva la jornada de las vueltas diarias salvo que se fuerce explícitamente (`jornadaHoras` distinto de `null` en `EDGE_CASES_DEFAULT`), por eso se muestran por separado. Los dos casos de ancho de fila (350 B y 480 B) acotan el riesgo real: §12 advierte que los 365,6 B medidos vienen de una muestra chica sin `VACUUM FULL` ni `ANALYZE`, así que el número real en régimen puede ser MAYOR, no solo menor.

**Nota sobre región (eliminada de esta tabla):** una versión anterior de este modelo incluía un edge case `region: us-central1` que aplicaba los descuentos citados de §6 (×0,6 Cloud SQL cómputo, ×0,8 Cloud Run) pero NO tocaba disco/backup de Cloud SQL, Redis ni el VPC connector (nunca recibían el parámetro), y encima multiplicaba el egreso ×0,9 con un factor inventado sin cita. Ese híbrido subestimaba el ahorro real (PD-SSD y Memorystore SÍ son más baratos en us-central1) y a la vez inventaba un número donde no había fuente. Se eliminó el edge case completo: inventar el resto de los factores para "completarlo" es peor que no tener la fila. Reintroducirlo requiere relevar precios de us-central1 con `gcloud`/lista de precios para cada línea, no solo para cómputo.

---

## 11. Qué partes del documento de agosto NO son reproducibles

`costos-gcp-por-escala.md` publicó totales y desgloses por servicio, pero no la fórmula interna que los genera. Reconstruir esa fórmula (obligatorio para extender la tabla a 2000, que agosto no cubre) expone tres puntos donde el documento de agosto no es reproducible con un modelo de parámetros explícitos:

### 11.0 Residuo de TOTAL — los 18 puntos de referencia completos

| Arquitectura | Conductores | Modelo | Doc. agosto | Diferencia (%) |
| :--- | ---: | ---: | ---: | ---: |
| Actual | 10 | $157.60 | $158.90 | -0.8% |
| Actual | 25 | $159.51 | $163.32 | -2.3% |
| Actual | 50 | $161.72 | $169.90 | -4.8% |
| Actual | 100 | $200.07 | $216.23 | -7.5% |
| Actual | 200 | $283.91 | $301.54 | -5.8% |
| Actual | 300 | $300.91 | $309.92 | -2.9% |
| Actual | 400 | $454.21 | $455.17 | -0.2% |
| Actual | 500 | $506.87 | $500.35 | +1.3% |
| Actual | 600 | $523.88 | $508.75 | +3.0% |
| Optimizada | 10 | $80.26 | $81.15 | -1.1% |
| Optimizada | 25 | $82.21 | $81.56 | +0.8% |
| Optimizada | 50 | $82.49 | $84.71 | -2.6% |
| Optimizada | 100 | $100.82 | $105.83 | -4.7% |
| Optimizada | 200 | $155.66 | $166.66 | -6.6% |
| Optimizada | 300 | $159.04 | $176.15 | -9.7% |
| Optimizada | 400 | $267.77 | $289.26 | -7.4% |
| Optimizada | 500 | $273.13 | $298.73 | -8.6% |
| Optimizada | 600 | $280.25 | $309.54 | -9.5% |

De 18 puntos, 11 caen dentro de ±5% en el TOTAL (el criterio objetivo del plan §13.4) y 18 dentro de ±15% (la falla dura del test de regresión). El error en el TOTAL es menor que el error en la columna "API" sola (§11.1) porque el resto de las líneas — Cloud SQL, Redis, worker, VPC/GCS, Artifact Registry, egreso — sí se reproducen dentro de tolerancia y son la mayor parte de la factura. Nota: este residuo se calcula SIEMPRE contra `SQL_TIERS` (agosto) — es el test de regresión, no cambia con la recalibración de §7.

### 11.1 La columna "API" no es reproducible con un parámetro global

| Arquitectura | Conductores | Modelo | Doc. agosto | Diferencia (USD) | Diferencia (%) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Actual | 10 | $18.40 | $18.69 | -$0.29 | -1.6% |
| Actual | 25 | $18.40 | $21.50 | -$3.10 | -14.4% |
| Actual | 50 | $18.57 | $26.30 | -$7.73 | -29.4% |
| Actual | 100 | $21.36 | $36.89 | -$15.53 | -42.1% |
| Actual | 200 | $31.56 | $48.20 | -$16.64 | -34.5% |
| Actual | 300 | $42.20 | $50.22 | -$8.02 | -16.0% |
| Actual | 400 | $52.83 | $52.24 | $0.59 | +1.1% |
| Actual | 500 | $63.47 | $54.26 | $9.21 | +17.0% |
| Actual | 600 | $74.10 | $56.29 | $17.81 | +31.6% |
| Optimizada | 10 | $0.00 | $0.00 | $0.00 | +0.0% |
| Optimizada | 25 | $0.00 | $0.11 | -$0.11 | -100.0% |
| Optimizada | 50 | $0.00 | $1.53 | -$1.53 | -100.0% |
| Optimizada | 100 | $0.00 | $4.45 | -$4.45 | -100.0% |
| Optimizada | 200 | $0.17 | $10.53 | -$10.36 | -98.4% |
| Optimizada | 300 | $0.66 | $16.89 | -$16.23 | -96.1% |
| Optimizada | 400 | $2.97 | $23.26 | -$20.29 | -87.2% |
| Optimizada | 500 | $5.42 | $29.59 | -$24.17 | -81.7% |
| Optimizada | 600 | $7.88 | $35.95 | -$28.07 | -78.1% |

De 18 puntos de referencia, 3 caen dentro de ±5% con un único parámetro calibrado por mínimos cuadrados (`CPU_SEG_POR_REQUEST_API = 0.048119`). El peor caso es optimizada con 25 conductores: modelo $0.00 contra $0.11 publicado (-100.0%).

**Por qué no cierra:** si el costo activo de API dependiera solo de `requests × constante`, la arquitectura "actual" (ciclo de sync 15s) debería costar ~4× lo que la "optimizada" (ciclo 60s) al mismo n, porque genera 4× más requests. Los números publicados NO muestran esa proporción — a 600 conductores el costo activo real (columna "API" de agosto, ya sin el idle en el caso "actual") es prácticamente el mismo entre arquitecturas ($37.89 actual vs $35.95 optimizada). Eso implica que la columna "API" de agosto agrega algo más que `requests × vCPU-s/request` — probablemente un componente fijo o un supuesto de CPU boost/cold start no documentado en el propio §4-§6 del documento de agosto. **No se puede reproducir con un modelo de un solo parámetro porque el documento de origen no publicó la fórmula completa, solo el resultado.**

### 11.2 El crecimiento de disco por conductor de agosto no se reproduce desde el DDL

Documentado ya en el propio código del modelo (`SUPUESTOS_AGOSTO.crecimientoGiBPorConductor`, `scripts/costos/modelo-costos.mjs`): reproducir `bytesPorPunto × puntos/día × días × meses` desde cero con los supuestos citados de agosto (240 B, 2500 pts/día, 26 días, 6 meses) da ~89.3 MiB, no los 121.7 MB que agosto publicó ("121,7 MB por conductor", §3.4 del doc de agosto). El documento de agosto nunca mostró la fórmula completa detrás de esa cifra — probablemente incluye overhead de bloat/fill-factor no desglosado. Este modelo usa el valor publicado tal cual (citado, no derivado) para no perder la reproducción del caso base.

### 11.3 El dimensionamiento de Cloud SQL y de `quivo-worker` son tablas, no fórmulas

Agosto documentó saltos de tier y de instancias de worker como resultado ("100 conductores → `db-custom-1-3840`"), no como una fórmula derivable de primeros principios. El chairman confirmó esto en el plan-costos-2000 §13.1/§13.2: no hay una ecuación que reproduzca los saltos sin fijar constantes de calibración (el factor pico/promedio de 1,485, el umbral de requests/día de los workers). Ambos quedan modelados como tablas explícitas en `modelo-costos.mjs` (`SQL_TIERS`, `UMBRALES_INSTANCIAS_WORKER_REQ_DIA`), no como fórmulas de un parámetro. El mismo criterio se repite en `SQL_TIERS_MEDIDOS` (§7): tabla explícita, no fórmula, esta vez calibrada contra una prueba de carga real en vez de contra un documento publicado sin desglosar.

---

## 12. Límites de la medición de carga de producción (plan-costos-2000 §12.4)

Los supuestos MEDIDOS que arman las tablas de §4-§6 vienen de una sola medición contra `quivo-control-prod`, ejecutada el 2026-09-20 — DISTINTA de la prueba de carga local de Postgres de §7 (esa es del 22 de septiembre, no contra Cloud SQL). **Este documento no puede presentar esos números como más firmes de lo que son:**

- **n = 1 en la métrica que más pesa.** De 8 sesiones registradas, solo UNA (6000 puntos extrapolados desde una jornada de 8,7 h) es una jornada real completa. Las otras siete van de 2 a 625 puntos: pruebas, no operación. La misma sesión es la fuente de `SUPUESTOS_MEDIDOS_30M` (§5, plan §7).
- **Dos días de datos:** 2026-09-09 y 2026-09-10. Nada más.
- **La base no recibe datos desde el 2026-09-11** (piloto detenido). No hay forma de saber si esa jornada es representativa de la operación en régimen.
- **No hay comparación pre/post en la misma base.** El proyecto GCP se recreó el 2026-09-08; los datos del período anterior (81-103 m entre puntos) vienen del proyecto borrado, no de esta base.
- **Los 365.6 B/punto** se midieron sobre una muestra chica de filas, sin `VACUUM FULL` ni estado estable, y `reltuples` devolvió `-1` en casi todas las particiones (nunca corrió `ANALYZE`). El número en régimen puede diferir. (Distinto del `BYTES_INDICE_POR_FILA_MEDIDO` de §7.3, que SÍ corrió `ANALYZE` antes de medir, sobre datos sintéticos de la prueba de carga, no de prod.)

**Consecuencia directa para las cifras de §4-§6:** son la mejor proyección disponible hoy, no una facturación observada ni una medición en régimen. El piloto múltiple de usuarios (ClickUp `86e329ub0`) o una corrida de `tests/load/k6/` contra `quivo-control-prod` son las dos vías para reemplazar esta proyección por datos reales.

---

## 13. Supuestos tomados por cuenta propia en esta implementación

- **Escenario C (factor de concurrencia 0.35):** el plan-costos-2000 §4.2 deja este factor explícitamente "a derivar", sin dato de utilización diaria real de la flota. Se tomó 0,35 como supuesto de producto (fracción de actividad diaria típica en flotas rotativas con turnos), NO VERIFICADO.
- **Extrapolación de tiers de Cloud SQL más allá de 600 conductores (`SQL_TIERS`, histórico):** duplicar vCPU/RAM cada vez que se duplica el techo de pts/s, siguiendo el mismo patrón que agosto usó hasta 600. Sin prueba de carga que confirme que un solo nodo sostiene esa capacidad.
- **Extrapolación de `SQL_TIERS_MEDIDOS` más allá de 4 vCPU (§7):** mismo patrón de duplicación del techo de escritura (3.000 → 6.000 → 12.000 → 24.000 pts/s), sin evidencia — los perfiles `c4`/`c8` no corrieron en la prueba de carga (RAM del host). Con los escalones de este documento (hasta 2000 conductores) esta extrapolación no llega a pesar: la regla de escritura nunca gana por encima de 600 trufis efectivos en ninguno de los escenarios/arquitecturas calculados — gana RAM o el piso.
- **"Flota" de la regla de memoria = `nEfectivo`, no `n` nominal (§7.2):** el plan §9.2 no distingue las dos cantidades. Se tomó `nEfectivo` por consistencia con el resto del modelo (API, worker, escritura pico ya usan `nEfectivo` como "carga de un día dado bajo el escenario elegido").
- **`forzarTierAgosto` (opción nueva de `calcularEscalon`):** mecanismo para reproducir en §9 el dimensionamiento histórico sin duplicar la fórmula de costo a mano — reutiliza el mismo módulo, no escribe las cifras de §9 a mano.
- **Extrapolación de umbrales de `quivo-worker` más allá de 600 conductores:** duplicar el umbral de requests/día en cada salto de instancia, anclado en el salto real de agosto (400→500 conductores).
- **Calibración de `CPU_SEG_POR_REQUEST_API` por mínimos cuadrados en USD** (no en % relativo) sobre los 18 puntos de referencia. Se probó también minimizar el error relativo (%) — comparación real, no una afirmación sin verificar: mínimos cuadrados en USD da `c = 0.048119` con un error absoluto total de $184.14 sobre los 18 puntos; minimizar el error relativo da `c = 0.056837` con un error absoluto total de $192.00 — 4.3% PEOR en USD, no mejor. Ambos métodos dejan una parte de la columna "API" sin reproducir (§11.1); se optó por mínimos cuadrados en USD porque además de ganar en error absoluto total, es el criterio estándar y no se distorsiona por los escalones de "optimizada" con costo publicado cercano a cero (donde el error relativo queda indefinido y se excluye de esa suma, sesgando ese criterio hacia los escalones de "actual").
- **Tolerancia del test de regresión:** ±5% como objetivo (informativo), ±15% como falla dura, sobre los 18 puntos de referencia de agosto (9 escalones × 2 arquitecturas) — no solo los 4 escalones (10/100/300/600) que cubría el intento anterior. Plan-costos-2000 §13.4. Este test sigue usando `SQL_TIERS` (agosto) exclusivamente, sin tocar — la recalibración de §7 no lo afecta.
- **Escenario "optimizada" en la proyección a 2000 asume que las seis palancas de agosto SÍ están aplicadas** (ciclo de sync 60s, min-instances=0, Redis propio, etc.), aunque el plan-costos-2000 §9.3 confirma que ninguna lo está hoy en `quivo-control-prod`. Es un objetivo, no el estado real — se marca explícitamente en este párrafo porque no hay otro lugar natural en las tablas de arriba para esa advertencia.
- **Desglose por servicio (§6) para las dos cadencias (15 m y 30 m):** el encargo lo pedía junto a la escalera de ambas cadencias en la misma frase; se interpretó como "ambas", no solo la de 15 m.

---

_Generado automáticamente por `scripts/costos/generar-tablas.mjs` a partir de `scripts/costos/modelo-costos.mjs`. Base de horas: 730 h/mes. Para reproducir: `node scripts/costos/generar-tablas.mjs > docs/costos-gcp-2000.md`._
