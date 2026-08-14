-- QUI-241: `sesionId` en `cumplimientos_pc`/`eventos_operativos` siempre viene de una
-- sesión móvil real y autenticada (nunca dato ambiguo del cliente sin validar, a diferencia
-- de `AuditLog.entidadId` que sí es polimórfico sin FK) — agregar la FK que faltó en la
-- migración anterior, para integridad referencial real.
ALTER TABLE "cumplimientos_pc" ADD CONSTRAINT "cumplimientos_pc_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "sesiones_operativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eventos_operativos" ADD CONSTRAINT "eventos_operativos_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "sesiones_operativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
