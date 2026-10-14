-- docs/plan-en-vivo-alertas.md, PR B — celular de contacto del conductor (E.164, opcional).
-- Las políticas RLS de "conductores" ya cubren la tabla completa; no se tocan.
ALTER TABLE "conductores" ADD COLUMN "telefono" TEXT;
