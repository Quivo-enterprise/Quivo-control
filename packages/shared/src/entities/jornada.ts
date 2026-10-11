import { z } from 'zod';
import { uuidSchema } from '../primitives.js';
import { RutaSchema } from './ruta.js';

const fechaDiaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Estado de la jornada de un vehículo en el día (panel de jornadas, release 13). */
export const EstadoJornadaSchema = z.enum([
  'sin_iniciar',
  'dia_iniciado',
  'en_recorrido',
  'finalizado',
]);
export type EstadoJornada = z.infer<typeof EstadoJornadaSchema>;

export const JornadaVehiculoSchema = z.object({
  vehiculoId: uuidSchema,
  // Respuesta: sin validar formato de placa (puede haber placas anteriores al reemplaque).
  placa: z.string().min(1),
  numeroInterno: z.string().nullable(),
  conductorNombre: z.string().nullable(),
  lineaId: uuidSchema,
  lineaNombre: z.string(),
  rutaSentido: RutaSchema.shape.sentido,
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
  fecha: fechaDiaSchema.optional(),
});
export type JornadasQuery = z.infer<typeof JornadasQuerySchema>;
