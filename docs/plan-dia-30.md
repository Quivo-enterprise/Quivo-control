# Plan — Preparar el día D: prueba real con 30 conductores

## Contexto

El CTO decidió saltar de 3 trufis (piloto L16) a **30 conductores reales** en un solo día de prueba (fecha la avisa
el CTO). La prueba de carga sintética del 19/10 (30 y 60 conductores, entorno efímero) pasó con margen, pero:
- no probó **login** (usó tokens pre-emitidos), ni ráfaga de arranque de turno, ni caída del worker, ni 3 instancias
  de API;
- prod sigue **ciega**: API/worker sin `SENTRY_DSN`, sin alertas, sin uptime check, sin PITR.

El mismo día D se prueban también el regreso desde Honduras y los vecinos con 2 trufis. Los datos que genere la
app (alertas, infracciones, borrados) no importan. Cuando llegue el momento, el CTO pasa placa + nombre de los 30
para crear las credenciales.

## Hallazgo principal: el login con PIN bloquea a 25 de 30 detrás de una IP

Evidencia (exploración del 19/10):
- `POST /v1/mobile/auth/sesion` (`apps/api/src/modules/auth-movil/auth-movil.controller.ts:44-47`):
  `@Throttle 5/60s`, clave = `req.ip` (ThrottlerGuard global, `app.module.ts:39,76`), en memoria, por ruta y por
  instancia (hasta 3).
- Las operadoras móviles bolivianas usan CGNAT y los choferes pueden compartir el WiFi de la parada: la IP
  compartida es probable (no medida: en la Fase 0 solo se vieron 2 teléfonos). Con 30 logins en el arranque, el
  6.º en adelante recibe 429 y la app **no reintenta** (`vehicle-login-screen.tsx`, mensaje "Espera un minuto").
- Lo mismo pasa con el login del panel web `POST /v1/auth/login` (`auth.controller.ts:224`): 5/min por IP para todo
  el personal de una oficina.
- **Lockout** (`auth-movil.service.ts:890-960`, tabla `intentos_auth_movil`): por vehículo; del 4.º fallo en adelante
  espera `min(2^(fallos-3), 60)` s. **El tope de 60 s es débil:** con la placa (pública, va pintada en el trufi) y un
  atacante con muchas IP, son ~1440 intentos/día por placa sobre 10⁶ PINs; con 30 placas en paralelo hay ~4 % de
  probabilidad diaria de acertar alguna. Hoy el límite por IP lo frena solo si el atacante usa una sola IP.
  Riesgo previo, no lo causa D; pero subir el límite por IP lo empeora si no se refuerza el lockout.
- El login legado (`/mobile/auth/vehiculo` + `/conductor`) está apagado en prod por env
  (`MOBILE_LEGACY_AUTH_ENABLED=false` en `deploy-gcp.sh:765`), pero el default del código es **encendido**
  (`auth-movil.service.ts:1220`, `!== 'false'`): si un deploy pierde la variable, el login legado vuelve solo.
- Sin problema: `refresh` y `sesion/asignacion` a 120/min por IP (30 choferes ≈ 2 refresh/min); la ruta autenticada
  limita por `deviceId` (`DispositivoThrottlerGuard`) con tope de 3000/min por IP.

## Pasos

### A. Código antes de D (Sonnet implementa en worktrees paralelos, un PR por punto)

Gates por PR: `tsc`, tests, CI `ci` + `acceptance`, `/code-review` + `/ponytail-review`; A1 suma `/security-review`.
Codex: no verificado (sin cuota hasta el 16/11).

**A1 — Login sin bloqueo por IP compartida + lockout reforzado** (bloquea D)
- Guard nuevo para `/mobile/auth/sesion`, con el patrón de `getTracker` de
  `auth-movil/dispositivo-throttler.guard.ts:193` y `reportes/en-vivo-usuario-throttler.guard.ts`:
  - clave `ip + placa normalizada` (el mismo normalizador de `PlacaVehiculoSchema` en `packages/shared`): 5/min;
  - tope por IP sola: **60/min** (30 logins + reintentos por typo);
  - placa inválida o ausente: clave por IP sola.
  - `shortcut: storage en memoria por instancia (máx 3×), pasar a Redis si se sube max-instances` (se mantiene).
- Lockout (`auth-movil.service.ts:931-952`): la curva sigue escalando después de los 60 s, con tope de **15 min**
  desde ~10 fallos seguidos. Con eso, la probabilidad de acertar una placa de 30 baja de ~4 %/día a ~0,3 %/día.
- **Dispositivo conocido:** si el `deviceId` ya tuvo una sesión exitosa en ese vehículo, la espera del lockout no
  aplica (el fallo se cuenta igual). Sirve contra el ataque de "bloquear la placa de otro chofer": el atacante no
  conoce el `deviceId`, que es aleatorio y se guarda en el teléfono. Si el chofer reinstala la app, cae en el
  lockout normal.
- Panel web `POST /v1/auth/login`: clave `ip + email` 5/min, tope por IP 20/min.
- `MOBILE_LEGACY_AUTH_ENABLED`: el default del código pasa a apagado (`=== 'true'`). Revisar que ningún test o
  `.env` dependa del default.
- Tests, extendiendo `dispositivo-throttler.guard.test.ts` y `auth-movil.service.test.ts:834`:
  - 30 placas distintas desde 1 IP → 0 respuestas 429;
  - la misma placa 6 veces → la 6.ª da 429;
  - 61 logins desde 1 IP → 429;
  - la curva del lockout llega al tope de 15 min;
  - un dispositivo conocido no espera.
- Solo servidor: no necesita OTA ni APK.

**A2 — Observabilidad** (bloquea D)
- `scripts/deploy-gcp.sh`: `SENTRY_DSN` en `--set-secrets` de `quivo-api` (l.~803) y del worker pool
  `quivo-worker` (l.~1020), desde el secret de Secret Manager `SENTRY_DSN_API`. Ya hay init condicional en
  `apps/api/src/main.ts:12` y `worker.ts:6`.
- `scripts/observabilidad-gcp.sh` (nuevo, idempotente, dry-run por defecto, lo corre el CTO). Crea:
  - canal de mail del CTO;
  - uptime check a `/v1/health/ready`;
  - alertas: 5xx de Cloud Run; CPU de Cloud SQL > 80 % por 10 min; conexiones > 80 %; disco > 80 %; memoria de
    Redis > 70 %; worker pool sin instancia o reiniciando;
  - métrica basada en logs de la cola en espera;
  - presupuesto con avisos al 50/90/100 %;
  - PITR en Cloud SQL. Verificar en la documentación si activarlo reinicia la instancia; si reinicia, correrlo fuera
    de horario.

**A3 — Pools y timeouts** (bloquea D)
- Por qué: con 3 instancias de API, cada una puede abrir hasta 10 (Prisma) + 10 (pool del health), más ~11 del
  worker: **hasta ~71 contra `max_connections=50`**. La prueba de carga corrió con 1 sola instancia y no lo vio.
- `packages/db/src/client.ts` (`new PrismaPg(...)`, l.~66): pool con `max` por variable de entorno, **8 en la API y
  5 en el worker**, `connectionTimeoutMillis` de 5 s, `statement_timeout` de 10 s en la API y 60 s en el worker
  (por `options` de conexión). Peor caso: 3×8 + 5 + 1 (retención) = 30, el 60 % de 50.
- `apps/api/src/health/health.service.ts:26-33`: deja su `Pool` propio y hace `SELECT 1` por Prisma.
- Variables nuevas en `deploy-gcp.sh` para la API y el worker.

**Fuera de antes-de-D (cambio respecto de la Fase 1 del plan de escalabilidad, con motivo):**
- A4, vencimiento de rotaciones al worker: no hay duplicado. `upsertJobScheduler` es idempotente y BullMQ entrega
  cada job a un solo worker (`vencimiento.processor.ts:35-50`). Queda para después de D.
- A5, retención GPS: hace falta un bucket + credenciales HMAC estilo S3 (`retencion-gps.service.ts:57-123`; el
  deploy no setea nada) y con 6 meses no hay nada que archivar hasta ~feb 2027 (inferido: los datos más viejos
  son de agosto). Queda para después de D, antes de enero.
- Opcionales si sobra tiempo: CHECK en `asignaciones.horario` y `cancel-in-progress` solo en PRs
  (`.github/workflows/ci.yml:9-11`).

### B. Ensayo en el entorno efímero (después de mergear A1 + A3)

`scripts/carga-efimera.sh` + `scripts/experimentos/gps/carga/conductores-reales.mjs`, extendidos por Sonnet.

Escenarios nuevos:
1. `--login-real`: el seed emite PINs y los 30 hacen `POST /sesion` en el mismo minuto desde una sola IP (la
   laptop simula el CGNAT).
2. `--offline-minutos N`: los teléfonos acumulan outbox y lo vacían todos juntos.
3. Matar el worker a mitad de la prueba: `gcloud run worker-pools update --instances=0` y después 1. Comparar los
   puntos enviados con las filas de `gps_points`.
4. API forzada a 3 instancias (`--min-instances 3`) para medir las conexiones reales.

Escalones de 30 y de 60.

Criterios de pase:
- 0 respuestas 429 en el login de los 30;
- la misma placa repetida sí da 429;
- p95 < 500 ms;
- conexiones < 35 con 3 instancias;
- 0 puntos perdidos al matar el worker;
- Redis plano;
- la cola vuelve a 0 tras la ráfaga.

Dar de baja el entorno al terminar.

### C. Datos de los 30 (cuando el CTO pase la lista)

- Generalizar `scripts/crear-piloto-linea-16.ts`. Ya tiene: solo API HTTP, dry-run por defecto, `--apply`,
  idempotente, PINs a un archivo 0600 y nunca a stdout, y el flujo anular → agregar → publicar
  (`scripts/lib/piloto-linea-16.ts` con tests). Cambia a una entrada CSV `placa,nombre`.
- Placeholders para lo que la API exige y la lista no trae: CI, licencia, socio propietario, tipo/marca/modelo/color
  y capacidad del vehículo. Mismo criterio que el piloto.
- Trampas:
  - mientras la rotación está en borrador, el login nuevo falla: crear todo antes de D y nunca el mismo día;
  - el piloto de 3 vence el 26/10 (`QUIVO_PILOTO16_HASTA`): si D es después, extenderlo;
  - el `POST /rotaciones` (generar) reparte round-robin a todos los activos del sindicato.
- Preguntas para cuando lleguen los datos: ¿qué sindicato, línea y turno(s)? ¿Valen los placeholders?

### D. Teléfonos (CTO, con un checklist imprimible que escribo yo)

- En cada teléfono:
  - APK 16;
  - OTA `4781deab` visible en Perfil (el teléfono tiene que abrirse 2 veces: una descarga, otra aplica);
  - ubicación "Permitir todo el tiempo";
  - batería sin restricción;
  - inicio automático en Xiaomi/Huawei.
- **Ensayo de login D-1:** cada chofer entra una vez. El día D no es el primer login.
- Regla del día: nadie entra con la placa de otro chofer desde otro teléfono, porque cada login cierra las otras
  sesiones del vehículo.

### E. Deploy, congelamiento y runbook

- **D-3 como tarde:** deploy `r21` (API + worker), `observabilidad-gcp.sh`, una alerta de prueba que llegue al mail,
  y un error de prueba que llegue a Sentry desde la API.
- **D-2:** congelamiento. Ni deploys ni OTAs.
- Escribo `docs/runbook-dia-30.md` con:
  - horario y roles;
  - qué miro yo en vivo con `gcloud` de solo lectura y Sentry: 5xx/429, `/sesion`, CPU/conexiones de SQL, Redis,
    cola;
  - umbrales para frenar;
  - comandos para volver atrás: `gcloud run services update-traffic quivo-api --to-revisions=<r20>=100`, la imagen
    anterior del worker pool, y `eas update:republish --group <anterior>`;
  - plan B operativo;
  - orden en la calle: 1) regreso desde Honduras; 2) vecinos con 2 trufis; 3) Molinos; 4) los 30.

### F. Después de D

- Informe de métricas reales y del tier de Cloud SQL.
- A4, A5, Fase 2 (orden por dispositivo), OSRM (VM propia), OTA desde CI.
- Desactivar el piloto de 3 si corresponde (`--desactivar --apply`).

## Orden y plazo

| Día | Qué |
|---|---|
| 1 | A1, A2 y A3 en paralelo; revisiones y fixes |
| 2 | Mergear A1–A3; B (ensayo efímero) |
| 3 | Fixes de B si los hay; runbook y checklist; C apenas lleguen los datos |
| D-3 | Deploy r21 + observabilidad (lo corre el CTO) |
| D-1 | Ensayo de login de los 30 |

**D no antes de unos 5 días desde que arranca A.**

Acciones del CTO:
- revocar el token de Sentry pegado en el chat (si no se hizo);
- crear el proyecto de Sentry para la API (Node) y cargar su DSN como secret `SENTRY_DSN_API`;
- billing account para el presupuesto;
- correr el deploy y el script de observabilidad;
- pasar la lista de placas y nombres;
- avisar la fecha.

## Al aprobar

Copiar este plan a `docs/plan-dia-30.md` con su puntero en `docs/handoff.md` (regla 8), en una rama de docs con
PR; después arrancar A1–A3.

## Verificación global

- Por PR: los gates de arriba.
- Antes de D: todos los criterios de B en pase.
- En prod después del deploy r21:
  - uptime verde;
  - la alerta de prueba llega al mail;
  - el error de prueba aparece en Sentry de la API;
  - `SHOW max_connections` y las conexiones activas bajo el 70 %;
  - un login real de 1616PIL OK.
- Día D: `/sesion` sin 429 masivos en los logs; 0 errores nuevos en Sentry de API, worker y móvil.
