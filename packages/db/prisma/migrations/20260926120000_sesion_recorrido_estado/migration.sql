-- docs/plan-ubicacion-fluida.md, Fase A — estado "Finalizado" en el panel `/en-vivo`.
--
-- Causa raíz (verificada en el código, ver el plan): el botón "Finalizar" de la app manda el
-- evento `fin_recorrido` (payload `{sesionId}`), pero `insertarEventoOperativoEnTx`
-- (ingesta-worker.service.ts) solo lo escribía en `eventos_operativos` como bitácora — nadie
-- lo leía. `SesionOperativa.fin`/`estado` son de la sesión de LOGIN (solo los toca `logout`
-- en auth-movil), así que el panel seguía mostrando "Reportando" → "Detenido" → "Sin señal"
-- (rojo, falla) para un recorrido que en realidad terminó bien.
--
-- Estas dos columnas ADITIVAS son el estado DERIVADO del recorrido, mantenido a partir de
-- ahora por el worker (misma transacción que inserta el evento `inicio_recorrido`/
-- `fin_recorrido`, ver `ingesta-worker.service.ts`) — nunca se tocan `fin`/`estado`.
--
-- Sin `@map` por campo en `schema.prisma` (igual que el resto del modelo `SesionOperativa`,
-- que no usa `@map` de columna en ningún otro campo): quedan camelCase entre comillas,
-- `"recorridoEstado"`/`"recorridoEstadoTs"`, igual que `"sindicatoId"`/`"asignacionId"` de la
-- tabla original (`20260801090000_auth_movil_operativa`). `TIMESTAMP(3)` SIN zona horaria
-- (no `TIMESTAMPTZ`), igual que `fin`/`revokedAt`/etc. de esta misma tabla: es el mapeo por
-- defecto de Prisma para `DateTime` en este `datasource` (sin `@db.Timestamptz`), y esta
-- tabla nunca lo sobreescribió — usar `TIMESTAMPTZ` acá rompería la consistencia con el
-- resto del modelo y con lo que Prisma espera generar.
ALTER TABLE sesiones_operativas
  ADD COLUMN "recorridoEstado" TEXT,
  ADD COLUMN "recorridoEstadoTs" TIMESTAMP(3);

-- CHECK laxo (NULL siempre permitido — sesiones que nunca mandaron inicio/fin de recorrido,
-- todas las existentes hasta este deploy y cualquier sesión futura que solo reporte
-- `gps_point` sin pasar por esos dos eventos): solo restringe el DOMINIO cuando el valor SÍ
-- está seteado, mismo criterio que `vehiculos_placa_norm_check`
-- (`20260908151800_unicidad_placa_generada`) de validar el dominio sin forzar NOT NULL.
ALTER TABLE sesiones_operativas
  ADD CONSTRAINT sesiones_operativas_recorrido_estado_check
    CHECK ("recorridoEstado" IS NULL OR "recorridoEstado" IN ('en_curso', 'finalizado'));

-- Backfill: para cada sesión existente, el último evento `inicio_recorrido`/`fin_recorrido`
-- de `eventos_operativos` (si hubo varios ciclos inicio→fin→inicio, el de `ts` más reciente
-- gana — mismo criterio "último evento manda" que va a aplicar el worker hacia adelante con
-- su guard por `recorridoEstadoTs`).
--
-- JOIN por `(id, "sindicatoId", "deviceId")`, no solo por `"sesionId"` (hallazgo de
-- Codex/code-review): `eventos_operativos."sesionId"` sale del `payload` que manda el
-- DISPOSITIVO (`insertarEventoOperativoEnTx`) — sin tenant-check propio en esa tabla más
-- allá de su RLS (que este backfill bypassea a propósito, ver arriba). Si alguna fila
-- histórica tuviera un `"sesionId"` que en realidad pertenece a una sesión de OTRO
-- sindicato, o de OTRO dispositivo del MISMO sindicato (payload corrupto, o dos sesiones
-- simultáneas del mismo vehículo en dos teléfonos — caso real, ver el comentario de
-- `SesionEnVivoResumenSchema` en `@quivo/shared`), unir solo por `"sesionId"` le atribuiría
-- el estado de recorrido de esa sesión ajena a la sesión propia — cross-tenant/cross-device
-- poisoning, mismo motivo por el que `en-vivo.service.ts` cierra sus LATERAL con
-- `AND gr."sindicatoId" = so."sindicatoId"`. El join de abajo exige que el `"sindicatoId"` Y
-- el `"deviceId"` del EVENTO coincidan con los de la SESIÓN: un evento cuyo tenant o
-- dispositivo no coincide con los de la sesión que referencia se ignora en el backfill
-- (mismo criterio, hacia adelante, que aplica el guard `WHERE ... AND "sindicatoId" = $sid
-- AND "deviceId" = $deviceId` del `UPDATE` del worker).
-- Bypass de RLS (mismo patrón que el backfill de `gps_sesion_resumen`,
-- `20260922100000_gps_sesion_resumen`): tanto `sesiones_operativas` como `eventos_operativos`
-- tienen `FORCE ROW LEVEL SECURITY` (`20260801090000_auth_movil_operativa` y
-- `20260802160000_ingesta_gps_worker`), y el rol que corre `prisma migrate deploy` en Cloud
-- SQL NO tiene BYPASSRLS (confirmado en producción, ver `docs/handoff.md`). Sin
-- `app.rol = 'admin_quivo'` seteado, la policy `tenant_isolation` de ambas tablas evalúa
-- `NULL OR (... = NULL)` → false para TODAS las filas: el backfill "correría bien", sin
-- error, y dejaría las dos columnas nuevas en NULL para siempre — el mismo modo de falla
-- silencioso que ya mordió a esta rama una vez con `gps_sesion_resumen`.
--
-- `false` (sesión, no `SET LOCAL`/transaction-local): igual motivo que la migración de
-- `gps_sesion_resumen` — Prisma Migrate para Postgres no garantiza que todo `migration.sql`
-- corra dentro de una única transacción (prisma/prisma#3774), así que un `SET LOCAL`
-- equivalente podría perderse entre el `set_config` y el `UPDATE` de abajo si el motor los
-- trata como statements/transacciones separadas. Se resetea explícitamente apenas termina el
-- backfill.
SELECT set_config('app.rol', 'admin_quivo', false);

WITH ultimo_evento_recorrido AS (
  SELECT DISTINCT ON (so.id)
    so.id AS sesion_id,
    eo.tipo,
    eo.ts
  FROM eventos_operativos eo
  JOIN sesiones_operativas so
    ON so.id = eo."sesionId"
    AND so."sindicatoId" = eo."sindicatoId"
    AND so."deviceId" = eo."deviceId"
  WHERE eo.tipo IN ('inicio_recorrido', 'fin_recorrido')
  ORDER BY so.id, eo.ts DESC
)
UPDATE sesiones_operativas so
SET "recorridoEstado" = CASE uer.tipo WHEN 'fin_recorrido' THEN 'finalizado' ELSE 'en_curso' END,
    "recorridoEstadoTs" = uer.ts
FROM ultimo_evento_recorrido uer
WHERE uer.sesion_id = so.id;

-- Reset inmediato del rol elevado, mismo motivo que `gps_sesion_resumen`: no dejarlo pegado a
-- la conexión de migraciones más tiempo del necesario.
SELECT set_config('app.rol', '', false);

-- Sin índice nuevo (plan §Fase A, explícito): ninguna query filtra todavía por
-- `"recorridoEstado"`/`"recorridoEstadoTs"` — `listarHoy`/`obtenerPosiciones`/`obtenerTraza`
-- los SELECCIONAN junto con el resto de la fila de `so`, ya localizada por sus índices
-- existentes (`sindicatoId`, `asignacionId`+estado, etc.), no los usan como predicado.
