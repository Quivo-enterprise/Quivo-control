-- Hora exacta de despacho/presentación (modelo operativo Línea 120, piloto Tiquipaya).
-- Opcionales a propósito: `horario` (mañana/tarde/noche) sigue rigiendo el constraint de
-- unicidad de `asignaciones`; estas dos solo se completan cuando la generación recibe
-- configuración de horario pico (headway) para ese `horario`.
ALTER TABLE "asignaciones"
  ADD COLUMN "horaSalida" TIMESTAMP(3),
  ADD COLUMN "horaPresentacion" TIMESTAMP(3);
