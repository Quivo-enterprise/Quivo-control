# Deuda abierta — hallazgos vivos sin documento propio

> Creado el 2026-08-19 al archivar `plan-finalizacion-piloto.md`. Ese plan quedó anulado por
> [`plan-piloto-lunes-17-agosto.md`](plan-piloto-lunes-17-agosto.md), pero era **la única fuente
> escrita** de los hallazgos de abajo: el plan que lo reemplaza sólo los lista como números de
> issue, sin el hallazgo ni el razonamiento.
>
> **Qué es este documento:** el registro de la deuda técnica y de seguridad que sigue abierta y
> que no vive en ningún otro lado. **Qué no es:** un plan. Alcance, fechas y asignación están en
> `plan-piloto-lunes-17-agosto.md`; el estado del día a día, en `handoff.md`.
>
> Cada ítem fue **reverificado contra el código el 2026-08-19**. Lo que ya se resolvió no está
> acá (ver § Cerrado desde entonces).

---

## Seguridad

### S1 · `audit_log` no es append-only y no registra origen — QUI-360

`packages/db/prisma/schema.prisma:318-331`: el modelo tiene `id`, `sindicatoId`, `usuarioId`,
`entidad`, `entidadId`, `accion`, `diff`, `ts`. **No tiene `ip` ni `userAgent`**, y ninguna
migración hace `REVOKE UPDATE/DELETE` sobre la tabla. Hoy el "append-only" es una convención de
aplicación, no una garantía de Postgres.

**Por qué importa:** el piloto genera sanciones reales. Un log que el propio rol de aplicación
puede editar no sostiene una sanción si el socio la discute. El `REVOKE` es la mitad barata y la
que decide.

### S2 · Los `GET` no se auditan

Sólo se auditan las mutaciones. Quién leyó el padrón, la evidencia GPS o las sanciones no queda
registrado en ningún lado. Con datos de ubicación de personas, la lectura también es un acceso.

### S3 · Ocho servicios resuelven por id sin filtrar por `sindicatoId` — QUI-355

`findUnique({ where: { id } })` sin `sindicatoId` en: **socios, vehículos, conductores, líneas,
reglas, sanciones, rotaciones y variantes**. La decisión #3 del CTO había cubierto sólo `socios`.

**No es un agujero abierto, es defensa en profundidad ausente:** RLS está activo y *detecta* —
conectando con el rol equivocado, 12 de 14 tests de aislamiento se ponen en rojo. Se hace igual
porque es barato y mecánico. Con un solo tenant en el piloto el riesgo real es bajo; el día que
entre el segundo sindicato deja de serlo.

### S4 · Sin `helmet` ni CSP en la API

Verificado el 2026-08-19: `helmet` no aparece en `apps/api`. Se recortó a conciencia para el
piloto (panel interno, 1 tenant, ~5 admins de confianza). Sigue abierto y el panel ya está
publicado en internet.

### S5 · Exportación CSV sin protección contra inyección de fórmulas

Los reportes de recorridos, sanciones y actividad se exportan a CSV sin escapar las celdas que
empiezan con `=`, `+`, `-` o `@`. Un valor cargado por un usuario puede ejecutarse al abrir el
archivo en Excel o Sheets.

### S6 · Sin `pnpm audit` en CI

No hay ninguna señal de vulnerabilidades de dependencias en el pipeline. La forma propuesta y no
implementada: un job `continue-on-error`, para tener la señal sin bloquear el merge.

### S7 · SQLite del móvil sin cifrar — riesgo residual aceptado, no resuelto

Ahí vive la evidencia GPS pendiente de sincronizar y la ruta del día (los tokens ya están en
SecureStore, eso está bien).

**Se decidió no cifrarla, y el razonamiento importa porque evita que alguien "arregle" esto mal
más adelante:** contra la amenaza real —un conductor con root en su propio teléfono— SQLCipher no
sirve, porque la llave vive en el mismo dispositivo. Esa amenaza ya está cubierta del lado
correcto: **el worker revalida los puntos server-side con `ST_DWithin`**. Lo que falta no es
cripto, es **declararlo como riesgo residual en el consentimiento**, y ese documento todavía no
existe (ver P3).

### S8 · Sentry no está en `apps/web`

Está en la API y en el móvil (QUI-365). El panel web no reporta nada: un error de JavaScript en
producción no lo ve nadie.

### S9 · La suite de aislamiento nunca se verificó rompiendo una policy — QUI-363

Registrado también en `handoff.md`. Se repite acá porque es la que valida a todas las demás: si
se rompe una policy a propósito y la suite sigue verde, el aislamiento multi-tenant es teatro.

---

## Escalabilidad y fiabilidad

### E1 · El load test nunca corrió — QUI-250

`tests/load/k6/` está escrito y completo (`sync-ingestion.js`, `verify-ingestion.mjs`,
`monitor-queue.mjs`, `run-sync-ingestion.sh`). Nunca se ejecutó, ni antes ni durante el piloto.

**Criterio de gate acordado, que no está en ningún otro documento:**

| Qué se corre | Rol |
|---|---|
| **5× la carga del piloto** — `lostEvents = 0`, `syncErrors = 0`, cola drenada | **Gate.** Verificado con `tests/load/k6/verify-ingestion.mjs` |
| El escenario completo de diseño (300 pts/s) | **Informativo**, no gate — insumo de sizing de Cloud SQL |

La razón del recorte: a cualquier escala lo que importa es la **correctitud** de la ingesta; el
throughput de diseño no le importa a un piloto que ejerce el ~1,3% de la carga proyectada. Y el
tier de Cloud SQL —la línea dominante del costo, ver ADR 0002— se decide con este número.

### E2 · El archivado GPS a R2 nunca se ensayó — QUI-252

Implementado entero, pero corre con `GPS_ARCHIVE_ENABLED=false` y **sin bucket creado**. Faltan
bucket, IAM, versionado y un ensayo de restauración. Procedimiento en
[`runbooks/retencion-gps.md`](runbooks/retencion-gps.md). Dispara a los 6 meses de datos, así que
no urgía para el piloto.

### E3 · Sin paginación real — QUI-362

`GET /v1/reportes/recorridos` tiene un `LIMIT 100` fijo, y socios/vehículos/conductores listan sin
paginar (el diseño apunta a 2000–3000 vehículos). Se resolvió operativamente cargando sólo la
muestra del piloto, no el padrón completo. **Mitigación mínima pendiente:** tope `take` 500 con
aviso, para que degrade de forma visible en vez de morir en silencio.

### E4 · Concurrencia del worker de ingesta sin configurar — QUI-361

Queda en el default de BullMQ (1) y nunca se contrastó contra el volumen objetivo. Debe ser
configurable, y el número sale del k6 (E1).

### E5 · Pool de conexiones

Dos pools independientes (Prisma y el de `HealthService`) sin `connection_limit` explícito ni
PgBouncer. La trampa y la mitigación para el piloto están en
[`adr/0002-gcp.md`](adr/0002-gcp.md) — se apunta desde acá para que no se pierda el hilo.

---

### Detectado en el deploy del build 11 (2026-09-26)

- **Redis `quivo-redis` en `maxmemory-policy` `volatile-lru`.** BullMQ exige `noeviction`: con la memoria llena, Redis podría desalojar claves de jobs y se perderían lotes de sync encolados. El worker lo avisa en cada arranque. Fix de una línea, que decide el CTO: `gcloud redis instances update quivo-redis --region southamerica-west1 --project quivo-control-prod --update-redis-config maxmemory-policy=noeviction`. Hoy la instancia es de 1 GB y tiene poca carga.
- **`repeat:marcar-vencidas` en `quivo-api`: `could not renew lock` / `Missing lock`**, desde al menos el 2026-09-14. Hipótesis sin verificar: el job repetible corre en el servicio de la API, al que Cloud Run le frena la CPU fuera de las requests, así que el timer que renueva el lock se atrasa. Candidato: mover el job al worker pool.

## El gate GPS: sigue sin medirse

Los 4 criterios GO de [`spike-gps.md`](spike-gps.md) —batería <5%/8 h, sin huecos >2 min,
supervivencia a kill/reboot, informe con números reales— **siguen sin medirse con la app propia**.
QUI-216 dejó de ser gate previo y se absorbió en la prueba de campo, pero las jornadas del 17 y 18
de agosto no lo cierran: las trazas que se analizaron salieron de **Geo Tracker**, no de la app, y
el conteo de filas de `gps_points` de esas jornadas todavía no se leyó. Por eso `spike-gps.md`
sigue vivo.

### Si el resultado es NO-GO, no es un evento único

El error a evitar es tratar cualquier falla como motivo para saltar al módulo nativo. Son cuatro
modos con cuatro respuestas distintas:

| Modo de falla | Respuesta | Costo |
|---|---|---|
| Batería > 5%/8 h | Tuning (intervalo 10→15/20 s, `distanceFilter` 50→75 m, accuracy HIGH en vez de NAVIGATION). Y renegociar el requisito: ¿es "<5%" o "el teléfono sobrevive la jornada"? La mayoría lleva el teléfono en soporte con cargador | 2–3 pts |
| Huecos > 2 min | Casi siempre battery killers del fabricante, no la librería. Tuning + onboarding que lleve al conductor a la whitelist de optimización de batería del OEM. Es UX, no rewrite nativo | 3–5 pts |
| No sobrevive kill/reboot | Verificar que el headless task escribe en `quivo-outbox.db`, probar otro patch de v5, escalar a soporte de Transistorsoft | 3–5 pts |
| Crashes categóricos de la v5 en el hardware objetivo | Único caso de Plan B real | ver abajo |

### Plan B (sólo el último caso): módulo Kotlin — ~31 pts, 5–7 semanas

Lo caro no es el Foreground Service (3–5 días): es supervivencia a Doze y a los battery killers por
OEM (8 pts), `BOOT_COMPLETED` + persistencia (5), muestreo adaptativo por motion-activity
—indispensable para cumplir el <5% de batería— (5), TurboModule y entrega headless (5), y flujo de
permisos (3).

**El detalle que suele omitirse:** `ForegroundServiceDidNotStartInTimeException` es comportamiento
del SO con API 36, **no un bug de Transistorsoft**. Un servicio hecho a mano lo sufre igual. Plan B
no elimina el riesgo salvo que el NO-GO sea atribuible a la librería. Impacto en fecha: +6 a +10
semanas; con fiestas de por medio, **febrero de 2027**.

**Recomendación vigente ante un NO-GO categórico: no construir Plan B antes de terminar el
piloto.** Correr el piloto sin tracking en background —teléfono en soporte con cargador, que es el
setup real de la mayoría— valida todo lo demás: login por vehículo, paquete del día offline,
detección de puntos de control, outbox, sync idempotente, reconstrucción de recorridos, sanciones
con evidencia y, sobre todo, la **adopción por conductores no técnicos**, que es el riesgo de
producto más grande y del que nadie tiene datos. Se difiere una sola propiedad: durabilidad con la
pantalla apagada. Costo ~2 pts (`expo-keep-awake` ya está instalado) más un párrafo en el
consentimiento.

---

## Google Play: el camino crítico externo — QUI-351

La distribución se resolvió por APK sideload y Play quedó diferida, pero el reloj externo sigue
sin arrancar y **no depende de nadie del equipo**:

- La app pide `ACCESS_BACKGROUND_LOCATION`. Ese permiso exige **declaración de uso + video
  demostrativo + revisión manual**, con **1 a 3 semanas de espera y rechazos frecuentes en la
  primera vuelta**.
- **Cuenta personal vs. organización** sigue sin decidirse. Una cuenta personal exige **12 testers
  × 14 días de closed testing** antes de poder publicar en producción. Si se elige personal, el
  reclutamiento de testers hay que arrancarlo semanas antes de la fecha de publicación, no cuando
  el APK esté listo.

Si esto arranca recién cuando la app esté lista, la publicación se corre por un trámite.

---

## Criterios de aceptación del piloto: lo que el checklist todavía no cubre

[`piloto/checklist-aceptacion-e2e.md`](piloto/checklist-aceptacion-e2e.md) se reescribió el
2026-08-16 (QUI-367) e incorporó umbrales numéricos, criterios de aborto, alcance y la prueba de
aislamiento cross-tenant. **Quedaron afuera tres cosas**, y ninguna está en otro documento:

- **P1 · Línea de base.** Correr el proceso manual del sindicato en paralelo la primera semana.
  Sin baseline no se puede demostrar valor, que es la razón comercial del piloto.
- **P2 · Observabilidad como gate.** Falta un dashboard de profundidad de cola / `sync_errors` /
  crecimiento de particiones, y una **alerta si el worker deja de drenar**. Hoy nadie se enteraría
  de un worker trabado hasta que el administrador reclame — con conductores en la calle, eso son
  horas de evidencia perdida.
- **P3 · Compromiso sobre los datos.** Plazo de borrado, retención y accesos si el sindicato
  rechaza el sistema. Con ubicación de personas eso va en un documento firmado, no en una
  conversación. **El formulario de consentimiento se referencia en el checklist pero no existe
  como artefacto** (y es donde debe declararse el riesgo residual de S7).

---

## Cerrado desde entonces (para que nadie lo reabra)

Estos hallazgos del plan archivado **ya están resueltos**, verificado contra el código el
2026-08-19:

| Hallazgo original | Estado |
|---|---|
| `gps_points` sin RLS ni `sindicatoId` (era el crítico) | ✅ Migración `20260815120000_gps_points_sindicato_rls`, con la policy repetida en cada partición hija |
| `JWT_SECRET` sin guardarraíl + default publicado + TTL de 30 d | ✅ QUI-356 (PR #15), `JWT_REFRESH_TTL` a 7 d |
| Refresh del panel web sin rotación | ✅ QUI-359 — portado el compare-and-swap del móvil |
| `usesCleartextTraffic: true` | ✅ `apps/mobile/app.config.ts:37` en `false` |
| Sin `enableShutdownHooks()` | ✅ `apps/api/src/main.ts:39` |
| Sin Dockerfile ni deploy | ✅ API, worker y web en Cloud Run (`southamerica-west1`) |
| Sentry ausente en móvil | ✅ QUI-365, con release tagging y cobertura del headless task |
| Migración Expo SDK 52→54 + Transistorsoft 4.19.4→5.4.0 | ✅ APK en la calle desde el 17 de agosto |
