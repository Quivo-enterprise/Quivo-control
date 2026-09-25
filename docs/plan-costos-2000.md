# Plan — Proyección de costos a 2000 trufis + Doc para finanzas

Fecha: 2026-09-20 · Autor: CTO (Jose Luis Larrazabal)
Estado: EN CURSO — bloqueado parcialmente (ver §6)

## 1. Objetivo

Dos entregables **separados**, aprobados por el CTO el 2026-09-20:

1. **Extensión de la escalera de costos GCP de 600 → 2000 vehículos** (ClickUp `86e34jkb2`,
   "Añadir proyección de Costos", urgent, vencida 2026-09-14).
2. **Documento para gerencia de finanzas** (ClickUp `86e2yxchp`, "Doc. Técnico de Quivo Control",
   high, vencida 2026-08-25).

## 2. Corrección de premisa (registrada)

La tarea `86e2yxchp` NO pide el documento técnico de funcionalidades. Texto literal de Angel:
subir a Telegram un documento para que gerencia de finanzas analice **estado de costos,
presupuesto de ventas, punto de equilibrio, puntos débiles y riesgos, métodos de pricing**.

- `docs/documento-tecnico-cto.md` (2026-07-19) es técnico puro. Cubre riesgos; no cubre
  ventas, break-even ni pricing.
- El repo no contiene NINGÚN dato de negocio (verificado por grep: sin pricing, ARPU, CAC,
  presupuesto de ventas, break-even). Esos números deben venir de finanzas/Angel.
- Reparto correcto: ingeniería aporta **costo de infraestructura por vehículo** y **riesgos
  técnicos**. Ventas, punto de equilibrio y pricing son de finanzas.

## 3. Contradicción a reconciliar (NO omitir en el entregable)

| Fuente | Cifra | Escala |
|---|---|---|
| `docs/documento-tecnico-cto.md` §10 | US$1.200–2.800/mes | 3000 vehículos |
| `docs/costos-gcp-por-escala.md` (2026-08-26) | $508.75 actual / $309.54 optimizada | 600 conductores |

La extensión a 2000 probablemente caiga muy por debajo del rango del doc técnico. Hay que
explicar la diferencia explícitamente (el rango de julio era una estimación previa al
relevamiento real con `gcloud`) o alguien de finanzas va a preguntar cuál cifra vale.

Nota: el ADR 0002 ya fue corregido una vez por el mismo motivo (estimaba ~$255-290/mes
asumiendo una base de datos de 2 vCPU/8 GB que nunca se creó).

## 4. Entregable 1 — Escalera a 2000

### 4.1 Decisiones del CTO
- **Ambas curvas** (arquitectura actual y optimizada), igual que el documento de agosto.
- **"Lo más completo y con varios edge cases"**: no se elige una sola definición de "2000
  trufis"; se modelan las tres como escenarios.

### 4.2 Escenarios de definición de "2000"
| Escenario | Definición | Carga pico implicada |
|---|---|---|
| A · pico concurrente | 2000 transmitiendo a la vez | ~207 pts/s |
| B · padrón con 60% activo | 2000 registrados, ~1200 en pico | ~124 pts/s |
| C · activos/mes | 2000 distintos en el mes, pico menor | a derivar |

Base de derivación (de `docs/costos-gcp-por-escala.md`): 2.500 pts/conductor/día con 6 vueltas,
26 días operativos, jornada ~10 h. Criterio de dimensionamiento Cloud SQL: conductores ÷ 9,7.

### 4.3 Edge cases obligatorios
- Vueltas diarias: 3 (piso) vs 6 (techo, usado en las tablas).
- Jornada operativa: 10 h vs 14 h.
- Ancho de fila `gps_points`: 240 B (derivado del DDL) vs 350 B (con bloat de particiones).
- Alta disponibilidad regional en Cloud SQL: sí / no (duplica cómputo y storage).
- Región: `southamerica-west1` (Santiago, Tier 2) vs `us-central1` (~26% más barato a 600).

### 4.4 Archivos críticos
- `docs/costos-gcp-por-escala.md` — fuente de verdad: precios unitarios, fórmulas, criterios
  de tier. Se EXTIENDE, no se reescribe.
- `docs/costos-gcp-por-escala.html` — versión publicable.
- Artifact previo (escalera 10–600, 2026-08-26) — se publica una v2 hasta 2000.
- `packages/db/prisma/migrations/20260802160000_ingesta_gps_worker/migration.sql:19-30` — DDL
  de `gps_points`, origen del cálculo de 240 B/fila.

### 4.5 Parámetros de carga citados (a re-verificar contra el código actual)
- `distanceFilter` 50 m — `apps/mobile/src/gps/background-geolocation.config.ts:46`
- `locationUpdateInterval` 10.000 ms — `background-geolocation.config.ts:47-48`
- Ciclo de sync outbox 15.000 ms — `apps/mobile/src/features/operacion/use-sync-status.ts:8`
- Lote máximo 500 eventos — `apps/mobile/src/features/operacion/sync-outbox.ts:16`
- Polling `/en-vivo` 30.000 ms — `apps/web/src/lib/en-vivo/use-en-vivo.ts:34`

## 5. Entregable 2 — Doc para finanzas

Aporta ingeniería: estado de costos (del entregable 1), costo por vehículo/mes, riesgos
técnicos y puntos débiles. **Pendiente de decisión del CTO**: si los números de ventas,
break-even y pricing los provee Angel/finanzas, o si se modelan como escenarios derivados del
costo y se marcan explícitamente como supuesto de ingeniería.

## 6. Trampas y bloqueos

1. **Extender a 2000 NO es aritmética.** A 600 conductores Cloud SQL ya es el 54% de la
   factura y el dimensionamiento es "la única parte con criterio de ingeniería y no
   aritmética" (palabras del propio documento de agosto). A ~207 pts/s hay que decidir si un
   solo nodo aguanta o si cambia el diseño de ingesta.
2. **BLOQUEANTE ACTUAL**: falta verificar contra el repo (a) si las seis palancas de
   optimización se aplicaron desde 2026-08-26, (b) cómo se insertan hoy los puntos GPS
   (`INSERT` por punto vs batch/`COPY`/`UNNEST`), (c) si `gps_points` está particionada.
   Sin (b) no se puede afirmar que 2000 vehículos entren en la arquitectura actual.
3. **Los números de agosto no son facturación observada.** No hay export de facturación a
   BigQuery; son precios de lista aplicados a consumos medidos. Sigue siendo la mejora de
   precisión más barata disponible.
4. **Precios de lista con casi un mes de antigüedad** (2026-08-26). Re-verificar antes de
   publicar cifras a finanzas.
5. **No medido**: el supuesto de 240 B/fila nunca se validó con SQL contra producción. La
   consulta de solo lectura fue bloqueada en su momento.

## 7. Criterios de verificación

- Los totales de cada escalón cierran con la suma del desglose por servicio (chequeo
  aritmético línea por línea).
- Los escalones 10–600 de la v2 reproducen EXACTAMENTE las cifras del documento de agosto
  (si cambian, hay que justificar por qué).
- La verificación cruzada de volumetría cierra contra `documento-tecnico-cto.md` §15.2
  (~300 pts/s para 2000–3000 vehículos).
- Cada supuesto nuevo queda citado con `file:line` o marcado como no verificado.
- Gate antes de cerrar: `/code-review` sobre el diff de docs, y revisión del diff del
  subagente por el chairman.

## 8. Estado de las tareas ClickUp relacionadas

| Tarea | ID | Estado |
|---|---|---|
| Añadir proyección de Costos | `86e34jkb2` | en curso (este plan) |
| Doc. Técnico (finanzas) | `86e2yxchp` | en curso (este plan) |
| Endpoint control de rutas | `86e2wtm7f` | IGNORADA por decisión del CTO (2026-09-20) |
| Piloto múltiple usuario | `86e329ub0` | diferida |
| Subir app a Play Store | `86e32jmbc` | diferida |
| Login GCP / deuda técnica / admin panel | varias | diferidas |

---

## 9. Verificación contra el repo (2026-09-20) — LA BASE DE AGOSTO ESTÁ VENCIDA

Verificado por el chairman leyendo los archivos citados, no solo por reporte de subagente.

### 9.1 El proyecto GCP auditado ya no existe

`docs/infra-gcp-prod.md:9` — `quivo-piloto` (proyecto `424426714260`), el que auditó
`costos-gcp-por-escala.md` el 2026-08-26, fue **descartado y borrado**. La infraestructura vive
hoy en `quivo-control-prod` (`741758083365`), creada a mano el 2026-09-08.

Consecuencia: la sección "Qué hay desplegado hoy" del documento de agosto describe un proyecto
muerto. Ningún número de esa tabla puede reutilizarse sin re-verificar contra el proyecto nuevo.

Cambio favorable no pedido: Cloud SQL pasó de IP pública + `requireSsl:false` a **IP privada
únicamente** (`docs/infra-gcp-prod.md:59,76-82`). El hallazgo de higiene de agosto está resuelto.

### 9.2 El muestreo GPS cambió, y multiplica el volumen por ~6

Commit `04b14ed` (2026-09-09), `apps/mobile/src/gps/background-geolocation.config.ts:52,57`:

| | Agosto (base de la proyección) | Hoy |
|---|---|---|
| `distanceFilter` | 50 m nominales | **15 m** |
| `disableElasticity` | ausente (default `false`) | **`true`** |
| Distancia real entre puntos | 81–103 m medidos | ~15 m constantes |

La elasticidad del SDK escalaba el filtro con la velocidad: por eso 50 m nominales medían 81–103 m
reales. Desactivada, el filtro queda constante.

**Impacto derivado sobre toda la §3.3 de la proyección:**

| Métrica | Agosto | Con el código de hoy | Factor |
|---|---|---|---|
| Puntos por vuelta (32,7 km) | ~418 | ~2.500 | ×6 |
| Puntos/conductor/día (6 vueltas) | ~2.500 | ~15.000 | ×6 |
| Pico a 600 conductores | 62 pts/s | **~372 pts/s** | ×6 |
| Storage por conductor (6 meses) | 121,7 MB | ~730 MB | ×6 |

**Titular:** con el código de hoy, **600 conductores ya generan más carga (~372 pts/s) que los
~300 pts/s que `documento-tecnico-cto.md` §15.2 proyectaba para 2000–3000 vehículos.** El
presupuesto de volumetría del diseño original se consume seis veces más rápido de lo previsto.

A 2000 conductores en el escenario de pico concurrente: **~1.240 pts/s**, más de 4× el techo que
cubre el test de carga existente. Solo en Cloud SQL, 2000 conductores × 730 MB = ~1,46 TB de disco
caliente, que a precio de lista son ~$347/mes de SSD + ~$163/mes de backups.

**Estos números son derivados del cambio de configuración, NO medidos.** La base de producción ya
tiene datos reales posteriores al 2026-09-09 (piloto con conductores reales): una consulta de solo
lectura sobre `gps_points` que cuente puntos por sesión y por km reemplaza esta derivación por una
medición. Es el mismo supuesto que la proyección de agosto marcó como el más grande sin medir.

### 9.3 De las seis palancas de optimización, cero se aplicaron

No hay Terraform ni Pulumi; el único registro es `scripts/deploy-gcp.sh` y `docs/infra-gcp-prod.md`.

| Palanca | Estado | Evidencia |
|---|---|---|
| A · Direct VPC egress | NO en `quivo-api` (sigue `--vpc-connector`) | `scripts/deploy-gcp.sh:772` |
| B · Redis propio | NO — sigue Memorystore Basic 1 GiB | `docs/infra-gcp-prod.md:84-89` |
| C · `min-instances = 0` | NO — sigue en 1 | `scripts/deploy-gcp.sh:770` |
| D · sync 15 s → 60 s | NO — sigue en 15 s | `apps/mobile/src/features/operacion/use-sync-status.ts:8` |
| E · retención 3 meses + bucket | NO en ninguna de las dos partes | `retencion-gps.service.ts:121`, `.env.example:61,65` |
| F · uso comprometido Cloud SQL | no verificado (no vive en el repo) | — |

`quivo-worker` sí usa Direct VPC egress, pero por obligación técnica: `gcloud run worker-pools
deploy` no acepta `--vpc-connector` (`scripts/deploy-gcp.sh:958-967`). No cuenta como palanca
aplicada, y `quivo-api` sigue pagando el conector 24/7.

Consecuencia para el entregable: la curva "optimizada" sigue siendo hipotética. A 2000 vehículos
con el volumen ×6, dejar de aplicarlas deja de ser una diferencia de ~$200/mes.

### 9.4 Corrección a la proyección de agosto: el INSERT ya es multi-fila

`costos-gcp-por-escala.md:219` justifica la Palanca D diciendo que arregla "el patrón de un
`INSERT` por punto". **Eso es incorrecto.** `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts:305-345`
ya arma un `INSERT ... VALUES (...),(...)` multi-fila con hasta 500 filas y
`ON CONFLICT (event_id, ts) DO NOTHING`. El cuello de botella no es el SQL: es que con sync cada
15 s el lote típico es chico (~1,3 puntos por request según la propia derivación de agosto). Con
`distanceFilter` en 15 m el lote típico ya creció, sin que nadie lo haya medido.

`gps_points` está particionada `BY RANGE (ts)` por día, con la carrera de creación de particiones
ya resuelta vía `pg_advisory_xact_lock` (migración `20260829180000`).

### 9.5 El test de carga existe y nunca se corrió contra el proyecto nuevo

`tests/load/k6/` (desde el commit `339692b`, 2026-08-03): escenario sostenido de **300 pts/s** más
ráfaga de reconexión de flota (20 lotes/s de 500 eventos). Umbrales p95 <500 ms sostenido,
p95 <1500 ms en ráfaga, <1% de lotes rechazados.

Sin evidencia en el repo de una corrida contra `quivo-control-prod`. La recomendación de agosto
("prueba de carga antes de pasar de 300 conductores") sigue abierta, y el script para hacerla ya
existía cuando se escribió. Su techo de 300 pts/s ahora corresponde a ~480 conductores, no a 3000.

---

## 10. Decisiones del CTO (2026-09-20)

1. **Medir antes de proyectar.** El ×6 de §9.2 es derivado de la configuración, no medido. Se
   mide contra `quivo-control-prod` con una consulta de SOLO LECTURA sobre `gps_points`
   (puntos por sesión y por km, con datos posteriores al 2026-09-09) antes de construir
   cualquier tabla de costos.
2. **El entregable 1 incluye rediseño de ingesta**, no solo precios. A ~1.240 pts/s el problema
   dejó de ser de tarifas: hay que evaluar palancas de VOLUMEN (agregación, downsampling por
   tramo, `distanceFilter` adaptativo, TimescaleDB) que nadie analizó todavía.
3. **El entregable 2 cubre solo costos y riesgos.** Presupuesto de ventas, punto de equilibrio y
   métodos de pricing quedan explícitamente fuera y se declara en el documento que los completa
   finanzas. No se inventan precios desde ingeniería.
4. **`86e2wtm7f` (endpoint de control de rutas) queda ignorada** por decisión del CTO, pese a
   estar marcada `urgent`.

### 10.1 Cómo se mide (la base es privada)

Cloud SQL en `quivo-control-prod` tiene **IP privada únicamente**: no es alcanzable desde una
laptop, ni con `cloud-sql-proxy` (`docs/infra-gcp-prod.md:76-82`). El único vehículo para
consultar es el **Cloud Run Job de migraciones**, que corre dentro de la VPC con la imagen de la
API y permite overridear el comando por ejecución con `--args`
(`scripts/deploy-gcp.sh:473-474,524-541`).

Reglas para esa ejecución:
- La consulta es `SELECT` exclusivamente. Ningún `INSERT`/`UPDATE`/`DELETE`/`ALTER`.
- Se revisa el comando completo antes de ejecutarlo; el riesgo a evitar es disparar
  `prisma migrate deploy` por un `--args` mal armado.
- La ejecución la corre el chairman, no un subagente.

---

## 11. Palancas de VOLUMEN (análisis del chairman, a calibrar con la medición)

Las seis palancas de agosto son de **precio**: cambian lo que se paga por la misma carga. A
~1.240 pts/s y ~1,46 TB de disco caliente, agotan su recorrido. Lo que sigue son palancas de
**volumen**: cambian la carga misma. Ninguna estaba analizada hasta hoy.

Orden por impacto estimado sobre el costo a 2000 vehículos. Las cifras son órdenes de magnitud
derivados, NO medidos — se recalibran cuando vuelva la medición de §10.1.

### 11.1 La pregunta de producto que hay detrás

Antes de elegir palanca hay que responder algo que no es técnico: **¿para qué se necesitan los
puntos GPS?** QUIVO Control verifica cumplimiento de ruta, paso por puntos de control y tiempos.
Para eso no hacen falta 2.500 puntos por vuelta conservados seis meses a resolución de 15 m.

Si el caso de uso real es (a) mapa en vivo, (b) reconstrucción del recorrido y (c) auditoría de
cumplimiento, entonces la resolución densa solo hace falta **en caliente, por días**. Todo lo
demás puede vivir como trazo simplificado más eventos de control. Esa sola distinción baja el
storage un orden de magnitud, y es gratis en infraestructura.

### 11.2 Retención escalonada por resolución — impacto alto, riesgo bajo

Hoy: 6 meses de puntos crudos (`retencion-gps.service.ts:121`), archivado deshabilitado y sin
bucket. Propuesta: denso 7–14 días → trazo simplificado (Douglas-Peucker) + eventos de control
→ archivo en GCS Nearline.

A 2000 vehículos, es la diferencia entre ~1,46 TB y ~100 GB de disco caliente. Es además la
palanca E de agosto llevada a su conclusión: el runbook ya existe, lo que falta es el bucket y
la decisión de resolución.

### 11.3 Simplificación geométrica antes de persistir — impacto alto, riesgo medio

Mantener el muestreo a 15 m (que resolvió un problema real de huecos y precisión) pero persistir
solo los puntos que aportan forma: en recta 1 cada ~100 m, en curva todos. Douglas-Peucker con
tolerancia de 5–10 m recorta típicamente 60–80% de los puntos sin deformar el trazo visible.

Contrapartida: se pierde la serie de velocidad instantánea punto a punto. Si nadie la usa, es
gratis; si alguien la usa, se conserva agregada por tramo. **Hay que verificarlo antes de
implementar, no asumirlo.**

Se puede aplicar en el dispositivo (ahorra también ancho de banda y batería) o en el worker
(más control, no requiere release de app). Empezar por el worker es más reversible.

### 11.4 Resumen por sesión al cerrar — impacto medio, riesgo bajo

Al cerrar una sesión, precalcular distancia, duración, velocidad media, cumplimiento y cruces de
puntos de control. Hoy el panel `/en-vivo` hace `LEFT JOIN LATERAL` con `count(*)` sobre
`gps_points` cada 30 s por pestaña — según el análisis de agosto, eso compite con la ingesta y
es parte de por qué Cloud SQL necesita 4 vCPU. Con el resumen precalculado, las consultas de
lectura dejan de tocar la tabla grande.

### 11.5 `distanceFilter` adaptativo por contexto — impacto medio, riesgo medio

15 m constantes existe por una razón buena: 50 m elásticos medían 81–103 m reales y dejaban
huecos. Pero la precisión no hace falta en todos lados por igual: densa cerca de puntos de
control y terminales, laxa en tramos rectos largos. Recupera resolución donde se audita y la
suelta donde solo se dibuja.

Requiere release de app y lógica de geocercas en el dispositivo. Es la más cara de implementar
de esta lista.

### 11.6 Compresión de series temporales — impacto alto, decisión de stack

`documento-tecnico-cto.md` §1 descartó TimescaleDB "día 1", y fue una decisión correcta para el
piloto. A 2000 vehículos la ecuación cambia: la compresión columnar nativa da típicamente 10–20×
sobre datos de series temporales como estos. Cloud SQL **no** ofrece Timescale, así que implica
o AlloyDB, o Postgres autogestionado, o un almacén separado para el histórico.

**Esta es una decisión de arquitectura, no una optimización.** No se toma en este documento:
se evalúa solo si 11.2 + 11.3 no alcanzan.

### 11.7 Descartadas o menores

- **Lotes más grandes / sync menos frecuente** (palanca D de agosto): mejora el rendimiento del
  INSERT multi-fila, pero no reduce el volumen almacenado. Complementaria, no estructural.
- **Achicar el ancho de fila** (`device_id` y `sindicatoId` son `TEXT` donde podrían ser `UUID`):
  recorta quizá 10–15% del storage. No mueve la aguja frente a 11.2.

### 11.8 Recomendación preliminar

**11.2 + 11.4 primero**: juntas atacan el storage y la presión de lectura sobre Cloud SQL, no
requieren tocar la app, y son reversibles. **11.3 después**, una vez verificado quién consume la
velocidad instantánea. **11.6 solo si el número medido dice que no alcanza.**

Sujeto a la medición de §10.1: si el volumen real resulta ser ×2 y no ×6, este orden cambia.

### 10.2 Estado de la medición (2026-09-20)

Preparada y revisada por el chairman, **no ejecutada todavía — bloqueada por credenciales**.

Artefactos (en el scratchpad de la sesión, no versionados): `medicion-gps-runner.js` (script Node,
28 `SELECT` y un `set_config`, cero statements mutantes), `medicion-gps.sql`, `medicion-comando.md`.

Verificado por el chairman, no solo reportado:
- El script no contiene comillas simples, `$(`, comentarios `//` ni `%%`: el envoltorio
  `node -e '...'` con delimitador `^%%^` de gcloud es seguro.
- `gps_points` tiene `FORCE ROW LEVEL SECURITY`, que aplica la policy incluso al dueño. El script
  hace `SELECT set_config('app.rol','admin_quivo', false)` — el mismo bypass explícito que usa
  `packages/db/src/tenant-context.ts`. Sin eso, la medición podía devolver cero filas y parecer
  que no hay datos.
- La imagen del job es `node:22-alpine`, sin `psql`. El único cliente es el paquete `pg`, por eso
  el vehículo es un script Node y no un `.sql`.

**Riesgo del `--args`, evaluado y acotado:** el Job `quivo-migraciones` tiene
`prisma migrate deploy` como comando default persistido (`scripts/deploy-gcp.sh:521-524`). Si se
omitiera `--args`, correría eso. Pero aplicaría las migraciones **de la imagen desplegada**, no
del working tree local — y esa imagen ya las aplicó en su propio deploy. Peor caso: no-op.
La última migración del repo es `20260908151800_unicidad_placa_generada` (commit `7a41959`,
2026-09-08), anterior al despliegue. Riesgo aceptado.

**Bloqueo:** la cuenta activa `jslslarrazabal2@gmail.com` no tiene `run.jobs.get` sobre
`quivo-control-prod`. Las cuentas operadoras (`cloud@tuquivo.com`, `cloud@quivobo.com`) tienen los
tokens vencidos y piden reautenticación interactiva, que no puede hacerse desde una sesión no
interactiva. Requiere que el CTO corra `gcloud auth login cloud@tuquivo.com`.

**Mejora de higiene propuesta, no ejecutada:** crear un Job separado
`quivo-consultas-solo-lectura`, misma red e imagen pero con comando default inofensivo, para que
las consultas ad-hoc no compartan recurso con el job que puede alterar el schema.

---

## 12. RESULTADOS DE LA MEDICIÓN (2026-09-20) — el ×6 derivado era alto

Ejecutada contra `quivo-control-prod` vía el Job `quivo-migraciones` con override de `--args`
(ejecuciones `quivo-migraciones-nw2zn` y `-v8kzp`, ambas exit 0, solo `SELECT`).

### 12.1 Corrección al análisis de §9.2

La derivación de §9.2 asumía que `distanceFilter: 15` implica un punto cada 15 m de recorrido, y
proyectaba ×6. **Medido, el factor es menor.** La mediana real entre puntos consecutivos es
18,47 m (no 15), y el vehículo detenido no genera puntos, así que la distancia efectiva con
captura es menor que la recorrida.

| Métrica | Agosto (supuesto) | Medido 2026-09-20 | Factor real |
|---|---|---|---|
| Distancia entre puntos consecutivos (p50) | 81–103 m | **18,47 m** | ÷4,9 |
| Distancia entre puntos (media) | — | 23,04 m | — |
| Puntos por jornada completa | ~2.500 | **5.635** (jornada de 8,7 h) | **×2,25** |
| Bytes por punto (con índices) | 240 B (derivado del DDL) | **365,6 B** | **×1,52** |

**El factor combinado sobre storage es ×3,4, no ×6.** El análisis de agosto había anticipado este
escenario: decía que si el bloat llevaba la fila a 350 B, disco y backups subían ~45%. Acertó —
el valor real es 365,6 B.

Por qué los índices pesan más de lo estimado: agosto contó ~80 B para "PK/índice". Hay **tres**
estructuras (PK `(event_id, ts)`, `(sesion_id, ts)` y `("sindicatoId", ts)`), que miden 158 B por
fila. El heap medido es 200 B contra 152 B estimados.

### 12.2 Recálculo a 2000 vehículos, con los números medidos

Base: ~6.000 puntos/conductor/día (la jornada medida de 5.635 puntos en 8,7 h, extrapolada a 10 h),
26 días operativos, 365,6 B por punto, 6 meses de retención caliente.

| | 600 conductores | 2000 conductores |
|---|---|---|
| Puntos/día | 3,6 M | 12 M |
| Pico estimado | ~149 pts/s | **~496 pts/s** |
| Storage caliente | ~205 GB | **~684 GB** |
| Disco SSD ($0,238/GiB-mes) | ~$49/mes | ~$163/mes |
| Backups + PITR ($0,112/GiB-mes) | ~$23/mes | ~$77/mes |

Corrige la estimación preliminar de §9.2 (que proyectaba ~1,46 TB y ~$510/mes de storage a 2000):
**el número real es aproximadamente la mitad.**

Sigue siendo cierto lo estructural: ~496 pts/s a 2000 supera el techo de 300 pts/s que cubre el
test de carga existente, y `documento-tecnico-cto.md` §15.2 proyectaba ~300 pts/s para ese mismo
rango de 2000–3000 vehículos. El presupuesto de volumetría del diseño se consume más rápido de lo
previsto, pero por un factor de ~1,7, no de ~4.

### 12.3 Confirmado: el lote de sync es diminuto

| Percentil | Puntos por lote |
|---|---|
| p50 | **3** |
| p90 | 14,8 |
| p99 | 261,6 |
| máximo | 296 |
| promedio | 16,4 |

417 lotes medidos. Confirma §9.4: el `INSERT ... VALUES` multi-fila está dimensionado para 500
filas y la mitad de las veces mueve **3**. El costo por punto está dominado por el overhead de
request y transacción, no por el SQL. Subir el ciclo de sync (palanca D de agosto) sigue teniendo
sentido, pero por esta razón, no por la que el documento decía.

### 12.4 LÍMITES DE ESTA MEDICIÓN — leer antes de citar los números

- **Una sola jornada completa.** De 8 sesiones, solo una (5.635 puntos, 8,7 h) es una jornada
  real. Las otras siete van de 2 a 625 puntos: pruebas, no operación. El factor ×2,25 es n=1.
- **Dos días de datos**: 2026-09-09 (1.182 puntos, 6 sesiones) y 2026-09-10 (5.646 puntos, 2
  sesiones). Nada más.
- **La base no recibe datos desde el 2026-09-11** — diez días. Coincide con el handoff: piloto
  detenido, cinco ramas sin mergear.
- **No hay comparación pre/post en esta base.** El proyecto nuevo se creó el 2026-09-08, después
  del cambio de muestreo. Los 81–103 m del período anterior vienen del proyecto borrado
  (`docs/issues-pendientes-gps.md:101`), no de una consulta a esta base.
- **Bytes por fila medidos sobre 5.646 filas.** Suficiente para superar el ruido de página fija
  (138 páginas de heap, ~41 filas por página), pero sin `VACUUM FULL` ni estado estable. El
  número real en régimen puede diferir.
- `reltuples` devolvió `-1` en casi todas las particiones: nunca corrió `ANALYZE` sobre ellas.

**Cómo cerrar el gap:** el piloto múltiple usuario (ClickUp `86e329ub0`, urgent, vencida) genera
exactamente los datos que faltan. La otra vía es correr `tests/load/k6/` contra el proyecto nuevo,
que mide el techo de la arquitectura pero no el comportamiento real de los conductores.

---

## 13. Especificación de calibración del modelo (chairman, 2026-09-20)

Persistida acá porque el primer intento de implementación murió por límite de sesión con la
especificación solo en el contexto de la conversación. Estado al momento de escribir: existen
`scripts/costos/modelo-costos.mjs` y `modelo-costos.test.mjs`, sin commitear; faltan
`generar-tablas.mjs` y `docs/costos-gcp-2000.md`; el test falla 5 de 9 a ±2%.

Codex revisó el modelo tres veces y levantó el mismo hallazgo `high`. La causa raíz no es la
implementación: **el documento de agosto mezcla cálculos con decisiones de dimensionamiento y solo
publicó los resultados.** Lo que sigue son los factores derivados por el chairman.

### 13.1 Factor pico/promedio — constante explícita, no derivada

`(n × puntosDía) / (jornadaHoras × 3600)` da el PROMEDIO de la jornada, no el pico:

| Conductores | Fórmula | Referencia agosto | Ratio |
|---|---|---|---|
| 100 | 6,94 | 10 | 1,44 |
| 300 | 20,8 | 31 | 1,49 |
| 400 | 27,8 | 42 | 1,51 |
| 600 | 41,7 | 62 | 1,49 |

`FACTOR_PICO_SOBRE_PROMEDIO = 1.485`, de `(n/9,7) ÷ (n/14,4)`. Equivale a asumir que la carga se
concentra en ~6,73 h de las 10 h de jornada — supuesto que agosto nunca escribió. Aplicarlo antes
de elegir tier. Verificar que el salto 300→400 siga cayendo en `db-custom-4-15360`: ese salto es
la "trampa de planificación" de agosto §2 y tiene que sobrevivir.

### 13.2 Umbral de workers — tabla explícita, no fórmula de requests/día

Borrar `UMBRAL_REQUESTS_DIA_POR_INSTANCIA_WORKER = 650000`. El criterio de agosto es
**1 worker hasta 400 conductores, 2 desde 500**, y no es derivable: es dimensionamiento, igual que
la tabla de tiers de SQL.

Verificado contra los precios publicados: 1 instancia (1 vCPU / 512 MiB, 730 h, free tier de
384.204 vCPU-s y 728.744 GiB-s) da ~$31,1 contra $31,68 publicado; 2 instancias dan ~$68,55 contra
$68,58 publicado. La aritmética del corte cierra; lo que no se deriva es dónde está el corte.

Para los escalones nuevos (800–2000), extender el criterio de forma explícita y documentar cuál
se usó.

### 13.3 Costo de API — calibrar y reportar el residuo

Ajustando los vCPU-s por request contra el escalón de 300 optimizado sale c = 0,0338 vCPU-s/request
(~34 ms). Aplicado a 200 conductores da **$8,63 contra los $10,53 publicados**. La columna API de
agosto **no es reproducible con una fórmula de un solo parámetro**.

- vCPU-s por request como parámetro explícito del modelo.
- Valor elegido por mejor ajuste sobre TODOS los escalones de referencia, no contra uno solo.
- Emitir tabla de error residual por escalón: referencia, modelo, diferencia absoluta y porcentual.

### 13.4 Criterio de aceptación revisado (autoridad del chairman)

El test valida **totales a ±5%**, no ±2%, y falla si algún escalón se desvía más de **±15%**.
Documentar en el `.md` y en el test qué escalones no se reproducen y cuánto.

Razón del cambio: perseguir ±2% contra una columna que probablemente tiene un error de origen
produce un modelo que miente para darle la razón a un documento viejo. Que agosto tenga partes no
reproducibles es un hallazgo legítimo y va como sección propia del entregable.

**Prohibido:** hardcodear valores por escalón para pasar el test; relajar la tolerancia más allá
del ±5%; cambiar los valores esperados de la referencia para que coincidan con la salida del
modelo. Si no cierra, se entrega igual con la tabla de residuos a la vista.
