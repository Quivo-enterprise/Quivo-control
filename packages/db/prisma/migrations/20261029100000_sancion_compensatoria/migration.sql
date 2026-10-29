-- Sanción compensatoria: al sancionar desde una infracción (`POST /infracciones/:id/sancionar`)
-- se agenda cuándo, cuántas vueltas, en qué turno y desde qué parada se cumple. Las sanciones
-- manuales (`/reglas`) y las previas dejan los 4 campos en NULL (todo-o-nada).
ALTER TABLE sanciones
  ADD COLUMN "fechaCumplimiento" date,
  ADD COLUMN "vueltas" integer,
  ADD COLUMN "turno" text,
  ADD COLUMN "paradaSalida" text;

ALTER TABLE sanciones
  ADD CONSTRAINT sanciones_vueltas_rango CHECK ("vueltas" BETWEEN 1 AND 10),
  ADD CONSTRAINT sanciones_turno_valido CHECK ("turno" IN ('manana', 'tarde', 'noche')),
  ADD CONSTRAINT sanciones_parada_salida_valida CHECK ("paradaSalida" IN ('salomon_romero', 'molinos')),
  ADD CONSTRAINT sanciones_compensatoria_todo_o_nada CHECK (
    ("fechaCumplimiento" IS NULL AND "vueltas" IS NULL AND "turno" IS NULL AND "paradaSalida" IS NULL)
    OR ("fechaCumplimiento" IS NOT NULL AND "vueltas" IS NOT NULL AND "turno" IS NOT NULL AND "paradaSalida" IS NOT NULL)
  );
