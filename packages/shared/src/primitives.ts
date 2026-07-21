import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** UUIDv7: mismo formato de UUID, versión fija en el 3er grupo (RF-72, doc técnico §7). */
export const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'debe ser un UUIDv7 válido',
  );

export const sindicatoIdSchema = uuidSchema;
