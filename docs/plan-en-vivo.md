# Plan — /en-vivo: solo la jornada de hoy + rediseño visual (aprobado 2026-10-22)

## Contexto
En el piloto, /en-vivo mostraba trufis en la última posición de otro día. Causa (verificada en código):
`apps/api/src/modules/reportes/en-vivo.service.ts`
- `obtenerPosiciones` (WHERE ~579-582): `so.inicio >= ahora-24h OR (so.fin IS NULL AND so.estado='activa')`.
  La rama OR no tiene tope de edad; la app no cierra la sesión de login y ningún job cierra sesiones colgadas.
  Hoy en prod hay 5 sesiones de L16 del 21/10 en ese estado.
- `listarHoy` (WHERE ~399-400): misma rama OR.
- `resumenMolinos` (vueltas.service) ya acota a la jornada de hoy: no se toca.

Decisiones del CTO (22/10):
- /en-vivo = jornada boliviana de hoy (00:00 BO = 04:00Z). Lo de días anteriores, en `/reportes/recorridos` (ya existe, con detalle `/reportes/recorridos/[id]`).
- Las sesiones de hoy que ya terminaron siguen visibles, en gris (`finalizado`, ya se pinta así).
- Una sesión que empezó ayer pero mandó GPS hoy (cruce de medianoche) se muestra.
- Rediseño visual completo de /en-vivo (bake-off, regla 7.b/7.c "Rediseño UI existente").

Se hace en **dos PRs**: el corte de datos no espera a la decisión estética.

## PR 1 — `fix(en-vivo): mostrar solo sesiones de la jornada de hoy` (Sonnet)
Regla única para `obtenerPosiciones` y `listarHoy`:
```
so.inicio >= inicioDeJornadaBolivia(hoy)
OR EXISTS (SELECT 1 FROM gps_sesion_resumen gr WHERE gr.<sesion> = so.id AND gr.jornada = <hoy>)
```
- Reusar `fechaActualBolivia` / `inicioDeJornadaBolivia` (`packages/shared/src/tiempo/jornada.ts`) y los nombres de columna del LATERAL existente a `gps_sesion_resumen`.
- Borrar `VENTANA_SESIONES_POSICIONES_MS` si queda sin uso; actualizar el comentario de ~186-209 (cruce de medianoche ahora se cubre con "GPS hoy").
- El `ORDER BY (so.fin IS NULL) DESC` deja de priorizar zombis: mantenerlo, ya no entran.
- Ver que el índice de `gps_sesion_resumen` cubra (sesión, jornada); si no, nada nuevo en este PR, anotarlo.
- Tests (`en-vivo.service.test.ts`, Postgres real):
  - invertir los casos que hoy afirman que el zombi aparece (~581-594 en `listarHoy`, ~810 en `obtenerPosiciones`): zombi sin GPS hoy **no** aparece;
  - nuevo: empezó ayer + GPS hoy → aparece; cerrada hoy → aparece como `finalizado`; cerrada ayer → no aparece;
  - revisar los casos de medianoche (~860-1067) y `en-vivo.resumen-equivalencia.test.ts`.
- Web: el texto del estado vacío ("jornada de hoy") pasa a ser cierto; sin cambios en PR 1.
- Gate: `/code-review` + `/ponytail-review` + `/codex-debug verify-fix` (si Codex sin cuota: "no verificado"). Deploy de API lo corre el CTO.

Fuera de alcance (anotar en handoff): no hay job que cierre sesiones de login colgadas; `salidas/fila-datos.ts:81` filtra solo `estado='activa'` y podría contar zombis.

## PR 2 — Rediseño de /en-vivo (bake-off)
1. **Auditoría del incumbente:** capturas reales de /en-vivo (playwright/puppeteer, local con datos sembrados o prod en solo lectura) + `impeccable critique` + `redesign-existing-projects`. Hallazgos ya conocidos:
   - 42 `style={{}}` en `page.tsx` (+22 `panel-jornada`, +9 `panel-frescura`) frente a las clases `.qv-live-*`;
   - colores sueltos `#ffffff` (`page.tsx` 821/1003/1029), `#f59e0b`/`#94a3b8` (`map-builders.ts`, WebGL no resuelve `var()` y no sigue modo oscuro);
   - no hay leyenda de estados de frescura; `PanelJornada` duplicado (flotante y en el estado vacío);
   - no hay lista de vehículos, solo marcadores; ningún acceso a "días anteriores".
2. **Brief compartido:** lookup `ui-ux-pro-max` ("dashboard operación transporte tiempo real mapa") + tokens `--qv-*` de `packages/design-system/src/tokens.css` + `docs/categorizacion-colores-y-estados.md`.
3. **Dos propuestas en paralelo (Sonnet):** A = `redesign-existing-projects` (+ estilo que encaje), B = `impeccable` new-work. Cada una = Artifact HTML con datos de ejemplo (mapa simulado, 6 estados de frescura, alertas, panel de vehículo, Molinos, jornada, link a recorridos).
4. **Deliberar:** las dos URLs con pros y contras; `/council` si hace falta. **El CTO elige** A, B o una mezcla.
5. **Plan de implementación** de la dirección elegida (se agrega a `docs/plan-en-vivo.md`), implementación con Sonnet en `apps/web/app/(dashboard)/en-vivo/*` y en `.qv-live-*` del design-system.
   Restricciones: mantener `RouteMap` del design-system, los polls y hooks de `src/lib/en-vivo/*`, `aria-live`, estado por forma y color, y el link a `/reportes/recorridos/:id`.
6. **Verificar en vivo:** playwright (interacción + árbol a11y) + capturas para el CTO, en claro y oscuro, y en ancho de laptop.
7. **Gate:** `web-design-guidelines` + `impeccable audit` + `/code-review` + `/ponytail-review`.

## Archivos críticos
- `apps/api/src/modules/reportes/en-vivo.service.ts`, `en-vivo.service.test.ts`, `en-vivo.resumen-equivalencia.test.ts`
- `packages/shared/src/tiempo/jornada.ts` (solo reuso)
- PR 2: `apps/web/app/(dashboard)/en-vivo/{page,panel-vehiculo,panel-frescura,panel-vuelta,panel-jornada,hud-molinos,map-builders}.tsx|ts`, `packages/design-system/src/styles.css` (`.qv-live-*`), `tokens.css`

## Verificación
- PR 1: tests de la API contra Postgres (DATABASE_URL de `apps/api/.env`), `tsc`. Después del deploy: `GET /v1/reportes/en-vivo/posiciones` no trae las 5 sesiones de L16 del 21/10 (script de solo lectura del scratchpad).
- PR 2: capturas antes y después, a11y con playwright, tests de `map-builders` y `src/lib/en-vivo/*` en verde.

## Al aprobar
Volcar este plan a `docs/plan-en-vivo.md` + puntero en `docs/handoff.md` (regla 8), y arrancar el PR 1.
