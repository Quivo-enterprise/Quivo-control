# Plan — APK conductor build 11 (v2, 2026-09-26)

> **v2 reemplaza al plan del 2026-09-23** (queda en git: `56c88bf`). Motivo: en 3 días se
> mergearon 1 rama móvil (#80) y 1 web (#83), y hubo 4 PRs de solo handoff. La rama posición
> entró en loop: desde `79e832b`, que ya estaba revisado, sumó 6 commits y +2132 líneas
> persiguiendo un cuelgue hipotético de "Finalizar". Cada review sacó regresiones del fix
> anterior. Este plan corta ese loop con reglas duras y un alcance menor.

> **Estado (cierre del 2026-09-26):**
> - Pasos 1, 2 y 2' hechos: #87, #89 y #88 mergeados.
> - 3 (Entrega 28) y 3' (Entrega 9): mergeados, #92 y #91.
> - Pasos 5 y 6: runbook en orden en "Runbook de los pasos 5 y 6". Antes del deploy falta el PR de preparación P1/P2.
> - Detalle en `docs/handoff.md` → "Punto de retome — cierre de la sesión del 2026-09-26".

## Reloj

- **Licencia trial de Transistorsoft para `com.quivotech.conductor.app`: vence el 2026-10-25**
  (`max_build_stamp` 20261025, `grace_builds` 0). El build 11 tiene que estar en los teléfonos
  **antes del 2026-10-10**, así queda margen para un build de corrección. Para cualquier build
  posterior al 2026-10-25 hay que comprar la licencia. **Acción del CTO:** iniciar la compra ya,
  en paralelo, y no esperar al vencimiento.
- Codex vuelve el **2026-09-27 15:46**.

## Decisiones del CTO (2026-09-26)

1. **Posición: volver a `79e832b`.** Se revierten los 6 commits del rediseño iniciar/detener
   (`3afc6c0`..`fe4090c`) con `git revert` (sin force-push). Queda lo revisado: G1/G2/R1,
   `ACTIVITY_RECOGNITION` y QUI-247 (orden inicio/fin, reintento de `inicio_recorrido`). El
   cuelgue de Finalizar si se cuelga el outbox pasa a deuda: se vigila en Sentry durante el
   campo y solo se ataca si aparece.
2. **Alcance del build 11:** las 3 ramas móviles + **Entrega 28** (sesión no vigente) +
   **Entrega 9** (dedupe del toast). **Las Entregas 8 (cumplidos) y 26 (preflight) pasan al
   build 12**, que de todas formas va a hacer falta con la licencia paga.
3. **El deploy a prod lo corre el CTO** con `! scripts/deploy-gcp.sh <tag>`, en el paso 5.
4. Siguen vigentes las decisiones del 2026-09-23: radio 150 m / 40 m, paquete
   `com.quivotech.conductor.app`, drenar cada teléfono antes de desinstalar, y la palanca D y la
   captura a 30 m fuera de este APK.

## Reglas anti-loop (obligatorias en este plan)

- **Una sola vuelta de review por rama.** `/code-review` → fixes con un Sonnet nuevo → **no hay
  segundo review completo.** El chairman verifica que cada fix ataque su hallazgo (lee el diff y
  corre tsc, tests y lint) y se mergea.
- **Solo bloquea un hallazgo `high`** que sea un bug demostrable en un camino real (el que
  recorre un chofer). Los `medium`/`low` y los caminos hipotéticos van a `docs/deuda-abierta.md`
  con archivo:línea, y no se tocan en este build.
- **Nada de alcance nuevo en una rama después de su review.** Si aparece algo, se registra como
  ticket.
- **Timebox:** si una rama no se mergea en su día asignado, el chairman lleva al CTO la opción
  de sacarla del build. No se sigue parchando.
- **Handoff:** se actualiza **dentro del PR de código** que cierra cada paso. Un PR de solo
  handoff se abre solo si la sesión termina sin ningún merge.
- **Codex:** lo que se mergee antes del 2026-09-27 15:46 queda "no verificado". Cuando Codex
  vuelva, se corre `verify-fix` retroactivo sobre lo mergeado, con la misma regla: solo bloquea
  un `masks_symptom` en un camino real.
- **La prueba en teléfono se hace una sola vez, sobre el RC completo** (paso 6), no rama por
  rama. En esa etapa CI y review son el gate de cada rama.
- Máximo 3 Sonnet en paralelo. Cada uno en su worktree. Nunca `checkout` ni `stash` en el
  directorio principal.

## Pasos

| # | Paso | Quién | Día objetivo |
|---|---|---|---|
| 1 | Posición: `git revert` de los 6 commits en `-movil-posicion`, `git merge origin/main`, tsc/tests/lint, PR, CI, merge | chairman (revert permitido) | 09-26 |
| 2 | Anuncio: `git merge origin/main` (trae posición), resolver conflictos (Sonnet), **una** vuelta de `/code-review` con foco en el merge vs #80, fixes, PR, merge | Sonnet + chairman | 09-27 |
| 2' | Mapa offline, en paralelo al 2: `git merge origin/main`, `/code-review` corto, PR, merge después de anuncio | Sonnet + chairman | 09-27 |
| 3 | Entrega 28, rama `fix/sesion-no-vigente`: la API responde `SESION_NO_VIGENTE` al rechazar el refresh; el móvil corta sin ráfaga, borra los tokens y va al login; la siembra cierra sus sesiones de verificación. Gates: `/code-review` + `/security-review` (+ `verify-fix` si Codex volvió) | Sonnet + chairman | 09-28/29 |
| 3' | Entrega 9, en paralelo al 3: ref `ultimoMostrado` en `control-feedback-toast.tsx`, con test | Sonnet | 09-28 |
| 4 | `verify-fix` retroactivo sobre 1, 2 y 2' (Codex) | chairman | 09-28 |
| 5 | **Deploy a prod** de `main` (API de #65/#70/#74/#80/#92; migraciones de #74 y #80 — la 28 no trae): preflight ya hecho (retome de la 3.ª sesión del 09-25). `gcloud run jobs update quivo-migraciones ... --task-timeout=1800` y `! scripts/deploy-gcp.sh <tag>`. Después, el recompute de `docs/runbooks/retencion-gps.md` | **CTO** + chairman | 09-29 |
| 6 | **Lista de features y fixes al CTO** (memoria `apk-build-11-changelog-antes-de-lanzar`). Con el OK: `eas build --platform android --profile production` = RC. Se instala en **1 teléfono de prueba** | chairman + CTO | 09-30 |
| 7 | **Prueba única en teléfono** con el checklist de abajo. Si falla algo bloqueante: un fix (Sonnet), un build nuevo, y se repite solo el ítem que falló | chairman + CTO | 10-01/02 |
| 8 | Distribución: drenar cada teléfono ("0 pendientes" + conteo de `gps_points`), desinstalar el viejo e instalar el RC aprobado. Recorrido de campo con 2 o más choferes | CTO | ≤ 10-10 |

## Runbook de los pasos 5 y 6 (orden fijo, 2026-09-26)

**Correcciones de premisa** (verificadas en git el 2026-09-26):
- La Entrega 28 **no trae migración**. Solo cambia el body del 401 del refresh: suma
  `codigo: SESION_NO_VIGENTE` y sigue siendo `UnauthorizedException`. El build 10 no se rompe
  porque lo trata como un 401 genérico. Las migraciones pendientes en prod son
  `20260922100000_gps_sesion_resumen` (#74, con un backfill sin filtro sobre todo `gps_points`) y
  `20260923090000_refresh_token_hash_anterior` (#80, ADD COLUMN nullable). Las dos son aditivas.
- El estado de prod está **sin verificar desde el 2026-09-23**. Esta máquina no tiene credenciales
  de `gcloud` ni de `eas`: `gcloud run services describe` pide cuenta y `eas build:list` falla.
- **El recompute no tiene camino ejecutable.** `docs/runbooks/retencion-gps.md` da el SQL pero no
  dice cómo correrlo: Cloud SQL solo tiene IP privada y la imagen no trae `psql`. Además, el SQL
  tiene comillas simples, así que meterlo en `node -e '…'` dentro de `--args` se rompe.

### Preparación (antes del día del deploy) — 1 PR, Sonnet

| # | Qué | Por qué |
|---|---|---|
| P1 | `scripts/recompute-resumen-gps.sh`: `gcloud run jobs execute quivo-migraciones --wait` con `--args` sobre el delimitador `^%%^`. El SQL del runbook va en base64 dentro del script (sin comas, `%%` ni comillas); en el contenedor se decodifica a `/tmp` y se corre con `pg` desde `/app/packages/db`, como `ROTATE_JS`. Imprime la cantidad de filas afectadas | Sin esto el paso 5 no se puede cerrar |
| P2 | `--task-timeout=1800` en `JOB_COMMON_FLAGS` de `scripts/deploy-gcp.sh` | Si el job se recrea, el timeout vuelve a 10 min. Si el backfill supera ese límite, Prisma marca la migración como fallida (P3009) y bloquea todo deploy posterior |

Gate: `/code-review` en una sola vuelta y `bash -n`. No se puede probar contra prod antes del
día D. En el primer uso, el chairman lee el log de la ejecución.

### Paso 5 — deploy de `main` a prod (el CTO corre; el chairman verifica solo en lectura)

Ventana: de noche en Bolivia, sin choferes en ruta. Así se achica el hueco que corrige el recompute.

1. `! gcloud auth login` (cuenta `cloud@tuquivo.com`) y `! gcloud config set project quivo-control-prod`.
2. **Preflight del chairman** (solo lectura): revisión e imagen actuales de `quivo-api`,
   `quivo-web` y `quivo-worker`, más el timeout actual del job. Se anotan la revisión y el
   digest actuales, porque son el punto de rollback. Si prod no está en `63a0b51`
   (`quivo-api-00006-qsn`), se para y se revisa el diff real contra `main`.
3. `! gcloud run jobs update quivo-migraciones --project quivo-control-prod --region southamerica-west1 --task-timeout=1800`.
   Hace falta aunque P2 ya esté mergeado: el script actualiza el job con la imagen nueva, y
   este comando asegura el timeout antes de la primera corrida.
4. `! scripts/deploy-gcp.sh b11-20260929`, **sin `--solo`**. El script completo migra antes del
   worker nuevo; con `--solo worker` suelto, cada lote falla con
   `relation "gps_sesion_resumen" does not exist`.
5. **Verificación del chairman**, en lectura:
   - La ejecución del job de migraciones termina `Succeeded`.
   - Las revisiones nuevas de api, web y worker tienen el 100 % del tráfico.
   - `GET /health` responde 200.
   - Los logs del worker no muestran `relation … does not exist` ni errores de `insertarGpsPoints`.
   - `/sync/batches` sigue en 2xx para los teléfonos del build 10.
   - `/en-vivo` en prod muestra todos los vehículos (#83).
6. `! scripts/recompute-resumen-gps.sh` (P1), **apenas el worker nuevo está vivo**. Es
   idempotente: si hay duda, se corre otra vez.
7. El handoff pasa a "Producción = `main@<sha>`, tag `b11-20260929`" y se registra la cantidad de
   filas del recompute.

**Rollback:** `gcloud run services update-traffic quivo-api --to-revisions=<revisión anotada>=100`
(lo mismo para web). Para el worker, `scripts/deploy-gcp.sh <tag anterior> --solo worker`.
Las migraciones no se revierten: son aditivas y el código viejo las ignora. Si el worker viejo
vuelve a correr, hay que repetir el recompute después del roll-forward.

### Paso 6 — changelog, decisión y RC

Orden recomendado: **paso 4 (verify-fix con Codex, desde el 2026-09-27 15:46) antes del RC.**
Si Codex encuentra un `masks_symptom` después de compilar, hace falta un segundo build y el
plan tiene margen para uno solo. El deploy (paso 5) no depende del paso 4.

1. **El chairman presenta el changelog** (el borrador está abajo). El CTO elige entre dos opciones:
   - Sale así.
   - Suma alcance. En ese caso se vuelve a un paso 3 nuevo con las mismas reglas anti-loop, y el
     RC se corre de fecha.
2. **Chequeos antes del build** (chairman, necesita `! eas login` si no hay sesión):
   - CI verde en `main`.
   - `eas env:list --environment production` muestra `TRANSISTORSOFT_LICENSE_KEY`.
   - La fecha del build es ≤ 2026-10-25.
   - `app.config.ts` tiene el paquete `com.quivotech.conductor.app`.
   - `EXPO_PUBLIC_API_URL` en `eas.json` es la URL de Cloud Run.
   - El paso 5 está cerrado. Es un gate duro: sin la API nueva, la Entrega 28 no se puede probar
     en el paso 7.
   - Se anota el commit y el `versionCode` del build 10 (`eas build:list`), para confirmar la
     base del changelog.
3. `cd apps/mobile && eas build --platform android --profile production`. El `versionCode` se
   autoincrementa en remoto.
4. Se registran el build id, el `versionCode`, el commit y la URL del APK. Se corre
   `aapt dump badging` sobre el APK: el paquete debe ser `com.quivotech.conductor.app`.
5. Se instala en **1 teléfono de prueba**. Como el paquete es nuevo, el APK se instala **al lado**
   del viejo, no encima. Ese teléfono no debe tener el build 10 con un recorrido activo, porque
   habría dos trackers a la vez. Si lo tiene, primero se drena y se desinstala.

### Borrador del changelog (APK 11 frente al build 10)

La base es el estado de prod del 2026-09-09. Falta confirmar el commit del build 10 (punto 2).

Móvil:
- **#80:** drenado GPS en background; la sesión móvil se mantiene entre la UI y el headless;
  paquete nuevo `com.quivotech.conductor.app`; permiso `ACTIVITY_RECOGNITION`.
- **#87 (Entrega 31a):** posición en vivo con movimiento reafirmado, tracking inmediato al
  Comenzar y orden inicio/fin garantizado.
- **#89 (Entregas 1–7, 7b):** anuncio de puntos de control. Confirma a 40 m, detecta a 150 m y
  no repite el aviso.
- **#88 (Entrega 25):** mapa offline con handshake de mapa listo, tiles por zoom y reintento al
  volver la red.
- **#91 (Entrega 9):** el toast de confirmación no se repite para el mismo punto y pasada.
- **#92 (Entrega 28):** con la sesión vencida o revocada, la app corta sin ráfaga de reintentos.
  Si hay un recorrido activo, pide Finalizar antes de ir al login; nunca corta el GPS en vivo.
- **Por confirmar:** si `04b14ed` (muestreo cada 15 m, del 2026-09-09) ya estaba en el build 10.

Servidor (entra con el paso 5, no con el APK):
- **#65 y #83:** `/en-vivo` con todos los vehículos, filtro por línea y placa legible.
- **#70:** coerción de fechas en los filtros de `@Query()`.
- **#74:** resumen por sesión para el mapa en vivo, con migración y recompute.
- **#80:** el logout acepta `deviceId` y hay una columna nueva para el hash anterior del refresh token.
- **#92:** el 401 del refresh lleva `codigo: SESION_NO_VIGENTE`.

Fuera del build: las Entregas 8 y 26 pasan al build 12, junto con el resto de "Fuera del
build 11" (más abajo).

Sin verificar al compilar:
- `verify-fix` de #87, #88, #89 y #92, si el paso 4 no corrió antes.
- Ninguna rama se probó en un teléfono; eso se cubre en la prueba única del paso 7.

## Checklist de la prueba única (paso 7)

Bloqueante (si falla, no se distribuye):
- `aapt dump badging` muestra `com.quivotech.conductor.app`. El log del SDK no muestra error de
  licencia.
- El APK apunta a la URL de Cloud Run y llega un evento de Sentry del build release.
- Login, Comenzar y Finalizar funcionan. Con 10 min de pantalla apagada y en movimiento, el
  marcador avanza en `/en-vivo`.
- El anuncio suena en background a ~40 m, sin doble sonido, y la detección queda registrada a
  ≤150 m.
- Con modo avión, el recorrido sigue grabando; al volver la red, sincroniza.
- Con la sesión revocada desde el servidor, la app va al login sin ráfaga de reintentos
  (Entrega 28).

No bloqueante (se anota y va a deuda):
- El mapa con modo avión no queda gris y los tiles se reintentan al volver la red.
- Iniciar y finalizar rápido, doble toque.

## Fuera del build 11 (registrado, no se hace)

- Entregas 8 y 26 (build 12). Entregas 11, 15–24, 27, 29 y 30.
- Rediseño iniciar/detener (`3afc6c0`..`fe4090c`): queda en el historial de la rama por si
  Sentry muestra el cuelgue en campo.
- Palancas de costo A–F, proveedor de tiles, export de facturación y k6 contra prod.
- Antes de pasar de piloto a despliegue amplio: licencia paga, tiles pagos y la Entrega 30.

## Criterio de hecho

Build distribuido en los teléfonos del piloto y recorrido de campo con sync p95 ≤ 5 min y
≥ 90 % de puntos de control detectados. Handoff actualizado y este plan marcado como hecho.
