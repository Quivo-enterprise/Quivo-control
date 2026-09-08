import { z } from 'zod';
import { PlacaVehiculoSchema, PinMovilSchema } from '@quivo/shared';

// `@quivo/shared` usa zod 3 y `apps/mobile` usa zod 4: no se pueden componer los schemas
// directamente en un z.object() de zod 4 (la inferencia de tipos rompe a `unknown` y el
// shape interno de zod 3 no expone lo que zod 4 espera en runtime). En vez de duplicar el
// regex/mensajes, delegamos la validación a los schemas de @quivo/shared vía safeParse.
export const vehicleLoginSchema = z.object({
  placa: z.string().superRefine((value, ctx) => {
    const result = PlacaVehiculoSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
      }
    }
  }),
  pin: z.string().superRefine((value, ctx) => {
    const result = PinMovilSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
      }
    }
  }),
});

export type VehicleLoginFormValues = z.infer<typeof vehicleLoginSchema>;
