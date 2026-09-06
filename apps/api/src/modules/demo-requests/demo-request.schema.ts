import { z } from 'zod';

export const CreateDemoRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    line: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(100),
    lineCount: z.number().int().min(1).max(10_000),
    vehicleCount: z.number().int().min(1).max(100_000).optional(),
    // Campo trampa para bots. Nunca se persiste.
    website: z.string().max(200).optional(),
  })
  .strict();

export type CreateDemoRequest = z.infer<typeof CreateDemoRequestSchema>;
