# Costos GCP por escala — QUIVO Control

**Fecha:** 2026-08-26
**Autor:** Tecnología / CTO
**Proyecto GCP:** `quivo-piloto` · billing `01C664-BE6291-332928` ("Quivo-billing")
**Región:** `southamerica-west1` (Santiago, Chile)
**Pregunta que responde:** ¿cuánto se gasta por mes en GCP con 600, 500, 400, 300, 200, 100, 50, 25 y 10 conductores activos, ya escalada la infraestructura a cada nivel, con cada conductor haciendo entre 3 y 6 vueltas diarias sobre las rutas Z12 y 120?

> **Reemplaza la estimación del ADR 0002** (~US$255-290/mes en piloto). Ese número asumía Cloud SQL 2 vCPU/8 GB; lo que está realmente desplegado hoy es `db-g1-small`. El piso real es más bajo.

---

## 1. Respuesta corta

| Conductores | Arquitectura actual | Arquitectura optimizada | Ahorro | USD/conductor/mes (optimizada) |
| ----------: | ------------------: | ----------------------: | -----: | -----------------------------: |
| **600**     |         **$508.75** |             **$309.54** |    39% |                          $0.52 |
| **500**     |         **$500.35** |             **$298.73** |    40% |                          $0.60 |
| **400**     |         **$455.17** |             **$289.26** |    36% |                          $0.72 |
| **300**     |         **$309.92** |             **$176.15** |    43% |                          $0.59 |
| **200**     |         **$301.54** |             **$166.66** |    45% |                          $0.83 |
| **100**     |         **$216.23** |             **$105.83** |    51% |                          $1.06 |
| **50**      |         **$169.90** |              **$84.71** |    50% |                          $1.69 |
| **25**      |         **$163.32** |              **$81.56** |    50% |                          $3.26 |
| **10**      |         **$158.90** |              **$81.15** |    49% |                          $8.12 |

**El hallazgo que manda sobre todos los demás: el costo casi no depende de la cantidad de conductores.**
De 10 a 600 conductores el gasto sube 3,2× mientras la carga sube 60×. Con la arquitectura actual, **$158.90/mes se pagan aunque no haya ni un solo conductor conectado** — es la base fija (Cloud SQL + Memorystore + worker pool always-on + conector VPC + min-instances). En el escalón de 10 conductores, **el 99,7% de la factura es base fija.**

Corolario de negocio: **el problema de costo no es escalar, es el piso.** La optimización que más plata devuelve es bajar la base fija, y eso se puede hacer hoy sin esperar a tener usuarios.

---

## 2. Qué hay desplegado hoy (verificado por `gcloud`, 2026-08-26)

| Servicio | Configuración real | Nota |
| --- | --- | --- |
| Cloud Run `quivo-api` | 1 vCPU / 1 GiB, **min-instances = 1**, max 3, concurrency 80, timeout 300 s, CPU boost, imagen `quivo/api:v5` | min-instances=1 se factura como *idle* 24/7 |
| Cloud Run `quivo-web` | 1 vCPU / 512 MiB, min-instances 0, max 3, imagen `quivo/web:v2` | Escala a cero: 40 s facturados en 30 días |
| Cloud Run Worker Pool `quivo-worker` | 1 vCPU / 512 MiB, **scalingMode manual, 1 instancia fija**, imagen `quivo/api:v4` | Corre siempre, haya trabajo o no |
| Cloud SQL `quivo-control-db` | PostgreSQL 16.14, **`db-g1-small`** (shared vCPU / 1,7 GiB), 10 GB PD_SSD con autoresize, **ZONAL** (sin HA), backups 7 + PITR 7 días, **IP pública, `requireSsl: false`** | CPU media 4,85%. **82 MiB usados de 10 GB** |
| Memorystore Redis `quivo-redis` | **BASIC**, 1 GiB, Redis 7.0, sin réplicas, sin persistencia, sin cifrado en tránsito | $51.10/mes — 32% del piso fijo |
| Serverless VPC connector `quivo-connector` | `e2-micro`, **min 2 instancias**, max 3 | $18.40/mes por existir |
| Artifact Registry `quivo` | 1792 MB, scanning deshabilitado | $0.13/mes |
| Secret Manager | 4 secrets, 1 versión c/u | Dentro del free tier |
| Cloud Storage | **0 buckets** | El archivado de particiones frías del runbook `retencion-gps.md` **no tiene destino creado** |
| Cloud NAT / routers | **No existen** | Sin costo de NAT |
| Cloud Logging | `_Default` 30 d, `_Required` 400 d | Dentro del free tier de 50 GiB |

**Consumo medido (Cloud Monitoring, 30 días):** `quivo-api` 4.485 requests y 890.957 vCPU-s facturables; `quivo-web` 277 requests y 40 vCPU-s; `quivo-worker` 760.028 vCPU-s. Egreso a internet total ~293 MB. Cloud SQL: disco estable en 80-82 MiB, CPU ~4,9%, memoria ~38-40%.

> **No hay export de facturación a BigQuery.** No existe forma de leer el costo real por SKU en USD. Todo este documento usa **precios de lista aplicados a consumos medidos y modelados**, no facturación observada. Activar el export es una acción de escritura de 5 minutos y vale la pena hacerla.

---

## 3. Modelo de carga por conductor

### 3.1 Lo que dice el código

| Parámetro | Valor | Origen |
| --- | --- | --- |
| `distanceFilter` | 50 m | `apps/mobile/src/gps/background-geolocation.config.ts:46` |
| `locationUpdateInterval` | 10.000 ms | `background-geolocation.config.ts:47-48` |
| Ciclo de sync del outbox | 15.000 ms | `apps/mobile/src/features/operacion/use-sync-status.ts:8` |
| Lote máximo por sync | 500 eventos | `apps/mobile/src/features/operacion/sync-outbox.ts:16` · `packages/shared/src/sync/evento.ts:170-172` |
| Compresión de subida | gzip (`pako`), header `X-Content-Encoding` | `apps/mobile/src/shared/api/sync-api.ts:39-53` |
| TTL access token | 15 min (refresh reactivo por 401) | `apps/api/src/modules/auth-movil/auth-movil.service.ts:190` |
| Polling `/en-vivo` (listado) | 30.000 ms | `apps/web/src/lib/en-vivo/use-en-vivo.ts:34` |
| Polling `/en-vivo` (posiciones) | 10.000 ms (1.000 ms mientras `hayMas`) | `apps/web/src/lib/en-vivo/traza.ts:27,30` |
| Retención caliente | 6 meses, particiones diarias, luego export + `DROP` | `docs/runbooks/retencion-gps.md` |

### 3.2 Lo que dice el campo (medición real del piloto)

- Cadencia entre fixes **en movimiento: mediana 17-21 s** — `packages/shared/src/entities/en-vivo.ts:20`
- Distancia entre puntos consecutivos: **mediana 81-103 m** — `docs/issues-pendientes-gps.md:101`
- Detenido, el plugin apaga la captura: huecos de 11, 17, 22 y **56 min** — `docs/issues-pendientes-gps.md:98-99`
- Lag captura→servidor: mediana 153-166 s, **p95 684-814 s**, máx 4.275 s — `docs/issues-pendientes-gps.md:178-179`

### 3.3 Derivación

| Magnitud | Valor | Cómo se obtiene |
| --- | --- | --- |
| Circuito Z12 | 40,7 km / 1.255 vértices | `docs/handoff.md:34`, `plan-ruta-real-z12.md:4` |
| Línea 120 (ida+vuelta) | ~24,8 km (tronco 12,4 km) | `docs/handoff.md:323` |
| Vuelta promedio (mix 50/50) | **32,7 km** | Promedio de las dos |
| Puntos por vuelta | **~418** | 32.700 m ÷ 90 m + 15% por jitter en paradas |
| **Puntos/conductor/día (6 vueltas)** | **~2.500** | Caso de dimensionamiento |
| Puntos/conductor/día (3 vueltas) | ~1.250 | Piso del rango pedido |
| Techo teórico (config, 10 s continuos) | ~3.530 | Si el GPS nunca se degradara |
| Jornada activa | ~10 h (196 km a 20 km/h) | Derivado de 6 vueltas |
| Días operativos/mes | 26 | Supuesto |
| Requests de sync/conductor/día | ~1.940 | 10 h ÷ 15 s, 78% de ciclos con pendientes |

**Verificación cruzada:** 600 conductores × 2.500 pts/día = 1,5 M puntos/día ≈ **62 puntos/s en pico**. El documento técnico proyecta ~300 pts/s para 2.000-3.000 vehículos (`documento-tecnico-cto.md:288`); 600 vehículos sobre esa misma recta da 60-90 pts/s. **El modelo cierra con la volumetría de diseño.**

### 3.4 Bytes por punto en disco

Fila de `gps_points` (`packages/db/prisma/migrations/20260802160000_ingesta_gps_worker/migration.sql:19-30`): header 23 B + `event_id` 16 + `sesion_id` 16 + `device_id` ~21 + `ts` 8 + `lat`/`lng` 16 + `accuracy`/`speed` 16 + `received_at` 8 + `sindicato_id` 16 ≈ **152 B de heap**. Más el PK `(event_id, ts)` y el índice `(sesion_id, ts)` ≈ **80 B**.

> **240 B por punto GPS, índices incluidos.** Es el único número importante del modelo que **no está medido contra la base real** — es una derivación del DDL. Ver §7.

Crecimiento resultante: **121,7 MB por conductor** en estado estable con 6 meses de retención caliente.

---

## 4. Precios aplicados (lista oficial, `southamerica-west1`, consultados 2026-08-26)

Santiago es **Tier 2**: ~+20% sobre Iowa en Cloud Run, **~+40% en Cloud SQL y Memorystore**, y el egreso a internet **no tiene franja gratuita** y cobra $0.19/GiB a *todos* los destinos.

| SKU | Precio | Fuente |
| --- | --- | --- |
| Cloud Run request-based — CPU activa | $0.0000336 / vCPU-s | cloud.google.com/run/pricing |
| Cloud Run request-based — CPU idle (min-instances) | $0.0000035 / vCPU-s | ídem |
| Cloud Run request-based — memoria | $0.0000035 / GiB-s | ídem |
| Cloud Run — requests | $0.40 / millón | ídem |
| Cloud Run Worker Pools — CPU / memoria | $0.000013493 / vCPU-s · $0.000001482 / GiB-s | ídem |
| Cloud SQL Enterprise — vCPU / RAM | $0.0578 /h · $0.0098 /GiB-h | cloud.google.com/sql/pricing |
| Cloud SQL `db-g1-small` | $0.049 /h | ídem |
| Cloud SQL SSD | $0.000326027 / GiB-h (≈$0.238/GiB-mes) | ídem |
| Cloud SQL backups + PITR | $0.000153425 / GiB-h (≈$0.112/GiB-mes) | ídem |
| Memorystore Redis Basic M1 | $0.07 / GiB-h | cloud.google.com/memorystore/docs/redis/pricing |
| Egreso a internet (Premium, 0-1 TiB) | $0.19 / GiB | cloud.google.com/vpc/network-pricing |
| VPC connector `e2-micro` | ≈$0.0126 /h por instancia (mín. 2) | Calculado sobre tarifa E2 shared-core Santiago |
| Artifact Registry | $0.10 / GiB-mes (0,5 GiB gratis) | cloud.google.com/artifact-registry/pricing |

Free tiers aplicados: Cloud Run request-based 180.000 vCPU-s + 360.000 GiB-s + 2 M requests; Worker Pools 384.204 vCPU-s + 728.744 GiB-s; Logging 50 GiB; Secret Manager 6 versiones. **HA regional en Cloud SQL duplica exactamente cómputo y storage** — no está activada y este documento no la incluye.

---

## 5. Arquitectura actual — desglose por escalón (USD/mes)

Base de horas: 730 h/mes.

| Conductores | Cloud SQL tier | SQL cómputo | SQL disco | SQL backup | Redis | API | Web | Worker | VPC conn. | Art.Reg. | Egreso | **TOTAL** |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | `db-custom-4-15360` | 276.09 | 21.42 | 9.86 | 51.10 | 56.29 | 3.00 | 68.58 | 18.40 | 0.30 | 3.71 | **508.75** |
| 500 | `db-custom-4-15360` | 276.09 | 17.85 | 8.18 | 51.10 | 54.26 | 2.50 | 68.58 | 18.40 | 0.30 | 3.09 | **500.35** |
| 400 | `db-custom-4-15360` | 276.09 | 14.28 | 6.61 | 51.10 | 52.24 | 2.00 | 31.68 | 18.40 | 0.30 | 2.47 | **455.17** |
| 300 | `db-custom-2-7680` | 138.04 | 11.90 | 4.93 | 51.10 | 50.22 | 1.50 | 31.68 | 18.40 | 0.30 | 1.85 | **309.92** |
| 200 | `db-custom-2-7680` | 138.04 | 8.33 | 3.25 | 51.10 | 48.20 | 1.00 | 31.68 | 18.40 | 0.30 | 1.24 | **301.54** |
| 100 | `db-custom-1-3840` | 69.02 | 5.95 | 1.57 | 51.10 | 36.89 | 0.70 | 31.68 | 18.40 | 0.30 | 0.62 | **216.23** |
| 50 | `db-g1-small` | 35.77 | 4.76 | 0.78 | 51.10 | 26.30 | 0.50 | 31.68 | 18.40 | 0.30 | 0.31 | **169.90** |
| 25 | `db-g1-small` | 35.77 | 3.57 | 0.45 | 51.10 | 21.50 | 0.40 | 31.68 | 18.40 | 0.30 | 0.15 | **163.32** |
| 10 | `db-g1-small` | 35.77 | 2.38 | 0.22 | 51.10 | 18.69 | 0.30 | 31.68 | 18.40 | 0.30 | 0.06 | **158.90** |

**Criterio de dimensionamiento de Cloud SQL** (escritura pico sostenida = conductores ÷ 9,7):

| Conductores | Puntos/s pico | Tier | Por qué |
| ---: | ---: | --- | --- |
| 10 / 25 / 50 | 1 / 2,6 / 5 | `db-g1-small` | Lo que ya está. CPU medida 4,9% sin carga real |
| 100 | 10 | `db-custom-1-3840` | Necesita RAM para el working set de 6 meses de particiones |
| 200 / 300 | 21 / 31 | `db-custom-2-7680` | Insert + mantenimiento de 2 índices + validación PostGIS de 26 puntos de control por punto |
| 400 / 500 / 600 | 42 / 52 / 62 | `db-custom-4-15360` | El panel `/en-vivo` compite con la ingesta: `LEFT JOIN LATERAL` con `count(*)` sobre `gps_points` cada 30 s por pestaña |

**Dos saltos escalonados explican toda la forma de la curva:** el de 300→400 conductores (Cloud SQL duplica a 4 vCPU, +$138) y el de 400→500 (segunda instancia de worker pool, +$37). Entre saltos, sumar 100 conductores cuesta menos de $10/mes.

**Costo por conductor (arquitectura actual):** $15.89 con 10 · $6.53 con 25 · $3.40 con 50 · $2.16 con 100 · $1.51 con 200 · $1.03 con 300 · $1.14 con 400 · $1.00 con 500 · $0.85 con 600.

> Nótese que **400 conductores sale peor por cabeza que 300** ($1.14 vs $1.03). Es el salto de tier de Cloud SQL. Si el crecimiento comercial se puede planificar, conviene **saltar de 300 directo a 600**, no parar en 400.

---

## 6. Arquitectura optimizada — desglose por escalón (USD/mes)

Seis palancas, ninguna de las cuales cambia lo que el producto hace:

| # | Palanca | Cómo | Ahorro | Riesgo |
| --- | --- | --- | ---: | --- |
| **A** | **Direct VPC egress** en lugar del Serverless VPC connector | Cloud Run soporta salida directa a VPC sin conector; el conector cobra por instancia-hora aunque no pase tráfico | **−$18.40/mes, en todos los escalones** | Ninguno. Es GA y estrictamente más barato |
| **B** | **Redis propio en `e2-micro`** en lugar de Memorystore Basic 1 GiB | La cola es transitoria: un backlog de 1 hora a 62 pts/s son 67 MB. Memorystore Basic tampoco da HA, así que no se pierde disponibilidad | **−$40.60/mes** ($51.10 → $10.50) | Operación propia (parches, monitoreo). Se puede revertir en minutos |
| **C** | **`min-instances = 0` en `quivo-api`** | Fuera de la ventana operativa (14 h/día) la instancia no hace nada y se paga idle | −$11.59 a −$17.71 | Cold start (~3-5 s) en el primer sync del día. El outbox reintenta; el p95 de lag ya es de 684 s |
| **D** | **Ciclo de sync 15 s → 60 s** | Hoy se hacen 30 M de requests/mes para mover 39 M de puntos: casi un request por punto. A 60 s los lotes son 4× más grandes y el worker hace `INSERT` multi-fila de verdad | −$9 en requests **y elimina la segunda instancia de worker en 500-600 (−$37)** | Hasta 60 s más de lag en `/en-vivo`. Irrelevante frente al p95 de 684 s ya medido |
| **E** | **Retención caliente 6 → 3 meses** | Ejecutar el runbook `retencion-gps.md` (que ya está escrito) contra un bucket GCS Nearline. Nada se borra: se archiva | −$14.45 en disco + backups en 600 | Requiere **crear el bucket, que hoy no existe** |
| **F** | **CUD de 1 año en Cloud SQL** | 25% de descuento sobre el cómputo a cambio de comprometer 12 meses | **−$69.02/mes en 600** | Compromiso contractual. Solo tomarlo cuando el escalón esté confirmado |

| Conductores | SQL cómputo (CUD) | SQL disco | SQL backup | Redis (VM) | API | Web | Worker | GCS | Art.Reg. | Egreso | **TOTAL** |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | 207.07 | 11.90 | 4.93 | 10.50 | 35.95 | 3.00 | 31.68 | 0.50 | 0.30 | 3.71 | **309.54** |
| 500 | 207.07 | 9.52 | 4.03 | 10.50 | 29.59 | 2.50 | 31.68 | 0.45 | 0.30 | 3.09 | **298.73** |
| 400 | 207.07 | 8.33 | 3.25 | 10.50 | 23.26 | 2.00 | 31.68 | 0.40 | 0.30 | 2.47 | **289.26** |
| 300 | 103.53 | 7.14 | 2.46 | 10.50 | 16.89 | 1.50 | 31.68 | 0.30 | 0.30 | 1.85 | **176.15** |
| 200 | 103.53 | 5.95 | 1.68 | 10.50 | 10.53 | 1.00 | 31.68 | 0.25 | 0.30 | 1.24 | **166.66** |
| 100 | 51.77 | 4.76 | 0.90 | 10.50 | 4.45 | 0.70 | 31.68 | 0.15 | 0.30 | 0.62 | **105.83** |
| 50 | 35.77 | 3.57 | 0.45 | 10.50 | 1.53 | 0.50 | 31.68 | 0.10 | 0.30 | 0.31 | **84.71** |
| 25 | 35.77 | 2.38 | 0.22 | 10.50 | 0.11 | 0.40 | 31.68 | 0.05 | 0.30 | 0.15 | **81.56** |
| 10 | 35.77 | 2.38 | 0.11 | 10.50 | 0.00 | 0.30 | 31.68 | 0.05 | 0.30 | 0.06 | **81.15** |

`db-g1-small` es shared-core y no admite CUD: los escalones de 10-50 conservan $35.77.

### Palanca extra, fuera de tabla: cambiar de región

Migrar a `us-central1` (Tier 1) recorta ~40% del cómputo de Cloud SQL y ~20% del de Cloud Run. Sobre la arquitectura optimizada con 600 conductores: **~$230/mes**, otro 26% abajo. **No se recomienda tomarla todavía** — es una migración completa de datos y la latencia Bolivia→Iowa contra Bolivia→Santiago no está medida. Queda anotada como la palanca grande disponible si la factura llegara a doler.

---

## 7. Sensibilidad y márgenes de error

**Vueltas diarias (3 vs 6).** Las tablas usan **6 vueltas**, el techo del rango. Con 3 vueltas la carga se parte al medio, pero el total **no**: en 600 conductores Cloud SQL baja un tier (a `db-custom-2-7680`) y el disco se parte, dando **~$340/mes en arquitectura actual** en vez de $509 (−33%). En los escalones de 10-50 la diferencia es **menor a $5/mes**, porque ahí todo es base fija.

**Los tres supuestos que más mueven el número, en orden:**

1. **240 B por punto GPS.** Derivado del DDL, no medido contra la base real. Si el bloat de las particiones diarias lo lleva a 350 B, el disco y los backups en 600 conductores suben ~45% (+$14/mes). Impacto acotado.
2. **Ventana operativa de 10 h/día.** Sale de 6 vueltas × 32,7 km a 20 km/h. **Ningún documento del repo fija el horario real de operación ni los minutos por vuelta** — se buscó explícitamente. Si la jornada real fuera de 14 h, el costo activo de Cloud Run sube ~40% (+$14/mes en 600).
3. **El dimensionamiento de Cloud SQL es la única parte con criterio de ingeniería y no aritmética.** Es también el 54% de la factura en 600 conductores. Un tier de más o de menos mueve ±$138/mes. **Es lo primero que hay que validar con una prueba de carga real.**

**Lo que este documento NO incluye:** HA regional en Cloud SQL (duplicaría cómputo y storage: +$276/mes en 600); Cloud Armor / WAF; CDN; entorno de staging separado; el costo de la licencia de `react-native-background-geolocation` (~US$400 únicos, no es GCP); EAS Build; ni ningún proveedor fuera de GCP.

**Lo que no se pudo medir.** El clasificador de permisos bloqueó la consulta SQL de solo lectura contra la base de producción. Con acceso autorizado se podría reemplazar el supuesto #1 por una medición exacta (`pg_total_relation_size('gps_points') / n_live_tup`) y el #2 por la duración real de las sesiones. **Es la mejora de precisión más grande disponible y cuesta cinco minutos.**

---

## 8. Recomendaciones

**Hacer ya, sin esperar usuarios** (aplican en cualquier escalón, valen ~$78/mes = 49% del piso actual):

1. **Palanca A** — reemplazar el VPC connector por Direct VPC egress. Sin contrapartida.
2. **Palanca B** — bajar Memorystore a un Redis propio, o al menos reconocer que se pagan $51/mes por un Redis Basic sin HA ni persistencia.
3. **Palanca C** — `min-instances = 0` en `quivo-api`.
4. **Palanca D** — subir el ciclo de sync de 15 s a 60 s. Es un cambio de una línea (`use-sync-status.ts:8`) que además arregla el patrón de un `INSERT` por punto, que es lo que va a tumbar la base cuando se escale.
5. **Crear el bucket GCS de archivado.** El runbook de retención existe y no tiene dónde escribir.
6. **Activar el export de facturación a BigQuery.** Sin eso no hay forma de verificar ninguno de estos números contra la realidad.

**Hacer antes de pasar de 300 conductores:**

7. **Prueba de carga contra Cloud SQL** con la escritura pico proyectada (31-62 pts/s) más el panel `/en-vivo` abierto. Es la única forma de confirmar el dimensionamiento de la línea que representa la mitad de la factura.
8. **Planificar el crecimiento comercial en saltos de 300 → 600, evitando estacionarse en 400.** El salto de tier de Cloud SQL hace que 400 conductores cuesten más por cabeza que 300.

**Higiene que no es de costo pero apareció en el relevamiento:** Cloud SQL está con **IP pública y `requireSsl: false`**.

---

## 9. Trazabilidad

Inventario obtenido con `gcloud` (`run services describe`, `beta run worker-pools`, `sql instances describe`, `redis instances`, `artifacts`, `secrets`, `storage`, `compute`, `services list`) y métricas de 30 días vía la API REST de Cloud Monitoring, todo en modo lectura, el 2026-08-26. Precios tomados de las páginas oficiales de pricing con el selector de región en Santiago, mismo día. Parámetros de carga citados con `file:line` en §3.
