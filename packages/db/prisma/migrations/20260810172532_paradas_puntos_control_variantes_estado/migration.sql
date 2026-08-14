-- Soft-delete para paradas/puntos_control/variantes (nunca DELETE real): mismo criterio que
-- el resto del dominio. "puntos_control" en particular lo referencia sin FK
-- "cumplimientos_pc"."puntoControlId" (mismo patrón polimórfico que "sanciones"."sujetoId"),
-- así que un DELETE real dejaría ese historial apuntando a un id inexistente.
ALTER TABLE "paradas" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'activo';
ALTER TABLE "puntos_control" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'activo';
ALTER TABLE "variantes" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'activo';
