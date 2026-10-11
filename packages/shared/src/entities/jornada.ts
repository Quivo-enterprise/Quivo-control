import { z } from 'zod';
import { uuidSchema } from '../primitives.js';

const fechaDiaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `YYYY-MM-DD` que además existe en el calendario (rechaza `2026-02-31`). */
const fechaCalendarioSchema = fechaDiaSchema.refine(
  (f) => {
    const [y, m, d] = f.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  },
  { message: 'Fecha inexistente en el calendario' },
);

/** Estado de la jornada de un vehículo en el día (panel de jornadas, release 13). */
export const EstadoJornadaSchema = z.enum([
  'sin_iniciar',
  'dia_iniciado',
  'en_recorrido',
  'finalizado',
]);
export type EstadoJornada = z.infer<typeof EstadoJornadaSchema>;

// Respuesta: los campos de texto NO reusan los validadores de entrada (min/max/formato) de
// `RutaSchema`/`VehiculoSchema`/etc.: una fila legacy que no los cumpla haría fallar el parse
// y tiraría 500 todo el panel. Solo los ids (de la BD) siguen siendo uuid.
export const JornadaVehiculoSchema = z.object({
  sindicatoId: uuidSchema,
  sindicatoNombre: z.string(),
  vehiculoId: uuidSchema,
  // Respuesta: sin validar formato de placa (puede haber placas anteriores al reemplaque).
  placa: z.string().min(1),
  numeroInterno: z.string().nullable(),
  conductorNombre: z.string().nullable(),
  lineaId: uuidSchema,
  lineaNombre: z.string(),
  rutaSentido: z.string(),
  // Viaja como JSON: ISO string, no `Date` (el cliente web no parsea la respuesta).
  horaSalida: z.string().datetime({ offset: true }).nullable(),
  estado: EstadoJornadaSchema,
  inicioJornadaTs: z.string().datetime({ offset: true }).nullable(),
});
export type JornadaVehiculo = z.infer<typeof JornadaVehiculoSchema>;

export const JornadasDelDiaSchema = z.object({
  fecha: fechaDiaSchema,
  vehiculos: JornadaVehiculoSchema.array(),
});
export type JornadasDelDia = z.infer<typeof JornadasDelDiaSchema>;

export const JornadasQuerySchema = z.object({
  fecha: fechaCalendarioSchema.optional(),
});
export type JornadasQuery = z.infer<typeof JornadasQuerySchema>;
