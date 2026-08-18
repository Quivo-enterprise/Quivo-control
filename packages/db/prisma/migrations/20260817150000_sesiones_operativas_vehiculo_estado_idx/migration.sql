-- Hallazgo de revisión (bajo): el login de conductor (`auth-movil.service.ts`, dentro de la
-- transacción de `iniciarSesion`) cierra las sesiones operativas colgadas del vehículo con
--   WHERE estado = 'activa' AND "revokedAt" IS NULL AND "sindicatoId" = ...
--     AND (vehiculoId = ... OR "deviceId" = ...)
-- `sesiones_operativas` ya tenía `@@index([deviceId, estado])` (sirve la rama `deviceId`) y
-- `@@index([sindicatoId])`, pero nada sobre `vehiculoId` — la rama `vehiculoId` del `OR` no
-- la puede servir ningún índice existente, así que Postgres cae a un seq scan completo de la
-- tabla en cada login. Las filas nunca se borran (una sesión cerrada pasa a
-- `estado: 'cerrada'`, nunca se elimina), así que el costo degrada de forma monótona con el
-- tiempo, no se estabiliza.
--
-- Puramente aditivo — sin downtime, sin backfill: solo `CREATE INDEX`. Sin `CONCURRENTLY`:
-- mismo patrón que el resto de las migraciones de este repo (ver el comentario de
-- `20260817140000_cumplimientos_pc_pasada`, la migración inmediata anterior), que asumen una
-- ventana de mantenimiento corta, no una tabla en producción con tráfico 24/7 todavía.

-- CreateIndex
CREATE INDEX "sesiones_operativas_vehiculoId_estado_idx" ON "sesiones_operativas"("vehiculoId", "estado");
