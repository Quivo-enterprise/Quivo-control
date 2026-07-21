import { z } from 'zod';

// Estados núcleo (doc técnico §4.2). Se amplían si el modelo de datos lo requiere.

export const EstadoSindicatoSchema = z.enum(['activo', 'inactivo']);
export type EstadoSindicato = z.infer<typeof EstadoSindicatoSchema>;

export const EstadoVehiculoSchema = z.enum(['activo', 'inactivo', 'suspendido', 'mantenimiento']);
export type EstadoVehiculo = z.infer<typeof EstadoVehiculoSchema>;

export const EstadoSocioSchema = z.enum(['activo', 'inactivo']);
export type EstadoSocio = z.infer<typeof EstadoSocioSchema>;

export const EstadoConductorSchema = z.enum(['activo', 'inactivo']);
export type EstadoConductor = z.infer<typeof EstadoConductorSchema>;

export const EstadoSancionSchema = z.enum([
  'pendiente',
  'aplicada',
  'anulada',
  'apelada',
  'pagada',
]);
export type EstadoSancion = z.infer<typeof EstadoSancionSchema>;

export const EstadoRotacionSchema = z.enum(['borrador', 'publicada']);
export type EstadoRotacion = z.infer<typeof EstadoRotacionSchema>;
