-- Multi-vuelta (plan v2 §2.3, docs/plan-v2-app-y-mapa-en-vivo.md): hoy la app solo cuenta la
-- PRIMERA pasada por cada punto de control (el supresor del móvil es un `Set` durable
-- reconstruido del outbox — bug 100% del lado móvil, ver `apps/mobile/src/gps/geofence.ts` y
-- `location-task.ts`). El servidor ya soportaba N pasadas SIN cambios: el único UNIQUE de
-- `cumplimientos_pc` es `eventId` (idempotencia por evento, QUI-238/241) — nunca hubo un
-- constraint sobre `(sesionId, puntoControlId)` que lo impidiera.
--
-- Este aditivo agrega el campo que distingue "pasó y es la vuelta 3" de "pasó una vez más y
-- se perdió el evento" (`pasada`, calculado en el móvil por la máquina de estados con
-- histéresis, `filtrarNuevosCumplimientos`), y el índice que sirve la consulta natural del
-- mundo con N pasadas: todos los cumplimientos de una sesión y un punto de control, ordenados
-- en el tiempo (hoy los tres índices existentes son columnas separadas, ninguno cubre esa
-- consulta).
--
-- Puramente aditivo — sin downtime, sin backfill: `ADD COLUMN` nullable + `CREATE INDEX` (sin
-- `CONCURRENTLY`: mismo patrón que el resto de las migraciones de este repo, que asumen una
-- ventana de mantenimiento corta, no una tabla en producción con tráfico 24/7 todavía).
--
-- 🔴 A PROPÓSITO NO hay un UNIQUE sobre (sesionId, puntoControlId, pasada), ni ningún otro
-- constraint que dependa de que `pasada` sea correcto. La semilla del contador de pasadas en
-- el móvil (`clavesCumplimientoDesdePayloads`, `location-task.ts`) es best-effort: se
-- reconstruye leyendo el outbox local, y si esa lectura falla o el outbox fue podado
-- (`purgarAcusadosAntesDe`, `db/outbox.ts`) antes de la ventana esperada, el contador puede
-- reiniciar en 1 sin que el dispositivo se entere. Un UNIQUE compuesto sobre `pasada`
-- descartaría en SILENCIO, vía `ON CONFLICT DO NOTHING`/`skipDuplicates`, una pasada real que
-- de verdad ocurrió — indistinguible de un duplicado genuino. Un constraint que borra
-- evidencia legal (RF-64..66) es estrictamente peor que dejar pasar un duplicado detectable
-- (dos filas con el mismo `(sesionId, puntoControlId, pasada)` son visibles y auditables; una
-- fila descartada no lo es). `eventId` sigue siendo el ÚNICO UNIQUE de idempotencia real.

-- AlterTable
ALTER TABLE "cumplimientos_pc" ADD COLUMN "pasada" INTEGER;

-- CreateIndex
CREATE INDEX "cumplimientos_pc_sesionId_puntoControlId_ts_idx" ON "cumplimientos_pc"("sesionId", "puntoControlId", "ts");
