# Plan — APK conductor build 11 (v2, 2026-09-26)

> **v2 reemplaza al plan del 2026-09-23** (queda en git: `56c88bf`). Motivo: en 3 días se
> mergearon 1 rama móvil (#80) y 1 web (#83), y hubo 4 PRs de solo handoff. La rama posición
> entró en loop: desde `79e832b`, que ya estaba revisado, sumó 6 commits y +2132 líneas
> persiguiendo un cuelgue hipotético de "Finalizar". Cada review sacó regresiones del fix
> anterior. Este plan corta ese loop con reglas duras y un alcance menor.

> **Estado (cierre del 2026-09-26):**
> - Pasos 1, 2 y 2' hechos: #87, #89 y #88 mergeados.
> - 3 (Entrega 28, acotada por decisión del CTO) y 3' (Entrega 9): código listo, sin PR.
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
| 5 | **Deploy a prod** de `main` (API con la migración de 28): preflight ya hecho (retome de la 3.ª sesión del 09-25). `gcloud run jobs update quivo-migraciones ... --task-timeout=1800` y `! scripts/deploy-gcp.sh <tag>`. Después, el recompute de `docs/runbooks/retencion-gps.md` | **CTO** + chairman | 09-29 |
| 6 | **Lista de features y fixes al CTO** (memoria `apk-build-11-changelog-antes-de-lanzar`). Con el OK: `eas build --platform android --profile production` = RC. Se instala en **1 teléfono de prueba** | chairman + CTO | 09-30 |
| 7 | **Prueba única en teléfono** con el checklist de abajo. Si falla algo bloqueante: un fix (Sonnet), un build nuevo, y se repite solo el ítem que falló | chairman + CTO | 10-01/02 |
| 8 | Distribución: drenar cada teléfono ("0 pendientes" + conteo de `gps_points`), desinstalar el viejo e instalar el RC aprobado. Recorrido de campo con 2 o más choferes | CTO | ≤ 10-10 |

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
