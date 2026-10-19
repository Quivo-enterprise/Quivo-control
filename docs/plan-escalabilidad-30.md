# Plan — Llevar Quivo a 30 conductores simultáneos (capacidad, resiliencia, costos, mantenibilidad)

## Contexto

Pedido del CTO (18/10): optimizar y escalar la app a **mínimo 30 usuarios**, evaluando load balancers, Docker,
Kubernetes, circuit breakers y query cache, con buenas prácticas, sin god files y cuidando costos.

Supuesto de dimensionamiento: **30 conductores con turno en simultáneo + hasta 3 pestañas del panel en vivo**.
Objetivo de holgura: aguantar **60** (2×) en la prueba de carga.

### Carga esperada (derivada del código, no medida)
- Conductor en movimiento: ~18–26 req/min (sync con piso de 3 s, vuelta-actual 20 s, vecinos 30 s, perfil 60 s).
- 30 conductores: **9–13 req/s** a la API, ~10 lotes de sync/s, **~36 puntos GPS/s** promedio
  (30–43 k puntos por conductor y jornada con `distanceFilter` 15 m).
- Panel en vivo: ~36–48 req/min por pestaña (posiciones cada 2 s, query pesada sin caché).

### Infra actual (verificado con `gcloud` hoy)
- API `quivo-api`: Cloud Run, 1 vCPU, 1 GiB, min 1, max 3, concurrencia 80, conector VPC `e2-micro`.
- Worker `quivo-worker`: Cloud Run Worker Pool, 1 instancia, BullMQ con concurrencia 1.
- Cloud SQL `quivo-db`: Postgres 16, `db-g1-small` (vCPU compartida), zonal, 10 GB, ~95 MB usados, CPU ~7 %,
  **PITR apagado**.
- Redis `quivo-redis`: BASIC, 1 GB, `noeviction`, 1,9 % usado.
- Uso de hoy: 2 trufis en piloto. La prueba de carga local (`scripts/experimentos/gps/carga/resultados/resumen.md`)
  mostró que el worker con 1 vCPU ingiere 300–1000 pts/s, pero se corrió en NVMe local y con lotes grandes, no
  con los lotes chicos de hoy ni contra Cloud SQL.

## Veredicto sobre lo pedido (sin complacencia)

| Pieza | Decisión | Por qué |
|---|---|---|
| Load balancer | **No** | Cloud Run ya balancea y autoescala. Un HTTPS LB externo (~US$18/mes + reglas) solo tiene sentido con Cloud Armor, CDN o multi-región. |
| Docker | **Ya está** | Dockerfile multi-stage. Solo adelgazar la imagen (~1,8 GB): el `runner` copia todo `/app`. |
| Kubernetes | **No** | GKE cobra ~US$73/mes solo por el cluster más la operación (nodos, upgrades, ingress). 13 req/s es menos del 1 % de una instancia de Cloud Run. Reabrir recién con cientos de req/s sostenidos o necesidades que Cloud Run no cubra. |
| Circuit breakers | **No como librería** | La única dependencia externa del servidor es OSRM (ya tiene timeout de 4 s y fallback). El riesgo real es la DB: se cubre con timeouts (`statement_timeout`, pool) y reintentos de BullMQ. El móvil ya tiene breaker de refresh y backoff. |
| Query cache | **Solo puntual** | Postgres no tiene query cache. Micro-caché en memoria para el endpoint caliente (posiciones en vivo); Redis no como caché general. |
| PgBouncer | **No** | Con 30 conductores alcanza con dimensionar los pools explícitamente. |
| HA de Cloud SQL / Redis | **No por ahora** | Duplica el costo. El outbox del teléfono guarda 7 días: una caída corta no pierde datos. Sí activar **PITR**. |

## Hallazgos que sí rompen con 30 (con evidencia)

1. **Redis se va a llenar y la ingesta se cae.** La cola `ingesta-sync` encola sin `removeOnComplete` ni
   `removeOnFail` (grep: solo `retencion-gps` los usa). Las claves crecen de 8,3 k a 14,5 k en 14 días; el piloto del
   14/10 (2 trufis, parte del día) sumó ~2,1 k claves y ~2,4 MB. Con 30 conductores y jornada completa, la
   extrapolación gruesa da del orden de 100 MB/día: el 1 GB se llena en semanas o menos. Con `noeviction`, Redis
   rechaza escrituras y `POST /v1/sync/batches` falla.
2. **Un job fallido pierde el lote.** Los jobs no tienen `attempts` ni `backoff`. El teléfono recibió 202 y no
   reenvía. Con la DB bajo presión (pool agotado, timeout), los puntos se pierden. Las escrituras ya son idempotentes
   (`ON CONFLICT (event_id, ts)`, `eventId` único en cumplimientos y eventos), así que reintentar es seguro.
3. **API y worker sin Sentry en producción.** `SENTRY_DSN` no está en las variables de `quivo-api` ni de
   `quivo-worker`. No hay uptime checks, políticas de alerta ni presupuesto de facturación (la API de budgets ni está
   habilitada). Con 30 conductores, un worker trabado se notaría por quejas.
4. **Rate limit por IP con CGNAT.** Límite global de 100/min por IP y login de 5/min. Las operadoras móviles suelen
   compartir IP (CGNAT). Al inicio del turno, 30 logins desde pocas IPs dan 429. A verificar con los logs del piloto.
   `perfil`, `asignacion-del-dia`, `ruta-a-punto` y `contexto-operativo` no tienen el throttler por dispositivo.
5. **Pools sin dimensionar.** `PrismaPg` usa el default de `pg` (10 por proceso), con 3 instancias de API, el worker y
   un segundo `Pool` en `health.service.ts`. Hay que contrastarlo con `max_connections` de `db-g1-small` (no
   verificado). No hay `statement_timeout`: una query trabada retiene la conexión.
6. **Worker con concurrencia 1 y lotes chicos.** ~10 lotes/s, cada uno con 3–4 transacciones (insert, desvío,
   vueltas). Con ~50 ms por lote contra Cloud SQL, la ocupación roza el 50 %. No medido en prod. La prueba local ya
   validó concurrencia 4.
7. **Panel en vivo caro.** `GET /reportes/en-vivo/posiciones` corre cada 2 s por pestaña, sin caché, con 3 LATERAL.
   Además, la traza hace `count(*)` sobre toda la jornada cada 10 s. En la prueba local, 20 monitores saturaron 1 vCPU
   y subieron las escrituras de 6 ms a 400 ms.
8. **`gps_points` crece sin techo.** `GPS_ARCHIVE_ENABLED` no está seteada, así que el archivo a GCS está apagado. Con
   30 conductores son ~216–310 MB/día y ~40–56 GB en 6 meses. El autoresize de disco nunca achica.
9. **`db-g1-small` es de núcleo compartido:** no tiene SLA de Cloud SQL. Para producción con 30 conductores es un
   riesgo de negocio, no solo de CPU.
10. **Job de vencimiento de rotaciones en la API**, con CPU solo durante requests: `could not renew lock`
    documentado en `docs/deuda-abierta.md`. Va al worker.

## Fase 0 — Medir antes de tocar (prerrequisito)

Lectura en prod (GETs y `gcloud` de solo lectura, lo corre Claude):
- `SHOW max_connections` y conexiones por proceso (`pg_stat_activity` agrupado por `application_name`).
- Logs del 14/10: IPs distintas de los teléfonos (¿CGNAT?) y clave real del throttle de login.
- Latencia por job del worker, si está en los logs. Si no, se agrega un log de duración en la Fase 1.

**Prueba de carga en un entorno efímero** (lo crea y lo borra el CTO; prod no se toca):
- Clon de `quivo-db` y Redis BASIC temporal. La misma imagen se despliega como `quivo-api-carga` y
  `quivo-worker-carga`. Costo: unos pocos dólares por las horas que dure. Script de alta y baja en
  `scripts/carga-efimera.sh` (lo escribe Sonnet).
- Generador: adaptar `scripts/experimentos/gps/carga/` a la cadencia real:
  - lotes de 1 a 3 puntos cada 3 s;
  - polling de vecinos, vuelta-actual y perfil;
  - 3 pestañas del panel en vivo;
  - sindicato de prueba sembrado en el clon.
- Escalones: 30 y 60 conductores, 30 min cada uno, primero con el código actual (línea base) y después con la Fase 1.
- **Criterios de pase en 60:**
  - p95 de la API < 500 ms, sin 5xx ni 429;
  - cola `waiting` acotada (< 100 y estable);
  - CPU de Cloud SQL < 60 %, conexiones < 70 % del máximo;
  - Redis estable entre minuto 10 y minuto 30.

Salida: tabla de hallazgos confirmados y descartados con números. Lo que no se confirme sale del plan.

## Fase 1 — Obligatorio antes de pasar de 5 conductores

Cada punto es un PR chico. Sonnet implementa y el chairman revisa.

1. **BullMQ** (`apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts`,
   `apps/api/src/modules/sync/sync-queue.service.ts`):
   - `defaultJobOptions`: `removeOnComplete: { age: 3600, count: 1000 }`, `removeOnFail: { age: 7 días }`,
     `attempts: 5`, `backoff` exponencial;
   - `concurrency` del Worker por variable de entorno, default 4 (el valor lo fija la prueba de carga);
   - log de duración por job;
   - test de que las opciones llegan a `queue.add` y de que el reintento es idempotente.

   Después del deploy, limpieza única de los jobs viejos con `queue.clean`. Es escritura en prod: la corre el CTO.
2. **Observabilidad:**
   - `SENTRY_DSN` para API y worker en `scripts/deploy-gcp.sh` (desde Secret Manager).
   - `scripts/observabilidad-gcp.sh`, idempotente (lo escribe Sonnet y lo corre el CTO), crea:
     - uptime check a `/v1/health/ready`;
     - alertas: 5xx de Cloud Run, CPU de Cloud SQL > 80 % por 10 min, conexiones > 80 %, disco > 80 %, memoria de
       Redis > 70 %;
     - métrica basada en logs de la cola en espera;
     - presupuesto de facturación con avisos al 50, 90 y 100 %;
     - PITR activado.
3. **Rate limit:**
   - endpoints móviles restantes con `SyncDeviceThrottlerGuard` (clave por dispositivo) y fuera del límite global
     por IP;
   - login con clave IP + usuario o teléfono, no solo IP;
   - el almacenamiento queda en memoria, con comentario
     `shortcut: límite por instancia (máx 3×), pasar a Redis si se sube max-instances`.
   - Revisión: `/security-review` obligatoria.
4. **Pools y timeouts** (`packages/db/src/client.ts`, `apps/api/src/health/health.service.ts`):
   - `max` del pool explícito por proceso, con suma de todos los procesos < 70 % de `max_connections`;
   - `connectionTimeoutMillis`;
   - `statement_timeout`: 10 s en la API, 60 s en el worker (por `options` de conexión, no por rol: la retención
     hace operaciones largas);
   - health deja su `Pool` propio y usa `SELECT 1` por Prisma.
5. **Retención GPS:** activar `GPS_ARCHIVE_ENABLED` con los meses que decida el CTO (default 6) y verificar una
   corrida en el entorno efímero antes de prod.
6. **Vencimiento de rotaciones** pasa del proceso de la API al worker.

## Fase 2 — Optimización guiada por la prueba de carga

Solo si la Fase 0 la justifica, o si es barata y de impacto claro.
- **Panel en vivo:**
  - micro-caché de 2 s por sindicato para `posiciones`, reusando `CacheTtl` (moverlo de
    `tracking/vecinos-ruta.util.ts` a `apps/api/src/common/cache/`);
  - la traza deja de hacer `count(*)` en cada poll.
  - Archivo: `apps/api/src/modules/reportes/en-vivo.service.ts`.
- **Tier de Cloud SQL:** pasar a `db-custom-1-3840` (núcleo dedicado, con SLA). Aproximadamente US$25–35/mes más que
  hoy, a precio de lista; verificar el precio en `southamerica-west1`. Recomendado aunque la CPU aguante, por el SLA.
  Decide el CTO.
- **Direct VPC egress en la API** (el worker ya lo usa): elimina el conector `e2-micro` (ahorro aproximado de
  US$15–25/mes y saca un cuello de throughput).
- **Imagen Docker más chica:** `pnpm deploy --prod` o podar devDependencies en el `runner`. Más una política de
  limpieza en Artifact Registry.
- **Condicionales,** solo si la prueba muestra que pesan:
  - **Caché positiva de tokens** de 30 s en `AuthMovilGuard`. Tradeoff: una revocación tarda hasta 30 s en aplicar.
  - **Piso del sync de 3 a 10 s.** Divide por 3 los requests y las transacciones del worker; a cambio, el mapa en
    vivo llega hasta 7 s más tarde. Decisión de producto.
- **Sin cambios:** `max-instances` 3 y `min-instances` 1 de la API alcanzan.

## Fase 3 — Mantenibilidad sin big-bang

Hay 48 archivos de más de 400 líneas. Reescribirlos todos antes de la entrega es el riesgo más grande del plan.
- **Trinquete en CI:**
  - `scripts/limite-lineas.mjs` con un baseline JSON;
  - un archivo nuevo no puede pasar de 400 líneas;
  - uno del baseline no puede crecer.
  - Corre en el job `ci`.
- **Ciclos de módulos:** cortar `reportes ↔ vueltas ↔ ingesta-worker` (API) y `operacion ↔ mapa` (mobile).
  Extraer lo compartido a un módulo de dominio más bajo.
- **Partición por responsabilidad,** un PR cada una, con tests antes y sin cambio de comportamiento, en este orden:
  1. `ingesta-worker.service.ts` (934 líneas) y `en-vivo.service.ts` (821), porque ya se tocan en las fases 1 y 2.
  2. `use-auth-movil.ts` (1545): la lógica no React (lease de refresh, revocaciones) a módulos puros.
  3. `outbox.ts` (1478), partido por tabla.
  4. Formularios web `vehicle-form-panel.tsx` (1884) y `line-form-panel.tsx` (1749): ilustraciones, presets y
     secciones.
  5. **Al final y después de la entrega:** `use-gps-operativo.ts` (1827) y `headless-task.ts` (1460). Es el código
     más crítico y sus regresiones solo se ven en la calle.
- **Duplicados:** haversine en `design-system/route-map-interpolacion.ts` y `web/rutas/route-utils.ts`, pasar a
  `packages/shared/src/geo.ts`.
- **No se toca:** los dos motores de mapa (decisión del ADR 0004).

## Despliegue gradual

5 conductores → 15 → 30, con revisión de métricas y Sentry entre escalones (mínimo 2 jornadas cada uno). Para
pasar de 5 a más, la Fase 1 tiene que estar completa.

## Acciones del CTO / prerrequisitos

- Correr los scripts de entorno efímero, observabilidad y despliegues: son escrituras en prod o costo.
- Decisiones:
  - meses de retención GPS;
  - tier de Cloud SQL;
  - piso del sync, si la prueba lo pide.
- Revisar en la consola de facturación el gasto real actual: no hay export y los docs de costos de agosto describen
  otra infra.
- Pendiente aparte: revocar el token de Sentry que se pegó en el chat.

## Verificación

- **Por PR:**
  - `tsc`, tests de api/shared/mobile y CI `ci` + `acceptance` verdes;
  - `/code-review` + `/ponytail-review`, más `/security-review` en el punto 1.3;
  - Codex: no verificado hasta el 16/11.
- **Fase 1, en el entorno efímero:** se repite la prueba de 60 conductores y tiene que cumplir los criterios de la
  Fase 0. Además, la memoria de Redis queda plana tras 30 min y matar el worker a mitad de la prueba no pierde puntos
  (comparar los puntos enviados con las filas en `gps_points`).
- **En prod, tras el despliegue:**
  - uptime check verde;
  - una alerta de prueba llega al mail;
  - Sentry de la API recibe un evento de prueba;
  - las claves de Redis dejan de crecer de un día para otro.
- Al salir de plan mode: copiar a `docs/plan-escalabilidad-30.md` y agregar el puntero en `docs/handoff.md`.
