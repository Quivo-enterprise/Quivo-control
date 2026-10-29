# Plan — Cierre automático por inactividad + estado "Inactivo" en /en-vivo

## Contexto
1616PIB aparece en `/en-vivo` (card de flota y Atención) como **"Sin señal" hace 5 h 37 min**.
Causa verificada en código:
- `sesionesVisiblesSql` (`apps/api/src/common/sesiones/vigencia.ts:37`) muestra toda sesión que
  arrancó hoy, sin tope de inactividad.
- La sesión de login solo se cierra por logout o por `cerrarSesionesVencidas`
  (`apps/api/src/modules/rotaciones/rotaciones.service.ts:303`), que exige `venceAt` + 4 h, o sea
  ~04:00 BO del día siguiente.
- `clasificarFrescura` (`apps/api/src/modules/reportes/en-vivo.service.ts:237`) da `perdido`
  ("Sin señal", rojo, en Atención, cuenta en servicio) con ingesta > 15 min. Solo da `finalizado`
  si llegó `fin_recorrido` o si la sesión se cerró.
- **La app no tiene "Finalizar día"**: solo "Finalizar recorrido" (encola `fin_recorrido` en el
  outbox) y "Cerrar sesión". Si 1616PIB finalizó, el evento no llegó al servidor (a confirmar).

Decisiones del CTO (28/10):
- Cerrar la sesión automáticamente tras **3 h sin GPS** (aunque la asignación siga vigente).
- Al cerrarse así: estado propio **"Inactivo"**: gris, fuera de Atención, no cuenta "en servicio",
  sigue en el mapa y en el historial. Distinto de "Recorrido finalizado".
- Si el chofer finalizó el recorrido y luego el sistema cierra la sesión: se ve **"Recorrido finalizado"**.
- Autorizada una consulta **solo lectura** en producción para diagnosticar 1616PIB.
- Riesgo aceptado (dicho al CTO): un chofer con el celular apagado ≥ 3 h vuelve al login y la
  evidencia offline de la sesión cerrada se rechaza.

## Pasos

### 0. Diagnóstico 1616PIB (chairman, solo lectura, prod)
Job ad hoc en la VPC con el patrón de `scripts/recompute-resumen-gps.sh` (Cloud SQL solo IP
privada), SQL `SELECT` únicamente. Placa `ILIKE '1616P%B'` (el CTO escribió PIB y PUB). Leer:
- `sesiones_operativas` de hoy: `inicio, fin, estado, "recorridoEstado", "recorridoEstadoTs", "revokedAt", "deviceId"`.
- `gps_sesion_resumen`: `ultimo_fix_ts, ultimo_ingreso_ts`.
- Eventos de esa sesión (tabla de eventos operativos: verificar nombre) con `tipo` en
  (`inicio_recorrido`, `fin_recorrido`, pausa/reanudar) y su `ts`; `sync_errors` del device.
Resultado:
- `fin_recorrido` ausente: el chofer no finalizó, o el evento quedó trabado en el outbox. Si quedó
  trabado, es **un bug móvil aparte**: `detener()` encola y no fuerza el sync. Va como iteración
  propia (OTA), fuera de este PR, y se anota en el handoff.
- `fin_recorrido` presente: revisar el descarte por `ts`/drift (`ingesta-worker.service.ts:1199-1231`).

### 1. DB (Sonnet)
Migración `packages/db/prisma/migrations/20261029110000_sesion_cierre_inactividad/`:
`ALTER TABLE sesiones_operativas ADD "cerradaPorSistema" boolean NOT NULL DEFAULT false`. Agregar
el campo al modelo en `packages/db/prisma/schema.prisma`. RLS sin cambios.

### 2. API: job de cierre (Sonnet)
`rotaciones.service.ts` `cerrarSesionesVencidas`:
- Nueva constante `INACTIVIDAD_CIERRE_MS = 3 h`.
- Condición del lote **y** del guard del `UPDATE`: activa/sin fin/sin revocar **y** una de dos:
  - (A, actual) `venceAt < ahora - 4 h` **y** sin actividad en las últimas 2 h;
  - (B, nueva — **refinada tras review**) recorrido `en_curso`/`en_pausa` **y** última actividad
    (`GREATEST(último GPS, "recorridoEstadoTs", inicio)`) anterior a `ahora - 3 h` **y** hubo ingesta
    global (cualquier sesión, hoy/ayer) posterior a esa actividad + 15 min. Motivos: la app solo
    manda GPS durante un recorrido (no cerrar al que espera en fila o está entre recorridos); el
    job corre en la API y la ingesta en el worker (si el worker cae, no cerrar toda la flota).
- `SET "cerradaPorSistema" = true`.
- `fin`: que nunca quede en el futuro. Hoy cae a `venceAt` sin GPS, y con (B) eso es el fin del día
  de hoy. Usar `GREATEST(so.inicio, COALESCE(maxActividad, LEAST(a."venceAt", ahora)))`.
- Actualizar el comentario `shortcut:` y el docblock de `vigencia.ts:19-22`.

### 3. API: estado (Sonnet)
- `packages/shared/src/entities/en-vivo.ts:60`: agregar `'inactivo'` a `EstadoFrescuraSchema`.
- `clasificarFrescura` y `derivarFrescura`: nuevo parámetro `cerradaPorSistema`. Orden:
  1. sesión cerrada **no** por sistema: `finalizado` (logout, igual que hoy);
  2. `recorridoEstado = 'finalizado'` sin fix posterior: `finalizado`;
  3. sesión cerrada por sistema: `inactivo`;
  4. el resto igual.
- Leer `so."cerradaPorSistema"` en las 3 consultas que llaman `derivarFrescura`
  (`en-vivo.service.ts` ~:433 sesiones, ~:627 posiciones, ~:889 traza).

### 4. Web y design-system (Sonnet; UI puntual, camino único regla 7.c)
- `apps/web/src/lib/en-vivo/traza.ts:308` `PRESENTACION_FRESCURA.inactivo`: etiqueta "Inactivo",
  descripción "Más de 3 h sin GPS: el sistema cerró la sesión. El conductor no finalizó el
  recorrido.", gris (token existente), `esFalla: false`.
- `atencion.ts`: `enServicio = total - finalizado - inactivo` (:112). `ORDEN_ESTADOS_FRESCURA` lo
  agrega al final. `necesitaAtencion` ya lo excluye.
- `packages/design-system/src/ui/route-map-shared.ts` (:96, :150-173, :207) y
  `route-map-vehiculo.ts` (:85-101): estado `inactivo` con estilo gris/atenuado como `finalizado`
  y glifo propio (iconify si hace falta). Revisar los fallbacks de `route-map-impl.tsx:306` y
  `route-map-google.tsx:251`.
- Chips de `panel-flota.tsx`: el conteo sale de `ORDEN_ESTADOS_FRESCURA`; verificar que se vea.

### 5. Docs (chairman)
Copiar este plan a `docs/plan-cierre-inactividad.md` y poner el puntero en `docs/handoff.md` antes
de tocar código (regla 8).

## Tests
- `rotaciones.service.test.ts` (Postgres real, helper `crearSesion` :597):
  - cierra una sesión con asignación vigente y último GPS hace 3 h 05: `cerrada`,
    `cerradaPorSistema`, `fin` = último GPS;
  - no cierra con GPS hace 2 h 55;
  - sin GPS: cierra si `inicio` es de hace más de 3 h, no si es de hace 2 h, y `fin <= ahora`;
  - los casos actuales siguen verdes.
- `en-vivo.service.test.ts` `derivarFrescura`:
  - cerrada por sistema da `inactivo`;
  - cerrada por sistema con recorrido finalizado da `finalizado`;
  - logout da `finalizado`.
- `atencion.test.ts` (:77, :224): `inactivo` fuera de Atención y de en servicio.
  `route-map-vehiculo.test.ts:149`: 7 estados.

## Verificación
- `pnpm -r typecheck`, lint, tests de shared/api/web/design-system. Migración contra Postgres local.
- Playwright contra una copia local de la base: sesión con último GPS hace 3 h+; correr el job (o
  `cerrarSesionesVencidas` por script); en `/en-vivo` debe aparecer gris "Inactivo", sin entrada en
  Atención, sin contar en servicio, todavía en el mapa.
- Gates: `/code-review` + `/ponytail-review` + `/security-review` (job con `admin_quivo` y cierre
  de sesiones) + `web-design-guidelines`. Codex: no verificado (sin cuota hasta 16/11).
- PR → CI (`ci` y `acceptance` en pass) → merge → handoff.

## Riesgo / deploy
- Trae migración. API, web y worker van juntos. Si la API sale antes que la web, la web vieja cae
  a `sin_datos` vía `presentacionFrescura` y no se rompe. Se suma a r37 (sanción compensatoria,
  pendiente). **El deploy lo decide el CTO.**
- Al primer run en prod, el job cierra de una vez todas las sesiones de hoy con ≥ 3 h sin GPS (lote 500).

## Fuera
- El bug móvil de `fin_recorrido` trabado, si el paso 0 lo confirma: iteración propia con OTA.
- Botón "Finalizar día" en la app.
- Rescatar la evidencia offline de una sesión cerrada por inactividad.

## Diagnóstico 1616PIB (prod, solo lectura, 28/10 22:17 BO)
Sesión `49c31eba…`: login 15:20 BO, `inicio_recorrido` 15:36, **`pausa_recorrido` 16:25** y último
ingreso 16:25:49 (3 s después). Sin `fin_recorrido` ni logout. No es bug de outbox: el chofer pausó y
el teléfono dejó de transmitir (app cerrada / batería / datos: no se distingue). Con la regla B se
habría cerrado ~19:25 BO como "Inactivo".

## Hallazgos de review descartados / aceptados
- Lag de ingesta (p95 ~13 min) en el borde de 3 h: `shortcut:` en el código.
- Turno nocturno sin cobertura > 3 h con recorrido en curso: se cierra (mismo riesgo aceptado).
- `inactivo` con infracción abierta sigue en Atención (igual que `finalizado`): trabajo pendiente del admin.
- Ventana de deploy API→web: la web vieja muestra `inactivo` como `sin_datos` (en Atención) unos minutos.
