-- QUI-242: la vista admin de sync_errors necesita poder filtrar por sesión (RNF-35 pide
-- "dispositivo, sesión, payload, error, ts"). Nullable: no todos los fallos tienen sesionId
-- resoluble (ej. un evento operativo sin sesionId en el payload falla justamente por eso).
ALTER TABLE "sync_errors" ADD COLUMN "sesionId" TEXT;
CREATE INDEX "sync_errors_sesionId_idx" ON "sync_errors"("sesionId");
