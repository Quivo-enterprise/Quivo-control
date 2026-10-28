# Plan — Scan E2E completo de `/en-vivo` (admin) + app conductor

## Context
CTO reporta bugs en `/en-vivo`: filtro L16 oculta todos los trufis y no muestra la ruta; sospecha de bugs visuales, botones no conectados y sesiones muertas (zombis, anotado en handoff). Pide barrido real con Playwright + emulador Android, no lectura de código.

Hallazgos previos (lectura de código, sin ejecutar):
- Filtro línea: `page.tsx:98` compara `p.lineaId === lineaFilter`, ambos uuid de `lineas.id`. No hay mismatch de tipos. Causa probable: datos (vehículo sin sesión visible, `lineaId` resuelto vía `asignaciones.rutaId -> rutas.lineaId` apunta a otra ruta/línea, dedupe por vehículo en `en-vivo.service.ts:565-572` se queda con sesión de otra línea) o `/lineas` fallando en silencio (`use-linea-options.ts:44` `.catch(() => {})`).
- **"Elegir L16 y ver su ruta" no existe**: la ruta solo se dibuja tras clickear un vehículo (`GET /reportes/en-vivo/:sesionId/contexto`, `map-builders.ts:11`). Con 0 vehículos filtrados nunca hay ruta. Es feature faltante, no bug del filtro.
- Zombis: `sesionesVisiblesSql` (`apps/api/src/common/sesiones/vigencia.ts:49-64`) muestra toda sesión iniciada hoy aunque nunca mandó GPS o esté colgada; job `cerrarSesionesVencidas` tuvo 3 fallos por timeout de transacción Prisma 5 s; `salidas/fila-datos.ts:81` filtra solo `estado='activa'`.
- Pendientes handoff: verificación E2E post-#267, "Sin señal" con vehículo quieto (latido nativo), marcador atrasado vs SR, numeración PC panel≠app con Molinos, marcador antes de SR en detalle, variante designada nunca verificada a la vista.
- Código muerto: `filtrarPorLinea` (`map-builders.ts:96`), `useSesionesEnVivo` / `enVivoApi.listar`. "Quitar filtros" no limpia el filtro de línea.
- Cero tests Playwright de `/en-vivo` (solo `tests/acceptance/admin-panel.spec.ts`).

Decisiones CTO (esta sesión): entorno **local para todo lo que escribe + prod solo lectura**; ruta-al-filtrar = **feature**; alcance = **scan → reporte → fixes en PRs** (CTO prioriza entre fases).

## Fase 1 — Levantar entorno local
1. `docker compose up -d` (PostGIS :5434, Redis :6380, OSRM :5001); `prisma:migrate:deploy` + `prisma:seed`. Verificar que el seed tenga L16 con geometría; si no, correr `scripts/cargar-linea-*` correspondiente.
2. API `:3001` + web `:3100` (`pnpm dev` o filtros por app). Credenciales web demo: `docs/dev/credenciales-demo.md`.
3. Conductores de prueba locales: seed (`MOBILE_SEED_*`) o `scripts/crear-credenciales-piloto.ts` contra DB local.
4. Emulador `quivo_trufi2` (+ `quivo_trufi3` para 2 vehículos). APK: verificar con `strings` a qué API apunta `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`; si no es `10.0.2.2:3001`, correr dev client con Metro y `EXPO_PUBLIC_API_URL=http://10.0.2.2:3001` (debug permite cleartext). GPS: `mobile_set_location` / `adb emu geo fix` reproduciendo `apps/mobile/src/features/operacion/fixtures/l16-piloto-trazas.json`.
5. Simulador headless complementario (subagente Sonnet, script en scratchpad, no en repo): N vehículos vía endpoint de ingesta GPS móvil con token, para tener L16 + otra línea + vehículo quieto + sesión zombi a la vez. Localizar ruta exacta del ingest en `apps/api/src/modules/*gps*`.

Bloqueo posible: Transistorsoft en debug; si GPS nativo no arranca, el simulador headless cubre el panel y el emulador solo cubre flujo UI de la app.

## Fase 2 — Barrido con Playwright (chairman verifica, subagentes ejecutan)
Matriz de escenarios sobre `/en-vivo` local, con screenshot + consola + network por cada uno:
- **Filtro línea**: modo segmentos (≤4 líneas) y `Select` (>4); L16 con 0/1/N vehículos; vehículo seleccionado fuera del filtro (`page.tsx:137-144`); "Quitar filtros"; `/lineas` caído.
- **Controles**: cada botón de `barra-mando.tsx`, `panel-flota.tsx`, `panel-vehiculo.tsx`, `panel-vuelta.tsx`, `modulo-molinos.tsx`, `modulo-jornada.tsx` (Seguir, Reencuadrar, Actualizar, Siguiente alerta, atender/descartar/sancionar, copiar teléfono, Ver histórico, designar Molinos, PCs). Confirmar efecto real (request + cambio de UI).
- **Sesiones**: zombi de ayer (dentro/fuera de gracia 2 h), sesión de hoy sin GPS, sesión cerrada (`finalizado`, una por vehículo #267), vehículo quieto ("Sin señal"), logout de la app sin cerrar sesión.
- **Mapa**: ruta del seleccionado, variante en ámbar, marcador vs PC/SR, numeración PC panel vs app (emulador al lado).
- **Visual/a11y**: desktop + 1280 + mobile width, dark/light si aplica; `web-design-guidelines` + `impeccable audit` sobre los componentes (regla 7, caso "solo auditoría").
- **Prod solo lectura**: login lo hace el CTO en el navegador de Playwright (password no está en disco); mirar `/en-vivo` con datos reales, filtro L16, network de `/posiciones` y `/lineas`. **Prohibido** clickear atender/descartar/sancionar/designar/logout-de-otros en prod.
- SQL solo lectura local (y prod si el CTO da acceso) para cruzar: sesiones visibles vs `fin`, `lineaId` de cada vehículo L16, fallos de `marcarVencidas`.

Reparto: chairman (Opus) orquesta y diagnostica inline; 2 subagentes Sonnet en paralelo (A: filtro/mapa/sesiones; B: controles/visual), cada uno con su propia instancia de navegador y lista de escenarios; resultados en `docs/qa-en-vivo-2026-10-27.md`.

## Fase 3 — Reporte
Publicar reporte priorizado (P0 roto en piloto / P1 bug / P2 visual / P3 deuda) como Artifact + volcado a `docs/qa-en-vivo-2026-10-27.md` y puntero en `docs/handoff.md`. Cada hallazgo: repro, screenshot, causa (verificada o hipótesis marcada), fix propuesto, tamaño. **Parar y que el CTO priorice.**

## Fase 4 — Fixes (tras priorizar)
PRs chicos por grupo, cada uno: subagente Sonnet implementa + test (Playwright de `/en-vivo` nuevo en `tests/acceptance/en-vivo.spec.ts` que cubra el escenario) → `/code-review` + `/ponytail-review` (+ `/codex-debug verify-fix` en `fix:`, `/security-review` si toca endpoints) → fixes en Sonnet nuevo → CI (`ci` y `acceptance` en pass) → merge → handoff.
Grupos previstos:
1. Bug filtro L16 (según causa encontrada).
2. Feature ruta-por-línea: al elegir línea dibujar trazado + PCs aunque no haya vehículos. Reusar `construirRutas` (`map-builders.ts`) y el endpoint de geometría de ruta existente (`RutaControlPointsController` / lineas) antes de crear uno nuevo; diseño Opus inline antes de implementar.
3. Sesiones zombis: visibilidad de sesión sin GPS, timeout de `marcarVencidas`, `fila-datos.ts:81`.
4. Controles/visual/deuda (código muerto, "Quitar filtros", silencios de error).
Cambios que toquen app móvil o geometría L16: revisar sesiones activas en prod antes (memoria) y changelog al CTO antes de cualquier APK/OTA.

## Verificación
- Cada escenario de Fase 2 con evidencia (screenshot/network/SQL); "no verificado" explícito donde no se pudo.
- Tras fixes: `pnpm typecheck`, `pnpm --filter @quivo/web test`, tests API de `reportes`, `pnpm test:acceptance` (incluye nuevo spec `/en-vivo`), re-run de la matriz Playwright local, y re-chequeo en prod solo lectura post-deploy (deploy lo corre el CTO).
