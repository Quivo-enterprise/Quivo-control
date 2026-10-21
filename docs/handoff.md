# Handoff — QUIVO Control

> **Documento de estado.** Arriba, el estado real de hoy; abajo, el registro cronológico de
> cómo se llegó hasta acá, PR por PR. Se actualiza al cierre de cada iteración/PR.
>
> **Este documento registra la ejecución. La intención vive en los planes** — si los dos se
> contradicen, el plan manda sobre qué hay que hacer y este handoff sobre qué se hizo.

## Punto de retome — 2026-10-20, tarde (leer primero): fecha de D, Vecinos en la escalera, mapa de la línea

**Día D = sábado 24/10** (supuesto: "el sábado que viene", dicho el martes 20/10; si es el 31, extender el piloto L16,
que vence el 26/10). **Miércoles 21 y jueves 22/10: dos pilotos con pasantes en unos 5 trufis** (no los 30).
Calendario y propuesta de deploy en [`docs/runbook-dia-30.md`](runbook-dia-30.md): r21 **antes** del piloto del 21 para
que esos dos días lo prueben en la calle; congelamiento después del piloto del 22.

- **r21 en prod (20/10, 22:00–22:40, Claude con autorización del CTO):** API `quivo-api-00026-tvm` (100 %, imagen
  `api:r21-20261020`; trae A1 login por placa, A2 Sentry, A3 pool/timeouts) y worker `quivo-worker` en la misma imagen.
  Health ok (db y redis up). Secreto `SENTRY_DSN_API` creado (proyecto Sentry `quivo-api`, Nest.js, solo errores, alerta
  en cada issue nuevo). `observabilidad-gcp.sh --apply --con-reinicio` (lo corrió el CTO): canal de mail
  `jencarlosmoral3@gmail.com`, uptime de `/v1/health/ready`, 7 alertas habilitadas, **PITR activo** (7 días de logs,
  7 backups). Sin presupuesto. Sin errores en API ni worker en los 15 min posteriores al reinicio. Rollback de la API:
  `quivo-api-00025-vrj` (r20). Sin verificar: login real contra r21 (lo prueban los pasantes el 21/10), un error real
  en Sentry y el mail de prueba del canal.
- **Piloto L16 ampliado a 8 trufis (#211, `--apply` en prod el 20/10 21:20 con ok del CTO):** `1616PIL`/`PIB`/`PIC` +
  `1616PID`/`PIE`/`PIF`/`PIG`/`PIH` (sintéticos, CI 9000019–9000023). Rotación `piloto-linea-16` anulada y
  republicada: 75 asignaciones, turno `manana`, nuevos del 20 al 26/10. 57 escrituras; re-corrida en dry-run = 0. PINs
  de los 5 nuevos en `~/.quivo-piloto16-creds` (0600, fuera del repo); los 3 viejos sin tocar. Al terminar:
  `--desactivar --apply` (si no, cualquier `POST /rotaciones` desde el panel los mete en el reparto).
- **Mapa con los 125 trufis de la línea para cada chofer:** el costo NO sirve como argumento ante el sindicato:
  ~$2,34/mes para toda la flota (sobre Vecinos, cada 30 s) o $13–23/mes (consulta propia cada 10 s); compartir la
  ubicación ya ocurre ($0 extra). Argumentos reales para quedarse con delante/detrás: control de frecuencia
  (amontonarse, carreras), distracción al manejar, privacidad entre socios, megas del chofer (156–585 MB/mes),
  batería y días de desarrollo.
- **Presupuesto:** el CTO no quiere monto; solo saber cuánto se gasta. Lo cubre el export a BigQuery (abajo).
  `observabilidad-gcp.sh` ya omite el presupuesto si falta `BUDGET_USD`; no hace falta cambiar código.
- **Repo público** hasta que vuelvan los minutos de Actions en privado (1/11). Decisión del CTO; objeción registrada
  (código, historial e infra expuestos). Credenciales demo de dev en el repo: el CTO las rota antes del piloto real.
- **Escalera de costos v2:** Vecinos de la ruta no estaba en lo medido (logs del 14/10; Vecinos llegó con el APK 16 el
  17/10). Suma 2 req/min por trufi (poll 30 s, del código, sin medir): 30 trufis $199 hoy / $106 optimizada; 600:
  $640 / $378. Sección nueva: **mapa de la línea en vivo para el chofer**. Si la consulta de Vecinos devuelve la línea
  entera cada 30 s, el costo es casi solo egreso: $0,13/mes con 30 y $13/mes con 600. Con una consulta propia cada 10 s:
  $15 a $124/mes. El límite real son los megas del chofer, unos 190 MB/mes con 150 trufis por línea si se manda
  compacto. Ver [`docs/costos-escalera-2026-10.md`](costos-escalera-2026-10.md) y la página.
- **"Actividad física" (`ACTIVITY_RECOGNITION`):** no entra al checklist. Solo acelera detectar que el trufi arrancó.
  El tracking no depende de él (`changePace(true)` + `disableStopDetection`, ver `permiso-actividad.ts`). Si el
  teléfono lo pide: Permitir; si el chofer lo deniega, no pasa nada.
- **gcloud de esta máquina con la sesión vencida** ("Reauthentication failed"): el CTO corre `gcloud auth login`. Sin
  eso, Claude no puede mirar logs ni métricas el día D.

## Punto de retome — 2026-10-20 (anterior): ensayo B corrido (#208) y escalera de costos

**OTA vigente en los teléfonos:** grupo `9306212c-fa6b-46f5-9186-7de1879dd171`, update Android `01a1575f…` (lo que
muestra Perfil), runtime `547d52e7…` (= APK 16). Lleva el fix #206. Rollback: grupo `4781deab-564b-4fab-920f-d2badd5fd8a2`.
El CTO pudo finalizar e iniciar normalmente y Sentry no muestra eventos nuevos: la desincronización no se repitió,
así que **el fix sigue sin probarse en el caso real**.

**Ensayo B (20/10, Claude con autorización del CTO), entorno efímero dado de baja** (`estado` sin recursos `-carga`).
Imagen `api:carga-3ff172a` (= `main` 3ff172a, con A1–A3), API en 3 instancias, worker pausado 4 min en el minuto ~18,
5 min offline. Resultados crudos en `scripts/experimentos/gps/carga/resultados/ensayo-*`.

| Criterio | 30 | 60 |
|---|---|---|
| 0 respuestas 429 en el login | pasa 30/30 | pasa 60/60 |
| Misma placa: 6.º intento 429 sin `retryAfterSeconds`, reseteo con PIN bueno | pasa | no se corrió |
| p95 < 500 ms | **no pasa solo en `POST /mobile/auth/sesion`**: p95 2.512 ms (p50 961) | igual: p95 2.956 ms (p50 1.474) |
| resto de endpoints p95 | sync 71 ms, posiciones 97 ms, jornadas 143 ms | 69 / 157 / 76 ms |
| `num_backends` < 35 con 3 instancias | pasa, máx 12 | pasa, máx 21 |
| verificar-ingesta | pasa 35.539/35.539 | pasa 70.613/70.613 |
| Redis plano | pasa, máx 0,95 % | pasa, máx 1,2 % |
| Cola vuelve a ~0 | solo indirecto: 0 pendientes al reanudar (el worker no loguea la profundidad a INFO) | igual |

- **Login lento en ráfaga:** cada login hace 3 verificaciones scrypt (padding de tiempo, `auth-movil.service.ts:886`) en
  1 vCPU; 30–60 logins en el mismo minuto hacen cola. **Aprobado por el CTO (20/10)** para D: es una vez por chofer,
  D-1 ya ensaya el login y el refresh no usa scrypt. Si molesta: menos K o más CPU solo para la API, después de D.
- **Hallazgo arreglado en #208:** el entorno efímero no tenía las variables de pool de A3 (`env_flag` las copiaba de
  prod y r20 no las tiene); ahora las fija como `deploy-gcp.sh`.
- Redis efímero con `volatile-lru` (BullMQ avisa); **prod está en `noeviction`** (verificado), sin acción.
- La API llegó a 4 instancias en el 60 con min=max=3 (probable solapamiento de revisiones; no investigado).
- Imagen de prueba `api:carga-3ff172a` **borrada** del registro de prod (20/10, ok del CTO; único tag de su digest y
  ninguna revisión la usaba: API y worker en `api:r20-20261019`, web en `web:r18-20261017`).

**#208:** `carga-efimera.sh alta --imagen IMG` / `QUIVO_CARGA_IMAGEN` (valida que la imagen exista antes de crear
recursos), pool de A3 en el efímero, resultados del ensayo. `/code-review` + `/ponytail-review`; Codex: no verificado
(sin cuota).

**Escalera de costos 30 → 600 trufis (pedido del CTO):** [`docs/costos-escalera-2026-10.md`](costos-escalera-2026-10.md) y https://claude.ai/artifact/GdjWsvXYRUkne8jfp6hN3Y (compartida
por link). Mensual, precios de lista: 30 trufis **$194 hoy / $100 optimizada**; 100: $228 / $137; 300: $425 / $263;
600: **$612 / $334**. Piloto actual ~$165 (casi todo fijo). Nuevo contra el modelo de septiembre ($437 / $205 en 600):
logs (~2,2 KB por request, medido: 389 MB en 30 días), cobro por requests sobre 2 M, egreso del panel (la pantalla de
supervisión recibe todos los vehículos cada 2 s), 2 workers desde 400 (exige Fase 2) y la API con CPU real. Ninguna
palanca está aplicada. Supuestos y lo no verificado, en la página.

**Export de facturación a BigQuery (20/10):** creado el dataset `quivo-control-prod:billing_export` en multi-región
`US` (solo multi-región hace backfill del mes actual y el anterior; sin expiración). BigQuery API ya estaba activa.
**Export "Costo de uso estándar" habilitado por el CTO en la consola** (20/10, cuenta `016F26-6DB017-B5B1E7`, proyecto
Quivo Control, dataset `billing_export`; captura del CTO). Detallado y FOCUS siguen apagados. El backfill del mes
actual y el anterior tarda hasta 5 días; después Claude contrasta la escalera con la tabla `gcp_billing_export_v1_*`.

## Punto de retome — 2026-10-19, noche (anterior): bug Comenzar/Finalizar (#206) y herramientas del ensayo B (#205)

**Bug de campo (CTO, 19/10 ~21:30–22:20 BOT, Redmi Note 10 Pro, APK 16 + OTA `4781deab`):** con el recorrido
iniciado, a ratos la app mostraba "Comenzar" o "Finalizar" parpadeaba sin cerrar; salir y volver a entrar lo arreglaba.
- **Evidencia (Cloud Run):** `GET /mobile/vuelta-actual` (solo se consulta con `tracking && appActiva`) cada 20 s hasta
  01:27:49 UTC y nada hasta 02:09, con la app en primer plano (`GET /mobile/perfil` 02:01/02:02). Tras el re-login de
  02:09:13 la consulta volvió al instante: el re-enganche del montaje encontró el plugin nativo `enabled`. **El estado
  React `tracking` quedó en false con el GPS nativo grabando**; nada lo resincronizaba salvo el montaje. Mismo proceso
  todo el tiempo (Sentry `app_start_time` 01:04:48). Sin 401 (refresh 201 cada ~15 min). Sentry
  `QUIVO-CONTROL-CONDUCTOR-8` (`Error: 499` en `changePace`, paso `reenganche-reafirmar-movimiento`, 02:20:56) es
  ruido del re-enganche, no la causa. `ACTIVITY_RECOGNITION` no concedido en ese teléfono.
- **Disparador exacto: desconocido** (candidatos: `catch` silencioso del montaje tras un remontaje, u otro). Quedó
  instrumentado en Sentry (pasos `reconciliar-foreground`, `iniciar-con-nativo-activo`,
  `nativo-detenido-con-ui-en-finalizar`, `reenganche-getstate`/`reenganche-ready`, `detener-espera-larga`).
- **Fix #206 (`8c6f5b4`):** al volver a primer plano se relee `getState()` y, si el nativo graba con la UI en
  "Comenzar", se re-engancha sin `inicio_recorrido` nuevo (QUI-247). "Comenzar" con el nativo ya activo re-engancha en
  vez de `ready()/start()` + segundo inicio; si el re-engancha falla, aviso al chofer, sin caer al arranque normal.
  Nativo detenido con la UI en "Finalizar": aviso "El GPS se detuvo. Toca Finalizar y vuelve a Comenzar." Re-enganche
  single-flight (gana la vigencia del último llamador), generación contra ABA, `iniciar()` registrado entero en el
  serializador. `detener()` sin cambio de comportamiento (solo mide esperas > 10 s). 3 rondas de `/code-review` +
  `/ponytail-review`; descartados: `ready()` repetido (ya pasaba en cada Comenzar/re-login y funciona en campo) y el
  `eventId` pendiente en el re-enganche (es del mismo recorrido). Tests: solo los predicados puros (no hay arnés de
  hook). Codex: no verificado (sin cuota). CI `ci` + `acceptance` pass.
- **Falta: OTA** (lo publica el CTO): fingerprint local `547d52e7…` = APK 16, cambio solo JS. Desde `main` limpio:
  `! cd apps/mobile && ./scripts/publicar-ota.sh "fix: reconciliar Comenzar/Finalizar con el GPS nativo"` (reconstruye
  `shared`, exporta, corre el guard y publica). Después: abrir la app dos veces en cada teléfono y confirmar el update
  en Perfil; mirar en Sentry si aparece `reconciliar-foreground` (= el bug pasó y se auto-corrigió).
- **No verificado en dispositivo.** Si vuelve a pasar con el OTA nuevo, Sentry dirá por qué rama.

**#205 (`597dbcb`) — herramientas del ensayo B:** seed con PIN por chofer y placa reservada `9999MSM`;
`conductores-reales.mjs` con `--login-real`, `--probar-misma-placa` (solo con la API en 1 instancia:
`carga-efimera.sh api-instancias 1`; resetea los fallos con el PIN bueno ≥ 61 s después del 6.º intento),
`--offline-desde/--offline-minutos`, refresh single-flight (el refresh responde **201**; solo un 401 mata la sesión);
`verificar-ingesta.mjs` por sesión y con los pendientes como perdidos; `carga-efimera.sh worker-pausa|worker-reanuda|
api-instancias N`. Receta y criterios en `scripts/experimentos/gps/carga/README-conductores-reales.md`. Probado contra
Nest local y contra un mock; **nada contra GCP**. 2 rondas de review.
- **Sigue pendiente: quién corre el ensayo B en el entorno efímero** (cuesta y escribe en GCP: CTO, o Claude con su ok).

## Punto de retome — 2026-10-18, noche (anterior): OTA de humo del 17/10 rompió los teléfonos; corregido con OTA `01a15072`

**Estado en una línea:** prueba en la calle con 1616PIL (14:07–14:22, fuera de ruta a propósito): la designación a
Molinos nunca llegó al teléfono y el mapa mostró ida y regreso juntos. **Causa única, verificada: el OTA de humo del
17/10 (update `01a14b63`) se publicó con un `packages/shared/dist` local VIEJO** (`publicar-ota.sh` corría `eas update`
sin reconstruir `shared`, que Metro resuelve vía `dist/`, git-ignorado). Las builds de EAS sí reconstruyen
(`eas-build-post-install`): el APK 16 venía bien y el OTA lo pisó.

**Evidencia:**
- Source map del OTA (`apps/mobile/dist`, 17/10 15:42): `shared/dist/entities/index.js` sin `vuelta.js`; faltan 6
  módulos (`entities/vuelta`, `telefono-bolivia`, `molinos`, `circuito`, `snap-ruta`, `traza-dibujo`);
  `PuntoControlPaqueteSchema` sin `rol`.
- Sentry `QUIVO-CONTROL-CONDUCTOR-C`: `TypeError: Cannot read property 'safeParse' of undefined` (contexto
  `vuelta-actual`), 33 eventos 18:07–18:22 UTC = cada consulta. `VueltaActualMovilSchema` es `undefined` → la respuesta
  se descarta → sin aviso, sin tarjeta, sin acuse (el panel quedó en "esperando que el chofer lo vea").
- Cloud Run: `GET /mobile/vuelta-actual` cada ~20 s, todas 200, ningún `POST .../acuse`. El servidor está bien.
- Sin `rol` en el paquete → la app no encuentra el `retorno` → `fase=null` → dibuja el circuito completo. Prod
  verificado sano: Honduras `rol=retorno` (PC 8), Molinos `espera` 30 min; `partirCircuitoPorRetorno` corta bien la
  geometría de prod (591/629) y el fallback geométrico no cambia de fase con los fixes del día.
- **Desde el 17/10 los 3 teléfonos corren sin fase ni aviso de Molinos.**

**Fix (PR `fix/ota-shared-dist-fresco`):** `publicar-ota.sh` reconstruye `pnpm --filter "@quivo/mobile^..." build`,
exporta (`expo export --platform android --dump-sourcemap --dump-assetmap`), corre el guard y recién después publica
(`eas update --skip-bundler --platform android --input-dir dist`). Guard nuevo en `scripts/assert-bundle-singletons.mjs`:
todo módulo re-exportado desde `packages/shared/src/index.ts` debe estar en el source map (rechaza el OTA del 17/10:
6 faltantes; `--self-test` corre en CI). Límite: no detecta campos nuevos dentro de un módulo existente (lo previene
el rebuild). Gates: `/code-review` medium (5 de 10 aplicados; descartados: formato de rutas —verificado—, tree-shaking
y multi-map —hipotéticos—, src-vs-dist del árbol), `/ponytail-review` Ship. Codex: no verificado (sin cuota).

**Checklist:**
- [x] **[Claude]** #175 mergeado (`6c5e31d`), CI `ci` + `acceptance` pass.
- [x] **[Claude]** OTA correctivo publicado con el ok del CTO desde `main` `6c5e31d` con el script nuevo (primera corrida
      real de `--skip-bundler`: OK). Update group `26833409-ff38-4b9f-a47e-8a423aa797c5`, Android update id
      `01a15063…`, runtime `547d52e7…` (= fingerprint del APK 16). Guard pasó; el bundle publicado trae
      `entities/vuelta.js`, `circuito.js` y `rol` en `PuntoControlPaqueteSchema`. Sin source maps (falta `SENTRY_AUTH_TOKEN`).
- [x] **INCIDENTE 2026-10-18 (causado por #175):** el OTA `01a15063` salió **sin `EXPO_PUBLIC_API_URL` ni el DSN de
      Sentry** → la app de prod mostraba "Falta EXPO_PUBLIC_API_URL" y no dejaba iniciar sesión. Causa: el export dentro
      de `eas-cli env:exec` no inlineaba las `EXPO_PUBLIC_*` que el script exporta desde `eas.json`, y la caché de
      transformación de Metro reutilizaba el transform sin variables (hizo falta `--clear`). El guard de #175 solo
      miraba módulos de `shared`, no variables.
- [x] **Hotfix OTA `01a15072`** (update group `10ffb271-1693-4e29-95d9-1dae03d2a2d5`, runtime `547d52e7…`, desde
      `3de61e5`): export manual con las variables exportadas + `--clear`, verificado antes de publicar (URL y DSN en el
      bytecode; guard de `shared` OK). Publicado por el CTO (el modo automático bloquea publicar a prod). El
      controlador de OTA no depende de la API: el teléfono del CTO **se actualizó al entrar y el login funciona**.
- [x] **[CTO]** Update `01a15072` visible en Perfil. Falta solo repetir la prueba en la calle.
- [x] **[Claude]** Fix del script (PR `fix/ota-env-publico`): export sin `env:exec` y con `--clear`; antes de publicar,
      corta si `EXPO_PUBLIC_API_URL` o `EXPO_PUBLIC_SENTRY_DSN` están vacías o no están literalmente en el `.hbc`
      (probado: export sin variables → falla; con variables → pasa). `GPS_CANAL_VISUAL` no se chequea (Metro pliega
      `=== '1'` a booleano). Gates: `/code-review` low (2 aplicados), `/ponytail-review` Ship (2 aplicados). Codex: no
      verificado (sin cuota).
- [ ] **[Claude]** Después de la próxima prueba: confirmar que Sentry no registra más `QUIVO-CONTROL-CONDUCTOR-C`.
- [ ] **[CTO]** Repetir la prueba en la calle (aviso de Molinos + solo ida/solo regreso).
- [x] **[CTO]** Infracciones de la prueba de PIL del 18/10 (`molinos_omitido` grave y `pc_omitido` Honduras, sesión
      `af9371fe…`): se dejan; se limpia todo el día de la entrega del software.
- [ ] **Plan de los pendientes sin bloqueo:** [`docs/plan-pendientes-post-incidente-ota.md`](plan-pendientes-post-incidente-ota.md)
      (token de Sentry, fix lat/lng, OTA de punta a punta, OTA desde CI con disparo manual, `shared` desde `src`: no por ahora).
- [x] **[Claude]** Lat/lng invertido de la línea punteada de `ruta-a-punto` (desde agosto se dibujaba en el
      Atlántico Sur): fix `aCoordsRutaCalculada` en `estilo-ruta.ts` + test (PR `fix/ruta-a-punto-latlng`). Llega
      con el próximo OTA. **Corrección (18/10):** en prod la línea no aparece igual: OSRM no está desplegado
      (Cloud Run sin `OSRM_URL`, `ruta-a-punto` devuelve `null`). El fix es correcto pero inerte hasta decidir OSRM.
- [x] **[Claude]** Token de Sentry en `~/.quivo-sentry-env` (0600; el CTO lo pegó en el chat: **revocar y recrear**);
      `publicar-ota.sh` lo carga solo. Source maps del OTA `01a15072` subidos (debug id `dd0d7c0c…`).
- [x] **[CTO]** OTA `01a1509e` publicado con el script completo (primera corrida de punta a punta, plan punto 3),
      desde `c0b7376`: update group `ebc72ea4-68e6-4fe8-88dc-40c3a5650094`, runtime `547d52e7…`, source maps subidos
      solos. Verificado aparte: URL de la API y DSN en el `.hbc`, fix lat/lng y `vuelta.js` en el bundle. Vuelta atrás:
      `eas update:republish --group 10ffb271-1693-4e29-95d9-1dae03d2a2d5`.
- [x] **[CTO, 18/10 ~22:56 UTC]** Prueba en la calle con el OTA `01a1509e`, 1616PIL: tarjeta "Designación — vía
      Molinos" (chip `Honduras → Molinos → Salomón Romero`, 0/17 puntos) y "Designación cancelada — Volvé directo a
      Salomón Romero" (sin chip, 0/16) llegan y se cierran con "Entendido"; el chofer no acepta nada. **OK.**
- [x] **[CTO, 18/10 ~23:13 UTC]** Solo ida: se dibuja una sola línea (bajada hacia Honduras), ya no ida y regreso juntas.
- [ ] **[CTO, 19/10]** Probar el regreso: al cruzar el PC de Honduras debe cambiar solo a la línea de regreso. Los PCs
      1–4 de la prueba del 18/10 saldrán omitidos (vuelta iniciada en el #5); el CTO lo da por esperado.
- [x] **[Claude]** Sentry: único error del día = `safeParse of undefined` del OTA viejo `01a14b63` (18:07–18:22 UTC);
      cero errores con `01a1509e`. Por pedido del CTO se resolvieron los 10 issues abiertos (si reaparecen, Sentry los
      reabre como regresión).
- [ ] **[CTO]** Decidir OSRM (desplegar en GCP o proveedor externo): sin eso no hay línea punteada al próximo PC.
- [x] **[Claude]** Vecinos delante/detrás en circuito (piloto del 14/10: distancia que salta, vecino que desaparece,
      inversión): proyección por fase (ida/regreso) + distancia circular por el lado más cercano + fixes >50 m
      descartados. Replay con datos reales: 0 inversiones (antes 60 con lag 160 s), cambios de fila 43→4. Detalle y
      decisiones en [`docs/plan-vecinos-circuito.md`](plan-vecinos-circuito.md). PR `fix/vecinos-circuito`.
- [x] **[CTO, 18/10]** Deploy de la API `r19-20261018` (`--solo api`): revisión `quivo-api-00024-f5c`, 100 % del
      tráfico, `/v1/health/ready` ok (db y redis arriba), sin migraciones nuevas. OTA `01a151bf` (group
      `51a0b361-4109-477e-b4fb-57db2d3a31ca`, desde `42c4f1e`), source maps subidos. Verificado aparte: URL de la API, DSN,
      `vecinos-ruta` y `circuito.js` de shared con `prepararCircuito` en el bundle. Vuelta atrás del OTA:
      `eas update:republish --group ebc72ea4-68e6-4fe8-88dc-40c3a5650094`.
- [ ] **[CTO]** Prueba en la calle con 2 trufis: una sola fila por vehículo, distancias iguales en ambos, sin
      inversiones en Honduras ni en SR; mirar qué pasa con un trufi esperando en Molinos.
- [x] **[Claude, 18–20/10]** Escalar a 30 conductores simultáneos (cerrado: sigue en el plan del día D): plan aprobado 18/10 en
      [`docs/plan-escalabilidad-30.md`](plan-escalabilidad-30.md). Sin LB externo, sin Kubernetes, sin PgBouncer.
      Bloqueantes verificados en prod: cola `ingesta-sync` sin `removeOnComplete` (Redis `noeviction` se llena), jobs sin
      reintentos, API/worker sin `SENTRY_DSN`, sin alertas ni budget, PITR y archivo GPS apagados. Fase 0 (medir +
      prueba de carga en entorno efímero) antes de tocar código; Fase 1 obligatoria antes de pasar de 5 conductores.
- [x] **[Claude, 18/10]** Fase 0 parcial (logs del 14/10): `ruta-a-punto` era el 35 % del tráfico móvil y siempre
      inútil (OSRM no desplegado); CGNAT no observado (2 teléfonos, IPs propias). `max_connections` sin confirmar.
- [x] **[Claude, 18/10]** #187 `ruta-a-punto`: sin `OSRM_URL` la API no hace `fetch`; el móvil pide como máximo cada
      15 s **y** 50 m (la parte móvil llega con el próximo OTA).
- [x] **[Claude, 18/10]** #188 cola `ingesta-sync`: `removeOnComplete`/`removeOnFail`, 5 reintentos con backoff, errores
      transitorios de la DB relanzan (antes se tragaban en `sync_errors`), `INGESTA_WORKER_CONCURRENCY` **default 1**:
      más de 1 procesa lotes del mismo teléfono fuera de orden y genera PC omitidos falsos. Residual: un lote con error
      permanente + transitorio duplica la fila en `sync_errors`.
- [x] **[Claude, 18/10]** #189 `scripts/carga-efimera.sh` + generador `conductores-reales.mjs` + seed sintético.
      Decisión del CTO: instancia nueva, sin clonar prod (sin PII). Nunca ejecutado: flags de gcloud a ajustar en la
      primera corrida.
- [x] **[Claude, 18/10]** Reviews con skills (`/code-review` + `/ponytail-review`, regla del CTO: siempre, antes de
      todo commit) sobre #187–#189 y sus fixes: varias rondas hasta cerrar bugs/seguridad/pérdida de datos.
- [x] **[Claude, 18/10]** #191 mobile: el pedido de ruta ya no se cancela con cada posición (1 Hz), limpia la ruta al
      fallar y solo reintenta red/5xx/429; `carga-efimera.sh` con allowlist de env (no copia el bucket de prod); seed con
      PC terminal y retorno.
- [x] **[Claude, 18/10]** #192 seguridad + límites: **`trustProxy: true` dejaba falsificar la IP con `X-Forwarded-For`
      y saltear todo límite por IP (incluido el login con PIN)**; ahora `trustProxy: 1` (verificado en logs de prod: XFF
      de una entrada, proxy 169.254.x). `@LimitePorDispositivo(n)` (por `deviceId` + tope por IP 3000/min por ruta) en
      todas las rutas móviles autenticadas; `refresh` y `sesion/asignacion` 120/min por IP; logins con PIN siguen 5/min.
- [x] **[Claude, 18/10]** #193 ingesta: sin `attempts` de BullMQ (reordenaban lotes → PC omitido falso). Reintento en
      proceso del lote entero ante errores transitorios (5→60 s, presupuesto 30 min), concurrencia fija 1 (se elimina
      `INGESTA_WORKER_CONCURRENCY`), `sync_errors` al final del intento, apagado devuelve el job al frente de `wait`,
      `scripts/ingesta-reencolar-fallidos.mjs`. Residuales en el PR.
- [x] **[CTO, 19/10 00:35]** Deploy `r20-20261019` desde `a1e583a` (`--solo api` y `--solo worker`, sin web: sin
      cambios): exit 0. API `quivo-api-00025-vrj` con `/v1/health/ready` ok (db y redis up); worker con imagen r20 y
      log "escuchando la cola de sync". No hace falta `queue.clean`: con `removeOnComplete {age: 3600}` BullMQ 6.0.0
      borra los completados viejos al completar cada job (`removeJobsByMaxAge.lua`).
- [x] **[CTO, 19/10 00:43]** OTA `4781deab` (runtime `547d52e7…`, commit `a1e583a`) con la parte móvil de
      #187/#191/#192. Verificado: API_URL, DSN de Sentry y el código nuevo en el `.hbc`; source maps en Sentry.
- [ ] **[Claude, 19/10 con tráfico]** Verificar en logs que `req.ip` sea la IP del cliente y que las claves/memoria
      de Redis bajen y se aplanen. Confirmar en Perfil que los teléfonos tomaron `4781deab`.
- [x] **[CTO, 19/10]** Decisiones: retención GPS **6 meses** (va con el archivo GPS de la Fase 1). Tier de Cloud SQL lo
      decide la prueba de carga: si con 30 conductores CPU < 60 % y conexiones < 70 % del máximo, sigue `db-g1-small`;
      si no, `db-custom-1-3840` antes de pasar de 5. Ojo: ese cambio NO da SLA (el SLA de Cloud SQL exige HA; excluye
      shared-core y zonal). Costo fijo por hora, ~US$29–35/mes más (precio de Santiago no verificado). PITR se activa igual.
- [x] **[Claude, 19/10]** Prueba de carga en entorno efímero (30 y 60 conductores, 30 min c/u): 0 errores, p95 ≤ 101 ms,
      CPU Cloud SQL 28 % prom. con 60, conexiones ≤ 9 de 50, Redis plano, ingesta al día. Se queda `db-g1-small`.
      Tabla en `docs/plan-escalabilidad-30.md`. Entorno dado de baja (`estado` vacío). Fixes del seed: #197 (ruta de
      `packages/db`, `estado` sin worker pools) y `'mañana'`→`'manana'` (este PR). Residual: `asignaciones.horario` es
      TEXT sin CHECK; un writer SQL crudo puede volver a meter un valor inválido (candidato a migración con CHECK).
- [ ] **[Claude, en curso]** Preparar el día D, **sábado 24/10**. Hecho: A1–A3, B, runbook y checklist. Falta C (credenciales
      de los 30, espera la lista del CTO) y completar r21 en el runbook. Plan original:
      plan aprobado en [`docs/plan-dia-30.md`](plan-dia-30.md). Antes de D: A1 login (hoy `/mobile/auth/sesion` es
      5/min **por IP**: detrás de CGNAT o un WiFi compartido bloquea a 25 de 30; clave IP+placa, lockout hasta 15 min,
      dispositivo conocido exento, web IP+email, legado apagado por default), A2 observabilidad (`SENTRY_DSN` +
      `observabilidad-gcp.sh`), A3 pools/timeouts (con 3 instancias de API se puede pasar de `max_connections=50`),
      ensayo efímero con login real, ráfaga y worker caído, credenciales de los 30, runbook. Vencimiento de rotaciones
      al worker y archivo GPS pasan a después de D (motivo en el plan).
- [x] **[Claude, 19/10]** A1 #202 (`74afcc0`): `/mobile/auth/sesion` con cubos ip+placa 5/min e ip 60/min
      (`auth-movil/login-movil-throttler.guard.ts`, base `RetryAfterThrottlerGuard` compartida con
      `DispositivoThrottlerGuard`); lockout por vehículo hasta 900 s; un `deviceId` que ya tuvo sesión en el vehículo
      conserva el tope viejo de 60 s (**no exento**: `/security-review` encontró que el `deviceId` lo ven los roles de
      panel en `/reportes/en-vivo`); `MOBILE_LEGACY_AUTH_ENABLED` apagado por default. **Cambio respecto del plan:** el
      login web `/auth/login` quedó como estaba (5/min por IP): subir el tope abarataba el password spraying y las
      cuentas web no tienen lockout. Riesgo aceptado: quien conoce la placa puede demorar hasta 15 min el login de un
      teléfono NUEVO en ese vehículo. Falta probar el guard con Nest+Fastify reales (lee `req.body.placa`): lo cubre el
      ensayo B.
- [x] **[Claude, 19/10]** A3 #201 (`45d2937`): pool por `DB_POOL_MAX` (API 6, worker 5), `DB_CONNECTION_TIMEOUT_MS`
      5000, `DB_STATEMENT_TIMEOUT_MS` solo por env (API 10 s, worker 60 s; default 0 = sin límite para seeds/scripts).
      Health sin pool propio. Presupuesto 3×6+5+1 = 24 de 50; en un deploy con solapamiento se acerca al tope (por eso
      el congelamiento de D-2).
- [x] **[Claude, 19/10]** A2 #200 (`93b03d8`): `SENTRY_DSN` desde el secreto `SENTRY_DSN_API` en API y worker; **el
      Paso 0 de `deploy-gcp.sh` falla si el secreto no existe** (el CTO tiene que crearlo antes del próximo deploy).
      `scripts/observabilidad-gcp.sh` (dry-run por defecto; `--apply`; `--con-reinicio` para PITR, que reinicia la base):
      canal de mail, uptime `/v1/health/ready`, alertas 5xx/CPU/conexiones/disco/Redis/worker sin instancias,
      presupuesto 50/90/100 %. Sin alerta de worker trabado (vivo sin consumir): se mira a mano el día D.
- [x] **[Claude, 19/10]** #203: test inestable de ingesta (`findMany` sin orden) que rompió el CI de #200.
- [x] **[Claude, 19–20/10]** B: herramientas del ensayo (#205, #208) y ensayo corrido el 20/10 (resultados arriba).
- [ ] **[CTO]** Revocar el token de Sentry pegado en el chat; crear el proyecto Node de Sentry y el secreto
      `SENTRY_DSN_API`; correr `observabilidad-gcp.sh` (primero sin `--apply`; sin presupuesto, decisión del 20/10); deploy
      r21 de API y worker; `gcloud auth login` en esta máquina; lista de los 30 y credenciales para los ~5 del piloto
      del 21/10.
- Gates de A1–A3: `/code-review` + `/ponytail-review` en todos, `/security-review` en A1. Codex: no verificado (sin cuota).
- [ ] **[Claude, Fase 2]** Orden por dispositivo real (cola por hash de `deviceId`) o detección de PC omitido insensible
      al orden: requisito para subir la concurrencia del worker y para que una caída de la DB de más de 30 min no deje
      infracciones falsas.
- [ ] **[Claude, propuesto]** CI: `cancel-in-progress` solo en PRs (hoy cancela runs de `main`: 14 en octubre) y
      revisar `admin-panel.spec.ts` (`:154` flaky el 18/10; `:98` rompió 3 runs el 14/10, ya corregido).
- [x] **[CTO, 2026-10-18]** Plan punto 4 decidido: OTA desde CI con `workflow_dispatch` que dispara el CTO (disparar =
      aprobar; GitHub Free + repo privado no tiene required reviewers), primera corrida a `preview`. Detalle en el plan.
- [ ] **[Claude, después de la prueba en la calle]** Implementar `ota.yml` + flag `--si` en `publicar-ota.sh`; el CTO
      carga `EXPO_TOKEN` y `SENTRY_AUTH_TOKEN` con `gh secret set`. Si antes de la entrega quedan 1–2 OTAs: post-entrega.

## Punto de retome — 2026-10-17, noche (anterior): #170–#173 en `main` (`ee352ee`) y desplegados en `r18-20261017`

**Estado en una línea:** APK 16 en los 3 trufis, OTA confirmado, línea 16 cargada con sus 17 PC, Molinos se designa en
cualquier momento (1 por día, la tardía va a la próxima vuelta) y el mapa web dibuja el trazo pegado a la calle. Falta
la prueba en la calle con el control.

**Guía para el control (cómo designar a Molinos):** [`docs/piloto/guia-control-molinos.md`](piloto/guia-control-molinos.md).

**Deploy `r18-20261017` (2026-10-17, lo corre el CTO):** `GOOGLE_MAPS_MAP_ID=430254e21207af4870419ff7 scripts/deploy-gcp.sh
r18-20261017` desde `main` en `ee352ee` (api + worker + web; migración `20261017120000_molinos_proxima_vuelta`). La
primera corrida cortó en el preflight por falta de `GOOGLE_MAPS_MAP_ID` (sin efectos salvo IAM idempotente).
**Resultado: exit 0.** Migraciones OK, `/v1/health/ready` = ok (db y redis up), web `/en-vivo` 200, el contexto en vivo
de L16 trae `variantes: [Vía Molinos, 208 vértices]` y `/reportes/en-vivo/posiciones` responde (la consulta ya lee
`molinosProximaVarianteId`, así que la columna existe). `molinosProxima` en una vuelta real: **no verificado** (no había
vueltas en curso); se ve en la prueba en la calle.

**Hecho (2026-10-17):**
- **APK versionCode 16 instalado** por el CTO en `1616PIL`, `1616PIB` y `1616PIC`.
- **OTA de humo publicado** con `apps/mobile/scripts/publicar-ota.sh`: mismo JS que `de3fc30`, sin cambio de código
  (el id del update cambia igual). Update group `17fd7e92-226e-4654-a018-8b071ecfe2c7`, Android update id
  `01a14b63…`, runtime `547d52e7…`, que coincide con el fingerprint del build `ddef9838`. Sin source maps (falta
  `SENTRY_AUTH_TOKEN`). **Llegó a los 3** (Perfil → Aplicación → Versión = `0.1.0 · 01a14b63`). "Se aplicará al
  cerrar" = descargado, se aplica en el próximo arranque en frío.
- **`cargar-linea-16.ts --apply` en prod, 21 escrituras**, con el ok del CTO. Antes:
  - sesiones de la ruta: `1616PIL` tenía recorridos abiertos (15:36, 15:40 y 15:48, hora de Bolivia); el CTO los
    cerró y se aplicó con las 3 en `cerrada` y el último fix de hacía 16 min;
  - asignaciones: 1 por día por vehículo (`1616PIL/PIB/PIC`) del 17 al 26/10 en la ruta `460c9015…`; el `--apply`
    conserva ids, así que siguen válidas;
  - dry-run idéntico al del 15/10.
  - Verificación: ruta 1218 vértices, 17 PC con rol (SR `terminal`, Honduras `retorno` obligatorio, Molinos
    `espera` 30 min) a 0–18 m del trazado; re-corrida en dry-run = **0 escrituras**.
- **Contraseña de `admin@quivo.com`: el CTO decide NO rotarla por ahora** (prod solo tiene pilotos). La credencial
  vive en `~/.quivo-admin-env` (0600) de la máquina del CTO; los scripts la leen con `source ~/.quivo-admin-env`.
- **Basura de datos sin bloqueo:** `/en-vivo` lista sesiones viejas nunca cerradas (`9006TST` y `9004TST` desde
  septiembre, `sin_datos`; `1616PIB` del 14/10, `activa` con el recorrido finalizado).

**Checklist** (marcar `[x]` al cerrar cada ítem; el dueño va entre corchetes):

*Ahora:*
- [x] **[Claude]** Regla nueva del CTO: designar a Molinos en cualquier momento, 1 vez por día, la tardía (tras km 26 en
      el regreso) vale para la próxima vuelta. Plan: [`docs/plan-molinos-cualquier-momento.md`](plan-molinos-cualquier-momento.md).
      **#170 mergeado (`043c91b`).** Gates: `/code-review` high (7 de 10 aplicados), `/ponytail-review` (3 aplicados),
      `/security-review` limpio, `web-design-guidelines` (1 menor: aria-live del aviso), Codex automático (fecha/TZ y
      orden de chequeos aplicados). Tests: api integración 52/52, web 199/199, shared 136/136; CI `ci` + `acceptance` pass.
      Sin cambios en mobile (no APK ni OTA). Límites: llegada perdida por GPS permite re-designar; sin cumplimiento de
      km 26 la tardía se detecta recién en km 28; lote offline cierre+apertura+llegada (`shortcut:` en `deteccion-vueltas.ts`).
- [x] **[Claude]** Prueba del panel web con Playwright y API mockeada (`next start`): bloqueo "Ya fue a Molinos hoy",
      "Va a Molinos en la próxima vuelta" + Cancelar (teclado, 390 px), tardía y normal OK. Encontró que el aviso decía
      "Vuelta designada vía Vía Molinos" en la tardía y un flash optimista de ~400 ms: corregido en el PR siguiente
      (aviso según `aplica`; designar no cambia la vuelta hasta la respuesta, cancelar es inmediato). `/code-review` limpio;
      **Codex verify-fix: no verificado (sin cuota hasta el 16/11; el error pide "Upgrade to Plus": revisar la suscripción)**.
- [x] **[Claude]** #172 mergeado (`42f892e`): aviso según `aplica` + sin flash optimista + esta lista de pruebas.
- [x] **[CTO]** Deploy `r18-20261017` de api + worker + web desde `ee352ee`: exit 0, verificado (ver arriba).

*Pruebas pendientes — Molinos en cualquier momento (#170 + #172), después del deploy. El control usa el panel web
`/en-vivo`; la designación SOLO se hace desde ahí (la app del chofer solo recibe el aviso):*
- [ ] **[CTO/control]** Designar "Vía Molinos" a un móvil **durante la ida**: el panel muestra "Avisado…" y el chofer
      recibe el aviso en la app.
- [ ] **[CTO/control]** Designar a un móvil que **ya pasó km 26 de regreso**: el aviso del panel dice "Va a Vía Molinos en la
      próxima vuelta", la sección muestra "Va a Molinos en la próxima vuelta." con Cancelar, y el chofer recibe el aviso
      **al arrancar la vuelta siguiente** (no antes).
- [ ] **[CTO/control]** Cancelar una designación diferida con el botón Cancelar: desaparece y el chofer no recibe nada.
- [ ] **[CTO/control]** Intentar mandar a Molinos a un móvil que **ya llegó a Molinos hoy**: "Vía Molinos" deshabilitado con
      "Ya fue a Molinos hoy."
- [ ] **[CTO/control]** Un móvil designado que **no subió** (omitió) puede volver a ser designado y vuelve a salir "Sugerido".
- [ ] **[Claude]** Con los datos de esa prueba: la vuelta de la designación tardía cierra **sin** `molinos_omitido`, la
      siguiente abre con la designación, y `molinosHoy`/`sinMolinosHoy` cuentan llegadas.

*Mapa web — trazo y cámara como en la app (plan [`docs/plan-mapa-web-traza-snap.md`](plan-mapa-web-traza-snap.md)):*
- [x] **[Claude]** **#173 mergeado (`ee352ee`). Causa del piloto del
      **miércoles 14/10** (el jueves 15 no tiene datos en prod): la web dibujaba el GPS crudo unido con rectas (sobre las
      casas, huecos como rectas, saltos de 3 km del PIL) y la cámara seguía al último punto del trazo (cada 10 s) sin
      restar HUD/panel. Ahora: snap del móvil movido a `@quivo/shared`, trazo por segmentos (azul en ruta, alerta fuera
      de ruta), huecos cortados, marcador por la calle, seguimiento con `followPadding`. Replay Playwright con los datos
      reales del 14/10 sobre Google Maps: esquinas limpias, marcador visible 242/242 (escritorio y móvil). Gates:
      `/code-review` high (9 de 10 aplicados; descartado filtrar variantes en borrador), `/security-review` limpio.
      Codex: no verificado (sin cuota).
- [x] **[CTO]** Deploy en el mismo `r18-20261017` (el cambio en mobile es solo de imports: entra en el próximo APK/OTA
      que se haga por otra razón).
- [ ] **[CTO/control]** En `/en-vivo`, seguir un recorrido completo de L16 y "Ver recorrido" al terminar: el trazo va
      por la calle, los desvíos reales salen en naranja y el vehículo no queda tapado por el HUD ni el panel.
- [ ] **[CTO]** Confirmar si el inicio y el final fuera de la ruta (p. ej. PIB a ~120 m al arrancar) deben verse en
      naranja como desvío.

*Otros pendientes:*
- [x] **[CTO]** Confirmar en Perfil de los 3 que la versión dice `0.1.0 · 01a14b63` (OTA de humo): llegó a los 3.
- [ ] **[CTO]** Decidir #105 (`scripts/extender-asignaciones-piloto.ts`, abierto desde el 08/10, CI verde, nunca
      pasó `/code-review`): mergear (tras las revisiones) o cerrar. Las asignaciones del piloto 16 vencen el **26/10**.

*Prueba en la calle (CTO, con Claude revisando los datos):*
- [ ] **[CTO]** Cambio de fase en Honduras: los PC y el trazado de la ida desaparecen y aparecen los del regreso.
- [ ] **[CTO]** La rotonda muestra solo su tramo, sin la otra pasada.
- [ ] **[CTO]** Aviso de designación a Molinos.
- [ ] **[CTO]** Polilínea azul a zoom 16–18.
- [ ] **[Claude]** Revisar en la base los cumplimientos y las infracciones de esa prueba: sin `pc_omitido` falsos y
      con las vueltas contadas.

*Pendiente sin bloqueo:*
- [ ] **[Claude]** Cuando vuelva la cuota de Codex: verify-fix sobre #161 (ya en `main`). Si encuentra algo, fix en
      un PR nuevo.

**Worktrees vivos:** ninguno.

## Punto de retome — 2026-10-15, 22:00 (anterior): deploy r17 y APK versionCode 16 listos; falta instalar y `--apply`

**Hecho:**
- **#161 mergeado (`de3fc30`).** `/code-review` y `/ponytail-review` (ship). **Codex verify-fix: no verificado (sin
  cuota)**. Con la regla 13 nueva, la falta de cuota no bloquea; correrlo cuando vuelva la cuota.
- **Deploy `r17-20261015` de api, web y worker** desde `de3fc30`, corrido por el CTO. El modo automático bloquea
  los deploys a prod hechos por Claude. Health `ok` (db y redis up), `GET /rutas/:id/puntos-control` ya devuelve
  `rol` y `/mobile/vuelta-actual` responde 401 sin token.
- **Dry-run de `cargar-linea-16.ts` contra prod OK, sin escrituras:**
  - 3 PATCH conservan los ids: SR `ea0f624c` pasa a `terminal`, Honduras `05b57eb2` a `retorno` con orden 8,
    y Molinos `a660b799` a `espera` con orden 15 y 30 min.
  - 14 POST de intermedios.
  - PATCH de la base (1425 → 1218 vértices) y de la variante "Vía Molinos" (208 vértices).
- **APK versionCode 16:**
  - Build EAS `ddef9838-54ce-4f80-b8c4-9e91fcc4c8a0`, commit `de3fc30`.
  - APK: https://expo.dev/artifacts/eas/_ccVx_j29UZRsL7b8UL4UjA9V0d04V8yddqVl6azLD8.apk
  - Se creó el canal/branch de EAS Update `production`.
  - Pre-build verificado: las 3 claves de EAS `production`, reanimated `~3.19.0` y `expo config` OK.
    `pnpm install` falla en el postinstall de `packages/db` por falta de `DATABASE_URL`; para el build no importa.
- **Changelog pasado al CTO:** #142, #150, #151 + #155, #152, #154 + #159, #162, #165 (más #161 en la API).

**Checklist de esa sesión** (cerrado el 2026-10-17, ver arriba; marcar `[x]` al cerrar cada ítem; el dueño va entre corchetes):

*Del lado del CTO, primero:*
- [ ] **[CTO]** Instalar el APK versionCode 16 en `1616PIL`, `1616PIB` y `1616PIC`
      (https://expo.dev/artifacts/eas/_ccVx_j29UZRsL7b8UL4UjA9V0d04V8yddqVl6azLD8.apk) y avisar a Claude.
- [ ] **[CTO]** Rotar la contraseña de `admin@quivo.com` (quedó en el chat del 15/10) y guardarla en Secret Manager
      (`QUIVO_PANEL_ADMIN_EMAIL`/`QUIVO_PANEL_ADMIN_PASSWORD`). Hacerlo **después** del `--apply`, o pasarle la nueva
      a Claude para ese paso.
- [ ] **[CTO]** Decidir #105 (script de asignaciones del 08/10): ¿cerrar?

*Después de la instalación (Claude):*
- [ ] **[Claude]** OTA de humo: `eas update --branch production` con un cambio trivial y confirmar que llega a los 3.
- [ ] **[Claude]** Revisar las asignaciones y sesiones activas de la ruta `460c9015…` y correr `cargar-linea-16.ts --apply`
      (ok del CTO ya dado). **Solo con el APK 16 en los 3.** El dry-run del 15/10 ya validó el plan: 3 PATCH, 14 POST,
      base y variante.

*Prueba en la calle (CTO, con Claude revisando los datos):*
- [ ] **[CTO]** Cambio de fase en Honduras: los PC y el trazado de la ida desaparecen y aparecen los del regreso.
- [ ] **[CTO]** La rotonda muestra solo su tramo, sin la otra pasada.
- [ ] **[CTO]** Aviso de designación a Molinos.
- [ ] **[CTO]** Polilínea azul a zoom 16–18.
- [ ] **[Claude]** Revisar en la base los cumplimientos y las infracciones de esa prueba: sin `pc_omitido` falsos y
      con las vueltas contadas.

*Pendiente sin bloqueo:*
- [ ] **[Claude]** Cuando vuelva la cuota de Codex: verify-fix sobre #161 (ya en `main`). Si encuentra algo, fix en
      un PR nuevo.

**Worktrees vivos:** ninguno.

## Punto de retome — 2026-10-15, 19:30 (anterior): #164 y #165 mergeados, falta #161, deploy y APK

Plan vigente: [`docs/plan-fase-vuelta-apk.md`](plan-fase-vuelta-apk.md) y
[`docs/plan-pc-intermedios-l16.md`](plan-pc-intermedios-l16.md), con el orden de salida.

**Regla nueva del flujo (CLAUDE.md global, regla 2):** `/ponytail-review` se corre en todo cambio de
código, sumado a `/code-review`. En esta sesión encontró el bug de los PC sin rol del #164.

**Mergeados:**

- **#165 `feat(mobile)`, fases ida/regreso (`a9b5944`):**
  - Rebase limpio sobre #162.
  - `/code-review` dio 10 hallazgos y se aplicaron 5:
    - el fallback de fase es simétrico (si el GPS no detecta SR, en el regreso vuelve a `ida` por geometría);
    - el corte del circuito usa el mínimo real dentro de la primera pasada a menos de 150 m;
    - la vuelta nunca se ancla en `retorno`;
    - el memo usa `firmaGeometria` completa;
    - la fase se hereda a medianoche.
  - **Salteados, con motivo:**
    - la lectura SQLite por fix (barata);
    - la geometría duplicada con `snap-ruta`, porque `shared` no puede importar de mobile;
    - el marcador sale un momento de la polilínea cerca de Honduras antes de que cambie la fase (cosmético).
  - `/ponytail-review`:
    - "evidencia de Honduras perdida al cambiar de fase con la visita pendiente": **no se reprodujo**.
      `confirmarVisitasVencidas` la confirma igual, y quedó un test de guarda.
    - Se borró `indiceCorte`, que no se usaba.
  - **Aviso sin fix:** "Iniciar recorrido" a mitad del regreso vuelve a `ida` hasta 3 fixes en calles
    exclusivas del regreso. Se toma como decisión de diseño; revisar si en la calle molesta.
  - Tests: mobile 970/970, shared 136/136. **Sin verificar en dispositivo.**
- **#164 `feat(scripts)`, PC intermedios por fase (`7cd34d6`):** 17 PC. Fixes de las reviews:
  - la exclusión de 500 m se aplica por fase;
  - el dry-run muestra la fase y la distancia de cada PC;
  - la cabecera declara la precondición de #161;
  - limpieza de código muerto;
  - **fix crítico:** en prod, SR, Molinos y Honduras existen con orden 0/1/2 y **sin `rol`**, y sus
    coordenadas son idénticas al plan (verificado por GET). Ahora se emparejan por cercanía a menos de
    50 m y conservan su id. Si la API no devuelve `rol`, el script aborta.
  - Tests 50/50.
  - Dry-run contra prod: abortó sin escribir, porque **la API desplegada no devuelve `rol`** (es anterior
    a #154). Repetirlo después del deploy.

**Siguiente, en orden:**
1. Después de las 21:41 del 15/10: Codex verify-fix de #161 desde el worktree `agent-a42e38482eac5894b`
   (comando en la sección de abajo). Si pasa: `/ponytail-review`, CI y merge. Borrar el worktree.
2. Deploy de API + web (`scripts/deploy-gcp.sh`, con el ok del CTO ya dado). Verificar:
   - el health;
   - `/mobile/vuelta-actual`;
   - que `GET /rutas/:id/puntos-control` devuelva `rol`.
3. Dry-run de `cargar-linea-16.ts` contra prod. Debe emparejar los 3 PC existentes por cercanía y
   planear 14 POST. **Sin `--apply`.**
   - Las credenciales de admin las pasa el CTO por env.
   - **Recomendado:** rotar la contraseña de `admin@quivo.com`, que quedó en el chat del 15/10, y
     guardarla en Secret Manager.
4. Breakpoint del APK: los pasos 6–7 de la sección de abajo (changelog, pre-build, `eas build`,
   instalación, OTA de humo y `--apply`).
5. Pendiente con el CTO: #105, ¿cerrarlo?

**Worktrees vivos:** solo `agent-a42e38482eac5894b` (#161).

## Punto de retome — 2026-10-15, 18:00 (anterior): fase de la vuelta, PC intermedios y camino al APK

Plan vigente: [`docs/plan-fase-vuelta-apk.md`](plan-fase-vuelta-apk.md) (pasos 1–10, bloqueantes y orden
de salida). Para retomar: leer esta sección y seguir **"Siguiente, en orden"**.

**Corrección del CTO (2026-10-15):** el chofer no ve los PC ni el trazado del regreso mientras va de
ida, ni al revés. La fase sale del orden de marcha:
- `orden < retorno.orden` es ida (más el propio retorno).
- `orden > retorno.orden` es regreso.
- `terminal` pertenece a las dos y `espera` al regreso.

Esto resuelve la doble detección de los intermedios en las calles que comparten ida y regreso.

**Mergeados hoy:**

| PR | Qué |
|---|---|
| #160 | Piloto de 3 trufis. |
| #159 | F1-mobile, aviso de Molinos (`a943b7a`). |

En #159, `/code-review` dio 9 hallazgos y se aplicaron 8. El #4 quedó fuera con motivo:
`conReintentoSiHandleMuerto` solo reabre el outbox. **Deuda:** un reintento propio ante handle zombi
para `quivo-paquete-dia.db`.

**Abiertos o en rama:**

- **#161 `fix(api)`, rama `fix/pc-omitido-intermedios` (`50886f5`):** en rutas con un PC `retorno`
  activo (hoy solo la L16), los PC opcionales sin rol no disparan `pc_omitido` en vivo, y un PC
  inactivo no dispara en ninguna ruta.
  - La 120 y la Z12 no cambian.
  - `ci` y `acceptance` en verde.
  - Tests de `ingesta-worker` 236/236, con integración contra un postgis temporal.
  - `/code-review` aplicado.
  - Codex verify-fix: la versión inicial dio `fixes_root_cause`; la **final quedó NO verificada**
    (cuota agotada hasta las 21:41 del 15/10, exit 3).
  - **Antes del merge**, re-correr desde el worktree `.claude/worktrees/agent-a42e38482eac5894b`:
    `~/.claude/skills/codex-debug/scripts/codex-debug.sh verify-fix --dir .claude/worktrees/agent-a42e38482eac5894b --base origin/main --timeout 900 --symptom "..."`
  - **Tradeoff aceptado:** en la L16, saltarse Honduras se detecta en Molinos o en `fin_recorrido`,
    y el worker de vueltas no cuenta una vuelta sin `retorno`.
  - **F2:** comparación por fase en el servidor. También en F2, los cumplimientos de la fase
    equivocada quedan en la base sin generar infracción.
- **#162 `feat(mobile)`, polilínea azul (Fix 2), MERGEADO (`d4cd6f0`):**
  - Está rebaseada sobre `main`.
  - `/code-review`: 7 hallazgos, todos aplicados (`5651967`): tramo OSRM discontinuo con borde,
    zoom publicado al terminar la animación, `emisor-zoom` y `PolylineConBorde`.
  - Tests mobile 934/934.
  - Estado del merge: ver la línea "#162" al final de esta sección.
- **Fases de la vuelta, rama `feat/mobile-fase-vuelta` (`93aebeb`), worktree `.claude/worktrees/fase-vuelta`:**
  sin PR y **sin review**. Está construida sobre `4dbe6a5`, la versión de #162 anterior a sus fixes:
  **hay que rebasearla sobre `main`** después del merge de #162. Habrá conflictos probables en
  `route-map.tsx`, porque #162 movió el zoom a `emisor-zoom` y extrajo `PolylineConBorde`.
  - **Tests:** mobile 956/956 y shared 135/135, con 6 tests nuevos de `partirCircuitoPorRetorno`
    en `packages/shared/src/circuito.ts`.
  - **Dónde se decide la fase:** en `puntosDeLaFaseActual`, dentro de `registrarPuntoGpsInterno`
    (`headless-task.ts`). Es un punto único para foreground y headless. Si falla, se detectan
    todos los PC y se reporta a Sentry.
  - **Persistencia:** la fase y `fixesRegreso` viven en la fila `progreso_vuelta`, con el mismo
    CAS. Los campos son opcionales: en filas viejas, ausente equivale a ida.
  - **Fallback si el GPS no detecta Honduras:** 3 fixes seguidos a más de 60 m de la mitad de ida
    y a menos de 30 m de la de regreso pasan la fase a regreso (constantes en `fase-vuelta.ts`).
  - **Anclaje de la vuelta:** se ancla en `terminal`. Sin rol `terminal`, se usa el PC de menor
    `orden`.
  - **Molinos:** va en su `orden` si es mayor que el de Honduras; si no, justo después de Honduras.
  - **Numeración "PC N de M":** sobre el orden completo.
  - **Rutas sin retorno (120 y Z12):** comportamiento idéntico al de hoy.
  - **A revisar en la review:**
    - antes de iniciar, el mapa muestra solo la mitad de ida;
    - el tramo OSRM no se filtra por fase;
    - si el fallback cambia a regreso, Honduras no queda omitido en la app (el servidor sí lo
      marca en `fin_recorrido`).
- **PC intermedios por fase, rama `feat/linea-16-puntos-control-intermedios` (`4aa0561`):** pusheada,
  sin PR y **sin review**.
  - **17 PC:** SR 0, km 2–14 de ida (órdenes 1–7), Honduras 8, km 16–26 de regreso (9–14),
    Molinos 15 y km 28 (16).
  - **Reglas de generación:** la de 300 m aplica solo dentro de cada fase, y se quitó la guarda
    de 250 m previa a Honduras.
  - **Tests de `scripts/lib`:** 47/47.
  - **Ya conocidos para la review:**
    - la cabecera de `scripts/cargar-linea-16.ts` dice que "solo `fin_recorrido` marca Honduras",
      pero Molinos también la dispara (hallazgo 5 de #161);
    - "Control km 26" queda pegado a la bifurcación de Molinos;
    - el km 28 puede quedar salteado en una vuelta vía Molinos si la bajada se reincorpora
      después (verificarlo con la geometría);
    - el hook de Codex marca en cada revisión que el plan depende del filtrado por fase: es
      correcto, y por eso **no se aplica** hasta que esté instalado el APK con fases.
- **#163:** este handoff y el plan, solo docs.

**Siguiente, en orden:**
1. Si #162 no quedó mergeado: esperar `ci` y `acceptance` en SUCCESS y mergear.
2. Rebasear `feat/mobile-fase-vuelta` sobre `main`, con un subagente Sonnet que resuelva los
   conflictos de `route-map.tsx` contra `emisor-zoom` y `PolylineConBorde`. Después: tests, abrir
   el PR, `/code-review`, fixes con un subagente nuevo, CI y merge.
3. Después de las 21:41 del 15/10: Codex verify-fix de #161, y merge si pasa.
4. PR de los PC intermedios:
   - `/code-review` y fixes, incluido el de la cabecera.
   - Dry-run de `cargar-linea-16.ts` contra prod, **sin `--apply`**.
   - Merge.
5. Deploy de API + web (`scripts/deploy-gcp.sh`, con el ok del CTO ya dado). Verificar el health,
   `/mobile/vuelta-actual`, la subida a GCS y los logos.
6. Breakpoint del APK:
   - Pasar el changelog al CTO (#150–#162, fases y #161). Según su indicación, no hace falta
     esperar otra respuesta.
   - Pre-build:
     - `eas env:list --environment production` (las tres claves del build);
     - `pnpm install --frozen-lockfile` limpio;
     - `eas build:list` para el `versionCode`.
   - **No subir reanimated a 4.x.**
   - `eas build --platform android --profile production`.
7. Instalar en `1616PIL`, `1616PIB` y `1616PIC`. Probar un OTA de humo y después
   `cargar-linea-16.ts --apply` (ok del CTO ya dado para ese momento). Verificar en el dispositivo:
   - el cambio de fase en Honduras;
   - la rotonda;
   - el aviso de Molinos;
   - la polilínea a zoom 16–18.
8. Pendiente con el CTO: #105 (script de asignaciones del 08/10), ¿cerrar?

**Worktrees vivos:**

| Worktree | Rama |
|---|---|
| `fase-vuelta` | fases |
| `agent-a42e38482eac5894b` | #161 |
| `docs-fase` | #163 |

Borrar cada uno al mergear su PR.

**#162:** mergeado el 15/10 (`d4cd6f0`); worktree `fix2-polilinea` y rama borrados. El paso 1 de "Siguiente" ya está hecho.

## Punto de retome — 2026-10-14, 08:00 (anterior): F1 en main, F1-mobile y Fix 2 por mergear, piloto de 3 trufis

- **Mergeados:** #158 (trazado L16; Codex verify-fix no corrido, el CTO lo eximió), #155 (foto del
  vehículo), #154 (vueltas/designación API; conflicto en `cargar-linea-16.ts` resuelto: base =
  `ida + regreso + salomon`, variante "Vía Molinos" = `conector + ramal + bajada`), #157 (web).
- **Abiertos:** #159 `feat(api,mobile)` aviso de designación a Molinos (F1-mobile; incluye `rol` en el
  paquete del día y el orden efectivo de PCs). Fix 2 polilínea azul (`feat/mobile-polilinea-navegacion`,
  worktree `fix2-polilinea`, encima de #159). Decisiones y limitaciones en `docs/plan-molinos-designacion.md`.
- **Oks del CTO (2026-10-14):** deploy API+web a prod cuando #159 y Fix 2 estén mergeados;
  `cargar-linea-16.ts --apply` (separación base/variante); build del APK tras pasarle el changelog.
- **Piloto con 3 trufis (pedido del CTO), APLICADO en prod 2026-10-14 07:55:** 2 vehículos/choferes más (`1616PIB` Bravo, `1616PIC` Charlie, 13 asignaciones c/u del 14 al 26/10; rotación `piloto-linea-16` anulada→ampliada→publicada, 40 asignaciones) con
  `crear-piloto-linea-16.ts`; PINs en `~/.quivo-piloto16-creds`. Si el APK nuevo se demora, el piloto
  corre con el **APK anterior**. Con ese APK, dos reglas (CTO, 2026-10-14):
  1. **La designación a Molinos no le llega al chofer** (el APK viejo no tiene el aviso): se designa en
     `/en-vivo` y se le avisa por teléfono/radio.
  2. **NO correr `cargar-linea-16.ts --apply` (separación base/variante) mientras se use el APK viejo.**
     El APK viejo ordena los PCs por `orden` (SR 0, Molinos 1, Honduras 2): hoy la base pasa por
     Molinos y no se nota; si Molinos sale de la base, el APK viejo manda al chofer a un punto fuera de
     la ruta y lo marca omitido. El `--apply` va recién con el APK nuevo instalado en los 3 trufis.

## Punto de retome — 2026-10-14, 05:50 (leer primero): trazado de la línea 16 aplicado en prod; #158 abierto

Plan: [`docs/plan-trazado-linea-16.md`](plan-trazado-linea-16.md). Pedido del CTO 02:15 (bloquea el
próximo APK, memoria `apk-pre-build-fixes-ruta-16`): retorno en la calzada correcta + polilínea de
navegación azul del ancho del carril.

- **#158 `fix(scripts)`** (`fix/linea-16-trazado-calzadas`, worktree `.claude/worktrees/l16-trazado`,
  `a0a9c06`): trazado por calles con Google Routes (key `google-routes-server-key` en Secret Manager,
  restringida a Routes), 6 tramos `ida, regreso, conector, ramal, bajada, salomon`, circuito cerrado.
  Regreso al norte de la rotonda Libertador/Atahuallpa sin el rodeo con U. Zona terminal v8..v24
  ruteada par a par (decisión del CTO: variante del sindicato); huecos Calle Los Tajibos y Calle Aguas
  Potables Norte con geometría OSM. `/code-review` ×2 (20 hallazgos, aplicados). Tests 40/40.
  `ci` + `acceptance` SUCCESS. **Falta Codex verify-fix** (cuota agotada hasta 10:31; exit 3 = no
  verificado) → después merge.
- **Aplicado en prod 2026-10-14 05:42 con ok del CTO:** `cargar-linea-16.ts --apply` → PATCH de la
  ruta `460c9015…` (213 → 1425 vértices, 27,2 → 32,8 km). PCs, paradas, variante y asignaciones del
  piloto sin cambios. Re-corrida en dry-run: 0 escrituras. Reversible: re-PATCH con la geometría de
  `86533ea` (boceto) si hiciera falta.
- **No verificado:** que Los Tajibos (v10–v11) y Aguas Potables Norte (v18–v19) sean transitables para
  el trufi; la ruta nueva en la app (rotonda y terminal, en el teléfono).
- **Pendiente fuera de alcance:** vecinos delante/detrás en la API (`vecinos-ruta.service.ts`,
  `ST_LineLocatePoint` global) se rompen con tramos solapados (ida/salomon por la misma calle).
  Detalle en el plan. El "recorrido inverso" del editor web tiene el mismo defecto que tenía el script.
- **Fix 2 (polilínea de navegación mobile):** sin empezar, después de F1-mobile (ambos tocan
  `route-map.tsx`).

**Siguiente:** a las 10:31, Codex verify-fix de #158, #155 (`--base 07a3281`), #154 (`--base 7543b58
--timeout 900`) y #157; merges #158, #155, #154; rebase de #157 sobre `main`, CI, merge. Después
F1-mobile, Fix 2, deploy (ok del CTO) y breakpoint del APK (changelog: #150–#158, F1-mobile, Fix 2).

## Punto de retome — 2026-10-14, 01:30 (anterior): B, C, G y fix del Select mergeados; F1-api (#154) y D (#155) abiertos

Plan vigente: [`docs/plan-molinos-designacion.md`](plan-molinos-designacion.md) (F1 bloquea el APK, F2 después).

**Decisiones del CTO (2026-10-13/14):**
- **Bucket:** `gs://quivo-control-prod-media` creado y verificado (`southamerica-west1`, acceso uniforme, allUsers `legacyObjectReader`, SA de la API `objectAdmin`).
- **`expo-updates`:** aprobado.
- **Aviso de Molinos:** va **dentro del APK**, no por OTA.
- **Quién designa:** solo desde la web; el admin o "el control" con el rol **`operador`**. El operador ve el mapa y designa en `/en-vivo`, pero no atiende, descarta ni sanciona. El chofer solo recibe el aviso y toca "Entendido" (en la web: "visto ✓").
- **Sin definir:** tolerancia de "fuera de horario" (solo F2).

| PR | Qué | Commit |
|---|---|---|
| #150 | **B.** Teléfono del conductor: `Conductor.telefono`, normalización Bolivia en shared y `redactarPii` en la auditoría. Revisión de seguridad limpia. ⚠ Se mergeó con `acceptance` en rojo, lo que rompió `admin-panel.spec.ts:140`; se corrigió en #153. Desde entonces rige la memoria `merge-gate-todos-los-checks`: `gh pr view <n> --json statusCheckRollup` con `ci` **y** `acceptance` en SUCCESS. | `460e4d2` |
| #153 | `fix(design-system)`: el listbox del Select se voltea hacia arriba y acota su altura al viewport (`computeSelectPosition`). Codex `fixes_root_cause`. | `99ec4c8` |
| #152 | **G.** OTA con `expo-updates` (`checkAutomatically: NEVER`). El updater propio solo actualiza en primer plano, sin recorrido activo, y recarga solo en pantallas previas a la operación. `runtimeVersion` por fingerprint. `scripts/publicar-ota.sh`. No verificado en dispositivo. | `2a9efb5` |
| #151 | **C.** StorageService en GCS; los logos pasan a GCS. Foto del vehículo: `POST/GET /mobile/vehiculo/foto` y `DELETE /vehiculos/:id/foto`. No verificado: subida real a GCS (verificar tras el deploy). | `7a3eb9c` |

**Abiertos (no mergeados):**

- **#154 `feat(api)`: vueltas en el servidor + designación a Molinos.** Worktree `.claude/worktrees/f1-api`, rama `feat/vueltas-molinos-api`.
  - **Commits:** `7543b58` (feat), `6d2ff33`, `1b948e2`, `52c1fae` y `73ca474` (fixes de las revisiones 1–4). **Todo pusheado.**
  - **Ronda 4 (`73ca474`):**
    - `designar` toma primero el mismo advisory lock `vueltas:<sesionId>` que el worker (`bloquearVueltasSesion`), sin reintento: no hay deadlock.
    - El cierre tardío nunca borra vueltas.
    - `finTs` = max(cierre, hitos).
    - Borrados los wrappers muertos.
    - El chairman revisó el diff de `designar`. Typecheck 10/10; tests api 643, shared 126 y db 34. Un test flaky ajeno al cambio: `auditoria.controller.integration` (401 de better-auth), que pasa solo.
  - **Diseño final de las vueltas:**
    - El trigger `vueltas_cerrar_con_sesion` solo marca la vuelta `abierta_al_cierre`; nunca borra. Fija `app.sindicato_id` a la sesión y lo restaura después.
    - El worker es el único escritor real. El modo "cierre tardío" es la máquina normal sin abrir vueltas, con 120 s de tolerancia.
    - Las vueltas vacías no designadas se borran en `fin_recorrido` o en un nuevo `inicio`. Las que quedan tras el cierre se excluyen con `vueltaContable` / `vueltaNoVacia`. **F2 debe usar esos filtros.**
    - Cursor de espera: `esperaRevisadaHastaTs`.
  - **Gates:**
    - Revisión de seguridad: limpia.
    - `/code-review`: 4 rondas, todas aplicadas.
    - **Falta:** `codex verify-fix` (la cuota de Codex se agotó hasta las 04:06 del 2026-10-14) y el CI verde de `73ca474`.
    - Correr: `~/.claude/skills/codex-debug/scripts/codex-debug.sh verify-fix --dir .claude/worktrees/f1-api --base 7543b58 --symptom "..."`.
  - **No decidir más rondas completas de `/code-review`.** Ya encontraban casos cada vez más raros. Lo que quede va como limitación documentada para F2.
  - **Pruebas locales:** DB `quivo_f1fix` (postgres en el puerto 5434). Correr antes `set -a && . apps/api/.env && set +a` en el worktree.
- **#155 `feat(mobile)`: foto del vehículo (D).** Worktree `.claude/worktrees/agent-a2c2b043c54958ab0`, rama `feat/mobile-vehiculo-foto`. Commits `07a3281` (feat) y `60fbad4` (fix de 10 hallazgos).
  - **Qué incluye:**
    - `expo-image-picker ~17.0.11` y `expo-image-manipulator ~14.0.8`.
    - Recorte cuadrado de 512 px.
    - La foto pendiente queda atada a la sesión.
    - Verifica con un GET antes de reintentar, porque el POST no es idempotente.
    - `getPendingResultAsync`.
    - `READ_EXTERNAL_STORAGE` bloqueado. `WRITE` **no**: expo-image-picker lo exige para la cámara en Android < 10.
  - **CI:** `ci` y `acceptance` en SUCCESS.
  - **Falta:** `codex verify-fix` (cuota), y después el merge.
  - **No verificado en dispositivo.** Cambia el fingerprint: va en APK, no por OTA.
  - Preexistentes que marca `expo install --check`: `expo` 54.0.36 (pide ~54.0.37), `expo-constants`, y `react-native-reanimated` 3.19.5 (pide ~4.1.1). Anotar para el APK.

**Siguiente, en orden:**
1. Cerrar #154 y #155: verify-fix, CI con todos los checks, merge, borrar la rama y el worktree.
2. **F1-web** (lista completa en el plan): sección "Vuelta N de hoy" con Directo / Vía Molinos y el chip "Sugerido", estado de acuse, HUD Molinos, badge "M", ícono fijo de atendidas (`infraccionNivelAtendida`), hoja plegable ≤720 px, y el operador solo con mapa + designación.
3. **F1-mobile**, después de D por el lockfile: `useVueltaActual` y el aviso grande con "Entendido". Incluye `expo-speech` y una notificación local, la ruta ajustada y la cuenta regresiva de la espera.
4. PR de docs: este handoff y `docs/plan-molinos-designacion.md`, si todavía no se mergeó.
5. Deploy a prod **con ok del CTO**: `scripts/deploy-gcp.sh` con `GOOGLE_MAPS_MAP_ID=430254e21207af4870419ff7 TAG=r17-...`. Después:
   - verificar la subida real a GCS y los logos;
   - `cargar-linea-16.ts --apply`, con ok del CTO, revisando antes las asignaciones y sesiones de la ruta `460c9015…`.
6. **Breakpoint del APK:** frenar y pasar al CTO el changelog por PR (#150, #151, #152, #153, #154, #155, F1-web, F1-mobile). El CTO va a sumar cambios estéticos y correcciones de la prueba de campo de `1616PIL`.
7. Verificar si las `EXPO_PUBLIC_*` existen en el environment `production` de EAS.
8. F2, que necesita la tolerancia de "fuera de horario". Al terminar el piloto: `crear-piloto-linea-16.ts --desactivar --apply`.

## Punto de retome — 2026-10-13 (anterior): PR E mergeado, modelo de Molinos corregido

| PR | Qué | Commit |
|---|---|---|
| #147 | **PR E.** Marcador de vehículo en motor Google: foto con fallback al sprite, anillo del color de línea, frescura, badge de severidad con conteo, parpadeo por nivel (leve 1600 / grave 1000 / gravísima 600 ms, reduced-motion estático), zIndex por severidad, selección y conteo actualizados sin recrear el DOM. HUD `/en-vivo`: contadores por nivel como filtro y "Siguiente alerta". **Panel de vehículo unificado** (reemplaza el drawer): Seguir, Ver recorrido, contacto si hay teléfono, infracciones con Ver en mapa / Atender / Descartar / Sancionar (solo alteración de ruta; prellena `NuevaSancionModal` y POSTea `/infracciones/:id/sancionar`; reglas, vehículos y conductores filtrados al sindicato de la infracción). `fechaHecho` pasa a día local (mediodía), antes caía un día antes en Bolivia. Gates: `/code-review` ×3 (10+10+9, aplicados; 1 omitido con motivo), `web-design-guidelines` (22, aplicados), Playwright 118/118 contra `next start` con API mockeada, CI verde. `/security-review` no corrido: sin endpoints, RLS ni secretos nuevos. | `8004bfe` |

**Estado de E:** mergeado y **desplegado en `r16-20261013`** (2026-10-13, con el ok del CTO). Exit 0, health `ok` (db y redis up), revisiones `quivo-api-00019-9rh` y `quivo-web-00010-5cx`. El primer intento falló en el preflight porque había vencido el token de `gcloud`; el CTO corrió `gcloud auth login` y se relanzó. No verificado con API real ni con datos reales de `admin_quivo`. El primer subagente de E murió por límite de uso (429) sin dejar nada; se relanzó desde cero.

**Pendientes de E** (anotados en el plan):
- "Atender" quita la alerta del marcador en vez de dejar el ícono fijo, porque el LATERAL de `obtenerPosiciones` solo cuenta `abierta`. Se resuelve en el PR F.
- En móvil, con el panel abierto, queda visible solo una franja de mapa de unos 24 px. Propuesta: hoja plegable que "Ver en mapa" pliegue.

**Modelo de Molinos corregido por el CTO (2026-10-13)** (detalle en el plan, PR F, y en la memoria `operacion-lineas-tiquipaya`):
- **Toda vuelta termina en Salomón Romero** y cuenta recién al volver a SR. La vuelta "vía Molinos" va así: Honduras → regreso → sube por Putucu → Molinos (**espera 30 min**) → baja → SR.
- **Total obligatorio por chofer:**
  - Lunes a viernes: 5 (4 directas + 1 vía Molinos).
  - Sábado: 3 (2 + 1).
  - Domingo: 4 (3 + 1).
- Esto confirma N = directas + 1 para la frecuencia de envíos a Molinos.
- La geometría en prod (circuito que **termina** en Molinos) no representa el recorrido real. Hace falta una variante "vía Molinos".
- **Designación de destino (PR F):** el admin designa desde `/en-vivo` (en la operación también puede el control de Honduras), antes o durante la vuelta. El sistema sugiere a quién mandar. **El chofer recibe un aviso en pantalla, como el del PC, y ve la ruta ajustada.** Requiere APK: hoy no hay push, así que la app consulta la designación con la app abierta.
- **Salir de Molinos antes de 30 min genera una alerta leve** (confirmado por el CTO).

**APK siguiente:** foto (PR D) + designación de Molinos (PR F) + `expo-updates`/EAS Update (OTA para cambios solo JS; plan gratis de 1000 MAU). **Antes del build, avisar al CTO con el changelog: va a sumar cambios estéticos.**

**Siguiente:**
1. Verificar `/en-vivo` en prod con login real y el piloto `1616PIL`.
2. Plan detallado del PR F con el modelo corregido, que incluye los dos pendientes de E.
3. PR B → PR C (bucket con ok del CTO) → PR D. Después, el APK con el changelog previo.

## Punto de retome — 2026-10-12, tarde (anterior): /en-vivo — fotos, alertas por infracción y acciones rápidas

El CTO pidió llevar al producto real lo del demo (`~/Downloads/Quivo-control`, todo mock): marcadores con
foto del trufi, parpadeo en 3 niveles por infracción y ficha con acciones rápidas, sobre Google Maps.
Plan aprobado: [`docs/plan-en-vivo-alertas.md`](plan-en-vivo-alertas.md). Premisa corregida: en el sistema
real no existen detección de infracciones, foto de vehículo, teléfono del conductor ni bucket. Decisiones:
desvío + PC omitido automáticos; niveles = `gravedad` de Reglas (leve/grave/gravísima); foto del vehículo
subida por el conductor desde la app; WhatsApp + Llamar; sanción sin plazo. Orden: A (infracciones, API) →
E (marcador + panel) → B (teléfono) → C (GCS + foto; bucket con ok del CTO; corrige logos en disco
efímero de Cloud Run) → D (app, APK 16) → F (vueltas y sanciones compensatorias, nuevo). **Estado: #137, #140 y #142 desplegados en prod (`r15-20261012`). Línea 16 cargada (#143) y piloto creado (#145).**

| PR | Qué | Commit |
|---|---|---|
| #142 | Detección automática de infracciones. Incluye: tabla `infracciones` y `sesion_desvio_estado` con RLS; detección en el worker después de persistir la evidencia del lote. **Desvío:** ≥3 puntos a >100 m durante ≥45 s, cierra con 2 puntos a <60 m; se evalúa solo dentro de un recorrido y solo en rutas con `rutas.desvioHabilitado`, que por defecto es **false**. Tras el deploy no hay ninguna ruta habilitada: se activa por SQL solo en geometrías trazadas con GPS, como la Z12. **PC omitido:** ventana por recorrido con tolerancia de 120 s (inicio/fin usan el reloj del sistema, los cumplimientos el GNSS); se marca en vivo y al `fin_recorrido`; es **solo alerta** (sancionar devuelve 409). `PosicionEnVivo` gana `infraccionNivel`, `infraccionesAbiertas`, `vehiculoId` y `conductorId`. Endpoints nuevos: listar, atender, descartar y sancionar (sujeto validado contra la infracción, en la misma transacción). Gates: `/code-review` en 2 rondas (12 hallazgos aplicados), `/security-review` sin hallazgos ≥8, 223 tests de los módulos tocados más integración con Postgres, CI verde. | `a49b80b` |
| #143 | `scripts/cargar-linea-16.ts`: carga por la API (prod es solo IP privada), dry-run por defecto, pre-vuelo que aborta si el estado de prod no es el esperado, idempotente. **Aplicado en prod el 2026-10-12:** Línea 16 (`0a7df039…`, sindicato piloto `51493936…`), una ruta `circuito` de 213 vértices, 27,2 km. Recorrido: Salomón → El Prado → Honduras (= RETORNO) → Aroma → Ayacucho → Libertador/América (cierra a 11,7 m de la ida) → bifurcación → ramal Putucu → Molinos. Puntos de control: Salomón (0) y Molinos (1) no obligatorios, Honduras (2) obligatorio. 3 paradas, 1 variante, **sin asignaciones**. Re-corrida en dry-run: 0 escrituras. | `4143439` |
| #145 | `scripts/crear-piloto-linea-16.ts`. Crea socio, vehículo **`1616PIL`**, conductor "Piloto Línea Dieciséis", PIN del conductor y una rotación publicada (`f1f38e25…`) con 14 asignaciones `manana` del 2026-10-13 al 2026-10-26 en la ruta circuito de la 16 (`460c9015…`). **Aplicado en prod el 2026-10-12:** 21 escrituras, verificación OK. El PIN está solo en `~/.quivo-piloto16-creds` de la máquina del CTO (archivo 0600); la API guarda el hash. Si `generar()` reparte a otro vehículo, el script borra lo creado y aborta. ⚠ Mientras 1616PIL y el conductor piloto estén activos, una rotación generada desde el panel los incluye: al terminar el piloto, correr `--desactivar --apply`. | `86d6e91` |

**Operación de Tiquipaya (CTO, 2026-10-12)**, detalle en el plan, "Decisiones posteriores":
- La 120 es la troncal; los choferes alternan 3 días en la 120 y 1 en la 16.
- **Cupos fijos de vueltas a Salomón (SR→SR):** 4 de lunes a viernes, 2 el sábado, 3 el domingo, **más 1 vía Molinos por día** (corregido el 2026-10-13, ver arriba).
- **Molinos:** todos suben 1 vez por día; el control o el admin decide cuándo.
- La 16 tiene entre 120 y 130 móviles.
- **Salidas de la mañana:** de 7 a 8, con 6 min entre cada una y después 7.
- **Nocturno:** desde las 17:01 (si deben 3 vueltas, desde las 15:00).
- **Sanciones compensatorias:**
  - Fuera de horario: una vuelta más.
  - Turno no cumplido: repetirlo al día siguiente.
  - Vueltas faltantes: en nocturno al día siguiente.
  - Alteración de ruta: una vuelta más.

**NO verificado:**
- Que la detección de #142 funcione en prod (no está desplegada).
- Que Honduras sea el punto RETORNO: el CTO dijo "creo".
- La geometría de la 16 es un boceto de My Maps, por eso queda sin detección de desvío.

**Deploy `r15-20261012` (2026-10-12):** lo corrió el chairman con el ok del CTO. Exit 0, migraciones OK (incluye `20261012100000_infracciones`), API `ok` (db y redis up), panel y worker actualizados. **No verificado:** el panel en prod con login real (recorridos y editor de rutas con Google) y la detección de infracciones con datos reales.

**Frecuencia de Molinos (estándar propuesto al CTO):** en Honduras (o en cualquier momento del viaje, mientras no haya ido hoy a Molinos) se manda a Molinos 1 de cada N llegadas, con N = vueltas a Salomón del día + 1. Con llegadas cada 6-7 min, sale uno a Molinos cada ~30-35 min de lunes a viernes, ~18-21 min el sábado y ~24-28 min el domingo. No depende del tamaño de la flota. El primer cálculo (125 móviles repartidos en la ventana) estaba mal y el CTO lo corrigió. Horario: primera salida entre las 7 y las 8 (después es "fuera de horario"); el diurno termina a las 17:00.

**Siguiente:**
1. **Piloto de la 16 en calle desde el 2026-10-13** (placa `1616PIL` + PIN). Mirar en `/en-vivo` los pasos por Salomón y Honduras y los `pc_omitido`. Al terminar: `--desactivar --apply`.
2. **PR E:** marcador con foto y alertas, y panel de acciones rápidas en `/en-vivo`.
3. **PR F:** vueltas SR→SR, Molinos 1 vez por día con sugerencia 1 de cada N en Honduras, fuera de horario (7-8), turno no cumplido y sanción compensatoria agendada (nocturno desde las 17:01).
4. Habilitar `desvioHabilitado` por SQL solo en rutas trazadas con GPS (Z12), si el CTO lo quiere.
5. PR B (teléfono del conductor) → PR C (GCS y foto, con el ok del CTO para el bucket) → PR D (APK 16).

## Punto de retome — 2026-10-12 (anterior): /en-vivo — zoom, latencia y Google Maps

El CTO vio /en-vivo desde el teléfono manejando: la web iba atrasada, el zoom se perdía en cada
actualización y pidió Google Maps (el panel usa **MapLibre**, no Leaflet). Plan aprobado:
[`docs/plan-en-vivo-google.md`](plan-en-vivo-google.md) — PR 1 zoom (`fitMode` caía en `'auto'`),
PR 2 latencia (poll 2 s web + piso de drenado 3 s móvil, APK 15), PR 3 motor Google + /en-vivo,
PR 4..N resto del panel y borrar MapLibre. **Estado: PR 1, 2 y 3 desplegados en prod (`r14-20261012`); APK 15 (versionCode 15, drenado 3 s) compilado; PR 4 (#137, recorridos) y PR 5 (#140, editor de rutas) en `main` sin desplegar. Todo el panel usa Google; solo la landing sigue con MapLibre.**

| PR | Qué | Commit |
|---|---|---|
| #131 | `/en-vivo` con `fitMode="once"` (encuadra al montar, con Reencuadrar y en flota vacía → con vehículos); mapa siempre montado (loading/error/vacío como overlays; refetch fallido con datos = chip "Sin conexión"); `encuadreAuto`/`encuadreUnaVez` puros con tests (contrato que hereda el motor Google). Verificado en navegador con API mockeada: zoom 18.10 se mantiene tras polls y paneo; en `main` volvía a 15.68. | `7a942d1` |
| #132 | `/posiciones` cada 2 s; vehículo seleccionado con el último fix de ese poll (`conPuntoVivo`), traza sigue a 10 s; rate limit en vivo: 1000/min/IP pre-auth + 600/min/usuario (guard propio tras `JwtAuthGuard`, contador único por controller); móvil: piso de drenado 3 s, backoff de fallo desde 10 s (**sale en APK 15**). | `27028fe` |
| #134 | Motor Google Maps (`@vis.gl/react-google-maps` 1.10.1) en `route-map-google.tsx` con el mismo `RouteMapProps`; `RouteMap` gana `engine` (default `'maplibre'`) y solo `/en-vivo` usa `engine="google"`. Interpolación de todos los vehículos (≤1 s, reduced-motion), encuadre/follow/`onUserPan` (gestos detectados por DOM, `esGestoUsuarioDeCamara`), cámara preservada al cambiar tema, markers accesibles (role/foco/aria con frescura, área táctil ≥44 px), mensajes sin key/auth/carga con "Reintentar" (recarga: el loader de vis.gl es singleton). Helpers puros con tests: `route-map-shared/interpolacion/proyeccion/gestos.ts`. Deploy: key desde Secret Manager `google-maps-web-key`, Map ID desde env `GOOGLE_MAPS_MAP_ID`, validados en el preflight del Paso 0 (antes de migraciones/API). | `07389bf` |
| #137 | `reportes/recorridos/[id]` con `engine="google"`. Motor Google: emula `line-offset` entre rutas paralelas (`desplazarCamino` en `route-map-proyeccion.ts`: mitra acotada a 2×, rachas de puntos repetidos sin muescas, O(N)), recalculado por zoom con rAF en el handler existente; etiqueta en el punto medio del camino desplazado; `offsetRutaParalela` compartido con MapLibre. **Bug de #134 corregido:** fuera de /en-vivo el mapa Google quedaba con altura 0 (vis.gl 1.10.1 descarta `style` si hay `className`; /en-vivo lo tapaba con `!important`) → regla `.qv-gmap > .qv-route-map__canvas`. Gates: `/code-review` (10, aplicados), `/codex-debug verify-fix` `fixes_root_cause` (riesgo O(N²) resuelto), Playwright con API mockeada (478 px, dos líneas lado a lado, claro/oscuro; /en-vivo 850/850), CI verde. **Error del chairman:** el test de 20 000 duplicados tenía una aserción de tiempo de reloj (< 50 ms) que pasó en #137 y falló en el runner (67 ms) → `main` en rojo; quitada en #139. Regla: nada de aserciones de tiempo de reloj en tests. | `12427d6` |
| #139 | Quita la aserción de tiempo de reloj del test de `desplazarCamino` (devolvía `main` a verde). | `c841fd6` |
| #140 | Editor `rutas` con `engine="google"`. Motor Google gana markers arrastrables (`gmpDraggable`, solo puntos de edición; vehículos nunca), teclado nativo de Google (Alt+Enter, flechas, Enter suelta, Esc cancela; el foco queda en el host `<gmp-advanced-marker>` con título "Nodo N — Alt+Enter para mover"), estado de arrastre por entrada, supresión determinista del click posterior al arrastre (`clickTrasArrastre`, 500 ms, un click), el click del mapa ignora targets dentro de markers, listeners perezosos, foco preservado al cambiar arrastrable↔no, `pulse` con halo animado (reduced-motion: estático). Helpers puros con tests en `route-map-puntos.ts`. Premisa corregida: reglas/vehículos/líneas **no** usan `RouteMap` (son mocks CSS), así que el editor era el último consumidor del panel. Gates: revisor Codex (4), `/code-review` ×2 (10 + 9, aplicados; omitido: si el consumidor rechaza la posición el marker queda donde se soltó — el editor siempre acepta), `web-design-guidelines`, Playwright con API mockeada (arrastre con mouse + Deshacer, teclado, Esc, click agrega nodo, halo; /en-vivo 850/850, recorridos 478 px), CI verde. | `26db7a8` |

**Gates:** `/code-review` en ambos con hallazgos aplicados (#132: 2 rondas — pre-auth sin límite, cupo ×4 por handler, carga de traza a 2 s). `/codex-debug verify-fix` **no corrió** en #131 (límite de Codex). **#132 se mergeó con el CI todavía en curso** (error de proceso del chairman: el gate leía la salida de `tail`, no el exit code); el run terminó verde (`ci` + `acceptance`) después del merge. #134: revisor Codex durante la implementación (6 hallazgos), `/code-review` (10) y `web-design-guidelines` (10), todos aplicados; CI verde antes del merge (gate por exit code).

**Infra Google Maps (2026-10-12):** API `maps-backend.googleapis.com` habilitada en `quivo-control-prod`; key de navegador `quivo-web-maps` (referrers: los dos `quivo-web-*.run.app` + `localhost:3000`, solo Maps JS) creada por el CTO; secreto `google-maps-web-key` (v1) creado por el chairman. Local: `apps/web/.env.local` (gitignored) con la key + `DEMO_MAP_ID`; el dev server tiene que correr en el puerto 3000 por el referrer.

**Deploy `r14-20261012` (2026-10-12, lo corrió el CTO):** `GOOGLE_MAPS_MAP_ID=430254e21207af4870419ff7 TAG=r14-20261012 scripts/deploy-gcp.sh` desde `main` en `4cadce5`, exit 0. Map ID `quivo-web` (Vector, JavaScript) creado por el CTO en consola. Verificado: migraciones OK, `/v1/health/ready` ok (db+redis up), web responde 200, y la imagen web tiene el Map ID y la key embebidos en el chunk de `/en-vivo`.

**NO verificado:** /en-vivo en prod con login real (que el mapa Google cargue sin error de auth del referrer); latencia real en calle y costo de batería del drenado cada 3 s (APK 15); #134: pellizco en teléfono real, foco/hover visual.

**Siguiente:**
1. ~~Map ID~~ y ~~deploy~~ hechos. CTO: abrir /en-vivo en prod y confirmar que carga el mapa Google. Próximos deploys del panel: siempre con `GOOGLE_MAPS_MAP_ID=430254e21207af4870419ff7` (el Map ID no es secreto).
3. **APK 15 compilado** (2026-10-12, `production`, versionCode 15, commit `4cadce5`): https://expo.dev/artifacts/eas/Eo25QCSbZ28La6FiiAdTBtyecB0pIObuQzMr1s8iJCc.apk — único cambio móvil: drenado cada 3 s, backoff de fallo desde 10 s. Pendiente prueba en calle (CTO): latencia (objetivo 3-6 s), batería, y el checklist del APK 14.
4. **Deploy del panel** con #137 y #140 (sale de `main`): `GOOGLE_MAPS_MAP_ID=430254e21207af4870419ff7 TAG=r15-<fecha> scripts/deploy-gcp.sh`. Lo corre el CTO o da el ok.
5. **CTO decide la landing (`FleetPanelPreview`)**: imagen estática (recomendado: sin costo de carga de mapa por visita pública) o mapa Google real.
6. **PR final:** borrar `route-map-impl.tsx`, `maplibre-gl`, el prop `engine` y el CSS `.leaflet-*` muerto; actualizar ADR 0004 y `plan-ubicacion-fluida.md:172`. Depende del punto 5.

**NO verificado (#140):** arrastre táctil en dispositivo real, cambio arrastrable↔no con foco en vivo, lector de pantalla real.

## Punto de retome — 2026-10-11, noche (anterior): prueba de campo del APK r13

El CTO probó el APK r13 en calle. Hallazgos, causas raíz y plan:
[`docs/plan-prueba-campo-r13.md`](plan-prueba-campo-r13.md). **Estado: los 4 PRs del plan están en `main`**
(CI verde en todos). **APK de producción versionCode 14** (changelog aprobado por el CTO, build desde `main` en `83ba099`):
https://expo.dev/accounts/shadow00/projects/quivo-conductor/builds/b4512e08-8424-423f-87c2-463ddf0b6161
— artefacto: https://expo.dev/artifacts/eas/s4mNgNPvCVC-0zOYfrk0MZiMkwN0WGK_aF_EJtcnmoo.apk

| PR | Qué | Commit |
|---|---|---|
| #124 | Sheet completo al iniciar ruta (colapso solo por arrastre, offset medido); FABs en fila anclados al sheet (antes `bottom:180` fijo los tapaba: Centrar nunca se veía); pill "Centrar" en libre; brújula propia (navegación: alterna rumbo/norte arriba sin salir del seguimiento); gestos por toques crudos. | `b191eab` |
| #125 | 408 (`LOCATION_TIMEOUT` del SDK, no HTTP) deja de mostrarse en el sheet: chip "Señal GPS débil" hasta el próximo fix de evidencia; 1/3 con mensaje accionable; Sentry: transitorios como breadcrumb (foreground + heartbeat). Chime regenerado (pico -3 dBFS, cresta 12.7 dB; antes casi onda cuadrada) + canal de notificación v2. | `1feeb6c` |
| #126 | Progreso de vuelta: puntos en cualquier orden, omitidos en rojo, vuelta al volver al punto de inicio, "Vuelta N" del día; persistido en SQLite (`progreso_vuelta`, clave `sesionId:fecha`, CAS sobre `version`); foreground + headless; RF-GPS-054 y glosario actualizados. | `537bd97` |
| #127 | Snap visual a la polilínea de la ruta (rumbo separa sentidos, histéresis, animación por la calle); zoom automático por velocidad (18→16); canal visual 1 Hz ON en EAS `production` y `development`. Evidencia/sync/geofence siguen con GPS crudo. | `5d22dc3` |

**Sentry (APK r13, 2026-10-11):** único issue `QUIVO-CONTROL-CONDUCTOR-7` "Error: 408" (2 eventos, handled),
cubierto por #125. Sin crashes. El teléfono de prueba tenía `ACTIVITY_RECOGNITION` sin conceder.

**Gates:** `/code-review` high en cada PR con hallazgos aplicados (descartados y anotados: orientación
norte/rumbo se pierde al remontar la pantalla; padding inferior fijo de 180 en el encuadre general).
`/codex-debug verify-fix` solo corrió en #124 (`fixes_root_cause`); en #125–#127 **no corrió**: Codex
llegó al límite de uso de la cuenta (hasta 2026-10-12 03:56).

**NO verificado (todo en teléfono) — checklist de la próxima prueba:**
- sheet y FINALIZAR completos al iniciar; tira colapsada limpia; brújula rumbo↔norte; Centrar tras pan/pinch;
- **fix #109 con el canal visual ON:** ciclos primer/segundo plano y pantalla apagada sin crash;
- avenida doble: marcador sobre el carril de la ruta; zoom que cambia con la velocidad;
- puntos marcados fuera de orden (verde/rojo) y "Vuelta 1" al volver al punto de inicio, también con la
  pantalla apagada (camino headless; el store CAS no tiene tests unitarios);
- chip "Señal GPS débil" sin falsos positivos detenido; chime limpio y audible dentro del vehículo.

**Backlog derivado:** OSRM en VM GCP (snap fuera de ruta + ruta real al próximo punto); vueltas en
servidor y panel web; padding del encuadre general medido.

**Siguiente:** prueba de campo del APK 14 con el checklist.

## Release 13 completo, APK de producción lanzado (2026-10-11)

**Estado:** las 3 features del release 13 están en `main` y el backend está desplegado. El APK de producción (versionCode 13) se lanzó en EAS:
https://expo.dev/accounts/shadow00/projects/quivo-conductor/builds/56239100-0bef-4c43-bdf4-3ee894e9c04a

**PRs de esta sesión**

| PR | Qué | Commit |
|---|---|---|
| #119 | Móvil C2: modo navegación (cámara bloqueada al vehículo, pitch 55, zoom 18, vehículo en el tercio inferior, `libre` con un gesto, Recentrar, sheet colapsado). La cámara se mueve en el mismo tick que el marcador, así que no hay desfase de easing. | `d15b7c7` |
| #120 | Móvil A: EMPEZAR DÍA (`inicio_jornada` por el outbox, store en AsyncStorage por vehículo + conductor + sesión + día boliviano, rollover a medianoche, `DriverRouteCard` extraída con pill y variante compacta). | `e17bf86` |
| #121 | Móvil B: vecinos delante/detrás (poll de 30 s, estados vecino / nadie / sin dato, silueta SVG, overlay fuera del padding de cámara). | `7989997` |

Cada uno pasó `/code-review` con todos los hallazgos aplicados, la revisión del hook Codex y CI verde (ci + acceptance). Decisiones de C2 en `docs/plan-release-13-features.md`, sección "C2 — decisiones de implementación". El backlog v2 (Picture-in-Picture, entre otros) está al final de ese plan.

**Deploy a producción (confirmado por el CTO):** `TAG=r13-20261011 scripts/deploy-gcp.sh` desde `main` en `1214874`, exit 0. API, migraciones, web y worker quedaron en `r13-20261011`.
- `/v1/health/ready` responde 200.
- `vecinos-ruta` y `reportes/jornadas` responden 401 (antes 404).
- Rollback: redesplegar `v1`. La migración del índice queda aplicada; es inocua.

**Build:** perfil `production`, `buildType: apk` (todavía no va a Play Store). El canal visual queda **apagado**: `EXPO_PUBLIC_GPS_CANAL_VISUAL` no está en el entorno EAS production. `GOOGLE_MAPS_ANDROID_API_KEY` ya existía en production. El CTO aceptó los desvíos de A respecto al comp (la pill va en la tarjeta del conductor; la tira compacta en recorrido no se rehízo). El CTO confirmó que todos los teléfonos del piloto tienen GMS.

**NO verificado (todo en teléfono):**
- motor Google (#112), navegación (#119), A (#120), B (#121) y el fix #109;
- el mapa en blanco por el SHA-1 de la key de Maps: se ve en el primer arranque del APK;
- costo del bridge en navegación (~3–5 mensajes por frame a ~30 Hz con la arquitectura vieja): medir en un teléfono de gama baja;
- un `inicio_jornada` real de punta a punta (teléfono → worker → panel "Jornada de hoy");
- vecinos en calle: requieren `9001TST` y `9004TST` en la misma ruta y sentido.

**Siguiente:**
1. Probar el APK en un teléfono, con el checklist de arriba.
2. Si #109 queda verificado, evaluar prender el canal visual en production (requiere otro build).
3. La limpieza de worktrees sobrantes (`.claude/worktrees/agent-*`) sigue pendiente de OK del CTO.

## Release 13 — features en curso (2026-10-10)

**Plan aprobado:** [`docs/plan-release-13-features.md`](plan-release-13-features.md). Tres features:
- **A.** "Empezar día", con el evento `inicio_jornada` y un panel "Jornada de hoy" en `/en-vivo`
  para `admin_sindicato`.
- **B.** "Delante / detrás": el vehículo que va delante y el que va detrás en la misma ruta y
  sentido, calculado con `ST_LineLocatePoint`, sin foto y sin lat/lng de los otros vehículos.
- **C.** Modo navegación con motor Google como único motor. Leaflet se borra del móvil
  ([ADR 0004](adr/0004-motor-mapa-google.md), cierra S2).

Secuencia: PR 0 docs → PR 1 shared → API A → API B → **deploy de la API antes de cualquier
APK** → web A → bake-off de comps → móvil C1 → C2 → A → B → changelog al CTO → build.
- **Estado (2026-10-11):**
  - **Mergeados:** PR 0 docs (#110) · PR 1+2 shared + API A (#111) · API B vecinos-ruta (#113) ·
    móvil C1 motor Google único (#112) · tests deterministas de API (#114, #116) · web A (#117).
  - **API A (#111):** evento `inicio_jornada` (worker con chequeo de dispositivo y día de
    asignación), índice `(sindicatoId, tipo, ts)`, `GET /v1/reportes/jornadas`.
    - Sin hacer (decisión del chairman): filtro de drift hacia atrás, `CREATE INDEX
      CONCURRENTLY`, reestructurar la query, chequeo de dueño en otros tipos de evento (Fase 2).
  - **API B (#113):** `GET /v1/mobile/vecinos-ruta`.
    - Candidatos: misma ruta y sindicato, asignación hoy/ayer, `en_curso`, sesión vigente, fix
      ≤ 10 min, a ≤ 300 m de la ruta. Fracción en Web Mercator × largo geography.
    - Desempate por `sesionId`; caché 15 s por `(sindicatoId, rutaId)` por instancia; rate limit
      por dispositivo (`SyncDeviceThrottlerGuard`).
    - Aceptado como producto: el `lat`/`lng` del cliente permite ver la posición a lo largo de la
      ruta de los pares del mismo sindicato y ruta. Sin dedup de misses concurrentes.
    - Limitación: rutas circulares cerca de inicio≈fin.
  - **Móvil C1 (#112):** `features/mapa/route-map.tsx` con `react-native-maps` 1.20.1; Leaflet,
    WebView y su protocolo borrados. Matriz de paridad: [`docs/mapa-paridad-leaflet-google.md`](mapa-paridad-leaflet-google.md).
    - **Un build de EAS no-`development` falla si falta `GOOGLE_MAPS_ANDROID_API_KEY`** (sin key
      el SDK cierra la app). Validación en `apps/mobile/plugins/clave-mapas.cjs`.
    - Diferido a C2: desfase entre easing de cámara de Google y marcador lineal. Pinch/rotate
      salen del seguimiento (igual que Google Maps).
    - **No verificado en teléfono:** render con key real, fluidez, encuadre, offline.
  - **Tests inestables de la API:** `en-vivo.resumen-equivalencia` (corte 04:00 UTC) arreglado en
    #114; `auth-movil` "el 409 de nivel 2…" (≈17 scrypt, ~5.1 s en CI) con timeout de 15 s en #116.
    Costo de login acotado por diseño: peor caso 3 + 20 scrypt (~3.5 s local) por intento fallido.
  - **Web A (#117):** panel "Jornada de hoy" en `/en-vivo` (`panel-jornada.tsx`, lógica pura en
    `src/lib/en-vivo/jornadas.ts`).
    - Nace plegado con resumen de una línea. Grupos: sin iniciar → día iniciado → en recorrido →
      finalizado. Respeta el filtro de línea, poll de 30 s, aviso "sin actualizar". También se
      monta en el estado vacío (madrugada sin sesiones).
    - Columna derecha del HUD, en flujo bajo los controles. En pantalla angosta va a todo el ancho.
    - **`ConsultasPorIdentidad`:** un `QueryClient` por identidad (`id|rol|sindicatoId`), con
      `key` que remonta el subárbol. Cierra una fuga previa: el caché sobrevivía al logout y al
      reemplazo de sesión desde otra pestaña. El refresh de token no remonta.
    - Limitación: un vehículo con turnos en dos líneas el mismo día solo aparece bajo la primera
      (la API hace `DISTINCT ON (vehiculoId)`).
    - Sin spec de acceptance: `admin-panel.spec.ts` ya usa los 5 logins/min. **No verificado con
      datos reales** de `inicio_jornada` (el móvil todavía no lo emite; llega en móvil A).
  - Comp móvil elegido: **A** (`docs/diseno/release-13-comp-a-operacion.html`).
  - **Siguiente:** móvil C2 (modo navegación) · A · B.
- **Antes de cualquier APK:** deploy de la API (lo confirma el CTO; un APK nuevo contra una API
  vieja traba el outbox con `inicio_jornada`).
- **Antes del build hay que verificar:** que todos los teléfonos del piloto tengan GMS, la key de
  Maps en el entorno EAS `production` (hoy solo en `preview`; si falta, el build ahora falla) y
  el fix #109 probado en teléfono.

## Punto de retome — 2026-10-10, noche (leer primero)

**Prueba en calle del APK spike `beba67fa`:** la navegación anduvo bien. La app crasheó al
mandarla a segundo plano con un recorrido iniciado y volvió a crashear en cada relanzamiento.
- **Síntoma:** RedBox `TypeError: undefined is not a function` en `evaluarCanalVisual`,
  disparado por un cambio de `AppState`. Como el APK es `assembleDebug`, RELOAD intenta Metro
  (`localhost:8081`) y muestra "Could not connect to development server". Es ruido del build
  debug, no una segunda falla.
- **Causa raíz:** `react-native-background-geolocation@5.4.0` declara `watchPosition` como `async`
  y devuelve `Promise<{id, remove}>` (`src/NativeModule.js:289`), aunque los tipos 5.2.2 dicen
  `Subscription`. `use-gps-operativo.ts` guardaba la Promise, y `detenerCanalVisual` llamaba
  `.remove()` sobre ella.
- **Alcance:** solo se dispara con `EXPO_PUBLIC_GPS_CANAL_VISUAL=1`, que en `eas.json` está
  únicamente en el perfil `spike`. El perfil `production` no lo setea; las variables de entorno
  de EAS no se revisaron.
- **Fix:** rama `fix/canal-visual-watchposition-promise`. Se agregó
  `canal-visual-controller.ts`, que normaliza la respuesta sync/Promise, es seguro si se detiene
  mientras está pendiente y no lanza. Además, `gps/watch-position.ts` tipa `watchPosition` como
  Promise, y el callback descarta los fixes de generaciones viejas: el listener `watchposition`
  del runtime es global y se registra antes del `await`.
  - Verificación: 631/631 tests de mobile (11 del controlador, 2 del shim), typecheck limpio y
    lint con 0 errores.
  - `/codex-debug verify-fix` dio `fixes_root_cause` dos veces. `/code-review` encontró 8
    hallazgos: 7 se aplicaron y 1 quedó documentado (`remove()` del runtime descarta la promesa
    de `stopWatchPosition`).
  - El hook no tiene test propio; su cableado queda cubierto solo por typecheck y revisión.
  - **No verificado en teléfono.** Falta llevarlo a la rama del spike y hacer un build nuevo.
- **Auditoría:** ningún otro método del SDK se usa como síncrono siendo `async`.

**Decisión del CTO (2026-10-10): la Fase 2 del saneamiento y el resto del backlog quedan
pendientes.** No se arrancan hasta nueva indicación. Lista vigente:
- **Fase 2, P0:** asignaciones sin validación de tenant (`rotaciones.service.ts:219-258`). Primero
  el test y después el fix, con `/security-review`.
- **Resto de la Fase 1:** renumerar los ADR, partir el handoff en estado y bitácora, archivar los
  planes completados, corregir las contradicciones de documentación, OpenAPI con chequeo de drift
  y runbooks de release y rollback.
- **Seguimientos chicos:**
  - portar `env-publico-literal.test.ts` a `main`;
  - decidir sobre `scripts/experimentos/`;
  - quitar las menciones a `CREDENCIALES.md` en `seed.ts` y `auth.ts`;
  - verificar `admin_quivo` por SQL;
  - limpiar los worktrees viejos.
- **Decisiones del CTO en el [SRS §7](srs/README.md):** las 12 siguen abiertas.
- **La rotación de prueba del 2026-10-10 se descartó** por pedido del CTO.

## Punto de retome — 2026-10-10 (anterior)

**Saneamiento: Fase 0 hecha, Fase 1 en curso.**
- **Mapa de la documentación:** [`README.md`](README.md).
- **SRS v0.1:** [`srs/README.md`](srs/README.md), reconstruido desde el código, con 4 dominios y unos 350 requisitos con file:line.
- **Otros docs nuevos:** [`datos/modelo.md`](datos/modelo.md), [`arquitectura/vision-general.md`](arquitectura/vision-general.md), [`glosario.md`](glosario.md) y [`calidad/linea-base.md`](calidad/linea-base.md).
- **Línea base:** 0 errores de typecheck con build previo. Los 51 errores de antes eran el `dist` viejo.
- **Higiene:** #107.
- **OSRM no está desplegado en prod:** la ruta a un punto se dibuja como línea recta.
- **Hallazgo P0:** alta y edición manual de asignaciones sin validación de tenant (`rotaciones.service.ts:219-258`). Va primero en la Fase 2.
- **Decisiones del CTO pendientes:** 12 decisiones que bloquean diseño, en [SRS §7](srs/README.md).

**Plan nuevo aprobado: [`plan-saneamiento.md`](plan-saneamiento.md).**
- Contenido: SRS reconstruido desde código + docs, reorganización de `docs/`, seguridad, DRY y orden arquitectónico.
- Corre intercalado con el roadmap, sin congelar features.
- No se toca el núcleo GPS/outbox/auth móvil hasta validar release 12 en calle.
- Requisitos originales (`QUIVOcontrol.md`, RF-01..84; `QV-ESP-ESP-CTL-2026-001`): no están en el repo ni en `~/Downloads`. El CTO decidió reconstruir.

**Spike: el toggle Leaflet/Google y el overlay S1 nunca aparecían en el APK `881978fc`.**
- Causa: `spikeHabilitado(env = process.env)` leía `env.EXPO_PUBLIC_SPIKE` de forma indirecta. babel-preset-expo solo inlinea `process.env.EXPO_PUBLIC_X` literal, así que en release daba `false`.
- Verificado sobre el bundle Hermes: `EXPO_PUBLIC_GPS_CANAL_VISUAL` quedó inlineado y `EXPO_PUBLIC_SPIKE` no.
- Fixes en #102 (rama `spike/ubicacion-fluida`, no se mergea):
  - `409abd8`: lectura literal y test de regresión `apps/mobile/src/env-publico-literal.test.ts`, que prohíbe acceso indirecto a `EXPO_PUBLIC_*`.
    - **Deuda:** portar ese test a `main`.
  - `ff32688`:
    - overlay S1 visible: estaba debajo de la `DriverRouteCard`;
    - zoom 17 al entrar en seguimiento con Google, igual que el `flyTo` de Leaflet;
    - `MapErrorBoundary` con `key={motorMapa}`;
    - `toolbarEnabled={false}`.
  - Verificado: 645/645 tests, tsc sin errores nuevos (2 preexistentes en `control-feedback-toast.tsx`), eslint 0 errores.
  - El `/code-review` automático no devolvió resultado: **no verificado** por ese gate.
- **APK nuevo `beba67fa`**: https://expo.dev/artifacts/eas/UUy5GfzmFr_UBGT17nQgvH7WVJC2eVNN8Ufu13lBwdY.apk
  - Verificado sobre el APK:
    - `EXPO_PUBLIC_SPIKE` aparece 0 veces en el bundle;
    - toggle y overlay presentes;
    - 0 devlauncher;
    - launcher `MainActivity`;
    - SHA-1 `db6581…3420`;
    - `geo.API_KEY` presente;
    - `com.quivotech.conductor.app` con versionCode 12.
  - **No verificado en teléfono.**
- Notas de calle (auditoría):
  - el toggle solo surte efecto con el paquete del día ya cargado, así que no hay que arrancar en frío en modo avión;
  - el contador "Fixes visuales" se resetea al volver de background;
  - el APK es `assembleDebug`, así que agitar el teléfono abre el dev menu nativo.

## Plan en curso: ubicación fluida + "Finalizado" en el panel + pruebas en calle (2026-09-26)

**Plan: [`plan-ubicacion-fluida.md`](plan-ubicacion-fluida.md).** Absorbe el paso 7 (pruebas en calle) del build 11.

- **Decisiones del CTO:**
  - Rumbo por GPS con histéresis; detenido, se mantiene el último rumbo. Sin brújula.
  - Le gusta el mapa heading-up. El motor (Google nativo `react-native-maps` o Leaflet + `leaflet-rotate`) se decide con los datos del spike S2.
- **Orden:**
  1. **Fase A:** estado "Finalizado" en el panel, solo servidor y web; se despliega sin APK.
  2. **Ronda 1 en calle**, con el RC build 11.
  3. **Fase B:** núcleo de movimiento.
  4. **Spikes S1 y S2** en un dev build.
  5. **Fase C:** motor de mapa.
  6. **Ronda 2 en calle.**
  7. Licencia de Transistorsoft y build release 12.
- **Prerrequisito:** asignaciones vigentes para las cuentas de prueba (ver "Punto de retome 2026-10-07").

### Punto de retome — 2026-10-07 (leer primero)

**Hecho hoy:**
- **APK del spike corregido y construido.** Build EAS `881978fc` (commit `4010c75`), link: https://expo.dev/accounts/shadow00/projects/quivo-conductor/builds/881978fc-d4a0-4cb9-a167-72b49d040342
  - El primer APK (`45e7efc2`) abría el launcher de expo-dev-client. `developmentClient: false` no alcanza: en la variante `debug`, dev-client/dev-launcher/dev-menu se autolinkean igual.
  - Fix: hook `eas-build-post-install` → `apps/mobile/scripts/eas-build-post-install-spike.mjs`. Solo con `EAS_BUILD_PROFILE=spike` agrega `expo.autolinking.android.exclude` (4 módulos dev) al `package.json` del build. El `package.json` versionado no cambia.
  - Verificado sobre el APK: SHA-1 `db6581…3420`, LAUNCHER `MainActivity`, 0 referencias a devlauncher en manifest y dex, `debuggable=true`, bundle embebido. **No verificado en teléfono.**
  - Los worktrees `.claude/worktrees/agent-a62fd67…` y `agent-a32a6c0…` tienen la rama del spike. Buildear desde `agent-a32a6c0…` (en `4010c75`) con `npx eas-cli@latest build --profile spike --platform android`; `eas` no está en el PATH.
- **Asignaciones extendidas (prod, 2026-10-07):** `9001TST` (Z12) y `9004TST` (120), **solo 2026-10-08 y 2026-10-09**, decisión del CTO.
  - Script nuevo `scripts/extender-asignaciones-piloto.ts` (PR #105). Usa solo la API: dry-run por defecto, `--apply`, `--placas`, `--desde`/`--hasta`, republica en `finally` y renueva el token ante 401.
  - Resultado: 4 creadas, rotación `01f82ee6…` (`piloto-20260909`) publicada, 203 asignaciones, verificación OK.
  - Correrlo con `packages/db/node_modules/.bin/tsx scripts/extender-asignaciones-piloto.ts`, no con `pnpm piloto:…`: pnpm dispara un `install` que falla sin `DATABASE_URL`.
  - Credenciales por env `QUIVO_ADMIN_EMAIL`/`QUIVO_ADMIN_PASSWORD`, en una terminal propia (los `!` no son interactivos).
  - **Para extender más días:** el mismo comando con otro rango.
- **Admin del panel de prod:** `admin@quivo.com`, con el panel en https://quivo-web-hjqvfgsdnq-tl.a.run.app.
  - Se descartó crear un admin nuevo.
  - Pendiente del CTO: guardar la credencial en Secret Manager (`QUIVO_PANEL_ADMIN_EMAIL`/`QUIVO_PANEL_ADMIN_PASSWORD`).
- **Costos de Google Maps:** solo Maps SDK for Android (Mobile Native Dynamic Maps, $0 ilimitado). La key está restringida a `maps-android-backend` + paquete + SHA-1. Falta confirmar el $0 en Facturación → Informes tras las pruebas.

**Pendientes para la próxima sesión (en orden):**
1. **CTO, en calle (08 y 09/10):** instalar el APK `881978fc` encima y confirmar que arranca sin launcher y sin pedir licencia.
   - Medir S1 con el overlay: fixes visuales cerca de 1/s; `getCount()` y evidencia sin inflar; batería a mano.
   - Medir S2 con el toggle Leaflet/Google: fluidez, heading-up, modo avión.
2. **CTO:** e2e de la Fase A (Finalizar y ver "Recorrido finalizado" en `/en-vivo` en ≤30 s). Ronda 1 en calle (plan, Fase D).
3. **Decisión C1/C2** con los datos de S1/S2; después, implementar la Fase C.
4. **PR #105:** el CI falló en un test ajeno (`auth-movil.service.test.ts` › "el 409 de nivel 2 no resetea el contador de fallos", 5071 ms, probable timeout flaky). Se relanzó; mergear si pasa. Si se repite, investigar el flaky aparte.
5. **Licencia Transistorsoft:** el trial vence el **2026-10-25**; comprarla antes del build release 12.
6. **Deuda:**
   - mensaje engañoso de `deploy-gcp.sh:803`;
   - `/codex-debug verify-fix` pendiente en #87, #88, #89, #92, #97 y la Fase A;
   - docblock desactualizado en `withAndroidSpikeDebugEmbed.js`, que todavía dice que excluir dev-client era innecesario.
7. Limpiar los worktrees viejos (`agent-a5f1b8…`, `agent-ad631e…` de #100/#101 ya mergeados) y las ramas locales `feat/movimiento-nucleo` y `fix/panel-recorrido-finalizado`. Requiere aprobación del CTO.

### Estado al 2026-09-28

**Fase B, HECHA (#100).**
- Núcleo puro `movimiento/`, store visual y canal `watchPosition` detrás de `EXPO_PUBLIC_GPS_CANAL_VISUAL`, apagado por defecto.
- Con el flag apagado, la evidencia no cambia.
- Sin verificar en dispositivo.

**Fase A, HECHA y DESPLEGADA (#101, deploy del 2026-09-28).**
- Orden respetado: `--solo web` primero, después deploy completo.
- La migración `20260926120000_sesion_recorrido_estado` se aplicó (logs del job `quivo-migraciones-6h9gq`).
- `quivo-api` responde sano; worker en `quivo-worker-00003-dbg`.
- **Pendiente e2e:** Finalizar en el teléfono y ver "Recorrido finalizado" en `/en-vivo` en ≤30 s.
- `/codex-debug verify-fix` sigue NO verificado (sin cuota de Codex).

**Spike S1/S2: rama `spike/ubicacion-fluida`, PR draft #102. NO se mergea, es descartable.**
- Perfil `spike`: `:app:assembleDebug` (Transistorsoft no pide licencia en DEBUG, según su README).
  - El JS va embebido gracias al plugin `withAndroidSpikeDebugEmbed` (`debuggableVariants = []`).
  - `developmentClient: false`, API de prod, canal visual y `EXPO_PUBLIC_SPIKE` activos.
- `react-native-maps` 1.20.1 + `RouteMapNative`:
  - heading-up con `animateCamera` una vez por fix;
  - marcador interpolado con `rotation`/`flat` nativos.
- Toggle Leaflet/Google y overlay de métricas S1, solo en el spike. Sin batería ni conteo de `gps_point` del outbox.
- Verificado: typecheck, 639/639 tests, lint, `expo prebuild` real. **No verificado:** build Gradle ni dispositivo.
- **Build (CTO):** `cd apps/mobile && eas build --profile spike --platform android` desde la rama del spike.
  - **APK construido 2026-09-28** (build EAS `45e7efc2`, versionCode 12, 197 MB). Verificado con `apksigner`/`aapt2`: firmado con el keystore remoto de EAS (SHA-1 `db6581…3420`, igual que el RC y ya permitido en la API key `quivo-conductor-maps-android`), `android:debuggable=true`, `index.android.bundle` embebido y meta-data `geo.API_KEY` presente.
  - Se instala encima del RC (misma firma y mismo versionCode), sin desinstalar.
- Costo conocido si se elige C1: `react-native-maps` pasa a ser dependencia nativa en todos los builds.

**Deuda nueva:** `scripts/deploy-gcp.sh:803` descarta el stderr de `gcloud run services describe` y muestra "quivo-api no está desplegado" incluso cuando lo que venció es el token de gcloud (pasó el 09-28). Hay que mostrar el error real.

**Siguiente:** ver "Punto de retome — 2026-10-07" arriba.

## Próxima entrega: APK conductor build 11 — plan v2 del 2026-09-26 (reemplaza al del 09-23)

**Plan: [`plan-apk-build-11.md`](plan-apk-build-11.md).** Decisiones del CTO del 09-23 (el alcance y la rama posición cambiaron en el v2):

- **Alcance P0 completo:** cerrar las 4 ramas móviles (Entregas 1–7, 7b, 25, 31) y sumar las Entregas 8, 9, 26 y 28.
- **Radio:** detectar a 150 m y confirmar a 40 m. Cierra la decisión abierta #1.
- **Fuera de este APK:** palancas de costo D (sync a 60 s) y captura a 30 m.
- **Cambio del nombre de paquete antes del build**, porque el trial de Transistorsoft de `com.quivotech.conductor` venció. El APK nuevo no se instala encima del viejo: hay que drenar cada teléfono antes de desinstalar.

- **Paquete nuevo:** `com.quivotech.conductor.app` (decidido 2026-09-23).
- **Producción (leído 2026-09-23):** `quivo-api` y `quivo-worker` corren la revisión `quivo-api-00006-qsn` (digest `ed3c47…`, del 2026-09-09) y `quivo-web` corre `00003-qm9`. **#65, #70 y #74 NO están desplegados.** El job de migraciones del 09-22 usó la imagen vieja, así que el hueco del recompute todavía no se abrió.

### Punto de retome — 2026-09-26, tercera sesión (RC compilado, deploy pendiente)

**Leer esto primero.** El runbook vivo está en `docs/plan-apk-build-11.md` → "Runbook de los pasos 5 y 6".
- **RC = build 12** (`dabd0e52`), verificado sobre el APK; los detalles están en el plan, paso 6. Se compiló antes del deploy y antes de Codex, por decisión del CTO.
- **El build 10 ya no lo usa nadie** (CTO). No hay que drenar teléfonos, salvo confirmar "0 pendientes" si sigue instalado.
- **Preflight de prod (09-26):** prod sigue en `63a0b51`. **Rollback por digest, no por el tag `v1`**: `v1` se movió. Los digests están en el plan.
- **PR de preparación P1/P2** (`ops/recompute-resumen-gps`):
  - `scripts/recompute-resumen-gps.sh`, con el SQL en `scripts/sql/`, que ahora toma un lock contra el worker y usa la jornada boliviana explícita.
  - `--task-timeout=1800` en `deploy-gcp.sh`.
  - Probado en un Postgres 16 descartable: el lock, el timeout y la jornada. Contra prod no se probó.
- **Paso 5 HECHO** (tag `b11-20260926`, `main@4135940`). Verificado; el detalle está en el plan. Recompute con 0 filas: esperable, sin ingesta. Deuda nueva registrada: Redis `volatile-lru` → `noeviction` (decide el CTO).
- **Siguiente, en orden:**
  1. Paso 7 en el teléfono, con el RC build 12. **En casa quedó parcialmente validado:** login, Comenzar, posición en `/en-vivo` y Finalizar corta el GPS. Lo que falta en calle pasó a [`plan-ubicacion-fluida.md`](plan-ubicacion-fluida.md), Fase D, ronda 1.
  4. Paso 4 (Codex, desde el 2026-09-27 15:46).
- **Trampa local:** después de mergear PRs móviles, `node_modules` puede quedar viejo. Correr `DATABASE_URL=postgresql://build:build@localhost:5432/build_placeholder pnpm install --frozen-lockfile`.

### Punto de retome — cierre de la sesión del 2026-09-26 (histórico, reemplazado por el de la tercera sesión)

**Leer esto primero.** Plan vigente: [`plan-apk-build-11.md`](plan-apk-build-11.md) (v2). Pasos 1, 2 y 2' **hechos**. Pasos 3 y 3' con código listo y sin PR.

**Mergeado hoy** (squash; CI verde; chequeos en cada rama: tsc 0 · tests verdes · `pnpm lint` 0 errores):

| PR | Qué | Review |
|---|---|---|
| #86 | Plan v2 (anti-loop, alcance recortado) | solo docs |
| #87 | Posición en vivo = estado de `79e832b` (G1/G2/R1, `ACTIVITY_RECOGNITION`, QUI-247). Rediseño iniciar/detener revertido (`3afc6c0`..`fe4090c`) | `/code-review` ya hecho sobre `79e832b` |
| #89 | Anuncio de puntos de control (40 m anuncia / 150 m detecta) + merge con #87 (un solo camino de heartbeat) | `/code-review medium`: 2 bugs aplicados. Uno era el doble "llegaste": ahora el claim nace `'programando'`, con test de la carrera. El otro, `detener()` con `umbralAnuncioMs = 0` |
| #88 | Mapa offline (Entrega 25) | `/code-review medium`: 0 hallazgos |

Nada de esto tiene `verify-fix` de Codex (vuelve el 2026-09-27 15:46) ni prueba en teléfono. El `verify-fix` retroactivo es el paso 4. Lo del teléfono va en la prueba única sobre el RC (paso 7).

**Pendiente, en este orden** (actualizado en la segunda sesión del 09-26: la 9 mergeada en #91 y la 28 en #92; lo que sigue es el punto 3):

1. **Entrega 28 — `fix/sesion-no-vigente`** (worktree `../Quivo-control-sesion-no-vigente`, pusheada en `0ddb239`, con `main` mergeado).
   - **Verificado por el chairman:** tsc 0 · 530/530 · lint 0 errores. API: tsc 0; los tests de auth-movil (32/32) los corrió el agente.
   - **Reviews:** `/security-review` sin hallazgos. El `/code-review` sacó 4 hallazgos sobre la versión original (`ed86055`); la clave era que el headless borraba la sesión y eso apagaba el GPS en silencio.
   - **CTO eligió acotar la 28** y ya está implementado:
     - **Headless:** no borra nada; deja un flag durable por token (`quivo.mobile.sesion-no-vigente.v1`) y no vuelve a llamar a refresh.
     - **Identidad del token:** antes de cualquier acción destructiva relee SecureStore bajo el lease y compara el token rechazado con el guardado.
     - **Sin recorrido activo:** va al login.
     - **Con recorrido activo:** banner bloqueante, sin sync; el logout ocurre recién después de Finalizar. El recorrido activo se detecta con el módulo `estado-recorrido-activo.ts`.
   - **Cierre (2026-09-26, segunda sesión) — PR #92:**
     - (a) Copy en tuteo: `86a0f22`.
     - (b) El chairman leyó el diff del rescope y encontró **1 hallazgo alto**. El "riesgo sin test" de la reapertura no dependía del timing: fallaba siempre. `useGpsOperativo` publicaba el `false` inicial de `tracking` al montar. `restaurarSesion` lo tomaba como veredicto, borraba la sesión con el recorrido activo, y el headless apagaba el tracking sin `fin_recorrido`. Fix en `a6a5b53`: solo se publican veredictos reales (re-enganche, iniciar o detener) y el cierre se dispara por nivel (`sesionNoVigente && !tracking`), lo que también cubre la carrera del banner trabado. Tiene 2 tests de la secuencia; el hook sigue sin arnés de React.
     - Verificado por el chairman sobre `main` + la rama: mobile tsc 0 · 539/539 · lint 0 errores; API tsc 0 · auth-movil 32/32.
   - **Riesgo que queda:** el orden real de efectos en el teléfono. Se prueba en el RC: matar la app a mitad de recorrido, revocar la sesión y reabrir.
2. **Entrega 9 — `fix/movil-toast-dedupe`** (worktree `../Quivo-control-toast`, pusheada en `4d29bbc`).
   - Dedupe por `{puntoControlId, pasada}`, con fail-open si falta `pasada`. Función pura `debeMostrarToast` con 7 tests.
   - El agente corrió su propio `/code-review` y aplicó un hallazgo alto: el ref se resetea cuando `ultimaDeteccion` vuelve a `null`. Sin eso, el primer punto de un recorrido nuevo que coincidía con el último del anterior quedaba silenciado.
   - Hallazgos que el agente dejó fuera de alcance y van a deuda:
     - deduplicar en el productor (`setUltimaDeteccion`) y no en cada consumidor;
     - el contador de `simularDeteccion` en `__DEV__`;
     - la regla de identidad duplicada entre `ultimoSonado` y el toast.
   - Verificado por el chairman: tsc 0 · 520/520. (Error del chairman: creyó que el agente había muerto con el cambio de cuenta y commiteó su WIP como `0e36dfa`. El agente siguió encima y no se perdió nada.)
   - **Hecho:** PR #91 (con `main` mergeado). El chairman leyó el diff antes de abrirlo y no encontró hallazgos nuevos. Se mergea con CI verde.
3. **Paso 4:** `/codex-debug verify-fix` retroactivo sobre #87, #89, #88 y la 28. Solo bloquea un `masks_symptom` en un camino real.
4. **Pasos 5 y 6: seguir el runbook en orden de `docs/plan-apk-build-11.md` → "Runbook de los pasos 5 y 6"** (preparación P1/P2 → deploy → recompute → changelog → RC). Resumen anterior: **Paso 5 (lo corre el CTO):** deploy de `main` con la API de la 28. Primero `gcloud run jobs update quivo-migraciones --project quivo-control-prod --region southamerica-west1 --task-timeout=1800`, después `! scripts/deploy-gcp.sh <tag>` y el recompute de `docs/runbooks/retencion-gps.md`. El preflight está en el retome de la 3.ª sesión del 09-25. **La API va antes que el APK.**
5. **Paso 6:** lista de features y fixes al CTO (memoria `apk-build-11-changelog-antes-de-lanzar`), y con su OK, el RC con `eas build --platform android --profile production`.

**Trampas de esta sesión:**
- **`packages/shared` se consume desde `dist`.** En un worktree recién mergeado, tsc falla con "no exported member" hasta que se corre `rm -rf dist && pnpm -s build` en `packages/shared`.
- **El lint válido es `pnpm lint`** (`eslint src`). `eslint .` da errores falsos en `plugins/*.js` y `*.cjs`.
- **`gh` de esta máquina no tiene `pr update-branch`.** Para poner una rama al día: `git merge origin/main` en su worktree.
- **Un `/login` a mitad de sesión no corta a los subagentes en vuelo, pero sí puede frenar su progreso visible.** No commitear su trabajo a medias: esperar su notificación.

**Acción del CTO, en paralelo:** comprar la licencia de Transistorsoft. El trial vence el 2026-10-25 con `grace_builds` 0, y el build 12 va a caer después de esa fecha.

### Punto de retome — 2026-09-26: plan v2 del build 11 (histórico, reemplazado por el cierre de la sesión del 2026-09-26)

El plan se rehízo por loop. **Fuente de verdad: [`plan-apk-build-11.md`](plan-apk-build-11.md) (v2).**

Decisiones del CTO:
- **Posición:** vuelve a `79e832b`. Los fixes 1–5 de abajo **quedan descartados**.
- **Alcance:** 3 ramas + Entregas 28 y 9. Las Entregas 8 y 26 pasan al build 12.
- **Deploy:** lo corre el CTO con `!`.

Reglas anti-loop:
- Una sola vuelta de review por rama. Solo bloquea un `high` en un camino real.
- El handoff viaja dentro del PR de código.
- Una sola prueba en teléfono, sobre el RC.

Meta: build en los teléfonos antes del **2026-10-10**. La licencia trial vence el 2026-10-25.

### Punto de retome — cierre de la cuarta sesión del 2026-09-25 (histórico, reemplazado por el plan v2 del 2026-09-26)

Reemplaza al retome de la tercera sesión (queda abajo como histórico; su tabla de
ramas y su preflight de deploy siguen valiendo salvo lo que se corrige acá). Todo lo de esta sesión es
**app móvil del conductor** (`apps/mobile`, APK build 11), rama `fix/movil-posicion-en-vivo`.

**Rama posición — pusheada en `fe4090c`, sin PR:**
- `c83b0b8` fixes del 3.er `/code-review high` sobre `4b9e5b5..51d3fad` (10 hallazgos, 9 aplicados):
  serializador de restauración encadena en vez de reemplazar; fase 2 escribe `inicio_recorrido` siempre
  tras `start()` ok; invalidación con causa `'detener' | 'desmontaje'` (desmontaje no apaga el nativo);
  espera a intento invalidado con tope 15 s (`EsperaIniciarInvalidadoAgotadaError`) y tolerante a
  rechazos; bump de `ultimoCierreId` movido tras `start()`; `stop()` síncrono normalizado; docs.
- `fe4090c` hallazgo restante: `reconciliarStopTardio` (función pura) — si un `stop()` vencido resuelve
  tarde con el SDK apagado y `tracking=true`, cierra el recorrido una sola vez (guarda por
  `esReconciliacion` y por `estadoInicioRecorrido.eventId`). Público `detener()` sin cambio de firma.
- Verificado por el chairman en `fe4090c`: tsc 0 · vitest 364/364 · eslint 0 errores (14 warnings viejos).

**Bloqueante antes del PR — `/code-review medium` sobre `51d3fad..fe4090c` encontró 5 regresiones de
esos fixes, todas confirmadas por el chairman. Decisiones ya tomadas (el agente que las aplicaba se
detuvo a pedido del CTO sin escribir nada; worktree limpio):**
1. `crearSerializadorRestauracion` (`seguimiento-continuo.ts` ~303/315): con el encadenado, un `stop()`
   nativo que nunca asienta cuelga `esperarPendiente()` para siempre. → `esperarPendiente(timeout
   10 s)`, al vencer lanza `EsperaRestauracionAgotadaError` y **no** limpia el slot; `iniciar()` lo
   trata como `EsperaIniciarInvalidadoAgotadaError` ("Cierra y vuelve a abrir la app").
2. Desmontaje (`use-gps-operativo.ts` ~1023): no apagar el nativo deja GPS huérfano (el remount puede
   leer `enabled=false` antes de que resuelva el `start()` viejo) y sin `inicio_recorrido`. →
   **revertir** el caso `'desmontaje'` (vuelve a `detenerNativoYRestaurar`), borrar la plomería de
   causa; mitigar el caso cruzado suscribiendo `onEnabledChange` mientras hay tracking (verificar firma
   en los typings del paquete): `enabled=false` + montado + `trackingRef` → `detener` de reconciliación.
   Verificar orden `stop()`/evento/`trackingRef=false` para no cerrar dos veces.
3. `ultimoCierreId` (~1039/~793): el bump tardío deja que el cierre viejo pinte veredicto/error sobre el
   recorrido nuevo. → **revertir** al bump al principio de `ejecutarIniciar`; tradeoff aceptado: un
   Comenzar bloqueado por permisos descarta el veredicto pendiente del recorrido anterior.
4. Fase 2 (~1144): tras esperar la semilla puede escribir `inicio_recorrido` con el `eventId` de un
   recorrido nuevo que nunca arrancó. → capturar `eventIdInicio` al empezar la fase 2 y saltar la
   escritura si `estadoInicioRecorrido.eventId` cambió.
5. Reconciliación (~1285/~1363): re-corre `ejecutarDetener` y toma `tsFin`/snapshots nuevos. → pasar
   `cierreOriginal { tsFin, snapshotBateria, snapshotPuntos, snapshotErroresEscritura }` en `opciones`.

**Criterio de corte (del chairman):** es la 2.ª vuelta de fixes sobre el mismo hook y cada review sacó
regresiones nuevas. Tras aplicar 1–5 (Sonnet nuevo) + un `/code-review` corto: si vuelve a salir un fallo
de diseño, proponer al CTO cerrar el PR y mover las carreras residuales a un ticket, no seguir parchando.
Pendiente también: `/codex-debug verify-fix` (Codex fuera hasta 2026-09-27 15:46 — si se mergea antes,
queda "no verificado") y prueba en teléfono (iniciar/finalizar rápido, doble toque, modo avión).

**Deploy a producción:** el CTO renovó `gcloud auth login` (cuenta `cloud@tuquivo.com`, proyecto
`quivo-control-prod`) al inicio de esta sesión. Sigue sin desplegarse: el clasificador bloquea
`scripts/deploy-gcp.sh`; lo corre el CTO (`! scripts/deploy-gcp.sh <tag>`, secuencia en el retome de la
tercera sesión) o agrega regla de permiso. Pregunta abierta al CTO, sin respuesta.

**Siguiente paso, en orden:** fixes 1–5 de posición → review → teléfono → PR/CI/merge · luego anuncio
(`git merge origin/main` + `/code-review` + PR) · mapa offline (teléfono → PR) · Entregas 8/9/26/28 ·
lista de features al CTO antes del build.

### Punto de retome — cierre de la tercera sesión del 2026-09-25 (histórico, reemplazado por el de la cuarta sesión)

Siguen
vigentes: gate sin Codex hasta el 2026-09-27 15:46, lista de features al CTO antes del build, licencia
trial hasta el 2026-10-25, ramas al día con `git merge origin/main` (no rebase).

**Decisiones del CTO en esta sesión:**
- Mapa offline: al volver la red se reintentan los tiles abandonados/en backoff (hecho, ver abajo).
- OK para desplegar `main` a producción + recompute. **No se desplegó:** el clasificador de auto mode
  bloquea `scripts/deploy-gcp.sh` (`Production Deploy`) y las credenciales de `gcloud` están vencidas
  (`Reauthentication failed`). Lo corre el CTO, o agrega una regla de permiso Bash para el script.

**Mergeado:** #83 `feat(en-vivo)` — mapa con todos los vehículos (`665d401`). Verificado en stack local
con Playwright (pin del editor arrastrable, 2 vehículos en `/en-vivo`, placa legible, ids en la demo de
la landing), gate `web-design-guidelines` y dos `/code-review`. Fixes del gate: capas de vehículo sin
`*-ignore-placement` (conservan `allow-overlap`, reservan colisión; NO bajarlas con `beforeId`: en
MapLibre las capas más altas se colocan primero), `placa` en la demo, toasts en regiones `role=status`/
`alert` siempre montadas. No verificado en producción (sigue en la revisión del 09-09).

| Rama · worktree | HEAD (pusheado) | Verificado | Estado |
|---|---|---|---|
| `fix/movil-posicion-en-vivo` · `-movil-posicion` | `51d3fad` | chairman: tsc 0 · 344/344 · lint 0 err | Rediseño iniciar/detener (ver abajo). **Falta 3.er `/code-review`** sobre `4b9e5b5..51d3fad` antes del PR |
| `fix/movil-anuncio-puntos-control` · `-movil-anuncio` | `6ed1d49` | agente: tsc 0 · 384/384 | Auditoría del merge vs #80: los 5 fixes presentes byte a byte, `DDL_OUTBOX` superset idempotente. Único faltante (mensaje UX de guardado) restaurado. **Sin `/code-review`**: correrlo después de mergear posición y volver a mergear main |
| `fix/movil-mapa-offline` · `-movil-mapa-offline` | `8734356` | agente: tsc 0 · 339/339 | Reintento al volver la red (`e22825b`, NetInfo 11.4.1 ya estaba: sin rebuild extra) + fixes del review (`abandonados` podado y con tope 200; `isConnected: null` no cuenta como offline). **Falta prueba en teléfono** con red y modo avión |

**Rediseño de posición (por qué cambió el enfoque):** el timeout de `detener()` sobre `iniciar()` protegía
un camino inalcanzable — "Finalizar" solo aparece con `tracking=true`, que se marca apenas `start()`
resuelve; el cuelgue real es el outbox (SQLite), y `detener()` se volvía a colgar en su propio
`abrirOutbox`. Diseño final (`51d3fad`):
- Single-flight de `iniciar()` solo hasta `tracking=true`; la cola de outbox (semilla + respaldo de
  `inicio_recorrido`) corre desacoplada. Tocar Comenzar con un intento invalidado en vuelo arranca uno nuevo.
- Single-flight de `detener()`. `tsFin` al toque; `inicio_recorrido` lleva el `ts` del arranque del
  intento → orden por `ts` correcto aunque el INSERT sea tardío (el servidor ordena por `ts`).
- `stop()` nativo acotado a 5 s. Si falla o vence: tracking sigue `true`, error "No se pudo detener…
  Intenta nuevamente", sin `fin_recorrido`. La promesa cruda de `stop()` se registra en
  `serializadorRestauracion`, así un stop tardío no mata el recorrido siguiente.
- `fin_recorrido` y veredicto en tarea de fondo (`cierre-recorrido.ts`); `fin` se escribe siempre aunque
  falle el respaldo del inicio; el veredicto usa snapshot de refs tomado al tocar Finalizar; `iniciar()`
  sube `ultimoCierreId`.
- Desmontaje invalida el intento en curso; `sigueVigente` incluye `montadoRef`.
- **Sin test automatizado:** snapshot del veredicto y desmontaje (viven en el hook; el repo no tiene
  `renderHook`). Opción: extraer `construirResultadoRecorrido` como función pura.

**Siguiente paso, en orden:**
1. **Posición:** `/code-review high` sobre `4b9e5b5..51d3fad` (foco: carreras, estado viejo, SDK huérfano,
   orden por `ts`). Fixes → Sonnet nuevo. Probar en teléfono: iniciar/finalizar rápido, doble toque,
   modo avión. PR → CI → merge.
2. **Anuncio:** `git merge origin/main` (trae posición), `/code-review` con foco en el merge, PR.
3. **Mapa offline:** prueba en teléfono (red / modo avión / volver la red) → PR.
4. Entregas 8/9/26 (sobre anuncio mergeado) y 28. Luego lista de features y fixes al CTO antes del build.

**Deploy a producción (CTO) — preflight de solo lectura hecho:**
- Sin cambios de contrato que rompan APK build 10 (`deviceId` de logout opcional; throttler de sync solo
  comentarios; `/en-vivo/posiciones` lo usa solo el panel). Commit hoy en prod según evidencia
  documental: `63a0b51` (no verificado en vivo).
- Migraciones pendientes: `20260922100000_gps_sesion_resumen` (backfill SIN filtro de fecha sobre
  todo `gps_points`; el job no fija `--task-timeout` → default 10 min) y
  `20260923090000_refresh_token_hash_anterior` (ADD COLUMN nullable, inocua).
- La migración va antes que el worker nuevo (si no, cada lote falla con `relation "gps_sesion_resumen"
  does not exist`); el script completo respeta el orden — no usar `--solo worker` suelto.
- Secuencia: `gcloud auth login` → listar tags (`gcloud artifacts docker images list
  southamerica-west1-docker.pkg.dev/quivo-control-prod/quivo/api --include-tags`) → `gcloud run jobs
  update quivo-migraciones --project quivo-control-prod --region southamerica-west1 --task-timeout=1800`
  → `scripts/deploy-gcp.sh <tag>` (sugerido tag con fecha) → recompute de `docs/runbooks/retencion-gps.md`
  desde dentro de la VPC (Cloud SQL solo tiene IP privada: job ad hoc, no `psql` local).

**Datos locales:** el worktree de web se borró, pero sus volúmenes docker (proyecto compose
`quivo-control-web-mapa`) siguen: la base `quivo_control_e2echeck` tiene 2 posiciones GPS de prueba para
1001ABC/2002DEF y una asignación para 2002DEF. Si no se reusan: `docker volume ls | grep web-mapa` y borrar.

---

### Punto de retome — cierre de la segunda sesión del 2026-09-25 (histórico, reemplazado por el de la tercera sesión)

**Leer esto primero.** Reemplaza al retome anterior del mismo día (queda abajo como histórico; sus
decisiones del CTO siguen vigentes: gate sin Codex hasta el 2026-09-27 15:46, lista de features antes
del build, licencia trial hasta el 2026-10-25).

**Cambio de método:** las ramas se ponen al día con `git merge origin/main`, **no con rebase**. No hace
falta force-push y el squash del PR deja igual un commit. Así se desbloqueó web.

**Hecho en esta sesión:**
- Worktree y rama local de drenado borrados, y sus contenedores bajados. La rama remota ya no existía.
- Las 4 ramas tienen `main` mergeado y están pusheadas, sin cambios sin commitear.
- Ninguna tiene PR todavía.

| Rama · worktree | HEAD | Verificado por el chairman | Estado |
|---|---|---|---|
| `fix/movil-posicion-en-vivo` · `-movil-posicion` | `79e832b` | tsc 0 · 314/314 | G1/G2/R1 cerrados + permiso `ACTIVITY_RECOGNITION`. Chairman quitó migración duplicada `20260910070000_refresh_token_hash_anterior` (main ya la trae como `20260923…`). `/code-review` → 3 hallazgos, aplicados en `79e832b` (orden inicio<fin, reintento de `inicio_recorrido` con eventId estable, `ready()` en reattach — confirmado en docs SDK 5.4.0: "call `.ready(config)` once… each time your app is launched") |
| `fix/movil-anuncio-puntos-control` · `-movil-anuncio` | `9e36d7a` | tsc 0 · 384/384 | Los 10 hallazgos aplicados (`0711e5e`), merge de main (`0960afd`) con 6 conflictos. **Sin `/code-review` todavía** |
| `fix/movil-mapa-offline` · `-movil-mapa-offline` | `52803b6` | tsc 0 · 318/318 | Merge sin conflictos. `/code-review`: 1 low + 2 preexistentes, todos aplicados (sin redibujo de markers por fix, guarda de `fitBounds`, `baseUrl: https://control.myquivo.com/` para `Referer` de OSM + backoff con tope de 6 intentos) |
| `feat/web-mapa-todos-vehiculos` · `-web-mapa` | `3e3d9f1` | no re-corrido (agente: typecheck/lint 0, web 81, design-system 53, builds OK) | `totalPuntos` sin cambios necesarios. `/code-review`: 1 high (pulse→vehículo rompía editor de rutas y landing) + 1 low, aplicados: `pinType: 'vehicle'` propio. **Sin verificación en vivo** |

**Pendiente antes de cada PR (en este orden de merge: posición → anuncio → mapa offline; web en paralelo):**
1. **Posición:** poner timeout a la espera de `detener()` sobre el `iniciar()` en curso (si `iniciar` se cuelga abriendo el outbox, "Finalizar" no responde nunca). Luego `/code-review` sobre `79e832b`, PR, CI, merge.
2. **Anuncio:** `/code-review` **con foco en el merge**: el agente resolvió `headless-task.ts` y `use-gps-operativo.ts` tomando su rama como base e injertando lo de main (diff vs main: +947/+366 líneas). Confirmar que no se perdió ningún fix de #80 (marca de logout en `restaurarSesion` y headless, lease de revocaciones, backoff/agotado del sync, throttle del drenado, `CircuitoRefreshAbiertoError`). Además borró `db/outbox-ddl.ts` y `outbox-migraciones.ts` (absorbidos en `DDL_OUTBOX`). Doble sonido con pantalla apagada: sin verificar en teléfono. Después de mergear posición, volver a mergear main en anuncio.
3. **Mapa offline:** decidir si los tiles abandonados tras 6 intentos (~15 min) se reintentan al volver la red (reset de contadores con NetInfo) — hoy no, hasta pan/zoom. Prueba en teléfono con red y en modo avión. PR.
4. **Web:** verificación en vivo con Playwright (punto marcado del editor de rutas visible y arrastrable, vehículos en `/en-vivo` y en la demo de la landing) + gate `web-design-guidelines`. PR. Hay docker del agente corriendo en `-web-mapa` (Postgres 5434, Redis 6380): `docker compose down` al terminar.
5. Después: Entregas 8/9/26 (sobre anuncio mergeado) y 28. Luego la lista de features y fixes para el CTO antes del build.

**Notificación de "run failed" al celular:** era el primer push de #80 (`553f687`), que falló en Lint con 2
`no-explicit-any`. El push siguiente lo arregló. Los briefs ya exigen lint en 0 errores antes del push.

**Pendiente del CTO:** OK para desplegar `main` a producción (#65, #70, #74 y la migración de #80),
seguido del recompute de `docs/runbooks/retencion-gps.md`.

---

### Punto de retome — cierre de la sesión del 2026-09-25 (histórico, reemplazado por el de la segunda sesión)

**Decisiones del CTO en esta sesión:**
- **Gate sin Codex hasta que vuelva.** La cuota de Codex está agotada hasta el **2026-09-27 15:46**. Hasta entonces el gate de merge es `/code-review` + `/security-review` (sin `verify-fix`). Desde esa fecha, `verify-fix` vuelve a ser obligatorio para los `fix:` (regla 13).
- **Antes de lanzar el build 11**, presentar al CTO la lista completa de funcionalidades nuevas y correcciones (por Entrega/PR). El CTO decide ahí si suma alcance. No disparar el build antes.
- **Licencia Transistorsoft nueva** para `com.quivotech.conductor.app`, cargada en EAS (`TRANSISTORSOFT_LICENSE_KEY`, entorno `production`, proyecto `@shadow00/quivo-conductor`). **Es trial:** vence el **2026-10-25**, `max_build_stamp` 20261025, `grace_builds` 0. El build 11 tiene que salir antes; para builds posteriores hay que comprar la licencia. El valor no se puede leer de vuelta: se confirma en el primer build.
- No se agrega detección de reuso de refresh token en el servidor (ver abajo).

**Hecho:**
- **#80 mergeado** (`baf87dd`, squash): drenado GPS en background + sesión móvil entre contextos + paquete `com.quivotech.conductor.app` en `app.config.ts`. Incluye los fixes de `/code-review` (marca de logout respetada por `restaurarSesion` y el headless; error de lectura de la marca no apaga el tracker; lease propio para revocaciones pendientes; backoff/agotado del sync; throttle del drenado; `CircuitoRefreshAbiertoError` fuera de la racha de 401). Móvil tsc 0 / 263 tests; API tsc 0, mismos 6 fallos de Better-Auth que `main`. `/security-review` sin hallazgos.
- **Corrección de una premisa falsa del retome anterior:** el servidor **no** detecta reuso de refresh token. `refresh()` no lee `refreshTokenHashAnterior`; solo `logout()` la usa como prueba de posesión para el fallback por `deviceId`. El riesgo residual de drenado (suspensión entre el CAS del lease y la escritura en SecureStore) termina en: token ya rotado → 401 → circuito abierto → el chofer se vuelve a loguear (Entrega 28). No es un problema de seguridad. Detección de reuso descartada: convertiría esa carrera local en revocación total.
- **Deuda técnica registrada:** secuencia de lease duplicada entre `drenaje-oportunista.ts` y `sync-outbox.ts`.

**Estado por rama:**

| Rama · worktree | HEAD | Estado |
|---|---|---|
| `fix/movil-drenado-background` · `-movil-drenado` | — | **Mergeada (#80).** Borrar el worktree: antes, `docker compose down` en él (quedaron Postgres 5434, Redis 6380 y OSRM corriendo) |
| `fix/movil-anuncio-puntos-control` · `-movil-anuncio` | `b161377` | Rediseño hecho (tsc 0, 267 tests, lint 0 errores). **`/code-review` con 10 hallazgos sin aplicar** (lista abajo). Sin rebase: va 37+ commits detrás y ahora `main` trae drenado, que toca `headless-task.ts` (esperar conflictos) |
| `fix/movil-mapa-offline` · `-movil-mapa-offline` | `6831112` | Cerrado. Falta rebase, `/code-review`, PR y prueba en teléfono (con red y en modo avión) |
| `fix/movil-posicion-en-vivo` · `-movil-posicion` | `9e9f2d3` | Desbloqueada: drenado ya está en `main`. Rebase sobre `main` y cerrar sus gaps (`partial` del 09-11) |
| `feat/web-mapa-todos-vehiculos` · `-web-mapa` | `0d67964` | **Bloqueada por permisos:** el clasificador de auto mode rechazó el agente de rebase (necesita `push --force-with-lease`). El CTO tiene que habilitar el force-push o hacer el rebase. Al rebasear, revisar la semántica nueva de `totalPuntos` (#74) |

**Hallazgos de `/code-review` en anuncio (a aplicar con un Sonnet nuevo) y triage del chairman:**
1. `anuncio-punto-control.ts:409`: `'pendiente'` significa a la vez "reclamado, programándose" y "falló". El reintento reprograma un reclamo en vuelo y alerta dos veces. **Fix:** estado separado (`programando` con timestamp) y reintentar solo lo `pendiente` viejo.
2. `decidir-anuncio.ts:176`: los estados sembrados desde la evidencia (`clavesCumplimientoDesdePayloads`) quedan `dentro:true` sin `anuncioHecho`. Tras un re-seed, cada punto ya pasado dispara `fallback-salida` al alejarse. **Fix:** el seed marca `anuncioHecho: true`. Es el más grave: rompe la invariante "la evidencia nunca dispara".
3. `use-gps-operativo.ts:273` y `:376`: `setUltimoAnuncioLlegada` se setea antes y sin importar el reclamo, así que el chime suena aunque el reclamo se haya perdido. **Fix:** setearlo solo si hubo reclamo y quedó programado.
4. `decidir-anuncio.ts:237`: con `motivo` null no se persiste `desdeMs`, así que con el vehículo detenido y solo heartbeats, `fallback-tiempo` nunca dispara. **Fix:** sembrar desde `candidatoTsFixMs` o persistir la transición.
5. `outbox.ts:395`: `obtenerAnunciosPendientesDeProgramar` no filtra por sesión, antigüedad ni intentos, y reintenta filas de días anteriores para siempre. **Fix:** filtrar por la sesión actual, agregar TTL e intentos máximos, purgar, e índice en `estado`.
6. `anuncio-punto-control.ts:382`: si el reclamo lanza error, hoy falla abierto (`reclamado=true`) y duplica justo en el caso de contención entre contextos. **Decisión:** fallar cerrado, sin programar, y reintentar el reclamo en el próximo tick.
7. `headless-task.ts:875`: faltan chequeos de generación en `aplicarConfirmacionesForzadas` y `drenarReintentosVisitaPendiente`. Una operación vieja puede resucitar `visitas_pendientes` y duplicar una pasada de evidencia. **Fix:** chequear después de cada `await`.
8. `headless-task.ts:329`: el reintento de anuncios corre dentro del `conTimeout` y antes de `operacion()`, así que un puente de notificaciones colgado bloquea la escritura de `gps_point`. **Fix:** correrlo después de `operacion()` con su propio timeout, o fuera de la cola de evidencia.
9. `outbox.ts:101`: la migración de anuncios relanza cualquier error que no sea "duplicate column" y tumba `abrirOutbox`, con lo que se pierde evidencia. **Fix:** `PRAGMA table_info` + catch con Sentry, sin fallar la apertura.
10. Limpieza: `gps-provider.tsx:55` abre el outbox para un `_db` que no se usa; `void puntosRearmados` es código muerto; unificar `claveAnuncio()`. Menores: validar `motivo` antes de `textoAnuncioLlegada`, y posible doble sonido (canal nativo + expo-audio) con la pantalla apagada.

**Pendiente del CTO:**
- Habilitar force-push para el rebase de web, o hacerlo.
- OK para desplegar `main` a producción (#65, #70, #74 y ahora la migración de #80), seguido del recompute de `docs/runbooks/retencion-gps.md`.

**Cómo retomar (máximo 3 agentes Sonnet a la vez):**
1. Anuncio: un Sonnet aplica los 10 hallazgos de arriba → rebase sobre `main` (drenado ya adentro) → `/code-review` → PR → merge. Desde el 2026-09-27 15:46, sumar `verify-fix`.
2. Posición: rebase sobre `main` y cierre de gaps.
3. Mapa offline: rebase, `/code-review`, PR.
4. Después: Entregas 8/9/26 (sobre anuncio mergeado) y 28. Luego, la lista de features y fixes para el CTO antes del build.

---

### Punto de retome — cierre de la sesión del 2026-09-23 (histórico, reemplazado por el del 2026-09-25)

**Leer esto primero.** Las cuatro ramas móviles están pusheadas, ninguna tiene PR y no queda nada sin commitear en ningún worktree. El orden de merge sigue siendo **drenado → posición → anuncio → mapa offline**. Web va en paralelo.

| Rama · worktree | HEAD | Rebase sobre `main` | tsc / tests móvil | Codex `verify-fix` (último) |
|---|---|---|---|---|
| `fix/movil-drenado-background` · `-movil-drenado` | `8431fc9` | **Sí** (base `7d001e1`) | 0 / 244 | Ronda 6 **sin correr**. `8431fc9` es un commit de preservación: el agente se cortó por límite de uso justo antes de commitear |
| `fix/movil-anuncio-puntos-control` · `-movil-anuncio` | `f84618c` | No | 0 / 245 (+ shared 57/57) | **`partial`**, `20260923-201325-verify-fix-266181.json` |
| `fix/movil-mapa-offline` · `-movil-mapa-offline` | `6831112` | No | 0 / 196 | **`fixes_root_cause`**, `20260923-192505-verify-fix-144425.json` |
| `fix/movil-posicion-en-vivo` · `-movil-posicion` | `9e9f2d3` | No | — | `partial` (del 09-11). No se tocó: espera a que drenado esté mergeado |
| `feat/web-mapa-todos-vehiculos` · `-web-mapa` | `0d67964` | No | — | No aplica. No se tocó |

Los reportes de Codex están en `~/.claude/codex-debug-state/`.

**Drenado, qué se hizo en esta sesión (rondas 4 a 6):**
- Rebase limpio. La migración pasó a llamarse `20260923090000_refresh_token_hash_anterior` para quedar después de `gps_sesion_resumen`.
- G1: refresh bajo el lease SQLite `refresh-sesion`, con relectura dentro del lease y compare-and-set del lease antes de persistir. Ya no existe el refresh sin lease.
- G2: credenciales y contexto van en claves de SecureStore separadas (`quivo.mobile.credenciales.v1` y `quivo.mobile.contexto.v1`).
- Logout: toma el mismo lease, relee el token persistido y deja una revocación pendiente durable si no hay red.
- Ronda 6 (commit `8431fc9`):
  - se eliminó la migración de la clave vieja: el paquete nuevo es una instalación limpia y SecureStore es por app;
  - una lectura fallida bajo el lease difiere el refresh;
  - el logout no entra a la sección crítica sin el lease;
  - la revocación pendiente pasó a ser por entrada.
- **Falta:**
  - revisar el diff de `8431fc9` contra los cuatro puntos del brief (reporte `20260923-200546`);
  - correr `verify-fix` (base `7d001e1`);
  - `/code-review` y `/security-review` (logout y migración Prisma);
  - PR, CI y merge.
- **Riesgo residual que el CTO tiene que aceptar (regla 13):** si el runtime se suspende entre el compare-and-set del lease y la escritura en SecureStore, la escritura tardía puede pisar un token más nuevo. SecureStore no tiene escritura condicional, así que no se puede hacer fencing. La red de seguridad es la detección de reuso del servidor (`refreshTokenHashAnterior` revoca la sesión entera) más el login limpio de la Entrega 28. Está documentado en `use-auth-movil.ts`, junto a `renovarLease`.
- En el worktree de drenado quedaron corriendo Postgres (5434) y Redis (6380) de su `docker-compose`.

**Anuncio: necesita un rediseño, no otra ronda.** La auditoría de `6e4f285` salió bien: G1, G2 y R1 estaban correctos. Después vinieron dos rondas más con `eventId` determinístico, atomicidad del outbox (R2), `RADIO_CONFIRMACION_M` y `setNotificationHandler`. Codex sigue en `partial` y los huecos son de integración, no teóricos:
1. la evidencia todavía dispara anuncios por `gps-provider.tsx:108` y `anuncio-punto-control.ts:364`;
2. `evaluarAnunciosProximidadVencidos` (el fallback de 90 s) **solo se llama desde tests**;
3. `anuncioProximidadHecho` se marca antes de programar la notificación;
4. el dedupe hace SELECT → programar → INSERT, que no es atómico;
5. la generación de la cola no se chequea después de cada `await`;
6. el drenado de reintentos queda fuera de `conTimeout`;
7. el texto «a menos de 40 m» también se usa en los fallbacks.

Diseño decidido para la próxima sesión (un solo agente Sonnet):
- **Una sola decisión de anuncio:** función pura `decidirAnuncio(estadoAnuncio, entrada: fix | heartbeat, ahora)` → `{motivo: 'proximidad' | 'fallback-tiempo' | 'fallback-salida' | null, estado}`. La evidencia nunca dispara ningún canal hacia el chofer.
- **Un solo punto de llamada:** dentro de `colaRegistroGps`, tanto para fixes como para heartbeats. El foreground (`gps-provider`) no tiene disparador propio: consume las decisiones de esa misma cola.
- **Intención durable:** INSERT OR IGNORE de la intención (`pendiente`) en `anuncios_punto_control` **antes** de programar, lo que reclama la identidad `{sesionId, puntoControlId, pasada}` de forma atómica. Después se programa con `identifier` igual a esa identidad (un duplicado reemplaza al anterior, no se apila) y se marca `programado`. Si falla, queda `pendiente` y la cola la reintenta.
- **Texto según el motivo** (proximidad, tiempo o salida).
- **Generación** chequeada después de cada `await` y antes de toda mutación. El drenado de reintentos va dentro de `conTimeout`, y los reintentos de una visita se descartan cuando su confirmación transaccional sale bien.

**Mapa offline:** cerrado. Tiene handshake `mapa-listo` y el reintento de tiles arma la URL con `coords.z` y la x normalizada. Solo falta rebase, `/code-review`, PR y la prueba en teléfono (con red y en modo avión).

**Otros cambios de esta sesión:**
- Se borraron del remoto `feat/reestructurar-admin-panel` (`8950ebb`), `feat/QUI-342-filtros-url-export-cumplimiento` (`be805b1`) y `feat/QUI-339-auditoria-accesibilidad-web` (`c986699`), por pedido del CTO.
- Quedan 7 ramas remotas de agosto sin mergear, probablemente mergeadas con squash: `deploy-gcp-prod`, `en-vivo-api`, `en-vivo-design-system`, `en-vivo-web`, `fix/en-vivo-hooks`, `qui-227-web-nextjs-scaffold` y `test/QUI-340-e2e-admin`. No se tocaron: verificar que su contenido esté en `main` antes de borrarlas.
- Backup del estado de siembra (Entrega 0a) en `~/quivo-backups/estado-siembra-produccion-2026-09-23.json`.
- Tests de API en local: 6 fallos de Better-Auth (`modules/auth`, `jwt-auth.guard`, `auditoria`, `sync-errores`). Son idénticos en `main`, son del entorno y no los causa ninguna rama. Si los tests de `en-vivo` fallan con `PosicionEnVivoSchema undefined`, es un `dist` viejo: `corepack pnpm -C packages/shared build`.
- `pnpm` no está en el PATH de la shell de las herramientas: usar `corepack pnpm`.

**Pendiente del CTO:**
- OK para desplegar `main` a producción (#65, #70 y #74), seguido del recompute de `docs/runbooks/retencion-gps.md`.
- Pedir la key de Transistorsoft para `com.quivotech.conductor.app` recién cuando las Fases 1–3 estén mergeadas.
- Aceptar el riesgo residual de drenado descrito arriba.

**Cómo retomar:** como máximo 3 agentes Sonnet a la vez.
1. Drenado: revisar `8431fc9`, verify-fix, reviews, PR y merge.
2. Anuncio: rediseño según el diseño de arriba.
3. Web: rebase, review y PR.

Cuando drenado esté mergeado, entran posición (rebase sobre drenado) y la Entrega 8/9/26 (sobre anuncio mergeado).

## Costos recalibrados con prueba de carga + confirmación en Cloud SQL real — 2026-09-22

Plan: `docs/plan-experimento-puntos-gps.md`. Resultados: `scripts/experimentos/gps/carga/resultados/resumen.md`.

- **Cifras finales (USD/mes, actual / optimizada, captura 15 m):** 600 → $436.53 / $205.03
  (agosto: $508.75 / $309.54); 2000 simultáneos → $994.06–$1,270.15 / $496.28–$703.35 (rango
  por el multiplicador de RAM 3×/4×, heurística declarada, no medida). Captura 30 m: 600 →
  $397.03 / $182.76; 2000 → $858.33 / $419.08. Fuente: `docs/costos-gcp-2000.md` (GENERADO por
  `node scripts/costos/generar-tablas.mjs`, no editar a mano).
- **Las cifras infladas previas (~$1.4k a 600, hasta $5.1k a 2000) venían de dimensionar solo
  por un techo de escritura sin medir — descartado.** El tier a 600/2000 lo deciden RAM/working
  set y el piso `db-custom-2-7680`, no la escritura.
- **Prueba de carga local (Docker, CPU/RAM capados):** c1 300–2000 y c2 1000–3000 pts/s PASA. La
  corrida vieja c1@2000 FALLA era límite del generador closed-loop (8,46 ms/lote ⇒ ~1770 pts/s),
  no de la base; la baja de latencia 8,46→3,34 ms quedó **sin explicar**.
- **Cloud SQL real (`db-custom-1-3840`, instancia temporal, ya BORRADA):** 2000 pts/s sostenidos
  con concurrencia 40, CPU máx 50 %, memoria 58–65 %. Con concurrencia 8/16 falla por RTT del
  cliente (~187 ms/lote), no por la base. Lecturas en vivo: listarHoy p50 60 ms, obtenerPosiciones
  p50 70 ms. Tier 2 vCPU no se corrió a propósito (no cambia ninguna decisión).
- **Publicado:** finanzas https://claude.ai/artifact/CKYr2k2r8wZaWbgh2XAL5f · escalera
  https://claude.ai/artifact/S32g8pCG5fN8Txu984uSZH (privados: el CTO debe compartirlos) ·
  comentario en ClickUp 86e34jkb2.
- **Pendiente:** la tarea de ClickUp pide hasta **3000** vehículos; el modelo llega a 2000 (4/8 vCPU
  no medidos). Decisión de producto: captura 30 m (validar en piloto 86e329ub0; afecta precisión
  de replay/apelaciones). Rama `feat/web-mapa-todos-vehiculos` consume `posicionesTodas`:
  revisar el cambio de semántica de `totalPuntos` (#74) al rebasear. Tras deployar #74, correr
  una vez el recompute de `docs/runbooks/retencion-gps.md`.

### Palancas de costo pendientes (estado verificado contra el código, 2026-09-22)

**La columna "optimizada" es un objetivo, no lo que se paga hoy.** Producción corre la
arquitectura "actual": de las seis palancas de agosto no se aplicó ninguna
(`docs/plan-costos-2000.md` §9.3). Fuentes de detalle: `docs/costos-gcp-por-escala.md` §6
(palancas A–F), `docs/plan-costos-2000.md` §11–§12 (palancas de volumen),
`scripts/experimentos/gps/carga/resultados/resumen.md` (concurrencia del worker).

**Palancas de precio (agosto), ninguna aplicada:**

| # | Cambio técnico | Estado hoy | Ahorro | Riesgo / prerrequisito |
|---|---|---|---|---|
| A | `quivo-api` con Direct VPC egress (`--network/--subnet/--vpc-egress`, como `quivo-worker`) en vez de `--vpc-connector` | `scripts/deploy-gcp.sh:772` sigue con `--vpc-connector` | −$18.40/mes, todo escalón | Ninguno declarado (GA) |
| B | Redis propio en `e2-micro` en vez de Memorystore Basic 1 GiB | Memorystore sigue (`docs/infra-gcp-prod.md:84-92`) | −$40.60/mes | Operación propia (parches, monitoreo). Memorystore Basic tampoco tiene HA |
| C | `--min-instances 1` → `0` en `quivo-api` | `deploy-gcp.sh:770` sigue en 1 | −$11.59 a −$17.71/mes | Cold start ~3-5 s en el primer sync del día; el outbox reintenta |
| D | Ciclo de sync 15 s → 60 s (`REFRESCO_MS`) | `apps/mobile/src/features/operacion/use-sync-status.ts:8` sigue en `15_000` | −$9 en requests y evita la 2.ª instancia de worker a 500-600 (−$37) | Hasta 60 s más de lag en `/en-vivo`. Requiere release de app. **Ojo:** el motivo de agosto ("un INSERT por punto") era falso: el worker ya hace INSERT multi-fila; el ahorro viene de menos requests/transacciones |
| E | Retención caliente 6 → 3 meses + archivo en bucket GCS Nearline (`GPS_RETENTION_MONTHS=3`, `GPS_ARCHIVE_BUCKET`) | Default 6 (`retencion-gps.service.ts:121`), bucket vacío (`.env.example:65`). El código de archivado existe, no está activado | −$14.45/mes a 600; a 2000 el disco caliente con 6 meses es ~$163 + ~$77 backups | Crear el bucket (no existe) y seguir `docs/runbooks/retencion-gps.md` |
| F | CUD de 1 año en Cloud SQL (−25 % del cómputo) | No verificable en el repo (se compra en billing) | −$69.02/mes a 600 | Compromiso de 12 meses: tomarlo solo con el tier confirmado. `db-g1-small` no admite CUD |

**Palancas de volumen y capacidad (bajan la carga, no el precio unitario):**

- **Concurrencia del worker BullMQ 1 → 4.** `ingesta-worker.service.ts` no fija `concurrency`
  (default 1, serializado). Medido: 2000 pts/s que falla en 1 vCPU con concurrencia 1 pasa al 100 %
  con 4 en el mismo contenedor. La más barata antes de subir tier. Falta probar que no rompe el
  orden de lotes de un mismo dispositivo.
- **Retención escalonada por resolución** (evolución de E): denso 7-14 días → trazo simplificado +
  eventos de control → archivo. Riesgo bajo. A 2000 el disco caliente con 6 meses es ~684 GB
  medido (`plan-costos-2000.md` §12; la cifra de ~1,46 TB → ~100 GB de §11 usaba la estimación
  preliminar de §9.2, ya corregida); el ahorro nuevo no está recalculado.
- **Douglas-Peucker con zona protegida antes de persistir.** Medido (n=1): DP 2 m retiene 63 % de
  puntos, p95 1,2 m, 0 pasadas perdidas de 132; DP 20 m retiene 53 %, p95 8,9 m, 0 perdidas.
  **Sin zona protegida pierde pasadas (28/132 con 5 m): descartado para evidencia.** A 2000 el
  ahorro se diluye porque el tier lo decide la RAM.
- **Captura 15 m → 30 m** (`distanceFilter`, `apps/mobile/src/gps/background-geolocation.config.ts:52`):
  −50 % de puntos sin pasadas perdidas (n=1). A 2000: $1,270 → $858 actual, $703 → $419
  optimizada. Requiere release de app y validar en el piloto 86e329ub0 (precisión de replay y
  apelaciones). Submuestrear a 30 m no equivale a capturar a 30 m.
- **`distanceFilter` adaptativo** (denso cerca de puntos de control, laxo en tramos rectos): sin
  cifra, la más cara de implementar (release + geocercas en el dispositivo).
- **Resumen por sesión `gps_sesion_resumen`:** HECHO (#74). Falta el recompute tras el deploy.
- **TimescaleDB/AlloyDB:** decisión de arquitectura, no optimización. Solo si retención escalonada
  + DP no alcanzan.
- **Cambio de región a `us-central1`:** ~26 % menos, pero **no recomendado**: migración completa
  de datos y latencia desde Bolivia sin medir. Retirado del modelo.

**Pendientes técnicos sin costo directo (bloquean confiar en los números):**

- Activar el export de facturación a BigQuery: hoy ningún número se contrasta con la factura real. (20/10: export estándar
  habilitado en `billing_export`; contrastar cuando termine el backfill, hasta 5 días.)
- Tiers de 4 y 8 vCPU de Cloud SQL sin medir (extrapolados); el multiplicador de RAM 4× es
  heurística declarada. A 2000 decide el tier (rango $994–$1,270).
- k6 a 300 pts/s nunca corrió contra `quivo-control-prod`.
- Bytes/fila (365,6 B) medidos en muestra chica sin `VACUUM FULL`/`ANALYZE`: en régimen puede subir.
- `tile.openstreetmap.org` no admite uso de flota en producción: pasar a un proveedor de tiles
  pago (mismos datos OSM).

## Mapa en vivo: tabla `gps_sesion_resumen` (N+1 de `listarHoy`/`obtenerPosiciones`) — 2026-09-22

**Estado:** PR `perf/en-vivo-resumen-sesion`. Plan: `docs/plan-en-vivo-resumen-sesion.md`.

- Tabla nueva `gps_sesion_resumen`, PK `(sesion_id, jornada, "sindicatoId")`, FORCE RLS con la
  misma policy que `gps_points`. La mantiene el worker en el mismo statement que inserta los puntos
  (CTE `INSERT ... RETURNING` + upsert ordenado). Las lecturas del mapa pasan de O(puntos del día)
  a O(sesiones): con 1.000 sesiones y 6,7 M filas (local), `listarHoy` 53 s → 62 ms y
  `obtenerPosiciones` 53 s → 72 ms. Objetivo de <50 ms no alcanzado: el resto es el join de
  sesiones/vehículos/rutas, fuera de este cambio.
- Hallazgos de la revisión aplicados: backfill con `set_config('app.rol','admin_quivo')` (en Cloud
  SQL `postgres` no es BYPASSRLS, sin eso copiaba 0 filas); jornada con `AT TIME ZONE 'UTC'`;
  sindicato en la PK (un `sesionId` forjado no pisa el resumen de otro sindicato); `ORDER BY` en
  el upsert contra deadlocks; `ultimoIngresoTs` = máximo de hoy y ayer.
- Cambio de semántica: `obtenerPosiciones.totalPuntos` = puntos de la jornada del último fix (antes
  ventana rodante de 24 h). Sin consumidor en `apps/web`.
- **Paso manual obligatorio tras el deploy:** correr una vez el recompute de
  `docs/runbooks/retencion-gps.md` (sección `gps_sesion_resumen`) cuando el worker nuevo esté vivo,
  para cubrir los puntos que ingirió el worker viejo entre la migración y el deploy.
- Local: 5 tests de auth/JWKS fallan en esta máquina por estado de `jwks` del entorno local; no
  tocan este cambio. CI es el juez.

## Modelo de costos a 2000 trufis — mergeado en #72 (2026-09-21)

**Estado:** mergeado a `main` en `8f828be` (PR #72, CI `ci` + `acceptance` en verde). Cierra la
parte de ingeniería de ClickUp `86e34jkb2` ("Añadir proyección de Costos").

Cifras finales del documento, escenario A (concurrentes en pico), supuestos medidos:

| | 600 conductores | 2000 conductores |
|---|---|---|
| Actual | $1.402,83/mes | $2.926,66–$5.135,35/mes |
| Optimizada | $929,76/mes | $1.945,74–$3.602,25/mes |

A 2000 es un **rango**: el pico cae en empate exacto con un borde de tier de Cloud SQL (495,0 pts/s).

El test de regresión **ahora corre en CI**: `scripts/*` entró al workspace de pnpm y
`@quivo/costos-scripts` está en el fan-out de `turbo run test` (`f1f140e`). Antes no lo alcanzaba
ningún comando de CI y el gate de ±15% no era gate de nada.

**Pendiente, sin hacer:**
- **Entregable 2** (ClickUp `86e2yxchp`): documento para finanzas con costos y riesgos. Presupuesto de
  ventas, punto de equilibrio y pricing quedan fuera por decisión del CTO — los completa finanzas.
- Publicar la escalera v2 como Artifact (la v1 de agosto es un Artifact; esta vive solo en el repo).
- Comentar el resultado en ClickUp `86e34jkb2`: Angel pingeó el 2026-09-13 sin respuesta.
- Cerrar la brecha n=1 de la medición: lo resuelve el piloto múltiple usuario (`86e329ub0`).
- Prueba de carga `tests/load/k6/` contra `quivo-control-prod`: nunca se corrió, y a 2000 el pico
  supera 1,6× su techo de 300 pts/s.

### Detalle de la última iteración (2026-09-20)

Plan: [`plan-costos-2000.md`](plan-costos-2000.md) §13 (especificación de calibración) y §7
(criterios de aceptación). `scripts/costos/modelo-costos.mjs` + `scripts/costos/generar-tablas.mjs`
generan `docs/costos-gcp-2000.md` — **cero valores a mano en el `.md`**, todo sale de una corrida de
`node scripts/costos/generar-tablas.mjs > docs/costos-gcp-2000.md`. Test de regresión: 21/21.

Cerrados en esta iteración cuatro hallazgos de una revisión de código que se había aplicado a medias
(el mecanismo existía en `modelo-costos.mjs` pero `generar-tablas.mjs` no lo consumía, o el `.md`
nunca se regeneró tras el fix):

1. **Rango de borde de tier publicado.** `bordeTierCercano` (ya calculado por
   `tierCercanoABorde` en el modelo) ahora se consume en `generar-tablas.mjs` en los 5 lugares que
   citaban el punto (resumen ejecutivo, reconciliación, "Conclusión para finanzas", tablas de
   escalones y desglose por servicio). A 2000 conductores el pico da exactamente 495,0 pts/s,
   empate exacto con el borde de `db-custom-32-122880`/`db-custom-64-245760`: el documento ahora
   recomienda a finanzas presupuestar contra el extremo alto del rango ($2926,66–$5135,35 actual)
   en vez de un número puntual que esconde un empate de margen cero. Mismo empate en n=500 y n=1000.
2. **Edge case de jornada, signo corregido** (ya estaba en el código, solo faltaba regenerar el
   `.md`): jornada 14h ahora da MÁS puntos/día (tasa constante puntos/hora) y por lo tanto MÁS
   costo (+4,2%), no menos (-37,5% como decía la versión vieja del documento).
3. **Storage de escenarios B/C, ya escalaba con la flota nominal** (idem, solo faltaba
   regenerar): a 2000 conductores los tres escenarios dan 695 GiB (antes B daba 420 GiB y C 250 GiB,
   subestimados por usar la concurrencia efectiva en vez de la flota completa).
4. **Comparación de criterios de calibración de API, publicada con números reales**: minimizar
   error relativo (%) da `c=0,0568` con error absoluto total $192,00, un 4,3% PEOR que minimizar en
   USD (`c=0,0481`, $184,14). La afirmación "no fue mejor" ya no es una frase sin verificar.

Abiertos, declarados como tales en el propio documento (no ocultos):

- Escenario C (factor de concurrencia 0,35) es un supuesto de producto NO VERIFICADO — el plan
  §4.2 lo deja "a derivar" y no hay medición de utilización diaria real de la flota.
- Los tiers de Cloud SQL y los umbrales de `quivo-worker` por encima de 600 conductores son
  EXTRAPOLACIÓN de precio (duplicar el patrón que agosto sí documentó), sin prueba de carga real
  que confirme que un solo nodo sostiene esa capacidad — el propio test de carga k6 del repo solo
  cubre hasta 300 pts/s, y a 2000 conductores el pico da 495 pts/s (1,6× ese techo).
- La medición que alimenta los supuestos MEDIDOS es n=1 (una sola jornada real completa,
  extrapolada), dos días de datos, sin `VACUUM FULL`/`ANALYZE` — documentado en detalle en §8 del
  `.md` generado.

## Punto de retome: cinco ramas abiertas, ninguna mergeable todavía (2026-09-11)

**Leer esto primero en la próxima sesión.** El plan sigue siendo
[`plan-correccion-post-piloto-2026-09-09.md`](plan-correccion-post-piloto-2026-09-09.md) (entregas
0a–31, decisiones hasta la fila 12). Esta sección es la foto exacta de dónde quedó la ejecución.

### Qué hay en `main` (`a8704da`)

| PR | Qué |
|---|---|
| #65 | Commits del piloto, `GET /reportes/en-vivo/posiciones` (Entrega 10), throttler por dispositivo y caché negativa de tokens (Entrega 12) |
| #66–#69 | Docs: handoff de #65, Entregas 7b, 28 (con evidencia de producción), 29, 30 (OSRM) y 31 (posición congelada) |
| #70 | `unplugin-swc` en vitest con `decoratorMetadata`: los tests de integración de `sync-errores`/auditoría ya no se saltean y fallan si falta la metadata. `@swc/core` en `allowBuilds` |

Nada de lo de abajo está desplegado. **Nada del lado móvil se probó en un teléfono.**

### Las cinco ramas (todas pusheadas, ninguna con PR, sin cambios sin commitear)

Todas están **20 commits detrás de `main`**: rebasar antes de abrir PR. Orden de merge obligatorio:
**drenado → posición → anuncio → mapa offline → web**. Cada agente trabaja en su propio worktree
(`../Quivo-control-<nombre>`); nunca `checkout` ni `stash` en el directorio principal.

| Rama · worktree | HEAD | Tests | Entregas | Codex `verify-fix` (último) |
|---|---|---|---|---|
| `fix/movil-drenado-background` · `-movil-drenado` | `fe36953` | 216/216 | 1, 2, 3, parte de 4, logout real (migración Prisma `refreshTokenHashAnterior`) | **`partial`**, ronda 3 |
| `fix/movil-posicion-en-vivo` · `-movil-posicion` | `9e9f2d3` | 212/212 | 31a | **`partial`**, ronda 2 |
| `fix/movil-anuncio-puntos-control` · `-movil-anuncio` | `6e4f285` (**WIP roto**) | **213/214, `tsc` rojo** | 5, 6, 7, 7b | **`partial`** sobre `5fc887b` |
| `fix/movil-mapa-offline` · `-movil-mapa-offline` | `fcc55db` | 174/174 | 25, 31b | **`partial`** |
| `feat/web-mapa-todos-vehiculos` · `-web-mapa` | `0d67964` | — | 13, 14 | No aplica (`feat`). Click y hover verificados en vivo con Playwright |

`partial` **bloquea el commit final** (regla 13): o se cierra el hueco, o se justifica explícitamente
al CTO. Los reportes completos están en `~/.claude/codex-debug-state/20260911-*-verify-fix-*.json`.

**Trampas de apilado:** posición salió de un drenado viejo (`365e14f`) y **no contiene `fe36953`**;
anuncio y drenado chocan en `db/outbox.ts` y `db/outbox-ddl.ts`. Rebasar posición y anuncio sobre
drenado **después** de cerrarlo, no antes.

### Lo que falta en cada rama

**1. Drenado (base de todo, va primero).** Tres rondas de Codex; lo que queda:
- **G1 — carrera de refresh entre contextos JS.** Foreground y headless pueden leer el mismo refresh
  token T0; headless rota a T1, foreground manda T0 y recibe 401. Los single-flight son por contexto.
  Diseño decidido: **refresh bajo un lease de SQLite `refresh-sesion`**; dentro del lease releer
  SecureStore y, si el token cambió, adoptarlo sin tocar la red; el circuito cuenta el 401 solo
  después de releer. Test con dos "runtimes" y barreras que fuercen ambas lecturas de T0.
- **G2 — solo el refresh escribe tokens.** `obtenerContexto` guarda la sesión completa desde una copia
  vieja y puede pisar un T1 recién rotado. Reemplazar por una actualización con relectura y fusión
  (`actualizarSesionMovil`) que nunca toque los tokens.
- **G3 — headless con más de 20 lotes no programa continuación.** Recomendación: **justificar** (el
  heartbeat de 60 s continúa; 20 lotes son 10 000 eventos, muy por encima de una jornada) y dejarlo
  escrito en el código y el PR.
- **R — lease tomado por reloj que retrocede.** Recomendación: **justificar** con la cota ya puesta.
- Después: `verify-fix` de nuevo, `/code-review`, **`/security-review`** (logout y migración), PR, CI,
  merge. **Al desplegar, la migración va antes que el código de la API.**

**2. Posición (31a, la flecha que no se mueve: P0 del CTO).**
- **G1** — si `start()` funciona y `changePace(true)` falla, hoy se informa éxito. Reafirmar el
  movimiento con `getState().isMoving` en el heartbeat y al volver a primer plano, **sin depender de
  `onMotionChange`** (con `ACTIVITY_RECOGNITION` denegado ese evento no llega).
- **G2** — si falla el outbox después de `start()`, `tracking` queda en `false` con el SDK grabando.
  Poner `tracking=true` apenas `start()` resuelve, separar el estado de almacenamiento, y dejar
  "Finalizar" siempre disponible.
- **R1** — serializar la restauración de `disableStopDetection:false` con el siguiente `iniciar()`.
- Rebasar sobre drenado cerrado, `verify-fix`, revisión, PR.

**3. Anuncio.** El commit `6e4f285` es **de preservación**: un agente murió por límite de uso a mitad.
Contiene G1 (histéresis propia de la voz: `puntosRearmados` pasó a `puntosRearmadosVoz`), G2
(persistir la visita antes de publicarla en memoria) y R1 (serializar heartbeat y cierre en
`colaRegistroGps`), **sin revisar**. Roto: `anuncio-punto-control.test.ts:386` usa el nombre viejo y
el test "puntosRearmados libera el dedupe de aproximación ANTES de procesar el tick" falla (1 llamada
en vez de 2). Falta:
- Auditar el diff de `6e4f285` contra los cuatro huecos, no continuarlo a ciegas.
- **`eventId` estable** por `{sesionId, puntoControlId, pasada}`, para que un fix y un heartbeat
  concurrentes no emitan dos eventos con UUID distintos.
- **R2 — atomicidad:** la transacción de `db/outbox.ts` se abre sobre `db`, pero sus operaciones
  internas pueden recuperar un handle muerto y escribir en otra conexión. La transacción entera va
  dentro de la recuperación de handle.
- Test del recorrido completo con radio de detección menor que `RADIO_AVISO_M` (150).

**4. Mapa offline (25 y 31b).**
- **Gap — handshake de mapa listo.** El estado inicial (posición incluida) se manda con `useEffect` y
  `onLoadEnd`, sin saber si los listeners del HTML ya existen. Si el primer mensaje llega antes, se
  pierde. **Puede ser parte del síntoma de la flecha congelada**, así que va con la misma prioridad que
  31a: el HTML emite `mapa-listo` tras registrar los listeners y React Native responde con el estado
  actual, sin esperar recursos de red.
- **Riesgo — reintento de tiles con zoom mezclado.** En Leaflet 1.9.4, `getTileUrl(coords)` usa el zoom
  actual de la capa, no `coords.z`: un tile fallido de otro zoom se reintenta con la x/y vieja y el
  zoom nuevo. Descartar los tiles fallidos de otro zoom o construir la URL con `coords.z`.
- Confirmar que las apariciones de `removeLayer`/`toString` en la fuente son comentarios o tests de
  ausencia. Probar **con red y en modo avión** antes de mergear.

**5. Web (13 y 14).** Rebasar sobre `main` (16 atrás), `/code-review`, gate de UI (`web-design-guidelines`),
PR. Se puede mergear en paralelo a las móviles: no comparte archivos.

### Sin empezar

- **Requieren OK explícito del CTO (escritura en producción):** 0b (cerrar sesiones fantasma
  `verif-final-0…5` y zombis `9004TST`/`9001TST` con `UPDATE`, nunca `DELETE`) y 0c (rotación del
  video a mano). El único acceso autorizado hasta ahora fue un job de **solo lectura**.
- 8, 9, 11, 15–24, 26 (preflight), 27 (precarga del paquete), 28 (código `SESION_NO_VIGENTE`), 29,
  30 (no dibujar la línea recta de OSRM).

### Decisiones abiertas del CTO

1. **Radio de detección.** Pidió 10 m. Objeción registrada: 150 m para detectar y ~40 m o el mínimo
   local para confirmar al chofer; con `RUTA_PROXIMIDAD_TOLERANCIA_METROS = 100` todo radio menor que
   la distancia de plantado pierde el punto siempre. Sin decidir.
2. **OSRM** (Entrega 30): desplegarlo o proveedor externo. 3. **`lineaId` en `Conductor`** (Entrega 17).
4. **FCM** para empujar la rotación (P1 de la Entrega 27).

### Cómo retomar

1. Leer esta sección y la Entrega 31 del plan.
2. Relanzar **como máximo 3 agentes Sonnet a la vez** (con 4 o 5 el límite de uso los cortó cada vez):
   drenado (G1+G2+justificaciones), anuncio (auditar `6e4f285`, arreglar el test, `eventId` estable,
   R2) y mapa offline (handshake + zoom). Posición espera a drenado; web entra cuando se libere un lugar.
3. Tras cada corte por límite de uso: `git status` en el worktree y auditar el diff antes de seguir.
4. Para correr los tests de la API: exportar `DATABASE_URL` desde `apps/api/.env` (el postinstall de
   `packages/db` falla sin ella). Postgres de tests en `localhost:5434` (contenedor
   `quivo-control-postgres-1`), Redis en 6380.

## Post-piloto: plan en 27 entregas y primer merge (#65, 2026-09-10)

El piloto del 2026-09-09 (5 conductores, Línea 120 y Zona 12, todos desde Univalle Tiquipaya)
funcionó como fuente de evidencia y falló como demo. **La intención vive en
[`plan-correccion-post-piloto-2026-09-09.md`](plan-correccion-post-piloto-2026-09-09.md)**: 27
entregas atómicas, cada una un PR con ámbito acotado, verificación, rollback y dependencias.
Acá queda solo lo ejecutado.

### Lo que el piloto mostró, y no era lo que parecía

- **"Trufis duplicados" no existían.** El combo de `/en-vivo` lista *sesiones*, no vehículos
  (`map-builders.ts`). Las ~20 entradas eran sesiones, muchas muertas. El mapa dibujaba **una**
  por vez (`page.tsx`, `<select>` único): por eso aparecieron 2 iconos y nunca los demás.
- **`verif-fi` / `test-ver` no los genera la app.** El único generador de `deviceId` emite
  `android:${uuid}`. Son sesiones creadas contra producción por scripts o a mano.
- **Los avisos "100 m antes" y "134 m antes" no son un bug de detección.** Producción tiene
  **150 m en ambas líneas** (`scripts/data/z12-circuito/puntos-control.json`,
  `cargar-linea-120.ts:269`); `seed.ts` siembra 100 m solo en desarrollo, y el comentario de
  `geofence.ts` cita el lado equivocado. El defecto es de producto: **anuncio == detección**.
- **"Sin sonido":** el anuncio vive en `gps-provider.tsx`, un componente React. Con la pantalla
  apagada no hay árbol montado. Un chofer manejando nunca tiene la app en primer plano.
- **"Tengo que cerrar la app para que se actualice":** `headless-task.ts` no drenaba el outbox.
- **El round-robin de rotaciones no puede emparejar bien:** `Conductor` no tiene `lineaId`.
- **3 de 5 no operaron su credencial:** placas y PIN cruzados al copiarlos de un grupo de WhatsApp.
- **Sentido de ruta invertido:** dato cargado en la rotación, no bug de la app.

### Qué entró en #65

- **Los 5 commits del piloto (`536ad86`…`662cc97`), que estaban solo en una rama local** aunque
  corrían en producción, incluido el APK con GPS cada 15 m que usaron 3 conductores. `main`
  seguía con `distanceFilter: 50`.
- **`GET /reportes/en-vivo/posiciones`** (`9096aa7`, `497dc73`): última posición de todos los
  vehículos en una sola query, con `lineaId` y `rutaSentido`. El piso del `LATERAL` cubre el
  cruce de medianoche boliviana; antes, un vehículo que arrancó a las 22:00 desaparecía del mapa
  a las 00:30. `EXPLAIN ANALYZE`: solo escanea las particiones del rango.
- **Throttling de `POST /sync/batches`** (`63a0b51`, `e364ead`): por dispositivo, no por IP. El
  tráfico con token inválido se acota con una caché negativa **por hash de token** en
  `AuthMovilGuard` (TTL 5 min, tope 10 000, solo `UnauthorizedException`).

**Tres diseños del throttler se descartaron, y todos por la misma causa: los choferes comparten
IP pública (CGNAT).** (1) `@SkipThrottle()` con el guard de dispositivo después de autenticar
dejaba sin límite el tráfico no autenticado. (2) Un guard de IP antes de autenticar contaba
también las peticiones válidas: 20 teléfonos × 6 req/min superan cualquier techo por IP. (3) Un
bloqueo por fallos por IP antes de validar tumbaba a choferes con credencial válida detrás del
mismo NAT que un teléfono en bucle de 401. **Cualquier control que use la IP como identidad
castiga a inocentes en este producto.** Las tres versiones pasaban `tsc` y sus tests.

**Verificación:** 45/45 tests en en-vivo, guard y sync; `/code-review` 0 hallazgos;
`/security-review` sin vulnerabilidades altas ni medias; CI (`ci` y `acceptance`) verde. En local
fallan 11 tests de `vehiculos`, `cumplimiento` y `paquete-dia` **con y sin estos cambios**
(verificado con stash): datos sucios en la base de tests (`localhost:5434`). Mergear no
despliega: el deploy es manual.

### Estado de las entregas al cierre de este PR

| Entrega | Estado | Dónde |
|---|---|---|
| 0a backup de `.estado-siembra-produccion.json` | Hecho, SHA-256 idéntico | `~/quivo-backups/` (fuera del repo) |
| 10 endpoint de posiciones · 12 throttler | En `main` (#65) | — |
| 1 `revertirAPendiente` · 2 drenado en background | Commiteado y pusheado, sin PR | `fix/movil-drenado-background` |
| 25 mapa offline (Leaflet inline) | Commiteado y pusheado, sin PR | `fix/movil-mapa-offline` |
| 5 voz redondeada · 6 anuncio separado de detección | Commiteado y pusheado, sin PR | `fix/movil-anuncio-puntos-control` |
| 3 breaker de refresh 401 · 4 pantalla del chofer | En curso | worktree `Quivo-control-movil-drenado` |
| 7 anuncio desde headless | En curso | worktree `Quivo-control-movil-anuncio` |
| 13 mapa con todos los vehículos · 14 icono de vehículo | En curso | worktree `Quivo-control-web-mapa` |
| Resto (0b, 0c, 8, 9, 11, 15–24, 26, 27) | Sin empezar | — |

**Nada del lado móvil está probado en un teléfono.** Los tests del lease corren contra un `Map`
simulado y el mapa offline no se probó en modo avión real.

### Pendiente del CTO (acceso a producción)

- **0b:** primero el censo de prefijos de `deviceId` (lo necesita la Entrega 11 antes de bloquear
  dispositivos) y después cerrar las sesiones fantasma **con `UPDATE`, nunca `DELETE`**: hay
  `gps_points` y `cumplimientos_pc` colgando de esas sesiones sin FK. SQL en el plan.
- **0c:** la rotación del video a mano (no `POST /v1/rotaciones`) y revisar el `sentido` de cada ruta.
- **Radio de detección:** el CTO pidió 10 m. Recomendación escrita en el plan: **150 m para
  detectar, ~40 m para confirmar al chofer**. `RUTA_PROXIMIDAD_TOLERANCIA_METROS = 100` permite
  plantar puntos hasta 100 m fuera de su ruta, y todo radio menor que esa distancia los pierde en
  todas las pasadas. La Entrega 18 lo mide punto por punto.

### Deuda conocida que #65 no cierra

- `sembrar-piloto-produccion.ts`: los pasos 10–12 sin `try/finally` (un 429 deja la rotación en
  `borrador` y nadie loguea), y el `catch` del borrado marca asignaciones imborrables ante
  cualquier error.
- `vehicle-marker-animation.ts`: la cola crece en poll rápido y el marcador se atrasa.
- Techo de traza de 50 000 puntos sin acotar el costo de Zod y la serialización en Node.
- El aislamiento entre sindicatos de `/reportes/en-vivo` depende de RLS **transitiva** por JOIN:
  `sesiones_operativas`, `rutas` y `asignaciones` no tienen política propia.
- `tile.openstreetmap.org` no admite uso intensivo de una flota en producción.
- Posible test inestable: `CURRENT_DATE - 1` depende de la zona horaria de la conexión.

### Lecciones de proceso

- **El límite de uso cortó agentes tres veces**, siempre con 4 o 5 en paralelo, y cada corte dejó
  trabajo a medias. Un intento dejó el drenado escrito pero sin conectar a ningún call site: habría
  pasado los tests sin arreglar nada. Retomar un corte exige auditar el diff, no continuar a ciegas.
- **Cada agente trabaja en su worktree.** Uno hizo `checkout -b` en el directorio principal y
  desvió un commit del chairman a otra rama.
- **Un comentario que afirma una garantía de seguridad no es evidencia.** El guard original
  documentaba un fallback a `req.ip` que nunca se ejecutaba; se aprobó leyendo el comentario en
  vez de trazar el orden de guards.
- Un agente agregó `Co-Authored-By` a un commit; se reescribió antes del push.

## Producción usable: panel, credenciales y GPS más fino (2026-09-09)

El primer día en que la app, la API, el panel y la base funcionaron juntos contra producción,
con conductores reales saliendo a la calle. Plan: [`plan-siembra-produccion.md`](plan-siembra-produccion.md).

### El panel de producción nunca había funcionado

Al entrar por primera vez, el login devolvía un token válido y **todas** las llamadas siguientes
daban 401. No lo rompió nadie: **`BETTER_AUTH_URL` jamás se seteó en el deploy**. Está en
`.env.example:44` y en los dos jobs de CI, pero `scripts/deploy-gcp.sh` no la pasaba. Better-auth
toma de ahí su `baseURL` (`packages/db/src/auth.ts:148` no la declara), y sin ella firmaba los
access tokens con `iss` y `aud` **vacíos**; el `JwtAuthGuard`, que verifica con
`auth.api.verifyJWT` (`jwt-auth.guard.ts:29`), los rechazaba. Un servicio emitiendo tokens que él
mismo no acepta.

Nadie lo detectó porque `/v1/health` solo mira base de datos y Redis, y hasta ese día nadie había
entrado al panel de producción. Arreglado en el servicio y en `deploy-gcp.sh`, con la URL basada
en número de proyecto en vez de `status.url`: `BETTER_AUTH_URL` es autoreferencial —la misma
instancia firma y verifica— así que no necesita el segundo `update` posterior al deploy que sí
necesita `CORS_ORIGIN`.

### La base de producción estaba vacía y el seed no servía

`user=0 sindicatos=0 vehiculos=0 conductores=0`: solo las 33 migraciones y las 9 ciudades que
inserta `20260819100000_mobility_city_scope`. Correr `packages/db/prisma/seed.ts` contra esa base
era inaceptable, y no solo por `Quivo123!`: **`seedRotaciones` (`seed.ts:862-916`) crea una
asignación con la fecha de hoy, `estado='vigente'`, sobre una rotación forzada a `'publicada'`**,
para un vehículo cuyo conductor tiene el PIN `135790` hardcodeado. O sea que ese seed no deja
"datos de ejemplo": deja **una credencial móvil real y funcionando con el PIN publicado en el
repo**, contra una API expuesta a internet. Los tres secretos pasan ahora por variable de entorno
con guarda fail-closed fuera de `development`, espejando `client.ts:41-66`.

La siembra se hizo entonces **por la API**, con `scripts/sembrar-piloto-produccion.ts`. Dos
supuestos que resultaron falsos y conviene no repetir:

- **No hace falta meter `scripts/` en la imagen** ni reconstruirla. La geometría real de las rutas
  entra por `POST /v1/lineas/:id/rutas` como GeoJSON (`bodyLimit` de 3 MB; la Z12 son 1255
  vértices ≈ 45 KB), y encima ese camino valida con `ST_IsValid`, cosa que los scripts no hacen.
  Lo que vive en `cargar-circuito-z12.ts`/`cargar-linea-120.ts` es la *transformación* de los
  archivos de `scripts/data/`, que corre en la máquina de quien siembra.
- **Los PIN se pueden fijar, no solo generar**: `PUT /v1/mobile/credenciales/conductores/:id`.

Lo único que sí necesitó el Cloud Run Job fue **crear el primer usuario admin**: el signup público
no está expuesto (`auth.controller.ts` solo registra `login`, `refresh`, `logout` y las dos rutas
de admin), así que era huevo y gallina. Una ejecución de segundos con `auth.api.signUpEmail`,
contraseña aleatoria en Secret Manager.

### Seis conductores, seis vehículos

Primero se sembraron 2 vehículos con 3 conductores cada uno (turnos mañana/tarde/noche, que es el
**máximo estructural**: `TurnoSchema` tiene tres valores y `Asignacion` tiene
`@@unique([vehiculoId, fecha, horario])`). Eso resultó insuficiente en la práctica por una razón
que no estaba a la vista: **un vehículo admite una sola sesión operativa viva**, y cada login
cierra la anterior de esa placa (`auth-movil.service.ts:954-962`). Tres personas compartiendo
placa se sacan entre ellas y solo la última reporta GPS. Para seis en simultáneo hacen falta seis
placas.

La migración a 1:1 chocó con dos cosas que vale registrar:

1. **`@@unique([vehiculoId, fecha, horario])` no incluye `rotacionId`**, así que anular la
   rotación vieja no libera los cupos: las filas siguen existiendo. Crear una rotación nueva con
   los mismos vehículos colisiona. La salida fue **reusar la rotación en el lugar**
   (`publicada → anular → borrador → publicar` es un ciclo válido: ninguno de los dos chequea
   historial, solo el estado actual).
2. **`eliminarAsignacion` hace un `delete()` duro** (`rotaciones.service.ts:271`) y
   `SesionOperativa.asignacion` es `onDelete: Restrict`. Cualquier asignación por la que alguien
   ya se logueó es **imborrable**, y la API devuelve **500**, no un 409 legible. Eso cortó la
   migración a mitad y dejó la rotación despublicada —con nadie pudiendo loguearse— hasta
   republicarla a mano.

Aprendizaje operativo: **publicar la rotación tiene que ser incondicional y anterior a cualquier
limpieza opcional**, porque la ventana despublicada es una caída de servicio.

Estado final: 1 sindicato, 6 socios, 2 líneas con geometría real, 38 puntos de control, 6
vehículos activos, 6 conductores con PIN, 126 asignaciones (una por vehículo por día, 21 días) y
la rotación publicada. Los seis autentican, verificado uno por uno contra la API.

### GPS: el muestreo era la mitad de lo que decía el archivo

Dos hallazgos que invalidan lo que el código documentaba:

- **`locationUpdateInterval` se ignora cuando `distanceFilter > 0`.** El comentario decía "punto
  cada 10 s o 50 m"; era solo cada 50 m, nunca por tiempo.
- **El `distanceFilter` es elástico por default**: el SDK lo escala con la velocidad. Por eso el
  piloto midió **81-103 m** entre puntos con 50 m configurados, y a 50 km/h la traza cortaba en
  diagonal sobre las manzanas.

Ahora `distanceFilter: 15` con `disableElasticity: true` — espaciado constante a cualquier
velocidad, ~1,8 s a 30 km/h. Contra los huecos medidos de 11/17/22/**56 minutos** con el vehículo
detenido entran `allowIdenticalLocations` (Android descartaba los fixes repetidos de un auto
parado, que es justo la evidencia de un layover), `stopTimeout` de 5 a 10 y `stopDetectionDelay: 2`.
El cuarto factor —la geocerca de 200 m del SDK— necesita el handler de `onHeartbeat`, pendiente.

En el panel, el marcador del vehículo **se anima** entre puntos en vez de saltar: era una capa
`circle` cuya fuente se reemplazaba con `setData`, que no interpola. La animación reparte el
intervalo de poll vigente entre los puntos del lote, arranca desde donde está el marcador si llega
un punto con animación en curso, y salta al último por encima de 40 pendientes. Los límites de
puntos por respuesta subieron de 5.000 a 50.000 por el volumen ×5 del muestreo nuevo, con
simplificación Douglas-Peucker de la polilínea por encima de 1.500 puntos.

### Lo que sigue sin estar hecho, y es lo más importante

**La latencia de captura a servidor es de mediana 153-166 s, p95 684-814 s, máximo 4275 s.** Aunque
el GPS muestreara cada metro, el panel seguiría mostrando una posición de hace dos minutos y medio.
Eso domina la experiencia mucho más que el espaciado entre puntos.

La causa está diagnosticada y el diseño escrito, pero **sin implementar**:

- La tarea headless (`headless-task.ts:445-479`) solo **escribe** al outbox; nunca sincroniza.
- El motor de envío vive en un hook de React, y **React Native congela todos los timers apenas la
  Activity pausa** (`JavaTimerManager.onHostPause`), antes incluso de Doze. Eso mata el latido de
  15 s, el re-encadenado, el backoff y —lo más serio— el `AbortController` de `sync-api.ts:36-37`:
  RN Android configura OkHttp sin timeouts, así que **un POST colgado en background no aborta nunca**.
- Corrección importante sobre el diagnóstico obvio: **la tarea headless NO corre con la app viva**
  (RN la rechaza si el contexto está `RESUMED`). El caso dominante —app en background, pantalla
  apagada, chofer que no la mata— se atiende por `onLocation`, que sigue vivo. Colgar el envío solo
  del headless no habría mejorado nada para ese caso.
- Headless y foreground **comparten el mismo contexto JS** (`HeadlessTaskManager.java:184-206`),
  así que un mutex en memoria alcanza para excluirlos; no hace falta un lock en SQLite.

El diseño propone colgar el drenado del evento de ubicación en ambos caminos, con mutex + lease
(porque el timeout HTTP no dispara en background), piso de 10 s para agrupar, y backoff calculado
con `Date.now()` en vez de timers. Proyección: **p50 de ~6 s**.

**Bug ya en producción que sale del mismo análisis:** `revertirAPendiente` (`sync-outbox.ts:126`)
revierte por id sin mirar el estado, así que si dos envíos se pisan puede devolver a `pendiente`
eventos que el servidor **ya acusó** — reenvío perpetuo, y `acusado` deja de significar
"confirmado por el servidor", que es la base del contrato QUI-238.

**Rate limit por IP:** el endpoint de sync hereda el límite global de 100/60 s por IP, y con
`trustProxy` la clave es la IP real. Bajo CGNAT, tres o cuatro choferes del mismo operador se
saturan entre ellos. Hay un guard por `deviceId` implementado (sin mergear) — y ojo con la trampa
que destapó: el `ThrottlerGuard` global **sigue corriendo** en la ruta aunque se le ponga uno
propio, así que ambos aplican en paralelo salvo que el nuevo use un nombre de throttler distinto
del `'default'`.

### No existe alerta de desvío de ruta

Preguntado explícitamente y verificado: **no hay nada**. `estadoFrescura`
(`reportando`/`detenido`/`perdido`/`sin_datos`) dice si llegan datos, no si el vehículo va por
donde debe — alguien puede irse a otro barrio y figurar en verde. Lo más cercano son los
incumplimientos de puntos de control, que detectan que *no pasó por donde debía*, no que *se fue
por otro lado*, y de forma discreta en vez de continua. La traza sobre el mapa muestra el desvío,
pero requiere que alguien esté mirando.

La pieza de cálculo existe (`proximidad-ruta.ts`, tolerancia de 100 m) pero solo se usa al validar
que un punto de control esté sobre la ruta; no está conectada al recorrido en vivo. Calibrar
umbral y duración mínima necesita datos reales, para no disparar con desvíos legítimos por obras o
tráfico.

### Avisos al pasar por un punto de control

Sí existen, los tres activados por default: **voz** ("Punto de control alcanzado. Distancia: X
metros", con `volume: 1.0` forzado), **sonido** (chime sintético que hace ducking de la música del
trufi y suena incluso en modo silencio) y aviso en pantalla. Se apagan por separado desde Ajustes.
**Limitación:** viven en un componente de React (`gps-provider.tsx`), así que con la app cerrada el
punto se registra pero no suena nada.

### Pendientes que salen de esta jornada

- **Implementar el drenado en background** — es lo que más impacta y está diseñado, sin escribir.
- **Desplegar el rate limit por dispositivo ANTES** de repartir un APK con drenado en background.
- **Alerta de desvío de ruta**: no existe.
- **`eliminarAsignacion` devuelve 500** en vez de 409 cuando hay una `SesionOperativa` que
  referencia la asignación.
- Las credenciales `900xTST` son **reales y viven en internet**; el lockout es por vehículo, no por
  IP. Darlas de baja cuando termine la grabación (rotación a `borrador` corta todo de una;
  vehículos y conductores a `inactivo`, que además libera las placas por el índice único parcial).
- Quedan 73 asignaciones viejas de `tarde`/`noche` sobre `9001TST`/`9004TST`: esas placas aceptan
  también los PIN de otros conductores. Cosmético mientras cada uno use la suya.
- Los 4 puntos de control `A2`, `A3`, `C2`, `C3` de la línea 120 **no se cargaron**: pertenecen a
  ramales que la ruta troncal no cubre y quedaban a más de 1 km, fuera de la tolerancia de 100 m.

## El APK no abría: dos copias de React en el bundle (2026-09-08)

El build 8 (`versionCode` 8, desde `ef298d5`) se instalaba y **crasheaba al abrir** con
`TypeError: Cannot read property 'useState' of null` dentro de `useFonts` (`App.tsx:45-55`).
El build 7 (18-ago) funcionaba. El backend no tenía nada que ver: `GET /v1/health` respondía
`{"status":"ok","db":"up","redis":"up"}` contra la misma URL que usa `eas.json`.
Arreglado en el **PR #63** (`5bb2a64`).
Plan: [`plan-apk-conductor-usable.md`](plan-apk-conductor-usable.md).

### La causa

`apps/mobile-mockup` entró al workspace con el rediseño (**PR #51**, `ca1618a`) trayendo un
segundo mundo entero: **Expo ~52.0.11 / RN 0.76.9 / React 18.3.1**, con los mismos
`@expo-google-fonts/{montserrat,oxanium}` que usa `apps/mobile` (Expo 54 / RN 0.81.5 /
React 19.1.0).

Esos paquetes de fuentes **no declaran ninguna `dependencies` ni `peerDependencies`** — su
`package.json` sólo tiene `main`. pnpm les crea entonces un `node_modules` vacío, y sus
`import ... from 'react'` / `from 'expo-font'` caen por walk-up hasta el hoist dir oculto
`node_modules/.pnpm/node_modules/`, que es **uno solo para todo el monorepo** y no tiene
noción de qué app pidió qué. Ahí quedaron `expo-font` de SDK 52 y `expo-modules-core@2.2.3`.
`expo-font@52` requiere eager `FontUtils.js`, que hace `require('react-native')` a nivel de
módulo y arrastra RN 0.76.9 completo.

Mientras hubo una sola versión de cada paquete en el store, ese walk-up acertaba **de
casualidad**. El PR #51 rompió esa casualidad. **El PR que rompió la app móvil no tocó una sola
línea de `apps/mobile`**: la rompió agregando otra app al workspace.

### Lo que se hizo

| Cambio | Por qué |
|---|---|
| `apps/mobile-mockup` → `archivo/mobile-mockup` | Fuera del glob `apps/*` del workspace. Elimina la causa: el segundo `expo-font`, el segundo `react-native` y `expo-modules-core@2.2.3` desaparecen del store |
| Guardia de singletons en `apps/mobile/metro.config.js` | Sacar el mockup cierra *este* caso, no la clase: `react@18.3.1` sigue en el store por `web`/`landing`/`design-system`. La guardia fuerza ocho paquetes a resolver desde `apps/mobile/node_modules`, encadenando (nunca pisando) el `resolveRequest` de Sentry — pisarlo rompería los source maps de release |
| `scripts/assert-bundle-singletons.mjs` + dos pasos de CI | Audita el bundle real exportado y falla si hay más de una versión de `react`, `react-dom`, `react-native`, `expo`, `expo-font`, `expo-asset`, `expo-constants` o `expo-modules-core` |
| Test en `apps/mobile/src/shared/resolucion-singletons.test.ts` | Canario de segundos: dispara el mismo mecanismo que causó el bug |

**Verificado:** `expo export --platform android --dump-sourcemap` + el canario dan exit 0 con
una copia de cada paquete (`react@19.1.0`, `react-native@0.81.5`, `expo-modules-core@3.0.30`).
`pnpm typecheck` 10/10, tests de móvil 147/147. **Confirmado también en CI** (run
`34322849355`): el bundle bajó de 2425 a 1968 módulos y el canario reportó una sola copia de
cada uno de los ocho paquetes.

**El APK de EAS también quedó auditado**, que es lo que realmente cierra el caso: el bug original
consistió en que EAS produjo un bundle distinto al local desde el mismo lockfile. Contando las
versiones dentro del bundle Hermes embebido en cada `.apk`:

| String | Build 8 (crasheaba) | Build 9 |
|---|---|---|
| `19.1.0` — React de `apps/mobile` | 1 | 1 |
| `18.3.1` — React que traía el mockup | **1** | **0** |

La copia de React 18 desapareció del artefacto que se instala, no sólo del bundle local. El
contraste contra el build 8 es lo que hace válida la lectura: si Hermes se comiera esa string,
tampoco aparecería `19.1.0`.

Build 9: `versionCode` 9, desde `5bb2a64`, mismo keystore `Build Credentials 9zSZpTExKl` que los
builds 7 y 8 — se instala encima sin desinstalar. **Desinstalar destruye los recorridos que no se
hayan sincronizado.**

**Ojo con `pnpm install` incremental:** dejaba huérfanos físicos de `react-native@0.76.9`,
`expo-font@*expo@52*` y `expo-modules-core@2.2.3` en `node_modules/.pnpm/` aunque ya no
estuvieran en el lockfile. pnpm no los poda solo — hizo falta borrar `node_modules` y
reinstalar limpio.

### Por qué CI estuvo en verde con la app rota un día entero

**CI nunca ejecutaba Metro.** `@quivo/mobile` define `"build": "tsc --noEmit"` y
`"test": "vitest run --passWithNoTests"`; Playwright es sólo web. Nada en el pipeline armaba
ni ejecutaba el bundle de release, así que el rediseño se mergeó rompiendo la app y nadie se
enteró hasta instalar el APK. Los dos pasos nuevos de CI cierran ese agujero por ~1 min de
build, sin emulador.

Regla de proceso que sale de acá: **si un PR toca `pnpm-lock.yaml` o suma una app al
workspace, se revalida el bundle móvil** aunque no cambie una línea de `apps/mobile`.

### Otros dos arreglos del mismo PR

- **`App.tsx`** tenía `await new Promise(r => setTimeout(r, 2000))` en el `onLoadData` del
  splash, con el comentario "we just wait a minimum time for the animation to look nice" —
  residuo del rediseño. Dos segundos de espera artificial sin relación con el estado real, que
  además podían destapar la app **antes** de que terminara la restauración de sesión y mostrar
  una pantalla vacía. Ahora el splash espera a que `auth.estado.etapa` deje de ser
  `restaurando`; la duración mínima de animación ya la garantizaba `splash-screen.tsx` por su
  cuenta (2500 ms internos).
- **`docs/runbooks/alta-de-conductor-android.md`** describía el login de dos pantallas que el
  PR #53 eliminó. Quien diera de alta a un conductor real seguía instrucciones falsas. Ahora
  documenta el paso único (placa + PIN del conductor), la pantalla "Elige tu turno" cuando hay
  más de una asignación vigente, y el lockout — que ningún documento mencionaba.

### Sobre el nombre "QUIVO Conductor"

Ya estaba correcto y no hizo falta tocarlo: `app.config.ts` fija `name: 'QUIVO Conductor'`,
`slug: quivo-conductor` y `package: com.quivotech.conductor` desde que se creó el archivo — la
app móvil nunca se llamó "QUIVO Control". **Lo que sí sigue diciendo "QUIVO CONTROL" son los
assets de marca** que ve el conductor: `logo.png` (header y Ajustes) y `logo-white.png`
(pantalla de login), confirmado renderizando el canal alpha. Se dejaron como están por decisión
del CTO. Nota menor: `logo-white.png` y `logo-wordmark-white.png` son byte a byte el mismo
archivo (md5 `434722a9...`).

### Pendiente

- **Instalar el APK nuevo y confirmar que abre.** Hasta ahí, el fix está verificado sobre el
  bundle, no sobre el dispositivo.
- **Probar el login end-to-end contra producción.** Nunca se hizo: el health check sólo prueba
  conectividad a DB y Redis, no que auth funcione.
- **Licencia Transistorsoft: vence 2026-09-15**, `grace_builds` en cero. Decisión del CTO:
  cortar el APK antes de esa fecha y decidir la compra después. Cada rebuild consume margen.
- Los **4 criterios GO/NO-GO del GPS en background** siguen sin medirse con la app propia
  (`docs/spike-gps.md:88-101`): las trazas analizadas salieron de Geo Tracker. El APK va a
  abrir, pero la durabilidad del tracking en una jornada de 8 h no está probada.

## Producción en GCP, desplegada y verificada (2026-09-08)

El proyecto anterior (`quivo-piloto`) fue descartado y borrado. **`quivo-control-prod`**
(número `741758083365`, `southamerica-west1`) está creado y **con las tres cargas de trabajo
corriendo**:

| Servicio | URL / estado |
|---|---|
| `quivo-api` | https://quivo-api-hjqvfgsdnq-tl.a.run.app — `{"status":"ok","db":"up","redis":"up"}` |
| `quivo-web` | https://quivo-web-hjqvfgsdnq-tl.a.run.app — HTTP 200 |
| `quivo-worker` | Worker Pool, 1 instancia — `Worker de ingesta QUIVO listo — escuchando la cola de sync` |

Base `quivo_control` con las 33 migraciones aplicadas, `quivo_app` con la password rotada,
`CORS_ORIGIN` con las dos URLs del panel. Se despliega con `scripts/deploy-gcp.sh [tag]
[--solo api|web|worker]` (PR #57, más los fixes #58/#59/#60 descritos abajo).

El detalle de la infra — IDs, IPs, trampas de creación — sigue en
[`docs/infra-gcp-prod.md`](infra-gcp-prod.md).

### Cinco causas raíz que solo aparecen fuera de local

Costó **seis corridas** del script llegar de punta a punta. Ninguna de las cinco causas se
puede reproducir en la laptop ni en CI, y esa es exactamente la razón por la que llegaron
hasta acá. Vale leerlas antes de tocar infra nueva:

1. **El service account de cómputo no tenía ningún rol a nivel proyecto.** El conector de
   Cloud SQL de Cloud Run necesita `cloudsql.instances.get`; sin `roles/cloudsql.client` el
   job de migraciones muere con `403 boss::NOT_AUTHORIZED` y Prisma lo reporta como `P1001`
   ("Can't reach database server"), que despista hacia la red. El paso 0 del script ahora lo
   otorga, idempotente (PR #58).

2. **PostGIS existía solo por la imagen de Docker.** `docker-compose.yml` usa
   `postgis/postgis:16-3.4-alpine`, así que en local y en CI la extensión ya está y
   **ninguna migración la creaba**. Cloud SQL arranca con Postgres pelado y
   `20260730151939_core_entities` moría con `P3018 / 42704: type "geography" does not exist`
   en la columna `geography(LineString,4326)` de `rutas`. Se agregó
   `20260730030000_habilitar_postgis` con timestamp anterior a `init_auth` para correr
   primera, e `IF NOT EXISTS` para ser no-op donde ya está (PR #58).

3. **`gcloud` separa por coma TODOS sus flags de lista y diccionario.** `--args`,
   `--set-env-vars`, `--update-env-vars`. El script de rotación de `quivo_app` tiene una coma
   dentro de un string de JavaScript (`"...caracteres inesperados, abortando por seguridad"`),
   así que `/bin/sh -c` recibió medio script y murió con `unterminated quoted string`. El
   mismo bug estaba **garantizado** en el paso 5: `CORS_ORIGIN` son siempre dos URLs separadas
   por coma. Todo eso pasa a usar el delimitador alternativo `^%%^`, con una guarda en código
   que aborta si algún valor llegara a contenerlo (PR #59).

4. **`gcloud run worker-pools deploy` no soporta `--vpc-connector`.** Los worker pools solo
   tienen Direct VPC egress. El worker usa `--network default --subnet default
   --vpc-egress=private-ranges-only`, que llega a la misma red del conector: cambia el
   mecanismo de salida, no el destino. Los pasos 2 y 3 siguen con el conector, donde sí es
   válido (PR #60).

5. **`--allow-unauthenticated` puede fallar como *warning* y el deploy sigue.** Pasó: los dos
   servicios se desplegaron, el script anunció sus URLs, y las dos devolvían **403**. gcloud
   imprime `Setting IAM Policy...............warning` y devuelve 0. Los pasos 3 y 4 ahora
   verifican el binding `allUsers`/`roles/run.invoker` con `get-iam-policy` y abortan con el
   comando de diagnóstico. El `curl` a la URL quedó como diagnóstico informativo, **nunca**
   como gate: un 403 es el efecto, no la causa, y daría falsos negativos por arranque en frío
   (PR #60).

### Un error de diagnóstico que costó la base

Tras el fallo (2), afirmé que Prisma corre cada migración en una transacción y que por eso
`core_entities` no había dejado nada a medias. **Es falso**: alcanzó a crear tablas antes de
morir. Marcarla como revertida con `migrate resolve --rolled-back` limpió la fila de
`_prisma_migrations` pero dejó las tablas huérfanas, y el reintento chocó contra su propio
`CREATE TABLE` (`42P07: relation "sindicatos" already exists`).

Se resolvió **borrando y recreando la base** `quivo_control`. Fue barato porque no había ni un
registro de negocio — el seed no es parte del deploy. Con datos reales habría sido un
incidente. **Regla que queda:** ante un `P3018`, verificar qué dejó a medias la migración
antes de decidir cómo recuperar; `resolve --rolled-back` solo limpia el registro, no revierte
el efecto.

### Cambios de seguridad hechos a mano, fuera del script

Quedan registrados acá porque **no** los hace `deploy-gcp.sh` y no son reproducibles desde el
repo:

- **Password del usuario `postgres` de Cloud SQL rotada.** El doc de infra decía que estaba en
  Secret Manager; Secret Manager estaba vacío. Se perdió en una sesión anterior cortada a
  mitad. Se generó una nueva (CSPRNG) y quedó en el secreto `DATABASE_URL`.
- **`roles/orgpolicy.policyAdmin` otorgado a `cloud@tuquivo.com` en la organización
  `70008428716`.** Era `organizationAdmin`, que trae `orgpolicy.policy.get` pero no `.set`.
  Es un privilegio amplio y quedó puesto; si no se necesita más, se saca con
  `remove-iam-policy-binding`.
- **`constraints/iam.allowedPolicyMemberDomains` con `allowAll: true` a nivel del proyecto
  `quivo-control-prod`.** La organización lo restringe al dominio `C03ylx347`, lo que prohíbe
  agregar `allUsers` a cualquier IAM y por eso los servicios daban 403. El constraint **no
  admite excepciones más finas** que "permitir todo" en un recurso dado: no se puede permitir
  `allUsers` y nada más. El resto de la organización hereda la política original intacta, pero
  dentro de este proyecto ahora se puede agregar cualquier principal externo. Se aplicó con
  `gcloud org-policies set-policy` tras habilitar `orgpolicy.googleapis.com`. La propagación
  tardó ~1 minuto: el binding falla con `FAILED_PRECONDITION` hasta que llega.

### Pendiente inmediato

- ~~**`apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL`)** tiene un placeholder `.invalid`~~ —
  **hecho** (PR #62): quedó `https://quivo-api-741758083365.southamerica-west1.run.app`, la
  forma con número de proyecto porque es determinista. Verificado el 2026-09-08:
  `GET /v1/health` responde `{"status":"ok","db":"up","redis":"up"}`. Es el mismo servicio que
  `quivo-api-hjqvfgsdnq-tl.a.run.app`, sólo otro hostname.
- **Verificación manual dentro de la VPC**, documentada en la cabecera de
  `scripts/deploy-gcp.sh` y todavía sin hacer: que RLS siga activo en `sindicatos`/`socios`,
  que `quivo_app` no sea superusuario ni tenga `BYPASSRLS`, y que la password rotada sea la
  activa.
- **Dos avisos del worker, ninguno bloqueante.** `Eviction policy is volatile-lru. It should
  be "noeviction"`: BullMQ lo pide porque bajo presión de memoria Redis puede desalojar claves
  con TTL y perder jobs — con 1 GiB y volumen de MVP no debería pasar, pero es configuración
  incorrecta de Memorystore. Y `[Better Auth]: Base URL could not be determined`: falta
  `BETTER_AUTH_URL` en el worker; hay que ver si lo usa de verdad o solo lo arrastra por
  importar el módulo.
- **`apps/landing` no tiene destino de deploy documentado.** Es un hueco, no una decisión.

## Login móvil de un paso, mergeado (#53, 2026-09-08)

`main` = `c92f806`. La rama `feat/login-movil-un-paso` se cerró con CI verde (`ci` 6m28s,
`acceptance` 4m26s) y se borró. **Los dos pendientes de abajo siguen abiertos** — se documentaron
en el cuerpo del PR y en el código, no se arreglaron.

La sesión que produjo esto se cortó por créditos con todo sin commitear; la siguiente lo verificó
de punta a punta y lo cerró. Lección que ya costó dos veces (ver también #51): **trabajo verificado
que no está en `origin` no existe** — commitear al primer punto estable, no al final.

### Estado verificado antes de mergear

Corrido por el chairman en entorno limpio, no reportado por un subagente:

| Paquete | Resultado |
|---|---|
| `@quivo/api` | 275/275 |
| `@quivo/mobile` | 145/145 |
| `@quivo/web` | 63/63 |
| `@quivo/shared` | 52/52 |
| `@quivo/db` | 27/27 |
| `@quivo/design-system` | 8/8 |
| `pnpm lint` / `pnpm typecheck` | 10/10 cada uno |

**Trampa de entorno que costó media hora, anotada para no repetirla:** `packages/db/.env` y
`apps/api/.env` apuntan a bases DISTINTAS (`quivo_control` vs `quivo_control_e2echeck`) y tienen
secretos distintos. Hacer `set -a; . packages/db/.env` para destrabar `prisma generate` (su config
no lee el `.env`, exige `DATABASE_URL` en el entorno) **pisa** los de `apps/api` y produce 23
fallos fantasma: `intentos_auth_movil does not exist`, más Better-Auth con `Failed to decrypt
private key`. No son bugs. Cargá el `.env` en un subshell solo para el comando de Prisma, y dejá
que cada paquete use el suyo para los tests.

### Qué entró (completo y verificado)

**Backend del login de un paso** (ya estaba al abrir la sesión): `POST /v1/mobile/auth/sesion`
(placa + PIN del **conductor**) y `POST /v1/mobile/auth/sesion/asignacion`. Nivel 1 = asignación
vigente hoy con rotación publicada, padding scrypt K=3. Nivel 2 = ventana de 38 días, tope 20, sin
padding, **solo para dar un 409 útil, nunca para autenticar**. Lockout progresivo por vehículo
(`min(2^(fallos−3), 60)` s) sobre la tabla nueva `IntentoAuthMovil`. Endpoints legado vivos detrás
de `MOBILE_LEGACY_AUTH_ENABLED`.

**Cliente móvil conectado** (ítem 2 del plan, era el gap crítico — el backend estaba listo pero
nadie lo llamaba):

- `auth-movil-api.ts`: `autenticarSesion` + `seleccionarAsignacionSesion`; `AuthMovilApiError`
  ahora lleva `retryAfterSeconds` (del body o del header `Retry-After`) y muestra los segundos
  reales del lockout; el 409 propaga el mensaje del backend en vez de taparlo con un genérico.
- `use-auth-movil.ts`: **borradas las credenciales demo hardcodeadas** (`CI_CONDUCTOR_DEMO`,
  `PIN_CONDUCTOR_DEMO`) que viajaban en el binario de producción. Una sola llamada.
  `estado.vehiculo` eliminado y reemplazado por `seleccionToken`.
- `vehicle-login-screen.tsx`: el campo decía "PIN del vehículo"; ahora dice "PIN del conductor",
  que es lo que realmente se manda.

**El 401 permanente dejó de ser silencioso.** Bug de QA del 23-ago: 42 minutos de refresh cada 15 s
devolviendo 401 mientras la pantalla mostraba operación normal y no salía un solo `sync/batches`.
La causa NO era la que decía el handoff viejo — `refrescarConReintentos` y la bandera
`sesionNoRevalidada` ya existían desde `b8fd7de` (#34) y cubren el camino de *restauración*. El
agujero estaba en el camino de *régimen*: `use-sync-status.ts:8` (`REFRESCO_MS = 15_000`) llama a
`obtenerAccessToken`, y su `catch` trataba igual un 401 permanente y un corte de red. Ahora
`clasificarFalloAccessToken` los distingue: el 401 acumula y prende la bandera con CTA; el error de
red sigue devolviendo `null` en silencio, porque operar sin red es requisito duro del producto.

### Hallazgos de revisión aplicados

`/code-review high` + auditoría de seguridad con Opus. **Seguridad: cero hallazgos con confianza
≥8.** Verificó y descartó lo que importaba — el `seleccionToken` es de un solo uso, expira, está
atado al `deviceId` y al `conductorId` ya probado, y el `asignacionId` se re-resuelve contra
`buscarAsignaciones` (no hay IDOR); el 409 con nombre del conductor exige PIN correcto por los dos
caminos; la RLS de `IntentoAuthMovil` es idéntica al patrón de las migraciones previas; `randomInt`
no tiene sesgo de módulo.

| # | Dónde | Qué era | Cómo quedó |
|---|---|---|---|
| H1 | `auth-movil.service.ts`, rama 409 nivel 2 | `resetearIntentos` **anulaba el backoff**: nivel 2 no filtra `conductor.estado`, así que un ex-conductor con su PIN viejo intercalaba 3 fallos + 1 acierto y el lockout nunca enganchaba | El 409 ni resetea ni incrementa. Incrementar penalizaría al chofer legítimo el día sin rotación publicada — justo el caso que ese 409 existe para atender |
| H2 | `registrarIntentoFallidoVehiculo` | `upsert` de Prisma no es atómico: dos requests concurrentes → P2002 → **500 en vez de 401** | `INSERT ... ON CONFLICT DO UPDATE` en un solo round-trip |
| H3 | rama `seleccion_requerida` | `desafios_auth_movil` crecía sin límite; el legado sí podaba | Poda de expirados/consumidos antes del `create`, misma transacción |
| H4 | `use-auth-movil.ts` | La constante decía `CONSECUTIVOS` pero un error de red no reseteaba el contador: `401 → red → 401` prendía la bandera. **El test cortaba un paso antes de destaparlo** | Se conservó la semántica (una sesión revocada sigue revocada tras un corte de red) y se renombró todo a `UMBRAL_401_ACUMULADOS_`. Test del tercer paso agregado |
| H5 | `use-auth-movil.ts` | El ref `fallos401Acumulados` sobrevivía al `logout()`: racha vieja + un 401 = alerta inmediata | Reset en `logout()` y en los dos caminos de login exitoso |

### PENDIENTE 1 — ambigüedad de placas duplicadas — **CANCELADO** (PR #56, 2026-09-08)

> **Resuelto en la base, no en la app.** `placaNormalizada` pasó a ser una columna generada
> `NOT NULL` con un índice único parcial sobre `estado <> 'inactivo'`, así que
> `WHERE estado='activo' AND "placaNormalizada"=$1` devuelve 0 o 1 fila **por construcción**
> y el envenenamiento cruzado de lockout desaparece. Ver `docs/plan-unicidad-placa.md`. Lo
> que sigue abajo queda como registro de qué se había alcanzado a aplicar antes de eso.

**El subagente murió en medio de la reescritura. El árbol quedó consistente y verde, pero parcial:**

- ✅ `ORDER BY ("placaNormalizada" IS NULL), "createdAt", id` aplicado (`auth-movil.service.ts:692`)
- ⚠️ `MAX_VEHICULOS_POR_PLACA = 3` declarada en `:53` pero **sin usar** — probable error de lint
- ❌ `candidatosVehiculo[0]` sigue en `:272`; `estadoLockout` no existe

**El bug:** `buscarVehiculosActivosPorPlaca` matchea también filas con `placaNormalizada IS NULL`,
y la migración `20260801153000` las deja así **a propósito** (duplicados históricos "conservados
para revisión manual"). Con `[0]` arbitrario: el conductor del vehículo perdedor no puede loguearse
nunca, y sus intentos fallidos acumulan lockout **sobre el vehículo del otro sindicato**
— envenenamiento cruzado entre tenants. El login legado sí lo manejaba (exigía exactamente-1 sobre
todos los candidatos, desempatando por el PIN del vehículo); en el flujo de un paso ese desempate
ya no aplica porque el PIN es del conductor.

**Plan aprobado (Opus), listo para implementar:** iterar los candidatos (nivel 1 por vehículo,
padding K=3 por cada uno, tope 9), acumular pares `{vehículo, conductor}` y exigir uno solo;
`verificarLockout` pasa a `estadoLockout`, que **excluye del set** los vehículos bloqueados en vez
de abortar el request — eso es lo que corta el DoS cruzado; si todos están bloqueados, 429 con el
`retryAfterSeconds` **mínimo**; nivel 2 con presupuesto **compartido** de 20 (no 20 por vehículo).
Los 9 tests están especificados; el grueso del costo es un fixture de **segundo sindicato**
(`@@unique([sindicatoId, placa])` impide duplicar la placa dentro del mismo).

**Antes de dimensionar, medir.** SQL de solo lectura, contra la base que corresponda:

```sql
SELECT regexp_replace(upper(trim(placa)),'[^A-Z0-9]','','g') AS placa_norm,
       count(*) FILTER (WHERE estado='activo') AS activos,
       count(DISTINCT "sindicatoId") AS sindicatos
FROM vehiculos GROUP BY 1
HAVING count(*) FILTER (WHERE estado='activo') > 1;
```

Si da 0 filas el bug es latente, **pero el fix sigue haciendo falta**: la suite de tests crea
vehículos sin `placaNormalizada`, o sea que vive entera en la rama de fallback.

### PENDIENTE 2 — las 6 credenciales nuevas (no arrancó)

Decidido por el CTO: **6 credenciales — 1 chofer + 5 pasantes**, 3 en Z12 y 3 en la 120, placas
**ficticias con formato PTA válido** (`9001TST`–`9006TST`), **solo entorno local por ahora** (el
GCP de producción anterior se descartó y el nuevo todavía no existe). Las credenciales viejas se
descartan.

**La trampa, verificada con IDs — no borrar `L1-PILOTO`:**

```
seed.ts:86  LINEA_PILOTO_ID = 33333333-…-000000000010   ← el seed la llama 'L1-PILOTO'
seed.ts:87  RUTA_PILOTO_ID  = 33333333-…-000000000011
cargar-circuito-z12.ts:97   RUTA_OBJETIVO_ID = …011     ← la misma ruta
cargar-linea-120.ts:259     RUTA_Z12_ID      = …011     ← la misma ruta
```

**`L1-PILOTO` ES la Z12.** `cargar-circuito-z12.ts` no crea nada: edita esa ruta **en el lugar**.
El rename a "Z12" se aplicó a mano contra producción y nunca se versionó — por eso local sigue
diciendo `L1-PILOTO` y parece basura. Lo que sí sobra es el contenido placeholder: el vehículo
`PILOTO001` (…014, placa que **no pasa** el patrón PTA nuevo) y sus credenciales.

La 120 del piloto es una línea aparte: `…020`, rutas `…021`/`…022`/`…023`. **No confundirla** con
la otra línea `codigo:'120'` del seed (`12000000-…001`, sindicato 1º de Mayo, Plaza Colón ↔ La
Cancha): esa es de presentación y no tiene nada que ver.

**Por qué local no tiene nada de esto:** los scripts existían desde #34 y #37 y el CTO los corrió,
pero el merge `ca1618a` renombró 4 migraciones y forzó un `prisma migrate reset` que se llevó los
datos locales. Los scripts siguen en el repo → se vuelven a correr y las rutas vuelven.

Tareas: versionar el rename Z12 en el seed · sacar `PILOTO001` y sus credenciales conservando
línea y ruta · `scripts/crear-credenciales-piloto.ts` (molde: `crear-credencial-pasante.ts`,
idempotente por id fijo, PINs CSPRNG impresos una sola vez, rotación `publicada`, asignaciones de
varios días — con uno solo, mañana nadie entra) · correr `cargar-circuito-z12.ts` y
`cargar-linea-120.ts` contra local.

### Deuda que este PR NO cierra

1. **Contradicción de esquema, causa raíz de la ambigüedad de placas:**
   `@@unique([sindicatoId, placa])` dice "única por sindicato" y `placaNormalizada @unique`
   (`schema.prisma:159`) dice "única globalmente". Mientras convivan, un duplicado legítimo entre
   sindicatos **es imposible de normalizar**, y por eso la opción de "arreglar el dato en vez del
   código" no se puede ejecutar. Decisión de modelo de datos, pendiente.
2. **El piloto no es reproducible desde el repo.** Z12 y 120 dependen de correr scripts a mano
   contra una base. Que las 6 credenciales nazcan como script versionado corrige el patrón hacia
   adelante, pero no lo de atrás.
3. **Sin arnés `jest-expo`/RNTL en `apps/mobile`** (ítems 7-8 del plan). Por eso la cobertura del
   contador de 401 está sobre una función pura exportada y no sobre el hook.
4. **Nada verificado contra un dispositivo real.** El flujo de un paso no se probó en emulador ni
   en teléfono; solo tests.
5. Sigue abierto de la prueba de QA del 23-ago: `logout` devuelve 204 sin cerrar la sesión
   server-side, y el listado de `/en-vivo` reporta `sin_datos` para sesiones con puntos
   (`en-vivo.service.ts:199`) — con la trampa del `ORDER BY ... NULLS LAST` que hay que cambiar en
   el mismo PR o el panel abre por defecto en una sesión muerta.

### Orden sugerido para la próxima sesión

1. **Pendiente 2, las 6 credenciales** — es lo que desbloquea a chofer y pasantes para probar en
   campo, así que va primero. Ojo con la trampa de `L1-PILOTO`.
2. **Pendiente 1, la ambigüedad de placas.** Correr antes el SQL de medición: si devuelve 0 filas
   el bug es latente y se puede planificar sin apuro, pero el fix igual hace falta porque la suite
   de tests vive entera en la rama de fallback.
3. La decisión de modelo de datos sobre `placaNormalizada @unique` (deuda 1), que es la causa raíz
   de lo anterior y hoy hace imposible arreglar el dato en vez del código.

Los `.png` sueltos en la raíz (`en-vivo-*.png`) son de la prueba de QA del 23-ago y siguen sin
trackear. O se archivan en `docs/` o se borran; no deberían ir al commit por accidente.

## El rediseño de Jairo, integrado (#51, 2026-09-07)

`main` = `ca1618a`. Entró la integración de `integracion/redesign-jairo`: rediseño del panel web,
rediseño de la app móvil y la landing pública nueva. **El backend de pasajeros de Quivo Rutas NO
entró** — se extirpó antes de mergear (`56c753f`, −3342 líneas: módulos `media`, `notificaciones`,
`pasajeros`, `pasajeros-datos`, `planes`, `common/crypto/secret-box.ts`, 13 modelos `Passenger*` y
5 migraciones). De los 8 endpoints del catálogo público quedó **uno solo**,
`GET /v1/public/mobility/lines`, para que Quivo Rutas sincronice las rutas. Decisión del CTO:
*"no necesitamos NADA de quivo rutas"*.

### Lo que costó cerrarlo, y la lección

El PR se abrió sobre `07c4a7c` y su CI verde **no describía el árbol que se iba a mergear**: los
3 commits con la extirpación y el fix del crash de hooks estaban sólo en local, en dos worktrees
que después se borraron. Se perdió trabajo sin commitear y hubo que rehacerlo. **Lección concreta:
un CI verde sobre un árbol que no es el de destino es peor que no tener CI**, porque da confianza
falsa. Lo primero que se hizo al retomar fue pushear y dejar que CI corriera sobre lo real.

De los 4 bloqueantes que listaba el PR, **dos ya estaban muertos** al verificarlos contra el
código (`ModuleTablePage` lo había arreglado `4d5d414`; `secret-box.ts` se fue con la extirpación).
Los otros dos se arreglaron acá, más dos defectos que el PR no mencionaba.

### Lo que se corrigió

| Área | Cambio |
|---|---|
| `apps/web` (15 archivos) | ~100 `color:'#ffffff'` sobre superficies claras → `var(--qv-text-primary)` |
| `regla-preview.tsx` | `color-mix` invertido → fondo `#0c121e`; los dos textos secundarios de adentro fijados a `#94a3b8` (con el token claro daban 3.94:1, bajo el piso AA de 4.5:1) |
| `apps/mobile` | Restaurado el aviso de que cerrar sesión corta el GPS; `CONFIRMAR` → `CERRAR SESIÓN`; `accessibilityLabel` desincronizado |
| `packages/db` | 4 migraciones renombradas a `20260817160000`–`163000`; prefijo duplicado eliminado. Sin tocar SQL |
| `scripts/dev-all.sh` | Guarda que detecta la deriva de migraciones y aborta explicando el reset, en vez de morir con `42701 duplicate_column` |
| `apps/api` | `@Inject` en `demo-requests.controller.ts`, único controller del repo que rompía la convención |

**El "dashboard muestra ceros" no era un bug de datos.** Los datos llegaban bien (`page.tsx:88-101`);
los cuatro KPIs se pintaban blancos sobre vidrio claro y sólo quedaba visible el `/ total` gris al
lado. `tokens.css` define `--qv-text-primary` para tema claro y oscuro, así que el hex fijo rompía
los dos temas.

**El hallazgo de accesibilidad que destapó `/code-review`:** al renombrar el botón de logout quedó
`accessibilityLabel="Confirmar"` sin actualizar. En React Native ese atributo **pisa** al texto
visible, así que un lector de pantalla anunciaba la palabra más vaga posible justo en el botón que
corta el GPS de forma irreversible, y quien usa control por voz decía lo que veía y el botón no
respondía (WCAG 2.5.3). Es el mismo defecto que el aviso restaurado, pero para quien no ve la
pantalla.

### Verificación

`turbo lint typecheck` 17/17 sin errores. Tests sobre **base virgen** (como CI): api 264/264,
db 27/27, web 63/63, móvil 116/116, shared 52/52, design-system 8/8. Las 30 migraciones aplican
limpias sobre base virgen y se confirmó por SQL que el orden de aplicación ya coincide con el
cronológico. La guarda de `dev-all.sh` se probó en los dos casos, incluida una base con deriva
simulada. Panel verificado en vivo con login real: el dashboard muestra sus números.

**Dos falsas alarmas que conviene recordar:** los errores de `tsc` sobre miembros faltantes de
`@quivo/shared` y `@quivo/design-system` eran `dist` desactualizados, no defectos; y los fallos de
tests eran estado sucio de la base local (JWKS cifrado con otro `JWT_SECRET`, particiones viejas).
En base virgen pasa todo. Antes de reportar un fallo, reconstruir los paquetes y probar en base limpia.

`/security-review` no encontró hallazgos por encima del umbral. Confirmó además que la migración
`20260829180000` **repara** el aislamiento en vez de debilitarlo: le devuelve el `SET search_path`
a una función `SECURITY DEFINER` que lo había perdido.

### Ojo al desplegar

- Las 4 migraciones renombradas cambian su `migration_name`. Producción corre `main` y nunca las
  tuvo, la de CI es efímera, pero **cualquier base local que ya hubiera corrido la rama necesita
  reset** — la guarda de `dev-all.sh` lo detecta y lo explica.
- `20260829180000` corre `DELETE FROM gps_points WHERE "sindicatoId" IS NULL`. El comentario del
  SQL dice que debería afectar cero filas; **no está verificado contra producción**. Contar antes.
- `20260819100000` asigna `cityId='cochabamba'` por default a todas las líneas.
- El rol `'pasajero'` sigue en `RolSchema` (`packages/shared/src/enums/roles.ts:5,15`), inerte.

### Queda abierto, en su propio PR

El pipe global de validación Zod **no valida bajo runtimes esbuild**: depende de la metadata
`design:paramtypes`, que sólo emite `tsc`. Todo el repo usa `@Inject` explícito por esa misma
razón, así que la inyección de dependencias sobrevive y el pipe no. Afecta a los ~25 controllers
**en tests**; producción y el job `acceptance` compilan con `tsc` y no lo sufren. El plan detallado
está en [`docs/plan-cierre-pr51.md`](plan-cierre-pr51.md) §Fase 4.

## Estado al 2026-08-23

`main` = `3abd558` (PR #48). La **Entrega 3 está completa en código y desplegada**: las tres
piezas del mapa en vivo mergeadas — props de seguimiento en `RouteMap` (#45), backend
`/en-vivo` (#46) y la página del panel (#47, con una segunda tanda de correcciones encima).

En producción: **`api:v5` sobre `quivo-api-00007-pvm` y `web:v2` sobre `quivo-web-00002-55k`**,
en Cloud Run `southamerica-west1`. **El drift del 22 de agosto está cerrado** — `/en-vivo`
funciona en producción, verificado con login real (ver
[Deploy de la Entrega 3](#deploy-de-la-entrega-3-2026-08-23)). El worker pool sigue en
`quivo-worker-00004-hk7` con `api:v4`, a propósito: ningún commit de la Entrega 3 toca el
código de ingesta y no valía la pena mover la ruta de la que depende el GPS del piloto.
Desplegar sigue siendo manual (QUI-370).
El APK en los teléfonos es el **build 7** (`versionCode` 7, EAS `e1d01284`, perfil `production`).

**El piloto salió a la calle el 2026-08-18 por la tarde** — segunda jornada real, la primera con
el build 7 instalado. Lo que se aprendió de esa salida está en
[Jornada del 18 de agosto](#jornada-del-18-de-agosto-lo-que-la-traza-real-demostró), y es el
insumo más importante que tiene hoy el proyecto: **la geometría cargada en producción no resiste
la variación diaria de la operación.**

### Lo que está cerrado

- **Código de la v2** (PR #34) y **despliegue** (pasos 1-6 de `plan-salida-apk-v2.md`): las dos
  migraciones aplicadas en Cloud SQL, `api:v4` publicada, las 8 sesiones colgadas cerradas.
- **Circuito Z12 real en producción**: 1255 vértices, 26 puntos de control activos, radio 150 m.
  Salió de los GPX del 17 de agosto. Ver [`plan-ruta-real-z12.md`](plan-ruta-real-z12.md).
- **Línea 120 y alternancia Z12/120** (PR #37): línea, tronco ida/vuelta, circuito, 8 ramales,
  17 puntos de control, 10 paradas, y las 30 asignaciones del piloto alternando entre las dos
  líneas. Corrido contra producción y verificado.
- **Segunda credencial móvil** (PR #37): vehículo `2222AAA` y conductor pasante acompañante, con
  15 asignaciones propias, para que dos teléfonos operen el mismo circuito sin pisarse.
- **Rescate del día 1**: cerrado por decisión del CTO. El código queda en la app pero no
  condiciona nada.
- **Entrega 3 completa en código (PRs #45, #46, #47)**: mapa en vivo `/en-vivo`. Detalle y
  hallazgos en [Entrega 3](#entrega-3--el-mapa-en-vivo-2026-08-19--22).
- **Vía 2 completa (PR #43)**: rescatados los tres PRs de Valentina — QUI-339 (#38, auditoría de
  accesibilidad), QUI-340 (#43, specs E2E de alta de conductor y vehículo) y QUI-342 (#42, filtros
  de cumplimiento en URL y exportación CSV) — los tres mergeados a `main`. El #43 corrigió cuatro
  defectos del original: lock resuelto contra `main` sin churn, `uniqueId` generado por `test()` en
  vez de a nivel de módulo (sobrevive a `retries: 2`), `afterAll` que borra por Prisma las entidades
  creadas, y `dotenv.config` con `override: false`. Verificado corriendo la suite de aceptación dos
  veces seguidas contra la misma base: 5/5 en ambas pasadas, sin acumulación de filas.

### Lo que no está cerrado

- **El aviso de fondo de `/en-vivo` sigue en pie** aunque ya esté desplegado: sobre
  la geometría actual el mapa muestra con precisión un dato equivocado (ver la jornada del 18).
  La pantalla es honesta con lo que sabe — distingue "detenido" de "sin señal" —, pero el
  porcentaje de cumplimiento que la rodea sigue midiéndose contra una geometría que la
  operación real contradice.
- **`/en-vivo` nunca se vio con un vehículo EN MOVIMIENTO.** La prueba de QA del 2026-08-23
  sí confirmó la cadena completa con un dispositivo reportando (login → punto → worker → mapa,
  9 s de lag), pero con el teléfono quieto: 2 puntos a 3 m de distancia. `followPoint`, el
  solape de 15 min del cursor y las dos guardas anti-bucle **siguen sin ejercitarse contra una
  traza que avanza**. Se cierra recién con alguien desplazándose.
- **La app puede quedar en un bucle de refresh rechazado sin avisarle al conductor** (ver
  [prueba de QA](#prueba-de-qa-con-la-pasante-2026-08-23--la-cadena-completa-verificada-en-vivo)).
  Es el defecto más serio abierto hoy: reproduce el fallo silencioso del día 1 del piloto.
- **`logout` responde 204 sin cerrar la sesión del servidor** cuando el refresh token ya era
  inválido.
- **La sesión de QA `9c63dda6` contaminó la evidencia** con un cumplimiento que nadie recorrió:
  hay que excluirla de los reportes del piloto.
- **Tres cosas que se dejaron fuera del PR #47 a propósito**: reflejar `sesionId`/`seguir` en la
  URL (no se puede compartir "estoy viendo el vehículo X"); el truncado de las opciones largas
  del `Select`; y el mismo defecto de `cumplimientos.find()` que sigue vivo en
  `reportes/recorridos/[id]/page.tsx:113`.
- **Los 3 puntos de control obligatorios generan falsos incumplimientos.** Es la corrección más
  urgente y la más barata que dejó el piloto.
- **Faltan trazas GPS** de dos tramos del circuito: el lazo Univalle→Salomón (hoy geometría
  interpolada en línea recta, no calle real) y los 5,1 km finales hasta Villa Armonía.
- **QUI-363 — prueba negativa de RLS**: nunca se validó el aislamiento rompiendo una policy a
  propósito. Sin eso, el verde de la suite de aislamiento no prueba nada.
- **Hardening diferido**, todo abierto: QUI-355 (filtro `sindicatoId` en 8 servicios), QUI-360
  (`audit_log`), QUI-361 (concurrencia del worker), QUI-362 (paginación de recorridos), QUI-252
  (archivado — runbook listo pero `GPS_ARCHIVE_ENABLED=false`), QUI-347 (a11y web), QUI-250 (k6,
  nunca corrido).
- **Datos del piloto en placeholder**: sigue como `Sindicato Piloto — PLACEHOLDER`, placa
  `1111AAA`. Ojo: **cambiar la placa cambia la credencial de login**.
- **Licencia Transistorsoft**: trial, vence **2026-09-15**, `grace_builds` en cero. Sin comprarla
  no sale otro build de EAS. **Decisión del CTO: se pospone hasta que se acabe el trial.**
- **`Quivo123!` (QUI-381)** sigue hardcodeada en `packages/db/prisma/seed.ts:35`, con un rol que
  bypassea RLS por diseño, sobre la base que ya contiene la evidencia del piloto. **Decisión del
  CTO del 2026-08-18: no es prioridad** — la usan solo los desarrolladores y el CPO.
- **Redis** sin política `noeviction`. **`expo-haptics`** sin instalar (vibración del acuse).

### Deuda de infraestructura

No hay job de despliegue: el push de imágenes y el `gcloud run deploy` son manuales, documentados
en `plan-salida-apk-v2.md` pero fuera de CI (QUI-370, tampoco hay Terraform). Y **no existe
registro automático de qué migraciones están aplicadas en producción** — la única fuente de verdad
es un `.md` editado a mano, lo cual es frágil.

## Entrega 3 — el mapa en vivo (2026-08-19 → 22)

Tres PRs, en este orden: **#45** agregó a `RouteMap` las cuatro props de seguimiento
(`fitMode`, `fitKey`, `followPoint`, `onUserPan`), con `followPoint` haciendo `panTo` sin tocar
nunca el zoom y `onUserPan` disparando solo ante gestos reales del usuario. **#46** puso el
backend: tres endpoints bajo `GET /v1/reportes/en-vivo` (listado, contexto, posiciones), con
`findUnique` primero para que un cross-tenant reciba 404, `desde` clampeado en el server y los
GET del poll fuera de `audit_log`. **#47** cerró la entrega con la página del panel, primer
consumidor real del `QueryClient` que estaba montado desde hacía meses sin usar.

### El PR #47 llegó abierto de una sesión anterior

Estaba con CI verde y sin revisar. Revisarlo antes de mergear fue lo que evitó meter a
producción un bucle de descarga. Vale la pena registrar el detalle porque el patrón se repite:
**las tres guardas anti-bucle que tenía el código estaban escritas y ninguna funcionaba.**

1. La recarga completa (auto-heal) pedía la ventana **sin `limite`**, así que el server aplicaba
   el default de 2000 y una jornada Z12 (~4300 puntos) volvía truncada. La traza acumulada se
   descartaba y quedaba reemplazada por los primeros 2000: la polilínea rebobinaba a la mañana.
2. Esa respuesta truncada trae `hayMas: true`, con lo cual `recargaFallida` **nunca** se
   marcaba — justo la bandera que debía cortar la repetición — y `hayMas` además acelera el
   poll a 1 s. Bucle de ~120 KB por segundo con el mapa reseteándose.
3. La guarda comparaba `totalPuntos` entre polls, pero `totalPuntos` es un `count(*)` vivo que
   sube en casi cada poll de un vehículo reportando: la igualdad nunca se cumplía.

Quedó con dos guardas ortogonales: por **déficit** (`totalPuntos - puntos.length`), que cubre la
reingesta colisionada donde el hueco es permanente y fijo aunque el total suba; y un **cooldown
de 60 s**, techo duro de frecuencia. El cooldown no es redundante: cubre el caso que la guarda
por déficit no puede — una sesión por encima de `TRAZA_EN_VIVO_LIMITE_MAX` (5000), donde la
recarga jamás completa y el déficit crece de verdad en cada poll. **Ese caso no es hipotético:**
"Finalizar recorrido" no cierra la `sesion_operativa`, y el 2026-08-18 había varias abiertas de
días anteriores.

### El solape del cursor estaba dimensionado contra la mediana, no contra la cola

`gps_points.ts` es el timestamp del *fix*, no el de la ingesta, así que al salir de Doze llegan
ráfagas con `ts` viejos y un cursor exclusivo las pierde para siempre. El código pedía 2 minutos
hacia atrás, calibrado sobre la mediana del lag (153-166 s). Pero lo que decide acá es la cola:
**p95 de 684-814 s y máximo observado de 4275 s**. Con 2 min, toda ráfaga que aterrizara más
tarde quedaba descartada y el auto-heal —pensado como reparación excepcional— pasaba a ser el
camino habitual. Subido a 15 min, que iguala el `UMBRAL_INGESTA_VIVA_MS` del server. El costo
son ~90 puntos re-pedidos por poll (≈5 KB) que el dedupe absorbe.

### La página no usa los umbrales de color del plan, y hace bien

El plan pedía verde <90 s, ámbar 90 s-5 min, rojo >5 min. Con el lag real medido, un trufi
andando normal se vería **rojo casi todo el tiempo** y el color dejaría de significar algo. La
página usa el `estadoFrescura` que el server calcula cruzando `ultimoFixTs` con
`ultimoIngresoTs`, y muestra **las dos** antigüedades por separado. La distinción que la hace
útil es "el vehículo está parado" (normal, hasta 56 min en terminal) contra "el teléfono no
sincroniza" (falla). Solo `perdido` se pinta como falla.

Por el mismo motivo el corte del poll no usa `fin` —que queda NULL indefinidamente— sino
`inactivaDesdeMs` con umbral de 30 min, el doble del umbral con el que el server declara
`perdido`.

### Otros defectos que la revisión encontró

- El fallback de `PanelFrescura` medía la antigüedad **contra el reloj del navegador**: el bug
  exacto que la corrección por `servidorTs` existe para evitar. Una máquina 10 minutos
  adelantada mostraba "hace 10 min" para un vehículo que acababa de reportar.
- `cumplimientos.find()` devolvía la **primera** pasada: un punto de control fallado en la
  vuelta 1 y cumplido en la vuelta 2 se quedaba gris con "No cumplido" el resto del día. El
  mismo defecto sigue en `reportes/recorridos/[id]/page.tsx:113`, de donde se copió.
- El tick de 1 Hz del reloj re-renderizaba la página entera, y como `buildDivIcon` genera un
  `DivIcon` nuevo por render, react-leaflet reemplazaba el nodo del DOM del marcador: la
  animación del pulso del vehículo se reiniciaba cada segundo sin completar un ciclo.

### Accesibilidad

La auditoría con `web-design-guidelines` no encontró nada crítico pero sí nueve mayores, todos
aplicados. Los dos que valen para futuras pantallas: **`Alert` fija `role="alert"`**
(= `aria-live="assertive"`), así que usarlo para un aviso que se monta y desmonta en cada poll
—"vehículo detenido"— interrumpe al lector de pantalla cada 10 s por algo que no es una falla;
y **`RouteMap` no expone ningún `aria-*`**, con lo que la información de los popups de Leaflet
es inalcanzable sin mouse — la página agrega un resumen textual oculto con
`.qv-visually-hidden`.

Token nuevo en el design system: `--qv-color-info` (con su override para tema oscuro). Las
zonas de `Circle` quedaron con hex a propósito: van a atributos de presentación SVG de Leaflet,
donde `var()` no resuelve.

## Jornada del 18 de agosto — lo que la traza real demostró

Segunda salida a la calle, primera con el build 7. El acompañante grabó con Geo Tracker en
paralelo al tracking propio: dos archivos contiguos (18 s de separación), 1438 puntos,
**17:04 → 18:50 hora local**, 19,02 km, 106 minutos de los cuales 54 % en movimiento.

**El hallazgo que manda sobre todo lo demás: la detección de puntos de control habría fracasado.**

| | Detectados | Fallados |
|---|---|---|
| Jornada del 18-ago | **13 / 26** | 13, **incluidos los 3 obligatorios** |
| Jornada del 17-ago, mismos 26 puntos | 25 / 26 | 1 (Salomón, a 202 m) |

Un reporte de cumplimiento de esa jornada habría marcado 50 % de puntos omitidos y ruta
incumplida — **con el trufi trabajando con normalidad**. Y ampliar el radio no lo arregla: a 300 m
sube a 17/26 y a 500 m se estanca en 18/26.

### Por qué falló

El circuito en producción se construyó a partir de **una sola jornada** (la del 17). La segunda ya
lo contradice en el 45 % de sus puntos:

- **Una banda de ~2,5 km (lat −17,372 a −17,391) donde el trufi va por otras calles**, con
  desvíos de hasta **745 m**. No es deriva de GPS: son 218 y 171 puntos consecutivos y coherentes,
  por un corredor paralelo (lon ≈ −66,151 en vez de −66,158).
- **Ida y vuelta usan calles distintas.** El ascenso del 18 coincide con su propio descenso en
  apenas el 26 % de los puntos. Una polilínea única no puede modelar eso.
- **El terminal sur real de esa tarde estuvo 3,58 km al norte de Villa Armonía**, el terminal
  cargado. Los últimos 5,1 km del circuito no se recorrieron.
- **Cero vueltas completas**: media vuelta de bajada, 30 minutos de espera en terminal, y un
  ascenso que la grabación cortó a mitad.

De los 13 puntos no detectados, 6 fallaron por poco y en calle equivocada (165–508 m) y 7 quedaron
a más de 950 m porque ese tramo no se recorrió.

La parte que sí funciona, y conviene no perderla de vista: **entre Univalle y lat −17,395 el ajuste
es excelente** — 12 puntos detectados a menos de 15 m del trazado. El núcleo está bien; fallan los
extremos y una banda intermedia.

### Dos cosas más que dejó la traza

**El GPS se durmió 12 veces durante la espera en terminal**, en ciclos de ~2 minutos, con el
vehículo detenido. En movimiento no hubo ninguna pérdida (un solo hueco de 71 s en tráfico lento).
Esto fue Geo Tracker, no la app propia, pero es comportamiento del sistema operativo: **la app
propia va a "perder" al trufi cada vez que espere en terminal si no garantiza heartbeat en
background.**

**El conector Univalle→Salomón del circuito no es geometría real**: son 38 vértices interpolados
en línea recta por `interpolarRecta` en `scripts/cargar-circuito-z12.ts`. Ninguna de las tres
grabaciones disponibles cubre ese tramo, así que nadie lo ha validado nunca. Esto es coherente con
que el sindicato haya confirmado que **no retornan hasta Salomón** — es solo el punto de salida de
la primera vuelta de la mañana —, pero significa que si alguna vez se quiere medir cumplimiento
sobre ese tramo, la geometría no sirve.

### Qué hacer con esto, en orden de impacto

1. **Dejar de exigir los 3 obligatorios para cerrar el turno.** Con la operación variando así,
   Univalle + Salomón + Villa Armonía como obligatorios garantizan falsos incumplimientos. Bajar a
   uno, o hacerlos condicionales al tipo de vuelta.
2. **Grabar 2-3 jornadas más antes de volver a fijar geometría.** Con una sola traza se construyó
   un circuito que la segunda jornada ya contradice. Hace falta específicamente una grabación que
   **arranque en el terminal norte antes de que salga el trufi**, y otra que llegue hasta Villa
   Armonía por la tarde.
3. **Modelar ida y vuelta como dos geometrías separadas**, o aceptar una tolerancia mucho mayor.
4. **Incorporar el corredor nuevo** de la banda −17,372/−17,391, o mover los puntos que quedaron a
   255–358 m de la traza real.
5. **Reubicar los puntos que fallan por 50-100 m** sobre la calzada real: Univalle (obligatorio,
   204 m) y el de 165 m.
6. **Blindar el tracking contra la suspensión en parada.**

> Los scripts del análisis no se versionaron (son de un solo uso). Los GPX de origen son
> `18_ago_2026_5_03_05_p._m..gpx` y `18_ago_2026_6_26_04_p._m..gpx`.

### Lo que todavía no se midió

**Nadie verificó aún cuántas filas tiene `gps_points` después de esta jornada.** Es la métrica que
cierra la cadena app → outbox → API → base, y sigue pendiente porque requiere leer un secreto de
Secret Manager. El procedimiento está en `plan-salida-apk-v2.md`; la trampa a recordar es que las
tablas tienen `FORCE ROW LEVEL SECURITY`, así que **un `SELECT` sin `set app.rol = 'admin_quivo'`
devuelve cero filas y ningún error** — ya pasó una vez y llevó a conclusiones falsas.

Comparar ese número contra los 1438 puntos que registró Geo Tracker es lo que va a decir si el
problema, de haberlo, está en el teléfono o en nuestra cadena de ingesta.


## Línea 120 cargada y alternancia Z12/120 (2026-08-18)

El CTO avisó que **la rotación de esta semana alterna Z12 y 120 día por medio** y que el 18 de
agosto tocaba 120, no Z12. La línea 120 nunca había entrado a la base: el handoff la daba como
"KML ya descargado", pero ese archivo no existía en el repo, ni en el disco, ni en la historia de
git. El CTO pasó el link del Google My Maps del sindicato y de ahí salió todo.

**Ahora el KML está versionado** en `scripts/data/linea-120/`, junto a los 16 puntos de control
que el contacto del sindicato mandó por WhatsApp (`puntos-control-andry.json`, con los links
`maps.app.goo.gl` ya resueltos a coordenadas). Dejan de depender de que sobreviva un chat.

**Qué quedó en producción** (`scripts/cargar-linea-120.ts`, idempotente, dry-run por defecto):

| Objeto | Estado |
|---|---|
| Línea 120 | `…0020`, `LINEA 120 RUTAS COMUNIDADES` |
| Ruta asignada | `…0023`, `sentido: 'circuito'`, **146 vértices** (ida 79 + vuelta 67 concatenadas) |
| Rutas `ida`/`vuelta` | `…0021`/`…0022`, se conservan como dato original del KML; no se asignan |
| Ramales | 8 rutas `ramal:*` + 8 filas `variantes` colgadas de la ida |
| Puntos de control | 12 en el circuito (17 en la línea contando los de ramal) |
| Paradas | 10 |
| Asignaciones | 15 por vehículo, alternando Z12/120, para el titular y el pasante |

**Verificado contra el API, no contra la base:** `GET /v1/mobile/asignacion-del-dia` con la
credencial real devuelve línea 120, ruta `circuito`, 146 vértices, 12 puntos de control y el punto
de orden 0 en Univalle.

### El bug que se atajó a tiempo

La primera carga dejó el tronco como **dos rutas separadas** (`ida` y `vuelta`) y la asignación
apuntaba sólo a `ida`. El paquete del día devolvía **7 puntos de control en vez de 12**: el
vehículo hace ida y vuelta en la misma jornada, así que **los 4 puntos del retorno no se habrían
registrado nunca**, incluida la terminal sur donde arranca el regreso. No tiraba error, la app
funcionaba, y se habría descubierto al día siguiente mirando datos que no cierran — el mismo modo
de falla del día 1. El precedente correcto era Z12, cuya ruta asignada es una sola `circuito` con
sus 26 puntos colgando de ella; la 120 quedó igual.

### Univalle es el origen, y `PARADA 120` no es lo mismo

El CTO avisó que el recorrido **sale de Univalle Tiquipaya**. Medido contra el KML,
`PARADA 120 UNIVALLE` (`-17.3327797, -66.2266681`) está a **25 m del último vértice del retorno** y
a **856 m del primer vértice de la ida**, que arranca en `PARADA 120`. Son **dos terminales norte
distintas**, y el KML no trae el tramo que las une — de ahí que el "circuito" no cierre en el
norte. Ese hueco quedó documentado y medido, **sin conector inventado**: la fuente correcta va a
ser la traza GPS real cuando el vehículo lo recorra, mismo criterio que se usó para el conector de
Z12 (`plan-ruta-real-z12.md`).

`PARADA 120 UNIVALLE` se cargó además como **punto de control de orden 0 y obligatorio**: es el
marcador de vuelta. El conductor sale de ahí y vuelve ahí, así que es el punto que permite contar
cada vuelta completa — justo lo que el sindicato pidió medir y lo que el build 7 recién ahora sabe
registrar.

### Lo que el KML no da

El tronco es un **boceto dibujado a mano en My Maps**, no una traza: 79 vértices para 12,4 km
(salto máximo 641 m) en la ida y 67 para 13,8 km (máximo **1348 m**) en la vuelta, contra los
~32 m entre puntos de Z12, que salió de GPS real. **Sirve para el matcheo por radio de los puntos
de control** —que es lo que cuenta pasadas— pero no para medir desvío de ruta ni para dibujar el
recorrido con precisión.

**Sigue abierto:** los 8 ramales están cargados pero **nadie los lee**. La 120 se reparte a las
comunidades "mediante letrero" en el parabrisas, y hoy el sistema no tiene forma de saber qué ramal
tomó el conductor (QUI-383). Cargar el dato no resuelve el modelo.

**Limitación conocida de la alternancia:** `lineaParaFecha()` alterna por paridad del día del mes,
que es correcto para el rango 2026-08-17..31 pero **se rompe en el cambio de mes** (31 de agosto y
1 de septiembre son ambos impares → dos días seguidos de Z12). Hay que rehacerlo antes de generar
la rotación de septiembre.

## Segunda credencial móvil — el pasante acompañante (2026-08-18)

El CTO pidió una segunda credencial operativa para que un pasante acompañe al conductor y tome
notas, haciendo **el mismo recorrido al mismo tiempo pero desde una cuenta separada** — no
compartiendo la del conductor, para que la evidencia GPS de cada uno quede atribuida a quien
corresponde.

**Lo que se creó** (script `scripts/crear-credencial-pasante.ts`, idempotente):

| Fila | Valor |
|---|---|
| Vehículo | `33333333-3333-4333-8333-000000000024`, placa `2222AAA`, mismo sindicato y mismo socio que el titular |
| Conductor | `33333333-3333-4333-8333-000000000025`, `PASANTE — acompañante piloto`, CI `00000001 LP` |
| Asignaciones | 15, del 2026-08-17 al 2026-08-31, misma rotación (`86d20fcf-…`) y misma ruta (`…0011`) que el titular, `horario='manana'`, `orden` 101..115 |

**Los PIN no están en el repo ni en este documento.** A diferencia del seed real
(`packages/db/prisma/seed.ts`, que sí genera un PIN al azar la primera vez), este script **nunca
genera un PIN**: los exige por variable de entorno (`PIN_VEHICULO_PASANTE` / `PIN_CONDUCTOR_PASANTE`)
y aborta si faltan — quien lo corre los elige y ya los tiene. Misma política de almacenamiento que
el titular, documentada en `CREDENCIALES.md`: se guardan solo como hash, se entregan una vez y sólo
se pueden rotar (`FORZAR_PIN=1` en el script, o el endpoint `PUT /v1/mobile/credenciales/…`), nunca
recuperar.

**Verificado contra producción, no contra los tests:** login de dos pasos completo
(`POST /v1/mobile/auth/vehiculo` → `POST /v1/mobile/auth/conductor`) y
`GET /v1/mobile/asignacion-del-dia`, que devolvió el paquete completo — Z12, 1255 vértices,
26 puntos de control, la asignación del 2026-08-18 venciendo a las 03:59:59 UTC del 19. La sesión
de prueba se cerró después: 0 sesiones activas.

### Por qué dos vehículos no chocan en el mismo circuito

La única unicidad que protege contra doble asignación es `@@unique([vehiculoId, fecha, horario])`
(`schema.prisma:387`) — es **por vehículo**, no por ruta ni por rotación. Nada impide dos
asignaciones distintas sobre la misma ruta, la misma rotación, la misma fecha y el mismo horario
mientras el `vehiculoId` difiera. Cada login arma su propia `SesionOperativa` y
`paquete-dia.service.ts` sólo mira la sesión propia.

**Lo que sí puede romper:** al autenticar, `auth-movil.service.ts:223` cierra las sesiones activas
que compartan `vehiculoId` **o** `deviceId` dentro del sindicato. Con dos teléfonos distintos no
pasa nada; si el pasante entrara desde el teléfono del conductor, le cerraría la sesión al
conductor en el acto.

### La trampa de zona horaria, que casi entra a producción

La primera versión del script pasaba las fechas como objetos `Date`. El driver `pg` los serializa
con el **offset local** de la máquina, no en UTC, y esta máquina está en UTC-4:

```
new Date(Date.UTC(2026,7,17))          ->  "2026-08-16T20:00:00.000-04:00"   -> date 2026-08-16
new Date(Date.UTC(2026,7,18,3,59,59))  ->  "2026-08-17T23:59:59.000-04:00"   -> venceAt 4 h antes
```

O sea: las 15 asignaciones un día corridas y las sesiones venciendo a las 19:59:59 hora Bolivia en
vez de a las 23:59:59. El mismo sesgo existe **al leer**: `pg` reconstruye `date` y
`timestamp without time zone` con el constructor local, mientras que Prisma —quien lee esas
columnas en el API real— las interpreta como UTC.

La corrección: fechas y timestamps viajan como **strings explícitos** (`'YYYY-MM-DD'` y
`'YYYY-MM-DD HH:MM:SS'` en UTC), y el `Client` sobreescribe el parser de los oids 1082/1114 para
recibir el texto crudo. Verificado bajo tres zonas horarias distintas (UTC-4, UTC, Asia/Tokyo) con
resultado idéntico. **Cualquier script futuro que escriba fechas a mano a esta base tiene el mismo
problema si pasa objetos `Date`.**

## Despliegue de la v2 — 2026-08-18: pasos 1-5 ejecutados

Se corrió la secuencia de [`plan-salida-apk-v2.md`](plan-salida-apk-v2.md) contra producción. El
código no se tocó: esto es todo despliegue.

| Paso | Resultado |
|---|---|
| 2 — migraciones | ✅ `20260817140000_cumplimientos_pc_pasada` y `20260817150000_sesiones_operativas_vehiculo_estado_idx` aplicadas 17:29 UTC. `cumplimientos_pc.pasada` existe como `integer` nullable |
| 3 — imagen | ✅ `api:v4` publicada, digest `sha256:f5f90af627d97b90268e13a7c1422b077058f85e67e32cbb5a6c080ab754409e` |
| 4 — redespliegue | ✅ `quivo-worker-00004-hk7` y `quivo-api-00006-pfm`, ambos con `api:v4` |
| 5 — sesiones colgadas | ✅ las 8 cerradas; `estado='activa'` = 0, 11 cerradas en total |
| 6 — APK | ✅ build 7 compilado (`e1d01284-b84e-47e1-a69c-10b53985f963`), `versionCode` 6 → 7, keystore `Build Credentials 9zSZpTExKl` — la misma del build 6, así que se instala encima. [APK](https://expo.dev/artifacts/eas/U8pDLh_Yu67YpsypSpmoQuseoP44zrsEXsPxGkU2B28.apk) |
| 7 — calle | ❌ pendiente. `gps_points` sigue en **0 filas** |

**Verificación real, no "el servicio figura Ready".** El worker nuevo logueó
`Worker de ingesta QUIVO listo — escuchando la cola de sync.` a las 17:35:00 y el
`quivo-worker-00003-xr2` (el de `api:v3`) se apagó un segundo después. La API responde
`/v1/health/ready` con `{"status":"ok","db":"up","redis":"up"}`. La config del worker sobrevivió
el update: `scalingMode: manual`, `manualInstanceCount: 1`, `RUNTIME_DATABASE_URL` y `JWT_SECRET`
por secreto, `REDIS_URL`, VPC connector y Cloud SQL adjuntos — y sigue **sin** `DATABASE_URL`.

### Tres cosas que el plan decía mal, y que costaron tiempo

1. **La ruta del schema de Prisma es `packages/db/prisma`, no `apps/api/prisma`.**

2. **`database-url` NO es un rol `BYPASSRLS`.** El handoff y el plan lo daban por hecho. `pg_roles`
   dice `rolbypassrls = false` tanto para `postgres` como para `quivo_app`, y las tablas del tenant
   tienen **`FORCE ROW LEVEL SECURITY`** con la policy `tenant_isolation`
   (`current_setting('app.rol') = 'admin_quivo' OR "sindicatoId" = current_setting('app.sindicato_id')`).
   **El modo de falla es el peligroso:** un `SELECT` manual sin `set app.rol = 'admin_quivo'`
   devuelve **cero filas y ningún error**. Las 8 sesiones colgadas aparecieron primero como
   "0 activas" y parecía que ya estaban cerradas. Cualquier consulta manual futura contra tablas
   del tenant abre con `set app.rol = 'admin_quivo'` o miente.

3. **La URL del secreto usa socket Unix** (`?host=/cloudsql/…`). Con el proxy TCP hay que
   reescribirla a `127.0.0.1:5433` y sacar el parámetro `host`.

### Cómo se cerraron las 8 sesiones

`fin` quedó en el `updatedAt` de cada fila —el último contacto real con el servidor—, no en `now()`:
poner la hora de hoy habría inventado recorridos de dos días en el panel. `revokedAt` y `updatedAt`
sí van a `now()`, que es cuando efectivamente se tocó la fila. Las 8 filas originales quedaron
respaldadas en JSON antes del `UPDATE`. Ninguna tenía cumplimientos asociados: `cumplimientos_pc`
está vacía.

### Lo que sigue

El backend va **adelante** del APK, así que el orden dejó de ser un riesgo: el build 7 puede
instalarse cuando esté. Quedan dos cosas, y ninguna es código:

- **Instalar el build 7 encima del 6** en el S25 (misma firma, las dos bases SQLite sobreviven) y
  seguir [`runbooks/alta-de-conductor-android.md`](runbooks/alta-de-conductor-android.md) —
  incluido el permiso "Permitir todo el tiempo" desde Ajustes, que ningún diálogo puede otorgar
  desde Android 11. **No desinstalar el 6 primero**: eso borra las dos bases SQLite y con ellas el
  outbox pendiente.
- **La prueba en calle.** `select count(*) from gps_points` sigue en **0**. Es la única métrica que
  prueba que la cadena completa funciona; todo lo demás ya estuvo verde el día 1 sin medir nada.

## Entrega 1 del plan v2 (2026-08-17, noche): rescate y worker de ingesta

Dos PRs mergeados. **Producción quedó a mitad de camino** — leer "Lo que falta" antes de seguir.

### PR #32 — persistencia del outbox y rescate del día 1 (`fbfbd56`)

El fix de la regresión de `expo-sqlite@16.0.10`: `abrirOutbox()` pasa a **singleton con promesa
cacheada a nivel de módulo**. La referencia de módulo *es* el fix, no una optimización — mantiene
vivo el único objeto JS registrado, así que Hermes nunca tiene un objeto viejo de esa base que
colectar. Se suma un escape hatch (`useNewConnection: true`, la única forma de saltear el cache de
Kotlin), reintento sobre handle muerto en lecturas y escrituras, y `maxDaysToPersist: 14`.

La pantalla de rescate (Ajustes) lee la SQLite interna de Transistorsoft y reencola por la vía
normal. **Nunca llama `destroyLocations()`.**

Lo que costó dos rondas de revisión, y hay que entender antes de tocarlo:

- `getLocations()` devuelve **todo** lo persistido, no solo el día 1, y `encolarEvento` acuñaba un
  `eventId` nuevo por llamada. Como el dedupe del servidor es por `eventId`, cada re-run habría
  **duplicado evidencia legal** en `gps_points`. El `eventId` ahora se deriva de
  `SHA-256(location.uuid)` + el timestamp del fix: el mismo punto produce siempre el mismo id.
- 🔴 **La ventana de rescate automático es de 7 días, no 14.** `resolverTsFix` descarta cualquier
  `tsFix` más viejo que `TOLERANCIA_TS_FIX_PASADO_MS` y cae **en silencio** al `ts` de encolado —
  o sea, el momento del rescate. Un rescate tardío apilaría el día 1 en la fecha de hoy y, peor,
  rompería la idempotencia: la PK del servidor es `(event_id, ts)`, así que con `ts` cambiante un
  re-run duplica todo. El móvil aplica ahora la misma constante como cota inferior.
  **No subir esa tolerancia sin crear particiones hacia atrás** — el worker solo crea `hoy..hoy+5`
  y sin ese piso vuelve el `23514 no partition ... found for row`, que tira el lote de 500 filas.
- Un corte "solo puntos anteriores al primer arranque del build" se probó y **se retiró**: su
  premisa ("los posteriores ya los encoló el camino normal") es falsa con el paquete del día
  vencido — que es el estado de la mañana del día 2 con el SDK todavía grabando — con la sesión
  cerrada, y en foreground sin `iniciar()`. Era la única defensa que podía *perder* datos.
- Los puntos rescatados llevan `origen: 'rescate'` y `detener()` los excluye de la ventana del
  spike: sin eso, rescatar durante un turno daba un NO-GO falso por un hueco de 24 h.

### PR #31 — el worker de ingesta, desplegado y arreglado (`11f4655`)

**El worker nunca se había desplegado**: `POST /v1/sync/batches` encolaba en BullMQ y nadie
consumía. Se creó el worker pool `quivo-worker` en Cloud Run. Dos cosas que el plan daba por
sabidas y no eran así:

- `--vpc-connector` **no existe** en `gcloud beta run worker-pools`. Va con Direct VPC egress:
  `--network default --subnet default --vpc-egress private-ranges-only`.
- El worker **sí necesita `JWT_SECRET`**, aunque no sirva HTTP: `@quivo/db` importa `auth.js`, que
  resuelve el secreto en tiempo de carga. Sin él, crash loop.

Con eso arrancó y crasheó de nuevo, ahora por un bug real:
`crear_particion_gps_points` usaba check-then-act y **perdía la carrera contra sí misma**
(`42P07`), porque `onModuleInit` la llama directo *y* `upsertJobScheduler` produce un job inmediato
que corre lo mismo. Encima, los 6 días iban en una sola transacción, así que un solo error tumbaba
el proceso. Ahora la creación va en un bloque con `EXCEPTION` y hay una transacción por día.

La revisión de seguridad sumó, sobre esa misma función:

- `SET search_path = pg_catalog, public` + identificadores calificados. Era `SECURITY DEFINER` sin
  `search_path` fijo: escalación real desde `quivo_app` hasta el rol dueño del schema.
- `REVOKE ALL ... FROM PUBLIC` — Postgres otorga `EXECUTE` a `PUBLIC` por defecto y nunca se había
  revocado, así que los `GRANT` eran decorativos.
- El fast-path miraba `pg_class` por `relname` **sin filtrar schema**: un `CREATE TEMP TABLE` con
  el nombre de una partición hacía que el worker se saltara su creación y mandara el día entero a
  `sync_errors`. Ahora usa `to_regclass('public.' || quote_ident(...))`.
- RLS y policy salen del `IF` y corren siempre: la función **garantiza** su contrato en vez de
  asumir que otra transacción lo cumplió, y repara particiones preexistentes sin aislamiento.
- El worker **ya no arranca si falta la partición de hoy**. Antes eso lo dejaba "sano" drenando la
  cola mientras cada `INSERT` fallaba y la evidencia del día se iba a `sync_errors` en silencio.
  El comentario que lo justificaba era falso: el bootstrap creó `CURRENT_DATE-1..+6` relativo a la
  fecha en que corrió la migración (2026-08-02), no al día en que arranca la instancia.

### Lo que falta para que producción funcione

🔴 **El worker está desplegado pero NO operativo.** La migración `20260817130000` está en `main` y
**no está aplicada a Cloud SQL**, así que la revisión `quivo-worker-00002-n7t` sigue con la función
vieja y muere en el bootstrap de particiones.

1. **Aplicar la migración.** No hay automatización: `Dockerfile` solo corre `prisma generate`, y el
   step de `migrate deploy` de `ci.yml` apunta al Postgres efímero de CI. Se hace a mano, con el
   Cloud SQL Auth Proxy:
   ```bash
   cloud-sql-proxy --port 5433 quivo-piloto:southamerica-west1:quivo-control-db
   # el secret `database-url` usa socket Unix: reescribir el host a 127.0.0.1:5433
   pnpm --filter @quivo/db prisma:migrate:deploy
   ```
   ⚠️ El proxy usa **Application Default Credentials**, que son distintas de las de `gcloud auth
   login`. Si tira `invalid_rapt`, correr `gcloud auth application-default login`.
2. **Redesplegar el worker** para que tome la función nueva, y verificar **por logs y por conteo de
   `gps_points`, nunca por el estado del servicio**: `ioredis` se crea con
   `maxRetriesPerRequest: null`, así que sin red reintenta para siempre en silencio y un worker sin
   Redis parece sano. El arranque limpio imprime `Worker de ingesta QUIVO listo`.
3. **Build 7 de EAS** (`npx eas-cli build --platform android --profile production`) e instalarlo
   **encima** en el S25 para extraer el día 1. Antes de eso, en ese teléfono está **prohibido**
   desinstalar, borrar datos o **cerrar sesión** — el logout hace que el próximo tick headless
   llame `detenerTrackingNativo()`. Para recargar el paquete, matar la app y reabrirla.

## Día 1 del piloto (2026-08-17): qué falló y qué quedó aprobado

El piloto arrancó y **no registró un solo punto GPS**. Tres fallos independientes, los tres
diagnosticados con evidencia y con fix diseñado en
[`plan-v2-app-y-mapa-en-vivo.md`](plan-v2-app-y-mapa-en-vivo.md):

1. **La app no pudo escribir al outbox.** Regresión de `expo-sqlite@16.0.10`: se perdió el fix de
   [expo#27748](https://github.com/expo/expo/pull/27748) (que el CHANGELOG de 13.4.0 anota como
   *"Fixed NullPointerException on Android when opening the same database multiple times"*).
   `NativeDatabase.sharedObjectDidRelease()` destruye el `sqlite3*` de C++ **sin chequear el
   refcount** que sí tenía 15.1.4, así que el primer GC de Hermes sobre cualquier objeto JS viejo de
   `quivo-outbox.db` mató el handle compartido, y el `NativeDatabase` zombi quedó cacheado del lado
   Kotlin **con `isClosed == false` para siempre**. Desde ahí, NPE en el 100% de las llamadas
   (Sentry `QUIVO-CONTROL-CONDUCTOR-1`, `code: ERR_UNEXPECTED`). La variable causal es **la
   frecuencia de apertura**: `abrirOutbox()` se llama cientos de veces por jornada y
   `abrirPaqueteDiaDb()` una sola — por eso esa otra base funcionó perfecto todo el día. Fix:
   singleton con promesa cacheada, ~25 líneas. **Actualizar la librería no sirve: 16.0.10 es la
   última publicada y tiene el bug.**
2. **El worker de ingesta nunca se desplegó.** En Cloud Run sólo existen `quivo-api` y `quivo-web`:
   cero jobs, cero worker pools. `POST /v1/sync/batches` encola en BullMQ y nada consume la cola, así
   que `gps_points` quedaría vacía igual. La imagen `api:v3` **ya contiene**
   `apps/api/dist/worker.js` (verificado), así que no hace falta rebuild. El gate de aceptación no lo
   detectó porque **no tiene ningún ítem que verifique que `gps_points` recibe filas** — sólo mira
   `/health/ready`, que reporta Postgres y Redis "up" a nivel de conexión.
3. **La ruta asignada arrancaba en el extremo opuesto.** La asignación de hoy apunta a `…0011`
   (Salomón Romero → Villa Armonía), cuyo PC `orden=0` está en Salomón, pero el vehículo sale de
   Villa Armonía. La app le pedía ruta a 15 km durante toda la mañana. La ruta `813c6130-…` ya
   arranca en Villa y tiene sus 14 puntos ordenados desde ahí.

Además: **sólo se mide la primera vuelta** (el supresor de cumplimientos es durable, se reconstruye
del outbox que nunca se poda) — el CTO pidió contar todas las pasadas; **quedaron 3 sesiones
operativas abiertas** del mismo vehículo en dos dispositivos, y nada las cierra; y los **datos reales
de sindicato, conductor y vehículo siguen en PLACEHOLDER** en producción, visibles en la primera
pantalla de la app.

Lo que sí funcionó: el GPS del dispositivo (los breadcrumbs muestran al trufi avanzando normal de
Villa hacia Univalle), el paquete del día, y el acompañante a bordo con la planilla manual — hoy la
única medición confiable del día 1.

## Estado — 2026-08-18 (v2 cerrada en código, pendiente de desplegar)

**PR #34**, rama `feat/v2-multivuelta-sesion-guiado`. Entrega 2 completa del plan v2. Verificación:
`tsc` 9/9, 86 tests, eslint 0 errores. `/code-review high` devolvió 11 hallazgos (2 altos, 5
medios, 4 bajos), todos aplicados; `/security-review` no encontró nada HIGH ni MEDIUM.

**Lo que se verificó contra producción esta sesión** (túnel de Cloud SQL, sólo lectura):

| Ítem | Estado |
|---|---|
| Asignación de hoy | ✅ existe, rotación `86d20fcf-…` publicada, apunta a `3333…0011` |
| Circuito Z12 | ✅ **aplicado** — 1255 vértices, 40,7 km, 26 PC activos; los 14 de `813c6130-…` en `inactivo` |
| Worker de ingesta | ✅ **desplegado** — `quivo-worker`, `api:v3`, `scalingMode: manual`, 1 instancia |
| `gps_points` | ❌ **0 filas** |
| Migración `pasada` | ❌ sin aplicar (última: `20260817130000`) |
| Sesiones colgadas | ❌ **8 activas** del vehículo `…0014`, 16-17 ago |
| APK en el teléfono | ❌ **build 6** — los builds 4 y 5 fallaron y el 7 nunca se hizo |
| Datos reales | ❌ `Sindicato Piloto — PLACEHOLDER`, placa `1111AAA` |

**Dos cosas que el handoff daba por pendientes y ya estaban hechas:** el worker de ingesta se
desplegó la madrugada del 18 (el primer intento, 00:03, reventó por `JWT_SECRET` faltante; el
segundo, 01:29, arrancó bien y conectó a Redis), y el circuito real de la Z12 quedó cargado en
producción a partir de las dos trazas GPX del día 17.

**Un hallazgo del review que vale registrar:** `PayloadCumplimientoPuntoControlSchema` está
definido pero **no se ejecuta en ningún punto del repo** — `EventoSyncSchema.payload` es
`z.record(z.unknown())`, así que los payloads de sync llegan al worker sin validación de forma. El
cast de `ingesta-worker.service.ts:348` es puramente de tipos. Se coercionó `pasada` a mano; el
resto de los campos del payload sigue confiando en el mismo cast.

**Segunda tanda de hallazgos (auditoría de aptitud para lanzar, mismo día).** Cuatro más, los tres
primeros ya cerrados en la misma rama:

1. **QUI-338, el que reportó la calle.** Un conductor con un **Samsung Galaxy A71** inició sesión
   sin problema y no pudo iniciar el recorrido: la app no accedía al GPS. La app pedía el permiso
   como efecto colateral de `ready()`/`start()` —sin `requestPermission()`, sin
   `getProviderState()`, sin ningún camino a Ajustes— y al fallar mostraba un texto genérico con
   el botón "Iniciar recorrido" todavía habilitado. Desde Android 11 *"Permitir todo el tiempo"*
   no se puede otorgar desde ningún diálogo, y tras dos rechazos Android deja de mostrarlo. Ahora
   hay una máquina de decisión pura (`gps/permiso-ubicacion.ts`) con cuatro estados, cada uno con
   su mensaje y su salida a la pantalla correcta del sistema; el botón depende del permiso.
   Lo que no se arregla con código quedó en
   [`runbooks/alta-de-conductor-android.md`](runbooks/alta-de-conductor-android.md).
2. **El paquete del día viejo se servía como si fuera el de hoy.** `quivo-paquete-dia.db` guarda
   una sola fila y sobrevivía al logout. Si la descarga fallaba por falta de señal, la app caía al
   caché local sin verificar que fuera de la asignación actual — sólo miraba `venceAt`, el de la
   asignación vieja. En un relevo de conductor a mitad de turno eso todavía no venció: el geofence
   habría detectado contra los puntos de control de otra ruta, sin error y sin banner.
   `obtenerPaqueteDiaLocal` ahora exige el `asignacionId` esperado como parámetro **obligatorio**,
   así el compilador impide que un llamador futuro se olvide.
3. **El fix del logout estaba en un call site de dos.** `perfil-screen.tsx` tenía su propio botón
   con un mensaje que no advertía que el GPS deja de grabar. El diálogo se extrajo a
   `shared/components/cerrar-sesion-dialog.tsx` y los dos lo comparten.
4. **Sin cerrar:** Sentry no ata ningún evento a un teléfono — cero `setUser`/`setTag` en toda la
   app. Con un vehículo se correlaciona a mano; con flota, "qué le pasó al conductor X" deja de
   ser un filtro.

**Anotado, sin arreglar:** el worker avisa `Eviction policy is volatile-lru. It should be
"noeviction"` — con la flota, Redis puede desalojar jobs de BullMQ bajo presión de memoria, que es
pérdida silenciosa de eventos.

La secuencia de despliegue está en [`plan-salida-apk-v2.md`](plan-salida-apk-v2.md).

## Estado — 2026-08-16 (domingo, cierre de la víspera del piloto)

**Repo:** [Quivo-enterprise/quivo-control](https://github.com/Quivo-enterprise/quivo-control)
(privado) · `main` = `9a0e472` · **CI verde** (`ci` + `acceptance`) · 3 ramas vivas (las tres de
Valentina, congeladas).

**En producción, GCP `southamerica-west1`, proyecto `quivo-piloto`:**

| Servicio | Revisión | URL |
|---|---|---|
| API | `quivo-api-00005-x72` (`api:v3`) | https://quivo-api-424426714260.southamerica-west1.run.app |
| Panel web | `quivo-web-00001-4jd` (`web:v1`) | https://quivo-web-424426714260.southamerica-west1.run.app |

**Dónde estamos:** el stack completo está desplegado, verificado en vivo y con la ruta real
cargada. El piloto arranca **mañana lunes 17 de agosto con un trufi y un conductor en la línea
Z12**. Lo único que falta antes del arranque es físico: probar el teléfono en la calle.

> **El API tiene prefijo global `/v1`** (`main.ts:32`). Los health checks son
> `/v1/health/live` y `/v1/health/ready` — pegarle a `/health` devuelve 404 y parece un servicio
> caído cuando no lo está.

---

## Lo que hay que saber para operar mañana

### Credenciales del conductor

| Pantalla | Campo | Valor |
|---|---|---|
| 1 — Vehículo | Placa | `1111AAA` |
| | PIN | `76179397` |
| 2 — Conductor | CI | `00000000 LP` |
| | PIN personal | `874863` |

Los PINs del seed original eran irrecuperables (hash de un solo sentido, se imprimen una sola vez
en el stdout). Estos se fijaron por `PUT /v1/mobile/credenciales/{vehiculos,conductores}/:id` y se
verificaron contra el backend real: la cadena completa devuelve sesión con contexto operativo.

**El login es placa + PIN, así que cambiar la placa cambia la credencial.** Cuando se carguen los
datos reales del vehículo hay que avisarle al conductor.

**Cómo funciona, por si falla en campo:** dos pasos —
`POST /v1/mobile/auth/vehiculo` con placa+PIN devuelve un `challengeToken`, y
`POST /v1/mobile/auth/conductor` con ese token + CI + PIN devuelve la sesión. **`deviceId` es
obligatorio en ambos.** La búsqueda de asignación filtra por **fecha calendario exacta** de
Bolivia — no por rango — y **no filtra por turno**. El turno solo importa porque más de una
asignación en el mismo día hace que el login devuelva `seleccion_requerida` en vez de tokens.
Un 404 de "no existe asignación" con credenciales correctas casi siempre es un problema de fecha,
no de credencial: un PIN equivocado da **401**, no 404.

### Panel web

`admin@quivo.local` / `Quivo123!`

⚠️ **Contraseña hardcodeada en `packages/db/prisma/seed.ts:35` y publicada en `CREDENCIALES.md:52`**,
con rol `admin_quivo` que **bypassea RLS por diseño**, ahora accesible desde internet sobre la
base que contendrá la evidencia del piloto. Riesgo aceptado explícitamente por el CTO el
2026-08-16 para llegar al arranque. **Rotarla es la primera tarea post-piloto** (QUI-381). Hoy
tampoco existe ningún admin scoped al sindicato piloto: solo el global.

### La línea Z12, cargada y desplegada

Sindicato Mixto de Transportistas Tiquipaya. Línea `Z12`, id `...010`.

| Ruta | id | Vértices | Largo | Sentido |
|---|---|---|---|---|
| Salomón Romero → Villa Armonía | `...000000000011` | 117 | 20 213 m | ida |
| Villa Armonía → Univalle | `813c6130-2c30-46e4-b533-e3ca2ba17cd2` | 138 | 20 413 m | vuelta |

La ruta de ida se **editó en el lugar** a propósito: la rotación publicada apunta a ese id, así
que reemplazar la geometría deja el resto intacto. Los 2 puntos de control demo del seed se dieron
de baja.

**Puntos de control:** 4 del sindicato (las paradas del KML, `obligatorio: true`) y **24 de
medición propios** (12 por sentido, `orden 2..13`, `obligatorio: false`). Todos con **radio
150 m**. Los de medición se interpolaron sobre la polilínea cada ~1 555 m (ida) y ~1 570 m
(vuelta): los 24 dieron **distancia 0.000000 m** al trazado.

**Rotación:** `2026-08-piloto` (`86d20fcf-931d-40cb-8062-bf605f161709`), publicada, 15
asignaciones del 17 al 31 de agosto, una por día.

**Cómo opera Z12 de verdad** (confirmado por el sindicato, 2026-08-16). El KML está completo — no
le falta ningún tramo:

> 🔴 **Esta sección quedó obsoleta el 2026-08-17.** El sindicato mandó datos nuevos esa madrugada
> que la contradicen en su punto central: el vehículo **sale de Villa Armonía y en la vuelta 1
> llega sí o sí hasta Salomón**, bajando después sin pasar por Univalle; recién desde la vuelta 2
> se queda en el circuito Villa ⇄ Univalle. La versión vigente de cómo opera la línea y los puntos
> de control reales está en [`plan-ruta-real-z12.md`](plan-ruta-real-z12.md). La jornada del 18 de
> agosto agregó además que la operación **varía de un día a otro** — ver el bloque de estado.

- **Salomón Romero es solo punto de partida de la primera salida de la mañana**, no un destino de
  retorno. El grupo 1 sale de ahí; el grupo 2 sale de Villa Armonía.
- **A partir de ahí el circuito termina en Univalle** y se repite así el resto del día.
- Los grupos 1 y 2 **van rotando en las paradas**.
- El conductor de mañana (don Iver) es del **grupo 1a** — a confirmar.

**Consecuencia para leer los datos:** el tramo Salomón Romero → Univalle **se recorre una sola vez
al día**. Los puntos de control y de medición de ese tramo inicial tienen una única oportunidad de
detección, mientras el resto tiene una por vuelta. Una detección baja ahí es muestra chica, no
falla del sistema — no confundir una cosa con la otra al calcular el porcentaje.

**Hipótesis de trabajo, a verificar el día 1:** según el sindicato **mantienen el mismo recorrido
durante todo el día** — el grupo solo determina desde dónde sale cada uno en la mañana. Bajo esa
premisa la geometría cargada sirve tal cual y no falta ningún tramo.

Lo que queda por confirmar es un detalle geométrico: Univalle está a 656 m de la polilínea de ida,
así que al salir de ahí el trufi tiene que empalmar con ese trazado en algún punto. La traza cruda
del día 1 lo responde sin trabajo extra: si los puntos GPS caen sobre la ruta cargada desde el
arranque de cada vuelta, la premisa se confirma; si hay un tramo sistemáticamente fuera del
trazado, ahí está el pedazo que falta.

### Cómo se lee lo que pase mañana

Dos instrumentos, y la separación entre ellos es deliberada:

| Instrumento | Qué mide | Trabajo humano |
|---|---|---|
| Los 24 puntos de medición | Tasa de detección real, cruzando `cumplimientos_pc` contra `gps_points` | Ninguno |
| [`planilla-acompanante.md`](piloto/planilla-acompanante.md) | Verdad de campo independiente: hora de cada paso y **si el vehículo frenó** | Anotar a mano |

Los puntos de medición **se validan solos**: como caen exactamente sobre la polilínea, la traza
GPS cruda demuestra por sí sola que el vehículo pasó por ahí. Con 2 puntos por sentido no había
muestra —detectar 1 de 2 no enseña nada—; con 14 el porcentaje significa algo.

Su separación (~1.55 km) está muy por encima del espaciado del GPS (100-150 m), así que **el
muestreo no puede saltarse un punto entero**. Si mañana alguno no se detecta, es un problema real
de detección, no de que el GPS muestreara en el momento equivocado.

La columna "¿frenó?" de la planilla es lo que convierte un porcentaje en un diagnóstico: si los
detectados son los que frenaron y los perdidos los que pasaron de largo, la hipótesis del
espaciado elástico queda confirmada y se sabe qué ajustar.

**Qué esperar y qué no:**

- El mapa del conductor va a mostrar **línea recta** al próximo punto de control, no ruta por
  calles: OSRM no está desplegado (decisión del ADR 0002) y el endpoint degrada limpio a `null`.
- La traza reconstruida en el panel va a verse **con ruido**: no hay map matching, se dibuja GPS
  crudo.
- Con la app matada, el cumplimiento se graba **sin ningún feedback** al conductor — sin toast, sin
  vibración, sin voz. Está documentado en el código, no es un fallo.
- El mapa necesita internet para dibujarse (tiles y Leaflet vienen de CDN), aunque los **datos**
  son offline-first. Vale verificar qué pasa si el conductor arranca sin señal.

### Decisiones tomadas la víspera, con su razón

**No recompilar el APK** — veredicto unánime de un council de cuatro voces. El argumento dominante
no fue técnico: el APK costó cinco intentos y cinco bloqueantes distintos, y un sexto build de
madrugada sin dispositivo para probarlo, entregado a un conductor real al amanecer, es peor riesgo
que la elasticidad del GPS.

**Radio 150 m, no los 30 m que propone el formulario del panel.** `distanceFilter: 50` **no es
fijo**: el SDK lo escala con la velocidad (`disableElasticity` es `false` por default), dando ~100 m
entre fixes a 18-36 km/h y ~150 m a 36-54 km/h. Y en Android `locationUpdateInterval` se ignora
cuando `distanceFilter > 0`, así que el "cada 10 segundos" del comentario del código no aplica.
**El trufi no frena en los puntos de control** salvo que el tráfico lo obligue — eso invalida el
argumento intuitivo de que el vehículo desacelera justo donde se lo mide. Con radio 30 m el
diámetro (60 m) es menor que el espaciado: el vehículo cruza el punto entero sin que ninguna
muestra caiga adentro, y **como el worker no hace backfill, esa pasada se pierde para siempre**.
Errar por ancho da un falso positivo medible y corregible después sobre la traza cruda; errar por
angosto no se recupera nunca.

**El umbral binario "0 detecciones fuera del radio" era infalsificable** y se reemplazó. Lo
marcaron dos voces del council por separado: el worker revalida cada cumplimiento con **las mismas
coordenadas que le mandó el teléfono**, así que su veredicto siempre coincide con el de la app.
Medir contra ese dato es comparar el sistema consigo mismo — pasa por construcción, funcione o no.
Ahora se mide contra el registro del acompañante.

**Post-piloto:** replay SQL sobre la traza cruda a 30/50/100/150 m para elegir el radio con datos
reales, y recién ahí decidir si vale `disableElasticity`.

---

## Cómo se llegó hasta acá — el domingo 16

### PR #15 (sábado 15): todo el hardening del piloto

QUI-354 (Dockerfiles de `apps/api` y `apps/web`, `enableShutdownHooks()`, liveness/readiness
separados) · QUI-356 (guardarraíl de `JWT_SECRET` + purga del default publicado + `JWT_REFRESH_TTL`
a 7 d) · QUI-358 (`sindicatoId` + RLS en `gps_points`) · QUI-357 (`usesCleartextTraffic: false`) ·
QUI-359 (rotación del refresh token web) · QUI-366 (seed del sindicato piloto) · QUI-365 (Sentry) ·
QUI-348 / QUI-338 / QUI-346 (bugs de M6 que toca el conductor).

Migraciones, seed y suite de RLS corridas **contra la instancia real de Cloud SQL**.

### PR #16 + cuatro PRs de fixes: el APK

Salió **al quinto intento**. Los cuatro builds anteriores murieron, cada uno más adelante que el
anterior y ninguno por la misma causa:

| # | Fase | Causa | Fix |
|---|---|---|---|
| 1 | `INSTALL_DEPENDENCIES` | Worker con Node 20; el repo declara pnpm 11.3.0, que usa `node:sqlite` | PR #17 — `base.node = "22.23.1"` |
| 2 | `INSTALL_DEPENDENCIES` | El `postinstall` de `packages/db` corre `prisma generate`, que explota sin `DATABASE_URL` | PR #19 — placeholder en `base.env` |
| 3 | `EAGER_BUNDLE` | `packages/shared/dist` está gitignoreado; el worker clona limpio y Metro no resolvía `@quivo/shared` | PR #20 — `eas-build-post-install` |
| 4 | `RUN_GRADLEW` (585/585 tareas) | Un comentario XML con la secuencia `--` adentro; AAPT2 lo rechaza con error fatal | PR #21 — reescribir el comentario |

Antes de eso, dos rondas de code review sobre PR #16 encontraron otros tres bloqueantes:
`disableAutoUpload` no existe en `@sentry/react-native` 7.2.0 (se ignoraba en silencio y la tarea
de subida rompía el build), `@sentry/cli` no era resoluble bajo el layout aislado de pnpm, y
faltaba el campo `environment` del que depende que las variables secretas de EAS lleguen al job.

**APK final:** `versionCode` 6, package `com.quivotech.conductor`, firmado con el keystore remoto
de EAS, build `22e5d3f0-5239-474a-b076-c57f60c48bf5`. Verificado **sobre el artefacto**: la URL de
Cloud Run embebida por HTTPS, ninguna referencia a localhost ni LAN, firma RSA 2048 esquema v2,
`android:debuggable` ausente (así que el bloque `debug-overrides` queda inerte), y
`ACCESS_BACKGROUND_LOCATION` declarado. Los source maps de Sentry subieron correctamente.

### PR #23: el panel web

`apps/web` es un SPA con cáscara Next (todo `'use client'`, sin better-auth ni Prisma), así que su
servicio **no lleva conector de Cloud SQL, ni VPC connector, ni secretos de base**. Solo sirve el
bundle; el navegador pega directo contra el API.

**`CORS_ORIGIN` ahora acopla los dos servicios.** `main.ts:51-54` usa un string único —no un array,
no una regex— y estaba sin setear. Si el panel cambia de URL, el API deja de aceptarlo.
`scripts/deploy-web.sh` automatiza todo el procedimiento y documenta las tres trampas:
`NEXT_PUBLIC_API_URL` va **sin** `/v1` (el código concatena el prefijo), va como `--build-arg` y no
como variable del servicio (las `NEXT_PUBLIC_*` se inlinean en build time; si falta, Next hornea el
fallback `localhost:3000` sin ningún error visible), y `CORS_ORIGIN` tiene que ser la URL exacta
sin barra final.

> **[2026-09-08] `scripts/deploy-web.sh` fue reemplazado por `scripts/deploy-gcp.sh`** (ver la
> entrada al tope de este documento) — apuntaba al proyecto GCP borrado `quivo-piloto`. Las tres
> trampas de arriba siguen vigentes tal cual, ahora dentro del nuevo script (pasos 2a/2b y 4).

### Lo que el panel destapó: el seed del piloto estaba a medias

Con el panel arriba, `GET /v1/vehiculos` devolvía **500**. La causa no era RLS —`withTenantContext`
ya hace coalesce de `null` a string vacío— sino los datos placeholder del seed. En cadena, cada uno
descubierto al chocarlo:

1. `placa: 'PILOTO001'` no matchea el regex de placa boliviana; `color: 'PLACEHOLDER'` no está en el
   enum. Una fila inválida tumbaba el listado entero.
2. El vehículo **no tenía socio propietario** — el seed crea socio solo para el sindicato demo.
3. El **CI del conductor no pasaba el login**: `PILOTO-CI-001` falla el regex de CI boliviano que usa
   el endpoint de autenticación, aunque sí pasaba la lectura.
4. **No existía ninguna rotación** para el piloto: sin asignación publicada vigente, el login del
   conductor devuelve 404.
5. El **input de PIN del conductor corta en 6 dígitos** (`driver-login-screen.tsx:207`) mientras el
   backend acepta 6-12 y el input del vehículo permite 12. Un PIN de 8 dígitos es válido, se fija sin
   error, y es **imposible de tipear** (QUI-388).
6. Al dar de baja los puntos de control demo se descubrió que **el paquete del día no filtraba por
   `estado`**: le bajaba al conductor los puntos fantasma junto con los reales. Arreglado en PR #25
   —que encontró el mismo patrón en `paradas`— y desplegado en `api:v3`: el paquete pasó de 16 a 14
   puntos, verificado en vivo.

Todo se corrigió **vía el API REST**, no con SQL directo, para que pasara por validación y quedara
en auditoría.

Se decidió **no** filtrar `Ruta.estado` en el paquete del día: es una búsqueda por id, no una lista,
y filtrarla convertiría "geometría posiblemente vieja" en un `NotFoundException` que voltea el
paquete entero si alguien desactiva una ruta a mitad de ciclo. Peor modo de falla, sin incidente que
lo justifique.

### Fix de fondo: un dato corrupto no tumba un listado

`listar()` ahora usa `mapearTolerante`: omite la fila que no valida y la registra en el log con su id
y los campos que fallaron —deliberadamente ruidoso, porque una fila desaparecida en silencio es peor
que un 500— y solo atrapa `ZodError`, re-lanzando cualquier otro error. Se suma un
`ZodExceptionFilter` global que devuelve 422 en vez del 500 opaco.

Alcance limitado a propósito: el patrón existe en 14 servicios, pero **solo `VehiculoSchema` usa los
schemas estrictos también para lectura** — el resto valida con `z.string()` al leer, así que sus
placeholders del seed pasan. El helper queda listo para migrar el resto (QUI-386).

### El patrón que atraviesa todo el día

**Backend y cliente validan distinto, y nada lo detecta.** El CI del conductor pasaba la lectura
pero no el login. El PIN pasa el backend pero no el input. El vehículo acepta 12 dígitos y el
conductor 6. Seis bugs de la misma familia, cada uno descubierto chocándolo en caliente.

**Y la CI no corre `eas build`.** Todo lo que solo se ejerce en el build nativo —config plugins,
resolución de binarios bajo pnpm, inyección de variables de EAS, versión de Node del worker— no lo
prueba nadie hasta que alguien aprieta el botón. Los siete bloqueantes del día pasaron limpios por
`lint`, `typecheck`, 350 tests y CI verde. Un job que corra `expo prebuild` + `assembleRelease` los
habría atrapado a todos (QUI-371).

**Lección operativa:** verificar contra el `node_modules` instalado, no contra la doc de `main` del
proyecto upstream. Dos de los hallazgos fueron comentarios de código que describían una versión del
SDK distinta de la que corre acá.

---

## Deuda y decisiones abiertas

### Asumida a conciencia para llegar al lunes

| Deuda | Riesgo real |
|---|---|
| **`Quivo123!` en el panel público** (QUI-381) | Credencial del repo con rol que bypassea RLS, expuesta a internet sobre la base del piloto. Primera tarea post-piloto |
| **QUI-363** — prueba negativa de RLS | La suite de aislamiento nunca se verificó rompiendo una policy a propósito. Su verde no prueba nada. Compensado solo por la verificación manual cross-tenant |
| **QUI-370** — infra sin Terraform | **Dos** servicios de Cloud Run fuera de IaC, y el acoplamiento por `CORS_ORIGIN` entre ellos no está expresado en ningún lado |
| **Transistorsoft** — trial, vence **2026-09-15** | `grace_builds` en cero. Decidir la compra antes de esa fecha o el próximo build no sale (QUI-374) |
| QUI-355, 360, 361, 362, 252, 347, 250 | Hardening diferido, 16 pts |

### Brechas de modelo, para decidir después del piloto

- **La estructura de grupos del sindicato no existe** (QUI-382). El sindicato organiza a sus socios
  en una jerarquía —el grupo de 80 se divide en 2 de 40, y cada uno en 2 de 20, `1a` y `1b`— y **el
  grupo determina en qué línea trabaja cada socio**. Hoy `Socio` cuelga plano de `Sindicato`. La
  generación de rotaciones hace round-robin sobre **todos** los vehículos y conductores activos, así
  que con dos grupos mezclaría gente de uno en la línea del otro. No se nota con un solo vehículo.
  **El grupo además define el punto de partida** —grupo 1 desde Salomón Romero, grupo 2 desde Villa
  Armonía— y **los grupos rotan entre sí en las paradas**. O sea que el grupo no es solo una etiqueta
  administrativa: determina qué recorrido hace el vehículo ese día. Modelarlo como una simple
  pertenencia no alcanza.
- **La alternancia de líneas no está modelada** (QUI-383). El grupo alterna Z12 y 120 día por medio;
  la rotación actual asigna la misma ruta los 15 días.
- **Las "vueltas" no existen** (QUI-384). La regla real del sindicato es cumplir N vueltas por día.
  El dato crudo queda capturado —cada pasada se registra— pero el sistema no calcula ni reporta
  "debía dar 5, dio 4".
- **Los ramales de la 120 son variantes sin usar.** Su KML tiene tronco ida/vuelta más **7 ramales a
  comunidades**; la descripción del mapa dice que *"llegando a Tiquipaya la línea 120 se reparte a
  sus diferentes comunidades mediante letrero"*. El modelo tiene variantes de ruta y nadie las usa.
  Hoy el sistema asigna una ruta fija por jornada y no hay forma de saber qué ramal tomó el conductor.
- **`puntos_control` no tiene campo de nombre.** Solo `orden`, `coord`, `radioToleranciaM`,
  `obligatorio` y `estado`. Los 24 puntos de medición se distinguen por `orden >= 2` — frágil cuando
  lleguen los puntos reales del sindicato.
- **`DELETE` de una asignación con sesión asociada devuelve 500** en vez de un 409 legible
  (QUI-385): `onDelete: Restrict` y `rotaciones.service.ts` solo traduce P2002, no P2003.

### Mapas: hallazgos sin resolver

- **Los tiles salen directo de `tile.openstreetmap.org`**, en web y en móvil. Es el servidor de la
  OSM Foundation, cuya política de uso lo restringe a desarrollo y volumen bajo, **no a producción**.
  Con miles de dispositivos el riesgo es bloqueo o throttling sin aviso. Ningún ADR evaluó esto: quedó
  como default de desarrollo. La salida no es Google — es un proveedor de tiles que sirve los mismos
  datos de OSM por unos dólares al mes.
- **No se usa MapLibre, se usa Leaflet.** Tres documentos de arquitectura dicen MapLibre; el grep da
  cero. La decisión real está en el registro de QUI-229 pero los docs nunca se actualizaron.
- **No hay map matching.** La reconstrucción dibuja GPS crudo con su ruido.
- La investigación de costos de Google Maps quedó **cortada por límite de sesión** antes de entregar
  resultados. Alcanzó a marcar que encontró hallazgos de términos de servicio —posibles restricciones
  sobre persistir coordenadas y sobre telemática de flotas— pero no los detalló. **Hay que relanzarla**
  antes de tomar cualquier decisión.

### Vía 2 — cerrada

> Nota histórica: esta sección describía el congelamiento decidido antes del arranque del piloto.
> Los tres PRs de Valentina ya se rescataron y mergearon a `main`: #8 QUI-339 vía #38 (auditoría de
> accesibilidad), #9 QUI-340 vía #43 (specs E2E de alta de conductor y vehículo) y #14 QUI-342 vía
> #42 (filtros de cumplimiento en URL y exportación CSV, incluido el fix del bug real de
> `exportes.service.ts` que interpolaba `${desde}`/`${hasta}` sin filtro de fecha).

---

## Qué falta antes del arranque

> ⚠️ **Tabla histórica, escrita la víspera del 17 de agosto.** El piloto ya arrancó y salió a la
> calle dos veces (17 y 18 de agosto), así que "antes del arranque" ya no describe nada. Se
> conserva porque varias filas siguen abiertas — pero el estado vigente de cada una está en el
> bloque "Estado" del principio, no acá.

| Paso | Quién | Estado |
|---|---|---|
| **Prueba física en el teléfono** — los 7 puntos del checklist | CTO | ⏳ Lo único que falta. Ya hay asignación publicada para hoy, así que se puede hacer |
| Cargar los datos reales del vehículo, conductor y socio | CTO | ⏳ Todos son placeholder. **Cambiar la placa cambia la credencial de login** |
| ~~Confirmar si el retorno de Z12 llega hasta Salomón Romero~~ | — | ✅ Resuelto: no retornan. Salomón Romero es solo salida de la primera vuelta de la mañana |
| Confirmar si el trufi empalma con la ruta de ida al salir de Univalle | CTO | ⏳ Univalle está a 656 m de esa polilínea |
| Confirmar el grupo de don Iver (¿1a?) | CTO | ⏳ Determina el punto de partida de su primera vuelta |
| Rotar el `SENTRY_AUTH_TOKEN` | CTO | ⏳ Se pegó en un chat; darlo por expuesto |
| Puntos de control reales del sindicato | Sindicato | ⏳ Prometidos; los 24 de medición no los reemplazan |
| Cargar la línea 120 | — | ✅ Script `scripts/cargar-linea-120.ts` escrito (línea, tronco ida/vuelta, 8 ramales, 16 puntos de control, 10 paradas, alternación Z12/120 día por medio QUI-383). **Corrido y verificado contra producción el 2026-08-18** (PR #37; son 17 puntos de control, no 16). Los 8 ramales se cargan como `rutas` propias (tienen geometría) + `variantes` de catálogo colgadas de la ruta de ida — el schema de `Variante` no tiene columna de geometría. **Sigue abierto:** el sistema no puede saber qué ramal tomó el conductor (no hay UI ni lógica que use esa geometría todavía) |

**Lo que sigue sin validarse:** el tracking en background **nunca se midió en un teléfono** y el load
test (k6, QUI-250) nunca corrió. El piloto de mañana es, en los hechos, la primera validación de
campo del stack móvil. Atenuante de diseño: la app es offline-first con outbox SQLite — solo necesita
red para bajar el paquete del día y sincronizar, no durante la jornada.

## Qué es el proyecto

Plataforma SaaS **multi-tenant** para gestión de sindicatos de transporte público:

- **Web admin**: CRUD de sindicatos, socios, vehículos, conductores, líneas, rutas/variantes, paradas, puntos de control; rotaciones; sanciones; dashboard de cumplimiento; auditoría.
- **App móvil (conductor)**: offline-first, GPS en background durante el recorrido, validación local de puntos de control (geofence), outbox local y sincronización idempotente por lotes al recuperar conexión.

Requerimientos de Producto (CPO): `~/Downloads/QUIVOcontrol.md` (RF-01..84, RNF, MVP, criterios de aceptación §8, 18 preguntas §9, entregables §10).

## Fuentes de verdad y decisiones ya cerradas

Nada de esto se vuelve a discutir salvo que cambie una restricción real.

| Qué | Dónde | Cuándo |
|---|---|---|
| Stack y arquitectura | [`plan-maestro.md`](plan-maestro.md) §Stack | Aprobado 2026-07-19 |
| Modelo de datos, API, sync, riesgos, las 18 preguntas del CPO | [`documento-tecnico-cto.md`](documento-tecnico-cto.md) | 2026-07-19 |
| Alcance, fases, asignación y fechas hasta el piloto | [`plan-piloto-lunes-17-agosto.md`](plan-piloto-lunes-17-agosto.md) — anula a [`plan-finalizacion-piloto.md`](plan-finalizacion-piloto.md) | 2026-08-15 |
| Umbrales de aceptación y criterios de aborto del piloto | [`piloto/checklist-aceptacion-e2e.md`](piloto/checklist-aceptacion-e2e.md) | 2026-08-16 |
| Infraestructura: **GCP**, `southamerica-west1` | [`adr/0002-gcp.md`](adr/0002-gcp.md) — anula el ADR 0001 | 2026-08-14 |
| Deliberación inicial (council) | `~/.council/Documents/council-20260719-083140/` | 2026-07-19 |
| Contratos de auth móvil | [`plan-auth-movil-quivo.md`](plan-auth-movil-quivo.md) | 2026-08-01 |
| Diagnóstico del bloqueo de CI y del design system perdido | [`plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md) | Registro cerrado |
| Protocolo del spike GPS y sus 4 criterios de GO | [`spike-gps.md`](spike-gps.md) | Corregido en el PR #6 |

**Respuestas de Producto que fijan el alcance** (detalle en el documento técnico §15): solo
Android en el MVP · 2 sindicatos y 2000–3000 vehículos el año 1 · **login por vehículo**, el
chofer se identifica encima · GPS crudo 6 meses caliente, después archivo, **nunca se borra
evidencia** · evidencia de sanciones = datos de recorrido, fotos post-MVP.

**Memoria del proyecto:** la del harness, bajo `~/.claude/projects/<ruta-del-repo>/memory/` — es
local a cada máquina, así que la ruta exacta varía según dónde esté clonado el repo.

## Stack aprobado (resumen)

TypeScript punta a punta. Detalle y justificación completa en `docs/plan-maestro.md` §Stack.

- **Backend**: NestJS (adapter Fastify), monolito modular. Prisma para CRUD; SQL crudo (multi-row insert / `COPY`) para la ruta caliente de ingesta GPS.
- **DB**: PostgreSQL 16+ con PostGIS; `gps_points` particionada por rango de tiempo (pg_partman). TimescaleDB queda como palanca de escala posterior (no disponible en RDS/Aurora/Neon gestionados — verificado).
- **Cola**: Redis + BullMQ — absorbe ráfagas de sync; workers insertan por lote.
- **Auth / multi-tenancy**: Better-Auth + JWT con claims (`sindicato_id`, `rol`) + Row-Level Security en Postgres (shared schema).
- **Web**: Next.js (App Router) + Tailwind + TanStack Query.
- **Móvil**: Expo (React Native) + EAS Build; GPS background con Transistorsoft `react-native-background-geolocation` (licencia única ~US$400); expo-sqlite como outbox.
- **Sync idempotente**: UUIDv7 generado en cliente + `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
- **Mapas**: MapLibre GL + tiles OSM.
- **Infra**: **GCP** — Cloud Run (API) + Cloud Run Worker Pool (ingesta GPS) + Cloud SQL PG16/PostGIS + Memorystore Redis + Secret Manager, `apps/web` también en Cloud Run, archivado GPS en Cloudflare R2, IaC con Terraform, todo en **`southamerica-west1`** (Santiago) menos el Cloud Scheduler ([ADR 0002](adr/0002-gcp.md), 2026-08-14 — anula el ADR 0001 Railway vs Fly.io). EAS para móvil.

## Decisiones clave y por qué

1. **TS en vez de Go** (propuesta de Gemini): el equipo/entorno ya es TS/React/Expo; el cuello de la ingesta es la DB, no el runtime, y se neutraliza con batching + cola.
2. **Expo en vez de Flutter**: mismo SDK nativo subyacente (Transistorsoft); aprender Dart no aporta.
3. **Particionado nativo en vez de TimescaleDB día 1**: preserva portabilidad de hosting.
4. **Monolito modular, no microservicios**: velocidad de MVP; bordes limpios permiten extraer el servicio de tracking después sin reescritura.
5. **Shared-schema + RLS en vez de schema-per-tenant**: sin requisito legal de aislamiento físico; doble barrera JWT + RLS.

Camino de escalado (en orden): réplicas de lectura → workers de ingesta horizontales → particionado agresivo/compresión o migración TimescaleDB → extraer servicio de tracking solo si los números lo exigen.

## Riesgo #1

**GPS en background sobre Android gama baja** (Doze, battery killers de fabricantes). Mitigación: spike go/no-go en semana 1 de Fase 0 — app esqueleto con Transistorsoft, 8 h de tracking en dispositivo barato, medir batería (<5%/turno) y huecos (>2 min = fallo). Plan B: módulo nativo Kotlin (Foreground Service) dentro de la app Expo.

## Fases (plan)

0. Fundaciones + spike GPS (monorepo, CI, Postgres+PostGIS, auth+RLS, esqueleto NestJS).
1. Núcleo administrativo (RF-01–39).
2. Rotaciones (RF-51–57).
3. App móvil + offline + sync (RF-58–73).
4. Dashboard + auditoría + reportes (RF-74–84).
5. Hardening (load test k6, índices, RLS audit, `/security-review`).

Estimación: 14–18 semanas, equipo 2–3 devs. Detalle en `docs/documento-tecnico-cto.md` §11.

## Preguntas de Producto — respondidas (2026-07-19)

Detalle completo en `docs/documento-tecnico-cto.md` §15.

1. **Solo Android** en MVP; iOS post-MVP.
2. **2 sindicatos, 2000–3000 vehículos total** año 1 (~8–9M puntos GPS/día — dentro del diseño, sin cambios de stack).
3. **Login por vehículo** (chofer rota); credencial emitida por el sindicato, conductor se identifica al iniciar sesión operativa.
4. **GPS crudo: 6 meses caliente** (particiones diarias) → archivo S3/R2; nunca se borra evidencia. Derivados permanentes.
5. **Evidencia de sanciones: solo datos de recorrido** auto-vinculados; fotos post-MVP.

---

# Registro cronológico

De acá para abajo, el histórico de cómo se construyó el producto, en orden. **El estado vigente
está arriba** — si algo de esta sección contradice al "Estado", gana el "Estado": lo de abajo se
escribió el día que pasó y no se retoca después.

## Linear (creado 2026-07-19)

- **Proyecto:** [QUIVO Control — MVP](https://linear.app/quivo-tech/project/quivo-control-mvp-1d41fa072abf) — team Quivo-Tech (QUI), start 2026-07-20, target 2026-11-20, lead cto.josel.
- **Milestones (6):** M0 Fundaciones+Spike (2026-08-02) · M1 Núcleo admin (2026-08-30) · M2 Rotaciones (2026-09-13) · M3 Móvil+sync (2026-10-18) · M4 Dashboard/reglas (2026-11-08) · M5 Hardening+piloto (2026-11-20).
- **Issues:** 43 (QUI-211..253), todos con criterios de aceptación, estimates (puntos), labels por área y refs RF/§doc técnico.
- **Cycles:** verificado contra la API de Linear (2026-07-20) que la cadencia real es de **2 semanas**, no de 1 semana como decía una versión anterior de este documento. Sprint 1 = **Cycle 12** (2026-07-20 → 2026-08-03), 9 issues en Todo:
  - QUI-211 monorepo, QUI-212 CI, QUI-213 infra, QUI-214 esqueleto NestJS, QUI-215 shared, **QUI-216 spike GPS (URGENT, gate go/no-go)** — todos con fecha límite 2026-07-26.
  - QUI-217 Prisma schema, QUI-218 RLS (URGENT), QUI-219 auth — en **Cycle 13** (2026-08-03 → 2026-08-17), no dentro de Cycle 12.
- **Dependencias:** QUI-216 (spike) bloquea QUI-235 y QUI-237 (móvil M3); QUI-211 bloquea QUI-217.
- Labels nuevos creados: `backend`, `mobile`, `db`, `gps`.

## Kickoff Cycle 12 (2026-07-21) — QUI-211/212/213/214/215/216

Implementados en local (branches separadas por issue, sin mergear — ver "Pendientes de acceso"):

- **QUI-211** — monorepo pnpm+Turborepo: `apps/{api,web,mobile}` + `packages/{shared,db}`,
  tsconfig strict compartido, ESLint 9 flat config + Prettier, Node 22 LTS pinneado.
  Verificado: `pnpm install` + `turbo build/lint/typecheck/test` en verde en los 5 workspaces.
- **QUI-215** — `packages/shared`: enums (roles, estados), schemas Zod de entidades núcleo
  (sindicato/socio/vehículo/conductor), `EventoSyncSchema` con `event_id` UUIDv7, pipeline
  de generación OpenAPI (`zod-to-openapi`). Tests de contrato en vitest.
- **QUI-213** — `docker-compose.yml` local (Postgres 16+PostGIS en puerto **5434**, para no
  chocar con otros Postgres locales de esta máquina de desarrollo; Redis en 6379). ADR
  Railway vs Fly.io documentado (`docs/adr/0001-railway-vs-flyio.md`) **sin aprovisionar
  nada real** — decisión de infra cloud queda pendiente, confirmada por el usuario.
- **QUI-214** — esqueleto NestJS/Fastify: 14 módulos de dominio vacíos, `GET /v1/health`
  (chequea Postgres+Redis), `GET /v1/_internal/ping` (liveness), logging pino JSON con
  `request_id`, Sentry condicional a `SENTRY_DSN`, pipe global de validación Zod (`APP_PIPE`)
  probado end-to-end contra `packages/shared`. Nota: el health-check vive en `/v1/health`
  (versionado), no en `/health` sin prefijo — excluirlo del prefijo global rompe el hook de
  logging de `nestjs-pino` sobre Fastify (detalle en `apps/api/README.md`).
- **QUI-216** — código y protocolo del spike GPS listos (`apps/mobile`): config Transistorsoft,
  detección de huecos/batería con tests, outbox SQLite. **La ejecución física de las 8h
  (licencia Transistorsoft ~US$400 + Android real de gama baja) sigue pendiente** — ninguno
  de los dos recursos está disponible en este entorno. Detalle y protocolo en
  `docs/spike-gps.md`. **No cerrar QUI-216 en Linear hasta tener los números reales.**
- **QUI-212** — `.github/workflows/ci.yml`: lint/typecheck/test/build con cache de pnpm+Turborepo
  y services Postgres+PostGIS/Redis, `timeout-minutes: 10`. **Branch protection en `main`
  queda pendiente** (requiere `gh` CLI autenticado o ajuste manual en GitHub Settings).

## QUI-227 (web admin) + QUI-219 (auth real) — cerrado 2026-07-30

`apps/web`: scaffold Next.js 15 App Router consumiendo `@quivo/design-system` (repo hermano
`~/Proyectos/Web/Design_System_QUIVO`, symlink `link:`). Incluye login, layout con sidebar
filtrado por rol, refresh de sesión JWT (`src/lib/auth/jwt.ts` + `auth-context.tsx`), guard de
rutas por rol (`isRouteAllowedForRole`), demo CRUD navegable de los 8 módulos M1 (Sindicatos,
Socios, Vehículos, Conductores, Líneas, Rutas, Rotaciones, Reglas) sobre datos en memoria, y
dashboard con KPIs y gráficos de flota/socios. Detalle del patrón CRUD demo en `apps/web/README.md`.

`apps/api`+`packages/db`: `POST /v1/auth/login` y `/v1/auth/refresh` reales vía Better-Auth +
Prisma (reemplazan el bypass `NEXT_PUBLIC_DEV_BYPASS_AUTH` que solo debería usarse en dev local).
Usuarios seed (`packages/db/prisma/seed.ts`): `admin@quivo.local` (rol `admin_quivo`) y
`admin@sindicato.local` (rol `admin_sindicato`, `sindicatoId` fijo), password `Quivo123!` para
ambos — solo para desarrollo, nunca en producción.

**Verificado end-to-end (2026-07-30):** login/refresh real contra Postgres, rechazo de password
incorrecta (401), y el guard de rutas por rol funcionando con una sesión **real** (no solo el
bypass simulado) — `admin_sindicato` es redirigido fuera de `/sindicatos` igual que con el bypass.

## QUI-217 (schema núcleo) + QUI-218 (RLS) + QUI-220 (CRUD sindicatos) — cerrado 2026-07-30

QUI-220 dependía de QUI-217/218, que en Linear seguían en "Todo" sin implementar (QUI-219 se
había adelantado fuera de orden porque solo necesitaba las tablas de Better-Auth) — se hicieron
los tres en orden en la misma sesión.

**QUI-217 — `packages/db/prisma/schema.prisma`:** modelos `Sindicato`, `Socio`, `Vehiculo`,
`Conductor`, `Linea`, `Ruta`/`Variante`/`Parada`/`PuntoControl` (columnas `GEOGRAPHY` vía
`Unsupported(...)`, sin CRUD todavía — llega con QUI-225/226) y `AuditLog`. `estado` queda
como `String` libre en Prisma a propósito: la única fuente de verdad del enum es
`EstadoXSchema` en `@quivo/shared`, no un enum nativo de Postgres. Seeds (`prisma/seed.ts`):
2 sindicatos demo con IDs fijos (`11111111-...`/`22222222-...`, los mismos que ya usaba el
usuario `admin@sindicato.local` de QUI-219) + un socio/vehículo/conductor/línea de prueba
por sindicato.

**QUI-218 — RLS multi-tenant:** gotcha central de Postgres — **los superusers (y cualquier
rol con BYPASSRLS) ignoran las políticas RLS sin importar `FORCE ROW LEVEL SECURITY`**, y el
rol `quivo` de `docker-compose.yml`/CI es superuser. Se creó un rol de runtime separado
`quivo_app` (`NOSUPERUSER NOBYPASSRLS`, migración `20260730152500_rls_multi_tenant`) que es
el que de verdad usa `apps/api` (`RUNTIME_DATABASE_URL`, distinto de `DATABASE_URL` que sigue
siendo el rol de migraciones). Contexto por request vía `withTenantContext` en
`packages/db/src/tenant-context.ts` (`SELECT set_config('app.rol'/'app.sindicato_id', $1,
true)` dentro de una transacción — el `true` final es `SET LOCAL`, se descarta solo al
terminar esa transacción). Políticas con bypass explícito para `admin_quivo` en `sindicatos`,
`socios`, `vehiculos`, `conductores`, `lineas` y `audit_log`. **Deliberadamente sin RLS:**
tablas de Better-Auth (login necesita leer `user` por email antes de conocer su
`sindicato_id` — meterle RLS complica ese flujo sin ganancia real de aislamiento) y
`rutas`/`variantes`/`paradas`/`puntos_control` (heredan `sindicato_id` transitivamente vía
`lineaId`, sin API todavía). Test cross-tenant real (`packages/db/src/rls.integration.test.ts`,
9 casos) corre en CI vía `pnpm test` — crea dos sindicatos temporales, prueba que ninguno lea
ni escriba datos del otro, y que `admin_quivo` sí ve ambos.

**QUI-220 — `POST/GET/PATCH /v1/sindicatos`:** `JwtAuthGuard` (verifica el access token corto
vía `auth.api.verifyJWT`, stateless) + `RolesGuard`/`@Roles('admin_quivo')` — los sindicatos
son el tenant, `admin_sindicato` no tiene acceso a este endpoint en absoluto. Auditoría directa
en `audit_log` por acción (el interceptor genérico llega con QUI-230). Verificado con curl real:
sin token → 401, `admin_quivo` → 200/201, `admin_sindicato` → 403.

**Bug de configuración encontrado armando esto:** sin `BETTER_AUTH_URL`, el plugin `jwt` de
Better-Auth firma `iss`/`aud` vacíos (`""`), y su propio `verifyJWT` interno rechaza cualquier
payload con `aud` falsy — **incluso un token recién emitido y válido**. Sin esto, ningún
endpoint protegido con `JwtAuthGuard` puede autenticar nada. Se agregó `BETTER_AUTH_URL` a
`.env.example`/CI/los `.env` locales, y un test de integración contra Better-Auth real (no
mockeado) para que este bug no vuelva a pasar en silencio — el test con `verifyJWT` mockeado
no lo detecta porque nunca llega a firmar un JWT real.

## QUI-221..226 — resto del núcleo administrativo (M1) — cerrado 2026-07-30

Mismo día que QUI-217/218/220, se completó el resto de M1 en el mismo PR: **QUI-221**
(`/v1/socios`), **QUI-222** (`/v1/vehiculos`), **QUI-223** (`/v1/conductores`), **QUI-224**
(`/v1/lineas`), **QUI-225** (`/v1/lineas/:id/rutas` + variantes + paradas, con geometría
PostGIS) y **QUI-226** (`/v1/rutas/:id/puntos-control`). 55 tests de integración corriendo
contra Postgres real (con RLS activo donde aplica).

**Tenant-scoping real (no solo `admin_quivo`):** a diferencia de sindicatos (QUI-220, único
módulo restringido a `admin_quivo`), socios/vehículos/conductores/líneas los usan también
`admin_sindicato`/`operador`. Cada service resuelve `sindicatoId`: si el actor tiene uno
propio, se lo fuerza sin importar qué mande el body (nunca confiar en el cliente para elegir
de qué tenant es un alta — verificado con test: mandar el `sindicatoId` de otro sindicato en
el body no cuela); si es `admin_quivo` (sin tenant propio), lo toma del body o rechaza con 400.

**QUI-222 — máquina de transiciones de estado para vehículos:** `activo` puede ir a
cualquier otro estado; `inactivo`/`suspendido`/`mantenimiento` solo pueden volver a
`activo` (sin transiciones directas entre esos tres). **Asunción no confirmada por
Producto** — el doc técnico solo lista los 4 estados posibles, no las transiciones válidas;
ajustar en `vehiculos.service.ts` si Producto define otra cosa. También se agregó
`credencialHash` (nullable) al modelo `Vehiculo` para el login por vehículo de M3 (QUI-235)
— solo el campo, sin lógica de login, nunca expuesto en las respuestas del API.

**QUI-225/226 — geometría PostGIS vía SQL crudo:** las columnas `GEOGRAPHY` (`rutas.geometria`,
`paradas.coord`, `puntos_control.coord`) son `Unsupported(...)` en Prisma — el Client normal
ni siquiera expone esos campos, así que todo el CRUD de geometría usa `$queryRaw`/`$executeRaw`
con `ST_GeomFromGeoJSON`/`ST_AsGeoJSON` (GeoJSON in/out por la API, nunca WKT). Dos
validaciones geoespaciales: `ST_IsValid` antes de grabar la geometría de una ruta, y
`ST_DWithin` (100m, **asunción no confirmada por Producto**, en
`common/geo/proximidad-ruta.ts`) para que paradas y puntos de control no puedan crearse lejos
de la geometría de su ruta.

**Tenant-scoping sin RLS propia para rutas/variantes/paradas/puntos_control:** estas tablas
no tienen columna `sindicatoId` directa (la heredan transitivamente vía `lineaId` →
`linea.sindicatoId`), así que QUI-218 deliberadamente no les puso políticas RLS (ver esa
migración). La barrera de tenant vive en el código: `common/geo/tenant-checks.ts` resuelve
toda operación hacia arriba hasta `linea` (que sí tiene RLS) — si no es visible para el
actor, se trata como inexistente (**404, nunca 403** — no revela que el recurso existe en
otro tenant). Variantes y paradas viven dentro de `RutasModule` (no son módulos Nest propios,
así lo agrupaba ya el esqueleto de QUI-214 bajo RF-24..33); `control-points` sí es su propio
módulo (RF-34..39/QUI-226, issue separada).

## QUI-228 — apps/web conectada al API real — cerrado 2026-07-30

Sindicatos, socios, vehículos, conductores y líneas ya no usan `demo-data.ts` — pegan contra
`apps/api` de verdad. Rutas (editor de mapa, QUI-229), rotaciones, reglas y auditoría siguen
en modo demo (sin API real todavía para lo que necesitan). `ModuleTablePage` ahora soporta un
prop `dataSource` opcional (`list`/`create`/`update`) que activa el modo real; sin `dataSource`
sigue funcionando exactamente como antes (`useState` local), así que las páginas que siguen en
demo no cambiaron. **Sin botón de borrar en modo real** — ningún endpoint de M1 expone
`DELETE` (las entidades se desactivan vía `estado`, nunca se borran de la DB).

Los formularios muestran exactamente los campos del contrato real de `@quivo/shared` — se
sacaron los campos inventados de la demo (`ciudad`, conteos de `socios`/`vehiculos` en
sindicatos, nombre de sindicato como texto libre en vez de FK) que no existen en la API.
`admin_quivo` elige el sindicato desde un `<Select>` poblado con `/v1/sindicatos`
(`src/lib/api/use-sindicato-options.ts`, que además resuelve `sindicatoId → nombre` para las
columnas de tabla); `admin_sindicato`/`operador` no ven ese selector — el service ya los
fuerza a su propio tenant sin importar qué mande el formulario.

**Bug real encontrado y arreglado armando esto:** la config de CORS de `apps/api`
(`app.enableCors({ origin })`, sin `methods` explícito) solo dejaba pasar `GET,HEAD,POST` en
`Access-Control-Allow-Methods` — **todo PATCH quedaba bloqueado por el browser** con
`Failed to fetch`, aunque el preflight (OPTIONS) respondiera 204 igual. `curl` nunca lo sufrió
(CORS es una restricción del browser, no del server) por eso pasó desapercibido durante todo
QUI-220..226 hasta que `apps/web` hizo el primer PATCH real desde un browser de verdad. Se
agregó `methods: ['GET','POST','PATCH','PUT','DELETE']` explícito en `main.ts`.

**Verificado en browser real** (Chrome vía automatización, sesión inyectada con un login real
de `admin@quivo.local`, `NEXT_PUBLIC_DEV_BYPASS_AUTH=false` temporalmente): crear y editar un
sindicato, crear un socio con el selector de tenant, y carga correcta de vehículos/
conductores/líneas con el nombre de sindicato resuelto. Nota: durante esta sesión quedaron
sindicatos de prueba huérfanos en la DB local (de corridas de test interrumpidas) que había
que limpiar a mano — si aparecen filas raras tipo "Rutas Test A"/"Paradas Test B" etc. en la
DB local, son de eso, no de datos reales.

## QUI-229 — editor de rutas sobre mapa — cerrado 2026-07-31

M1 (núcleo administrativo) queda **completo de punta a punta**. Reutiliza `RouteMap` del
design system (`~/Proyectos/Web/Design_System_QUIVO`) — que usa **Leaflet, no MapLibre**
(la decisión original del doc técnico §1 nunca se implementó así; se decidió no duplicar
ese trabajo construyendo un componente MapLibre nuevo desde cero cuando uno funcional ya
existía). Se le agregó un prop `zones` (commit aparte en ese repo, **no pusheado
todavía** — solo local) para dibujar círculos a escala real en metros (radio de tolerancia
de un punto de control), distinto de los `stops` (radio fijo en píxeles).

Flujo: elegir línea real → ver/crear rutas de esa línea dibujando la geometría con clicks
sucesivos sobre el mapa → sobre una ruta seleccionada, agregar paradas y puntos de control
con un click + formulario mínimo → variantes como lista simple (sin geometría propia).
Todo contra los endpoints reales de QUI-225/226. **Verificado en browser real**: dibujar y
guardar una ruta de 3 puntos, agregar una parada, y un punto de control — la primera vez
rechazado por "lejos de la ruta" (ST_DWithin del backend funcionando en vivo), aceptado al
clickear más cerca, con el círculo de 30m visible en el mapa.

## QUI-230 (interceptor de auditoría genérico) + QUI-231 (schema rotaciones/asignaciones) — cerrado 2026-07-31

Arranca M2 (Rotaciones, RF-51..57). Plan completo: QUI-230 → QUI-231 → QUI-232 → QUI-233 → QUI-234.

**QUI-230 — `AuditInterceptor` global reemplaza los `auditar()` manuales de QUI-220..226:**
interceptor único (`APP_INTERCEPTOR`) + decorador `@Auditable('entidad')` por método de
controller. Usa `concatMap` (no `tap`) para que el `await` a `audit_log` bloquee la respuesta
— si la auditoría falla, la request falla (fail-loud, no fire-and-forget). Resolución de
`sindicatoId` en el log: el de la propia entidad devuelta → el propio `id` si `entidad ===
'sindicato'` → el del actor como fallback (imprecisión documentada para los 4 módulos de
geometría sin `sindicatoId` propio). Se sumó `GET /v1/auditoria` (`auditoria.service.ts`) con
filtros `entidad`/`accion`/`desde`/`hasta`, protegido por `@Roles('admin_quivo',
'admin_sindicato')` y RLS existente — sin lógica de tenant-scoping propia, RLS ya lo resuelve.

**QUI-231 — `Rotacion` + `Asignacion` (`packages/db/prisma/schema.prisma`):** el constraint
`@@unique([vehiculoId, fecha, horario])` en `asignaciones` es la barrera real contra el riesgo
#12 del doc técnico ("conflicto operativo real en la calle") — un vehículo no puede tener dos
asignaciones el mismo día en el mismo horario sin importar la rotación. `conductorId` nullable
(la rotación puede publicarse con el vehículo asignado y el conductor por confirmar después).
`TurnoSchema` nuevo en `@quivo/shared` (`manana`/`tarde`/`noche` — asunción no confirmada por
Producto, el doc técnico deja `horario` como texto libre). Migración escrita a mano
(`20260731060000_rotaciones_asignaciones`, mismo patrón que el resto de la sesión — `prisma
migrate dev` sigue roto por el gap de PostGIS en la shadow DB desde que existe la primera
columna `Unsupported("geography(...)")`). RLS agregada a `rotaciones` (tiene `sindicatoId`
propio, mismo patrón que socios/vehículos/conductores/líneas); `asignaciones` queda sin RLS
propia a propósito — no tiene `sindicatoId` directo (lo hereda vía `rotacionId →
rotacion.sindicatoId`), mismo caso que rutas/paradas, el tenant-check en código llega con
QUI-232. Test de integración contra Postgres real (`packages/db/src/asignaciones-constraint.test.ts`)
prueba que el constraint rechaza la segunda asignación en conflicto y permite variaciones
válidas (mismo vehículo, mismo día, horario distinto). Seed extendido con una ruta + rotación +
2 asignaciones demo para el Sindicato 1º de Mayo.

## QUI-232 — API de rotaciones (generar/editar/publicar/anular) — cerrado 2026-07-31

`POST /v1/rotaciones` genera un borrador repartiendo **round-robin** los vehículos y
conductores activos del sindicato entre las rutas/fechas/horarios pedidos (`GenerarRotacionSchema`)
— "regla de reparto" no está detallada en el doc técnico más allá de mencionarla, así que
round-robin con mejor esfuerzo es una asunción de este equipo: si el vehículo que le toca en
el turno ya está ocupado esa fecha/horario (por cualquier rotación), se prueba con el
siguiente; si se agotan todos, el slot queda sin cubrir en vez de abortar el resto de la
generación. **Gotcha real encontrado armando esto:** el chequeo de disponibilidad tiene que
ser en memoria _antes_ de insertar, no capturando el error del constraint único — Postgres
aborta la transacción completa apenas falla un statement (`25P02: current transaction is
aborted`), así que intentar seguir insertando después de un `23505` capturado dentro de la
misma transacción de `withTenantContext` no funciona (a diferencia de
`crearAsignacion`/`actualizarAsignacion`, que sí pueden traducir ese error a un 409 porque
cada una corre en su propia transacción y no necesita seguir haciendo más inserts después).

`POST /v1/rotaciones/:id/publicar` y `/anular` son transiciones de estado atómicas
(`borrador` ⇄ `publicada`) — atómicas porque viven dentro de la misma transacción que ya arma
`withTenantContext`, no por lógica extra. "Anular" es una asunción de este equipo: vuelve la
rotación a `borrador` para poder corregirla antes de que la app móvil la consuma, no es un
estado nuevo (`EstadoRotacionSchema` sigue siendo solo `borrador`/`publicada`). Edición manual
de asignaciones (alta/edición/borrado, `POST`/`PATCH`/`DELETE /v1/rotaciones/:id/asignaciones`)
solo mientras la rotación está en `borrador`.

**Extensión al interceptor de auditoría (QUI-230):** `@Auditable('entidad', 'accion')` ahora
acepta un override opcional — `publicar` y `anular` son ambos `POST` por contrato de API
(`docs/documento-tecnico-cto.md` §8) pero no son un alta; sin el override, el interceptor
genérico los etiquetaba como `crear` en `audit_log` (inferido solo del método HTTP), lo cual
es justo lo que pedía el ticket evitar ("Auditoría de publicar/anular"). Verificado en
`audit.interceptor.test.ts`.

Roles con acceso: `admin_quivo`/`admin_sindicato` (no `operador` — asunción de este equipo,
rotaciones es una función de planificación, no de operación diaria, a diferencia del resto de
M1 que sí incluye `operador`). Verificado end-to-end contra el API real (curl): generar un
borrador de 4 asignaciones, publicar, intentar publicar de nuevo (400), anular, y confirmar
en `GET /v1/auditoria?entidad=rotacion` que las 3 acciones (`crear`/`publicar`/`anular`)
quedan bien etiquetadas.

## QUI-233 — web admin: UI de rotaciones — cerrado 2026-07-31

`/rotaciones` deja de ser demo (`useState` local) y pasa a consumir el API real de QUI-232.
Layout igual al de `/rutas` (QUI-229): panel izquierdo con selector de sindicato
(`admin_quivo` únicamente, mismo patrón de `useSindicatoOptions` que socios/vehículos) +
formulario de generación (periodo, rango desde/hasta que se expande a la lista de días,
checkboxes de horarios y de rutas) + lista de rotaciones existentes; panel derecho con la
**grilla vehículo × fecha/horario** que pide el ticket — filas y columnas se derivan de las
asignaciones reales de la rotación seleccionada (no de un catálogo completo de vehículos),
cada celda clickeable abre un `Modal` de edición (ruta/conductor/horario + botón "Quitar")
mientras la rotación esté en `borrador`; publicar/anular usan `ConfirmDialog`. El error 409
de doble-asignación se muestra dentro del modal con el mensaje tal cual lo devuelve el
service (`"Ese vehículo ya tiene una asignación en esa fecha y horario"` — ya es lenguaje
llano de por sí, no necesitó traducción adicional en el frontend, que era el criterio de
aceptación del ticket).

**Bug real encontrado y arreglado armando esto:** `apiFetch` (cliente HTTP compartido,
`apps/web/src/lib/api/client.ts`) mandaba `Content-Type: application/json` en **toda**
request, incluidos los `POST /v1/rotaciones/:id/publicar`/`/anular` que no llevan body —
Fastify rechaza esa combinación con 400 (`"Body cannot be empty when content-type is set to
'application/json'"`). No había aparecido antes porque QUI-228/229 solo hicieron `POST`s con
body real. Fix: el header solo se manda si `init.body` está definido — afecta a cualquier
futuro endpoint sin body, no solo a rotaciones.

**Verificado en browser real** (mismo método que QUI-228/229: `next build && next start`
para que `NODE_ENV=production` desactive el bypass de dev automáticamente, sesión real de
`admin@quivo.local`): generar un borrador de 4 asignaciones (1 vehículo × 2 fechas × 2
horarios), editar una celda a un horario ya ocupado por el mismo vehículo y ver el error 409
en línea, publicar (badge cambia a verde "publicada", desaparecen los controles de edición),
y anular (vuelve a "borrador").

## QUI-234 — vencimiento de asignaciones por jornada (RF-57) — cerrado 2026-07-31, M2 completo

Job **BullMQ repeatable** (cada 5 min, `upsertJobScheduler` — idempotente entre reinicios,
no acumula schedulers duplicados) que marca `vencida` toda asignación `vigente` cuya
`venceAt` ya pasó. Nueva columna `Asignacion.estado` (`vigente`/`vencida`, default
`vigente`) + índice `(estado, venceAt)` para esa query.

**Bug real encontrado escribiendo los tests de borde de zona horaria que pedía el ticket:**
`venceAt` (QUI-232) se calculaba como `23:59:59 UTC` del mismo `fecha` — pero Bolivia es
**UTC-4 sin horario de verano** (único mercado del MVP), así que eso vencía una asignación
a las 19:59:59 hora local, **4 horas antes de lo real**. Nuevo helper
`apps/api/src/common/tiempo/jornada.ts` (`finDeJornadaBolivia`) calcula el instante UTC
correcto (03:59:59 del día siguiente al `fecha`) — 5 tests de borde (cambio de mes, de año,
29 de febrero de un bisiesto, "sin DST") lo verifican.

**Redis local desbloqueado:** el puerto 6379 lo tenía tomado otro proyecto de esta máquina
(`quivo-control-redis-1` no podía publicar su puerto) — bloqueo que venía arrastrándose
desde el plan inicial de M2. Redis de este proyecto ahora corre en el puerto host **6380**
(`docker-compose.yml`, `.env.example`, `.env` local), mismo patrón que el 5434 de Postgres.
De paso, `pnpm-workspace.yaml` necesitó aprobar el build script de `msgpackr-extract`
(dependencia nativa opcional de `bullmq`/`ioredis`) que pnpm empezó a ignorar por default.

**Fuera de alcance (documentado, no una decisión de Producto):** "API de consulta solo
devuelve vigentes" del ticket se refiere al futuro `GET /v1/mobile/asignacion-del-dia`
(RF-73, módulos `tracking`/`sync`, M3, QUI-240/241) — no existe todavía, así que no hay nada
que filtrar hoy. Los endpoints admin (`GET /v1/rotaciones*`, QUI-232/233) siguen devolviendo
**todas** las asignaciones con su `estado` visible en la respuesta — la UI de rotaciones
necesita ver el historial completo para poder editar/republicar, no solo lo vigente; filtrar
ahí habría roto esa pantalla. Verificado en vivo: la API arranca con Redis en 6380
(`"redis":"up"` en `/v1/health`) y el job corre al boot sin errores.

**M2 — Rotaciones (RF-51..57) queda completo:** QUI-230 (interceptor de auditoría genérico)
→ QUI-231 (schema + constraint anti doble-asignación) → QUI-232 (API generar/editar/
publicar/anular) → QUI-233 (UI web, grilla vehículo×fecha) → QUI-234 (vencimiento, este).

## M4 — dashboard/reglas/reportes: arrancado 2026-07-31

M3 (app móvil + offline + sync, RF-58..73) sigue bloqueado por recursos físicos que nadie
consiguió todavía (licencia Transistorsoft + Android real de gama baja, QUI-216). M4 no
depende de eso, así que se sigue por ahí: QUI-248 (auditoría) → QUI-244 (reglas/sanciones,
modelo+API) → QUI-245 (UI reglas/sanciones). QUI-246/247/249 (dashboard de cumplimiento,
reconstrucción de recorridos, reportes operativos) sí necesitan datos reales de
`gps_points`/sesiones que solo existen una vez que M3 esté armado — quedan para después.

## QUI-248 — web admin: auditoría con filtros — cerrado 2026-07-31

`/auditoria` deja de ser demo y consume `GET /v1/auditoria` (QUI-230) de verdad. Filtros por
entidad/acción/usuario/rango de fecha (se sumó `usuarioId` al `AuditoriaQuerySchema` y al
service — QUI-230 solo tenía entidad/acción/fecha). Tabla vía el componente `AuditLog` del
design system; cada fila tiene un botón "Ver diff" que abre un `Modal` con el diff completo
formateado (JSON pretty-printed) — alcanza para "legible" sin necesitar reconstruir un
`{antes, cambios}` estructurado (mismo criterio de simplicidad que QUI-230 ya había asumido).
Verificado en browser real: filas reales de `audit_log` cargando, modal de diff abriendo con
el contenido correcto (incluida una fila vieja pre-QUI-230 con el shape `{antes, cambios}`
de cuando la auditoría todavía era manual en cada service — se muestra tal cual está en la
DB, sin normalizar formatos históricos).

## QUI-244 — reglas y sanciones: modelo + API + transiciones — cerrado 2026-07-31

`Regla` (estatutos: nombre/tipo/gravedad/aplicaA/descripcion/estado) y `Sancion` (sujeto
polimórfico `vehiculo`/`conductor`/`socio` sin FK — mismo patrón que `AuditLog.entidadId`).
El doc técnico deja el modelo muy comprimido (`estatutos/reglas(id, sindicato_id, tipo,
gravedad, aplica_a, relacion)`) — se agregaron `nombre`/`descripcion` por usabilidad admin y
`gravedad` (`leve`/`grave`/`gravisima`) como asunciones de este equipo, no confirmadas por
Producto. RLS en ambas tablas (tienen `sindicatoId` propio, mismo patrón que rotaciones).

**Máquina de transiciones de `Sancion`** (el doc técnico solo lista los 5 estados —
`pendiente`/`aplicada`/`anulada`/`apelada`/`pagada` — sin definir las transiciones válidas
entre ellos, así que esto es una asunción de este equipo, mismo criterio que las
transiciones de vehículos de QUI-222):

```
pendiente → aplicada | anulada
aplicada  → apelada | pagada | anulada
apelada   → aplicada | anulada
pagada, anulada → (terminales)
```

Endpoints dedicados `POST /v1/sanciones/:id/{aplicar,anular,apelar,pagar}` (no un PATCH de
estado genérico), todos auditados con el override de acción de `@Auditable` (mismo mecanismo
de QUI-232). Edición (`PATCH /v1/sanciones/:id`) restringida a `motivo`/`evidenciaRef` y solo
mientras está `pendiente`.

**Límite conocido, documentado:** "evidencia = datos de recorrido auto-vinculados" (doc
técnico §15.5) necesita tracking real (M3: sesiones, `gps_points`, `cumplimientos_pc`), que
esta sesión no llegó a construir — `evidenciaRef` queda como texto libre que carga quien
registra la sanción, sin auto-vinculación todavía.

**Nota de consistencia de API:** `CrearReglaSchema`/`CrearSancionSchema` exigen `sindicatoId`
en el body (no opcional) — se alinearon con el patrón mayoritario de
vehículos/líneas/socios/conductores (el frontend lo autocompleta vía `createDefaults`,
`admin_quivo` lo elige en un `<Select>`), no con el patrón de `GenerarRotacionSchema`
(QUI-232) que lo dejó opcional. Ambos patrones funcionan (el service igual fuerza el tenant
real vía `resolverSindicatoId`), pero para evitar que conviva un tercer estilo, QUI-244 usa
el más extendido en la base de código.

Verificado end-to-end contra el API real (curl): crear regla → crear sanción (`pendiente`) →
aplicar → pagar → confirmar que `pagada` es terminal (`anular` devuelve 400).

## QUI-245 — web admin: UI de reglas y sanciones — cerrado 2026-07-31

`/reglas` deja de ser demo. Dos pestañas (`Tabs` del design system) sobre el mismo layout:
**Reglas** reutiliza `ModuleTablePage` con `dataSource` real (mismo patrón que
vehículos/líneas, QUI-228) — CRUD simple, sin lógica propia. **Sanciones** es una vista a
medida (mismo criterio que rotaciones, QUI-233): filtros por estado/regla, tabla con botones
de transición que cambian según el `estado` actual de cada fila (p. ej. `pendiente` muestra
Aplicar/Anular; `aplicada` muestra Apelar/Marcar pagada/Anular), cada transición con
`ConfirmDialog`, y un modal de alta con selector de sujeto dependiente del `sujetoTipo`
elegido (vehículo/conductor/socio).

**Bug real encontrado y arreglado armando esto:** `fechaHecho` es una fecha "pura" (guardada
como medianoche UTC), pero `toLocaleDateString('es-BO')` sin fijar `timeZone: 'UTC'` usa la
zona horaria del browser para convertir — en cualquier navegador al oeste de UTC (incluida
Bolivia, UTC-4) esto corre la fecha mostrada un día para atrás. Se vio en vivo: una sanción
con `fechaHecho: 2026-08-01` se mostraba como "31/7/2026" hasta forzar `timeZone: 'UTC'` en
el formateo. El campo `ts` de auditoría (QUI-248) no tiene este problema — es un timestamp
real, no una fecha pura, así que mostrarlo en hora local del browser es lo correcto ahí.

Verificado en browser real (Chrome, sesión `admin_quivo`): crear una regla con el selector de
sindicato, cambiar a la pestaña Sanciones, crear una sanción, aplicarla (con confirmación), y
confirmar que los botones de acción cambiaron correctamente a los de una sanción `aplicada`.

**M4 sigue así:** QUI-246 (dashboard de cumplimiento), QUI-247 (reconstrucción de
recorridos) y QUI-249 (reportes operativos) necesitan datos reales de `gps_points`/sesiones
que solo van a existir con M3 armado — quedan pendientes hasta que se resuelva el bloqueo de
hardware de QUI-216 (licencia Transistorsoft + Android real).

## Repaso M1-M4 (a pedido explícito, tras cerrar M2 y la parte de M4 sin M3) — 2026-07-31

Con M2 y la parte de M4 independiente de M3 cerradas, se hizo un repaso completo de todo lo
construido buscando huecos en vez de seguir a QUI-251 (que es un gate de pre-release, tiene
más sentido correrlo una sola vez cerca del release real, no ahora). Encontrado y corregido:

- **Bug real: el dashboard (`/`) seguía mostrando datos de `demo-data.ts`** (sindicatos/
  vehículos/conductores/socios de ejemplo) — nadie lo había migrado a las APIs reales al
  cerrar QUI-220..224, a pesar de ser la primera pantalla que ve cualquier admin. Ahora pega
  contra las 4 APIs reales; "sin socio asignado" se calcula de `socioId == null` (no de un
  `estado` que no existe en el modelo real); la tarjeta "Sindicatos activos" queda oculta
  para `admin_sindicato`/`operador` (no pueden llamar `GET /v1/sindicatos`, QUI-220 es
  `admin_quivo`-only). `src/lib/demo-data.ts` quedó huérfano y se borró.
- **Documentación desactualizada** en dos lugares: `apps/api/src/modules/README.md` seguía
  marcando "esqueleto" a 10 módulos que llevan sesiones enteras siendo reales (nunca se
  actualizó módulo por módulo); `apps/web/README.md` describía un modo demo (`ModuleTablePage`
  sin `dataSource`) que ya ninguna página usa. Ambos corregidos para reflejar el estado real.
- **Asimetría de API real: `variantes` (QUI-225) no tenía `GET /v1/variantes/:id`**, a
  diferencia de paradas/puntos-control/rutas que sí lo exponen — agregado
  service+controller+test siguiendo el mismo patrón (tenant-check vía `asegurarRutaVisible`).
- **`seed.ts` no tenía datos de ejemplo de reglas/sanciones** (QUI-244, llegó después del
  último seed) — agregada una regla + una sanción `pendiente` para el Sindicato 1º de Mayo.
- `/reportes` tenía un subtítulo desactualizado ("el dashboard real llega en M4" — ya estamos
  en M4 con partes reales) — corregido para nombrar específicamente QUI-246/249 como lo
  bloqueado, y por qué (necesitan datos de tracking que solo van a existir con M3).

**Encontrado pero deliberadamente NO implementado (para no salirme de "buscar huecos" hacia
"construir features nuevas" sin que se pida):** la mitad de QUI-249 (reportes operativos)
podría hacerse hoy sin M3 — "sanciones por sujeto/estado" ya tiene datos 100% reales
(QUI-244), a diferencia de "recorridos por periodo" que sí necesita tracking. Si se quiere
adelantar esa parte de QUI-249, es una decisión de alcance a tomar explícitamente, no algo
que se coló en este repaso.

## QUI-251 — Auditoría RLS + security review pre-release — cerrado 2026-07-31

Alcance del ticket: RLS en todas las tablas (M1-M4), test cross-tenant extendido, auth
(expiración/refresh), rate limiting, manejo de secrets, dependency audit, superficie de API.

**Encontrado y corregido (huecos reales):**

1. **No había rate limiting en ninguna parte de la API** — `/v1/auth/login` aceptaba fuerza
   bruta ilimitada por IP. Agregado `@nestjs/throttler`: límite global 100 req/min/IP, y uno
   mucho más estricto en `login` (5/min) vía `@Throttle`. Verificado en vivo: 6º intento de
   login devuelve `429`, `/v1/health` no se ve afectado (usa el límite general).
2. **"Cerrar sesión" no revocaba nada server-side** — `auth-context.tsx`'s `logout()` solo
   borraba `localStorage`; un `refreshToken` robado seguía siendo válido hasta su expiración
   natural (hasta 30 días) aunque el usuario ya hubiera "cerrado sesión". Nuevo
   `POST /v1/auth/logout` (`auth.api.signOut` de Better-Auth, revoca la fila real en
   `session`) + wiring del frontend (best-effort: si la API no responde, igual limpia la
   sesión local). Verificado tres formas: test de integración contra Better-Auth real
   (`auth.service.test.ts`), curl+conteo de filas en `session` antes/después, y click real
   en el botón (confirmado en los logs del server, aunque la extensión de Chrome reportó un
   503 fantasma que no coincidía con los logs reales del server — ver nota abajo).
3. **Next.js tenía 8 CVEs conocidos** (DoS/SSRF en Server Actions, SSRF en rewrites, DoS en
   Image Optimization con SVG, cache confusion) — verificado que ninguno aplica de verdad
   (esta app no usa Server Actions, no tiene `rewrites` custom, y su único `next/image` es un
   logo estático `.webp`, no SVG ni URL dinámica), pero se bumpeó igual a `15.5.22`
   (>=15.5.21 = parcheado) porque es un patch del mismo minor, sin riesgo.
4. **La matriz de roles por controller nunca quedó como test automático** — solo se había
   verificado a mano con curl (QUI-220..226). Nuevo `roles-matrix.test.ts` lee la metadata
   real de `@Roles(...)` de los 17 controllers vía `Reflect.getMetadata` y la compara contra
   la matriz documentada — si alguien afloja un rol sin querer, este test es el primero en
   romper.
5. **El test canónico de RLS cross-tenant (`packages/db/src/rls.integration.test.ts`,
   QUI-218) nunca se extendió a las tablas de M2/M4** — cubría sindicatos/socios/vehículos/
   conductores/líneas pero no `rotaciones`/`reglas`/`sanciones` (llegaron después). Ya
   tenían cobertura cross-tenant a nivel de sus propios módulos, pero no en el archivo que
   es la prueba canónica "RLS es la barrera real, no el código de arriba". Extendido con 5
   casos más (14 en total).

**Evaluado y confirmado que NO aplica (dependency audit, `pnpm audit --prod`):**

- **`better-auth` tiene un CVE crítico y varios altos** — todos son de plugins que esta app
  no usa (OAuth, OIDC provider, organization, admin, anonymous, SCIM, magic-link, email-OTP;
  `packages/db/src/auth.ts` solo tiene `emailAndPassword` + `bearer` + `jwt`). No existe un
  1.4.x parcheado (1.4.22 es el último de esa línea) — subir a 1.6.x rompería la
  compatibilidad con `@better-auth/cli` ya documentada. Riesgo real hoy: ninguno, dado el uso
  actual — **re-evaluar si alguna vez se habilita un plugin nuevo de Better-Auth**.
- **`drizzle-orm`, `@xmldom/xmldom`, `tar`, `postcss`, `brace-expansion` (vía
  `better-auth>drizzle-orm>expo-sqlite>expo>@expo/cli>...`)** — better-auth declara
  `drizzle-orm` como dependencia real (adapter opcional que este proyecto no usa, Prisma es
  el único ORM acá) y `drizzle-orm` a su vez arrastra el toolchain de `@expo/cli` como
  dependencia de UNO de sus muchos adapters posibles. Código muerto: ninguna de esas rutas
  se ejecuta nunca en este repo. Mismo origen para el `tar`/`postcss`/`brace-expansion` que
  aparecen vía `apps/mobile`'s propias devDependencies de Expo (tooling de build, no corre
  en el dispositivo final).
- **`find-my-way` (router de Fastify): DDoS vía HTTP2** — HTTP2 no está habilitado en
  `FastifyAdapter` (`apps/api/src/main.ts`), así que no es explotable con la config actual.
  Fastify mismo sigue fijando `find-my-way@9.6.0` internamente incluso en su versión más
  nueva (9.7.0 ya está parcheado y coexiste en el lockfile vía otra dependencia) — no hay
  override limpio sin arriesgar el comportamiento de ruteo interno de Fastify para un riesgo
  que hoy es cero.
- **`sharp` (CVEs de libvips heredadas)** — vía `next`'s Image Optimization opcional; esta
  app no procesa imágenes de usuarios ni URLs externas, solo el logo estático del branding.
- **`@opentelemetry/core` (memoria sin límite en W3C Baggage)** — vía `@sentry/node`
  (`apps/api`), ya en su última versión 8.x disponible (8.55.2); no hay nada más para
  actualizar hasta que Sentry libere un fix upstream. Exposición baja: requiere headers
  `baggage` controlados por el atacante Y `SENTRY_DSN` configurado.

**Confirmado correcto, sin hallazgos:**

- RLS habilitado+forzado exactamente en las 8 tablas con `sindicatoId` propio
  (`sindicatos`/`socios`/`vehiculos`/`conductores`/`lineas`/`rotaciones`/`reglas`/
  `sanciones`), ausente donde corresponde (tablas de Better-Auth, `rutas`/`variantes`/
  `paradas`/`puntos_control`/`asignaciones` con tenant-check transitivo en código) —
  verificado consultando `pg_class.relrowsecurity`/`relforcerowsecurity` directo en Postgres.
- Los 17 controllers de negocio tienen `JwtAuthGuard`+`RolesGuard`; solo `/v1/health` y
  `/v1/_internal/ping` quedan públicos, a propósito (liveness/readiness, sin datos).
- Sin secrets committeados (`.gitignore` cubre `.env*` con excepción explícita de
  `.env.example`); `JWT_SECRET` se referencia una sola vez, nunca se loggea.
- CORS con origen explícito (no wildcard) y métodos explícitos (sin `credentials`, no hace
  falta — la app usa Bearer, no cookies cross-origin).

**Nota metodológica:** al verificar el logout en un browser real, la extensión de Chrome
usada para automatizar reportó un `503` en la request a `/v1/auth/logout`, pero los logs
reales del server (pino, en `apps/api`) mostraban `204` para esa misma request tanto en
tiempo como en `requestId`. Se verificó de forma independiente contando filas en la tabla
`session` antes/después de un login+logout real vía curl: 47→48→47, confirmando que el
`503` fue un artefacto de la herramienta de automatización (probablemente por la
navegación de SPA disparándose mientras el fetch fire-and-forget seguía en vuelo), no un
fallo real del servidor. Vale la pena recordar esto si alguna vez se ve una discrepancia
similar entre lo que reporta el browser automatizado y lo que dicen los logs del server —
los logs del server son la fuente de verdad.

## Autenticación operativa móvil + identidad QUIVO — cerrado 2026-08-01

`apps/mobile` ya compone el flujo vehículo -> chofer -> operación con componentes nativos
basados en el Design System QUIVO. La sesión y el identificador de instalación viven en
SecureStore; reiniciar el proceso recupera el contexto y lo reconcilia con la API. El
GPS/outbox previo se conserva detrás de una sesión autenticada y ahora etiqueta eventos con
`sesionId`/`deviceId`.

El módulo `apps/api/src/modules/auth-movil` usa desafío corto de un solo uso y tokens
access/refresh opacos; Postgres guarda sólo hashes. La línea se deriva de
`asignacion -> ruta -> linea`. Refresh rota ambos tokens, logout revoca y un cambio de PIN
invalida desafíos/sesiones relacionadas con auditoría libre de credenciales. Los endpoints
y el modelo final están en `docs/plan-auth-movil-quivo.md`.

Verificado en `Pixel_10_Pro`: APK debug instalado, bundle Metro HTTP 200, ambos pasos de
login contra API LAN, contexto completo y restauración tras cold start. El logger Pino fue
endurecido globalmente para eliminar Authorization/cookies. El monorepo completo pasó
typecheck, lint, tests y build. El gate pendiente de licencia/hardware corresponde al
tracking GPS productivo, no al login/contexto móvil.

## PR #2 — vendorizar design system + CI verde — cerrado 2026-08-14

El PR #1 (`qui-227-web-nextjs-scaffold`, todo lo documentado arriba desde M0 hasta la
autenticación móvil) se mergeó a `main` el 2026-08-14, pero **nunca había pasado un CI verde**:
las 8 corridas de la historia del repo, incluida la del propio merge, fallaban en el paso
*Typecheck* con 136 errores. Causa raíz única: `apps/web/package.json` dependía de
`@quivo/design-system` vía `link:` hacia un repo hermano (`Design_System_QUIVO`), y ese repo
se perdió junto con el acceso a la máquina donde vivía. Se buscó exhaustivamente antes de
reconstruir nada: no está en la organización de GitHub (`Quivo-enterprise/Quivo-UI-UX` existe
pero está vacío), no está en la cuenta personal del CTO, no está en ningún checkout local de
`Quivo-control` (los 3 tienen el mismo symlink colgado), nunca estuvo en el historial de git
de este repo, y la caché de Turbo no tiene ningún `turbo-build` de `apps/web` del que extraer
el CSS/JS compilado. Diagnóstico y evidencia completos en
[`docs/plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md).

1. **`@quivo/design-system` reconstruido como workspace del monorepo
   (`packages/design-system`).** No es un rediseño: la API, los ~30 tokens `--qv-*` y las
   ~13 clases `qv-*` se derivaron leyendo cada uno de los 25 archivos de `apps/web` que
   consumían el paquete (21 componentes en total — `AdminLayout`, `DataTable`, `RouteMap`,
   `Select`, `DatePicker`, etc.). `apps/web/package.json` solo cambió el `link:` externo por
   `workspace:*`; los imports de la app quedaron intactos. Esto solo llevó el typecheck de
   **136 errores a 0** (22 `TS2307` de módulo no encontrado más 114 derivados de perder la
   inferencia de tipos sin el paquete). Se descartó migrar a shadcn/ui: habría obligado a
   reescribir los 25 consumidores además del paquete nuevo, con más riesgo y sin resolver
   nada que la reconstrucción no resolviera ya.

2. **Bug de SSR en `RouteMap`:** el barrel de `packages/design-system` reexporta todo junto,
   así que el import estático de Leaflet a nivel de módulo se arrastraba a cualquier página
   que importara cualquier otro componente del design system — incluidas `/login` y
   `/conductores`, que ni siquiera tienen mapa — y rompía en SSR con `window is not defined`.
   `RouteMap` ahora es un wrapper client-only que carga la implementación real
   (`route-map-impl.tsx`) con `lazy()` recién después del mount.

3. **`Map container is already initialized`:** `/rutas` no cargaba en `next dev`. No era solo
   el doble-mount de Strict Mode: `MapContainer` de `react-leaflet@4.2.1` crea el mapa dentro
   de un ref callback cuyo `context` capturado queda `null` para siempre, y lo destruye en un
   efecto que depende de ese mismo `context` — el cleanup **nunca corría** y los mapas se
   acumulaban con sus listeners. Se reemplazó por un contenedor propio
   (`route-map-impl.tsx`) que maneja el ciclo de vida con cleanup real y publica el contexto
   con `LeafletProvider` (API pública de `@react-leaflet/core`). Dato técnico a recordar: el
   App Router de Next 15 corre su propio **React 19** internamente aunque `package.json` fije
   18.3.1, y es el doble-invoke de React 19 (que además desata y reata refs) el que dispara el
   fallo.

4. **RLS multi-tenant: los tests nunca habían probado nada.** Turbo corre en `envMode: strict`
   y `turbo.json` solo declaraba `DATABASE_URL` en `globalPassThroughEnv`, así que
   `RUNTIME_DATABASE_URL` se filtraba del entorno del proceso de test. `packages/db/src/client.ts`
   caía **en silencio** al fallback `?? DATABASE_URL`, que apunta al rol `quivo` (superusuario
   con `BYPASSRLS`) — Postgres ignora RLS para ese rol, y los 12 tests de aislamiento
   fallaban. Reproducido: `turbo run test --filter=@quivo/db` da 12 fallos; el mismo comando
   con `--env-mode=loose`, contra la misma base y en el mismo instante, da 17/17. **Las
   políticas en sí estaban bien** — las 15 tablas tienen `FORCE ROW LEVEL SECURITY`, las 15
   policies `tenant_isolation` existen y `quivo_app` no es superusuario ni tiene `BYPASSRLS`.
   Se declararon las variables (`RUNTIME_DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`,
   `BETTER_AUTH_URL`, `NODE_ENV`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`) en `env` de la tarea
   `test` de `turbo.json` (no en `globalPassThroughEnv`, para que entren al hash de caché:
   cambiar de base ahora invalida la caché en vez de replayear un resultado obtenido contra
   otra conexión). `client.ts` ahora **falla ruidosamente** fuera de `development` si falta
   `RUNTIME_DATABASE_URL`, en vez de degradar; y `rls.integration.test.ts` verifica primero
   como quién está conectada y aborta si detecta superusuario o `BYPASSRLS`, para que este
   tipo de falso-verde no pueda volver a pasar inadvertido.

   **Riesgo de despliegue que queda abierto, fuera del código:** no hay ningún manifiesto de
   deploy en el repo (`Dockerfile`, `fly.toml`, `render.yaml`). Antes de este fix, un entorno
   que olvidara `RUNTIME_DATABASE_URL` arrancaba la API sin ningún aviso con el aislamiento
   entre sindicatos apagado; con el fix ahora falla al arrancar, lo cual es mejor pero no
   elimina el riesgo — **hay que verificar si existe algún entorno ya desplegado y si tiene
   esa variable seteada**. Se agrava porque
   `apps/api/src/modules/socios/socios.service.ts:33` hace `findUnique({ where: { id } })`
   sin filtrar por `sindicatoId`, apoyándose en RLS como única barrera. Pendiente explícito,
   no resuelto en este PR.

5. **Seed en CI:** 4 tests de auth fallaban con 401 porque corren contra Better-Auth real con
   usuarios del seed (`admin@quivo.local`), y el job migraba la base pero nunca la sembraba.
   Se agregó el paso `Seed database`/`Seed acceptance data` al workflow.

6. **Cliente Prisma y caché de Turbo:** `@quivo/db:build` es `prisma generate && tsc`, pero
   `turbo.json` solo declara `dist/**` como output — el cliente que genera Prisma se escribe
   en `node_modules/.pnpm/@prisma+client@…/node_modules/.prisma`, que no se cachea. Con cache
   hit, Turbo restauraba `dist/` sin volver a ejecutar el comando, así que el cliente nunca se
   escribía y el seed explotaba con `"The requested module '@prisma/client' does not provide
   an export named 'PrismaClient'"`. **El pipeline solo había funcionado hasta ahora con
   caché fría.** Fix: `prisma:seed` corre `prisma generate` primero (se prefirió esto sobre
   agregar un paso al workflow porque protege también a cualquiera que corra el seed en local
   tras borrar `node_modules` o cambiar de rama, no solo a CI).

7. **Job `acceptance` (Playwright) agregado al pipeline.** `playwright.config.ts` y los 3
   tests de `tests/acceptance/admin-panel.spec.ts` ya existían en el repo pero no corrían en
   ningún workflow. El job nuevo corre con `needs: ci` y sube el reporte de Playwright como
   artifact si falla.

8. **`/code-review high`: 11 hallazgos, los 11 aplicados.** El más grave: el efecto de foco de
   `BaseDialog` dependía de `onClose`, recreado en cada render por todos los call sites — así
   que **cada tecla robaba el foco al input** y no se podía escribir más de un carácter en
   ningún modal de alta o edición. El callback pasa ahora a un `ref`, el foco solo se mueve en
   la transición de apertura. También: fallbacks de color `var(--qv-color-primary)` en
   atributos de presentación SVG de Leaflet, donde `var()` no se sustituye (las polilíneas se
   dibujaban invisibles — ahora usan un hex literal); `ColorPicker` que mostraba un color
   mientras almacenaba `''`; `Select` no operable con teclado ni con `role="combobox"`; y 10
   clases que se renderizaban sin estilo.

9. **Ramas borradas del remoto:** `qui-227-web-nextjs-scaffold`, `feat/mobile-ui-valentina` y
   `feat/mobile-ui-sprint-valentina`, las 3 verificadas con `git merge-base --is-ancestor` como
   100% mergeadas antes de borrarlas — ninguna tenía un commit propio pendiente de integrar.
   Solo queda `main` en el remoto. Estado y evidencia completos por rama en
   [`docs/ramas-sprint-m6.md`](ramas-sprint-m6.md).

**Patrón que vale la pena dejar escrito:** los puntos 3 a 6 comparten una misma causa de fondo
— **el CI nunca había pasado del paso `Typecheck`**, así que ni los tests unitarios, ni los de
RLS, ni los de aceptación se habían ejecutado jamás en un pipeline real. Arreglar el
typecheck no destapó "el" siguiente problema sino una serie: cada capa que por fin corría
revelaba la siguiente que tampoco había corrido nunca. Un pipeline que nunca fue verde no es
un pipeline — es, en el mejor de los casos, un linter.

**Otros pendientes que quedaron registrados en esta sesión, sin resolver:**

- **Branch protection en `main` sigue siendo imposible**: `gh api .../branches/main/protection`
  devuelve `403 Upgrade to GitHub Pro` — el repo es privado en plan free. El criterio de
  aceptación de QUI-212 no se puede cumplir sin cambiar de plan (hacerlo público quedó
  descartado).
- **Entorno local**: Turbo no propaga el `.env`, hay que exportar las variables a mano antes
  de correr comandos sueltos; la máquina del CTO tiene Node v24 mientras el repo pide
  `>=22 <23` (`npm_config_engine_strict=false` como workaround solo local — CI usa `.nvmrc` y
  está bien).
- **`test:acceptance:prepare`** hace `. apps/api/.env`, un archivo que no existe ni en local
  ni en CI — el script fallaría con `set -e` si algo lo invoca. Sin investigar todavía.
- **Riesgo latente de orden en el workflow de CI**: el paso `Test` depende implícitamente de
  que `Seed database` haya corrido antes y haya dejado el cliente Prisma escrito en disco.
  Funciona hoy por el orden de los pasos, no por una garantía estructural del workflow.

**Verificación de este PR:** clon limpio + `pnpm install && pnpm typecheck && pnpm test &&
pnpm build` sin ninguna ruta fuera del repo; `gh run list --limit 1` → primera corrida
`success` de la historia; `pnpm test:acceptance` (Playwright) verde en CI; `git branch -a` →
solo `main` en remoto.

## Pendientes de acceso

- **Repo `Design_System_QUIVO` (antes sibling en `~/Proyectos/Web/Design_System_QUIVO`): se
  perdió, no se recuperó, y ya no es una dependencia externa.** Este documento registraba acá
  un commit local sin pushear (`zones` de `RouteMap`, QUI-229) sobre ese repo — la máquina
  donde vivía dejó de estar disponible antes de poder pushearlo, y una búsqueda exhaustiva
  (organización de GitHub, cuenta personal del CTO, los 3 checkouts locales de
  `Quivo-control`, el historial completo de git, la caché de Turbo) confirmó que el fuente no
  existe en ningún lado. Se reconstruyó desde cero como `packages/design-system` dentro de
  este monorepo (PR #2, 2026-08-14), derivando la API por fidelidad de cada sitio de uso en
  `apps/web` — incluida la prop `zones` que este documento pedía no perder, ya incorporada en
  `route-map-impl.tsx`. `apps/web` ya no depende de ningún repo externo vía `link:`; el
  paquete es `workspace:*` y vive versionado en este mismo repo. Detalle completo en la
  sección "PR #2 — vendorizar design system + CI verde" arriba.
- **Push a GitHub:** ✅ resuelto (2026-07-30), sigue así.
- **`gh` CLI:** ✅ instalado y operativo en este entorno — se usó para diagnosticar el bloqueo
  de CI (`gh run list`), verificar los PRs (`gh pr view`) y confirmar branch protection. Único
  bloqueo que persiste: **branch protection en `main` sigue siendo imposible**, no por falta
  de `gh` sino porque `gh api .../branches/main/protection` devuelve `403 Upgrade to GitHub
  Pro` — el repo es privado en plan free. El criterio de aceptación de QUI-212 no se puede
  cumplir sin cambiar de plan (hacer el repo público quedó descartado).
- **Infra cloud real (QUI-213):** sin aprovisionar. **Actualizado el 2026-08-14:** la cuenta
  de GCP se reactivó y el destino ahora es GCP, así que el ADR
  `docs/adr/0001-railway-vs-flyio.md` quedó **obsoleto** — hay que reescribirlo o anularlo.
  Solo el `docker-compose.yml` local está listo.
- **Spike GPS físico (QUI-216): ✅ desbloqueado el 2026-08-14.** El **dispositivo ya se
  consiguió**, y la **licencia nunca fue un prerequisito real** — Transistorsoft es funcional
  en builds debug sin key y ofrece trial de 30 días para release; el paso 1 de
  `docs/spike-gps.md` está mal escrito y hay que corregirlo. Lo que sí falta antes de correr
  el spike: migrar a Expo SDK 54 + Transistorsoft v5 y arreglar los tres bugs de
  configuración. Ver "GPS y migración de Expo SDK" al final.

## Estado del roadmap (Linear, 2026-08-14)

> ⚠️ **Foto congelada el 2026-08-14 — desactualizada.** Los porcentajes y los milestones vencidos
> de esta tabla no reflejan el trabajo posterior (PRs #23 a #37, el despliegue de la v2 y las dos
> jornadas de piloto). Se conserva como registro de cómo se veía el roadmap ese día. Para el
> estado real hay que mirar Linear, no esta tabla.
>
> Al 2026-08-18, Linear tiene **208 issues abiertos**, de los cuales ~49 (QUI-147 a QUI-189) son
> ruido histórico: sin asignado, sin prioridad, congelados desde el 2026-04-06 y con títulos de
> una landing page genérica que no tiene relación con este producto. Alguien empezó a purgarlos el
> 2026-08-04 (33 cancelados) y dejó la otra mitad. Conviene terminar esa limpieza: distorsionan
> cualquier lectura del backlog.

Con `main` verde, el bloqueo que frenaba a cualquiera de clonar y trabajar el repo quedó
resuelto. Estado por milestone (64 issues / 248 pts, ~73% completado por puntos):

| Milestone                    | Target                      | Progreso | Qué falta                                                          |
| ----------------------------- | ---------------------------- | -------- | -------------------------------------------------------------------- |
| M0 Fundaciones + Spike GPS    | 2026-08-10 ❌ **vencido**     | 63,9%    | QUI-216 (gate GPS, Urgent), QUI-213 (infra)                          |
| M1 Núcleo administrativo      | 2026-08-30                   | 100%     | —                                                                     |
| M2 Rotaciones                 | 2026-09-13                   | 100%     | —                                                                     |
| M3 App móvil + sync           | 2026-10-18                   | 81,8%    | QUI-237 (tracking GPS producción, Urgent, en Backlog sin ciclo)      |
| M4 Dashboard/reglas/auditoría | 2026-11-08                   | 100%     | —                                                                     |
| M5 Hardening + piloto         | 2026-11-20                   | 41,1%    | QUI-250 (k6), QUI-252 (retención), QUI-253 (piloto) — las 3 en curso |
| M6 Sprint UI/UX Mobile        | 2026-08-10 ❌ vencido         | 97,6%    | resto en el roadmap nuevo de Valentina, ver abajo                    |

**Camino crítico, en orden** (reordenado el 2026-08-14 tras las decisiones del CTO — ver
"Decisiones del CTO" y "GPS y migración de Expo SDK" abajo):

1. **Migrar a Expo SDK 54 + Transistorsoft v5.** Precondición de todo lo demás en móvil: con
   Expo SDK 52 (`targetSdkVersion 34`) la app **no se puede publicar ni actualizar en Google
   Play**, que exige API 36 desde el 2026-08-31. El piloto va a Play, así que la migración
   dejó de ser opcional.
2. **QUI-216, gate GPS** (Urgent, vencido desde el 2026-08-10): **ya no está bloqueada por la
   licencia** — ese era un error del protocolo, no un hecho (detalle abajo). El Android de
   gama baja ya se consiguió. Correr el spike **sobre SDK 54 + v5**, no sobre el stack actual,
   para no validar algo que se va a tirar. Antes hay que corregir los tres bugs de
   configuración que hoy lo harían fallar con licencia o sin ella.
   **El gate ya se está bypasseando de hecho**: QUI-216 declara bloquear a QUI-235 y QUI-237,
   pero QUI-235 está `Done` y toda la app móvil se construyó encima — la premisa "nada de M3
   arranca sin este GO" dejó de sostenerse hace tiempo.
3. **QUI-213 (infra) y deploy de `apps/web`:** ambos se reevalúan **contra GCP**, cuya cuenta
   se reactivó. El ADR `docs/adr/0001-railway-vs-flyio.md` quedó **obsoleto** (compara Railway
   vs Fly.io) y hay que reescribirlo o anularlo.
4. **M5 (hardening + piloto):** QUI-250 (k6), QUI-252 (retención GPS) y QUI-253 (piloto), las
   3 en curso del CTO.

**Roadmap de Valentina reescrito contra el estado real de `main`** (2026-08-13/14): de las 12
issues abiertas, 3 se cerraron por estar ya hechas (**QUI-343** onboarding, **QUI-341** pase
visual del app pasajero, **QUI-345** tests de contraste) y **QUI-337** (limpiar ramas) se cerró
absorbida por el PR #2. Se rescopearon **QUI-336, 338, 340, 342 y 346** — cada una tenía partes
ya resueltas en `main` (ej. QUI-338 "estados de error": offline y sesión expirada ya estaban,
falta renderizar `errorSync` y distinguir permiso de ubicación denegado). Quedan **8 issues
vivas y ~21 puntos** (antes 34, sin priorizar ni asignar a milestone), ahora todas con
prioridad, milestone y un comentario de arranque — antes ninguna de las 12 tenía un solo
comentario, causa directa de que Valentina no entendiera el alcance. **QUI-348** (los 4 bugs
reales encontrados en la auditoría de mobile, closures viejas de React y timers sin limpiar)
queda vigente sin cambios. **QUI-339/347** (accesibilidad web) quedan explícitamente
dependientes de este `main` verde.

También se cerró **QUI-264** (planning del sprint M6 del CPO): el plan repartía 21 pts a
Estrella y 21 a Valentina, pero las 10 issues del sprint quedaron asignadas solo a Valentina —
contexto directo de por qué la calidad del código de M6 dejó los 4 bugs de QUI-348. Queda como
decisión abierta del CTO si Estrella se reincorpora al proyecto con carga real.

**Otros pendientes que siguen abiertos, sin cambios desde antes:**

- Validar con Producto las asunciones documentadas sin confirmar: transiciones de estado de
  vehículos (`vehiculos.service.ts`), tolerancia de 100m para paradas/puntos de control cerca
  de una ruta (`common/geo/proximidad-ruta.ts`), taxonomía de `tipo` en paradas
  (`packages/shared/src/entities/parada.ts`).
- Ritos Scrum sugeridos: daily corto, review/retro al cierre de cada cycle (cada 2 semanas).

Plan de trabajo completo de esta iteración, con toda la evidencia verificada, en
[`docs/plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md).

## Decisiones del CTO — 2026-08-14

Once decisiones tomadas en la misma sesión, tras el merge del PR #2. Son el insumo del plan de
finalización.

| #   | Tema                            | Decisión                                                                                                                                       |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Entorno desplegado              | **No existe ninguno, todo es local.** El riesgo de `RUNTIME_DATABASE_URL` no está activo hoy, pero pasa a ser requisito del despliegue          |
| 2   | GCP                             | **La cuenta se reactivó.** El destino de infra ahora es GCP                                                                                     |
| 3   | `socios.service.ts:33`          | **Se agrega el filtro explícito por id.** RLS deja de ser la única barrera en los reads por id                                                  |
| 4   | QUI-212 (branch protection)     | **Se cierra la issue** — requiere GitHub Pro y la decisión es no gastar. No volver a listarlo como pendiente técnico                            |
| 5   | QUI-213 (infra)                 | **Reevaluar contra GCP**, no Railway/Fly                                                                                                        |
| 6   | Deploy de `apps/web`            | **Reevaluar** (el plan decía Vercel)                                                                                                            |
| 7   | Estrella                        | Sigue en otro proyecto esta semana; **no se cuenta en la capacidad todavía**                                                                    |
| 8   | Los 3 elementos excluidos       | **Se aceptan si no rompen nada.** Verificar antes de cerrar QUI-336                                                                             |
| 9   | Distribución del piloto         | **Se publica en Google Play.** Antes va una **demo con APK directo** al sindicato, que no pasa por Play                                        |
| 10  | Expo SDK                        | **Se migra antes del piloto** — obligado por Play (ver abajo)                                                                                   |
| 11  | Hardware del spike              | **El Android de gama baja ya se consiguió**                                                                                                    |

Sobre la 1: si `RUNTIME_DATABASE_URL` no se setea al desplegar en GCP, la API arranca sin
aislamiento entre sindicatos. Con el fix del PR #2 ahora **falla al arrancar** en vez de
degradar en silencio, así que se va a notar — pero conviene que esté escrito antes de
desplegar, no después.

Sobre la 8, los tres elementos son: el endpoint `GET /v1/mobile/perfil`
(`auth-movil.controller.ts:56-63`), el `refetchInterval` de 60s/300s en `use-perfil-query.ts:23`
y `react-native-shimmer-placeholder` (`package.json:50`, usado 8× en `perfil-screen.tsx`).
Entraron a `main` pese a estar excluidos del alcance original de QUI-336.

## Council — tres decisiones menores (2026-08-14)

Se convocó un council de cuatro voces sobre tres puntos de higiene del repo. **Unánime en los
tres**, con el criterio explícito de "qué deja el repo más difícil de romper para gente junior
que va a tocar esto sin el contexto de hoy":

- **Divergencia de Expo SDK:** dejar divergir, pero con **política escrita, con owner y fecha**
  — sin eso "es teatro". La app del pasajero en SDK 57 funciona como **canario** de la versión
  nueva. ⚠️ **Esta decisión quedó superada por el deadline de Play** — ver la sección
  siguiente. El council no tenía ese dato.
- **Script `test:acceptance:prepare` roto** (hace `. apps/api/.env`, archivo que no existe ni
  local ni en CI): **borrarlo**, y dejar **un solo camino que sea el que CI ejecuta**. Un
  script que nadie corre "le enseña al junior que el repo miente". Regla que salió del council:
  **si CI no lo ejecuta, no existe.**
- **Dependencia implícita de orden en CI:** hacerla **estructural** (`prisma generate` como
  precondición vía `pretest`/`postinstall`), nunca un comentario — "los comentarios no se
  ejecutan; el junior que rompe esto no está leyendo el YAML". **No** declarar el cliente
  generado como output de Turbo: la caché puede restaurar un cliente stale, que es exactamente
  el bug que se pagó en este PR.

**Observación que las tres voces levantaron por separado:** un CI verde por primera vez no
prueba que los tests detecten algo; podrían estar pasando en vacío.

La evidencia dice que **sí detectan**: cuando la conexión caía al rol `quivo` (superusuario con
`BYPASSRLS`), **12 de 14 tests de RLS fallaron**; con `quivo_app`, 17/17 pasan. Límite que
queda abierto: eso prueba que la suite detecta **RLS globalmente desactivado**, no que detecte
**una policy mal escrita en una tabla puntual**. Vale romper una policy específica antes del
piloto y confirmar que el test de esa tabla se pone rojo.

## GPS y migración de Expo SDK — investigado 2026-08-14

### El hallazgo que desbloquea QUI-216

**La licencia nunca fue el bloqueo.** Transistorsoft es *fully functional en builds debug sin
key*, y ofrece trial de 30 días para builds release. **El paso 1 de `docs/spike-gps.md` está
mal escrito** — pone "agregar la licencia" como prerequisito, y por eso el spike quedó parado
un mes. Los US$399 no compran la capacidad de *medir*, sino la de *distribuir un release
firmado*. **Hay que corregir ese paso del protocolo.**

Con el teléfono ya conseguido, el spike se puede correr esta semana.

### Tres bugs de configuración que harían fallar el spike igual

Verificados en el repo. Ninguno tiene que ver con la licencia:

- `apps/mobile/src/gps/background-geolocation.config.ts` **no setea** `stopOnTerminate`,
  `startOnBoot` ni `enableHeadless`. Los defaults de Transistorsoft son `stopOnTerminate: true`
  / `startOnBoot: false`, o sea que **el tracking muere al cerrar la app y no vuelve tras el
  reboot** — que es exactamente el criterio C del GO.
- `apps/mobile/index.js` **no registra headless task** (solo `registerRootComponent`). Sin eso,
  con la app terminada nada escribe en `quivo-outbox.db`, que es la fuente de la evidencia de
  sanciones (RF-67..73).
- `logLevel: LOG_LEVEL_VERBOSE` en una config marcada como de producción: escribe a SQLite en
  cada tick durante las 8 horas de la medición.

### GCP no sirve para el tracking

El problema es de **proceso local en el dispositivo**: cuando Android congela el proceso, nadie
lee el chip GPS, y ningún servicio remoto puede leerlo por él. **Fleet Engine** queda
descartado — requiere contrato firmado, apunta a >1M viajes/año, cobra por tarea, su SDK es
nativo sin binding de React Native, y reemplazaría Postgres+PostGIS por un backend propietario.
**Roads API** costaría ~US$27.000/mes al volumen del proyecto. Lo que **sí** sirve de GCP es
Cloud Run + Cloud SQL para el backend, que es la decisión 5.

### Ninguna alternativa opensource cumple

`expo-location` falla los tres criterios GO, con dos bugs abiertos y fechados:
[expo/expo#46788](https://github.com/expo/expo/issues/46788) (junio 2026 — Android ignora
`timeInterval`/`distanceInterval` en background y cae a ~3s, con el fix sin publicar) y
[expo/expo#47595](https://github.com/expo/expo/issues/47595) (julio 2026, **abierto** — el
foreground service se congela tras cualquier update de la app: la notificación sigue visible y
no llega un solo punto, así que el chofer no se entera).

Migrar ida y vuelta cuesta ~2 semanas que se tiran, y de paso rompe `battery-gap-monitor.ts`,
que usa `location.battery.level` — dato que `expo-location` no provee.

### Destino de la migración: **Expo SDK 54**

**Play exige API 36 desde el 2026-08-31** (extensión posible hasta el 2026-11-01). Expo SDK 52
da **API 34**, así que hoy la app no se puede publicar ni actualizar.

SDK 54 (RN 0.81 / React 19.1) es la **única versión que cumple las dos condiciones a la vez**:
la primera que da `targetSdkVersion 36`, y la última que todavía permite
`newArchEnabled: false`. Esa intersección existe en exactamente un SDK.

| Expo SDK    | RN       | React      | targetSdk    | Transistorsoft                      | New Arch obligatoria         |
| ----------- | -------- | ---------- | ------------ | ----------------------------------- | ---------------------------- |
| 52 (hoy)    | 0.76     | 18.3.1     | 34 ❌ Play   | v4 legacy                           | No                           |
| 53          | 0.79     | 19.0       | 35 ❌ Play   | v5 usado                            | No                           |
| **54** ✅   | **0.81** | **19.1**   | **36** ✅    | **v5, entorno más reportado**       | **No — último con opt-out**  |
| 55          | 0.83     | 19.2       | 36 ✅        | v5 usado                            | Sí                           |
| 56          | 0.85     | 19.2       | 36 ✅        | v5 usado                            | Sí                           |
| 57          | 0.86     | 19.2       | 36 ✅        | **sin evidencia (0 reportes)**      | Sí                           |

### Hallazgos que condicionan la migración

- **Hay que migrar Transistorsoft v4 → v5, y es una migración aparte.** La versión instalada
  real es **4.19.4** (el `package.json` declara `^4.17.3`, engaña) y **no tiene
  `codegenConfig`**: es bridge legacy puro. v5 implementa TurboModules y, sobre todo, **solo v5
  maneja bridgeless en el path del headless task** — el corazón del producto. v4 bajo New
  Architecture es riesgo en el único camino que no puede fallar.
- **La licencia v4 no sirve para v5** (v5 usa formato JWT). Como todavía no se compró, no hay
  dinero perdido: **comprar directamente la key v5**. La demo por APK directo puede salir como
  build **debug sin licencia**; el piloto en Play sí la necesita. Transistorsoft responde lento
  a temas de licencia (hay un pedido de trial que quedó sin respuesta 30 días), así que
  conviene comprar con margen.
- **Los fixes de foreground service de Android 16 viven en el nativo de v5**
  (`tslocationmanager` 4.4.x, clase `FgsLaunchGate`). Apuntar a API 36 con v4 = crashes de FGS.
  El patrón de fallas reportado es **Motorola y Samsung de gama baja**, que es justamente el
  hardware objetivo del proyecto.
- **Subir `targetSdkVersion` a 36 con `expo-build-properties` quedándose en SDK 52 no es una
  salida:** los crashes de FGS pegan en v4; edge-to-edge es obligatorio con targetSdk 36 y RN
  0.76 no lo soporta (llegó en RN 0.81); y el toolchain (AGP/Gradle) de Expo 52 es anterior al
  soporte de API 36. Parece que funciona hasta que corre en un teléfono real.

### Plan de migración en dos PRs, con palanca de rollback

1. **SDK 52 → 54 + Transistorsoft v4 → v5**, con `newArchEnabled: false`. Cumple Play sobre la
   arquitectura vieja, que es el camino conocido para Transistorsoft.
2. **Flip a New Architecture**, como cambio separado. Si rompe el headless task, se revierte
   solo el (2) y se publica igual, porque el cumplimiento de Play ya está en el (1).

**Verificación barata antes de comprometerse (~1 día):** build **debug** de dev-client en SDK
54 + v5.4.0 (sin licencia), sobre el Android de gama baja real, con test de tracking con la app
terminada 2–4 h. Si pasa, comprar la key v5 y correr el spike completo.

**Riesgo principal:** no es el salto de SDK, es Transistorsoft v5 sobre Android 16 en gama
baja — la clase de bug más viva del tracker (`ForegroundServiceDidNotStartInTimeException` en
`FgsLaunchGate`, con issues de julio y agosto 2026). Es ortogonal al SDK elegido: viene con API
36. Mitigación: pinear **exactamente 5.4.0** (no rango `^`) y probar en Motorola/Samsung real,
no en emulador.

**Calidad de la evidencia** (importa para decidir): SDK 54 + v5 tiene evidencia **fuerte**
(~10 reportes de producción recientes en el tracker); SDK 55/56 **moderada**; **SDK 57 / RN
0.86: cero reportes** — es ausencia de evidencia, no evidencia de incompatibilidad, pero para
el módulo que es el riesgo #1 del proyecto no conviene ser el primero con un piloto encima.
Transistorsoft **no publica matriz de compatibilidad** (sin `peerDependencies` ni `engines` en
su `package.json`), así que la compatibilidad solo se puede leer del código y del tracker.

## PR #6 — desbloquear el gate GPS (N1) — 2026-08-14

Primer ítem de la fase F0 del [plan de finalización](plan-finalizacion-piloto.md). El spike
GPS (QUI-216) es el gate go/no-go del stack móvil y llevaba **un mes parado** por una causa
evitable: el paso 1 de `docs/spike-gps.md` afirmaba que hacía falta comprar la licencia de
Transistorsoft, y es falso — el SDK es funcional en builds debug sin key, y hay trial de 30
días para release. Los US$399 compran distribuir un release firmado, no medir. Ese documento
quedó corregido.

Pero el spike **habría fallado igual, con licencia o sin ella**, y ese fue el hallazgo real
del ciclo. Lo que se arregló se agrupa en tres capas, cada una descubierta al cerrar la
anterior.

### 1. Configuración: el tracking moría justo donde el spike mide

Faltaban `stopOnTerminate: false`, `startOnBoot: true` y `enableHeadless: true`. Los defaults
del SDK son los contrarios, así que el tracking moría al cerrar la app y no volvía tras el
reboot — que es **exactamente el criterio C del GO**. Y `index.js` no registraba headless
task: con la app terminada el SDK seguía grabando en su SQLite interna, pero nada copiaba esos
puntos a `quivo-outbox.db`, la fuente de la evidencia legal (RF-67..73). `index.js` es el
único lugar donde el SDK permite registrarlo.

El headless task corre fuera de React, sin hooks ni contexto, así que la lógica de
`onLocation` se partió en dos: `location-task.ts` con la parte pura (testeada) y
`headless-task.ts` con la de E/S. El hook y el task comparten ahora un solo camino de
escritura al outbox. El estado que el task necesita se lee de donde ya estaba persistido
(`deviceId` y `sesionId` de SecureStore, puntos de control del paquete del día en SQLite), sin
inventar almacenamiento nuevo.

### 2. El timestamp de la evidencia estaba corrido

`encolarEvento` sella el `ts` con el reloj del momento de **encolado**. Mientras el único
productor fue la suscripción `onLocation` en vivo eso coincidía aproximadamente con el fix
GPS. Con el tracking headless recién habilitado, no: el SDK entrega las ubicaciones
**bufferadas, tarde y en ráfaga** al salir de Doze, así que un tramo entero de manejo se
encolaba en segundos y se persistía con timestamps casi idénticos. El recorrido reconstruido
(`recorridos.service.ts`, `ORDER BY ts`) quedaba deformado — y es evidencia legal.

El payload lleva ahora `tsFix` (el `location.timestamp` del fix real) y el worker persiste ese
instante vía `resolverTsFix` (`packages/shared/src/sync/evento.ts`). Aplica a los **dos** tipos
de evento: `gps_point` y `cumplimiento_punto_control` — este último con más peso, porque la
hora de paso por el punto de control es el hecho que sustenta la sanción (RF-64..66), no un
punto suelto del trazado.

Decisiones de diseño que conviene no revertir sin leer esto:

- **`tsFix` es opcional a propósito.** Cuando esto se despliegue puede haber eventos ya
  encolados en dispositivos con una versión anterior de la app que nunca lo van a traer. Esos
  siguen siendo válidos y se ingestan con el `ts` del sobre.
- **El fallback ya no es silencioso.** Se cuenta (`tsFixDescartados` / `tsFixDescartado`) y se
  loguea, porque un fallback callado es justamente el modo de fallo que este campo existe para
  eliminar.
- **La ventana de aceptación tiene techo y piso.** Techo de 1 min (deriva de reloj / corrección
  NTP). Piso de 7 días: sin él, un `tsFix` absurdo — zod acepta el año 500 sin chistar — caía
  fuera del rango de particiones diarias de `gps_points`, el `INSERT` multi-fila levantaba
  `23514 no partition found` y **se llevaba puestos los otros 499 eventos del lote** a
  `sync_errors`, que no tiene reproceso. Pérdida definitiva de evidencia por un solo evento
  corrupto.
- **Idempotencia verificada, no asumida.** `resolverTsFix` es determinista sobre el payload
  bajo cualquier zona horaria (probado bajo cuatro), así que un reenvío calcula el mismo `ts` y
  `ON CONFLICT (event_id, ts)` deduplica igual que antes. `cumplimientos_pc` deduplica solo por
  `eventId` (`@unique` simple, no compuesto), así que cambiar el `ts` no lo afecta.

### 3. El spike podía dar GO sin haber medido nada

Lo más grave del ciclo, y lo encontró la revisión, no la implementación. **Dos falsos GO**, los
dos por la misma causa: el veredicto se calculaba desde refs de React que el camino headless no
alimenta.

- **Criterio B (huecos).** `detectarHuecos` corría sobre un `useRef` que solo llenaba el
  `onLocation` del hook. Si el chofer mata la app a las 2 h — que es **el criterio C, lo que el
  spike va a hacer a propósito** — el proceso que reabre arranca con el ref vacío, no hay
  muestras que bordeen el agujero, y el criterio B reportaba `0 huecos` sobre horas que nunca
  miró. Un battery-killer del fabricante matando el SDK 4 de esas 5 h salía como GO limpio.
  Ahora los huecos y la duración salen del **outbox**, filtrados por sesión: cubren la ventana
  headless y sobreviven a la muerte del proceso.
- **Criterio A (batería).** No puede salir del outbox — el payload de `gps_point` es evidencia,
  no instrumentación de spike. Así que se extrapola sobre **su propia ventana**, no sobre la de
  los huecos, con piso absoluto de 1 h y cobertura mínima del 50% de la medición. Sin eso, 30
  min de muestras contra una corrida de 8 h daban 1% estimado y GO. Arreglar solo los huecos
  habría **agravado** este: antes las dos métricas usaban la misma ventana corta y se
  cancelaban; después el numerador quedaba corto y el denominador largo.

El veredicto imprime ahora las dos ventanas y el nivel de log con el que se midió — una corrida
contaminada por logging `VERBOSE` (I/O extra a la SQLite nativa, que es justo lo que el
criterio A mide) y una limpia producían el mismo string.

### Otros hallazgos de la revisión

- `obtenerPaqueteDiaLocal` protegía el `safeParse` pero **no el `JSON.parse`**: una fila
  corrupta lanzaba, el throw subía hasta el catch externo del headless y **descartaba cada tick
  del turno entero**, en silencio y con la app terminada, o sea sin nadie mirando el
  `console.error`. Exactamente lo contrario de lo que el código promete tres archivos más
  arriba. Devuelve `null` (el camino ya soportado, que sigue registrando `gps_point` sin puntos
  de control) y `guardarPaqueteDia` pasó a ser transaccional — su `DELETE`+`INSERT` sin
  transacción era la forma de corromper la fila.
- `iniciar()` reseteaba el Set de cumplimientos a vacío. Tras un kill con cumplimientos ya
  emitidos por el headless, un segundo paso por el mismo punto en una ruta circular generaba
  una **segunda fila para la misma sanción** (el worker deduplica por `eventId`, y la
  reemisión lleva uno nuevo). Ahora siembra desde el outbox, igual que el lado headless.
- El `stop()` por paquete vencido apaga también `startOnBoot`: decisión **irreversible sin
  intervención humana**, tomada con `Date.now()` en el camino de arranque tras reboot, donde el
  reloj es menos confiable (RTC drift, todavía sin NTP). Se le dieron **2 h de gracia — valor
  provisional, pendiente de confirmación del CTO**. Descartar el punto sigue siendo inmediato;
  lo que se demora es apagar el plugin.
- El centinela `-1` de batería entraba como `-100%` en el cálculo: con la primera muestra sin
  lectura y la última con, `Math.max(0, -180)` daba **0% de consumo** sin importar el consumo
  real. Las muestras sin lectura usable ya no se cuentan.

### Restricción de despliegue

**El API va antes que el release móvil, y no se rollbackea el API mientras haya clientes con
`tsFix` en la calle.** Con la versión vieja del API y `tsFix` ya en dispositivos, un reenvío
tras timeout se ingestaría una vez con `evento.ts` y otra con `tsFix` — dos `ts` distintos, y
la PK `(event_id, ts)` deja dos filas. `cumplimientos_pc` no sufre esto.

### Deuda que este PR deja abierta, a propósito

| Deuda | Por qué se difirió |
|---|---|
| Partición `DEFAULT` en `gps_points`, o degradación fila por fila en `insertarGpsPoints` | Necesita migración y decisión de diseño. El piso de `resolverTsFix` ya cierra el camino realista; esto es defensa en profundidad |
| Reproceso de `sync_errors` | Hoy solo hay un `@Get`: lo que cae ahí es pérdida definitiva. Duele recién cuando algo cae |
| Reconstruir el instante con `location.age` | El caso es un teléfono con el RTC descargado que arranca con la fecha de build, y hace que el `tsFix` correcto de GNSS parezca "del futuro". Es hardware de gama baja, o sea el del piloto — pero no bloquea el spike |
| Índice `(tipo, ts)` en el outbox + enganchar `purgarAcusadosAntesDe` | La tabla nunca se purga (la función existe y **no la llama nadie**) y el scan crece con ella, dentro del presupuesto de un tick en Doze |
| Validar con `PayloadGpsPointSchema` los casts del worker | Ahora que el schema existe es un arreglo de dos líneas, pero cambia el comportamiento ante error |
| Tests de `headless-task.ts` | Importa nativos. Sin cobertura quedan el gate `vencido → stop()`, el orden de la siembra y el `try/catch` externo |

**Lo que este PR NO hace: correr el spike.** Eso es validación física y sigue pendiente — si
los flags se comportan como documentan sobre un fabricante real con battery killers, si el task
dispara de verdad tras un kill o un reboot, y los números de batería y huecos de las 8 h. Y
debe correrse sobre **Expo SDK 54 + Transistorsoft 5.4.0**, no sobre el stack actual: validar
un stack que se va a tirar no valida nada.

Verificación del PR: `typecheck`, `lint` y `test` en 9/9, con **331 tests** (api 202, shared 52,
mobile 38, web 22, db 17). Los conteos de shared y mobile subieron con los tests nuevos de la
ventana de aceptación y del veredicto no concluyente.

### El CI verde de ayer también era casualidad

Este PR destapó el defecto que el council había señalado el 2026-08-14 y que se había
registrado como "hacer estructural la garantía del cliente Prisma". `typecheck` depende de
`^build`, y el build de `@quivo/db` es `prisma generate && tsc`. **Un cache hit de Turbo
restaura `dist/**` pero no reejecuta el comando**, así que `prisma generate` no corre y el
cliente nunca se escribe en `node_modules`. Sin cliente, los tipos de `@quivo/db` degradan a
`unknown`/`{}` y `@quivo/api` falla el typecheck con ~40 errores que **no son errores de
tipos**.

El CI venía verde porque `@quivo/db#build` siempre había sido cache *miss*. Este PR cambió
`apps/api` sin tocar `packages/db`: primera vez que ese build da hit mientras
`@quivo/api#typecheck` da miss. Había dos parches previos por el mismo motivo, y los dos eran
**comentarios largos explicando la trampa en vez de eliminarla**.

Ahora `packages/db` tiene `postinstall: prisma generate`. `pnpm install` lo corre siempre —con
`--frozen-lockfile`, en CI, con `node_modules` fresco— antes de que Turbo tenga la chance de
servir un cache hit. **No** se declaró la ruta del cliente como `outputs` de Turbo: la caché
puede restaurar un cliente *stale*, y eso ya rompió una corrida antes con `SyntaxError:
@prisma/client does not provide an export named 'PrismaClient'`.

Es la segunda vez en dos ciclos que aparece la misma lección: *un pipeline que pasa por el
orden de sus pasos, y no por una garantía estructural, no es un pipeline*. Vale releer con eso
en mente el resto del workflow — el paso `Test` sigue dependiendo de que `Seed database` haya
corrido antes.

## PR #7 — ADR 0002: GCP (N19) — 2026-08-14

Cierra **F0**. Único ítem de la fase que no era trámite externo del CTO.

`docs/adr/0001-railway-vs-flyio.md` queda **anulado** (banner al principio + "Decisión final"
reescrita) y se conserva como registro histórico de por qué la infra estuvo sin decidir desde el
Cycle 12 — nunca se creó cuenta ni se aprovisionó nada en Railway ni en Fly.io, así que no hay
recursos que dar de baja. Lo sustituye `docs/adr/0002-gcp.md`, que fija la arquitectura de
despliegue del plan de finalización como decisión formal: Cloud Run para `apps/api`
(`min-instances=1`), **Cloud Run Worker Pool** para el worker de ingesta —GA desde abril de 2026,
y la razón concreta de la elección: un Cloud Run *service* normal moriría por falta de tráfico—,
Cloud Run Job + Scheduler para la retención, Cloud SQL PG16 con PostGIS, Memorystore, Secret
Manager, `apps/web` también en Cloud Run y archivado en Cloudflare R2.

Tres cosas que el ADR deja escritas porque son las que muerden después:

- **RLS en Cloud SQL depende de un detalle no obvio:** el usuario `postgres` de Cloud SQL no es
  superusuario real (es `cloudsqlsuperuser`), así que `quivo_app` sin BYPASSRLS y `FORCE ROW LEVEL
  SECURITY` se comportan como en Postgres vanilla — que es el supuesto sobre el que se construyó
  todo QUI-218. Queda como verificación obligatoria correr `rls.integration.test.ts` **contra la
  instancia real**, no contra el Docker local.
- **R2 en vez de GCS es deliberado**, no un descuido de coherencia: egreso $0 permanente contra
  ~$0,12/GB, y evita el footgun de los checksums del AWS SDK contra GCS. Cero cambio de código.
- **El objetivo de costo del doc técnico (US$50–150/mes) es inalcanzable** con servicios
  gestionados en región sudamericana: ~US$255–290/mes en el piloto, ~US$1.200–2.800/mes en
  régimen. El ADR lo acepta explícito en vez de dejar el número viejo flotando.

### La región quedó cerrada: `southamerica-west1` (Santiago)

El plan de finalización dejaba la región abierta con un *lean* por São Paulo apoyado en dos
supuestos —"catálogo más completo" e intuición geográfica— y pedía explícitamente medir antes de
comprometerse. **Se midió, y los dos supuestos eran falsos.**

Latencia real desde la conexión del CTO (La Paz, AXS Bolivia `AS26210`), 12 requests HTTPS sobre
una **única conexión TLS reusada** por región, descartando el handshake:

| Región | RTT mediana |
|---|---|
| **`southamerica-west1`** (Santiago) | **52 ms** |
| `southamerica-east1` (São Paulo) | 110 ms |
| `us-east4` | 199 ms |
| `us-central1` | 230 ms |

**Trampa de medición que conviene no repetir:** medir con `time_connect` de `curl`, o con
conexiones nuevas, da ~40 ms para *todas* las regiones por igual — eso es el borde Anycast de
Google, no el datacenter. La diferencia aparece recién reusando la conexión.

Y en costo Santiago **también** gana: Cloud Run y Worker Pools son de 2 tiers (Santiago y São
Paulo cuestan idéntico), pero Cloud SQL es 6,7% y Memorystore 19,5% más baratos en Santiago —
−6,5% en el total. La mitad de latencia y más barato: no hubo tradeoff que deliberar.

**Los dos gaps de Santiago, y por qué ninguno bloquea:**

- **Cloud Scheduler no existe en `southamerica-west1`** (verificado en la doc oficial). Acá solo
  dispara el Job de retención GPS, **una vez por día**: se pone en `southamerica-east1` apuntando
  al Job en Santiago —el endpoint de la Admin API es global— y cuesta ~30 ms diarios. Es la única
  pieza multi-región y hay que dejarla explícita en el Terraform para que no se lea como error.
- **Firebase App Hosting no tiene ninguna región sudamericana** (`us-central1`, `us-east4`,
  `us-east5`, `asia-east1`, `asia-southeast1`, `europe-west4`). No es un gap de Santiago sino del
  servicio, y **se resolvió sacándolo de la arquitectura** — ver abajo.

**Cloud Run Worker Pools sí corre en Santiago, verificado en vivo.** Era el único gap capaz de
descartar la región (sostiene el worker de ingesta) y no tiene tabla de regiones publicada: la
doc no documenta restricción ni lo confirma en positivo. Se comprobó contra la API real con
`POST .../locations/southamerica-west1/workerPools?validateOnly=true`, que valida sin crear nada
— aceptado en ambas regiones, con `Listed 0 items` confirmado después. Control: la misma llamada
contra una región inexistente falla. **Lección reusable: `validateOnly=true` convierte una
inferencia de documentación en un hecho, gratis.**

### Cambio de arquitectura: `apps/web` va en Cloud Run, no en Firebase App Hosting

Al no existir App Hosting en Sudamérica, había que decidir si valía servir el panel desde
`us-east4` (199 ms medidos) con un proveedor y un camino de deploy extra. Se fue a ver si dolía:
**todo `page`/`layout` de `apps/web` salvo `app/layout.tsx` es `'use client'`**, y el fetching es
TanStack Query contra `NEXT_PUBLIC_API_URL` desde el navegador. El panel es un SPA con cáscara
Next.js — **el host web no está en el camino de datos**, el browser pega directo contra la API.
Sin SSR con datos, sin Server Actions y sin ISR, App Hosting no compra nada.

Servirlo como un Cloud Run más deja todo en una plataforma, un proveedor de Terraform y una
región. **Consecuencia no prevista por N6:** son **dos** `Dockerfile` (Next.js en modo
`standalone` además del de API+worker), no una imagen con dos `CMD`. Y si `apps/web` alguna vez
incorpora SSR con datos reales, esta decisión hay que revisarla.

### Costo corregido

El ~US$160–230/mes que circulaba en el plan **estaba corto: el número verificado es ~US$255–290
/mes**. La causa no es la región sino el sizing — **Cloud SQL 2 vCPU/8 GB es la línea dominante y
está sobredimensionada para 40 vehículos**. El tier definitivo se decide con el resultado del k6
(QUI-250), no antes. Corregido en el plan, el doc técnico y este handoff.

Los documentos de stack que seguían diciendo "Railway o Fly.io + Vercel" se corrigieron
(`plan-maestro.md` §Stack, `documento-tecnico-cto.md` §1/§10 y la respuesta 14 del §15, y el
resumen de stack de este handoff). **No** se tocó `plan-continuidad-quivo-control.md`: es el
registro cerrado del diagnóstico del PR #2 y sus menciones son históricas.

## PR #10 — migración Expo SDK 54 + Transistorsoft 5.4.0 (QUI-353) — 2026-08-15

Primer ítem de **F1**, el camino crítico. Desbloquea el gate: correr QUI-216 sobre SDK 52 + v4
sería validar un stack que se va a tirar.

`newArchEnabled: false` queda **explícito** en `app.json` — en SDK 54 el default es `true`, así
que omitirlo habría activado la New Architecture sin que nadie lo pidiera, que es justo el
riesgo que el plan difiere a M7 (QUI-368).

### El `Config` de v5 es compuesto, y los tipos del paquete mienten

v5 reagrupa las claves planas de v4 en `geolocation` / `app` / `http` / `activity` / `logger`.
Los tipos canónicos viven en `@transistorsoft/background-geolocation-types@5.2.2`; el
`src/declarations/interfaces/Config.d.ts` que **todavía trae el paquete es plano y stale**, y no
es el que resuelve TypeScript (el entry real es `src/index.d.ts`, que re-exporta el paquete de
tipos). Quien lo lea creyendo que es la fuente de verdad va a reintroducir la forma vieja.

Las tres banderas del criterio C del spike (`stopOnTerminate: false`, `startOnBoot: true`,
`enableHeadless: true`, todas de PR #6) viven ahora bajo `app`. `foregroundService` se quitó: el
SDK nativo lo fuerza a `true` desde Android 8 y v5 ya no lo declara configurable.

Nota para el que toque esto: **`stopOnStationary` existe en `GeoConfig` y en `ActivityConfig` a
la vez**. Quedó en `activity`. Como el valor es `false` (el default), no cambia comportamiento
en ninguno de los dos — pero TypeScript no marca la ambigüedad.

### Tres bugs que ni `tsc` ni los tests ven

Los encontró `/code-review high`, no la implementación. Dos solo aparecen en dispositivo o en CI.

- **Los enums no existen en runtime.** `import { DesiredAccuracy, LogLevel } from
  'react-native-background-geolocation'` type-chequea porque `index.d.ts` hace `export *` del
  paquete de tipos — pero el runtime (`src/index.js:83`) exporta **solo la clase por default**, y
  los enums son getters estáticos (`static get LogLevel()`, línea 147). Los bindings nombrados
  quedan `undefined`: `TypeError: Cannot read property 'High' of undefined` al evaluar el módulo,
  y como `use-gps-operativo.ts` lo importa, se cae la función GPS entera. Ahora se leen de la
  clase. **Regla general que deja este caso: en este paquete, todo lo que se use como valor sale
  de `BackgroundGeolocation`; los imports nombrados solo sirven para tipos.**
- **`@types/react@19` rompía `@quivo/design-system`.** React 19.1 obliga a `@types/react` 19 en
  `apps/mobile`, que entra al pool hoisted de pnpm
  (`node_modules/.pnpm/node_modules/@types/react`). `react-leaflet`/`@react-leaflet/core` no
  declaran `@types/react` como dependencia real, así que sus `.d.ts` resolvían desde ese pool en
  vez de la 18.3.31 local: 10 errores `TS2786` en `route-map-impl.tsx`, typecheck **y** build en
  rojo — y `@quivo/web` depende de ese build. **Una caché stale de Turbo lo tapaba: se reproduce
  solo con `--force`.**
- **`Location.timestamp` se ensanchó a `string | number`.** Un epoch numérico perdía el
  `.datetime()` de `PayloadGpsPointSchema` y hacía caer `resolverTsFix` en silencio al `ts` de
  encolado — exactamente la deformación del recorrido por buffering headless que ese campo existe
  para evitar (PR #6). Se normaliza a ISO al construir el payload, devolviendo `undefined` ante un
  timestamp ilegible en vez de fabricar `"Invalid Date"`. `resolverTsFix` no se tocó: es contrato
  con el worker.

### Cómo conviven las dos versiones de `@types/react`

`apps/mobile` necesita la 19 (React 19.1); `design-system` y `web` se quedan en la 18.3.31 —
migrarlos era alcance ajeno a este PR. Se **aíslan**, no se unifican: `paths` en el
`tsconfig.json` de ambos, apuntando al **`.d.ts` concreto**, no al directorio del paquete —
`@types/react` publica un `exports` map y la sustitución a un directorio cae de vuelta al pool
hoisted **en silencio**. No toca el lockfile, así que sobrevive a `pnpm install --frozen-lockfile`
con `node_modules` limpio, que es lo que hace el CI.

Descartadas: `pnpm.overrides` no sirve (un override fija versión en edges que ya existen, y acá
el edge no existe porque `react-leaflet` no declara la dependencia; además es global al lockfile
y no puede dar 18 a unos y 19 a otro). `packageExtensions` resolvería la causa raíz pero exige
regenerar el lockfile. **Si algún día `design-system` y `web` migran a React 19, estos `paths`
sobran y hay que borrarlos.**

### Otras decisiones

- **`react-native-reanimated` fijado en `~3.19.0`**, no la 4.x que trae SDK 54: Reanimated 4
  **solo funciona con New Architecture**. `expo-doctor` marca el mismatch — es esperado y correcto
  mientras la arquitectura vieja siga. No "arreglarlo" subiendo a 4.
- `expo-modules-autolinking` sigue pineado pese a que `expo-doctor` lo desaconseja: sacarlo rompe
  la resolución real bajo el linking aislado de pnpm (probado).
- `usesCleartextTraffic` **no se tocó**: es QUI-357, de Valentina.

Verificación: `typecheck` + `build` + `lint` con `--force` en **18/18 tareas**, y **40 tests** de
mobile (38 previos + 2 del fix de `tsFix`).

**Lo que este PR NO valida:** que Android acepte de verdad el Config compuesto (el JS solo hace
pass-through al nativo), el headless task tras kill y reboot, y la licencia JWT de v5 — las
licencias v4 no sirven. Eso es **QUI-216**, el gate D1, en el teléfono real.

## Insumos para el plan de finalización — resueltos

Los 4 puntos que quedaron abiertos el 2026-08-14 antes de planificar (revisar Linear issue por
issue, ordenar migración/spike/piloto, cerrar infra, aplicar el council) están **resueltos** en
[`docs/plan-finalizacion-piloto.md`](plan-finalizacion-piloto.md), que es desde ahora la fuente
de verdad del alcance, las fases, la asignación y las fechas. Este handoff registra la
ejecución; el plan registra la intención.

## Cierre del 2026-08-15 — higiene de Linear y decisiones abiertas

**F0 cerrada del lado del código. F1 arrancada:** la migración está en `main`, falta el teléfono.
El detalle vigente de qué bloquea está en "Estado" al principio del documento; acá queda lo que
se ajustó en el tablero ese día y las decisiones que siguen esperando.

**Tablero:** las tareas `N*` del plan ya existen como **QUI-349..369** — usar esos IDs. QUI-213
(infra GCP) se movió de M0 a M5, porque el plan lo ubica en F2, después del gate, y en M0 impedía
cerrar el milestone hasta tener infra desplegada; su descripción decía `southamerica-east1` y
~US$160–230/mes, corregida a Santiago y ~US$255–290 según el ADR 0002. La descripción de M0
también estaba vieja. QUI-250/252/253 volvieron a **Todo**: habían pasado a *In Progress* en una
operación masiva el 2026-08-03 (las tres en seis segundos), sin PR ni rama, y dependen de cosas
que todavía no existen — el board reportaba 9 pts en curso que nadie tocaba.

**Los ciclos son de 1 semana** (C14 = 10–17 ago), no de 2 como decía una versión anterior de este
documento. Con esa cadencia, el C22–C24 del plan cae exactamente en el 5 al 26 de octubre: las
fechas del plan son consistentes.

**Decisiones esperando al CTO**, ninguna bloqueante hoy:

- **El margen de gracia de 2 h** antes del `stop()` irreversible por paquete vencido
  (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`). Valor provisional elegido por defecto razonable.
- **D2 del plan: ¿cuenta de Play personal o de organización?** Si es personal, exige 12 testers
  × 14 días de closed testing antes de producción, y el reclutamiento pasa de C20 a C16 — o sea
  que la respuesta cambia el cronograma, no solo el trámite.
- **D3: ¿padrón completo o muestra?** De esto depende que el recorte de paginación sea válido o
  deuda que explota en campo. El plan recomienda la muestra; se decide con el sindicato en la mano.

## Cierre del 2026-08-16 — víspera del piloto: despliegue, PR #16 y umbrales

Día de dos entregas y un hallazgo que casi cuesta el arranque.

**PR #15 (`3876384`) mergeado a `main`:** todo el bloque "Sábado" del plan de un saque —
Dockerfiles, guardarraíl de `JWT_SECRET`, RLS en `gps_points`, `usesCleartextTraffic: false`,
rotación del refresh token web, seed del sindicato piloto, Sentry, y los tres bugs de M6 que toca
el conductor. Migraciones, seed y suite de RLS corridas contra la instancia real de Cloud SQL. El
backend quedó **desplegado y verificado en Cloud Run**: liveness 200, readiness con `db` y `redis`
arriba, login real y aislamiento cross-tenant confirmado a mano.

**El hallazgo del día:** el code review de PR #16 encontró que el build de release **iba a
fallar**, no a degradarse. `disableAutoUpload: true` no es una opción del config plugin de
`@sentry/react-native` 7.2.0 — pertenece a una versión posterior. Se pasaba y se ignoraba, la
tarea de subida de source maps se registraba igual dentro de `assembleRelease`, y sin org ni
token `sentry-cli` salía con exit code 1 dentro de un `exec {}` sin `ignoreExitValue`. Verificado
ejecutando a mano el `sentry-cli` que trae el repo:
`error: An organization ID or slug is required (provide with --org)`.

**Lección que conviene no repetir:** el comentario del código describía el comportamiento de una
versión del SDK distinta de la instalada, y la CI no lo detecta porque **la CI no corre
`eas build`**. Todo lo que solo se ejerce en el build nativo es, hoy, un punto ciego: verificarlo
contra el `node_modules` real, no contra la doc de `main` del proyecto upstream.

Otros tres hallazgos del mismo review, ya detallados en "Estado": faltaba `metro.config.js` con
`getSentryExpoConfig` (sin Debug ID los source maps no matchean, así que el token solo no
alcanzaba), Sentry inicializaba después de los imports hoisteados (dejando sin cubrir justo el
headless task de GPS), y el perfil `development` de `eas.json` apuntaba al Cloud Run de
producción — un build de development manejando en la calle habría escrito en la misma base que
guarda la evidencia del piloto.

**Decisión del CTO:** se va con **source maps funcionando**, no con el atajo de desactivar la
subida. `SENTRY_AUTH_TOKEN` como secret de EAS, `SENTRY_ORG` y `SENTRY_PROJECT` como env del
perfil, el token nunca en el repo.

**QUI-367 cerrado:** el checklist de aceptación pasó de casillas binarias a umbrales numéricos y
criterios de aborto A1–A7, y se le sacó el gate obsoleto del spike GPS de 8 h. Detalle en
"Estado".

**Vía 2 congelada:** los tres PRs de Valentina no se tocan hasta después del arranque.

**Decisión D2 resuelta por el camino:** la cuenta de Play deja de importar para el piloto — la
distribución es por APK sideload, así que ni el closed testing ni los 12 testers están en el
camino crítico. Vuelve a ser relevante recién cuando se quiera distribuir por Play (QUI-351,
diferida).

**Queda pendiente para hoy mismo:** cargar el secret de Sentry, mergear PR #16, generar el build
firmado **después** del merge —un APK buildeado antes apunta al backend viejo— y correr los 7
puntos de la prueba en teléfono real. El fallback sigue vigente: si el tracking en background
falla categóricamente, el lunes se corre con registro manual del conductor.

## Deploy de la Entrega 3 (2026-08-23)

El mapa en vivo pasó del repo a producción. Dos servicios, no uno, y el camino destapó un
defecto de build que llevaba cuatro días escondido.

**Lo desplegado:** `api:v5` (`quivo-api-00007-pvm`) y `web:v2` (`quivo-web-00002-55k`), ambos
en `southamerica-west1`. Sin migraciones: los PRs #45/#46/#47 no agregaron ninguna, y la última
del repo (`20260817150000_sesiones_operativas_vehiculo_estado_idx`) ya estaba aplicada desde el
18 de agosto.

### La API también estaba atrasada, no solo el panel

`api:v4` se construyó el 2026-08-18 13:24 UTC; el backend de `/en-vivo` (`fb8c5ab`, PR #46) se
mergeó el 2026-08-19 04:44 UTC — **diez horas después**. Desplegar solo el panel lo habría
dejado consultando rutas inexistentes: `GET /v1/reportes/en-vivo` contra producción devolvía
**404** antes del deploy y **401** después, que es la prueba de que la ruta ahora existe y su
guard la protege. Comparar la fecha de build de la imagen contra la del commit es el chequeo
barato que conviene hacer siempre antes de dar por desplegado algo.

`api:v5` arrastra además **`6dab41f` (QUI-342, filtros de cumplimiento en URL y exportación
CSV)**, que no es de la Entrega 3 y toca la ruta de reportes de cumplimiento — donde vive la
evidencia del piloto. Iba en `main` desde antes, con review y CI verde; se desplegó
conscientemente, no por descuido. Decisión del CTO.

**El worker quedó en `api:v4` a propósito.** Comparte imagen con la API por diseño (QUI-354),
pero ningún commit de la Entrega 3 toca el código de ingesta, y el worker sostiene el GPS del
piloto. Se prefirió la divergencia de tags antes que mover esa ruta sin necesidad.

### La imagen del panel llevaba cuatro días sin poder construirse

`web:v2` falló al primer intento:

```
packages/db postinstall: schema.prisma: file not found
[ELIFECYCLE] Command failed with exit code 1
```

Causa: **`2e710e3` (PR #43, QUI-340)** agregó `"@quivo/db": "workspace:*"` a las
`devDependencies` del `package.json` de la **raíz**, porque los specs de aceptación de Playwright
lo necesitan para limpiar por Prisma. Como `turbo prune` incluye siempre el package.json de la
raíz en el grafo podado, `packages/db` entró al build del panel —que no usa la base para nada— y
su `postinstall` (`prisma generate`) reventó sin el `schema.prisma`, que `out/json/` no trae.

Resuelto en `apps/web/Dockerfile` copiando el mismo remedio que la API ya tenía en
`/Dockerfile:50`. Y al destrabarlo apareció una **segunda capa de la misma raíz**: `turbo run
build --filter=@quivo/web...` también mete a `@quivo/db` en el scope y corre su script `build`
(`prisma generate && tsc`), que carga `packages/db/prisma.config.ts`, que resuelve
`DATABASE_URL` vía `env()` al cargarse — `PrismaConfigEnvError`. Mismo remedio que
`/Dockerfile:28-40`: un `ARG DATABASE_URL` dummy de build-time. Verificado que no viaja a la
imagen final (el stage `runner` arranca de `node:22-alpine` limpio).

**La lección, que ya es la segunda vez que aparece en este proyecto:** la CI no construye
imágenes Docker, así que **todo lo que solo se ejerce en el build de la imagen es un punto
ciego**. Es exactamente el mismo patrón que el 2026-08-16 con `eas build` y el config plugin de
Sentry. Un PR puede estar verde en CI y dejar una imagen inconstruible. Vale una issue para
agregar el build de ambas imágenes a la CI.

### La trampa de CORS que se esquivó

`scripts/deploy-web.sh` cierra con un paso 4 que reescribe `CORS_ORIGIN` en la API con el
`status.url` del panel. Pero Cloud Run expone el servicio en **dos URLs válidas** y no coinciden:
`status.url` devuelve `https://quivo-web-3mrviblcia-tl.a.run.app`, mientras que `CORS_ORIGIN`
estaba —y sigue— en `https://quivo-web-424426714260.southamerica-west1.run.app`. Como
`apps/api/src/main.ts:52` compara **string exacto**, dejar correr ese paso habría roto el
preflight para quien tenga el panel abierto en la URL de número-de-proyecto: sin login. El deploy
se hizo a mano salteando el paso 4; `CORS_ORIGIN` quedó intacto y el preflight verificado
devuelve 204 con el origen correcto.

Como el servicio web no cambia de URL en un redeploy, ese paso no aportaba nada. **Queda como
deuda**: que `CORS_ORIGIN` acepte un solo origen cuando el servicio tiene dos URLs es frágil, y
`deploy-web.sh` debería no tocarlo o aceptar ambos.

> **[2026-09-08]** Esta deuda quedó saldada del lado del código antes de esta entrada
> (`apps/api/src/main.ts` ya acepta `CORS_ORIGIN` como lista separada por comas), y
> `scripts/deploy-gcp.sh` (reemplaza a `deploy-web.sh`, ver el tope de este documento) ya setea
> las DOS URLs del panel en cada deploy en vez de una sola.

### Verificación

Con login real en el panel de producción: `/en-vivo` responde 200, los tres endpoints
(`en-vivo`, `contexto`, `posiciones`) devuelven **200**, cero errores y cero warnings de consola,
el mapa dibuja la ruta con los 26 puntos de control y el selector carga las 2 sesiones abiertas.

La página mostró **"Seguimiento en pausa — no llega nada al servidor desde hace 90 h 38 min"**,
que es el comportamiento correcto: no hay nadie manejando desde la jornada del 18, y el panel
corta el poll por inactividad real en vez de quedar golpeando la API. Captura en
`en-vivo-produccion-2026-08-23.png` (sin versionar).

**Lo que esta verificación NO prueba:** el camino con un vehículo reportando de verdad
—`followPoint`, el solape de 15 minutos del cursor, las dos guardas anti-bucle— nunca se ejerció
contra datos vivos. Eso se cierra en la próxima salida a la calle.

## El listado de `/en-vivo` miente sobre las sesiones de días anteriores (2026-08-23)

Encontrado al preparar una prueba de QA, horas después de desplegar la Entrega 3. **No lo detectó
la verificación del deploy** porque solo se mira cuando hay una sesión con puntos de otra jornada.

`GET /v1/reportes/en-vivo` (listado) y `GET /v1/reportes/en-vivo/:id/posiciones` (detalle)
devuelven datos **contradictorios para la misma sesión**. Para `07d24b22` (1111AAA, abierta desde
el 18-ago, con 223 puntos y 15 cumplimientos reales en la base):

| Campo | Listado | Detalle |
|---|---|---|
| `totalPuntos` | 0 | 223 |
| `ultimoFixTs` | `null` | `2026-08-18T23:23:18Z` |
| `estadoFrescura` | `sin_datos` | `perdido` |

**Causa raíz, en `en-vivo.service.ts:199`:** el `LEFT JOIN LATERAL` del listado acota los puntos a
la jornada boliviana **de hoy** (`trazaDesde`/`trazaHasta`), mientras que el criterio de inclusión
de sesiones de la línea 202 admite sesiones colgadas de **cualquier día**
(`so.fin IS NULL AND so.estado = 'activa'`). Los puntos del 18-ago quedan fuera de la ventana, el
LATERAL agrega sobre cero filas, y con `ultimoFixTs`/`ultimoIngresoTs` en null `clasificarFrescura`
(:111) devuelve `sin_datos` y `derivarFrescura` (:142) cae al fallback `ahora − inicio`. La cuenta
cierra exacto: `2026-08-23T16:15:45.774Z − 2026-08-18T21:23:47.262Z = 413 518 512 ms`, que es el
valor que devolvió el endpoint.

El camino de `posiciones` (`:305-315`, `:339`) usa una ventana **anclada a la sesión**
(`inicio − 60 s` … `min(fin ?? ahora + 2 h, inicio + 36 h)`), no al calendario. **Ese es el
correcto**: `sin_datos` debe significar "esta sesión nunca reportó nada", y una sesión con 223
puntos que dejó de sincronizar hace días es `perdido`. El comentario de `:89-94` afirma lo
contrario — describe una intención que el código no implementa, y hay que corregirlo con el fix.

**Alcance real: cosmético.** El mapa, la traza y el corte del poll se alimentan **solo** de
`/posiciones` (`page.tsx:64,67`; `use-en-vivo.ts:84,93`). El `inactivaDesdeMs` del listado nunca
llega a `intervaloPoll`, y `useSesionesEnVivo` tiene `refetchInterval` fijo de 30 s sin condición.
Lo que sí se degrada es la **etiqueta del desplegable** (`page.tsx:456-463`) y el **orden por
defecto** (SQL `:203`).

**Trampa del fix, no obviarla:** el `ORDER BY` es `fix."ultimoFixTs" DESC NULLS LAST`. Hoy el
zombi ordena último porque su `ultimoFixTs` es `NULL` *por el bug*. Al corregir el LATERAL pasa a
tener fecha real y se ordena **arriba** de una sesión fresca que todavía no mandó su primer punto
(esa sí `NULL` → NULLS LAST): el panel abriría por defecto en una sesión muerta. Hay que cambiar
el `ORDER BY` en el mismo PR.

**A verificar antes de dar el fix por bueno:** el comentario de `:175-177` justifica las cotas
constantes por poda de particiones en tiempo de plan. Con el LATERAL correlacionado eso pasa a ser
*runtime pruning*, que debería aplicar — pero hay que confirmarlo con `EXPLAIN (ANALYZE, BUFFERS)`
contra producción, no darlo por sentado.

**El hueco de test que lo dejó pasar:** `en-vivo.service.test.ts` (`describe('listarHoy')`,
:296-350) no cubre una sesión con puntos fuera de la jornada de hoy.

También queda anotado, del review del PR #49: el `COPY` nuevo de `apps/web/Dockerfile` depende de
la devDependency `@quivo/db` del `package.json` de la raíz, que el propio comentario califica de
incidental. Si algún día se saca, el build del panel falla con un `COPY ... not found` opaco. No se
pudo dejar un comentario-guarda en el `package.json` porque JSON no admite comentarios — queda
acá.

## Prueba de QA con la pasante (2026-08-23) — la cadena completa, verificada en vivo

Primera vez que `/en-vivo` se ve con un dispositivo reportando de verdad. La prueba no recorrió
ninguna ruta: la pasante activó la app desde su casa, quieta, solo para confirmar que el dato
llega. **Cerró el último pendiente real de la Entrega 3.**

**Lo que quedó probado, con números:**

```
17:29:24  201  POST /v1/mobile/auth/vehiculo
17:29:57  201  POST /v1/mobile/auth/conductor
17:29:58       sesión 9c63dda6 creada, primer punto GPS
17:31:10       estadoFrescura=reportando, antigüedadIngesta=9 s
```

Login → sesión → punto → worker validando → mapa dibujando, con **9 segundos** entre el fix y la
ingesta. Muy por debajo de la mediana de 153-166 s del piloto (que se midió con el vehículo en
movimiento y Doze activo; con el teléfono despierto y quieto el camino es directo).

**Lo que NO quedó probado:** la traza en movimiento. Los dos únicos puntos están a 3 m uno del
otro con `speed: -1` — el SDK deja de emitir con el dispositivo quieto, que es el comportamiento
correcto. `followPoint`, el solape de 15 min del cursor y las dos guardas anti-bucle **siguen sin
ejercitarse contra datos vivos**. Se cierra recién con alguien desplazándose.

### Tres defectos nuevos, todos de la misma familia: fallan sin avisar

Ninguno rompe fuerte. Los tres hacen que algo roto parezca sano — el patrón que ya costó el día 1
del piloto.

**1. La app reintenta un refresh rechazado para siempre, en silencio.** La pasante activó la app a
las 16:18 y durante **42 minutos** el teléfono hizo `POST /v1/mobile/auth/refresh` cada 15 s
obteniendo **401 todas las veces** (29 intentos en la primera ventana de 6 h medida, cero éxitos, y
ni un solo login móvil completo en 12 h). Ella veía la pantalla de operación normal y creía estar
grabando; no salía un solo `sync/batches`.

Causa: `restaurarSesion` (`apps/mobile/src/features/auth/use-auth-movil.ts:65-86`) encuentra la
sesión guardada en `SecureStore` y la da por válida mirando solo `refreshTokenExpiresAt` (TTL de 30
días, `MOBILE_REFRESH_TTL_SECONDS`), así que va directo a `etapa:'operacion'` con el `sesionId`
viejo sin pasar por login. Cuando el servidor rechaza ese refresh token, **no hay recuperación**:
la app no manda al usuario a la pantalla de login, se queda en el bucle. Es el defecto más serio de
los tres.

**2. `logout` devuelve 204 sin cerrar la sesión del servidor.** A las 17:00:50 el logout respondió
`204`, pero la sesión zombi siguió `estado: 'activa'`. `logout()` busca la sesión por el hash del
refresh token, y ese token ya era inválido — no encontró nada que cerrar. Limpió el `SecureStore`
del teléfono (que fue lo que cortó el bucle) y fue un no-op server-side, reportando éxito.

**3. El listado de `/en-vivo` reporta `sin_datos` para sesiones con puntos.** Documentado en
detalle en [la sección anterior](#el-listado-de-en-vivo-miente-sobre-las-sesiones-de-días-anteriores-2026-08-23).

### Lo que sí funcionó como estaba diseñado

El `updateMany` del login (`apps/api/src/modules/auth-movil/auth-movil.service.ts:223-231`)
**cerró la sesión zombi del 19-ago** al autenticarse de nuevo, exactamente como se esperaba. El
mecanismo agregado en `b8fd7de` para las sesiones colgadas funciona — el problema es que solo se
dispara en un login completo, y la app puede pasar días sin hacer uno.

### Deuda que deja la prueba

La sesión `9c63dda6` es de QA, no de operación real, y **ya generó un cumplimiento válido**
(`distanciaM: 72.5`, `cumplido: true`, `validadoPor: 'worker'`): la casa de la pasante cae dentro
del radio de 150 m de un punto de control de la Z12. Esa sesión va a aparecer en los reportes como
un recorrido con cumplimientos que nadie hizo. **Hay que excluirla al analizar la evidencia del
piloto.** Es un caso concreto del riesgo ya conocido de mezclar pruebas con la base de producción.
