# Proyección de costos GCP — 10 a 2000 conductores

**Fecha de generación:** 2026-09-20 (script `scripts/costos/generar-tablas.mjs`, salida no editada a mano)
**Autor:** Tecnología / CTO
**Proyecto GCP:** `quivo-control-prod` · **Región:** `southamerica-west1` (Santiago, Tier 2 de GCP)
**Fuente del modelo:** `scripts/costos/modelo-costos.mjs` — extiende `docs/costos-gcp-por-escala.md` (2026-08-26) a 2000 conductores, recalibrado con la medición real de `docs/plan-costos-2000.md` §12 (2026-09-20).

> **Este documento NO reemplaza `docs/costos-gcp-por-escala.md`.** Ese archivo es registro histórico y no se modifica. Este documento es la extensión pedida (ClickUp `86e34jkb2`) más la reconciliación con `documento-tecnico-cto.md` §10.

---

## 1. Resumen ejecutivo

Con los supuestos de carga MEDIDOS el 2026-09-20 (plan §12) y el escenario A (2000 transmitiendo a la vez — la definición más exigente de "2000 trufis"):

| Conductores | Arquitectura actual | Arquitectura optimizada | Tier Cloud SQL (actual) | ¿Supera el techo probado por k6 (300 pts/s)? |
| ---: | ---: | ---: | :--- | :--- |
| 600 | US$1402.83/mes | US$929.76/mes | `db-custom-16-61440` (extrapolado) | no |
| 2000 | US$2926.66/mes | US$1945.74/mes | `db-custom-32-122880` (extrapolado) | sí (495 pts/s) |

El costo por conductor a 2000 (arquitectura optimizada) es US$0.97/mes — sigue bajando respecto a los US$1.55/mes de 600 conductores, porque la base fija (Redis, worker, VPC/GCS, Artifact Registry) se sigue repartiendo entre más conductores. **El hallazgo estructural de agosto sigue vigente: el costo no escala con la flota, escala con el dimensionamiento de Cloud SQL, y ese dimensionamiento es la única parte del modelo con criterio de ingeniería, no aritmética.**

A 495 puntos/s pico (escenario A, 2000 conductores), la arquitectura supera 1.6× el techo de 300 pts/s que cubre el único test de carga real del repo (`tests/load/k6/`, plan §9.5). Los tiers de Cloud SQL usados por encima de 600 conductores (`db-custom-8-30720`, `db-custom-16-61440`, `db-custom-32-122880`, `db-custom-64-245760`) son EXTRAPOLACIONES de precio, no capacidad probada.

---

## 2. Reconciliación con `documento-tecnico-cto.md` §10

`documento-tecnico-cto.md` §10 (2026-07-19) proyectó **US$1.200–2.800/mes para 3000 vehículos**. Ese rango es anterior al relevamiento real con `gcloud` (2026-08-26) y a la medición de carga real (2026-09-20): es una estimación de arquitectura, no de infraestructura desplegada y medida.

| Fuente | Cifra | Escala | Fecha |
| :--- | :--- | :--- | :--- |
| `documento-tecnico-cto.md` §10 | US$1.200 – 2.800/mes | 3000 vehículos | 2026-07-19 |
| `costos-gcp-por-escala.md` | $508.75 actual / $309.54 optimizada | 600 conductores | 2026-08-26 |
| Este documento (medido, escenario A) | US$2926.66 actual / US$1945.74 optimizada | 2000 conductores | 2026-09-20 |

**La diferencia es real y se explica en tres capas, no en una:**

1. **El rango de julio era arquitectura, no infraestructura desplegada.** No hubo relevamiento con `gcloud` ni precios de lista aplicados — es una estimación previa, del mismo tipo que el ADR 0002 (que estimaba ~$255-290/mes asumiendo una base de datos de 2 vCPU/8 GB que nunca se creó, corregida en `costos-gcp-por-escala.md`).
2. **3000 ≠ 2000.** Este documento no extrapola hasta 3000 (fuera del encargo de la tarea ClickUp `86e34jkb2`, que pide hasta 2000). El rango de julio pesa sobre 1000 vehículos más.
3. **El régimen de costo no es lineal con la flota** (§1, hallazgo de agosto que sigue vigente): a 2000 conductores la base fija (Redis, worker, VPC/GCS, Artifact Registry) sigue siendo una fracción chica del total, y el grueso es Cloud SQL dimensionado por PICO de escritura, no por cantidad de vehículos per se.

**Conclusión para finanzas:** el rango de julio (US$1.200–2.800 para 3000) y el número medido de este documento para 2000 (US$2926.66 actual / US$1945.74 optimizada) NO son directamente comparables — son estimaciones de dos momentos distintos del proyecto, con dos niveles de evidencia distintos. El número de este documento tiene evidencia real detrás (precios de lista + una medición de carga real, aunque limitada — ver §8). El de julio es una proyección de arquitectura sin verificar contra infraestructura desplegada. **Se recomienda a finanzas usar el número de este documento y descartar el rango de julio para 2000-3000 vehículos.**

---

## 3. Metodología (resumen)

- **Factor pico/promedio de Cloud SQL:** `FACTOR_PICO_SOBRE_PROMEDIO = 1.485` (plan §13.1). El promedio de la jornada (n × puntos/día ÷ jornada en segundos) NO es el pico de escritura que dimensiona el tier de Cloud SQL; agosto dimensionó contra el pico sin escribir la fórmula. Se aplica antes de elegir tier, nunca para el resto de los servicios.
- **Tiers de Cloud SQL:** tabla explícita (no fórmula), calibrada contra los saltos de tier que agosto documentó en 50, 100, 300 y 600 conductores. Los tiers por encima de 600 (`db-custom-8-30720`, `db-custom-16-61440`, `db-custom-32-122880`, `db-custom-64-245760`) son EXTRAPOLACIÓN explícita: duplican vCPU/RAM cada vez que se duplica el techo de pts/s, sin evidencia de que un solo nodo lo sostenga.
- **Instancias de `quivo-worker`:** tabla explícita de umbrales en requests/día (no una fórmula de conductores), anclada en el punto medio entre lo que generan 400 y 500 conductores bajo el ciclo de sync de 15s de agosto (450 conductores × tasa de agosto). Reproduce "1 worker hasta 400, 2 desde 500" (agosto §5) y se extiende a 800-2000 duplicando el mismo umbral, documentado como extrapolación (plan §13.2).
- **Costo de `quivo-api`:** el componente de CPU activa por request (`cpuSegPorRequestApi`) se calibra por MEJOR AJUSTE de mínimos cuadrados (error en USD) contra los **18 puntos de referencia** publicados en agosto (9 escalones × 2 arquitecturas), no contra un solo escalón (plan §13.3). El valor resultante es `CPU_SEG_POR_REQUEST_API = 0.048119` vCPU-s/request. **Este parámetro no reproduce bien toda la columna "API" de agosto** — ver §7 para la tabla de residuos completa y por qué.
- **Supuestos de carga:** dos juegos, citados de fuentes distintas. "Agosto" (`SUPUESTOS_AGOSTO`, 240 B/punto, 2500 pts/conductor/día) se usa SOLO para el test de regresión contra el documento de agosto. "Medidos" (`SUPUESTOS_MEDIDOS`, 365.6 B/punto, 6000 pts/conductor/día) son los que arma la proyección a 2000 de este documento — plan §12, medición real 2026-09-20 contra `quivo-control-prod`.

---

## 4. Escalones 10 → 2000 conductores (supuestos MEDIDOS 2026-09-20)

Tres escenarios de qué significa "2000 trufis" (plan §4.2/§10 — el CTO pidió modelarlos todos en vez de elegir uno):

- **A · pico concurrente** — 2000 transmitiendo a la vez (el escalón "n" ES el pico concurrente). (factor de concurrencia 1). docs/plan-costos-2000.md §4.2 (~207 pts/s a 2000, consistente con factor 1)
- **B · padrón con 60% activo** — "n" es la flota registrada; ~60% está activa/transmitiendo en el pico. (factor de concurrencia 0.6). docs/plan-costos-2000.md §4.2 ("2000 registrados, ~1200 en pico")
- **C · activos/mes, pico menor** — "n" son conductores distintos activos en el mes; el pico diario es menor porque no todos operan el mismo día (patrón típico de flotas de transporte compartido con turnos). (factor de concurrencia 0.35). docs/plan-costos-2000.md §4.2 (factor marcado "a derivar" en el plan) — NO VERIFICADO, supuesto de producto sin medición de respaldo.

### 4.1 Escenario A · pico concurrente

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | ¿Supera 300 pts/s? | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 10 | `db-g1-small` | 2.5 | no | 10 GiB | $157.68 | $15.77 |
| 25 | 25 | `db-custom-1-3840` | 6.2 | no | 20 GiB | $194.73 | $7.79 |
| 50 | 50 | `db-custom-2-7680` | 12.4 | no | 30 GiB | $267.92 | $5.36 |
| 100 | 100 | `db-custom-2-7680` | 24.8 | no | 45 GiB | $276.96 | $2.77 |
| 200 | 200 | `db-custom-4-15360` | 49.5 | no | 80 GiB | $439.43 | $2.20 |
| 300 | 300 | `db-custom-8-30720` * | 74.3 | no | 115 GiB | $740.39 | $2.47 |
| 400 | 400 | `db-custom-8-30720` * | 99.0 | no | 150 GiB | $765.26 | $1.91 |
| 500 | 500 | `db-custom-8-30720` * | 123.8 | no | 185 GiB | $827.54 | $1.66 |
| 600 | 600 | `db-custom-16-61440` * | 148.5 | no | 215 GiB | $1402.83 | $2.34 |
| 800 | 800 | `db-custom-16-61440` * | 198.0 | no | 285 GiB | $1452.57 | $1.82 |
| 1000 | 1000 | `db-custom-16-61440` * | 247.5 | no | 355 GiB | $1539.71 | $1.54 |
| 1200 | 1200 | `db-custom-32-122880` * | 297.0 | no | 420 GiB | $2692.05 | $2.24 |
| 1500 | 1500 | `db-custom-32-122880` * | 371.3 | sí | 525 GiB | $2766.66 | $1.84 |
| 1750 | 1750 | `db-custom-32-122880` * | 433.1 | sí | 610 GiB | $2827.96 | $1.62 |
| 2000 | 2000 | `db-custom-32-122880` * | 495.0 | sí | 695 GiB | $2926.66 | $1.46 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | ¿Supera 300 pts/s? | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 10 | `db-g1-small` | 2.5 | no | 10 GiB | $80.35 | $8.03 |
| 25 | 25 | `db-custom-1-3840` | 6.2 | no | 15 GiB | $98.42 | $3.94 |
| 50 | 50 | `db-custom-2-7680` | 12.4 | no | 20 GiB | $152.46 | $3.05 |
| 100 | 100 | `db-custom-2-7680` | 24.8 | no | 30 GiB | $157.01 | $1.57 |
| 200 | 200 | `db-custom-4-15360` | 49.5 | no | 45 GiB | $268.03 | $1.34 |
| 300 | 300 | `db-custom-8-30720` * | 74.3 | no | 65 GiB | $484.68 | $1.62 |
| 400 | 400 | `db-custom-8-30720` * | 99.0 | no | 80 GiB | $494.30 | $1.24 |
| 500 | 500 | `db-custom-8-30720` * | 123.8 | no | 100 GiB | $505.85 | $1.01 |
| 600 | 600 | `db-custom-16-61440` * | 148.5 | no | 115 GiB | $929.76 | $1.55 |
| 800 | 800 | `db-custom-16-61440` * | 198.0 | no | 150 GiB | $951.46 | $1.19 |
| 1000 | 1000 | `db-custom-16-61440` * | 247.5 | no | 185 GiB | $973.19 | $0.97 |
| 1200 | 1200 | `db-custom-32-122880` * | 297.0 | no | 215 GiB | $1821.40 | $1.52 |
| 1500 | 1500 | `db-custom-32-122880` * | 371.3 | sí | 270 GiB | $1854.89 | $1.24 |
| 1750 | 1750 | `db-custom-32-122880` * | 433.1 | sí | 310 GiB | $1880.72 | $1.07 |
| 2000 | 2000 | `db-custom-32-122880` * | 495.0 | sí | 355 GiB | $1945.74 | $0.97 |

### 4.2 Escenario B · padrón con 60% activo

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | ¿Supera 300 pts/s? | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 6 | `db-g1-small` | 1.5 | no | 10 GiB | $157.60 | $15.76 |
| 25 | 15 | `db-g1-small` | 3.7 | no | 20 GiB | $161.28 | $6.45 |
| 50 | 30 | `db-custom-1-3840` | 7.4 | no | 25 GiB | $196.58 | $3.93 |
| 100 | 60 | `db-custom-2-7680` | 14.9 | no | 35 GiB | $270.07 | $2.70 |
| 200 | 120 | `db-custom-2-7680` | 29.7 | no | 55 GiB | $282.82 | $1.41 |
| 300 | 180 | `db-custom-4-15360` | 44.6 | no | 75 GiB | $435.16 | $1.45 |
| 400 | 240 | `db-custom-4-15360` | 59.4 | no | 95 GiB | $449.73 | $1.12 |
| 500 | 300 | `db-custom-8-30720` * | 74.3 | no | 115 GiB | $740.39 | $1.48 |
| 600 | 360 | `db-custom-8-30720` * | 89.1 | no | 135 GiB | $754.96 | $1.26 |
| 800 | 480 | `db-custom-8-30720` * | 118.8 | no | 175 GiB | $821.51 | $1.03 |
| 1000 | 600 | `db-custom-16-61440` * | 148.5 | no | 215 GiB | $1402.83 | $1.40 |
| 1200 | 720 | `db-custom-16-61440` * | 178.2 | no | 260 GiB | $1433.72 | $1.19 |
| 1500 | 900 | `db-custom-16-61440` * | 222.8 | no | 320 GiB | $1477.44 | $0.98 |
| 1750 | 1050 | `db-custom-32-122880` * | 259.9 | no | 370 GiB | $2655.62 | $1.52 |
| 2000 | 1200 | `db-custom-32-122880` * | 297.0 | no | 420 GiB | $2692.05 | $1.35 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | ¿Supera 300 pts/s? | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 6 | `db-g1-small` | 1.5 | no | 10 GiB | $80.27 | $8.03 |
| 25 | 15 | `db-g1-small` | 3.7 | no | 15 GiB | $82.22 | $3.29 |
| 50 | 30 | `db-custom-1-3840` | 7.4 | no | 20 GiB | $100.30 | $2.01 |
| 100 | 60 | `db-custom-2-7680` | 14.9 | no | 25 GiB | $154.44 | $1.54 |
| 200 | 120 | `db-custom-2-7680` | 29.7 | no | 35 GiB | $159.18 | $0.80 |
| 300 | 180 | `db-custom-4-15360` | 44.6 | no | 45 GiB | $267.54 | $0.89 |
| 400 | 240 | `db-custom-4-15360` | 59.4 | no | 55 GiB | $272.58 | $0.68 |
| 500 | 300 | `db-custom-8-30720` * | 74.3 | no | 65 GiB | $484.68 | $0.97 |
| 600 | 360 | `db-custom-8-30720` * | 89.1 | no | 75 GiB | $490.75 | $0.82 |
| 800 | 480 | `db-custom-8-30720` * | 118.8 | no | 95 GiB | $503.19 | $0.63 |
| 1000 | 600 | `db-custom-16-61440` * | 148.5 | no | 115 GiB | $929.76 | $0.93 |
| 1200 | 720 | `db-custom-16-61440` * | 178.2 | no | 135 GiB | $942.41 | $0.79 |
| 1500 | 900 | `db-custom-16-61440` * | 222.8 | no | 165 GiB | $961.43 | $0.64 |
| 1750 | 1050 | `db-custom-32-122880` * | 259.9 | no | 190 GiB | $1805.55 | $1.03 |
| 2000 | 1200 | `db-custom-32-122880` * | 297.0 | no | 215 GiB | $1821.40 | $0.91 |

### 4.3 Escenario C · activos/mes, pico menor

**Arquitectura Actual**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | ¿Supera 300 pts/s? | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 4 | `db-g1-small` | 0.9 | no | 10 GiB | $157.55 | $15.76 |
| 25 | 9 | `db-g1-small` | 2.2 | no | 10 GiB | $157.66 | $6.31 |
| 50 | 18 | `db-g1-small` | 4.3 | no | 20 GiB | $161.33 | $3.23 |
| 100 | 35 | `db-custom-1-3840` | 8.7 | no | 25 GiB | $196.68 | $1.97 |
| 200 | 70 | `db-custom-2-7680` | 17.3 | no | 35 GiB | $270.46 | $1.35 |
| 300 | 105 | `db-custom-2-7680` | 26.0 | no | 50 GiB | $279.30 | $0.93 |
| 400 | 140 | `db-custom-4-15360` | 34.6 | no | 60 GiB | $424.97 | $1.06 |
| 500 | 175 | `db-custom-4-15360` | 43.3 | no | 70 GiB | $432.78 | $0.87 |
| 600 | 210 | `db-custom-4-15360` | 52.0 | no | 85 GiB | $442.44 | $0.74 |
| 800 | 280 | `db-custom-8-30720` * | 69.3 | no | 110 GiB | $736.11 | $0.92 |
| 1000 | 350 | `db-custom-8-30720` * | 86.6 | no | 130 GiB | $751.95 | $0.75 |
| 1200 | 420 | `db-custom-8-30720` * | 104.0 | no | 155 GiB | $769.53 | $0.64 |
| 1500 | 525 | `db-custom-16-61440` * | 129.9 | no | 190 GiB | $1384.61 | $0.92 |
| 1750 | 613 | `db-custom-16-61440` * | 151.6 | no | 220 GiB | $1406.15 | $0.80 |
| 2000 | 700 | `db-custom-16-61440` * | 173.3 | no | 250 GiB | $1427.70 | $0.71 |

**Arquitectura Optimizada**

| Conductores (n) | n efectivo | Tier SQL | Pts/s pico | ¿Supera 300 pts/s? | Disco | Total/mes | USD/conductor |
| ---: | ---: | :--- | ---: | :--- | ---: | ---: | ---: |
| 10 | 4 | `db-g1-small` | 0.9 | no | 10 GiB | $80.22 | $8.02 |
| 25 | 9 | `db-g1-small` | 2.2 | no | 10 GiB | $80.32 | $3.21 |
| 50 | 18 | `db-g1-small` | 4.3 | no | 15 GiB | $82.27 | $1.65 |
| 100 | 35 | `db-custom-1-3840` | 8.7 | no | 20 GiB | $100.40 | $1.00 |
| 200 | 70 | `db-custom-2-7680` | 17.3 | no | 25 GiB | $154.63 | $0.77 |
| 300 | 105 | `db-custom-2-7680` | 26.0 | no | 30 GiB | $157.11 | $0.52 |
| 400 | 140 | `db-custom-4-15360` | 34.6 | no | 35 GiB | $263.11 | $0.66 |
| 500 | 175 | `db-custom-4-15360` | 43.3 | no | 40 GiB | $265.64 | $0.53 |
| 600 | 210 | `db-custom-4-15360` | 52.0 | no | 50 GiB | $270.06 | $0.45 |
| 800 | 280 | `db-custom-8-30720` * | 69.3 | no | 60 GiB | $482.41 | $0.60 |
| 1000 | 350 | `db-custom-8-30720` * | 86.6 | no | 70 GiB | $488.53 | $0.49 |
| 1200 | 420 | `db-custom-8-30720` * | 104.0 | no | 85 GiB | $496.97 | $0.41 |
| 1500 | 525 | `db-custom-16-61440` * | 129.9 | no | 100 GiB | $921.09 | $0.61 |
| 1750 | 613 | `db-custom-16-61440` * | 151.6 | no | 115 GiB | $930.31 | $0.53 |
| 2000 | 700 | `db-custom-16-61440` * | 173.3 | no | 130 GiB | $939.70 | $0.47 |

\* Tier extrapolado por este modelo (agosto no dimensionó más allá de 62 pts/s / 600 conductores). Sin evidencia de prueba de carga real a esa capacidad.

---

## 5. Desglose por servicio — n=600 y n=2000 (escenario A, supuestos medidos)

**Arquitectura Actual**

| Conductores | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | GCS | Art.Reg. | Egreso | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | $1104.34 | $51.17 | $22.96 | $51.10 | $74.10 | $3.00 | $68.55 | $18.40 | $0.00 | $0.30 | $8.90 | **$1402.83** |
| 2000 | $2208.69 | $165.41 | $76.72 | $51.10 | $223.01 | $10.00 | $143.36 | $18.40 | $0.00 | $0.30 | $29.68 | **$2926.66** |

**Arquitectura Optimizada**

| Conductores | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | GCS | Art.Reg. | Egreso | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | $828.26 | $27.37 | $11.76 | $10.50 | $7.88 | $3.00 | $31.14 | $0.00 | $0.64 | $0.30 | $8.90 | **$929.76** |
| 2000 | $1656.52 | $84.49 | $38.64 | $10.50 | $45.07 | $10.00 | $68.55 | $0.00 | $1.99 | $0.30 | $29.68 | **$1945.74** |

---

## 6. Sensibilidad — edge cases (plan §4.3, n=600, escenario A, arquitectura actual)

| Variante | Total/mes | Δ vs. base |
| :--- | ---: | ---: |
| Base (6 vueltas, jornada derivada, bytes medidos, sin HA, Santiago) | $1402.83 | — |
| Vueltas diarias: 3 (piso) | $1294.06 | -7.8% |
| Jornada operativa: 14 h (en vez de 10 h) | $876.18 | -37.5% |
| Ancho de fila con bloat: 350 B (en vez de 365.6 B medidos) | $1401.08 | -0.1% |
| Alta disponibilidad regional en Cloud SQL: sí | $2581.30 | +84.0% |
| Región: us-central1 (en vez de southamerica-west1) | $931.07 | -33.6% |

Nota: los edge cases de "3 vueltas" y "jornada 14h" no son independientes — el modelo deriva la jornada de las vueltas diarias salvo que se fuerce explícitamente (`jornadaHoras` distinto de `null` en `EDGE_CASES_DEFAULT`), por eso se muestran por separado.

---

## 7. Qué partes del documento de agosto NO son reproducibles

`costos-gcp-por-escala.md` publicó totales y desgloses por servicio, pero no la fórmula interna que los genera. Reconstruir esa fórmula (obligatorio para extender la tabla a 2000, que agosto no cubre) expone tres puntos donde el documento de agosto no es reproducible con un modelo de parámetros explícitos:

### 7.0 Residuo de TOTAL — los 18 puntos de referencia completos

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

De 18 puntos, 11 caen dentro de ±5% en el TOTAL (el criterio objetivo del plan §13.4) y 18 dentro de ±15% (la falla dura del test de regresión). El error en el TOTAL es menor que el error en la columna "API" sola (§7.1) porque el resto de las líneas — Cloud SQL, Redis, worker, VPC/GCS, Artifact Registry, egreso — sí se reproducen dentro de tolerancia y son la mayor parte de la factura.

### 7.1 La columna "API" no es reproducible con un parámetro global

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

### 7.2 El crecimiento de disco por conductor de agosto no se reproduce desde el DDL

Documentado ya en el propio código del modelo (`SUPUESTOS_AGOSTO.crecimientoGiBPorConductor`, `scripts/costos/modelo-costos.mjs`): reproducir `bytesPorPunto × puntos/día × días × meses` desde cero con los supuestos citados de agosto (240 B, 2500 pts/día, 26 días, 6 meses) da ~89.3 MiB, no los 121.7 MB que agosto publicó ("121,7 MB por conductor", §3.4 del doc de agosto). El documento de agosto nunca mostró la fórmula completa detrás de esa cifra — probablemente incluye overhead de bloat/fill-factor no desglosado. Este modelo usa el valor publicado tal cual (citado, no derivado) para no perder la reproducción del caso base.

### 7.3 El dimensionamiento de Cloud SQL y de `quivo-worker` son tablas, no fórmulas

Agosto documentó saltos de tier y de instancias de worker como resultado ("100 conductores → `db-custom-1-3840`"), no como una fórmula derivable de primeros principios. El chairman confirmó esto en el plan §13.1/§13.2: no hay una ecuación que reproduzca los saltos sin fijar constantes de calibración (el factor pico/promedio de 1,485, el umbral de requests/día de los workers). Ambos quedan modelados como tablas explícitas en `modelo-costos.mjs` (`SQL_TIERS`, `UMBRALES_INSTANCIAS_WORKER_REQ_DIA`), no como fórmulas de un parámetro — es, literalmente, lo que el plan pide y lo que agosto no dejó por escrito.

---

## 8. Límites de la medición que alimenta este documento (plan §12.4)

Los supuestos MEDIDOS que arman las tablas de §4-§6 vienen de una sola medición contra `quivo-control-prod`, ejecutada el 2026-09-20. **Este documento no puede presentar esos números como más firmes de lo que son:**

- **n = 1 en la métrica que más pesa.** De 8 sesiones registradas, solo UNA (6000 puntos extrapolados desde una jornada de 8,7 h) es una jornada real completa. Las otras siete van de 2 a 625 puntos: pruebas, no operación.
- **Dos días de datos:** 2026-09-09 y 2026-09-10. Nada más.
- **La base no recibe datos desde el 2026-09-11** (piloto detenido). No hay forma de saber si esa jornada es representativa de la operación en régimen.
- **No hay comparación pre/post en la misma base.** El proyecto GCP se recreó el 2026-09-08; los datos del período anterior (81-103 m entre puntos) vienen del proyecto borrado, no de esta base.
- **Los 365.6 B/punto** se midieron sobre una muestra chica de filas, sin `VACUUM FULL` ni estado estable, y `reltuples` devolvió `-1` en casi todas las particiones (nunca corrió `ANALYZE`). El número en régimen puede diferir.

**Consecuencia directa para las cifras de §4-§6:** son la mejor proyección disponible hoy, no una facturación observada ni una medición en régimen. El piloto múltiple de usuarios (ClickUp `86e329ub0`) o una corrida de `tests/load/k6/` contra `quivo-control-prod` son las dos vías para reemplazar esta proyección por datos reales.

---

## 9. Supuestos tomados por cuenta propia en esta implementación

- **Escenario C (factor de concurrencia 0.35):** el plan §4.2 deja este factor explícitamente "a derivar", sin dato de utilización diaria real de la flota. Se tomó 0,35 como supuesto de producto (fracción de actividad diaria típica en flotas rotativas con turnos), NO VERIFICADO.
- **Extrapolación de tiers de Cloud SQL más allá de 600 conductores:** duplicar vCPU/RAM cada vez que se duplica el techo de pts/s, siguiendo el mismo patrón que agosto usó hasta 600. Sin prueba de carga que confirme que un solo nodo sostiene esa capacidad.
- **Extrapolación de umbrales de `quivo-worker` más allá de 600 conductores:** duplicar el umbral de requests/día en cada salto de instancia, anclado en el salto real de agosto (400→500 conductores).
- **Calibración de `CPU_SEG_POR_REQUEST_API` por mínimos cuadrados en USD** (no en % relativo) sobre los 18 puntos de referencia. Se probó también minimizar el error relativo (%); el resultado no fue mejor — ambos metodos dejan una parte de la columna "API" sin reproducir (§7.1). Se optó por mínimos cuadrados en USD por ser el criterio estándar y no distorsionar por los escalones de "optimizada" con costo publicado cercano a cero.
- **Tolerancia del test de regresión:** ±5% como objetivo (informativo), ±15% como falla dura, sobre los 18 puntos de referencia de agosto (9 escalones × 2 arquitecturas) — no solo los 4 escalones (10/100/300/600) que cubría el intento anterior. Plan §13.4.
- **Escenario "optimizada" en la proyección a 2000 asume que las seis palancas de agosto SÍ están aplicadas** (ciclo de sync 60s, min-instances=0, Redis propio, etc.), aunque el plan §9.3 confirma que ninguna lo está hoy en `quivo-control-prod`. Es un objetivo, no el estado real — se marca explícitamente en este párrafo porque no hay otro lugar natural en las tablas de arriba para esa advertencia.

---

_Generado automáticamente por `scripts/costos/generar-tablas.mjs` a partir de `scripts/costos/modelo-costos.mjs`. Base de horas: 730 h/mes. Para reproducir: `node scripts/costos/generar-tablas.mjs > docs/costos-gcp-2000.md`._
