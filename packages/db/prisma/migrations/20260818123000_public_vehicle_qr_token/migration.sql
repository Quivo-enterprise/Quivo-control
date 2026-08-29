-- El QR público se identifica por un UUID opaco. No reutilizamos placa, conductor ni IDs
-- de operación para que un escaneo no revele datos internos.
ALTER TABLE "vehiculos"
  ADD COLUMN "publicQrToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX "vehiculos_publicQrToken_key" ON "vehiculos"("publicQrToken");
