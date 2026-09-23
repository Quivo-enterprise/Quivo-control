# Plan — APK conductor build 11 y puesta en marcha de Quivo Control

## Contexto

Objetivo: poner Quivo Control en operación real. El APK que está en los teléfonos es el build 10 (`04b14ed`, piloto del 2026-09-09, según Sentry). El plan post-piloto (`docs/plan-correccion-post-piloto-2026-09-09.md`) define un bloque "P0, un solo APK", y nada de ese bloque está en `main`:
- El trabajo vive en 4 ramas móviles, frenadas desde el 2026-09-11.
- Las 4 tienen veredicto Codex `partial`, una tiene `tsc` en rojo y todas van 34 commits detrás de `main`.
- Producción también tiene pendientes: no está confirmado que #74 esté desplegado, el recompute no corrió y la rama de drenado trae una migración nueva.

Decisiones del CTO (2026-09-23):
- **Alcance: P0 completo.** Cerrar las 4 ramas (Entregas 1–7, 7b, 25, 31) más las Entregas 8, 9, 26 y 28.
- **Radio: detectar a 150 m y confirmar a 40 m** (`RADIO_CONFIRMACION_M = 40`). Cierra la decisión abierta #1.
- Palanca D (sync a 60 s) y captura a 30 m: **quedan fuera** de este APK.

Primer paso al salir de plan mode: volcar este plan a `docs/plan-apk-build-11.md` y agregar el puntero en `docs/handoff.md` (regla 8).

## Reglas de ejecución

- El chairman (Opus) orquesta, revisa y verifica. Todo el código lo escriben subagentes Sonnet, cada uno en su worktree existente (`../Quivo-control-<nombre>`). Nunca `checkout` ni `stash` en el directorio principal.
- **Como máximo 3 agentes Sonnet a la vez.** Con más, el límite de uso los cortó (handoff).
- Si un agente se corta por límite de uso: `git status` en su worktree y auditar el diff antes de seguir.
- Gate por rama antes del merge:
  - tests y `tsc` en verde;
  - `/codex-debug verify-fix` sin `partial` ni `masks_symptom` (o con justificación explícita al CTO);
  - `/code-review`;
  - `/security-review` en drenado (logout y migración) y en la Entrega 28 (auth).

## Fase 0 — Operativo y desbloqueo (chairman + CTO, en paralelo a la Fase 1)

1. **El CTO corre `! gcloud auth login`.** La credencial está vencida y hoy no se puede leer qué revisión corre en prod.
2. Comparar la revisión desplegada de `quivo-api` y `quivo-worker` con `main`. Si falta #74:
   - desplegar con `scripts/deploy-gcp.sh` (orden fijo; las migraciones corren en el Job `quivo-migraciones`);
   - después, correr una vez el recompute de `docs/runbooks/retencion-gps.md` (sección `gps_sesion_resumen`).
3. **Entrega 0a:** backup de `scripts/.estado-siembra-produccion.json` fuera del repo.
4. **Entrega 0b:** cerrar las sesiones fantasma y zombis con `UPDATE`, nunca `DELETE`. Escribe en producción: pide OK explícito del CTO en el momento de correrla.

## Fase 1 — Cerrar las 3 ramas base (3 agentes Sonnet en paralelo)

Los huecos salen del handoff (`docs/handoff.md:181-302`) y de los reportes de Codex en `~/.claude/codex-debug-state/20260911-*verify-fix*.json`.

**Agente A — `fix/movil-drenado-background`**
- **G1 (carrera de refresh entre contextos):** refresh bajo un lease de SQLite `refresh-sesion`. Dentro del lease, releer SecureStore; el 401 se cuenta recién después de releer (`use-auth-movil.ts:543-591`). Test con dos "runtimes" y barreras que fuercen ambas lecturas del token viejo.
- **G2 (solo el refresh escribe tokens):** `actualizarSesionMovil` con relectura y fusión, sin tocar nunca los tokens (`use-auth-movil.ts:172,212`, `sesion-movil-store.ts:19`).
- **G3 y R:** justificarlos en el código y en el PR.
- **Rebase sobre `main`:** conflicto en `schema.prisma`. La migración `20260910070000_refresh_token_hash_anterior` tiene que quedar **después** de `20260922100000_gps_sesion_resumen` en el orden; si hace falta, renombrar el timestamp.

**Agente B — `fix/movil-anuncio-puntos-control`**
- Auditar el diff de `6e4f285` contra G1, G2 y R1. No continuarlo a ciegas: es un commit de preservación sin revisar.
- Arreglar `anuncio-punto-control.test.ts:386` (`puntosRearmados` pasa a `puntosRearmadosVoz`).
- Rearme (`anuncio-punto-control.ts:307`): no limpiar la marca mientras el vehículo siga dentro de `RADIO_AVISO_M`.
- Visita pendiente (`headless-task.ts:299`): persistirla antes de aplicar el estado en memoria; si falla, invalidar el tick.
- `eventId` estable a partir de `{sesionId, puntoControlId, pasada}`.
- **R2:** la transacción de `db/outbox.ts` va dentro de la recuperación de handle.
- **Nuevo:** `RADIO_CONFIRMACION_M = 40` en `packages/shared` (decisión #7), para el anuncio. La detección sigue en 150 m.
- Test del recorrido completo con radio de detección menor que `RADIO_AVISO_M`.

**Agente C — `fix/movil-mapa-offline`**
- Handshake de mapa listo: el HTML emite `mapa-listo` después de registrar sus listeners, y RN responde con el estado actual (`route-map-view.tsx:78-97`).
- Tiles: armar la URL con `coords.z`, o descartar los tiles fallidos de otro zoom.
- Probar con red y en modo avión.

El chairman cierra cada rama: verify-fix → revisión → PR → CI → merge. **Orden de merge obligatorio: drenado → posición → anuncio → mapa offline.**

## Fase 2 — Posición, web y entregas nuevas (hasta 3 agentes)

**Agente D — `fix/movil-posicion-en-vivo`**
- Rebasar sobre drenado ya mergeado. Esta rama **no** contiene `fe36953`.
- **G1:** reafirmar el movimiento con `getState().isMoving` en el heartbeat y al volver a primer plano, sin depender de `onMotionChange` (`seguimiento-continuo.ts:116`).
- **G2:** poner `tracking=true` apenas `start()` resuelve, separar el estado de almacenamiento y dejar "Finalizar" siempre disponible (`use-gps-operativo.ts:772`).
- **R1:** serializar la restauración de `disableStopDetection` con el siguiente `iniciar()`.

**Agente E — `feat/web-mapa-todos-vehiculos`**
- Rebasar y revisar el cambio de significado de `totalPuntos` que trajo #74.
- `/code-review` + `web-design-guidelines`, PR.
- No comparte archivos con las ramas móviles: se mergea en paralelo.

**Agente F — rama nueva `feat/movil-cumplidos-preflight`** (sale de `main` cuando anuncio ya esté mergeado)
- **Entrega 8, lista de puntos cumplidos:**
  - leer los cumplimientos desde el outbox con `obtenerEventosPorTipo`;
  - sembrar la lista al montar con el patrón `semillaPromise` (`use-gps-operativo.ts:176-180`);
  - historial de la jornada separado del Set de la vuelta actual (`proximo-punto-control.ts:31-38`);
  - ampliar `next-control-sheet.tsx` y agregar el contador "12 / 26".
- **Entrega 9:** deduplicar el toast con un ref `ultimoMostrado` en `control-feedback-toast.tsx:37-40`.
- **Entrega 26, preflight de captura:**
  - lógica pura nueva en `apps/mobile/src/gps/preflight-captura.ts`, con la misma forma que `decidirPermisoGps` (`permiso-ubicacion.ts`);
  - cubrir las 8 fallas de la tabla del plan (`plan-correccion...:774-828`);
  - notificación persistente desde headless si `puntosControl.length === 0` con sesión vigente (`headless-task.ts:358`);
  - suscribir `onProviderChange` para detectar fallas a mitad del recorrido;
  - arranque local-first: leer el caché antes del fetch en `use-paquete-dia.ts:33-38`.

## Fase 3 — Entrega 28 (API + móvil, después de drenado)

- Rama nueva `fix/sesion-no-vigente`.
- La API responde un código distinguible, `SESION_NO_VIGENTE`, cuando rechaza el refresh.
- El cliente corta sin ráfaga de reintentos, borra los tokens y va al login (decisión #10).
- Evidencia: Sentry `QUIVO-CONTROL-CONDUCTOR-2`.
- Gates: `/security-review` + verify-fix.

## Fase 3b — Cambio de nombre de paquete (licencia Transistorsoft)

Pedido del CTO (2026-09-23): la licencia trial de Transistorsoft para `com.quivotech.conductor` ya venció. Se va a pedir otra de 30 días para un nombre de paquete nuevo, así que el paquete se cambia **antes** de construir el build 11.

**Objeción registrada (regla 0), una sola vez:**
- Para operación real, un trial de 30 días es una fecha de vencimiento en medio de la operación. Si vence, el tracking de un build release sin licencia válida deja de funcionar.
- Cambiar el paquete para encadenar trials solo es aceptable si Transistorsoft lo sabe y lo concede. Si no, es un riesgo de términos de licencia.
- Recomendación: comprar la licencia antes de ampliar a más choferes que un piloto. Así el cambio de paquete pasa a ser el último.

**Consecuencias técnicas:**
- **El APK nuevo no se instala encima del viejo.** Es otra app: el chofer tiene que desinstalar la anterior.
- Si el chofer desinstala con el outbox sin drenar, se pierde evidencia para siempre (no hay backfill). Antes de desinstalar, drenar cada teléfono: abrir la app vieja con red y confirmar "0 pendientes". Contar `gps_points` antes y después (mismo método que la Entrega 0a).
- Cambian tres cosas:
  - el **`applicationId`**;
  - las **credenciales de EAS**: keystore nuevo o reasignado al paquete nuevo (el `9zSZpTExKl` estaba ligado al viejo);
  - el **`versionCode`** remoto: verificar que siga subiendo.
- Los choferes tienen que volver a loguearse (el SecureStore es por app) y volver a conceder permisos: ubicación "todo el tiempo", batería, notificaciones, actividad. El preflight de la Entrega 26 los guía.

**Qué hay que tocar (agente Sonnet, rama propia):**
- `apps/mobile/app.config.ts:32` (`package`).
- `apps/mobile/src/shared/observability/sentry.ts:66` (fallback de `applicationId`).
- `apps/mobile/README.md:38`.
- Runbook `docs/runbooks/alta-de-conductor-android.md` y `docs/piloto/checklist-aceptacion-e2e.md`, si nombran el paquete o el proceso de instalación.
- Grep de control: `grep -rn com.quivotech.conductor` sin resultados fuera de `docs/archivo` y del handoff histórico.
- Revisar si alguna API key de Google Maps o tiles está restringida por paquete+SHA-1. Hoy no se encontró ninguna.

**Nombre decidido (CTO, 2026-09-23): `com.quivotech.conductor.app`.**

**Acciones del CTO:**
- ~~Elegir el nombre nuevo~~ Hecho: `com.quivotech.conductor.app`. La licencia se pide para ese nombre exacto.
- Pedir la key de 30 días.
- Actualizar el secreto de EAS `TRANSISTORSOFT_LICENSE_KEY` (entorno `production`).

**Verificación:**
- `aapt dump badging <apk>` muestra el paquete nuevo.
- En el teléfono, el log del SDK no muestra el error de licencia y hay tracking con la pantalla apagada en el build release.

**Timing:** los 30 días corren desde que se emite la key. Pedirla recién cuando las Fases 1–3 estén mergeadas, para no quemar días del trial esperando código.

## Fase 4 — Deploy y build

0. Fase 3b hecha: paquete nuevo en `main`, key nueva en el secreto de EAS y teléfonos drenados.
1. **La API va antes que el APK.** Deploy con migraciones (`refreshTokenHashAnterior` y la Entrega 28): un APK nuevo contra la API vieja rompe la rotación de refresh.
2. `eas build --platform android --profile production` → build 11, con el paquete nuevo. **No se instala encima del anterior:** primero drenar el teléfono, después desinstalar la app vieja e instalar la nueva. La CI no corre `eas build`: este es el primer chequeo nativo real.
3. En el APK instalado, confirmar que apunta a la URL de Cloud Run (no alcanza con `eas.json`) y que llega un evento de Sentry del build release.

## Verificación (gate de release, según `docs/piloto/checklist-aceptacion-e2e.md`)

- CI en verde: lint, typecheck, tests y `assert-bundle-singletons`.
- En un teléfono real (MCP `mobile` / adb):
  - **Background:** 10 min con la pantalla apagada y en movimiento; el marcador se mueve en `/en-vivo` (Entregas 2 y 31). El anuncio suena con la app en background (Entrega 7).
  - **Modo avión:** el mapa no queda gris (25); "Iniciar" se habilita en menos de 1 s (26); 3 puntos cumplidos siguen marcados después de matar y reabrir la app (8).
  - **Preflight:** con el permiso revocado por adb aparece el mensaje bloqueante; sin paquete del día, bloquea.
  - **Radio:** el anuncio llega a ~40 m y la detección queda registrada a ≤150 m.
- Campo: 1 recorrido real con 2 o más choferes antes de ampliar. Sync p95 ≤ 5 min y ≥90 % de puntos de control detectados.
- Cierre: handoff actualizado y `docs/plan-apk-build-11.md` marcado como hecho.

## Fuera de alcance (se registra, no se hace)

- Entregas 11, 15–24, 27, 29 y 30.
- Palancas de costo A–F.
- Proveedor de tiles, export de facturación a BigQuery y k6 contra prod.
- **Antes de pasar de piloto a despliegue amplio**, como mínimo: tiles pagos (OSM no permite uso de flota) y la Entrega 30 (OSRM / no dibujar la línea recta).
