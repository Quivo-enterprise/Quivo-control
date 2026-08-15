# Plan de finalización — QUIVO Control hasta el piloto

> Fecha: 2026-08-14 · Estado: en revisión del CTO
> Base: `main` = `a8c5b8b`, CI verde (`ci` + `acceptance`)
> Meta: **piloto operativo con 1 sindicato real**, no el MVP completo

## Context

QUIVO Control es un SaaS multi-tenant para sindicatos de transporte en Bolivia. El código
está más avanzado de lo que sugería el tablero: M1, M2 y M4 cerrados, el backend con ingesta
GPS por lotes idempotente, y el CI verde desde ayer tras reconstruir el design system perdido.

Lo que falta no es funcionalidad: es **validación**. Tres piezas centrales del producto nunca
se ejercieron contra la realidad — el tracking GPS en background nunca se midió en un teléfono,
el load test nunca corrió, y no existe ningún entorno desplegado. Además, la app móvil hoy
**no se puede publicar en Google Play** por versión de SDK.

Este plan lleva el producto de "código completo sin validar" a "piloto corriendo con un
sindicato real", en ese orden y con el gate GPS primero.

### Decisiones del CTO que enmarcan el plan

| Tema | Decisión |
|---|---|
| Alcance | Piloto con 1 sindicato. El MVP se termina con feedback del piloto |
| Equipo | CTO + Valentina. Estrella fuera del plan; Anett y Adrian ocupados en QUIVO Pay |
| Gate GPS | Bloqueante duro, primero de todo |
| Migración de SDK | La hace el CTO (trabajo nativo de riesgo), no la pasante |
| Distribución | Demo con APK directo → piloto publicado en Google Play |
| Infra | GCP (cuenta reactivada). El ADR Railway vs Fly.io queda obsoleto |
| `gps_points` RLS | **Se arregla ahora**, antes del piloto |
| Licencia Transistorsoft | Trial para el spike; comprar los US$399 solo si da GO |
| Fechas | Se pueden reasignar los targets en Linear |

---

## Estado verificado (auditado el 2026-08-14)

### Linear: 15 issues abiertas, 53 puntos

| Milestone | Target | % | Abiertas |
|---|---|---|---|
| M0 Fundaciones + Spike GPS | 2026-08-10 ❌ vencido | 64% | QUI-216 (8), QUI-213 (3), QUI-212 (2) |
| M1 Núcleo administrativo | 2026-08-30 | 93% | QUI-340 (3, Valentina) |
| M2 Rotaciones | 2026-09-13 | 100% | — |
| M3 App móvil + sync | 2026-10-18 | 78% | QUI-237 (8, **Backlog sin ciclo**), QUI-346 (2) |
| M4 Dashboard/reglas | 2026-11-08 | 92% | QUI-342 (2, Valentina) |
| M5 Hardening + piloto | 2026-11-20 | 30% | QUI-250 (3), QUI-252 (3), QUI-253 (5), QUI-339 (2), QUI-347 (3) |
| M6 Sprint UI/UX Mobile | 2026-08-10 ❌ vencido | 84% | QUI-348 (3), QUI-336 (3), QUI-338 (3) |

Valentina: 8 issues / 21 pts, ya secuenciados de C15 a C21.
CTO: 7 issues / 32 pts acá, **más 90 pts en otros 3 proyectos** (QUIVO Pay).

### El gate GPS: por qué estuvo parado un mes

- **La licencia nunca fue el bloqueo.** Transistorsoft funciona completo en builds debug sin
  key, y hay trial de 30 días para release. El **paso 1 de `docs/spike-gps.md` está mal
  escrito** y por eso nadie corrió el spike. Hay que corregir ese documento.
- **El teléfono de gama baja ya se consiguió.**
- **Tres bugs de configuración harían fallar el spike igual**, con licencia o sin ella:

| Bug | Archivo | Consecuencia |
|---|---|---|
| Faltan `stopOnTerminate`, `startOnBoot`, `enableHeadless` | `apps/mobile/src/gps/background-geolocation.config.ts` | Los defaults son `stopOnTerminate: true` / `startOnBoot: false`: el tracking **muere al cerrar la app y no vuelve tras el reboot**. Es exactamente el criterio C del GO |
| No hay headless task registrado | `apps/mobile/index.js` | Con la app terminada, **nada escribe en `quivo-outbox.db`** — la fuente de la evidencia de sanciones |
| `logLevel: LOG_LEVEL_VERBOSE` | mismo config | Escribe a SQLite en cada tick durante las 8 h de medición |

### Por qué hay que migrar el SDK antes de correr el spike

**Google Play exige API 36 desde el 2026-08-31** (extensión hasta el 2026-11-01). Expo SDK 52
da API 34, así que hoy la app **no se puede publicar ni actualizar**.

**Expo SDK 54** es la única versión que cumple las dos condiciones a la vez: la primera con
`targetSdkVersion 36`, y la última que permite `newArchEnabled: false`.

Arrastra una segunda migración: **Transistorsoft 4.19.4 → 5.4.0**. La instalada es bridge
legacy (sin `codegenConfig`), y **solo v5 maneja bridgeless en el path del headless task** —
el corazón del producto. La licencia v4 no sirve para v5 (formato JWT); como no se compró
nada, se compra directo la v5 si el spike da GO.

Correr el spike sobre el stack actual sería validar algo que se va a tirar.

### Hallazgos de seguridad

| # | Severidad | Hallazgo |
|---|---|---|
| 1 | **CRÍTICO** | **`gps_points` no tiene RLS ni columna `sindicatoId`.** Verificado: 15 tablas tienen `FORCE ROW LEVEL SECURITY`, la de evidencia GPS ninguna. Hoy el aislamiento es solo de aplicación (filtra por `sesion_id` tras resolver `sesionOperativa`). Cualquier consulta futura que lea la tabla directo filtra evidencia entre sindicatos sin que Postgres lo impida |
| 2 | ALTO | **8 servicios** hacen `findUnique({where:{id}})` sin filtro por `sindicatoId`: socios, vehiculos, conductores, lineas, reglas, sanciones, rotaciones, variantes. La decisión #3 del CTO cubría solo `socios` |
| 3 | ALTO | El refresh del panel web **no rota el token** (el móvil sí, con compare-and-swap atómico). Un refresh robado sirve hasta 30 días |
| 4 | ALTO | `JWT_SECRET` sin guardarraíl de arranque, y su default está en `CREDENCIALES.md` y `.env.example` |
| 5 | ALTO | SQLite del móvil sin cifrar — ahí vive la evidencia GPS pendiente de sincronizar |
| 6 | MEDIO | `audit_log` sin `ip`/`userAgent` ni `REVOKE UPDATE/DELETE`; los GET no se auditan; sin `pnpm audit` en CI; CSV sin protección contra inyección de fórmulas; sin helmet/CSP |

**Bien resuelto, no tocar:** RLS en las 15 tablas, tenant siempre del JWT, 17 controllers con
guards, auth móvil con rotación atómica y mitigación de timing attack, rate limiting, CORS
restrictivo, sin SQL injection, redacción de logs.

### Hallazgos de escalabilidad y fiabilidad

La ingesta GPS está **mejor de lo esperado**: worker BullMQ en proceso separado, insert
multi-row con SQL crudo, idempotencia `ON CONFLICT (event_id, ts)`, límite de 500 eventos por
lote validado con Zod, gzip con `pako` (resuelve un problema real de OkHttp en Android),
particiones diarias con función plpgsql propia, y backoff exponencial en el cliente.

Las brechas:

| Brecha | Detalle |
|---|---|
| **Load test nunca ejecutado** | `tests/load/k6/` está escrito y completo, pero necesita staging real |
| **Archivado GPS nunca ensayado** | Implementado entero, pero `GPS_ARCHIVE_ENABLED=false` y sin bucket |
| **Sin infraestructura como código** | No hay `Dockerfile` ni manifiesto de deploy de ningún tipo |
| **Sin graceful shutdown** | `enableShutdownHooks()` nunca se llama, aunque hay `OnModuleDestroy` en 4 servicios |
| **Sentry solo en la API** | Ausente en web y móvil, pese a estar declarado "imprescindible en móvil" |
| **Sin paginación** | En socios/vehiculos/conductores (2000–3000 vehículos) y en `GET /v1/reportes/recorridos` (`LIMIT 100` fijo) |
| **Concurrencia del worker en 1** | Default de BullMQ, sin verificar contra el volumen objetivo |
| Sin `connection_limit` ni PgBouncer | Dos pools independientes (Prisma + el de HealthService) |

---

## Arquitectura de despliegue en GCP

> **Formalizada en [ADR 0002](adr/0002-gcp.md) (2026-08-14), con dos cambios respecto de lo que
> decía este plan:** la región quedó en **`southamerica-west1` (Santiago)**, no São Paulo — se
> midió la latencia y es la mitad — y **`apps/web` va en Cloud Run, no en Firebase App Hosting**,
> que no tiene ninguna región sudamericana. El ADR es la fuente de verdad; esto queda como
> contexto.

```
                        southamerica-west1 (Santiago)
Internet ──▶ Cloud Run: apps/api (min-instances=1)
     │            │ Direct VPC egress
     │ ┌──────────┼──────────────┐
     │ ▼          ▼              ▼
     │ Cloud SQL  Memorystore  Secret Manager
     │ PG16+PostGIS Redis Basic (RUNTIME_DATABASE_URL,
     │              │            JWT_SECRET, R2)
     │              │ BullMQ
     │     Cloud Run WORKER POOL ── ingesta GPS (always-on, 1 instancia)
     │     Cloud Run JOB ── retención GPS (batch) ──▶ Cloudflare R2
     │            ▲
     │            └── Cloud Scheduler (southamerica-east1) · 1 disparo/día
     │
     └──▶ Cloud Run: apps/web (Next.js 15)
```

**Decisiones y por qué:**

- **Worker de ingesta → Cloud Run Worker Pools.** Hallazgo clave: llegó a **GA en abril de
  2026**, y es exactamente el caso de uso — instancias persistentes que consumen una cola, sin
  modelo de request. Con un Cloud Run *service* normal el worker moriría por falta de tráfico.
  Ojo: los worker pools son de **escalado manual**, no autoscalan por profundidad de cola. Para
  el piloto, 1 instancia fija sobra.
- **Retención GPS → Cloud Run Job + Scheduler**, no worker pool: es batch periódico, no
  consumidor continuo.
- **Postgres → Cloud SQL, no AlloyDB.** PostGIS está soportado (`CREATE EXTENSION postgis`).
  AlloyDB recién empata en costo pasando ~1.75 TiB; estamos lejos.
- **RLS en Cloud SQL: funciona.** El usuario `postgres` de Cloud SQL **no es superusuario
  real** (es `cloudsqlsuperuser`), así que `CREATE ROLE quivo_app` sin BYPASSRLS y
  `FORCE ROW LEVEL SECURITY` se comportan igual que en Postgres vanilla. **Verificar corriendo
  `packages/db/src/rls.integration.test.ts` contra la instancia real de Cloud SQL**, no solo
  contra el Docker local.
- **Archivado → seguir en Cloudflare R2**, no GCS. Es la única pieza deliberadamente fuera de
  GCP, y es decisión consciente: el egreso de R2 es **$0 permanente** contra ~$0.12/GB de GCS,
  y evita un footgun conocido (las versiones recientes del AWS SDK activan checksums que rompen
  contra GCS salvo que se seteen dos variables de entorno). Cero cambio de código.
- **IaC → Terraform**, no scripts de `gcloud`. La razón es concreta: da un `plan`/diff
  revisable antes de tocar infra, que es la barandilla que importa con una pasante junior en el
  equipo. Mismo flujo de PR que ya usa el código.
- **Secretos → Secret Manager** con service account dedicada de mínimo privilegio, y el
  permiso `secretAccessor` otorgado **antes** del primer deploy (Cloud Run valida el acceso en
  tiempo de deploy y falla si no está).

**Trampa principal a resolver antes de producción:** Cloud SQL tiene límite de conexiones y el
proyecto **no tiene PgBouncer ni `connection_limit` explícito**. Con la API escalando
horizontalmente más dos workers, un burst de reconexión de flota puede agotar las conexiones de
un tier chico. Mitigación mínima para el piloto: `connection_limit` explícito en la URL y
`max-instances` capado.

**Costo (verificado contra precio de lista el 2026-08-14):** **~US$255–290/mes** para el piloto
— el ~US$160–230 que decía este plan estaba corto. La causa no es la región (Santiago salió más
barato que São Paulo) sino el sizing: **Cloud SQL 2 vCPU/8 GB es la línea dominante y está
sobredimensionada para 40 vehículos**. Decidir el tier con el resultado del k6 (QUI-250). El
objetivo del documento técnico (US$50–150/mes) **no es alcanzable** con servicios gestionados en
región sudamericana. Detalle y palancas en el ADR 0002.

**Región: `southamerica-west1` (Santiago), decidida y medida.** El lean por São Paulo de este
plan se apoyaba en dos supuestos que resultaron falsos. Latencia real desde La Paz (AXS Bolivia,
12 requests sobre una conexión TLS reusada): **Santiago 52 ms · São Paulo 110 ms · us-east4
199 ms · us-central1 230 ms**. Y en precio, Cloud Run es de 2 tiers (idéntico en ambas), pero
Cloud SQL es 6,7% y Redis 19,5% más baratos en Santiago. Gana en las dos dimensiones a la vez.
Los dos gaps de Santiago no bloquean: **Cloud Scheduler** no existe ahí (se pone en São Paulo, es
1 disparo diario) y **Firebase App Hosting** no tiene región sudamericana (se sacó de la
arquitectura). **Cloud Run Worker Pools sí corre en Santiago**, verificado en vivo contra la API
con `validateOnly=true`, no inferido de la doc.

---

## Dos hallazgos nuevos del diseño (verificados)

1. **`usesCleartextTraffic: true`** (`apps/mobile/app.json:11`). Hoy es inofensivo porque todo
   es localhost. En el piloto, evidencia GPS y PINs de conductor salen a internet desde
   teléfonos en la calle, muchos sobre WiFi público. Es **una línea**. Verificado: ningún
   cliente usa `http://` hoy, así que apagarlo no rompe nada.

2. **Google Play tiene un camino crítico externo que nadie contó.** La app pide
   `ACCESS_BACKGROUND_LOCATION`, y ese permiso exige declaración de uso + **video
   demostrativo** + revisión manual, con **1 a 3 semanas de espera y rechazos frecuentes en la
   primera vuelta**. No depende de nadie del equipo. Si se arranca cuando la app está lista, el
   piloto se corre por un trámite.
   → **El trámite arranca esta semana (C14)** con el APK que haya, en paralelo.
   → **El piloto de campo NO depende de Play**: se distribuye por APK release firmado
   (sideload), que ya estaba decidido para la demo. Play corre como track paralelo y se publica
   cuando apruebe.

---

## Los cuatro números que gobiernan el plan

| Número | Valor | Consecuencia |
|---|---|---|
| Carga del piloto vs. de diseño | 40 vehículos ≈ **1,3%** de los 8,6M pts/día de diseño | Justifica casi todos los recortes de escalabilidad. El piloto ejerce la **operación**, no el sistema |
| Tenants en el piloto | **1** | Baja el riesgo de los hallazgos de *aislamiento*. **No baja nada** el de los de *autenticación*. Esto reordena el triaje de seguridad |
| Trabajo real pendiente | **~95 pts**, no 53 | Linear no tiene tiqueteados ~44 pts: infra GCP, Dockerfiles, migración de SDK, trámite de Play, seguridad de despliegue |
| Camino crítico | **1 persona (CTO), 0 paralelizable** | Valentina no puede tocar el camino crítico. Su valor es liberar al CTO de todo lo demás; su costo es el review |

---

## Camino crítico

```
C14 ─┬─ Licencia TS v5 (trial ya; comprar si hay GO) · Cuenta Play + declaración background
     ├─ Fix docs/spike-gps.md + 3 bugs de config + headless task        │ (paralelo, externo)
C15 ─┴─ Migración Expo SDK 52→54 + Transistorsoft 4.19.4→5.4.0          │
C16 ─── QUI-216 SPIKE GPS ◄── GATE D1 (GO/NO-GO)                        │
C17-18 ─ QUI-237 tracking producción · Dockerfiles · QUI-213 GCP        │
C19 ─── Seguridad de despliegue (JWT, refresh, gps_points RLS, audit)   │
C20 ─── k6 contra staging · Build release firmado ──────────────────────┘
C21 ─── Demo APK al sindicato · seed · consentimiento
C22-23 ─ PILOTO EN CAMPO (2 semanas)
C24 ─── Acta, encuesta, feedback → issues
```

**Dependencias duras:** migración → spike → QUI-237 · Dockerfiles + `enableShutdownHooks` →
GCP → k6 y preflight → piloto · `JWT_SECRET` y `RUNTIME_DATABASE_URL` → primer deploy.

---

## Fases

### F0 — Desbloqueo (C14, esta semana) · CTO · 7 pts
- **N1** (3): corregir el paso 1 de `docs/spike-gps.md` + los 3 bugs de config + registrar el
  headless task en `index.js`.
- **N4** (1): licencia trial v5 en EAS secrets (comprar los US$399 solo si el spike da GO).
- **N21** (2): cuenta de Play + declaración de background location + política de privacidad +
  Data Safety. **Arranca el reloj externo.**
- **N19** (1): anular el ADR 0001 (Railway vs Fly) y escribir el ADR 0002 — GCP.
- Cerrar **QUI-212** (branch protection imposible en plan free).

### F1 — Migración y gate (C15–C16) · CTO · 16 pts
- **N2** (8): Expo SDK 52→54 + Transistorsoft **5.4.0 exacto** (sin `^`), `newArchEnabled: false`.
- **QUI-216** (8): el spike de 8 h en el teléfono. **Gate D1.**

### F2 — Producción móvil e infra (C17–C18) · CTO · 16 pts
- **QUI-237** (8): tracking GPS en producción. Sacar del Backlog y asignar ciclo.
- **N6** (3): Dockerfiles (una imagen, dos `CMD`) + `enableShutdownHooks()` + separar
  liveness/readiness.
- **QUI-213** (5, rescopeada de 3): GCP — Cloud Run API + Worker Pool, Cloud SQL PostGIS,
  Memorystore, Secret Manager, Terraform.

### F3 — Seguridad de despliegue (C19) · CTO · 11 pts
- **N8** (3): `sindicatoId` + RLS en `gps_points`.
- **N10** (2): rotación de refresh token en el panel web (portar el patrón del móvil).
- **N15** (2): `audit_log` — `REVOKE UPDATE/DELETE` + columnas `ip`/`userAgent`.
- **N16** (2): concurrencia del worker configurable + `connection_limit` explícito.
- **N22** (2): paginación real de `GET /v1/reportes/recorridos` + tope `take` 500 en listados.
- **N18** (1): prueba negativa de RLS — romper una policy y confirmar que el test se pone rojo.

### F4 — Verificación y build (C20) · CTO · 11 pts
- **QUI-250** (3, rescopeada): k6 a **5× la carga del piloto**, gate = `lostEvents = 0`,
  `syncErrors = 0`, cola drenada. El escenario completo de 300 pts/s corre igual, pero
  **informativo**, no gate.
- **N5** (5): build release firmado + EAS + closed testing en Play.
- **N17** (2): Sentry en `apps/mobile` con release tagging.

### F5 — Preparación (C21) · CTO · 4 pts
- **N7** (2): seed del sindicato piloto en staging + runbook de backup/restore + **segundo
  tenant de prueba** (el checklist exige probar aislamiento y hoy ese tenant no existe).
- **QUI-252** (1, rescopeada de 3): verificar que las particiones diarias se crean solas y
  medir crecimiento real. El archivado a R2 se difiere.
- **N20** (1): reescribir el checklist del piloto (ver abajo).

### F6 — Piloto (C22–C24) · CTO + Valentina · 5 pts
- **QUI-253**: 1 línea, 8–15 vehículos, 2–4 semanas, ≥100 jornadas completas.

---

## Qué NO entra al piloto, y por qué

| Recorte | Justificación |
|---|---|
| **Flip a New Architecture** (PR 2) | `newArchEnabled: false` cumple Play con SDK 54 — por eso se eligió ese SDK. El flip es riesgo puro sobre el headless task, que es el corazón del producto, a cambio de cero beneficio para el piloto → M7 |
| **Archivado GPS a R2** | Dispara a los 6 meses; el piloto dura 2–4 semanas y genera ~350 MB. Bucket, IAM, versionado y ensayo de restauración por un beneficio de cero → M7 |
| **Paginación de socios/vehículos/conductores** | Se resuelve operativamente: **al piloto se carga la muestra** (1 línea, 8–15 vehículos), no el padrón completo. Con ~50 filas la paginación no aporta. Se agrega un tope `take` 500 con aviso para que degrade visible en vez de morir en silencio |
| **k6 al escenario completo como gate** | Lo que importa a cualquier escala es la **correctitud** de la ingesta; el throughput de diseño no le importa a un piloto del 1,3%. Se corre igual, como insumo de sizing |
| **Cifrado de la SQLite móvil** | Los tokens ya están en SecureStore. Lo que queda son puntos GPS pendientes y la ruta del día. Contra un **conductor adversario con root**, SQLCipher no sirve: la llave vive en el mismo dispositivo. Esa amenaza ya está cubierta del lado correcto — el worker **re-valida** los puntos server-side con `ST_DWithin`. Se declara como riesgo residual en el consentimiento → M7 |
| **helmet/CSP, `pnpm audit` como gate, auditar GETs, Sentry web, CSV injection** | Panel interno, 1 tenant, ~5 admins de confianza. `pnpm audit` entra como job `continue-on-error` para tener la señal sin bloquear CI en semana de piloto → M7 |
| **OSRM en GCP** | Solo se usa para pegar rutas a las calles en el editor. Requiere una VM dedicada con el extracto vial de Bolivia. Para el piloto **se dibujan las rutas una vez con OSRM local y se siembran**. Editor degradado en staging, documentado |
| **PgBouncer, réplicas de lectura** | Palancas para 3000 vehículos. Con 40, el pool default sobra |

---

## Triaje de seguridad: qué bloquea el piloto

**El criterio:** un solo tenant baja mucho el riesgo de los hallazgos de *aislamiento*, y **no
baja nada** el de los de *autenticación*. Eso reordena la lista respecto de la severidad técnica.

| Hallazgo | ¿Bloquea? | Razón |
|---|---|---|
| **`JWT_SECRET` sin guardarraíl**, default publicado en `CREDENCIALES.md` y `.env.example` | **SÍ — el más grave** | Único hallazgo que **un solo tenant no atenúa**. RLS confía en los claims del JWT: con el secreto por default en un repo, cualquiera forja un token de admin y **RLS deja de ser barrera**. El momento de exposición es exactamente el que viene: el primer deploy a IP pública. Replicar el patrón que ya existe en `client.ts:56-64`. Bajar `JWT_REFRESH_TTL` de 30d a 7d |
| **`usesCleartextTraffic: true`** | **SÍ** | Evidencia legal y PINs en tránsito desde la calle. 1 línea |
| **Refresh web sin rotación** | **SÍ** | Primera exposición a internet. Token robado = 30 días de acceso a padrón, evidencia y sanciones, sin detección de reuso. El móvil ya lo hace bien: es portar un patrón, no inventarlo |
| **`gps_points` sin RLS** | **SÍ, pero por costo** | Con 1 sindicato la fuga es imposible: no hay a quién filtrarle. **La razón es el costo**: hoy la tabla está vacía y es `ADD COLUMN` + policy; en 3 meses son ~90 particiones diarias y un backfill con downtime |
| **8 servicios sin filtro por `sindicatoId`** | **NO** | Defensa en profundidad, no agujero abierto: RLS está activo y **detecta** (12 de 14 tests en rojo al conectar con el rol equivocado). Se hace igual porque es barato y mecánico → Valentina |
| **SQLite móvil sin cifrar** | **NO** | Ver recortes |
| **`audit_log` sin `REVOKE`/`ip`** | **Parcialmente** | El `REVOKE` entra: el piloto genera sanciones reales, y un log append-only por Postgres —no por convención de aplicación— es lo que hace defendible una sanción |

---

## Asignación

### El problema de la secuencia actual de Valentina

Sus 4 issues móviles (QUI-336, 348, 338, 346) están en C15–C17, **exactamente la ventana en que
el CTO reescribe `apps/mobile` entero**: `package.json`, `app.json`, lockfile, `index.js` y un
salto de React 18.3.1 → 19.1 que cambia tipos. Resultado si no se cambia: conflictos de
lockfile, su dev-client roto a mitad de semana, y UI escrita contra tipos que van a cambiar.

**Regla operativa: `apps/mobile` queda congelado para Valentina desde que se abre el PR de
migración hasta que mergea.**

| Ciclo | Valentina | Pts |
|---|---|---|
| C15 | QUI-336 (lunes/martes, antes del freeze) → **QUI-339** ← adelantada de C18 | 3+2 |
| C16 | **QUI-347** ← de C18 · **N9** filtro `sindicatoId` en 8 services | 3+2 |
| C17 | **QUI-340** E2E ← de C19 · **N11** guardarraíl `JWT_SECRET` · **N13** cleartext | 3+1+1 |
| C18 | **QUI-342** dashboard ← de C21 | 2 |
| C19 | **QUI-348** bugs M6 → atrasada (freeze) | 3 |
| C20 | **QUI-346** indicadores de sync → atrasada | 2 |
| C21 | **QUI-338** estados de error → atrasada | 3 |
| C22–24 | Soporte del piloto: feedback de campo → issues | — |

**25 pts / 7 ciclos = 3,6 pts por ciclo.** Deliberadamente liviano: el cuello de botella no es
su capacidad, es **el review del CTO** — cada PR suyo consume tiempo del camino crítico.

QUI-340 (E2E Playwright) se adelanta a C17 porque es la red que protege el panel admin cuando
el CTO esté en campo y no pueda regresionar a mano.

### CTO: ~70 pts en 11 ciclos ≈ 6,4 pts/ciclo

El promedio es sostenible; **la distribución no**. C15–C18 concentran 32 pts en 4 semanas, y
son las mismas 4 semanas con 90 pts abiertos en otros 3 proyectos. **Esas cuatro semanas no
tienen colchón**: si algo se cae, se cae ahí, y el corrimiento es 1:1 sobre la fecha del piloto.

---

## Fechas propuestas en Linear

**Piloto de campo: 5 al 19 de octubre. Acta: 26 de octubre.** Banda honesta: **P50 = 5-oct,
P80 = 19-oct** (dos ciclos de corrimiento).

| Milestone | Actual | Propuesto | Qué lo cierra |
|---|---|---|---|
| M0 Fundaciones + Spike | 2026-08-10 ❌ | **2026-08-31** | QUI-216 con veredicto escrito, N1/N2/N4/N19 |
| M1 Núcleo administrativo | 2026-08-30 | **2026-09-07** | QUI-340 |
| M2 Rotaciones | 2026-09-13 | **2026-07-31** (fecha real) | Ya completo — una fecha futura sobre trabajo terminado distorsiona el reporting |
| M4 Dashboard/reglas | 2026-11-08 | **2026-09-14** | QUI-342 |
| M3 App móvil + sync | 2026-10-18 | **2026-09-28** | QUI-237 + QUI-346 |
| M6 Sprint UI/UX Mobile | 2026-08-10 ❌ | **2026-10-05** | QUI-336 + QUI-348 + QUI-338 |
| M5 Hardening + piloto | 2026-11-20 | **2026-10-26** | QUI-253 con acta firmada |
| **M7 (nuevo)** Post-piloto: escala y deuda | — | **2026-11-30** | Todo lo recortado arriba |

**Target del proyecto: 2026-11-20 → 2026-10-26.** Hoy M1/M2/M4 están al 93/100/92% con targets
en el futuro mientras M0 y M6 están vencidos: las fechas se fijaron como roadmap lineal y nunca
se ajustaron. El re-targeting hace que cada fecha signifique "cuándo aterriza lo que falta".

---

## Contingencia si el spike da NO-GO

**El error a evitar es tratar NO-GO como un evento único.** Son 4 criterios, cada uno falla por
una causa distinta con una respuesta distinta. Saltar al módulo Kotlin ante cualquier falla
sería el peor error del proyecto.

| Modo de falla | Respuesta | Costo | Fecha |
|---|---|---|---|
| **Batería > 5%/8h** | Tuning (intervalo 10→15/20s, `distanceFilter` 50→75m, accuracy HIGH no NAVIGATION). Y renegociar el requisito: ¿es "<5%" o "el teléfono sobrevive la jornada"? La mayoría lleva el teléfono en soporte con cargador | 2–3 pts | +1 ciclo |
| **Huecos > 2 min** | Casi siempre battery killers de OEM, no la librería. Tuning + onboarding que lleve al conductor a la whitelist de optimización de batería del fabricante. Es UX, no rewrite nativo | 3–5 pts | +1 a +2 ciclos |
| **No sobrevive kill/reboot** | Es lo que arregla N1. Si falla *después* de N1: verificar que el headless task escribe en `quivo-outbox.db`, probar otro patch de v5, escalar a soporte (la licencia paga lo incluye) | 3–5 pts | +1 a +2 ciclos |
| **Crashes categóricos de v5 en el hardware objetivo** | Único caso de Plan B real | ver abajo | — |

### Plan B (solo el último caso): módulo Kotlin — **~31 pts, 5–7 semanas**

Lo que cuesta no es el Foreground Service (3–5 días), es todo lo demás: supervivencia a Doze y
battery killers por OEM (8), `BOOT_COMPLETED` + persistencia (5), muestreo adaptativo por
motion-activity —indispensable para cumplir el <5% de batería— (5), TurboModule y entrega
headless (5), flujo de permisos (3).

**Y un detalle que suele omitirse:** `ForegroundServiceDidNotStartInTimeException` es
comportamiento del SO con API 36, **no un bug de Transistorsoft**. Un servicio hecho a mano lo
sufre igual. Plan B no elimina el riesgo salvo que el NO-GO sea atribuible a la librería.
Impacto en fecha: +6 a +10 semanas → con fiestas de por medio, **febrero de 2027**.

### Recomendación ante un NO-GO categórico: **no construir Plan B antes del piloto**

Correr un **piloto reducido sin tracking en background**: el teléfono en soporte con cargador
—el setup real de la mayoría de los conductores— y tracking en foreground. Eso valida **todo lo
demás**: login por vehículo, paquete del día offline, detección de puntos de control, outbox,
sync idempotente, reconstrucción de recorridos, sanciones con evidencia, y sobre todo la
**adopción por conductores no técnicos**, que es el riesgo de producto más grande y del que
nadie tiene datos. Se difiere una sola propiedad: durabilidad con pantalla apagada. Y Plan B se
construye después con feedback de campo, sabiendo qué frecuencia y precisión hacen falta de
verdad. Costo: ~2 pts (`expo-keep-awake` ya está instalado) y un párrafo en el consentimiento.

---

## Criterios de aceptación del piloto

`docs/piloto/checklist-aceptacion-e2e.md` **es bueno** (90 líneas, orientado a evidencia, cubre
el flujo E2E real y la adopción). **No alcanza** — le faltan seis cosas, y una decide si el
piloto "salió bien":

1. **Umbrales numéricos.** Hoy son checkboxes binarios sin una cifra. Propuesta: ≥95% de
   jornadas reconstruibles · **0** eventos perdidos tras drenar la cola · ≤2% de puntos de
   control con corrección manual · mediana de batería <5%/8h **sobre todos los teléfonos**, no
   solo el del spike · p95 de latencia de sync tras recuperar red <5 min · ≥90% de jornadas
   iniciadas sin pedir ayuda.
2. **Alcance definido**: 1 línea, 8–15 vehículos, 2–4 semanas, ≥100 jornadas. Sin esto, "salió
   bien" es infalsificable.
3. **Criterios de aborto**: pérdida de evidencia que sustente una sanción ya emitida · crash
   rate >2% de sesiones · cualquier teléfono inutilizable para el trabajo del conductor. Con el
   fallback manual del sindicato para ese día.
4. **Línea de base**: correr el proceso manual del sindicato en paralelo la primera semana. Sin
   baseline no se puede demostrar valor, que es la razón comercial del piloto.
5. **Compromiso sobre los datos**: plazo de borrado, retención y accesos si el sindicato
   rechaza. Con ubicación de personas, eso va en el documento, no en una conversación. El
   formulario de consentimiento se referencia pero no existe como artefacto.
6. **Observabilidad como gate**: Sentry móvil con release tagging, dashboard de profundidad de
   cola / `sync_errors` / crecimiento de particiones, y alerta si el worker deja de drenar. Hoy
   **nadie se enteraría de un worker trabado** hasta que el administrador reclame — con
   conductores en la calle, eso es horas de evidencia perdida.

Además hay que reescribir el "Gate previo": sacar el archivado GPS (recortado a M7), calificar
la escala del k6, y **crear un segundo sindicato en staging** — el checklist exige dos veces
probar aislamiento contra otro sindicato, y ese sindicato no existe.

---

## Puntos de decisión abiertos

| # | Cuándo | Decisión |
|---|---|---|
| **D0** | Miércoles de C15 | **¿La migración compila y trackea en debug?** Si no: el piloto corre sobre SDK 52 + TS v4 **por sideload** (Play exige API 36 solo para apps distribuidas por Play). Se pierde la validación del stack final, se gana el feedback del sindicato 4–6 semanas antes |
| **D1** | Fin de C16 | **GO/NO-GO del spike** |
| **D2** | C14 | **¿Cuenta de Play personal u organización?** Personal exige 12 testers × 14 días de closed testing antes de producción — si es personal, el reclutamiento arranca en C16, no en C20 |
| **D3** | C21 | **¿Padrón completo o muestra?** De esto depende que el recorte de paginación sea válido o deuda que explota en campo. Recomendación: la muestra |

**Riesgo no técnico y el menos gestionado:** cuando se escribió este plan, ninguna de sus tareas
conseguía el sindicato piloto. **Cerrado el 2026-08-15 con [QUI-369](https://linear.app/quivo-tech/issue/QUI-369/conseguir-y-comprometer-al-sindicato-piloto)**
(CTO, C14, Urgent): identificar 2–3 candidatos, comprometer uno por escrito con alcance y
consentimiento de datos, y acordar la línea de base manual de la primera semana. Bloquea a
QUI-366 (seed) y a QUI-253 (piloto). **Identificarlo y comprometerlo en C14–C15, no en C21** —
es la dependencia más larga y la única que no se destraba escribiendo código.

---

## Archivos críticos

| Archivo | Qué cambia |
|---|---|
| `apps/mobile/src/gps/background-geolocation.config.ts` | Faltan `stopOnTerminate: false`, `startOnBoot: true`, `enableHeadless: true`; bajar `logLevel` |
| `apps/mobile/index.js` | Falta `BackgroundGeolocation.registerHeadlessTask` que escriba en `quivo-outbox.db` |
| `apps/mobile/package.json` + `app.json` | SDK 52→54, TS `4.19.4`→`5.4.0` exacto, licencia v5, `usesCleartextTraffic: false` |
| `packages/db/src/auth.ts:26` | `JWT_SECRET` sin guardarraíl — replicar el patrón de `client.ts:56-64` |
| `apps/api/src/modules/auth/auth.service.ts:50-58` | `refresh()` devuelve el mismo token — portar el compare-and-swap de `auth-movil.service.ts:275` |
| `packages/db/prisma/migrations/` | Migración nueva: `sindicatoId` + RLS en `gps_points` |
| `apps/api/src/main.ts` | Falta `enableShutdownHooks()` — sin él los `OnModuleDestroy` no corren ante el SIGTERM de Cloud Run |
| `docs/spike-gps.md` | El paso 1 es falso y costó un mes de bloqueo |
| `docs/piloto/checklist-aceptacion-e2e.md` | Reescribir el gate previo; agregar umbrales, alcance, aborto y baseline |
| *(nuevos)* `Dockerfile`, `infra/*.tf` | Una imagen con dos `CMD` (API y worker); Terraform con state en GCS |

---

## Verificación

**Del gate GPS (D1):** los 4 criterios de `docs/spike-gps.md` medidos sobre **SDK 54 + v5.4.0**,
en el teléfono real, con la tabla de resultados completada y veredicto escrito. Verificación
barata previa (~1 día): build debug de dev-client, tracking 2–4 h con la app terminada.

**Del deploy:** `packages/db/src/rls.integration.test.ts` **contra la instancia real de Cloud
SQL**, no contra el Docker local — es la única forma de confirmar que `FORCE ROW LEVEL SECURITY`
se comporta igual con `cloudsqlsuperuser`. Más: arrancar sin `JWT_SECRET` debe fallar
ruidosamente; arrancar sin `RUNTIME_DATABASE_URL` ya falla.

**De la ingesta:** k6 a 5× la carga del piloto con `lostEvents = 0`, `syncErrors = 0` y cola
drenada, verificado con `tests/load/k6/verify-ingestion.mjs`.

**Del piloto:** los seis criterios numéricos de arriba, medidos, con acta firmada — separando
**go/no-go técnico** (firma el CTO) de **aceptación del sindicato** (firma el responsable
operativo). Hoy el checklist mezcla las dos firmas.

**De cada PR:** CI verde (`ci` + `acceptance`), `/code-review` antes de cerrar, y
`/security-review` en los PRs de F3, que tocan auth y RLS.
