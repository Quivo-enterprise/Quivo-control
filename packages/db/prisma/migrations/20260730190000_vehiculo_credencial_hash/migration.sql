-- QUI-222: campo para la credencial de vehículo (login por vehículo, M3) — sin lógica de
-- login todavía, ver comentario en schema.prisma.
ALTER TABLE vehiculos ADD COLUMN "credencialHash" TEXT;
